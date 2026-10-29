import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EntityService } from '../../foundation/entity/entity.service';
import { FundingService } from '../../foundation/funding/funding.service';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { AgentService } from './agent.service';
import { CallOffService } from './call-off.service';
import { CargoService } from './cargo.service';
import { ParcelService, parcelCurrency, type VendorOrdersQuery } from './parcel.service';
import { classifySize, measuredFactor } from './pudo.config';
import type { Parcel, Vendor } from './pudo.types';
import { RoutingService } from './routing.service';
import { VendorService, type VendorLedgerQuery } from './vendor.service';
import type { ActingMember } from './business.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { MediaService } from './media.service';
import { DockService } from './dock.service';
import { SiteService, type SiteKind } from './site.service';
import { haversineKm } from './geo';
import type { Agent } from './pudo.types';
import type { ShipmentQuote } from './routing.service';
import type {
  BusinessCallOffView,
  BusinessParcelAccountView,
  BusinessParcelDetail,
  BusinessParcelDto,
  BusinessParcelLabel,
  BusinessParcelList,
  BusinessParcelRow,
  BusinessParcelSent,
  BusinessParcelTrial,
  BusinessSealBagDto,
  DockView,
  ParcelBook,
  ParcelCollection,
  ParcelPriceView,
  ParcelEnd,
  ParcelSender,
} from './business-parcel.types';

/**
 * WHO IS SENDING: a person in the business, signed in as themselves — or the business's own system, by its company key
 * (2026-10-29). Both go through the same steps and meet the same checks; the name is what the parcel's "sent by" says.
 */
export interface ParcelActor {
  entity: Entity;
  name: string;
  personDid?: string;
}

/** A member of the business, as a sender. */
export function memberActor(a: ActingMember): ParcelActor {
  return { entity: a.entity, name: a.member.name, ...(a.member.personDid ? { personDid: a.member.personDid } : {}) };
}

/** The places of its own a business can be collected from: not a port's gate, nor a clearing place. */
const OWN_PLACES: SiteKind[] = ['delivery', 'loading'];
/** How far the nearest shop may be from its place for the place to take that shop's delivery area. */
export const COLLECT_NEAR_KM = 30;

/** A parcel checked and priced, before anything is written. */
interface Checked {
  v: Vendor;
  /** The shop it is handed in at — or none, collected from its own place. */
  origin?: string;
  originZone?: string;
  dest: string;
  receiver: string;
  dims: { l: number; w: number; h: number };
  kg: number;
  size: string;
  quote: ShipmentQuote;
  routeMode: 'flexible' | 'locked';
  price: number;
}

/** Parcels that have nothing more for the receiver to collect: the code is not shown for them. */
const DONE: Parcel['status'][] = ['Delivered', 'Voided', 'Returned', 'Lost'];

/**
 * A BUSINESS'S PARCELS (the user, 2026-10-29: "Billed to the business"; "A prepaid balance").
 *
 * The money is a store's money, on purpose: a business opens a PARCEL ACCOUNT — a till with the company of ours in its
 * country, held as a store record that nobody signs in to — tops it up by M-Pesa or bank, and every parcel is paid from it
 * when it is sent (no balance, no label). Refunds, the flexible route's money back and upheld claims go back into it, as
 * they do for a store, because they run through the same steps. Its loads stay what they were: a match it settles with
 * the carrier itself (rule: who pays for a load).
 *
 * WHO MAY: anybody in the business who may act sends, tops up and calls a parcel off; a viewer reads (the member guard).
 * Staff send nothing in a business's name — these routes answer a business sign-in and nobody else.
 */
@Injectable()
export class BusinessParcelService {
  /** Who in the business sent each parcel. Apart from the parcel, which travels. */
  private readonly senders = new PersistentMap<string, ParcelSender>('business-parcel-senders');

