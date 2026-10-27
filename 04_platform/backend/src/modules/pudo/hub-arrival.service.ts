import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { clockAt, clocksOfCountry, zoneName } from './fleet-clock';
import { openOn, weekOf } from './fleet-site.service';
import { WEEKDAYS } from './fleet-site.types';
import {
  HUB_ARRIVAL_DAYS_AHEAD,
  HUB_UNIT_KINDS,
  type HubArrival,
  type HubArrivalFee,
  type HubArrivalFeeView,
  type HubArrivalParcel,
  type HubArrivalScan,
  type HubArrivalView,
  type HubArrivals,
  type HubBulk,
  type HubBulkView,
  type HubOption,
  type HubUnitKind,
  type HubUnitPrices,
  type HubWaiting,
  type StoreHubArrivals,
} from './hub-arrival.types';
import { MdpService } from './mdp.service';
import { HubContactService, outsideOf } from './hub-contact.service';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import type { Mdp, Parcel, ParcelSize } from './pudo.types';
import { publicQuote, RoutingService, type QuoteCarriers } from './routing.service';
import { VendorService } from './vendor.service';
import { WalletGateService } from './wallet-gate.service';

/** How long a finished or withdrawn arrival stays on the hub's list: a week. On the store's, a fortnight. */
const HUB_DONE_SHOWN_MS = 7 * 86_400_000;
const STORE_DONE_SHOWN_MS = 14 * 86_400_000;

const UNIT_WORDS: Record<HubUnitKind, [string, string]> = { pallet: ['pallet', 'pallets'], carton: ['carton', 'cartons'], cage: ['cage', 'cages'], sack: ['sack', 'sacks'] };
const unitsInWords = (kind: HubUnitKind, n: number) => `${n} ${UNIT_WORDS[kind][n === 1 ? 0 : 1]}`;
const parcelsInWords = (n: number) => `${n} ${n === 1 ? 'parcel' : 'parcels'}`;
const WEEKDAY_NAMES: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/**
 * INBOUND SUPPLY, READING B — A HUB AS A CROSS-DOCK (hub-arrival.types.ts; the user, 2026-10-25: "Yes, A then B").
 *
 * THE HUB'S WORD: it takes stores' parcels in bulk, on the days and hours it says, at so many doors (D8). Kept here, by
 * the hub; read by the stores choosing where to hand their parcels in, who are shown each such hub priced for the parcel
 * in hand the way the mint will price it.
 *
 * THE STORE'S BOOKING: which of its parcels — each minted to be handed in at that hub, paid, still with the store — on how
 * many units of what, on which day on the hub's clock. Withdrawn by the store until the hub has it.
 *
 * THE HUB'S TAKE-IN: at its door it counts the units that came (the handover of the bulk), then scans each parcel off them
 * (ParcelService.takeInAtHub: custody store → hub; the parcel waits for its sort like one out of a bag, and its journey
 * plan is frozen from the hub). Finished by hand, or by the last parcel: what was booked and did not come is still the
 * store's, which is told in its bell and books it again. The hub is paid for its work on a parcel as for any parcel: when
 * it sorts it.
 *
 * THE RECEIVING FEE (D12): where the hub charges for a unit of its kind, the store pays for the units it books when it books
 * them (refused, before anything is written, where its balance cannot carry it), and the hub is paid its own fee at its door
 * for the units it counts — a custody event. Units booked and not counted go back to the store at the door; all of them,
 * where it was withdrawn or did not come. Units beyond the booking are charged at the door, or not taken in.
 */
@Injectable()
export class HubArrivalService {
  private readonly logger = new Logger(HubArrivalService.name);
  private readonly bulk = new PersistentMap<string, HubBulk>('hub-bulk');
  private readonly arrivals = new PersistentMap<string, HubArrival>('hub-arrivals');

  constructor(
    private readonly mdps: MdpService,
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
    private readonly routing: RoutingService,
    private readonly agents: AgentService,
    @Optional() private readonly events?: EventBus,
    @Optional() private readonly notifications?: NotificationService,
    // When the hub is open and how to reach it (hub-contact.service.ts). Optional for the specs; without it, nothing of it.
    @Optional() private readonly contacts?: HubContactService,
    // Pays the hub its receiving fee at its door (D12). Optional for the specs; without it, the hub is not paid.
    @Optional() private readonly gate?: WalletGateService,
  ) {}

  /* ---------------------------------------------------------------------------------------- the hub's word -- */

