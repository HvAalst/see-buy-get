import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { FundingService } from '../../foundation/funding/funding.service';
import type { FundingPurpose } from '../../foundation/funding/funding.types';
import { maskMsisdn, normaliseMsisdn } from '../../foundation/funding/mpesa-funding-rail.adapter';
import { GlosError } from '../../foundation/http/glos-error';
import { isPlausiblePhone } from '../../foundation/identity/phone';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isFor } from './addressed-to';
import { AgentService } from './agent.service';
import { CallOffService } from './call-off.service';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { haversineKm } from './geo';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import { DOOR_LOAD_REMIND_H, DOOR_MAX_KM, DOOR_PAY_WINDOW_MIN } from './pudo.config';
import { DoorPreview, DoorRequest, DoorView } from './person-door.types';
import type { Parcel } from './pudo.types';
import { RoutingService } from './routing.service';
import { ToteService } from './tote.service';
import { AddressSearchService } from './geocoder';

/** A country's name in English, from its ISO code — the code itself where the runtime has no name for it. */
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The money a person's load to their door is in, where it is paid in whole units: what goes back is rounded up, in their favour. */
const WHOLE_UNITS = new Set(['KES', 'UGX', 'TZS', 'RWF', 'BIF']);

/**
 * A PERSON'S OWN DOOR, PAID FIRST BY MOBILE MONEY (the user, 2026-10-27: "Mobile money first" — see person-door.types.ts).
 *
 * The money model refuses to keep consumers' funds (wallet-gate.service.ts). This keeps none: what a person pays is held
 * for ONE load — DEPOSIT_PERSON, theirs, per person — billed only for that load when a driver takes it, and what it did not
 * use moves to PAYABLE_PERSON at once, for the payout run to send back to the number it came from. There is no balance to
 * spend, top up or look at; and nothing of the person goes on the load or the parcel — the load carries no shipper id, and
 * who paid is kept here, beside it.
 *
 * In order, each step refused before anything is written where it cannot be done:
 *   1. ask — the box is held at the hub, out of any bag, and M-Pesa asks them for the most they allow (DOOR_PAY_WINDOW_MIN);
 *   2. paid — a payment rail calls `paid`: the money is posted, then the load from the hub to their door; the hub keeps the
 *      box aside and hands it only to the driver who takes it, by their pass;
 *   3. taken — the driver's price, gross, is billed out of what was paid (dispatch's PrepaidShipper);
 *   4. delivered — the rest is owed back. Or: the time ran out — the box goes to the shop as it would have, nothing paid;
 *      or no driver yet — they send it to the shop instead and all of it is owed back.
 */
@Injectable()
export class PersonDoorService implements OnModuleInit {
  private readonly logger = new Logger(PersonDoorService.name);
  private readonly requests = new PersistentMap<string, DoorRequest>('person-door-requests');

  constructor(
    private readonly parcels: ParcelService,
    private readonly dispatch: DispatchService,
    private readonly callOffs: CallOffService,
    private readonly mdps: MdpService,
    private readonly routing: RoutingService,
    private readonly totes: ToteService,
    private readonly persons: PersonService,
    private readonly funding: FundingService,
    private readonly books: BooksService,
    private readonly entities: EntityService,
    private readonly payouts: PayoutService,
    private readonly agents: AgentService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly events?: EventBus,
    // Which country a door's pin is in (the user, 2026-10-27: "Look up the pin's country").
    @Optional() private readonly places?: AddressSearchService,
  ) {}