  constructor(
    private readonly vendors: VendorService,
    private readonly parcels: ParcelService,
    private readonly routing: RoutingService,
    private readonly agents: AgentService,
    private readonly cargo: CargoService,
    private readonly funding: FundingService,
    private readonly entities: EntityService,
    private readonly callOffs: CallOffService,
    private readonly media: MediaService,
    private readonly dock: DockService,
    private readonly sites: SiteService,
  ) {}

  /* ------------------------------------------------------------------ the account -- */

  /** The account, its balance and what waits to be confirmed — or whether one can be opened here. */
  account(who: ParcelActor): BusinessParcelAccountView {
    const v = this.vendors.forBusiness(who.entity.entityId);
    if (!v) {
      const whyNot = this.whyNoAccount(who.entity.jurisdiction ?? '');
      return { open: false, canOpen: !whyNot, ...(whyNot ? { whyNot } : {}), sent: 0, unpaid: 0, moving: 0 };
    }
    this.vendors.keepBusinessName(v.vendorId, who.entity.name);
    const stats = this.parcels.vendorOrderStats(v.vendorId);
    const company = this.vendors.settledBy(v);
    const waiting = this.funding.openFor(v.vendorId);
    const terms = this.entities.topUpFeeFor(this.vendors.entityIdOf(v), 0);
    return {
      open: true,
      canOpen: true,
      balance: this.vendors.balanceOrNone(v.vendorId),
      ...(company ? { company } : {}),
      ...(waiting ? { waiting: { reference: waiting.reference, amount: waiting.amount, currency: waiting.currency, openedAt: waiting.openedAt, ...(waiting.pushed ? { pushed: true } : {}), ...(waiting.instructions ? { instructions: waiting.instructions } : {}) } } : {}),
      ...(terms.freeAbove > 0 && terms.charge > 0 ? { terms: { freeAbove: terms.freeAbove, amount: terms.charge } } : {}),
      sent: stats.total,
      unpaid: stats.unpaid,
      moving: stats.active,
      ...(v.collection ? { collection: this.collectionOf(v) } : {}),
    };
  }

  /* -------------------------------------------------- collected from its own place -- */

  /**
   * ONE OF ITS OWN PLACES AS WHERE DRIVERS COLLECT ITS PARCELS (the user, 2026-10-29: "they can set their own (business
   * address) pick up"). A store's dock, made from a place the business saved: its pin, its name, and the delivery area of
   * the shop nearest to it — which is what routes a bag from there. Refused where no shop of ours is near: a driver has
   * nowhere to be routed to. Its parcels are then bagged there, and a driver collects the closed bag.
   */
  collectFrom(who: ParcelActor, siteId: string, bays?: number): BusinessParcelAccountView {
    const v = this.requireAccount(who);
    const site = this.sites.require(who.entity.entityId, siteId);
    if (!OWN_PLACES.includes(site.kind)) throw new GlosError('INVALID_INPUT', `${site.name} is a port or a clearing place, not one of your own: choose a place of yours`, { field: 'siteId' });
    const near = this.nearestShop(site.location);
    if (!near) throw new GlosError('INVALID_STATE', `No shop of ours is within ${COLLECT_NEAR_KM} km of ${site.name}, so no driver can be routed from there yet: hand your parcels in at a shop`, { field: 'siteId' });
    this.vendors.setCollectionPoint(v.vendorId, { label: site.name, zone: near.zone, country: this.agents.countryOf(near), location: site.location, ...(bays ? { bays } : {}), siteId: site.siteId });
    return this.account(who);
  }

  /** Stop collecting there. Bags a driver has already taken stay with that driver. */
  stopCollecting(who: ParcelActor): BusinessParcelAccountView {
    const v = this.requireAccount(who);
    if (!v.collection) throw new GlosError('INVALID_STATE', 'Your parcels are not collected from a place of yours');
    this.vendors.clearCollectionPoint(v.vendorId);
    return this.account(who);
  }

