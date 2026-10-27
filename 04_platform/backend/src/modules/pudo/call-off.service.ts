import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { CallOffView, CalledOffView, HubHandoverView, MaxSpendView, WithdrawnView, WithdrawView } from './call-off.types';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { ParcelService, parcelCurrency } from './parcel.service';
import { coverFor, DOOR_LOAD_REMIND_H, measuredFactor } from './pudo.config';
import type { Freight } from './dispatch.types';
import type { Agent, GeoPoint, Mdp, Parcel, ParcelStatus, Tote } from './pudo.types';
import { RoutingService, type ShipmentQuote } from './routing.service';
import { ToteService } from './tote.service';
import { VendorService } from './vendor.service';

/** Withdrawn, its money back in full: before it left the shop it was handed in at, or before it was handed in at all. */
const WITHDRAWN_BEFORE: ReadonlyArray<ParcelStatus> = ['Created', 'At_PUDO'];

/** Why it cannot be called off where it is, in the store's words. */
const WHY_NOT: Partial<Record<ParcelStatus, string>> = {
  On_Bus: 'A driver is carrying it: it cannot be called off on the road.',
  Ready_For_Pickup: 'It is waiting at the shop for the buyer, whose goods they are.',
  Unclaimed: 'It is waiting at the shop for the buyer, whose goods they are.',
  Delivered: 'It was collected.',
  Disputed: 'The buyer reported a problem with it: that is settled first.',
  Voided: 'It was called off already.',
  Returned: 'It is on its way back already.',
  Lost: 'It was declared lost.',
};

/** Why staff cannot withdraw a person's parcel where it is (2026-10-27). */
const WITHDRAW_WHY_NOT: Partial<Record<ParcelStatus, string>> = {
  On_Bus: 'A driver is carrying it: it cannot be withdrawn on the road.',
  Ready_For_Pickup: 'It is waiting at the shop for its receiver.',
  Unclaimed: 'It is waiting at the shop for its receiver: one nobody collects is written off, not withdrawn.',
  Delivered: 'It was collected.',
  Disputed: 'Its receiver reported a problem with it: that is settled first.',
  Voided: 'It was withdrawn already.',
  Returned: 'It is on its way back already.',
  Lost: 'It was declared lost.',
};

/** The parcel bringing goods back to the store is the store's own goods on their way to it: there is nothing to call off. */
const BRINGS_BACK = 'It brings your goods back to you: collect it at the shop it goes to. It cannot be called off.';

/** A shop that may receive a parcel picked for it: approved, whether or not it has put money in yet. */
const RECEIVING: ReadonlyArray<string> = ['APPROVED_UNFUNDED', 'ACTIVE'];

/** The store's own door: its collection point where it has one, else its own pin. */
type Door = { label: string; location: GeoPoint; country: string };

type WayBack =
  | { why: string }
  | { kind: 'pick'; hub: Mdp; door?: Door }
  | { kind: 'shop'; hub: Mdp; shop: Agent; quote: ShipmentQuote; price: number; door?: Door }
  | { kind: 'door'; hub: Mdp; door: Door; guide: number; currency: string };

/**
 * A STORE CALLS ONE OF ITS PARCELS OFF (call-off.types.ts). Withdrawn before it left the shop it was handed in at, the money
 * back in full — ParcelService.cancel, as it always was. AT A HUB (the user, 2026-10-27: "Comes back, store pays"): turned round
 * there, to the shop it was handed in at, as a new parcel the store pays for; what was carried is not given back. As with a
 * courier's intercept, the goods never sit nowhere: the hub is told, prints the new label, puts it over the old one, and sorts
 * it like any parcel there. NOT HANDED IN AT A SHOP — collected at the store's own door, or handed in at a hub — the store
 * picks where it comes back to ("let the store pick"): a shop, as above; or its own door ("As a load to its door"), a load
 * posted from the hub that the first driver whose vehicle fits takes, at their price and at most what the store allows. The
 * hub hands the box only to that driver, by their pass. Said before it is asked — what it would do and cost — and refused,
 * before anything is written, where it cannot be done.
 */
@Injectable()
export class CallOffService implements OnModuleInit {
  private readonly logger = new Logger(CallOffService.name);

  constructor(
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
    private readonly routing: RoutingService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly totes: ToteService,
    @Optional() private readonly notifications?: NotificationService,
    // Back to the store's own door, as a load (2026-10-27). Optional for the specs that build this by hand.
    @Optional() private readonly dispatch?: DispatchService,
    @Optional() private readonly events?: EventBus,
    @Optional() private readonly drivers?: DriverService,
  ) {}