  /**
   * The hub says it takes stores' parcels in bulk — on these days and hours, at so many doors — or that it no longer does.
   * Stopping refuses new bookings only: what stores already booked with it, it still takes in.
   */
  setBulk(mdpId: string, input: { open: boolean; hours?: Record<string, { open: string; close: string } | null> | null; doors?: number | null; fees?: Record<string, number | null> | null }, by: string, now: number = Date.now()): HubBulkView | undefined {
    const hub = this.mdps.working(mdpId);
    if (!input.open) {
      this.bulk.delete(mdpId);
      return undefined;
    }
    const was = this.bulk.get(mdpId);
    const hours = input.hours === null ? undefined : input.hours !== undefined ? weekOf(input.hours) : was?.hours;
    if (hours && !WEEKDAYS.some((d) => hours[d])) throw new GlosError('INVALID_INPUT', 'Give at least one day the hub receives — or say it takes no parcels in bulk', { field: 'hours' });
    // Inside the hours the hub is open, where it keeps them: it cannot take parcels in at a closed door.
    const opening = this.contacts?.openingHoursOf(hub.mdpId);
    const outside = hours && opening ? outsideOf(hours, opening) : null;
    if (outside) throw new GlosError('INVALID_INPUT', `The hub is not open then (${outside}): choose hours inside its opening hours, or open it then first`, { field: 'hours' });
    const doors = input.doors === null ? undefined : (input.doors ?? was?.doors);
    if (doors !== undefined && !(Number.isInteger(doors) && doors >= 1 && doors <= 50)) throw new GlosError('INVALID_INPUT', 'Doors are counted 1 to 50', { field: 'doors' });
    // What it charges to take in each kind of unit (D12): its own, in its own money. Arrivals already booked keep theirs.
    const fees = input.fees === null ? undefined : input.fees !== undefined ? feesOf(input.fees) : was?.fees;
    const next: HubBulk = { mdpId: hub.mdpId, ...(hours ? { hours } : {}), ...(doors ? { doors } : {}), ...(fees ? { fees } : {}), since: was?.since ?? new Date(now).toISOString(), by };
    this.bulk.set(hub.mdpId, next);
    return this.bulkView(hub, next, now);
  }

  /** Whether this hub takes stores' parcels in bulk, and when — read by a store, with what a unit costs it. */
  bulkOf(mdpId: string, now: number = Date.now(), vendorId?: string): HubBulkView | undefined {
    const b = this.bulk.get(mdpId);
    return b ? this.bulkView(this.mdps.require(mdpId), b, now, vendorId) : undefined;
  }

  /** The hub, working and taking stores' parcels in bulk — or refused in words a store can act on. */
  requireTakingBulk(mdpId: string): Mdp {
    const hub = this.mdps.working(mdpId);
    if (!this.bulk.has(mdpId)) throw new GlosError('INVALID_STATE', `${hub.name} does not take parcels in bulk: hand them in at a shop, or at a hub that does`);
    return hub;
  }