  /** The day's bagging at its own place: what waits, by where it goes; the bags there; how much room is left. */
  dockView(who: ParcelActor): DockView {
    const v = this.requireCollecting(who);
    const plan = this.dock.plan(v.vendorId);
    return {
      collection: this.collectionOf(v),
      // What is still to be bagged: a parcel in a bag waits in the bag, not here.
      groups: plan.groups
        .map((g) => ({ zone: g.label, parcels: g.parcelIds.map((id) => this.parcels.get(id)).filter((p) => !p.toteId).map((p) => this.rowOf(p)), ...(g.openBagCode ? { openBagCode: g.openBagCode } : {}) }))
        .filter((g) => g.parcels.length > 0),
      bags: plan.bags.map((b) => ({ code: b.code, ...(b.destinationLabel ? { destination: b.destinationLabel } : {}), parcelIds: b.parcelIds, fillPct: b.fillPct, status: b.status })),
      capacity: plan.staging.capacity,
      used: plan.staging.used,
    };
  }

  openBag(who: ParcelActor, destZone: string): DockView {
    this.dock.openBag(this.requireCollecting(who).vendorId, destZone);
    return this.dockView(who);
  }

  fillBag(who: ParcelActor, code: string, parcelId: string): DockView {
    const v = this.requireCollecting(who);
    this.owned(v, parcelId);
    this.dock.fillBag(code, v.vendorId, parcelId);
    return this.dockView(who);
  }

  /** Close a bag for the road — its seal's number and a photograph — and the drivers near are told there is one to collect. */
  sealBag(who: ParcelActor, code: string, input: BusinessSealBagDto): DockView {
    const v = this.requireCollecting(who);
    this.dock.sealBag(code, v.vendorId, { closure: input.closure, ...(input.acknowledgeShortShip ? { acknowledgeShortShip: true } : {}), ...(input.shortShipReason?.trim() ? { shortShipReason: input.shortShipReason.trim() } : {}), by: who.name });
    return this.dockView(who);
  }

  /**
   * WHAT IT COSTS, before anything is sent: from a shop, or from its own place, to a shop — priced on the measurements,
   * the way the send will price it.
   */
  price(who: ParcelActor, q: { origin: string; dest: string; l: number; w: number; h: number; kg: number; fragile?: boolean }): ParcelPriceView {
    const v = this.requireAccount(who);
    const own = q.origin === 'own';
    const { quote } = this.quoteOf(v, own ? undefined : q.origin, q.dest, { l: q.l, w: q.w, h: q.h }, q.kg, q.fragile ?? false);
    return { flexible: quote.flexible.gross, locked: quote.locked.gross, currency: quote.currency, crossesBorder: quote.crossesBorder };
  }

  /** Open the account. Asked again, it answers the one there is. */
  open(who: ParcelActor): BusinessParcelAccountView {
    const e = who.entity;
    this.vendors.openForBusiness({ entityId: e.entityId, did: e.did, name: e.name, country: e.jurisdiction ?? '' });
    return this.account(who);
  }

  /** Ask to pay money in. A rail confirms it; nothing is credited on our word or the business's. */
  async topUp(who: ParcelActor, amount: number, phone?: string): Promise<BusinessParcelAccountView> {
    const v = this.requireAccount(who);
    await this.funding.open({ payerKind: 'vendor', payerDid: v.vendorId, amount, payerPhone: phone?.trim() || undefined });
    return this.account(who);
  }

  /** The account's book: every top-up, every parcel paid, every refund. */
  book(who: ParcelActor, q: VendorLedgerQuery): ParcelBook {
    const v = this.requireAccount(who);
    const page = this.vendors.vendorLedgerPage(v.vendorId, q);
    const currency = this.vendors.currencyOf(v) ?? '';
    return {
      items: page.items.map((r) => ({ id: r.id, type: r.type, sign: r.sign, amount: r.amount, currency: r.currency ?? currency, ...(r.parcelId ? { parcelId: r.parcelId } : {}), ...(r.note ? { note: r.note } : {}), at: r.at })),
      total: page.total,
      balance: this.vendors.balanceOrNone(v.vendorId),
    };
  }