  onModuleInit(): void {
    // Back at the store's door: the box's chain of custody ends with the store holding it.
    this.events?.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightDelivered, (e) => this.cameHome(e.payload.freightId));
  }

  /** What calling it off would do now — for a parcel not handed in at a shop, to where `backTo` says (a shop's id, or `door`). */
  preview(vendorId: string, parcelId: string, backTo?: string): CallOffView {
    const p = this.owned(vendorId, parcelId);
    if (p.returnOf) return { parcelId, outcome: 'no', why: BRINGS_BACK };
    if (WITHDRAWN_BEFORE.includes(p.status)) return { parcelId, outcome: 'refund', amount: this.refundOf(p), currency: parcelCurrency(p) };
    if (p.status !== 'At_MDP') return { parcelId, outcome: 'no', why: this.whyNot(p) };
    const way = this.wayBack(p, vendorId, backTo);
    if ('why' in way) return { parcelId, outcome: 'no', why: way.why };
    if (way.kind === 'pick') return { parcelId, outcome: 'pick', atHub: way.hub.name, ...(way.door ? { door: way.door.label } : {}) };
    if (way.kind === 'door') return { parcelId, outcome: 'to_door', atHub: way.hub.name, backTo: way.door.label, suggestedMax: way.guide, currency: way.currency };
    // Back to the shop it was handed in at — and, where the store has a door on the map, its door too.
    return { parcelId, outcome: 'bring_back', amount: way.price, currency: way.quote.currency, backTo: way.shop.shopName, atHub: way.hub.name, ...(way.door ? { door: way.door.label } : {}) };
  }

  /** Call it off: withdrawn and refunded, or turned round at the hub that has it — or refused, saying why. */
  callOff(vendorId: string, parcelId: string, by: string, reason?: string, now: number = Date.now(), choice: { backTo?: string; maxSpend?: number } = {}): CalledOffView {
    const p = this.owned(vendorId, parcelId);
    if (p.returnOf) throw new GlosError('INVALID_STATE', BRINGS_BACK);
    if (WITHDRAWN_BEFORE.includes(p.status)) {
      const amount = this.refundOf(p);
      const done = this.parcels.cancel(parcelId, by, reason);
      return { parcelId, status: done.status, outcome: 'refund', amount, currency: parcelCurrency(done) };
    }
    if (p.status !== 'At_MDP') throw new GlosError('INVALID_STATE', this.whyNot(p));
    const way = this.wayBack(p, vendorId, choice.backTo);
    if ('why' in way) throw new GlosError('INVALID_STATE', way.why);
    if (way.kind === 'pick') throw new GlosError('FIELD_REQUIRED', 'It was not handed in at a shop: say where it comes back to — a shop, or your own door', { field: 'backTo' });
    // Sorted already: in a bag still at the hub (one on the road would have taken the parcel with it). It comes out of it.
    const bag = p.toteId ? this.totes.list().find((t) => t.toteId === p.toteId) : undefined;
    if (bag?.status === 'in_transit') throw new GlosError('INVALID_STATE', 'Its bag has left the hub: it cannot be called off on the road.');
    if (way.kind === 'door') return this.toDoor(p, vendorId, way, choice.maxSpend, by, reason, bag, now);
    const { hub, shop, quote, price } = way;
    // Checked BEFORE anything moves, against the whole price: a store's "call it off" that failed afterwards would leave the
    // goods at a hub with no parcel to carry them.
    if (this.vendors.balanceOf(vendorId) + 1e-9 < price) {
      throw new GlosError('WALLET_INSUFFICIENT', `Top up first — bringing it back to ${shop.shopName} costs ${price.toFixed(2)} ${quote.currency}`);
    }
    const vendor = this.vendors.get(vendorId);
    const { back } = this.parcels.turnBackAtHub(
      parcelId,
      { quote, hub: { mdpId: hub.mdpId, name: hub.name, zone: this.routing.hubEnd(hub.mdpId).zone }, toAgentDid: shop.did, receiverMobile: vendor.contactMobile ?? '', shippingPolicy: vendor.shippingPolicy, by, reason },
      now,
    );
    if (bag?.parcels.includes(parcelId)) this.totes.takeOut(bag.code, parcelId, p.size);
    this.tellHub(hub, p, `it goes back to ${shop.shopName} as ${back.parcelId}`, `Print its new label, put it over the old one, then sort ${back.parcelId}.`, 'Called off: a new label', bag?.code, { returnParcelId: back.parcelId });
    return { parcelId, status: 'Returned', outcome: 'bring_back', amount: back.shipmentCost ?? price, currency: parcelCurrency(back), returnParcelId: back.parcelId, backTo: shop.shopName, atHub: hub.name };
  }

  /**
   * TO THE STORE'S OWN DOOR, AS A LOAD (the user, 2026-10-27: "As a load to its door"): posted from the hub like any load, for
   * the first driver whose vehicle fits — at their price, at most what the store allows, billed when a driver takes it. The
   * store's balance must cover the most it allows: a load nobody can pay for would leave the box at the hub for nobody.
   */
  private toDoor(p: Parcel, vendorId: string, way: Extract<WayBack, { kind: 'door' }>, maxSpend: number | undefined, by: string, reason: string | undefined, bag: Tote | undefined, now: number): CalledOffView {
    const most = Math.round(Number(maxSpend) * 100) / 100;
    if (maxSpend == null || !Number.isFinite(most) || most <= 0) {
      throw new GlosError('FIELD_REQUIRED', `Say the most you will pay a driver to bring it to your door — we suggest ${way.guide} ${way.currency}`, { field: 'maxSpend' });
    }
    if (this.vendors.balanceOf(vendorId) + 1e-9 < most) throw new GlosError('WALLET_INSUFFICIENT', `Top up first — you allow up to ${most.toFixed(2)} ${way.currency} for bringing it to your door`);
    const vendor = this.vendors.get(vendorId);
    const end = this.routing.hubEnd(way.hub.mdpId);
    const load = this.dispatch!.registerFreight(
      {
        description: `Parcel ${p.parcelId}, called off: back to ${vendor.name}`,
        pickupLocation: end.location,
        pickupLabel: way.hub.name,
        destLabel: way.door.label,
        destLocation: way.door.location,
        weightKg: p.weightKg,
        fragile: p.fragile,
        packaging: 'piece',
        packages: 1,
        natureCode: p.natureCode,
        ...(p.dimensionsCm ? { dimensionsCm: [p.dimensionsCm.l, p.dimensionsCm.w, p.dimensionsCm.h] as [number, number, number] } : {}),
        shipperDid: vendorId,
        pickupCountry: end.country,
        destCountry: way.door.country,
        ...(p.externalOrderId ? { externalOrderId: p.externalOrderId } : {}),
        maxSpend: most,
        ...(vendor.contactMobile ? { contactName: vendor.name, contactPhone: vendor.contactMobile } : {}),
        bringsBack: { parcelId: p.parcelId, atMdpId: way.hub.mdpId, hubName: way.hub.name },
      },
      now,
    );
    this.parcels.closeAsGoingHome(p.parcelId, { freightId: load.freightId, code: load.code }, way.hub.name, by, reason, now);
    if (bag?.parcels.includes(p.parcelId)) this.totes.takeOut(bag.code, p.parcelId, p.size);
    this.tellHub(way.hub, p, `it goes to the store's own door as load ${load.code}`, `Keep it aside, and hand it only to the driver who comes for ${load.code}: scan their pass at the counter.`, 'Called off: set it aside', bag?.code, { loadCode: load.code });
    return { parcelId: p.parcelId, status: 'Returned', outcome: 'to_door', amount: most, currency: way.currency, returnLoadId: load.freightId, returnLoadCode: load.code, backTo: way.door.label, atHub: way.hub.name };
  }

  /** The boxes called off at this hub waiting for the driver of the load that takes them to their store's door. */
  handoversAt(mdpId: string): HubHandoverView[] {
    this.mdps.require(mdpId);
    if (!this.dispatch) return [];
    const out: HubHandoverView[] = [];
    for (const p of this.parcels.list({ status: 'Returned' })) {
      if (!p.returnLoad || p.atMdpId !== mdpId) continue;
      let f;
      try {
        f = this.dispatch.requireFreightPublic(p.returnLoad.freightId);
      } catch {
        continue;
      }
      if (!f.bringsBack || f.bringsBack.handedAt || f.status === 'cancelled') continue;
      const name = f.claimedBy ? this.nameOf(f.claimedBy) : undefined;
      out.push({ parcelId: p.parcelId, size: p.size, calledOffAt: f.createdAt, load: { freightId: f.freightId, code: f.code, status: f.status, ...(name ? { driverName: name } : {}) } });
    }
    return out.sort((a, b) => a.calledOffAt.localeCompare(b.calledOffAt));
  }

  /**
   * The hub hands a box going to its store's door to the driver who took its load (2026-10-27), by their pass — that driver
   * and nobody else, and not before a driver has taken it. From here the driver answers for it; then they take the load over.
   */
  handToDriver(mdpId: string, parcelId: string, badgeId: string, byName: string, now: number = Date.now()): HubHandoverView[] {
    const hub = this.mdps.require(mdpId);
    let p: Parcel | undefined;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      p = undefined;
    }
    if (!p || !p.returnLoad || p.atMdpId !== mdpId || p.status !== 'Returned') throw new GlosError('NOT_FOUND', `No box called off here is ${parcelId}`);
    if (!this.dispatch) throw new GlosError('INVALID_STATE', 'Loads are not open here');
    const { load, driverDid } = this.dispatch.handBringsBack(p.returnLoad.freightId, mdpId, badgeId, byName, now);
    this.parcels.handOnHome(parcelId, { kind: 'driver', id: driverDid }, `handed to the driver of load ${load.code} at ${hub.name}, by their pass`, new Date(now).toISOString());
    return this.handoversAt(mdpId);
  }

  /**
   * WHAT SENDING THE BOX TO A SHOP INSTEAD WOULD DO (the user, 2026-10-27: "Switch to a shop") — for a store's load to its door
   * that no driver has taken: the shops to pick from (`pick`), then the price to the one picked, said first.
   */
  switchPreview(vendorId: string, freightId: string, backTo?: string): CallOffView {
    const { load, parcel, hub } = this.doorLoadOf(vendorId, freightId);
    const parcelId = parcel.parcelId;
    if (load.status !== 'available') return { parcelId, outcome: 'no', why: this.notSwitchable(load) };
    if (!backTo) return { parcelId, outcome: 'pick', atHub: hub.name };
    const way = this.pickedShop(parcel, hub, backTo);
    if ('why' in way) return { parcelId, outcome: 'no', why: way.why };
    if (way.kind !== 'shop') return { parcelId, outcome: 'no', why: 'Pick a shop.' };
    return { parcelId, outcome: 'bring_back', amount: way.price, currency: way.quote.currency, backTo: way.shop.shopName, atHub: hub.name };
  }

  /**
   * THE BOX TO A SHOP INSTEAD, while no driver has taken the load to the store's door: it goes on from the hub as a new parcel
   * to the shop the store picked, paid by the store — the parcel first, so a refusal leaves the load as it was — and then the
   * load is withdrawn. Nothing of it was billed: a load is billed when a driver takes it.
   */
  switchToShop(vendorId: string, freightId: string, backTo: string | undefined, by: string, now: number = Date.now()): CalledOffView {
    const { load, parcel, hub } = this.doorLoadOf(vendorId, freightId);
    if (load.status !== 'available') throw new GlosError('INVALID_STATE', this.notSwitchable(load));
    if (!backTo) throw new GlosError('FIELD_REQUIRED', 'Say which shop it goes to instead', { field: 'backTo' });
    const way = this.pickedShop(parcel, hub, backTo);
    if ('why' in way) throw new GlosError('INVALID_STATE', way.why);
    if (way.kind !== 'shop') throw new GlosError('INVALID_STATE', 'Pick a shop.');
    if (this.vendors.balanceOf(vendorId) + 1e-9 < way.price) {
      throw new GlosError('WALLET_INSUFFICIENT', `Top up first — bringing it to ${way.shop.shopName} costs ${way.price.toFixed(2)} ${way.quote.currency}`);
    }
    const vendor = this.vendors.get(vendorId);
    const { back } = this.parcels.rerouteGoingHome(
      parcel.parcelId,
      { quote: way.quote, hub: { mdpId: hub.mdpId, name: hub.name, zone: this.routing.hubEnd(hub.mdpId).zone }, toAgentDid: way.shop.did, receiverMobile: vendor.contactMobile ?? '', shippingPolicy: vendor.shippingPolicy, by },
      now,
    );
    this.dispatch!.withdrawBringsBack(freightId, vendorId, now);
    this.tellHub(hub, parcel, `its load to the store's door (${load.code}) is withdrawn: it goes back to ${way.shop.shopName} as ${back.parcelId}`, `Print its new label, put it over the old one, then sort ${back.parcelId}.`, 'Called off: a new label', undefined, { returnParcelId: back.parcelId });
    return { parcelId: parcel.parcelId, status: 'Returned', outcome: 'bring_back', amount: back.shipmentCost ?? way.price, currency: parcelCurrency(back), returnParcelId: back.parcelId, backTo: way.shop.shopName, atHub: hub.name };
  }

  /**
   * A DAY WITH NO DRIVER (2026-10-27): a store whose load to its door nobody has taken in DOOR_LOAD_REMIND_H hours is told, once —
   * it can raise the most it pays, or send the box to a shop instead. Answers which, for a test with a fixed clock.
   */
  remindDoorLoads(now: number = Date.now()): string[] {
    if (!this.dispatch) return [];
    const told: string[] = [];
    for (const f of this.dispatch.bringsBackLoads()) {
      if (f.status !== 'available' || !f.bringsBack || f.bringsBack.remindedAt) continue;
      if (now - Date.parse(f.createdAt) < DOOR_LOAD_REMIND_H * 3_600_000) continue;
      // A store's load. A person's — paid first, with nobody's id on it — is told to them by PersonDoorService.
      if (!f.shipperDid || !this.vendors.has(f.shipperDid)) continue;
      this.dispatch.markBringsBackReminded(f.freightId, now);
      told.push(f.freightId);
      const storeDid = this.vendors.get(f.shipperDid).did;
      if (!storeDid) continue;
      void this.notifications
        ?.notify(storeDid, {
          kind: 'freight_problem',
          title: `No driver has taken load ${f.code} yet`,
          body: `It brings parcel ${f.bringsBack.parcelId} back from ${f.bringsBack.hubName}. Raise the most you pay, or send it to a shop instead — under Sent as freight.`,
          link: '/vendor/',
          tag: `door-load:${f.freightId}:remind`,
          data: { freightId: f.freightId },
        })
        .catch((err: Error) => this.logger.warn(`door-load reminder not sent: ${err.message}`));
    }
    return told;
  }

  private notSwitchable(load: Freight): string {
    return load.status === 'cancelled' ? `Load ${load.code} was withdrawn already.` : `A driver has taken load ${load.code}: it comes to your door.`;
  }

  /** A store's own load to its door: the load, the parcel it brings back, and the hub it waits at. */
  private doorLoadOf(vendorId: string, freightId: string): { load: Freight; parcel: Parcel; hub: Mdp } {
    if (!this.dispatch) throw new GlosError('INVALID_STATE', 'Loads are not open here');
    let load: Freight;
    try {
      load = this.dispatch.requireFreightPublic(freightId);
    } catch {
      throw new GlosError('NOT_FOUND', 'No load of yours brings a parcel back');
    }
    if (!load.bringsBack || load.shipperDid !== vendorId) throw new GlosError('NOT_FOUND', 'No load of yours brings a parcel back');
    return { load, parcel: this.parcels.get(load.bringsBack.parcelId), hub: this.mdps.require(load.bringsBack.atMdpId) };
  }

  /**
   * WHAT WITHDRAWING A PERSON'S PARCEL WOULD DO NOW, for staff (the user, 2026-10-27: "Back to its shop, sender pays"): not yet
   * handed in, or still at the shop it was handed in at — withdrawn there; at a hub — turned round to the shop it was handed
   * in at, as a new parcel to its sender, at the price they pay there in cash as they collect it; anywhere else, why not.
   */
  withdrawPreview(parcelId: string): WithdrawView {
    const p = this.parcelOf(parcelId);
    const no = this.notWithdrawable(p);
    if (no) return { parcelId, outcome: 'no', why: no };
    if (WITHDRAWN_BEFORE.includes(p.status)) return { parcelId, outcome: 'void', ...(p.status === 'At_PUDO' && p.originAgentDid ? { atShop: this.agents.get(p.originAgentDid).shopName } : {}) };
    const way = this.senderWay(p);
    if ('why' in way) return { parcelId, outcome: 'no', why: way.why };
    if (way.kind !== 'shop') return { parcelId, outcome: 'no', why: 'It cannot be turned round there.' };
    return { parcelId, outcome: 'turn_round', amount: way.price, currency: way.quote.currency, backTo: way.shop.shopName, atHub: way.hub.name };
  }

  /**
   * STAFF WITHDRAW A PERSON'S PARCEL: voided where it has not left its first shop (ParcelService.cancel, as it always was);
   * at a hub, turned round there — its sender told where to collect it and what they pay, its receiver that it will not
   * come, the hub what to put on the box. Refused, before anything is written, where it cannot be done.
   */
  withdraw(parcelId: string, by: string, reason: string, now: number = Date.now()): WithdrawnView {
    const p = this.parcelOf(parcelId);
    const no = this.notWithdrawable(p);
    if (no) throw new GlosError('INVALID_STATE', no);
    if (WITHDRAWN_BEFORE.includes(p.status)) {
      const done = this.parcels.cancel(parcelId, by, reason);
      return { parcelId, status: done.status, outcome: 'void' };
    }
    const way = this.senderWay(p);
    if ('why' in way) throw new GlosError('INVALID_STATE', way.why);
    if (way.kind !== 'shop') throw new GlosError('INVALID_STATE', 'It cannot be turned round there.');
    // Sorted already: in a bag still at the hub (one on the road would have taken the parcel with it). It comes out of it.
    const bag = p.toteId ? this.totes.list().find((t) => t.toteId === p.toteId) : undefined;
    if (bag?.status === 'in_transit') throw new GlosError('INVALID_STATE', 'Its bag has left the hub: it cannot be withdrawn on the road.');
    const { hub, shop, quote, price } = way;
    const { back } = this.parcels.turnRoundForSender(parcelId, { quote, hub: { mdpId: hub.mdpId, name: hub.name, zone: this.routing.hubEnd(hub.mdpId).zone }, toAgentDid: shop.did, by, reason }, now);
    if (bag?.parcels.includes(parcelId)) this.totes.takeOut(bag.code, parcelId, p.size);
    this.tellHub(hub, p, `it goes back to ${shop.shopName}, where its sender handed it in, as ${back.parcelId}`, `Print its new label, put it over the old one, then sort ${back.parcelId}.`, 'Withdrawn: a new label', bag?.code, { returnParcelId: back.parcelId }, 'was withdrawn');
    const amount = back.shipmentCost ?? price;
    // Its journey starts at the hub, now: the promise of when it is ready is kept from here (JourneyPlanService).
    void this.events?.publish(GlosEvent.Pudo.ParcelTakenInAtHub, { parcelId: back.parcelId, mdpId: hub.mdpId }, { source: 'pudo' }).catch(() => undefined);
    // Its sender is told where to collect it and what they pay there; its receiver, that it will not come — in the app.
    void this.events?.publish(GlosEvent.Pudo.ParcelWithdrawn, { parcelId, returnParcelId: back.parcelId, hubName: hub.name, shopName: shop.shopName, amount, currency: parcelCurrency(back) }, { source: 'pudo' }).catch(() => undefined);
    return { parcelId, status: 'Returned', outcome: 'turn_round', amount, currency: parcelCurrency(back), returnParcelId: back.parcelId, backTo: shop.shopName, atHub: hub.name };
  }

  /**
   * The way to a shop for goods at a hub, worked out — the shop, the hub, the price — or why there is none. For a person's
   * goods whose load to their door no driver took (PersonDoorService, 2026-10-27): to the shop they would have gone to.
   */
  wayToShopFor(p: Parcel, shopDid: string): { hub: Mdp; shop: Agent; quote: ShipmentQuote; price: number } | { why: string } {
    if (!p.atMdpId) return { why: 'Nobody recorded which hub has it: SeeBuyGet looks into it.' };
    let shop: Agent;
    try {
      shop = this.agents.get(shopDid);
    } catch {
      return { why: 'The shop it was going to is not in the network any more.' };
    }
    const way = this.toShop(p, this.mdps.require(p.atMdpId), shop, false);
    if ('why' in way) return way;
    if (way.kind !== 'shop') return { why: 'It cannot go to a shop from there.' };
    return { hub: way.hub, shop: way.shop, quote: way.quote, price: way.price };
  }

  /** Why staff cannot withdraw it where it is — or nothing. A store's parcel is the store's to call off. */
  private notWithdrawable(p: Parcel): string | undefined {
    if (p.vendorId) return 'A store’s parcel is the store’s to call off, from its own app or its systems.';
    if (p.returnOf) return 'It takes goods back to their sender: it is not withdrawn.';
    if (p.held) return 'It is held: operations decide what happens to it first.';
    if (WITHDRAWN_BEFORE.includes(p.status) || p.status === 'At_MDP') return undefined;
    if (p.status === 'Returned' && p.returnParcelId) return `It is on its way back to its sender already, as ${p.returnParcelId}.`;
    return WITHDRAW_WHY_NOT[p.status] ?? `It cannot be withdrawn now (${p.status}).`;
  }

  /** The way back for a person's goods at a hub: to the shop they were handed in at, worked out — or why there is none. */
  private senderWay(p: Parcel): WayBack {
    if (!p.atMdpId) return { why: 'Nobody recorded which hub has it: SeeBuyGet looks into it.' };
    if (!p.originAgentDid) return { why: 'Nobody recorded the shop it was handed in at: it carries on to its receiver.' };
    return this.toShop(p, this.mdps.require(p.atMdpId), this.agents.get(p.originAgentDid), false);
  }

  /** A parcel by its number, or one that does not exist. */
  private parcelOf(parcelId: string): Parcel {
    try {
      return this.parcels.get(parcelId);
    } catch {
      throw new GlosError('NOT_FOUND', `No parcel ${parcelId}`);
    }
  }

  /** A store raises the most it pays for its parcel's way to its door, while no driver has taken the load. */
  raiseMaxSpend(vendorId: string, freightId: string, amount: number): MaxSpendView {
    if (!this.dispatch) throw new GlosError('INVALID_STATE', 'Loads are not open here');
    const f = this.dispatch.raiseMaxSpend(freightId, vendorId, amount);
    return { freightId: f.freightId, code: f.code, maxSpend: f.maxSpend ?? amount };
  }

  /** Delivered at the store's door: the store holds its goods again. */
  private cameHome(freightId: string): void {
    try {
      const f = this.dispatch?.requireFreightPublic(freightId);
      if (!f?.bringsBack) return;
      const signed = f.proofOfDelivery?.receiverName ? `, received by ${f.proofOfDelivery.receiverName}` : '';
      const at = f.deliveredAt ?? new Date().toISOString();
      if (f.shipperDid && this.vendors.has(f.shipperDid)) {
        this.parcels.handOnHome(f.bringsBack.parcelId, { kind: 'sender', id: f.shipperDid }, `back at the store's door${signed}`, at);
        return;
      }
      // A person's own door, paid first (2026-10-27): the goods end in their hands — known by the number, as at a counter.
      const p = this.parcels.get(f.bringsBack.parcelId);
      this.parcels.handOnHome(p.parcelId, { kind: 'receiver', id: p.receiverPhoneHash ?? 'receiver' }, `at its sender's own door${signed}`, at);
    } catch (err) {
      this.logger.warn(`home leg of load ${freightId} not written: ${(err as Error).message}`);
    }
  }

  /** Where it can come back to, for this parcel and this choice — or why nowhere. Nothing is written. */
  private wayBack(p: Parcel, vendorId: string, backTo: string | undefined): WayBack {
    if (p.held) return { why: 'It is held: operations decide what happens to it first.' };
    if (!p.atMdpId) return { why: 'Nobody recorded which hub has it: SeeBuyGet looks into it.' };
    const hub = this.mdps.require(p.atMdpId);
    const door = this.dispatch ? this.doorOf(vendorId) : undefined;
    // Its own door, wherever it was handed in (the user, 2026-10-27: "parcel return to a door should be optional too").
    if (backTo === 'door') return this.doorWay(p, vendorId, hub, door);
    if (p.originAgentDid) {
      // Handed in at a shop: back to that shop (the user, 2026-10-27) — or the store's door, above. No other shop.
      if (backTo && backTo !== p.originAgentDid) return { why: 'It goes back to the shop it was handed in at, or to your own door: no other shop is chosen for it.' };
      const way = this.toShop(p, hub, this.agents.get(p.originAgentDid), false);
      return 'why' in way || !door || way.kind !== 'shop' ? way : { ...way, door };
    }
    // NOT HANDED IN AT A SHOP — collected at the store's own door, or handed in at a hub: the store says where it comes back
    // to (the user, 2026-10-27: "let the store pick"; "the store door could be a location as well").
    if (!backTo) return { kind: 'pick', hub, ...(door ? { door } : {}) };
    return this.pickedShop(p, hub, backTo);
  }

  /** A shop the store picked by its id: one that receives, that the hub sends toward — or why not. */
  private pickedShop(p: Parcel, hub: Mdp, backTo: string): WayBack {
    let shop: Agent;
    try {
      shop = this.agents.get(backTo);
    } catch {
      return { why: 'There is no such shop: pick one from the list.' };
    }
    return this.toShop(p, hub, shop, true);
  }

  /** The way to the store's own door as a load, worked out — or why there is none. */
  private doorWay(p: Parcel, vendorId: string, hub: Mdp, door: Door | undefined): WayBack {
    if (!this.dispatch) return { why: 'Bringing it to your door is not open here: pick a shop.' };
    if (!door) return { why: 'Your store has no place on the map to bring it to: put its pin on the map under My store, or pick a shop.' };
    const end = this.routing.hubEnd(hub.mdpId);
    if (end.country !== door.country) return { why: 'Coming back to your door it would cross a border, which needs papers of its own: pick a shop on this side.' };
    const guide = this.dispatch.doorGuide({ from: end.location, to: door.location, weightKg: p.weightKg, fragile: p.fragile ?? false, shipperDid: vendorId }).suggestedMax;
    return { kind: 'door', hub, door, guide, currency: this.vendors.currencyOf(this.vendors.get(vendorId)) ?? parcelCurrency(p) };
  }

  /** The way back to a shop, worked out — or why there is none. `picked`: the store chose it, so it must be one that receives. */
  private toShop(p: Parcel, hub: Mdp, shop: Agent, picked: boolean): WayBack {
    const carriesOn = picked ? 'pick another shop' : p.vendorId ? 'it carries on to the buyer' : 'it carries on to its receiver';
    if (picked && (!RECEIVING.includes(shop.status) || this.agents.notOpenYet(shop))) return { why: `${shop.shopName} is not taking parcels: pick another shop.` };
    // The same test as any new parcel naming a shop: held over its ID, its licence lapsed, or resting, it is named by none.
    try {
      this.agents.assertNamedAtMint(shop.did);
    } catch {
      return { why: picked ? `${shop.shopName} is not taking parcels for now: pick another shop.` : `${shop.shopName} is not taking parcels for now, so it cannot come back there: ${carriesOn}.` };
    }
    // The hub must be able to sort it toward that shop — to it, or to the hub serving its area — or the goods would wait there
    // under a new label with nowhere to go.
    try {
      this.mdps.nextHop(hub, shop.zone, shop.did);
    } catch {
      return { why: `${hub.name} sends nothing toward ${shop.zone}, so it cannot come back to ${shop.shopName}: ${carriesOn}.` };
    }
    // Sold by the store's company — or, for a person's goods paid for at the counter they come back to, that shop's.
    const seller = p.vendorId ? this.vendors.entityIdOf(this.vendors.get(p.vendorId)) : this.agents.entityIdOf(shop);
    // The same box, measured as it was: re-measured, it could change size between two legs of one journey.
    const measured = p.dimensionsCm ? measuredFactor({ ...p.dimensionsCm, kg: p.weightKg }) : undefined;
    let quote: ShipmentQuote;
    try {
      quote = this.routing.quoteShipmentFrom(this.routing.hubEnd(hub.mdpId), shop.did, p.size, seller, measured, { kg: p.weightKg, fragile: p.fragile });
    } catch (e) {
      if (e instanceof GlosError) return { why: `It cannot be brought back from ${hub.name}: ${e.message}` };
      throw e;
    }
    if (quote.crossesBorder) return { why: `Coming back it would cross a border, which needs papers of its own: ${carriesOn}.` };
    // What the new parcel will cost, exactly as it is billed: the cheapest way back, and the cover a store buys with it (a
    // person's send carries none, as a counter send never did).
    const premium = p.vendorId ? coverFor({ declaredValue: p.declaredValue, ...quote.insurance }).premium : 0;
    const price = Math.round((quote.locked.gross + premium) * 100) / 100;
    return { kind: 'shop', hub, shop, quote, price };
  }

  /** The store's own door: its collection point where it has one, else its own pin on the map. */
  private doorOf(vendorId: string): Door | undefined {
    const v = this.vendors.get(vendorId);
    const country = this.vendors.dockCountryOf(v);
    if (v.collection) return { label: v.collection.label, location: v.collection.location, country };
    if (v.location) return { label: v.address?.trim() || v.name, location: v.location, country };
    return undefined;
  }

  /** The hub has a box that is no longer going where its label says: what to do, said where the floor reads it. */
  private tellHub(hub: Mdp, old: Parcel, where: string, todo: string, title: string, bagCode: string | undefined, data: Record<string, string>, what = 'was called off by its store'): void {
    const outOfBag = bagCode ? ` Take it out of bag ${bagCode}.` : '';
    const body = `${old.parcelId} ${what}: ${where}.${outOfBag} ${todo}`;
    void this.notifications
      ?.notify(hub.did, { kind: 'hub_arrival', title, body, link: '/', tag: `called-off:${old.parcelId}`, data: { parcelId: old.parcelId, ...data } })
      .catch((err: Error) => this.logger.warn(`called-off notice not sent: ${err.message}`));
  }

  private nameOf(driverDid: string): string | undefined {
    try {
      return this.drivers?.get(driverDid).displayName ?? undefined;
    } catch {
      return undefined;
    }
  }

  private refundOf(p: Parcel): number {
    return p.paidStatus === 'ParcelPaid' && (p.shipmentCost ?? 0) > 0 ? (p.shipmentCost ?? 0) : 0;
  }

  private whyNot(p: Parcel): string {
    if (p.status === 'Returned' && p.returnParcelId) return `It is on its way back already, as ${p.returnParcelId}.`;
    if (p.status === 'Returned' && p.returnLoad) return `It is on its way back already, to your door as load ${p.returnLoad.code}.`;
    return WHY_NOT[p.status] ?? `It cannot be called off now (${p.status}).`;
  }

  /** The store's own parcel, or one it cannot tell from a parcel that does not exist. */
  private owned(vendorId: string, parcelId: string): Parcel {
    let p: Parcel;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      throw new GlosError('NOT_FOUND', `No order ${parcelId}`);
    }
    if (p.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `No order ${parcelId}`);
    return p;
  }
}