  /**
   * THE HUBS A STORE MAY HAND THIS PARCEL IN AT: working and taking bulk, each priced for it the way the mint will price it
   * (from the hub, sold by the store's own company) — or saying why it cannot be sent from there.
   */
  options(vendorId: string, destDid: string, size: ParcelSize, measured: number | undefined, carriers: QuoteCarriers, now: number = Date.now()): HubOption[] {
    const vendor = this.vendors.get(vendorId);
    const seller = this.vendors.entityIdOf(vendor);
    const out: HubOption[] = [];
    for (const b of this.bulk.values()) {
      let hub: Mdp;
      try {
        hub = this.mdps.working(b.mdpId);
      } catch {
        continue; // a hub that may not work today offers nothing
      }
      const view = this.bulkView(hub, b, now, vendorId);
      try {
        out.push({ ...view, quote: publicQuote(this.routing.quoteShipmentFrom(this.routing.hubEnd(hub.mdpId), destDid, size, seller, measured, carriers)) });
      } catch (err) {
        out.push({ ...view, error: (err as Error).message });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ------------------------------------------------------------------------------------------- the store -- */

  /**
   * THE STORE BOOKS AN ARRIVAL: its own parcels minted to be handed in at this hub, paid, still with it and on no other
   * arrival; how many units of what; a day the hub receives, from today to a month ahead on the hub's own clock. Each
   * refusal before anything is written.
   */
  book(vendorId: string, input: { mdpId: string; parcelIds: string[]; unitKind: HubUnitKind; units: number; expectedOn: string; reference?: string; bringer?: string }, by: string, now: number = Date.now()): HubArrivalView {
    this.vendors.get(vendorId);
    const hub = this.requireTakingBulk(input.mdpId);
    const ids = [...new Set(input.parcelIds.map((x) => x.trim()).filter(Boolean))];
    if (!ids.length) throw new GlosError('INVALID_INPUT', 'Choose the parcels it carries', { field: 'parcelIds' });
    const onOpen = this.openParcelIds();
    for (const id of ids) {
      const p = this.storeParcel(vendorId, id);
      if (p.handInMdpId !== hub.mdpId) throw new GlosError('INVALID_INPUT', `${id} is not booked to be handed in at ${hub.name}`, { field: 'parcelIds' });
      if (p.status !== 'Created') throw new GlosError('INVALID_STATE', `${id} was taken in already`, { field: 'parcelIds' });
      if (p.paidStatus !== 'ParcelPaid') throw new GlosError('INVALID_STATE', `${id} is not paid for yet`, { field: 'parcelIds' });
      if (onOpen.has(id)) throw new GlosError('INVALID_STATE', `${id} is on another arrival already`, { field: 'parcelIds' });
    }
    if (!Number.isInteger(input.units) || input.units < 1) throw new GlosError('INVALID_INPUT', 'Count the units it comes on: one or more', { field: 'units' });
    const zone = this.clockOf(hub, now);
    const today = clockAt(now, zone ?? 'UTC').day;
    if (input.expectedOn < today) throw new GlosError('INVALID_INPUT', `Choose today or a day ahead, on ${hub.name}'s clock`, { field: 'expectedOn' });
    if (input.expectedOn > dayAfter(today, HUB_ARRIVAL_DAYS_AHEAD)) throw new GlosError('INVALID_INPUT', `Book it at most ${HUB_ARRIVAL_DAYS_AHEAD} days ahead`, { field: 'expectedOn' });
    // The days it takes parcels in bulk — or, where it set none, the days it is open.
    const hours = this.bulk.get(hub.mdpId)?.hours ?? this.contacts?.openingHoursOf(hub.mdpId);
    const receives = hours ? openOn(hours, input.expectedOn) : null;
    if (hours && !receives) {
      throw new GlosError('INVALID_INPUT', `${hub.name} does not receive on a ${WEEKDAY_NAMES[weekdayOf(input.expectedOn)]}: choose a day it does`, { field: 'expectedOn' });
    }
    // Today only while it still receives: once it has closed on its own clock, nothing booked for today comes today.
    if (receives && input.expectedOn === today && clockAt(now, zone ?? 'UTC').minutes >= receives.toMin) {
      throw new GlosError('INVALID_INPUT', `${hub.name} stopped receiving at ${hhmm(receives.toMin)} today, on its clock: choose a day ahead`, { field: 'expectedOn' });
    }
    const reference = input.reference?.trim();
    const bringer = input.bringer?.trim();
    // THE RECEIVING FEE (D12): the hub's own fee for this kind, locked now; the booked units paid for now, out of the store's
    // balance — refused before anything is written where it cannot carry them.
    const arrivalId = `arr_${randomBytes(5).toString('hex')}`;
    const fee = this.feeFor(hub, vendorId, input.unitKind, input.units, now);
    if (fee) {
      const n = fee.charged.units;
      const balance = this.vendors.balanceOf(vendorId);
      const refused = () =>
        new GlosError('WALLET_INSUFFICIENT', `Top up first — taking in ${unitsInWords(input.unitKind, n)} at ${hub.name} costs ${money(fee.charged.amount, fee.unit.currency)}, and your balance is ${money(balance, fee.unit.currency)}`);
      if (balance + 1e-9 < fee.charged.amount) throw refused();
      const bill = this.vendors.billShipment(vendorId, arrivalId, fee.charged.amount, times(fee.unit.buffer, n), times(fee.unit.tax, n), times(fee.unit.provision, n), { kind: 'hub-receiving', note: `receiving at ${hub.name}: ${unitsInWords(input.unitKind, n)}` });
      if (!bill.paid) throw refused();
    }
    const arrival: HubArrival = {
      arrivalId,
      mdpId: hub.mdpId,
      vendorId,
      parcelIds: ids,
      units: { kind: input.unitKind, count: input.units },
      expectedOn: input.expectedOn,
      ...(reference ? { reference: reference.slice(0, 60) } : {}),
      ...(bringer ? { bringer: bringer.slice(0, 80) } : {}),
      state: 'expected',
      createdAt: new Date(now).toISOString(),
      createdBy: by,
      scanned: [],
      ...(fee ? { fee } : {}),
    };
    this.arrivals.set(arrival.arrivalId, arrival);
    return this.viewOf(arrival, now, 'store');
  }

  /** The store withdraws an arrival the hub has not taken in: its parcels are free to book again. */
  withdraw(vendorId: string, arrivalId: string, by: string, now: number = Date.now()): HubArrivalView {
    const a = this.arrivals.get(arrivalId);
    if (!a || a.vendorId !== vendorId) throw new GlosError('NOT_FOUND', 'No such arrival of yours');
    if (a.state === 'withdrawn') return this.viewOf(a, now, 'store');
    if (a.state === 'missed') throw new GlosError('INVALID_STATE', 'The hub said it did not come: its parcels are free to book again');
    if (a.state !== 'expected') throw new GlosError('INVALID_STATE', 'The hub has taken it in already: what it scanned is in its hands');
    a.state = 'withdrawn';
    a.withdrawn = { at: new Date(now).toISOString(), by };
    // Nothing was taken in: what it paid for receiving goes back, all of it.
    if (a.fee) this.giveBack(a, a.fee.charged.units, 'withdrawn', now);
    this.arrivals.set(a.arrivalId, a);
    return this.viewOf(a, now, 'store');
  }

  /** What the store has to book (its parcels for each hub, on no arrival yet), and its arrivals — open first. */
  forStore(vendorId: string, now: number = Date.now()): StoreHubArrivals {
    this.vendors.get(vendorId);
    const onOpen = this.openParcelIds();
    const byHub = new Map<string, HubArrivalParcel[]>();
    for (const p of this.parcels.list({ vendorId })) {
      if (!p.handInMdpId || p.status !== 'Created' || p.paidStatus !== 'ParcelPaid' || onOpen.has(p.parcelId)) continue;
      byHub.set(p.handInMdpId, [...(byHub.get(p.handInMdpId) ?? []), this.parcelOf(p, false)]);
    }
    const waiting: HubWaiting[] = [...byHub.entries()].map(([mdpId, parcels]) => {
      const bulk = this.bulkOf(mdpId, now, vendorId);
      return { mdpId, hubName: this.hubName(mdpId), ...(bulk ? { bulk } : {}), parcels };
    });
    const mine = [...this.arrivals.values()].filter((a) => a.vendorId === vendorId && (isOpen(a) || now - Date.parse(doneAt(a)) <= STORE_DONE_SHOWN_MS));
    return { waiting, arrivals: this.ordered(mine).map((a) => this.viewOf(a, now, 'store')) };
  }

  /* --------------------------------------------------------------------------------------------- the hub -- */

  /** What is coming to this hub — open first, the soonest first — and what it finished or was withdrawn this week. */
  forHub(mdpId: string, now: number = Date.now()): HubArrivals {
    this.mdps.require(mdpId);
    const here = [...this.arrivals.values()].filter((a) => a.mdpId === mdpId && (isOpen(a) || now - Date.parse(doneAt(a)) <= HUB_DONE_SHOWN_MS));
    const bulk = this.bulkOf(mdpId, now);
    const openingHours = this.contacts?.openingHoursOf(mdpId);
    return { ...(bulk ? { bulk } : {}), ...(openingHours ? { openingHours } : {}), arrivals: this.ordered(here).map((a) => this.viewOf(a, now, 'hub')) };
  }

  /** AT THE HUB'S DOOR: the units that came, counted, by whom, with a line of their words. Then each parcel is scanned off. */
  receive(mdpId: string, arrivalId: string, input: { units: number; note?: string }, by: string, now: number = Date.now()): HubArrivalView {
    const hub = this.mdps.working(mdpId);
    const a = this.hubArrival(mdpId, arrivalId);
    if (a.state === 'withdrawn' || a.state === 'missed') throw new GlosError('INVALID_STATE', closedWhy(a));
    if (a.state !== 'expected') throw new GlosError('INVALID_STATE', 'It was taken in at the door already');
    if (!Number.isInteger(input.units) || input.units < 1) throw new GlosError('INVALID_INPUT', 'Count the units that came: one or more', { field: 'units' });
    const at = new Date(now).toISOString();
    // UNITS BEYOND THE BOOKING (D12): charged to the store now, at the fee it booked at — or, where its balance cannot
    // carry them, not taken in: refused before anything is written, and the hub counts in only what was booked.
    const booked = a.fee?.charged.units ?? 0;
    if (a.fee && input.units > booked) {
      const more = input.units - booked;
      const amount = times(a.fee.unit.gross, more);
      const store = this.storeName(a.vendorId);
      const refused = () =>
        new GlosError('WALLET_INSUFFICIENT', `${store} booked and paid for ${unitsInWords(a.units.kind, booked)}, and cannot pay for ${more} more: take in the ${booked} it booked, and leave the rest with whoever brought them`);
      if (this.vendors.balanceOf(a.vendorId) + 1e-9 < amount) throw refused();
      const bill = this.vendors.billShipment(a.vendorId, a.arrivalId, amount, times(a.fee.unit.buffer, more), times(a.fee.unit.tax, more), times(a.fee.unit.provision, more), { kind: 'hub-receiving', note: `receiving at ${hub.name}: ${unitsInWords(a.units.kind, more)} more than booked` });
      if (!bill.paid) throw refused();
      a.fee.extra = { units: more, amount, at };
    }
    const note = input.note?.trim();
    a.state = 'receiving';
    a.received = { at, by, units: input.units, ...(note ? { note: note.slice(0, 300) } : {}) };
    if (a.fee) {
      // Booked and not counted: back to the store, at the door.
      if (input.units < booked) this.giveBack(a, booked - input.units, 'not counted at the door', now);
      // The hub's own fee for what it counted: a custody event, paid as its sort is.
      if (this.gate) {
        const amount = Math.round(a.fee.perUnit * input.units * 100) / 100;
        this.gate.receivingLabour(hub.mdpId, amount, a.arrivalId, this.mdps.entityIdOrNone(hub), this.vendors.entityIdOrNone(this.vendors.get(a.vendorId)));
        a.fee.paid = { units: input.units, amount, at };
      }
    }
    this.arrivals.set(a.arrivalId, a);
    return this.viewOf(a, now, 'hub');
  }

  /**
   * ONE PARCEL SCANNED OFF THE UNITS — by its label: the parcel id, its tracking key or its SSCC, matched against what the
   * store booked on THIS arrival only. Scanned twice, it says so and changes nothing. The last one finishes the arrival.
   */
  scan(mdpId: string, arrivalId: string, code: string, by: string, now: number = Date.now()): HubArrivalScan {
    const hub = this.mdps.working(mdpId);
    const a = this.hubArrival(mdpId, arrivalId);
    if (a.state === 'expected') throw new GlosError('INVALID_STATE', 'Count what came at the door first: take it in, then scan each parcel off it');
    if (a.state !== 'receiving') throw new GlosError('INVALID_STATE', closedWhy(a));
    const parcelId = this.match(a, code);
    if (!parcelId) throw new GlosError('NOT_FOUND', `${code.trim()} is not on this arrival: set it aside, and tell the store`);
    const parcel = this.parcels.get(parcelId);
    const destination = this.destinationOf(parcel);
    if (a.scanned.includes(parcelId)) return { arrival: this.viewOf(a, now, 'hub'), parcelId, destination, already: true };
    const store = this.storeName(a.vendorId);
    this.parcels.takeInAtHub(parcelId, hub, `handed in at ${hub.name} by ${store}${a.reference ? `, ${a.reference}` : ''} · awaiting sort`, now);
    a.scanned.push(parcelId);
    this.arrivals.set(a.arrivalId, a);
    void this.events?.publish(GlosEvent.Pudo.ParcelTakenInAtHub, { parcelId, mdpId: hub.mdpId, arrivalId: a.arrivalId }, { source: 'pudo' }).catch(() => undefined);
    // The last one booked: nothing is missing, so the arrival is done.
    if (a.scanned.length === a.parcelIds.length) this.close(a, hub, by, now);
    return { arrival: this.viewOf(a, now, 'hub'), parcelId, destination, already: false };
  }

  /** Scanning finished by hand: what was booked and not scanned did not come — it is still the store's, which is told. */
  finish(mdpId: string, arrivalId: string, by: string, now: number = Date.now()): HubArrivalView {
    const hub = this.mdps.working(mdpId);
    const a = this.hubArrival(mdpId, arrivalId);
    if (a.state !== 'receiving') throw new GlosError('INVALID_STATE', a.state === 'expected' ? 'Take it in at the door first' : closedWhy(a));
    this.close(a, hub, by, now);
    return this.viewOf(a, now, 'hub');
  }

  /**
   * IT DID NOT COME: its day is over on the hub's own clock and nothing was taken in at the door. The hub says so — not
   * before its day is over, and not of one it has begun to take in — and the arrival ends: its parcels are the store's,
   * free to book on another arrival, and the store is told. Said twice, it is the same.
   */
  missed(mdpId: string, arrivalId: string, by: string, now: number = Date.now()): HubArrivalView {
    const hub = this.mdps.working(mdpId);
    const a = this.hubArrival(mdpId, arrivalId);
    if (a.state === 'missed') return this.viewOf(a, now, 'hub');
    if (a.state === 'withdrawn') throw new GlosError('INVALID_STATE', closedWhy(a));
    if (a.state !== 'expected') throw new GlosError('INVALID_STATE', 'It was taken in at the door: scan what came, then finish it');
    const today = clockAt(now, this.clockOf(hub, now) ?? 'UTC').day;
    if (a.expectedOn >= today) throw new GlosError('INVALID_STATE', `It is due ${a.expectedOn === today ? 'today' : `on ${a.expectedOn}`}: say it did not come once its day is over`);
    a.state = 'missed';
    a.missed = { at: new Date(now).toISOString(), by };
    // Nothing came, so nothing was taken in: what the store paid for receiving goes back, all of it.
    if (a.fee) this.giveBack(a, a.fee.charged.units, 'it did not come', now);
    this.arrivals.set(a.arrivalId, a);
    void this.tellStoreMissed(a, hub);
    this.tellStoreSystem(a, hub, 'hub_arrival.missed');
    return this.viewOf(a, now, 'hub');
  }

  /**
   * D11 — THE EMPTIES GO BACK WITH THE VAN (the user, 2026-10-26: "Back with the van"): once the units are unloaded, the hub
   * counts the store's empty pallets, cages or sacks out at its door, onto the van that brought them — once, and no more than
   * came. Nothing more is tracked: no exchange of pallets, no return trip, no custody of an empty.
   */
  emptiesBack(mdpId: string, arrivalId: string, units: number, by: string, now: number = Date.now()): HubArrivalView {
    this.mdps.working(mdpId);
    const a = this.hubArrival(mdpId, arrivalId);
    if (!a.received) throw new GlosError('INVALID_STATE', a.state === 'expected' ? 'Take it in at the door first' : closedWhy(a));
    if (a.emptiesBack) throw new GlosError('INVALID_STATE', `Counted out already: ${unitsInWords(a.units.kind, a.emptiesBack.units)} went back with the van`);
    if (!Number.isInteger(units) || units < 0 || units > a.received.units) {
      throw new GlosError('INVALID_INPUT', `Count the empties that went back with the van: from none to the ${a.received.units} that came`, { field: 'units' });
    }
    a.emptiesBack = { units, at: new Date(now).toISOString(), by };
    this.arrivals.set(a.arrivalId, a);
    return this.viewOf(a, now, 'hub');
  }

  /* ---------------------------------------------------------------------------------------------- inside -- */

  private close(a: HubArrival, hub: Mdp, by: string, now: number): void {
    const missing = a.parcelIds.filter((id) => !a.scanned.includes(id));
    a.state = 'received';
    a.finished = { at: new Date(now).toISOString(), by, missing };
    this.arrivals.set(a.arrivalId, a);
    void this.tellStore(a, hub, missing);
    this.tellStoreSystem(a, hub, 'hub_arrival.received');
  }

  /** The store's bell: all of it in at the hub, or what was not on it — still with the store, to bring next time. */
  private async tellStore(a: HubArrival, hub: Mdp, missing: string[]): Promise<void> {
    if (!this.notifications) return;
    let did: string;
    try {
      did = this.vendors.get(a.vendorId).did;
    } catch {
      return;
    }
    const what = a.reference ?? unitsInWords(a.units.kind, a.units.count);
    const took = a.scanned.length;
    const title = missing.length ? `${hub.name} took in ${parcelsInWords(took)} of ${a.parcelIds.length}` : took === 1 ? `${hub.name} took in your parcel` : `${hub.name} took in all ${parcelsInWords(took)}`;
    const body = missing.length
      ? `${what}: ${parcelsInWords(missing.length)} booked on it ${missing.length === 1 ? 'was' : 'were'} not there (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}). ${missing.length === 1 ? 'It is' : 'They are'} still with you: book ${missing.length === 1 ? 'it' : 'them'} on your next arrival.`
      : `${what}: every parcel booked on it is at the hub and on its way to its sort.`;
    // What the hub saw at its door goes to the store, as a receiver's findings go to the sender (D9).
    const seen = a.received?.note ? ` At the door: “${a.received.note}”` : '';
    try {
      const empties = a.emptiesBack ? ` ${unitsInWords(a.units.kind, a.emptiesBack.units)} went back with your van.` : '';
      await this.notifications.notify(did, { kind: 'hub_arrival', title, body: `${body}${seen}${empties}${receivingLine(a)}`, link: '/vendor/', tag: `hub-arrival:${a.arrivalId}`, data: { arrivalId: a.arrivalId, mdpId: a.mdpId } });
    } catch (err) {
      this.logger.warn(`hub arrival notice failed for ${a.arrivalId}: ${(err as Error).message}`);
    }
  }

  /** The store's bell: the hub says the arrival did not come — its parcels are still the store's, to book again. */
  private async tellStoreMissed(a: HubArrival, hub: Mdp): Promise<void> {
    if (!this.notifications) return;
    let did: string;
    try {
      did = this.vendors.get(a.vendorId).did;
    } catch {
      return;
    }
    const what = a.reference ?? unitsInWords(a.units.kind, a.units.count);
    const n = a.parcelIds.length;
    try {
      await this.notifications.notify(did, {
        kind: 'hub_arrival',
        title: `${hub.name}: your arrival did not come`,
        body: `${what}, booked for ${a.expectedOn}: ${hub.name} says nothing came. ${n === 1 ? 'Its parcel is' : `Its ${parcelsInWords(n)} are`} still with you: book ${n === 1 ? 'it' : 'them'} on a new arrival.${receivingLine(a)}`,
        link: '/vendor/',
        tag: `hub-arrival:${a.arrivalId}`,
        data: { arrivalId: a.arrivalId, mdpId: a.mdpId },
      });
    } catch (err) {
      this.logger.warn(`hub arrival notice failed for ${a.arrivalId}: ${(err as Error).message}`);
    }
  }

  /**
   * THE STORE'S OWN SYSTEM hears how an arrival ended, as it hears a parcel's milestones — where the store gave an address
   * for it (VendorService.notify): which parcels the hub took in and which were not there, each with the store's own
   * order number, and what the hub saw at its door; or that it did not come. A store's system that booked the arrival
   * over the API learns the end of it the same way its people do in the bell.
   */
  private tellStoreSystem(a: HubArrival, hub: Mdp, event: 'hub_arrival.received' | 'hub_arrival.missed'): void {
    const order = (parcelId: string) => {
      try {
        const p = this.parcels.get(parcelId);
        return { parcelId, ...(p.externalOrderId ? { externalOrderId: p.externalOrderId } : {}) };
      } catch {
        return { parcelId };
      }
    };
    try {
      this.vendors.notify(a.vendorId, event, {
        arrivalId: a.arrivalId,
        hub: { mdpId: hub.mdpId, name: hub.name },
        expectedOn: a.expectedOn,
        ...(a.reference ? { reference: a.reference } : {}),
        units: { kind: a.units.kind, count: a.units.count },
        // What it paid for receiving and what came back (D12), in its own money.
        ...(a.fee ? { receiving: { currency: a.fee.unit.currency, charged: a.fee.charged.amount, ...(a.fee.extra ? { extra: a.fee.extra.amount } : {}), ...(a.fee.refunded ? { refunded: a.fee.refunded.amount } : {}) } } : {}),
        ...(event === 'hub_arrival.received'
          ? {
              takenIn: a.scanned.map(order),
              missing: (a.finished?.missing ?? []).map(order),
              ...(a.received ? { atTheDoor: { units: a.received.units, ...(a.received.note ? { note: a.received.note } : {}), ...(a.emptiesBack ? { emptiesBack: a.emptiesBack.units } : {}) } } : {}),
            }
          : { parcels: a.parcelIds.map(order) }),
      });
    } catch (err) {
      this.logger.warn(`hub arrival message to the store's system failed for ${a.arrivalId}: ${(err as Error).message}`);
    }
  }

  private hubArrival(mdpId: string, arrivalId: string): HubArrival {
    const a = this.arrivals.get(arrivalId);
    if (!a || a.mdpId !== mdpId) throw new GlosError('NOT_FOUND', 'No such arrival at this hub');
    return a;
  }

  /** The store's own parcel — or, for anybody else's, told there is none. */
  private storeParcel(vendorId: string, parcelId: string): Parcel {
    let p: Parcel | undefined;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      p = undefined;
    }
    if (!p || p.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `No parcel ${parcelId} of yours`, { field: 'parcelIds' });
    return p;
  }

  /** A scanned label, matched against this arrival's own parcels: by id, tracking key or SSCC. */
  private match(a: HubArrival, code: string): string | undefined {
    const c = code.trim();
    if (!c) return undefined;
    for (const id of a.parcelIds) {
      if (id === c) return id;
      let p: Parcel;
      try {
        p = this.parcels.get(id);
      } catch {
        continue;
      }
      if (p.trackingKey === c || (p.sscc && p.sscc === c.replace(/^\(00\)/, '').replace(/\s/g, ''))) return id;
    }
    return undefined;
  }

  /** Every parcel on an arrival not finished or withdrawn: none may be booked twice. */
  private openParcelIds(): Set<string> {
    const ids = new Set<string>();
    for (const a of this.arrivals.values()) if (isOpen(a)) for (const id of a.parcelIds) ids.add(id);
    return ids;
  }

  private ordered(list: HubArrival[]): HubArrival[] {
    return [...list].sort((x, y) => Number(isOpen(y)) - Number(isOpen(x)) || (isOpen(x) ? x.expectedOn.localeCompare(y.expectedOn) || x.createdAt.localeCompare(y.createdAt) : doneAt(y).localeCompare(doneAt(x))));
  }

  /** The hub's clock: its country's, where that country keeps one. */
  private clockOf(hub: Mdp, now: number): string | undefined {
    const clocks = clocksOfCountry(this.mdps.countryOf(hub), now);
    return clocks.length === 1 ? clocks[0] : undefined;
  }

  /**
   * THE RECEIVING FEE TO LOCK ON A BOOKING (D12): the hub's own fee for this kind of unit, in its own money, and one unit as
   * this store pays for it, in its own money. None where the hub charges nothing for the kind.
   */
  private feeFor(hub: Mdp, vendorId: string, kind: HubUnitKind, units: number, now: number): HubArrivalFee | undefined {
    const perUnit = this.bulk.get(hub.mdpId)?.fees?.[kind];
    if (!perUnit || perUnit <= 0) return undefined;
    const currency = this.mdps.currencyOf(hub);
    const unit = this.routing.receivingUnit(perUnit, currency, this.vendors.entityIdOf(this.vendors.get(vendorId)));
    return { perUnit, currency, unit, charged: { units, amount: times(unit.gross, units), at: new Date(now).toISOString() } };
  }

  /** Given back to the store: so many booked units, at what it paid for each — the mirror of the charge, tax and all. */
  private giveBack(a: HubArrival, units: number, why: string, now: number): void {
    if (!a.fee || units <= 0) return;
    const amount = times(a.fee.unit.gross, units);
    this.vendors.rebate(a.vendorId, a.arrivalId, amount, `receiving at ${this.hubName(a.mdpId)} given back: ${unitsInWords(a.units.kind, units)}, ${why}`, times(a.fee.unit.tax, units), times(a.fee.unit.provision, units));
    a.fee.refunded = { units, amount, at: new Date(now).toISOString() };
  }

  /** One unit of each kind as this store pays for it, where the hub charges for it. A kind that cannot be priced is left out. */
  private unitPricesFor(hub: Mdp, fees: Partial<Record<HubUnitKind, number>>, vendorId: string): HubUnitPrices | undefined {
    let seller: string;
    try {
      seller = this.vendors.entityIdOf(this.vendors.get(vendorId));
    } catch {
      return undefined;
    }
    const currency = this.mdps.currencyOf(hub);
    const out: HubUnitPrices = {};
    for (const kind of HUB_UNIT_KINDS) {
      const fee = fees[kind];
      if (!fee || fee <= 0) continue;
      try {
        const unit = this.routing.receivingUnit(fee, currency, seller);
        out[kind] = { gross: unit.gross, currency: unit.currency };
      } catch {
        // No rate between the two moneys yet: the booking would say so.
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  private bulkView(hub: Mdp, b: HubBulk, now: number, vendorId?: string): HubBulkView {
    const zone = this.clockOf(hub, now);
    const receiving = vendorId && b.fees ? this.unitPricesFor(hub, b.fees, vendorId) : undefined;
    return {
      mdpId: hub.mdpId,
      name: hub.name,
      location: { lat: hub.location.lat, lng: hub.location.lng },
      ...(hub.address ? { address: hub.address } : {}),
      ...(b.hours ? { hours: b.hours } : {}),
      ...(b.doors ? { doors: b.doors } : {}),
      ...(zone ? { zone, zoneName: zoneName(zone, now) } : {}),
      since: b.since,
      ...this.reachOf(hub.mdpId, now),
      // What it charges to take in each kind of unit (D12): its own, public; and, read by a store, what a unit costs it.
      ...(b.fees && Object.keys(b.fees).length ? { fees: b.fees, feeCurrency: this.mdps.currencyOf(hub) } : {}),
      ...(receiving ? { receiving } : {}),
    };
  }

  /** When the hub is open and how a store bringing it parcels reaches it — from the hub's own entry, where it wrote one. */
  private reachOf(mdpId: string, now: number): Pick<HubBulkView, 'openingHours' | 'openNow' | 'phone' | 'askFor' | 'gate' | 'handle'> {
    const s = this.contacts?.atStop(mdpId, now);
    if (!s) return {};
    return {
      ...(s.openingHours ? { openingHours: s.openingHours } : {}),
      ...(s.openNow ? { openNow: s.openNow } : {}),
      ...(s.phone ? { phone: s.phone } : {}),
      ...(s.askFor ? { askFor: s.askFor } : {}),
      ...(s.gate ? { gate: s.gate } : {}),
      ...(s.handle ? { handle: s.handle } : {}),
    };
  }

  /** The receiving fee as its reader may read it (D12): the hub's own fee for a unit; the store's money to the store; the hub's pay to the hub. */
  private feeView(f: HubArrivalFee, reader: 'hub' | 'store'): HubArrivalFeeView {
    if (reader === 'hub') return { perUnit: f.perUnit, currency: f.currency, ...(f.paid ? { paid: f.paid.amount, paidUnits: f.paid.units } : {}) };
    return {
      perUnit: f.perUnit,
      currency: f.currency,
      storeCurrency: f.unit.currency,
      unitGross: f.unit.gross,
      charged: f.charged.amount,
      chargedUnits: f.charged.units,
      ...(f.extra ? { extra: f.extra.amount, extraUnits: f.extra.units } : {}),
      ...(f.refunded ? { refunded: f.refunded.amount, refundedUnits: f.refunded.units } : {}),
    };
  }

  private viewOf(a: HubArrival, now: number, reader: 'hub' | 'store'): HubArrivalView {
    let hub: Mdp | undefined;
    try {
      hub = this.mdps.require(a.mdpId);
    } catch {
      hub = undefined;
    }
    const zone = hub ? this.clockOf(hub, now) : undefined;
    const today = clockAt(now, zone ?? 'UTC').day;
    const open = isOpen(a);
    return {
      arrivalId: a.arrivalId,
      mdpId: a.mdpId,
      hubName: hub?.name ?? a.mdpId,
      vendorId: a.vendorId,
      storeName: this.storeName(a.vendorId),
      parcels: a.parcelIds.map((id) => {
        try {
          return this.parcelOf(this.parcels.get(id), a.scanned.includes(id));
        } catch {
          return { parcelId: id, destination: '—', scanned: a.scanned.includes(id) };
        }
      }),
      unitKind: a.units.kind,
      units: a.units.count,
      expectedOn: a.expectedOn,
      ...(a.reference ? { reference: a.reference } : {}),
      ...(a.bringer ? { bringer: a.bringer } : {}),
      state: a.state,
      createdAt: a.createdAt,
      ...(a.received ? { received: a.received } : {}),
      scannedCount: a.scanned.length,
      ...(a.finished ? { finished: a.finished } : {}),
      ...(a.withdrawn ? { withdrawn: a.withdrawn } : {}),
      ...(a.missed ? { missed: a.missed } : {}),
      ...(a.fee ? { fee: this.feeView(a.fee, reader) } : {}),
      ...(a.emptiesBack ? { emptiesBack: a.emptiesBack } : {}),
      // On the hub's own clock (D10): due today there, or its day gone with nothing taken in at the door.
      ...(open ? { today: a.expectedOn === today, late: a.state === 'expected' && a.expectedOn < today } : {}),
    };
  }

  private parcelOf(p: Parcel, scanned: boolean): HubArrivalParcel {
    return {
      parcelId: p.parcelId,
      ...(p.trackingKey ? { trackingKey: p.trackingKey } : {}),
      ...(p.sscc ? { sscc: p.sscc } : {}),
      destination: this.destinationOf(p),
      scanned,
      ...(p.status === 'Voided' ? { withdrawn: true } : {}),
    };
  }

  private destinationOf(p: Parcel): string {
    try {
      return p.destAgentDid ? this.agents.get(p.destAgentDid).shopName : p.destZone;
    } catch {
      return p.destZone;
    }
  }

  private storeName(vendorId: string): string {
    try {
      return this.vendors.get(vendorId).name;
    } catch {
      return 'the store';
    }
  }

  private hubName(mdpId: string): string {
    try {
      return this.mdps.require(mdpId).name;
    } catch {
      return mdpId;
    }
  }
}

function isOpen(a: HubArrival): boolean {
  return a.state === 'expected' || a.state === 'receiving';
}

function doneAt(a: HubArrival): string {
  return a.finished?.at ?? a.withdrawn?.at ?? a.missed?.at ?? a.received?.at ?? a.createdAt;
}

/** Why an arrival is closed to the floor, in words the hub can act on. */
function closedWhy(a: HubArrival): string {
  if (a.state === 'withdrawn') return 'The store withdrew it: it is not coming';
  if (a.state === 'missed') return 'It was said not to have come: the store books its parcels on a new arrival';
  return 'Scanning of it is finished';
}

/** Minutes past midnight as a clock says them: 1080 → "18:00". */
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** So many of one amount, to the cent: every receiving charge and return is so many units (D12). */
const times = (each: number, n: number) => Math.round(each * n * 100) / 100;

/** "KES 354.96" — a sum as a refusal or a notice says it. */
const money = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;

/** What a store paid for receiving and what came back, as its bell says it (D12). Nothing where the hub charged nothing. */
function receivingLine(a: HubArrival): string {
  const f = a.fee;
  if (!f) return '';
  const paid = Math.round((f.charged.amount + (f.extra?.amount ?? 0)) * 100) / 100;
  const back = f.refunded ? ` ${money(f.refunded.amount, f.unit.currency)} of it given back: ${unitsInWords(a.units.kind, f.refunded.units)}.` : '';
  return ` Receiving: ${money(paid, f.unit.currency)} paid.${back}`;
}

/**
 * WHAT A HUB CHARGES TO TAKE IN EACH KIND OF UNIT, as it wrote it (D12): known kinds only; a sum of money, 0 or more, to
 * the cent; 0 or null leaves the kind free. Nothing at all where it charges for none.
 */
function feesOf(raw: Record<string, number | null>): Partial<Record<HubUnitKind, number>> | undefined {
  const out: Partial<Record<HubUnitKind, number>> = {};
  for (const [kind, value] of Object.entries(raw)) {
    if (!(HUB_UNIT_KINDS as readonly string[]).includes(kind)) throw new GlosError('INVALID_INPUT', `${kind} is not a kind of unit: pallet, carton, cage or sack`, { field: 'fees' });
    if (value === null || value === 0) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) throw new GlosError('INVALID_INPUT', 'A fee is a sum of money: 0 or more', { field: 'fees' });
    out[kind as HubUnitKind] = Math.round(value * 100) / 100;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The weekday key of a day (YYYY-MM-DD): sun … sat. */
function weekdayOf(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

/** The day `n` days after `day`, both YYYY-MM-DD. */
function dayAfter(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