  /* -------------------------------------------------------------------- sending -- */

  /**
   * SEND ONE: priced on what it measures, paid from the balance, and given its label once paid. Refused before anything is
   * written where it cannot go as a parcel: too big (it goes as a load), across a border (its commercial invoice is not
   * taken here yet), or at a price that moved since it was shown.
   */
  private check(who: ParcelActor, input: BusinessParcelDto): Checked {
    const v = this.requireAccount(who);
    const origin = input.originPudoDid?.trim() || undefined;
    const dest = input.destPudoDid?.trim();
    const own = input.fromOwnPlace === true;
    if (own && origin) throw new GlosError('INVALID_INPUT', 'Collected from your place, or handed in at a shop — not both', { field: 'originPudoDid' });
    if (!own && !origin) throw new GlosError('FIELD_REQUIRED', 'Choose the shop it is handed in at', { field: 'originPudoDid' });
    if (own && !v.collection) throw new GlosError('INVALID_STATE', 'Choose the place of yours drivers collect from first', { field: 'fromOwnPlace' });
    if (!dest) throw new GlosError('FIELD_REQUIRED', 'Choose the shop it is collected from', { field: 'destPudoDid' });
    if (origin && origin === dest) throw new GlosError('INVALID_INPUT', 'It is handed in and collected at the same shop: choose another shop for one of them', { field: 'destPudoDid' });
    if (origin) this.agents.assertNamedAtMint(origin);
    this.agents.assertNamedAtMint(dest);
    const dial = catalogueEntry(who.entity.jurisdiction ?? '')?.dialCode;
    const receiver = normalizePhone(input.receiverMobile ?? '', dial);
    if (!isPlausiblePhone(receiver)) throw new GlosError('FIELD_REQUIRED', 'Give the number of the person who collects it: the shop hands it to them', { field: 'receiverMobile' });
    const dims = input.dimensionsCm;
    const kg = Number(input.weightKg);
    const { quote, size } = this.quoteOf(v, origin, dest, dims, kg, input.fragile ?? false);
    if (quote.crossesBorder) {
      throw new GlosError('INVALID_STATE', 'A parcel across a border goes with its commercial invoice, which the Business app does not take yet: send it to a shop on this side, or as an export', { crossings: quote.crossings.map((c) => `${c.fromCountry}→${c.toCountry}`) });
    }
    const routeMode: 'flexible' | 'locked' = input.routeMode === 'locked' ? 'locked' : 'flexible';
    const price = (routeMode === 'locked' ? quote.locked : quote.flexible).gross;
    // Against the gross: the money that leaves the balance. A price that moved is said, never billed silently.
    if (input.expectedTotal != null && Math.abs(input.expectedTotal - price) > 0.001) {
      throw new GlosError('PRICE_CHANGED', `The price is now ${price.toFixed(2)} ${quote.currency}: look at it again before sending`, { newTotal: price });
    }
    // The photograph of what is inside: the business's own, held by us and used for nothing else — asked here, so a test key
    // is refused it exactly as a live one is.
    if (!this.media.mayAdopt(input.contentPhotoRef, who.entity.did)) {
      throw new GlosError('PHOTO_REQUIRED', 'We do not hold that photo of the contents. Upload it first, then send its id: a photo the business took of this parcel, used for no other.', { field: 'contentPhotoRef' });
    }
    return { v, ...(origin ? { origin } : { originZone: v.collection!.zone }), dest, receiver, dims: { l: dims.l, w: dims.w, h: dims.h }, kg, size, quote, routeMode, price };
  }

  /**
   * A TEST KEY'S SEND (2026-10-29): every check a live send meets, and the price — and nothing written, nothing paid. Says
   * whether the balance would cover it today.
   */
  trial(who: ParcelActor, input: BusinessParcelDto): BusinessParcelTrial {
    const c = this.check(who, input);
    const balance = this.vendors.balanceOrNone(c.v.vendorId);
    return { test: true, price: c.price, currency: c.quote.currency, routeMode: c.routeMode, size: c.size, covered: (balance ?? 0) + 1e-9 >= c.price, balance };
  }