  onModuleInit(): void {
    // Billed, and given back, out of what they paid — never a balance.
    this.dispatch.registerPrepaid({
      owns: (f) => Boolean(this.byFreight(f.freightId)),
      bill: (f, bill) => this.bill(f, bill),
      giveBack: (f, charged, why) => this.giveBack(f, charged, why),
    });
    // What goes back goes to the number it came from — kept here, not in a payee's payout number.
    this.payouts.registerDestinations({
      of: (payeeId) => this.refundDestination(payeeId),
      full: (payeeId, numberId) => this.refundNumber(payeeId, numberId),
    });
    this.events?.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightDelivered, (e) => this.delivered(e.payload.freightId));
  }

  /* ------------------------------------------------------------------ asking -- */

  /** What bringing it to their door would be — or why not. With `to`, the most to allow, suggested. Nothing is written. */
  async preview(personDid: string, parcelId: string, to?: { lat: number; lng: number }): Promise<DoorPreview> {
    const p = this.theirs(personDid, parcelId);
    const why = this.whyNot(p, personDid);
    if (why) return { outcome: 'no', why };
    const hub = this.mdps.require(p.atMdpId!);
    const { entityId, currency } = this.sellerOf(hub.mdpId);
    if (!to) return { outcome: 'door', atHub: hub.name, currency, maxKm: DOOR_MAX_KM };
    const far = await this.whereNot(hub.mdpId, hub.name, to, p);
    if (far) return { outcome: 'no', why: far };
    const end = this.routing.hubEnd(hub.mdpId);
    const suggestedMax = this.dispatch.doorGuide({ from: end.location, to, weightKg: p.weightKg, fragile: p.fragile ?? false, shipperDid: '', sellerEntityId: entityId }).suggestedMax;
    return { outcome: 'door', suggestedMax, currency, atHub: hub.name, maxKm: DOOR_MAX_KM };
  }

  /**
   * ASK FOR IT (step 1): the box is held at the hub, out of any bag it was sorted into, and M-Pesa asks them for the most
   * they allow. Refused before anything is held or asked where it cannot be done.
   */
  async request(personDid: string, parcelId: string, input: { to: { lat: number; lng: number }; label: string; maxSpend: number; phone: string }, now: number = Date.now()): Promise<DoorView> {
    const p = this.theirs(personDid, parcelId);
    const why = this.whyNot(p, personDid);
    if (why) throw new GlosError('INVALID_STATE', why);
    const hub = this.mdps.require(p.atMdpId!);
    const far = await this.whereNot(hub.mdpId, hub.name, input.to, p);
    if (far) throw new GlosError('INVALID_INPUT', far, { field: 'location' });
    const label = String(input.label ?? '').trim();
    if (label.length < 2) throw new GlosError('FIELD_REQUIRED', 'Say where your door is — a street, a gate, a landmark a driver can find', { field: 'label' });
    const most = Math.ceil(Number(input.maxSpend));
    if (!Number.isFinite(most) || most < 1) throw new GlosError('FIELD_REQUIRED', 'Say the most you allow a driver', { field: 'maxSpend' });
    const phone = String(input.phone ?? '').trim();
    if (!isPlausiblePhone(phone)) throw new GlosError('PHONE_INVALID', 'Enter the number you pay from — the driver calls it at your door', { field: 'phone' });
    const bag = p.toteId ? this.totes.list().find((t) => t.toteId === p.toteId) : undefined;
    if (bag?.status === 'in_transit') throw new GlosError('INVALID_STATE', 'Its bag has left the hub: it comes to the shop.');
    const { entityId, currency } = this.sellerOf(hub.mdpId);
    const until = now + DOOR_PAY_WINDOW_MIN * 60_000;
    const req: DoorRequest = {
      requestId: `door_${randomBytes(6).toString('hex')}`,
      personDid,
      parcelId: p.parcelId,
      mdpId: hub.mdpId,
      hubName: hub.name,
      entityId,
      currency,
      to: { lat: Number(input.to.lat), lng: Number(input.to.lng) },
      label,
      maxSpend: most,
      phone,
      phoneMasked: maskMsisdn(normaliseMsisdn(phone) ?? phone),
      state: 'awaiting',
      openedAt: new Date(now).toISOString(),
      until: new Date(until).toISOString(),
      shopName: this.shopNameOf(p),
    };
    // Kept first: the payment rail asks whose payment this is (`resolve`) before it opens the request.
    this.requests.set(req.requestId, req);
    let opened;
    try {
      opened = await this.funding.open({ payerKind: 'person', payerDid: personDid, purpose: 'door', amount: most, payerPhone: phone }, now);
    } catch (err) {
      this.requests.delete(req.requestId);
      throw err;
    }
    req.fundingId = opened.fundingId;
    req.reference = opened.reference;
    req.instructions = opened.instructions;
    req.pushed = opened.pushed;
    this.requests.set(req.requestId, req);
    // Held at the hub meanwhile — out of a bag still being filled, which would otherwise take it to the shop.
    if (bag?.parcels.includes(p.parcelId)) this.totes.takeOut(bag.code, p.parcelId, p.size);
    this.parcels.holdForDoor(p.parcelId, until, hub.name, now);
    const outOfBag = bag ? ` Take it out of bag ${bag.code}.` : '';
    this.tellHub(hub.mdpId, `${p.parcelId}: set it aside`, `Its sender is paying for a load to their door, until ${req.until.slice(11, 16)} UTC.${outOfBag} If they have not paid by then, sort it as its label says.`, p.parcelId);
    return this.viewOf(req);
  }

  /** The person gives up the door: while they are still to pay, at once; with a load no driver has taken, to the shop instead. */
  cancel(personDid: string, parcelId: string, now: number = Date.now()): DoorView {
    const req = this.latestFor(personDid, parcelId);
    if (!req) throw new GlosError('NOT_FOUND', 'Nothing is coming to your door for this parcel');
    if (req.state === 'awaiting') {
      this.lapse(req, 'given up', now);
      return this.viewOf(req);
    }
    if (req.state === 'posted') return this.toShop(req, now);
    throw new GlosError('INVALID_STATE', req.state === 'taken' ? `A driver has taken load ${req.loadCode}: it comes to your door.` : 'It cannot be changed now.');
  }

  /** Their load to their door for this parcel, as the Send app reads it — or nothing. */
  viewFor(personDid: string, parcelId: string): DoorView | undefined {
    const req = this.latestFor(personDid, parcelId);
    return req ? this.viewOf(req) : undefined;
  }

  /* -------------------------------------------------------- the payment rail -- */

  /** Whose payment this is about to be asked for, and in which company's money (FundingPayer.resolve). */
  resolvePayer(personDid: string): { entityId: string; currency: string; label: string } {
    const req = [...this.requests.values()].filter((r) => r.personDid === personDid && r.state === 'awaiting').sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
    if (!req) throw new GlosError('INVALID_STATE', 'Nothing is waiting for this payment');
    return { entityId: req.entityId, currency: req.currency, label: 'Send app: a load to a door' };
  }

  /**
   * PAID (step 2). A PAYMENT RAIL CALLS THIS — FundingService.confirm, from a signed provider callback or a member of staff
   * naming a statement line, and nothing else (money-in.spec). The money is posted first, always: it arrived. Then the load —
   * or, where it can no longer go (the time ran out, a second payment, the box moved), all of it is owed back.
   */
  paid(personDid: string, c: { purpose: FundingPurpose; gross: number; fee: number; reference: string; fundingId: string }, now: number = Date.now()): { entryId: string } {
    const funding = this.funding.get(c.fundingId);
    const gross = round2(c.gross);
    const fee = round2(c.fee);
    const entry = this.books.post({
      entityId: funding.entityId,
      kind: 'door-prepayment',
      ref: c.reference,
      currency: funding.currency,
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: round2(gross - fee) },
        ...(fee > 0 ? [{ code: ACCOUNT_CODES.EXPENSE_PAYMENT_FEES, amount: fee }] : []),
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: personDid, amount: -gross },
      ],
    });
    const req = [...this.requests.values()].find((r) => r.fundingId === c.fundingId);
    if (req && req.state === 'awaiting') {
      try {
        this.postLoad(req, gross, now);
        return { entryId: entry.entryId };
      } catch (err) {
        this.logger.warn(`door load not posted for ${req.parcelId}: ${(err as Error).message}`);
        // Paid, but it can no longer go: the refund below is what they are told, not that no payment came.
        this.lapse(req, 'it could not be posted', now, false);
      }
    }
    // Arrived after the time ran out, a second time, or with no load to pay for: all of it goes back.
    this.owe(personDid, funding.entityId, funding.currency, gross, `paid for no load (${c.reference})`, req, now);
    this.tell(personDid, 'Your payment goes back to you', `${this.money(gross, funding.currency)} came in with nothing waiting for it — it goes back to your number with the next payout.`, req?.parcelId);
    return { entryId: entry.entryId };
  }

  /** The rail took the payment back. Its mirror is posted; a load nobody has taken yet is withdrawn and the box goes to the shop. */
  reversed(personDid: string, c: { purpose: FundingPurpose; gross: number; fee: number; reference: string; fundingId: string }, now: number = Date.now()): { entryId: string } {
    const funding = this.funding.get(c.fundingId);
    const req = [...this.requests.values()].find((r) => r.fundingId === c.fundingId);
    if (req?.state === 'posted') {
      try {
        this.toShop(req, now, false);
      } catch (err) {
        this.logger.warn(`door load ${req.loadCode} not withdrawn after a reversal: ${(err as Error).message}`);
      }
    }
    const entry = this.books.post({
      entityId: funding.entityId,
      kind: 'door-prepayment-reversal',
      ref: c.reference,
      currency: funding.currency,
      lines: [
        // From what was owed back where it was sent there (to_shop), else from what was held: the money left the way it came.
        { code: req?.state === 'to_shop' ? ACCOUNT_CODES.PAYABLE_PERSON : ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: personDid, amount: round2(c.gross) },
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -round2(c.gross) },
      ],
    });
    if (req) {
      if (req.state === 'taken') this.logger.warn(`door load ${req.loadCode}: the payment was taken back after a driver took it — what it paid is now owed by the sender`);
      if (req.state === 'to_shop') req.owedBack = 0;
      req.state = req.state === 'taken' || req.state === 'delivered' ? req.state : 'reversed';
      this.requests.set(req.requestId, req);
    }
    return { entryId: entry.entryId };
  }

  /* -------------------------------------------------------- dispatch, billed -- */

  /** The driver's price, gross, out of what they paid (step 3): a sale of carriage, invoiced as one. */
  private bill(f: Freight, bill: { gross: number; tax: number; provision: number }): boolean {
    const req = this.byFreight(f.freightId);
    if (!req || req.paid == null || bill.gross > req.paid + 1e-9) return false;
    this.books.post({
      entityId: req.entityId,
      kind: 'shipping',
      ref: f.freightId,
      currency: req.currency,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: req.personDid, amount: round2(bill.gross) },
        { code: ACCOUNT_CODES.REVENUE, amount: -round2(bill.gross - bill.tax - bill.provision) },
        ...(bill.tax > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: -round2(bill.tax) }] : []),
        ...(bill.provision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: -round2(bill.provision) }] : []),
      ],
    });
    req.billed = round2(bill.gross);
    req.state = 'taken';
    this.requests.set(req.requestId, req);
    this.tell(req.personDid, 'A driver is bringing it to your door', `Load ${req.loadCode} was taken for ${this.money(req.billed, req.currency)}. What is left of what you paid goes back to your number once it is delivered.`, req.parcelId);
    return true;
  }

  /** The bill given back, exactly — the driver gave the load back, or it went back on the board. */
  private giveBack(f: Freight, charged: { gross: number; tax: number; provision: number }, why: string): void {
    const req = this.byFreight(f.freightId);
    if (!req) return;
    this.books.post({
      entityId: req.entityId,
      kind: 'rebate',
      ref: f.freightId,
      currency: req.currency,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: req.personDid, amount: -round2(charged.gross) },
        { code: ACCOUNT_CODES.REVENUE, amount: round2(charged.gross - charged.tax - charged.provision) },
        ...(charged.tax > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: round2(charged.tax) }] : []),
        ...(charged.provision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: round2(charged.provision) }] : []),
      ],
    });
    req.billed = undefined;
    if (req.state === 'taken') req.state = 'posted';
    this.requests.set(req.requestId, req);
    this.logger.log(`door load ${req.loadCode}: bill given back (${why})`);
  }

  /** Delivered at their door (step 4): what the load did not use is owed back. */
  private delivered(freightId: string, now: number = Date.now()): void {
    const req = this.byFreight(freightId);
    if (!req || req.state === 'delivered') return;
    const rest = round2((req.paid ?? 0) - (req.billed ?? 0));
    req.state = 'delivered';
    req.closedAt = new Date(now).toISOString();
    this.requests.set(req.requestId, req);
    if (rest > 0) this.owe(req.personDid, req.entityId, req.currency, rest, `unused, load ${req.loadCode}`, req, now);
    const back = req.owedBack ? ` ${this.money(req.owedBack, req.currency)} goes back to your number ending ${req.phoneMasked.slice(-3)} with the next payout.` : '';
    this.tell(req.personDid, 'Delivered at your door', `Load ${req.loadCode} brought parcel ${req.parcelId} to ${req.label}.${back}`, req.parcelId);
  }

  /* ------------------------------------------------------------- the sweep -- */

  /**
   * Every minute (PersonDoorSweeper): a payment that did not come in time lets the box go on to the shop; a load no driver
   * has taken in DOOR_LOAD_REMIND_H is told to its sender, once; and a number nothing is owed back to any more is forgotten.
   */
  sweep(now: number = Date.now()): { lapsed: string[]; reminded: string[] } {
    const lapsed: string[] = [];
    const reminded: string[] = [];
    for (const req of [...this.requests.values()]) {
      if (req.state === 'awaiting' && Date.parse(req.until) <= now) {
        this.lapse(req, 'the time to pay ran out', now);
        lapsed.push(req.requestId);
        continue;
      }
      if (req.state === 'posted' && !req.remindedAt && req.paidAt && now - Date.parse(req.paidAt) >= DOOR_LOAD_REMIND_H * 3_600_000) {
        req.remindedAt = new Date(now).toISOString();
        this.requests.set(req.requestId, req);
        if (req.freightId) this.dispatch.markBringsBackReminded(req.freightId, now);
        reminded.push(req.requestId);
        this.tell(req.personDid, `No driver has taken load ${req.loadCode} yet`, `You can send it to ${req.shopName ?? 'the shop'} instead — all you paid comes back — or keep waiting.`, req.parcelId);
      }
      if (req.phone && ['delivered', 'lapsed', 'to_shop', 'reversed'].includes(req.state) && this.owedTo(req) <= 0) {
        req.phone = '';
        this.requests.set(req.requestId, req);
      }
    }
    return { lapsed, reminded };
  }

  /* --------------------------------------------------------- the payout run -- */

  /** Where what a person is owed back goes: the number they paid from, while one is kept. Nothing for anybody else. */
  private refundDestination(payeeId: string): { numberId: string; masked: string } | undefined {
    const req = [...this.requests.values()].filter((r) => r.personDid === payeeId && r.phone).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
    return req ? { numberId: `door:${req.requestId}`, masked: req.phoneMasked } : undefined;
  }

  private refundNumber(payeeId: string, numberId: string): string | undefined {
    if (!numberId.startsWith('door:')) return undefined;
    const req = this.requests.get(numberId.slice('door:'.length));
    return req && req.personDid === payeeId && req.phone ? (normaliseMsisdn(req.phone) ?? req.phone) : undefined;
  }

  /* -------------------------------------------------------------- inside -- */

  /** Post the load to their door, the box closed as going there, the hub told. Checks first, then writes. */
  private postLoad(req: DoorRequest, paid: number, now: number): void {
    const p = this.parcels.get(req.parcelId);
    if (p.status !== 'At_MDP' || p.atMdpId !== req.mdpId) throw new GlosError('INVALID_STATE', `${p.parcelId} is no longer at ${req.hubName}`);
    const end = this.routing.hubEnd(req.mdpId);
    const load = this.dispatch.registerFreight(
      {
        description: `Parcel ${p.parcelId}, back to its sender's door`,
        pickupLocation: end.location,
        pickupLabel: req.hubName,
        destLabel: req.label,
        destLocation: req.to,
        weightKg: p.weightKg,
        fragile: p.fragile,
        packaging: 'piece',
        packages: 1,
        natureCode: p.natureCode,
        ...(p.dimensionsCm ? { dimensionsCm: [p.dimensionsCm.l, p.dimensionsCm.w, p.dimensionsCm.h] as [number, number, number] } : {}),
        // Nobody's id on the load: whose it is stays here. The company that sells it prices it.
        sellerEntityId: req.entityId,
        pickupCountry: end.country,
        destCountry: end.country,
        maxSpend: paid,
        contactName: 'The sender',
        contactPhone: req.phone,
        bringsBack: { parcelId: p.parcelId, atMdpId: req.mdpId, hubName: req.hubName },
      },
      now,
    );
    // Kept before anything can take the load: a driver who takes it is billed through here (PrepaidShipper.owns).
    req.state = 'posted';
    req.paid = paid;
    req.paidAt = new Date(now).toISOString();
    req.freightId = load.freightId;
    req.loadCode = load.code;
    this.requests.set(req.requestId, req);
    this.parcels.closeAsGoingHome(p.parcelId, { freightId: load.freightId, code: load.code }, req.hubName, 'its sender', `paid by mobile money`, now);
    this.tellHub(req.mdpId, `${p.parcelId}: to its sender's door`, `Its sender paid: it goes to their door as load ${load.code}. Keep it aside, and hand it only to the driver who comes for ${load.code}: scan their pass at the counter.`, p.parcelId);
    this.tell(req.personDid, 'Paid: a driver brings it to your door', `${this.money(paid, req.currency)} came in. Load ${load.code} brings parcel ${p.parcelId} from ${req.hubName} to ${req.label}. What the driver charges less than this goes back to your number.`, p.parcelId);
  }

  /** The time ran out, or they gave up before paying: the box goes on to the shop, as it would have. */
  private lapse(req: DoorRequest, why: string, now: number, tellPerson = true): void {
    req.state = 'lapsed';
    req.closedAt = new Date(now).toISOString();
    this.requests.set(req.requestId, req);
    if (req.fundingId) {
      try {
        if (this.funding.get(req.fundingId).status === 'awaiting') this.funding.expire(req.fundingId, why, now);
      } catch (err) {
        this.logger.warn(`door payment ${req.fundingId} not closed: ${(err as Error).message}`);
      }
    }
    this.parcels.releaseDoorHold(req.parcelId, `its sender's payment for a load to their door: ${why}`, now);
    this.tellHub(req.mdpId, `${req.parcelId}: sort it`, `No payment came for a load to its sender's door (${why}). Sort it as its label says.`, req.parcelId);
    if (tellPerson) this.tell(req.personDid, 'It comes to the shop', `No payment came for a load to your door (${why}). Parcel ${req.parcelId} comes to ${req.shopName ?? 'the shop'} as before: collect it there with its code.`, req.parcelId);
  }

  /** No driver has taken the load: the box goes to the shop instead — the parcel first, then the load — and all of it is owed back. */
  private toShop(req: DoorRequest, now: number, told = true): DoorView {
    if (!req.freightId) throw new GlosError('INVALID_STATE', 'No load is posted for it');
    const load = this.dispatch.requireFreightPublic(req.freightId);
    if (load.status !== 'available') throw new GlosError('INVALID_STATE', `A driver has taken load ${load.code}: it comes to your door.`);
    const p = this.parcels.get(req.parcelId);
    const way = this.callOffs.wayToShopFor(p, p.destAgentDid ?? '');
    if ('why' in way) throw new GlosError('INVALID_STATE', way.why);
    const { back } = this.parcels.rerouteForSender(p.parcelId, { quote: way.quote, hub: { mdpId: way.hub.mdpId, name: way.hub.name, zone: this.routing.hubEnd(way.hub.mdpId).zone }, toAgentDid: way.shop.did, by: 'its sender' }, now);
    this.dispatch.withdrawPrepaid(req.freightId, 'Sent to the shop instead', now);
    req.state = 'to_shop';
    req.closedAt = new Date(now).toISOString();
    req.shopName = way.shop.shopName;
    req.shopParcelId = back.parcelId;
    this.requests.set(req.requestId, req);
    this.owe(req.personDid, req.entityId, req.currency, round2((req.paid ?? 0) - (req.billed ?? 0)), `load ${req.loadCode} withdrawn, sent to the shop`, req, now);
    this.tellHub(req.mdpId, `${p.parcelId}: a new label`, `Its load to its sender's door (${req.loadCode}) is withdrawn: it goes to ${way.shop.shopName} as ${back.parcelId}. Print its new label, put it over the old one, then sort ${back.parcelId}.`, p.parcelId);
    if (told) this.tell(req.personDid, `It goes to ${way.shop.shopName} instead`, `As parcel ${back.parcelId}: you pay ${this.money(way.price, way.quote.currency)} in cash there as you collect it. ${this.money(req.owedBack ?? 0, req.currency)} goes back to your number with the next payout.`, back.parcelId);
    return this.viewOf(req);
  }

  /** What a person is owed back, moved from what was held — rounded up to the whole unit where it is paid in whole units. */
  private owe(personDid: string, entityId: string, currency: string, amount: number, why: string, req: DoorRequest | undefined, now: number): void {
    const exact = round2(amount);
    if (exact <= 0) return;
    const owed = WHOLE_UNITS.has(currency.toUpperCase()) ? Math.ceil(exact - 1e-9) : exact;
    const given = round2(owed - exact);
    this.books.post({
      entityId,
      kind: 'door-unused',
      ref: req?.requestId ?? `door:${personDid}`,
      currency,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: personDid, amount: exact },
        // Rounded up in their favour: the few cents are ours to give, never theirs to lose.
        ...(given > 0 ? [{ code: ACCOUNT_CODES.REVENUE, amount: given }] : []),
        { code: ACCOUNT_CODES.PAYABLE_PERSON, counterparty: personDid, amount: -owed },
      ],
    });
    if (req) {
      req.owedBack = round2((req.owedBack ?? 0) + owed);
      this.requests.set(req.requestId, req);
    }
    this.logger.log(`owed back to a person: ${owed} ${currency} (${why}) at ${new Date(now).toISOString()}`);
  }

  /** What is still owed back to this request's person, across their door loads, in its company. */
  private owedTo(req: DoorRequest): number {
    return -this.books.balance(req.entityId, ACCOUNT_CODES.PAYABLE_PERSON, req.currency, req.personDid);
  }

  /** The person's goods coming back to them: theirs to read, or a parcel they cannot tell from none. */
  private theirs(personDid: string, parcelId: string): Parcel {
    const person = this.persons.requireByDid(personDid);
    let p: Parcel;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      throw new GlosError('NOT_FOUND', `No parcel ${parcelId} of yours`);
    }
    if (!isFor(this.parcels.receiverOf(p), { phoneHash: person.phoneHash, personDid })) throw new GlosError('NOT_FOUND', `No parcel ${parcelId} of yours`);
    return p;
  }

  /** Why their door is not on offer for these goods — or nothing. */
  private whyNot(p: Parcel, personDid: string): string | undefined {
    if (p.vendorId || !p.returnOf) return 'Only goods coming back to you from a hub can come to your door.';
    if (p.held) return 'It is held: operations decide what happens to it first.';
    if (p.status !== 'At_MDP' || !p.atMdpId) return p.returnLoad ? 'It is coming to your door already.' : 'It has left the hub: it comes to the shop.';
    if (p.payAtCollection?.paidAt) return 'It was paid for already.';
    const open = [...this.requests.values()].find((r) => r.personDid === personDid && r.state === 'awaiting');
    if (open) return open.parcelId === p.parcelId ? 'You are paying for its door already: approve it on your phone.' : 'Pay for the door delivery you asked for first, or let it lapse.';
    return undefined;
  }

  /**
   * WHERE A DOOR CANNOT BE (the user, 2026-10-27: "Look up the pin's country"): in another country than the hub — the map
   * service says which country the pin is in, and a driver brings it only within the hub's. Where the service cannot say (none
   * set, out of reach, the sea), the older rule stands: no further than DOOR_MAX_KM from the hub.
   */
  private async whereNot(mdpId: string, hubName: string, to: { lat: number; lng: number }, p: Parcel): Promise<string | undefined> {
    const end = this.routing.hubEnd(mdpId);
    if (!Number.isFinite(Number(to?.lat)) || !Number.isFinite(Number(to?.lng))) return 'Put your door on the map';
    const country = await this.places?.countryAt({ lat: Number(to.lat), lng: Number(to.lng) });
    if (country) {
      const home = String(end.country ?? '').toUpperCase();
      return country === home ? undefined : `Your door is in ${countryName(country)}, and ${hubName} is in ${countryName(home)}: a driver brings it only within ${countryName(home)}. Collect it at ${this.shopNameOf(p) ?? 'the shop'} instead.`;
    }
    return haversineKm(end.location, { lat: Number(to.lat), lng: Number(to.lng) }) > DOOR_MAX_KM ? `A door delivery goes no further than ${DOOR_MAX_KM} km from ${hubName}: collect it at ${this.shopNameOf(p) ?? 'the shop'} instead.` : undefined;
  }

  /** The network's company in the country the hub is in, and its money: what sells the carriage. */
  private sellerOf(mdpId: string): { entityId: string; currency: string } {
    const end = this.routing.hubEnd(mdpId);
    const entity = this.entities.requireForJurisdiction(end.country);
    return { entityId: entity.entityId, currency: entity.currency ?? '' };
  }

  private shopNameOf(p: Parcel): string | undefined {
    try {
      return p.destAgentDid ? this.agents.get(p.destAgentDid).shopName : undefined;
    } catch {
      return undefined;
    }
  }

  private byFreight(freightId: string): DoorRequest | undefined {
    return [...this.requests.values()].find((r) => r.freightId === freightId);
  }

  private latestFor(personDid: string, parcelId: string): DoorRequest | undefined {
    return [...this.requests.values()].filter((r) => r.personDid === personDid && r.parcelId === parcelId).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
  }

  private viewOf(req: DoorRequest): DoorView {
    let canSendToShop = false;
    if (req.state === 'posted' && req.freightId) {
      try {
        canSendToShop = this.dispatch.requireFreightPublic(req.freightId).status === 'available';
      } catch {
        canSendToShop = false;
      }
    }
    return {
      state: req.state,
      label: req.label,
      maxSpend: req.maxSpend,
      currency: req.currency,
      phoneMasked: req.phoneMasked,
      ...(req.state === 'awaiting' ? { until: req.until, ...(req.instructions ? { instructions: req.instructions } : {}), ...(req.pushed ? { pushed: true } : {}), ...(req.reference ? { reference: req.reference } : {}) } : {}),
      ...(req.paid != null ? { paid: req.paid } : {}),
      ...(req.loadCode ? { loadCode: req.loadCode } : {}),
      ...(req.billed != null ? { billed: req.billed } : {}),
      ...(req.owedBack ? { owedBack: req.owedBack } : {}),
      ...(canSendToShop ? { canSendToShop: true } : {}),
      ...(req.shopName ? { shopName: req.shopName } : {}),
      ...(req.shopParcelId ? { shopParcelId: req.shopParcelId } : {}),
    };
  }

  private money(amount: number, currency: string): string {
    return `${currency} ${amount.toFixed(2)}`;
  }

  /** The person, in their own app — never a text (rule-a-receiver-is-not-texted). */
  private tell(personDid: string, title: string, body: string, parcelId?: string): void {
    void this.notifications
      ?.notify(personDid, { kind: 'door_delivery', title, body, link: parcelId ? `/?parcel=${parcelId}` : '/', tag: `door:${parcelId ?? personDid}:${title}`, data: parcelId ? { parcelId } : {} })
      .catch((err: Error) => this.logger.warn(`door notice not sent: ${err.message}`));
  }

  /** The hub's floor, where it reads what to do with a box. */
  private tellHub(mdpId: string, title: string, body: string, parcelId: string): void {
    let did: string | undefined;
    try {
      did = this.mdps.require(mdpId).did;
    } catch {
      did = undefined;
    }
    if (!did) return;
    void this.notifications
      ?.notify(did, { kind: 'hub_arrival', title, body, link: '/', tag: `door:${parcelId}:${title}`, data: { parcelId } })
      .catch((err: Error) => this.logger.warn(`door notice to the hub not sent: ${err.message}`));
  }
}