  send(who: ParcelActor, input: BusinessParcelDto): BusinessParcelSent {
    const { v, origin, originZone, dest, receiver, dims, kg, quote, routeMode } = this.check(who, input);
    const { parcel, paid } = this.parcels.createInbound({
      vendorId: v.vendorId,
      ...(input.reference?.trim() ? { externalOrderId: input.reference.trim() } : {}),
      ...(origin ? { originAgentDid: origin } : { originZone }),
      destAgentDid: dest,
      buyerMobile: receiver,
      dimensionsCm: { l: dims.l, w: dims.w, h: dims.h },
      weightKg: kg,
      contentPhotoRef: input.contentPhotoRef,
      fragile: input.fragile ?? false,
      ...(input.natureCode ? { natureCode: input.natureCode } : {}),
      ...(input.items?.length ? { items: input.items.map((i) => ({ name: i.name.trim(), qty: i.qty })) } : {}),
      ...(input.declaredValue != null ? { declaredValue: input.declaredValue } : {}),
      shippingPolicy: v.shippingPolicy,
      routeMode,
      quote,
    });
    const sender: ParcelSender = { parcelId: parcel.parcelId, entityId: who.entity.entityId, personDid: who.personDid ?? '', name: who.name, at: new Date().toISOString() };
    this.senders.set(parcel.parcelId, sender);
    return { parcel: this.detailOf(parcel), paid, balance: this.vendors.balanceOrNone(v.vendorId) };
  }

  /** Pay for one that the balance could not cover when it was sent — after a top-up. */
  settle(who: ParcelActor, parcelId: string): BusinessParcelSent {
    const v = this.requireAccount(who);
    this.owned(v, parcelId);
    const { parcel, paid } = this.parcels.settleUnpaid(parcelId);
    if (!paid) throw new GlosError('WALLET_INSUFFICIENT', `The balance does not cover it yet: it costs ${(parcel.shipmentCost ?? 0).toFixed(2)} ${parcelCurrency(parcel)}. Top up, then pay for it.`);
    return { parcel: this.detailOf(parcel), paid, balance: this.vendors.balanceOrNone(v.vendorId) };
  }

  /* ---------------------------------------------------------------- reading them -- */

  list(who: ParcelActor, q: VendorOrdersQuery): BusinessParcelList {
    const v = this.vendors.forBusiness(who.entity.entityId);
    if (!v) return { items: [], total: 0 };
    const page = this.parcels.vendorOrdersPage(v.vendorId, q);
    return { items: page.items.map((r) => this.rowOf(this.parcels.get(r.parcelId))), total: page.total };
  }

  detail(who: ParcelActor, parcelId: string): BusinessParcelDetail {
    return this.detailOf(this.owned(this.requireAccount(who), parcelId));
  }

  label(who: ParcelActor, parcelId: string): BusinessParcelLabel {
    const v = this.requireAccount(who);
    const label = this.parcels.orderLabel(v.vendorId, parcelId);
    return { parcelId, svg: label.svg, qrPayload: label.qrPayload };
  }

  /* --------------------------------------------------------------- calling it off -- */

  /** What calling it off would do now: withdrawn with its money back; brought back from a hub at a price; or why not. */
  callOffPreview(who: ParcelActor, parcelId: string, backTo?: 'door'): BusinessCallOffView {
    const v = this.requireAccount(who);
    this.owned(v, parcelId);
    const p = this.callOffs.preview(v.vendorId, parcelId, backTo);
    return { parcelId, outcome: p.outcome, ...(p.amount != null ? { amount: p.amount } : {}), ...(p.currency ? { currency: p.currency } : {}), ...(p.backTo ? { backTo: p.backTo } : {}), ...(p.why ? { why: p.why } : {}), ...(p.door ? { door: p.door } : {}), ...(p.suggestedMax != null ? { suggestedMax: p.suggestedMax } : {}) };
  }

  /** Call it off. Collected from its own place and at a hub now: `door` brings it back there, at most `maxSpend` to a driver. */
  callOff(who: ParcelActor, parcelId: string, reason?: string, choice: { backTo?: 'door'; maxSpend?: number } = {}): BusinessCallOffView {
    const v = this.requireAccount(who);
    this.owned(v, parcelId);
    const done = this.callOffs.callOff(v.vendorId, parcelId, who.name, reason?.trim() || `called off by ${who.name}`, Date.now(), choice);
    return { parcelId, outcome: done.outcome, amount: done.amount, currency: done.currency, ...(done.backTo ? { backTo: done.backTo } : {}), ...(done.returnLoadCode ? { loadCode: done.returnLoadCode } : {}), done: true };
  }

  /** One parcel as its business's Parcels screen reads it, and whose it is — for its own system's messages. A store's: nothing. */
  rowFor(parcelId: string): { entityId: string; row: BusinessParcelRow } | undefined {
    let p: Parcel;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      return undefined;
    }
    const v = p.vendorId && this.vendors.has(p.vendorId) ? this.vendors.get(p.vendorId) : undefined;
    if (!v?.business) return undefined;
    return { entityId: v.business.entityId, row: this.rowOf(p) };
  }

  /* ------------------------------------------------------------------- helpers -- */

  /** The account, collecting from one of its places — or a refusal that says how. */
  private requireCollecting(who: ParcelActor): Vendor {
    const v = this.requireAccount(who);
    if (!v.collection) throw new GlosError('INVALID_STATE', 'Choose the place of yours drivers collect from first');
    return v;
  }

  private collectionOf(v: Vendor): ParcelCollection {
    const c = v.collection!;
    return { ...(c.siteId ? { siteId: c.siteId } : {}), label: c.label, zone: c.zone, bays: c.bays, since: c.enabledAt };
  }

  /** The shop nearest to a point, within reach, that takes new parcels. */
  private nearestShop(at: { lat: number; lng: number }): Agent | undefined {
    let best: { agent: Agent; km: number } | undefined;
    for (const a of this.agents.list()) {
      if (!a.location || a.idHold || a.status === 'DRAFT' || a.status === 'KYC_PENDING') continue;
      const km = haversineKm(at, a.location);
      if (km <= COLLECT_NEAR_KM && (!best || km < best.km)) best = { agent: a, km };
    }
    return best?.agent;
  }

  /**
   * Priced on what it measures — from a shop, or from its own place as a store's dock is priced — and refused where it
   * cannot go as a parcel: too big for a shop (a load), or across a border (its commercial invoice is not taken here yet).
   */
  private quoteOf(v: Vendor, origin: string | undefined, dest: string, dims: { l: number; w: number; h: number }, kg: number, fragile: boolean): { quote: ShipmentQuote; size: string } {
    const size = classifySize({ ...dims, kg });
    const cargoClass = this.cargo.classify({ kg, dimsCm: [dims.l, dims.w, dims.h] });
    if (this.cargo.dedicatedRequired(cargoClass)) {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', `This is too big or too heavy to go as a parcel (${cargoClass}): post it as a load, under Domestic`, { cargoClass });
    }
    const measured = measuredFactor({ ...dims, kg });
    const dock = origin ? undefined : v.collection;
    if (!origin && !dock) throw new GlosError('INVALID_STATE', 'Choose the place of yours drivers collect from first');
    const quote = dock
      ? this.routing.quoteShipmentFrom({ type: 'dock', id: v.did, label: dock.label, zone: dock.zone, country: this.vendors.dockCountryOf(v), location: dock.location }, dest, size, this.vendors.entityIdOf(v), measured, { kg, fragile })
      : this.routing.quoteShipment(origin!, dest, size, measured, { kg, fragile });
    return { quote, size };
  }

  /** The account, or a refusal that says how to get one. */
  requireAccount(who: ParcelActor): Vendor {
    const v = this.vendors.forBusiness(who.entity.entityId);
    if (!v) throw new GlosError('INVALID_STATE', 'Open your parcel account first: parcels are paid from its balance');
    return v;
  }

  /** The business's own parcel. Another's is "not found" — never "not yours", which would say that it exists. */
  private owned(v: Vendor, parcelId: string): Parcel {
    let p: Parcel | undefined;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      p = undefined;
    }
    if (!p || p.vendorId !== v.vendorId) throw new GlosError('NOT_FOUND', `No parcel ${parcelId} was sent by this business`);
    return p;
  }

  /** Why an account cannot be opened in this country, or nothing. */
  private whyNoAccount(country: string): string | undefined {
    if (!this.entities.forJurisdiction(country)) return `SeeBuyGet holds no money in ${country} yet, so parcels cannot be paid for from a balance there.`;
    return undefined;
  }

  private ownPlaceName(p: Parcel): string {
    const v = p.vendorId && this.vendors.has(p.vendorId) ? this.vendors.get(p.vendorId) : undefined;
    return v?.collection?.label ?? p.birthplace?.label ?? '';
  }

  private endOf(did: string | undefined): ParcelEnd | undefined {
    if (!did) return undefined;
    try {
      const a = this.agents.get(did);
      return { did, name: a.shopName, zone: a.zone };
    } catch {
      return undefined;
    }
  }

  private rowOf(p: Parcel): BusinessParcelRow {
    const sender = this.senders.get(p.parcelId);
    return {
      parcelId: p.parcelId,
      status: p.status,
      paid: p.paidStatus === 'ParcelPaid',
      ...(p.externalOrderId ? { reference: p.externalOrderId } : {}),
      receiver: p.receiverMobile,
      ...(this.endOf(p.originAgentDid) ? { from: this.endOf(p.originAgentDid) } : {}),
      // No first shop and no hub: collected from its own place.
      ...(!p.originAgentDid && !p.handInMdpId && !p.returnOf ? { fromOwnPlace: true, from: { did: '', name: this.ownPlaceName(p), zone: p.originZone } } : {}),
      to: this.endOf(p.destAgentDid) ?? { did: p.destAgentDid ?? '', name: p.destZone, zone: p.destZone },
      size: p.size,
      ...(p.shipmentCost != null ? { cost: p.shipmentCost } : {}),
      currency: parcelCurrency(p),
      // Only once paid (no label, nothing to collect) and while there is something to collect.
      ...(p.paidStatus === 'ParcelPaid' && !DONE.includes(p.status) && p.collectionCode ? { collectionCode: p.collectionCode } : {}),
      ...(p.trackingKey ? { trackingKey: p.trackingKey } : {}),
      ...(sender ? { sentBy: sender.name } : {}),
      createdAt: p.acceptedAt ?? p.scans?.[0]?.at ?? '',
      ...(p.returnParcelId ? { returnParcelId: p.returnParcelId } : {}),
    };
  }

  private detailOf(p: Parcel): BusinessParcelDetail {
    return {
      ...this.rowOf(p),
      weightKg: p.weightKg,
      fragile: p.fragile ?? false,
      ...(p.routeMode ? { routeMode: p.routeMode } : {}),
      ...(p.platformFee != null ? { platformFee: p.platformFee } : {}),
      ...(p.shipmentTax ? { tax: p.shipmentTax } : {}),
      ...(p.taxLabel ? { taxLabel: p.taxLabel } : {}),
      ...(p.declaredValue != null ? { declaredValue: p.declaredValue } : {}),
      // No cover, nothing said: a limit of nothing reads as a promise of something (rule: damage is reported, not judged).
      ...(p.coverLimit ? { coverLimit: p.coverLimit } : {}),
      // The first step's note is ours (how the parcel was made), not the sender's; the rest say what happened.
      steps: (p.scans ?? []).map((s) => ({ at: s.at, status: String(s.status), ...(s.note && s.status !== 'CREATED' ? { note: s.note } : {}) })),
    };
  }
}
