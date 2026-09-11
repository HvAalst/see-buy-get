import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { hashPhone } from '../../foundation/identity/phone';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { DidService } from '../../foundation/did/did.service';
import { AgentService } from './agent.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { FleetService } from './fleet.service';
import { DEFAULT_TAX_LABEL, HANDOVER_FEE, MAX_CLAIM_AWARD, LABEL_TZ_OFFSET_MIN, LABOUR_FEE, NETWORK_CURRENCY, OTP_MAX_ATTEMPTS, RELEASE_FEE, SHELVING_FEE, SIZE_TRANSPORT_FACTOR, SIZE_WEIGHT_KG, UNCOLLECTED_H, VOID_WINDOW_MS, WHOLESALE, classifySize, coverFor, holdingFeeFor, taxOn, withPlatformFee } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import type { ResolvedTax } from '../../foundation/entity/entity.types';
import { Birthplace, ConsumerParcelView, CustodyKind, CustodyLeg, DisputeDecision, DisputeOrigin, Parcel, ParcelDirection, ParcelScan, ParcelSize, ParcelStatus, PaymentMode, PhygitalLabel, ShippingPolicy, isCollectable } from './pudo.types';
import { VendorService } from './vendor.service';
import { VehicleService } from './vehicle.service';
import { MediaService } from './media.service';
import { CargoService } from './cargo.service';
import { CargoNature } from './cargo.types';
import { declareFor } from './customs';
import type { ShipmentQuote } from './routing.service';
import { paginate, textMatch, toCsv, withinDates, type Page } from './query';

const LABEL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The creation date as printed on a label — "13 Aug 2026", shifted to the network's operating offset so
 * a parcel minted just after midnight locally does not print yesterday's date. Date only: the point is
 * "how long has this box been here", which a time would only clutter. An unparseable/missing stamp
 * prints nothing rather than the word "Invalid" on a customer's parcel.
 */
/** Once a parcel reaches one of these it can never be released again, so its code stops being shown. */
const TERMINAL_STATUSES = new Set<ParcelStatus>(['Delivered', 'Disputed', 'Voided']);

/**
 * A peer-send release code: 4 digits, because it is read over a phone call and typed at a counter by
 * people who may not read well. Short is only safe because the attempt budget burns it after
 * OTP_MAX_ATTEMPTS — guessing, not brute force, is the threat it has to survive.
 */
export function releaseOtp(): string {
  return String(Math.floor((parseInt(randomBytes(2).toString('hex'), 16) / 65536) * 9000 + 1000));
}

export function labelDate(iso?: string): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + LABEL_TZ_OFFSET_MIN * 60_000);
  return `${d.getUTCDate()} ${LABEL_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The vendor shipment-register query (R0) — mirrors VendorOrdersQueryDto, all optional. */
export interface VendorOrdersQuery {
  q?: string;
  status?: string;
  pudo?: string;
  from?: string;
  to?: string;
  paid?: 'paid' | 'unpaid';
  sort?: 'newest' | 'oldest' | 'cost_desc' | 'cost_asc';
  limit?: string;
  offset?: string;
}

/** One row of the vendor shipment register — the list projection, now carrying the DID, buyer + products. */
export interface VendorOrderRow {
  parcelId: string;
  did?: string;
  externalOrderId?: string;
  status: ParcelStatus;
  paidStatus?: 'unpaid' | 'ParcelPaid';
  buyer: string; // the buyer's mobile (the vendor's own customer, provided at checkout)
  buyerEmail?: string;
  products: string; // item names, human-readable ("Ankara shirt ×2, Kitenge scarf")
  destZone: string;
  destAgentDid?: string;
  size: ParcelSize;
  shipmentCost?: number;
  buyerCharge?: number;
  currency: string; // what those two amounts ARE — the selling sister's money, not the network's
  routeMode?: 'flexible' | 'locked';
  collectionCode?: string;
  trackingKey?: string;
  binSlot?: string;
  createdAt: string;
}

/**
 * Store-wide shipment counts for the console header — computed over the WHOLE store, never a filtered
 * page. The register list is paginated and filterable, so the "N unpaid — top up" nudge and the spoken
 * summary MUST come from here, not from the visible page, or filtering to (say) Delivered would report
 * zero unpaid and hide unreleased labels.
 */
export interface VendorOrderStats {
  total: number;
  unpaid: number; // paidStatus !== 'ParcelPaid' — labels still waiting on the balance
  active: number; // still moving: not yet Delivered, not Voided
}

/** Count a vendor's parcels store-wide (PURE — the owner scope is applied by the caller via list({vendorId})). */
export function vendorOrderStatsOf(rows: Parcel[]): VendorOrderStats {
  let unpaid = 0;
  let active = 0;
  for (const p of rows) {
    if (p.paidStatus !== 'ParcelPaid') unpaid += 1;
    if (p.status !== 'Delivered' && p.status !== 'Voided') active += 1;
  }
  return { total: rows.length, unpaid, active };
}

/** Products as a human string: "Ankara shirt ×2, Kitenge scarf". */
function vendorProducts(p: Parcel): string {
  return (p.items ?? []).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ');
}

function vendorOrderSort(sort?: VendorOrdersQuery['sort']): (a: Parcel, b: Parcel) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.acceptedAt.localeCompare(b.acceptedAt);
    case 'cost_desc':
      return (a, b) => (b.shipmentCost ?? 0) - (a.shipmentCost ?? 0);
    case 'cost_asc':
      return (a, b) => (a.shipmentCost ?? 0) - (b.shipmentCost ?? 0);
    default:
      return (a, b) => b.acceptedAt.localeCompare(a.acceptedAt); // newest first
  }
}

/**
 * Filter + search + sort a vendor's parcels for the register (PURE — the owner scope is applied by the
 * caller via list({vendorId})). Search `q` is a case-insensitive substring over the order-ref, DID,
 * sticker id, tracking key, buyer mobile/email, destination zone and product names.
 */
export function filterVendorParcels(rows: Parcel[], q: VendorOrdersQuery): Parcel[] {
  let out = rows;
  if (q.status) out = out.filter((p) => p.status === q.status);
  if (q.pudo) out = out.filter((p) => p.destAgentDid === q.pudo);
  if (q.paid) out = out.filter((p) => (q.paid === 'paid' ? p.paidStatus === 'ParcelPaid' : p.paidStatus !== 'ParcelPaid'));
  if (q.from || q.to) out = out.filter((p) => withinDates(p.acceptedAt, q.from, q.to));
  if (q.q) {
    out = out.filter((p) =>
      textMatch([p.parcelId, p.did, p.externalOrderId, p.trackingKey, p.receiverMobile, p.buyerEmail, p.destZone, ...(p.items?.map((i) => i.name) ?? [])], q.q),
    );
  }
  return [...out].sort(vendorOrderSort(q.sort));
}

/**
 * What a parcel's money IS — the currency it was quoted and will be billed in.
 *
 * The SELLING sister's, stamped at mint. A parcel written before prices named their unit was necessarily
 * in this deployment's own currency, because there was only one; defaulting on READ keeps the old rows and
 * the new ones answering the same question, exactly as a site's country does.
 */
export function parcelCurrency(p: Parcel): string {
  return p.currency ?? NETWORK_CURRENCY;
}

/** Project a Parcel to a register row (adds the DID, buyer + product names the raw list lacked). */
/**
 * The DETAIL a store gets for one of its own orders: the list row, plus everything about that sale it is
 * entitled to reconcile — and nothing about how the price was built.
 */
export interface VendorOrderDetail extends VendorOrderRow {
  originAgentDid?: string;
  buyerMobile?: string;
  subtotal?: number;
  contentPhotoRef?: string;
  items?: Parcel['items'];
  scans?: Parcel['scans'];
  /** The ONE platform fee line, and the rate it was charged at. Never the three layers inside it. */
  platformFee?: number;
  platformFeePct?: number;
  shipmentTax?: number;
  taxPct?: number;
  taxLabel?: string;
  declaredValue?: number;
  coverLimit?: number;
  shipmentPremium?: number;
  /** Operator-only markers are absent by construction here, not deleted: see vendorOrderDetailOf. */
}

/**
 * ONE order, as the store that sold it may read it — PICKED, never the stored parcel.
 *
 * Two fields are the reason this changed shape: `rateStack` and `shipmentProvision`. They are the
 * sister's three rate layers and the slice of them set aside against claims, and the decision has always
 * been that a merchant sees ONE platform fee while the split stays internal. `provision / base` IS the
 * cost-of-risk rate, so publishing the money publishes the rate by division — the same defect the public
 * quote had, on the other side of the network.
 *
 * What a merchant DOES get is everything about their own sale: what they were charged, the fee inside it,
 * the tax and what it is called, the cover they bought, their own customer's details and the parcel's
 * journey. More than the list gives, because this is the screen where a store reconciles one order.
 */
export function vendorOrderDetailOf(p: Parcel): VendorOrderDetail {
  return {
    ...vendorOrderRowOf(p),
    originAgentDid: p.originAgentDid,
    buyerMobile: p.receiverMobile,
    subtotal: p.subtotal,
    contentPhotoRef: p.contentPhotoRef,
    items: p.items,
    scans: p.scans,
    // The one fee line, and the rate it was charged at — a business partner reconciling their books is
    // owed our take. Stripe and Shopify show theirs, and hiding it reads as evasive.
    platformFee: p.platformFee,
    platformFeePct: p.platformFeePct,
    // Tax is the customer's own money and they are entitled to see it named.
    shipmentTax: p.shipmentTax,
    taxPct: p.taxPct,
    taxLabel: p.taxLabel,
    // The cover they bought, which is what an upheld damage award is checked against.
    declaredValue: p.declaredValue,
    coverLimit: p.coverLimit,
    shipmentPremium: p.shipmentPremium,
  };
}

export function vendorOrderRowOf(p: Parcel): VendorOrderRow {
  return {
    parcelId: p.parcelId,
    did: p.did,
    externalOrderId: p.externalOrderId,
    status: p.status,
    paidStatus: p.paidStatus,
    buyer: p.receiverMobile,
    buyerEmail: p.buyerEmail,
    products: vendorProducts(p),
    destZone: p.destZone,
    destAgentDid: p.destAgentDid,
    size: p.size,
    shipmentCost: p.shipmentCost,
    buyerCharge: p.buyerCharge,
    currency: parcelCurrency(p),
    routeMode: p.routeMode,
    collectionCode: p.collectionCode,
    trackingKey: p.trackingKey,
    binSlot: p.binSlot,
    createdAt: p.acceptedAt,
  };
}

/** Render matched parcels as the vendor's shipment CSV export. */
export function vendorOrdersToCsv(rows: Parcel[]): string {
  return toCsv(
    ['Order', 'Shipment DID', 'Buyer', 'Products', 'Status', 'Paid', 'Destination', 'Shipping cost', 'Buyer charge', 'Currency', 'Created'],
    // The currency is the PARCEL's, not the network's: a store selling out of another country bills in its
    // own sister's money, and an export that stamped every row 'KES' would be quietly wrong for that store.
    rows.map((p) => [p.externalOrderId ?? p.parcelId, p.did ?? '', p.receiverMobile, vendorProducts(p), p.status, p.paidStatus ?? '', p.destZone, p.shipmentCost ?? '', p.buyerCharge ?? '', parcelCurrency(p), p.acceptedAt]),
  );
}

/* ------------------------------- rate impact — what a margin change actually did ---------------------- */

/** One contiguous spell at a single margin rate: what it earned, and what it did to volume. */
export interface RateSpell {
  feePct: number;
  shipments: number;
  gross: number; // what customers were charged in total
  margin: number; // the sister's cut of it
  avgMargin: number; // per shipment — the easy half to predict
  from: string;
  to: string;
}

/**
 * Group priced shipments into contiguous SPELLS at each margin rate, in time order.
 *
 * Spells, not totals by rate: a network that goes 2% → 5% → 2% has three of them, and merging the two
 * 2% periods would hide exactly the comparison the view exists for. What a rate earned per parcel is
 * arithmetic anyone can do in their head; what it did to the NUMBER of parcels is the part that can only
 * be observed, and the part that decides whether the change was worth making.
 *
 * Walk-up cash parcels carry no margin (they are priced by the wholesale/retail spread, a different
 * product), so they are counted separately rather than diluting the rates they were never sold at.
 */
export function rateImpactOf(rows: Parcel[], homeEntityId: string, entityId: string): { spells: RateSpell[]; unpriced: number } {
  const mine = rows.filter((p) => (p.collectingEntityId ?? homeEntityId) === entityId);
  const priced = mine.filter((p) => p.platformFeePct != null && p.shipmentCost != null).sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
  const spells: RateSpell[] = [];
  for (const p of priced) {
    const pct = p.platformFeePct!;
    const last = spells[spells.length - 1];
    if (!last || last.feePct !== pct) {
      spells.push({ feePct: pct, shipments: 0, gross: 0, margin: 0, avgMargin: 0, from: p.acceptedAt, to: p.acceptedAt });
    }
    const spell = spells[spells.length - 1];
    spell.shipments += 1;
    spell.gross = Math.round((spell.gross + (p.shipmentCost ?? 0)) * 100) / 100;
    spell.margin = Math.round((spell.margin + (p.platformFee ?? 0)) * 100) / 100;
    spell.to = p.acceptedAt;
  }
  for (const s of spells) s.avgMargin = Math.round((s.margin / s.shipments) * 100) / 100;
  return { spells, unpriced: mine.length - priced.length };
}

/* ----------------------- agent parcel-history register (R4) — the parcels through a shop --------------- */

/** The AGENT register is about the shop's OWN handling, not the buyer — so it carries only parcel / route /
 *  status facts: no buyer PII, no collection code. A shop's parcels are those where it is the drop-off
 *  (origin) OR the collection point (dest). */
export interface AgentParcelsQuery {
  q?: string; // parcel id / shipment DID / tracking key / zone
  status?: string;
  role?: 'origin' | 'dest'; // took it IN (drop-off) vs handing it OUT (collection)
  from?: string; // ISO or YYYY-MM-DD (inclusive)
  to?: string;
  sort?: 'newest' | 'oldest';
  limit?: number | string;
  offset?: number | string;
}

export interface AgentParcelRow {
  parcelId: string;
  did?: string;
  status: ParcelStatus;
  role: 'origin' | 'dest';
  originZone: string;
  destZone: string;
  size: ParcelSize;
  trackingKey?: string;
  createdAt: string;
}

/* ------------------------------------------------ birthplace, custody, ownership (the parcel's own facts) */

/**
 * Where this parcel came into being — recorded since the birthplace slice, RECONSTRUCTED before it.
 *
 * The reconstruction is honest rather than clever: an older parcel names the shop that first held it, which
 * for a counter parcel IS where it was born, and for a store order is the nearest true thing we kept.
 */
export function birthplaceOf(p: Parcel): Birthplace | undefined {
  if (p.birthplace) return p.birthplace;
  if (p.originAgentDid) return { kind: p.vendorId ? 'store' : 'counter', atId: p.originAgentDid, label: p.originZone ?? 'origin', at: p.acceptedAt };
  return undefined;
}

/**
 * Who is holding it right now — the open custody leg.
 *
 * For a parcel written before custody was recorded, the answer is RECONSTRUCTED from its status and last
 * scan. That reconstruction is a reading, not a record: it says where the parcel was, and infers from that
 * who must have had it. Anything that needs proof (a damage claim) should say so when it is relying on it.
 */
export function custodianOf(p: Parcel): CustodyLeg | undefined {
  const open = (p.custody ?? []).find((l) => !l.to);
  if (open) return open;
  if (p.custody?.length) return undefined; // a closed chain: nobody holds it (delivered, voided)
  const last = p.scans[p.scans.length - 1];
  if (!last) return undefined;
  const kind: CustodyKind | undefined =
    p.status === 'On_Bus' ? 'driver' : p.status === 'At_MDP' ? 'hub' : p.status === 'Delivered' ? 'receiver' : p.status === 'At_PUDO' || isCollectable(p.status) ? 'shop' : undefined;
  return kind ? { holderId: last.by, holderKind: kind, from: last.at, note: 'reconstructed from the scan trail' } : undefined;
}

/**
 * Who held it at a given moment — the question a damage claim actually asks.
 *
 * Answerable only from a recorded chain: a status trail says where a parcel WAS, which is a different thing
 * from who was answerable for it. Undefined means we do not know, and saying so is the point.
 */
export function custodyAt(p: Parcel, iso: string): CustodyLeg | undefined {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return undefined;
  // The LAST leg that covers the instant, and both ends are inclusive: a hand-off is a moment two parties
  // share, and the honest answer to "who had it at exactly then" is the one who ended up with it. It also
  // keeps a leg that opened and closed inside the same millisecond answerable rather than invisible.
  let held: CustodyLeg | undefined;
  for (const leg of p.custody ?? []) {
    const from = new Date(leg.from).getTime();
    const to = leg.to ? new Date(leg.to).getTime() : Number.POSITIVE_INFINITY;
    if (t >= from && t <= to) held = leg;
  }
  return held;
}

/** The two owners of a parcel, which are different parties and do not change as it travels. */
export interface ParcelOwnership {
  /** The SHIPMENT: whoever bought the carriage. They pay, they may void it, refunds return to them. */
  shipment: { kind: 'store' | 'sender'; id?: string };
  /** The GOODS: whoever the parcel is for. They inspect, they dispute, and only they hold the release secret. */
  goods: { kind: 'receiver'; phoneHash?: string };
}

/**
 * Ownership, stated rather than implied.
 *
 * "Who owns a parcel" has two answers and the system has always known both without naming either: the
 * sender owns the contract of carriage, the receiver owns what is inside. Custody is neither — it is the
 * chain of hands between them, and the network only ever appears there. The phone hash never leaves the
 * operator boundary; it is here so a dispute can be tied to a person, not so a view can print one.
 */
export function ownershipOf(p: Parcel): ParcelOwnership {
  return {
    shipment: p.vendorId ? { kind: 'store', id: p.vendorId } : { kind: 'sender', id: p.senderPhoneHash },
    goods: { kind: 'receiver', phoneHash: p.receiverPhoneHash },
  };
}

/** This shop's relation to a parcel: the drop-off (origin) or the collection point (dest). */
export function agentParcelRole(p: Parcel, agentDid: string): 'origin' | 'dest' {
  return p.originAgentDid === agentDid ? 'origin' : 'dest';
}

export function agentParcelRowOf(p: Parcel, agentDid: string): AgentParcelRow {
  return { parcelId: p.parcelId, did: p.did, status: p.status, role: agentParcelRole(p, agentDid), originZone: p.originZone, destZone: p.destZone, size: p.size, trackingKey: p.trackingKey, createdAt: p.acceptedAt };
}

/** Filter + search + sort a shop's parcels for its history register (PURE — the owner scope + the
 *  list({agentDid}) that restricts to THIS shop's parcels are the caller's). */
export function filterAgentParcels(rows: Parcel[], agentDid: string, q: AgentParcelsQuery): Parcel[] {
  let out = rows;
  if (q.status) out = out.filter((p) => p.status === q.status);
  if (q.role) out = out.filter((p) => agentParcelRole(p, agentDid) === q.role);
  if (q.from || q.to) out = out.filter((p) => withinDates(p.acceptedAt, q.from, q.to));
  if (q.q) out = out.filter((p) => textMatch([p.parcelId, p.did, p.trackingKey, p.originZone, p.destZone], q.q));
  return [...out].sort(q.sort === 'oldest' ? (a, b) => a.acceptedAt.localeCompare(b.acceptedAt) : (a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
}

export function agentParcelsToCsv(rows: Parcel[], agentDid: string): string {
  return toCsv(
    ['Parcel', 'Shipment DID', 'Role', 'Status', 'From', 'To', 'Size', 'Tracking', 'Date'],
    rows.map((p) => [p.parcelId, p.did ?? '', agentParcelRole(p, agentDid), p.status, p.originZone, p.destZone, p.size, p.trackingKey ?? '', p.acceptedAt]),
  );
}
import { qrSvgGroup } from '../../foundation/label/qr';

/** PG2 — the OPERATIONAL projection of a parcel for the shared agent/hub list surface: everything the
 *  counter, handover and sort screens work with, NOTHING personal — no phones or hashes, no handover
 *  secrets (collection code / OTP), no label or scan bodies, no dispute material. The raw record leaves
 *  only on owner-scoped or operator surfaces. */
export function operationalParcelView(p: Parcel) {
  return {
    parcelId: p.parcelId,
    did: p.did,
    direction: p.direction,
    size: p.size,
    weightKg: p.weightKg,
    dimensionsCm: p.dimensionsCm,
    fragile: p.fragile,
    cargoClass: p.cargoClass,
    natureCode: p.natureCode,
    originAgentDid: p.originAgentDid,
    originZone: p.originZone,
    destZone: p.destZone,
    destAgentDid: p.destAgentDid,
    committedNodeDid: p.committedNodeDid,
    corridorId: p.corridorId,
    toteId: p.toteId,
    atMdpId: p.atMdpId,
    driverBadgeId: p.driverBadgeId,
    binSlot: p.binSlot,
    status: p.status,
    paymentMode: p.paymentMode,
    paidStatus: p.paidStatus,
    shipmentCost: p.shipmentCost,
    vendorId: p.vendorId,
    externalOrderId: p.externalOrderId,
    trackingKey: p.trackingKey,
    shortShippedAt: p.shortShippedAt,
    shortShipReason: p.shortShipReason,
    acceptedAt: p.acceptedAt,
    handedToBusAt: p.handedToBusAt,
    deliveredAt: p.deliveredAt,
    readyAt: p.readyAt,
    /**
     * Whether this parcel has been waiting to be collected longer than it should.
     *
     * DERIVED HERE rather than in the app, so the threshold has one home. A shopkeeper's screen and an
     * operator's flag disagreeing about what "overdue" means is the kind of thing nobody notices until two
     * people are arguing across a counter about whose number is right.
     *
     * Absent unless it is actually waiting — a boolean that is false on every parcel in every other state
     * invites a list filtered on it to look sensible and mean nothing.
     */
    ...(isCollectable(p.status) && p.readyAt && Date.now() - new Date(p.readyAt).getTime() > UNCOLLECTED_H * 3_600_000
      ? { overdue: true as const }
      : {}),
    unclaimedAt: p.unclaimedAt,
    /**
     * What is owed for the shelf slot, right now.
     *
     * On the view rather than left to the caller, for the same reason `overdue` is: the counter about to
     * charge somebody and the screen that told them the number must not be able to disagree. Absent when
     * nothing is owed, so a list filtered on it cannot quietly include every parcel in the network.
     */
    ...(p.unclaimedAt && holdingFeeFor({ unclaimedAt: p.unclaimedAt, shipmentCost: p.shipmentCost, settled: p.holdingSettled }) > 0
      ? { holdingOwed: holdingFeeFor({ unclaimedAt: p.unclaimedAt, shipmentCost: p.shipmentCost, settled: p.holdingSettled }) }
      : {}),
  };
}

interface AcceptInput {
  agentDid: string;
  parcelId: string; // pre-printed QR sticker id
  size?: ParcelSize; // legacy declared tier; DERIVED from dimensionsCm+weightKg when those are supplied
  dimensionsCm?: { l: number; w: number; h: number }; // the redesigned counter measures the parcel
  weightKg?: number;
  destZone: string;
  senderMobile: string;
  receiverMobile: string;
  dropoffPhotoRef: string; // mandatory
  paymentMode?: PaymentMode;
  fragile?: boolean;
  natureCode?: CargoNature; // S30: primary cargo nature (default GEN)
  destPudoDid?: string; // optional: nominate the destination PUDO up front (enables MDP pre-sort routing)
}

export interface HandoverResult {
  manifestId: string;
  driverBadgeId: string;
  driverDid?: string; // REP2 — the fleet driver who took the batch (rateable); absent for a legacy corridor driver
  corridorId?: string;
  vehicle: 'bus' | 'truck';
  handed: string[];
  rejected: Array<{ parcelId: string; reason: string }>;
  // S25 — the completeness gate makes the manifest legible: `expected` is every waiting parcel that
  // belongs on THIS bus (this shop → the driver's corridor destination); `missed` is the ones that were
  // not scanned. A clean run has `missed: []`. A knowing short-ship returns them here with shortShipped.
  expected: string[];
  missed: string[];
  shortShipped: boolean;
}

/**
 * ParcelService (P-005, ↔ M2/M4 light). The 3-screen agent flow on the backend:
 * Accept (QR + size + destination + mandatory drop-off photo → wallet charge → ledger anchor) →
 * Handover (scan driver badge → manifest, scan each parcel → On_Bus) → Arrive + Pickup (OTP to the
 * receiver) → Void (5-minute reverse-logistics window). Every transition is anchored and emitted on
 * the shared event bus, so SSE/M5 can graduate onto these signals later.
 */
@Injectable()
export class ParcelService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ParcelService.name);
  // Durable: a parcel in flight (money charged, custody held) must survive a restart. Persistence is
  // driven through scan() — the near-universal transition point — plus the few post-scan mutations.
  private readonly parcels = new PersistentMap<string, Parcel>('pudo-parcels');

  constructor(
    private readonly agents: AgentService,
    private readonly presence: PresenceService,
    private readonly gate: WalletGateService,
    private readonly corridors: CorridorService,
    private readonly shelf: ShelfService,
    private readonly fleet: FleetService,
    private readonly ledger: LedgerService,
    private readonly events: EventBus,
    private readonly vendors: VendorService,
    private readonly vehicles: VehicleService,
    private readonly media: MediaService,
    private readonly cargo: CargoService,
    private readonly dids: DidService,
    private readonly entities: EntityService,
  ) {}

  /**
   * The tax on a flat WHOLESALE charge to a shop — the walk-up cash path, which has no quote to carry one.
   *
   * The sale here is the sister's to the SHOP (which then sells on to the person at the counter and keeps
   * that spread off-platform), so it is the shop's own sister's rate that applies, on the PUDO lane.
   *
   * Falls back to no tax rather than throwing, the same way `freightFeePct` falls back — a bookkeeping
   * lookup must never be the thing that stops a parcel being taken in. The fallback is honest today
   * because it can only be reached by a shop with no resolvable sister, which is already a broken state
   * with louder symptoms than this one.
   */
  private wholesaleTax(agentDid: string): ResolvedTax {
    try {
      return this.entities.taxFor(this.agents.entityIdOf(this.agents.get(agentDid)), 'pudo');
    } catch {
      return { ratePct: 0, label: DEFAULT_TAX_LABEL };
    }
  }

  /** DT — mint the shipment's stable GLOS identity (the digital twin's DID) at parcel creation. Anchored +
   *  resolvable; the reusable sticker parcelId is the human handle, this is the shipment's global id. */
  private mintShipmentDid(parcelId: string, direction: ParcelDirection): string {
    return this.dids.generate(`shipment:${parcelId}`, { role: 'shipment', direction }).id;
  }

  /**
   * O4 retroactive linking (S21): backfill sender/receiver phone hashes on parcels created before the
   * hash existed, so a person's past sends and receipts surface the moment they verify the matching
   * number. Idempotent (only stamps a missing hash) and best-effort — never blocks boot. A literal
   * 'vendor' sender hashes to '' and is left unstamped (a vendor is not a person).
   */
  onApplicationBootstrap(): void {
    let stamped = 0;
    for (const p of this.parcels.values()) {
      let changed = false;
      if (p.senderPhoneHash === undefined) { const h = hashPhone(p.senderMobile); if (h) { p.senderPhoneHash = h; changed = true; } }
      if (p.receiverPhoneHash === undefined) { const h = hashPhone(p.receiverMobile); if (h) { p.receiverPhoneHash = h; changed = true; } }
      if (changed) { this.parcels.set(p.parcelId, p); stamped++; }
    }
    if (stamped) this.logger.log(`Backfilled phone hashes on ${stamped} parcel(s).`);
  }

  // --- the authenticated consumer's parcels (S21) ---

  /** Every parcel the person (by phoneHash) is a party to, split by their side, newest first. */
  forPhoneHash(phoneHash: string): { sent: ConsumerParcelView[]; received: ConsumerParcelView[] } {
    if (!phoneHash) return { sent: [], received: [] };
    const sent: ConsumerParcelView[] = [];
    const received: ConsumerParcelView[] = [];
    for (const p of this.parcels.values()) {
      // Receiver takes precedence if (rarely) a person sends to themselves — it is the actionable side.
      if (p.receiverPhoneHash === phoneHash) received.push(ParcelService.toConsumerView(p, phoneHash));
      else if (p.senderPhoneHash === phoneHash) sent.push(ParcelService.toConsumerView(p, phoneHash));
    }
    const byNewest = (a: ConsumerParcelView, b: ConsumerParcelView) => (a.updatedAt < b.updatedAt ? 1 : -1);
    return { sent: sent.sort(byNewest), received: received.sort(byNewest) };
  }

  /** One parcel the caller is a party to (owner-scoped) — the authenticated twin + timeline, or 404. */
  consumerParcel(id: string, phoneHash: string): ConsumerParcelView {
    const p = this.parcels.get(id);
    if (!p || !phoneHash || (p.receiverPhoneHash !== phoneHash && p.senderPhoneHash !== phoneHash)) {
      throw new GlosError('NOT_FOUND', 'No such parcel'); // do not confirm a parcel exists to a non-party
    }
    return ParcelService.toConsumerView(p, phoneHash, true); // detail: carries the in-app collect token
  }

  /**
   * The parcel a receiver may act on, for callers OUTSIDE this class.
   *
   * Returns it rather than a boolean, and 404s rather than 403s, for the same reason receiverParcel does:
   * telling a stranger that a parcel exists but is not theirs is telling them something about somebody
   * else's business.
   */
  requireReceiver(id: string, phoneHash: string): Parcel {
    return this.receiverParcel(id, phoneHash);
  }

  /** The parcel a RECEIVER may act on (PoD / dispute) — receiver-scoped, or 404 (existence not confirmed). */
  private receiverParcel(id: string, phoneHash: string): Parcel {
    const p = this.parcels.get(id);
    if (!p || !phoneHash || p.receiverPhoneHash !== phoneHash) throw new GlosError('NOT_FOUND', 'No such parcel');
    return p;
  }

  /**
   * S23 — the receiver attaches their own delivered-state photo (proof of what they received). Their
   * record, kept alongside the agent's handover photo; not a dispute. Only after delivery, only theirs.
   */
  attachPod(id: string, phoneHash: string, byDid: string, photoRef: string): ConsumerParcelView {
    const p = this.receiverParcel(id, phoneHash);
    if (p.status !== 'Delivered') throw new GlosError('INVALID_STATE', 'Add a photo once the parcel is delivered');
    if (!photoRef) throw new GlosError('PHOTO_REQUIRED', 'A photo is required');
    p.buyerPodPhotoRef = photoRef;
    this.media.link(photoRef, { type: 'parcel', id: p.parcelId }, 'pod'); // shipment-proof; already terminal → anchor
    this.media.anchorParcelTerminal(p.parcelId);
    this.persist(p);
    return ParcelService.toConsumerView(p, phoneHash, true);
  }

  /**
   * S23 — the receiver files a delivery dispute from their app (reason + delivered-state photo) → Disputed.
   * Routed by origin (O3): a VENDOR order notifies the vendor via the S15 HMAC outbox (the ParcelDisputed
   * relay skips non-vendor parcels); a PEER send routes to the control tower (the Buyer_Dispute flag) and
   * the sender (their sent twin flips to Disputed). Adjudication stays control-tower/ops.
   */
  buyerDispute(id: string, phoneHash: string, byDid: string, reason: string, photoRef: string): ConsumerParcelView {
    const p = this.receiverParcel(id, phoneHash);
    if (p.status !== 'Delivered') throw new GlosError('INVALID_STATE', 'You can report a problem once the parcel is delivered');
    if (!reason?.trim() || !photoRef) throw new GlosError('DISPUTE_INCOMPLETE', 'A reason and a photo are required to report a problem');
    // The problem photo must be its OWN media, not the delivered-state PoD reused — else one image serves
    // two roles and its retention gets confused (S26). Force a distinct capture.
    if (photoRef === p.buyerPodPhotoRef) throw new GlosError('DISPUTE_INCOMPLETE', 'Take a new photo of the problem — not the delivery photo');
    // The goods are already with the receiver here, so a closed case returns the parcel to Delivered —
    // which is what it factually is, whatever the outcome of the claim about its condition.
    p.dispute = { state: 'open', origin: 'buyer', fromStatus: p.status, reason, raisedBy: byDid, raisedAt: new Date().toISOString() };
    p.status = 'Disputed';
    p.buyerDisputeReason = reason;
    p.buyerDisputePhotoRef = photoRef; // the problem-photo gets its OWN durable home — never overwrites the PoD
    p.buyerDisputedBy = byDid;
    // S26: link the problem photo to the dispute-evidence bin, and put ALL the parcel's evidence (the PoD
    // that delivery already put on a 90-day clock + this photo) on one dispute-evidence clock, so the proof
    // needed to adjudicate is not swept mid-case and the dispute photo's clock actually starts.
    this.media.link(photoRef, { type: 'parcel', id: p.parcelId }, 'dispute');
    this.media.holdParcelForDispute(p.parcelId);
    p.disputeReason = p.disputeReason ?? reason; // the vendor callback + control-tower flag read this field
    // The scan note stays generic: the free-text reason lives in buyerDisputeReason (receiver-gated), so it
    // is never copied into the timeline, which both parties (including the sender) can read.
    this.scan(p, 'Disputed', byDid, 'buyer dispute');
    void this.events.publish(GlosEvent.Pudo.ParcelDisputed, { parcelId: id, reason, photoProofRef: photoRef, vendorId: p.vendorId, externalOrderId: p.externalOrderId, origin: 'buyer' }, { source: 'pudo' }).catch(() => undefined);
    return ParcelService.toConsumerView(p, phoneHash, true);
  }

  /**
   * Full order detail for the external merchant console (`GET /vendors/:id/orders/:parcelId`).
   *
   * PICKED field by field — see `vendorOrderDetailOf`. It used to be the stored parcel with two fields
   * deleted, which is the shape S25 already caught once: a deny-list only knows about the fields that
   * existed when somebody last thought about it, and every money field added since had joined a merchant's
   * screen on the day it was written.
   */
  vendorOrderView(vendorId: string, parcelId: string): VendorOrderDetail {
    const p = this.require(parcelId);
    if (p.vendorId !== vendorId) throw new GlosError('NOT_FOUND', 'Order does not belong to this vendor');
    return vendorOrderDetailOf(p);
  }

  private static toConsumerView(p: Parcel, phoneHash: string, withToken = false): ConsumerParcelView {
    const relation = p.receiverPhoneHash === phoneHash ? 'received' : 'sent';
    const view: ConsumerParcelView = {
      parcelId: p.parcelId,
      did: p.did, // DT — the twin's stable id
      relation,
      direction: p.direction,
      status: p.status,
      originZone: p.originZone,
      destZone: p.destZone,
      size: p.size,
      fragile: p.fragile,
      items: p.items,
      trackingKey: p.trackingKey,
      vendorOrder: Boolean(p.vendorId),
      createdAt: p.acceptedAt,
      updatedAt: p.scans.length ? p.scans[p.scans.length - 1].at : p.acceptedAt,
      timeline: p.scans.map((s) => ({ at: s.at, status: s.status, note: s.note })),
      // The receiver's OWN photos + free-text reason are theirs alone — the sender's sent-twin sees the
      // status flip to Disputed, never the buyer's evidence or the words they wrote for the control tower.
      podPhotoRef: relation === 'received' ? p.buyerPodPhotoRef : undefined,
      disputePhotoRef: relation === 'received' ? p.buyerDisputePhotoRef : undefined,
      disputeReason: relation === 'received' && p.status === 'Disputed' ? (p.buyerDisputeReason ?? p.disputeReason) : undefined,
      // The closed-window facts, receiver-only — see ConsumerParcelView. The owed figure is DERIVED here
      // rather than left to the app, so the number somebody reads on their phone and the number the
      // counter asks for cannot come from two different pieces of arithmetic.
      ...(relation === 'received'
        ? {
            unclaimedAt: p.unclaimedAt,
            extensionsUsed: p.extensionsUsed,
            receiverResponse: p.receiverResponse,
            relinquishedAt: p.relinquishedAt,
            ...(p.collectProxy ? { collectProxy: { name: p.collectProxy.name, code: p.collectProxy.code } } : {}),
            ...(p.unclaimedAt && holdingFeeFor({ unclaimedAt: p.unclaimedAt, shipmentCost: p.shipmentCost, settled: p.holdingSettled }) > 0
              ? { holdingOwed: holdingFeeFor({ unclaimedAt: p.unclaimedAt, shipmentCost: p.shipmentCost, settled: p.holdingSettled }) }
              : {}),
          }
        : {}),
    };
    // The in-app release token — QR (scanned) + the code (typed/spoken fallback). Detail view only, so the
    // secret leaves the vault of the twin no wider than it must. Who may see it, and when, differs by how
    // the parcel was born:
    //
    //  - VENDOR ORDER (S22, unchanged): the RECEIVER only, and only once it is collectable. The store is
    //    the buyer's relay, so nobody else needs it from us.
    //  - PEER SEND: the SENDER as well, from the moment they hand the parcel over — they are the source of
    //    the code in the physical world and the only free channel to a receiver with no smartphone ("your
    //    code is 4821", over the call they were making anyway). Withholding it from the sender is what
    //    forced the destination shop to read the code aloud, which is no check at all. The receiver sees it
    //    from mint too: there is nothing to collect early, and a code you can look up before you travel is
    //    the difference between a wasted trip and a collected parcel.
    if (withToken) {
      const isPeerSend = !p.vendorId;
      const secret = p.collectionCode ?? p.otp;
      const audienceOk = relation === 'received' || isPeerSend; // the sender is a party only on a peer send
      // isCollectable, not Ready_For_Pickup: a parcel whose free window has run out is still collectable,
      // and hiding the receiver's own code at exactly the moment they are being urged to come would be a
      // notice telling somebody to collect a parcel and an app refusing to show them how.
      const stageOk = isPeerSend ? !TERMINAL_STATUSES.has(p.status) : isCollectable(p.status);
      if (secret && audienceOk && stageOk) {
        view.collectToken = { code: secret, qrPayload: `sbg:collect:${secret}` };
      }
    }
    return view;
  }

  /** Screen 1 — Accept Parcel (ingest). */
  accept(input: AcceptInput): Parcel {
    if (this.parcels.has(input.parcelId)) throw new GlosError('PARCEL_EXISTS', `Parcel ${input.parcelId} already exists`);
    if (!input.dropoffPhotoRef) throw new GlosError('PHOTO_REQUIRED', 'A drop-off photo is mandatory (fraud defence)');
    // A parcel can't be sent to the shop taking it in (origin == destination is unroutable — destZone would
    // equal originZone and never match a corridor). Mirrors createConsumerSend's same-shop refusal.
    if (input.destPudoDid && input.destPudoDid === input.agentDid) throw new GlosError('INVALID_INPUT', 'A parcel cannot be sent to the shop taking it in — pick a different destination.');
    const agent = this.agents.get(input.agentDid);
    // A counter take-in declares a size and a photo, never a contents list and a value, so a parcel handed
    // over this counter cannot be papered for a border. Compared shop-to-shop rather than through a quote,
    // because this flow prices from the wholesale rate and never asks for one.
    if (input.destPudoDid) {
      const dest = this.agents.get(input.destPudoDid);
      if (this.agents.countryOf(dest) !== this.agents.countryOf(agent)) {
        throw new GlosError(
          'CUSTOMS_INCOMPLETE',
          `${dest.shopName} is in another country, and a counter take-in cannot declare contents and value for a border — a store can ship there today`,
          { fromCountry: this.agents.countryOf(agent), toCountry: this.agents.countryOf(dest) },
        );
      }
    }
    /**
     * THE DOOR: may goods be taken in here at all, and under WHOSE promise?
     *
     * Asked at the counter rather than trusted from registration, because a country can move down the
     * ladder while a shop stands open. A walk-up is paid AT this counter, so the payer sits in the
     * shop's own country and there is no second jurisdiction to weigh; a shipment paid for somewhere
     * else is the other path, and it is P4.
     */
    const country = this.agents.countryOf(agent);
    const promise = this.presence.takeInPromise(country);
    if (promise === 'none') {
      // One refusal, in words about THIS shop and THIS country — not about daughter companies, and not
      // at the far end of a money path the shopkeeper cannot see.
      throw new GlosError('FORBIDDEN', `Nothing can be taken in at ${agent.shopName}: the network does not operate in ${country} yet`);
    }

    const mode: PaymentMode = input.paymentMode ?? 'cash';

    /**
     * WHERE THE PROMISE IS THE CARRIER’S, NO MONEY OF OURS MOVES — so there is nothing for us to
     * charge. Cash at the counter is OUR cash: it consumes a platform credit and posts against a float
     * we do not hold there. The carrier prices and collects its own work, so this refuses by name
     * rather than booking a fee into a company that does not exist in that country.
     */
    if (promise === 'theirs' && mode === 'cash') this.presence.require(country, 'cashOnDelivery');

    // 'No money, no scan' gate applies to cash parcels (they consume a platform credit).
    if (mode === 'cash' && !this.gate.canTransact(input.agentDid).ok) {
      throw new GlosError('WALLET_INSUFFICIENT', 'Insufficient funds. Top up to accept parcels.');
    }

    // The redesigned counter MEASURES the parcel (dims + weight) → derive the tier + cargo class exactly
    // like the vendor/Send mint (createInbound), so a size can't be under-declared. Dims present → derive
    // (defaulting the kg for classification when weight is absent, mirroring the sibling); no dims → trust
    // the legacy declared size tier.
    const size: ParcelSize = input.dimensionsCm ? classifySize({ ...input.dimensionsCm, kg: input.weightKg ?? SIZE_WEIGHT_KG[input.size ?? 'M'] }) : input.size ?? 'M';
    const weightKg = input.weightKg ?? SIZE_WEIGHT_KG[size];
    const dimsCm: [number, number, number] | undefined = input.dimensionsCm ? [input.dimensionsCm.l, input.dimensionsCm.w, input.dimensionsCm.h] : undefined;
    // S30: derive the cargo class from the measurements (dims + weight). A class needing dedicated
    // transport can never be a counter parcel — refuse it here so a genuinely heavy walk-up is sent to the
    // dedicated-freight lane instead of onto the bus (the counter can't book freight yet — a later slice).
    const natureCode: CargoNature = input.natureCode ?? 'GEN';
    const cargoClass = this.cargo.classify({ kg: weightKg, dimsCm });
    if (this.cargo.dedicatedRequired(cargoClass)) {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', `Cargo class ${cargoClass} is too large for the PUDO network — it needs dedicated freight transport`);
    }
    const now = new Date().toISOString();
    const anchorTxId = this.ledger.anchor({ p: input.parcelId, a: input.agentDid, s: size, dest: input.destZone, photo: input.dropoffPhotoRef, at: now }).txId;
    const parcel: Parcel = {
      parcelId: input.parcelId,
      did: this.mintShipmentDid(input.parcelId, 'outbound'), // DT — the twin's stable GLOS identity, minted at creation
      direction: 'outbound',
      size,
      dimensionsCm: input.dimensionsCm,
      weightKg,
      cargoClass,
      natureCode,
      fragile: input.fragile ?? false,
      originAgentDid: input.agentDid,
      committedNodeDid: input.agentDid,
      originZone: agent.zone,
      destZone: input.destZone,
      destAgentDid: input.destPudoDid, // optional nominated destination PUDO (else set at arrive)
      // R1 — a walk-up is paid at this counter, so the shop's own sister collects.
      // Absent where the promise is the carrier’s: no sister of ours is party to it, and naming one
      // would post into a company that does not operate in that country.
      ...(promise === 'ours' ? { collectingEntityId: this.agents.entityIdOf(agent) } : {}),
      // Kept on the parcel rather than derived later: a country can move while goods sit on a shelf,
      // and the promise made at the counter is the promise that was made.
      takeInPromise: promise,
      senderMobile: input.senderMobile,
      receiverMobile: input.receiverMobile,
      senderPhoneHash: hashPhone(input.senderMobile) || undefined,
      receiverPhoneHash: hashPhone(input.receiverMobile) || undefined,
      dropoffPhotoRef: input.dropoffPhotoRef,
      paymentMode: mode,
      status: 'At_PUDO',
      acceptedAt: now,
      // The release code is born HERE, with the sender standing at the counter — not at the far end when
      // the parcel arrives. It used to be minted by arrive() and handed to the destination agent, which
      // meant the only party who could hand the goods over was also the only party who knew the secret:
      // they read it aloud and the customer repeated it back, so the check proved nothing. Now the sender
      // leaves with it (drop-off slip / their twin) and passes it to the receiver over the channel they
      // already use, exactly as a store tells its buyer. The releasing shop never sees it.
      otp: releaseOtp(),
      otpAttempts: 0,
      // Walk-up parcels track too (S14): the sender SMS carries this key, exactly as the
      // vendor flow's does. Public surface, no PII — inbound parcels had it since day one
      // and the counter flow simply never minted one.
      trackingKey: `T-${randomBytes(5).toString('hex').toUpperCase()}`,
      // Born at this counter — and held by it from the same moment, because a walk-up is created BY the
      // shop taking it. The sender's own leg happened off the network, on the way here.
      birthplace: { kind: 'counter', atId: input.agentDid, label: agent.shopName, location: agent.location, at: now },
      custody: [{ holderId: input.agentDid, holderKind: 'shop', from: now, note: 'taken in at the counter' }],
      scans: [{ at: now, status: 'CREATED', by: input.agentDid, note: agent.shopName, anchorTxId }],
    };
    // DT — a printable label at creation for OUTBOUND too (the counter flow never issued one). Direction-aware:
    // shows the public tracking key, not a collection code. Persisted so it can be reprinted.
    parcel.label = this.label(parcel);
    this.parcels.set(parcel.parcelId, parcel);
    // S26: attach the drop-off proof to this parcel → shipment-proof bin (clock starts at terminal state).
    this.media.link(input.dropoffPhotoRef, { type: 'parcel', id: parcel.parcelId }, 'dropoff');

    /**
     * OUR MONEY MOVES ONLY WHERE OUR PROMISE STANDS.
     *
     * A parcel taken in under the carrier's promise is a RECORD, not a transaction: no shipping charged
     * to a float we do not hold, no labour accrued by a company that does not operate there. What the
     * network still does is the thing it went there to do — hold the custody chain, and prove it.
     */
    if (promise === 'ours') {
      if (mode === 'cash') {
        const rule = this.wholesaleTax(input.agentDid);
        const bill = taxOn(WHOLESALE, rule.ratePct);
        // Stamped, so the void refund reverses the rate this parcel was CHARGED at rather than whatever
        // the sister's rate happens to be at the moment somebody voids it. `shipmentTax` deliberately
        // stays unset: this parcel has no `shipmentCost`, and a tax stamped on a cost that does not exist
        // is a figure nothing can be reconciled against.
        parcel.taxPct = rule.ratePct;
        parcel.taxLabel = rule.label;
        this.gate.chargeShipping(input.agentDid, bill.gross, parcel.parcelId, bill.tax);
      } else {
        this.gate.payLabour(input.agentDid, LABOUR_FEE, parcel.parcelId, 'parcel', parcel.sellerEntityId);
      }
    }


    void this.events.publish(GlosEvent.Pudo.ParcelAccepted, { parcelId: parcel.parcelId, agentDid: input.agentDid, destZone: input.destZone, mode }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /** Screen 2 — Give to Bus (handover). Scan driver badge → manifest; scan each parcel; finish at 100%.
   * The badge resolves first to a registered fleet driver (with their coupled vehicle + capacity and
   * handling rules enforced); failing that, to a legacy corridor driver.
   *
   * S25 completeness gate — the compendium's "finish at 100%" made real. The server itself computes the
   * EXPECTED manifest (every parcel waiting at this shop bound for the driver's corridor destination) and
   * refuses (INCOMPLETE_MANIFEST) if the scan omits any of them, so a bus can never quietly pull away with
   * parcels left on the shelf. The only way past a short load is an explicit `acknowledgeShortShip` (with a
   * reason): those parcels are flagged for the control tower instead of silently forgotten. */
  handover(input: {
    agentDid: string;
    driverBadgeId: string;
    parcelIds: string[];
    acknowledgeShortShip?: boolean;
    shortShipReason?: string;
  }): HandoverResult {
    const fleet = this.fleet.resolveBadge(input.driverBadgeId);
    let badgeId: string;
    let corridorId: string;
    let corridorDestZone: string;
    let vehicleType: 'bus' | 'truck';
    if (fleet) {
      if (!fleet.corridorId) throw new GlosError('INVALID_STATE', 'Driver is not assigned to a corridor — assign one before handover');
      const corridor = this.corridors.requireCorridor(fleet.corridorId);
      badgeId = fleet.badgeId;
      corridorId = corridor.corridorId;
      corridorDestZone = corridor.destZone;
      vehicleType = fleet.vehicleType;
    } else {
      const driver = this.corridors.driverByBadge(input.driverBadgeId);
      if (!driver) throw new GlosError('INVALID_INPUT', 'Unknown driver badge — not a registered fleet driver or on the corridor whitelist');
      const corridor = this.corridors.requireCorridor(driver.corridorId);
      badgeId = driver.badgeId;
      corridorId = corridor.corridorId;
      corridorDestZone = corridor.destZone;
      vehicleType = driver.vehicleType;
    }

    // The expected manifest: every parcel waiting at THIS shop bound for the corridor's destination. The
    // agent app's accept picker only offers destZones served by a corridor from here, and an inbound stamps
    // the final dest zone, so in the direct-corridor model these are exactly the parcels this bus carries.
    // (Conservative for a future multi-hop leg: a parcel routed onward via an MDP has a different destZone
    // and simply isn't demanded here — the gate never blocks on a parcel it can't prove belongs on the bus.)
    const expected = this.list({ status: 'At_PUDO', agentDid: input.agentDid })
      .filter((p) => p.originAgentDid === input.agentDid && p.destZone === corridorDestZone)
      .map((p) => p.parcelId);
    const scanned = new Set(input.parcelIds);
    const unscanned = expected.filter((id) => !scanned.has(id));

    // The gate: a short load caused by simply NOT SCANNING an expected parcel is refused unless the agent
    // knowingly acknowledges it — nothing is mutated on the refusal path (all-or-acknowledged-nothing). A
    // parcel the agent DID scan but the vehicle cannot carry (fragile / over-weight / full) is not a silent
    // omission the agent can fix, so it is never blocked; it is reconciled and short-shipped below instead.
    if (unscanned.length && !input.acknowledgeShortShip) {
      throw new GlosError(
        'INCOMPLETE_MANIFEST',
        `${unscanned.length} parcel(s) for this bus are still waiting — scan them, or short-ship on purpose.`,
        { missed: unscanned, expected, corridorId },
      );
    }

    const handed: string[] = [];
    const rejected: Array<{ parcelId: string; reason: string }> = [];
    const manifestId = `man_${randomBytes(6).toString('hex')}`;
    let loadKg = 0;
    // S30: the natures already ON this vehicle, so each new parcel can be checked against the whole manifest
    // (the platform's first pairwise cargo awareness — before this, a manifest accumulated blind).
    const loadedNatures: CargoNature[] = [];

    for (const parcelId of input.parcelIds) {
      const parcel = this.parcels.get(parcelId);
      if (!parcel) { rejected.push({ parcelId, reason: 'unknown' }); continue; }
      if (parcel.originAgentDid !== input.agentDid) { rejected.push({ parcelId, reason: 'not_at_this_pudo' }); continue; }
      if (parcel.status !== 'At_PUDO') { rejected.push({ parcelId, reason: `status_${parcel.status}` }); continue; }
      const nature: CargoNature = parcel.natureCode ?? 'GEN';
      // S30 cargo compatibility (applies to ANY driver — it is parcel-vs-parcel, not vehicle-specific): this
      // parcel must be able to share the vehicle with everything already loaded. A strictly INCOMPATIBLE pair
      // (cement dust + fresh produce, LPG + anything) is refused; SEGREGATE passes at parcel granularity
      // because each parcel is its own sealed, labelled package. The left-behind is short-shipped below.
      if (loadedNatures.some((n) => !this.cargo.canShareVehicle(nature, n))) {
        rejected.push({ parcelId, reason: 'incompatible_cargo' });
        continue;
      }
      // Vehicle handling rules (fleet drivers only): per-parcel weight, cargo capability, fragile, capacity.
      if (fleet) {
        if (parcel.weightKg > fleet.maxParcelKg) { rejected.push({ parcelId, reason: `over_${fleet.maxParcelKg}kg_for_vehicle` }); continue; }
        // S30: the vehicle must actually have the capability this nature demands (perishable → a cold-chain
        // body, hazardous → a hazmat-capable vehicle) — the enforcement side of the previously-dead flags.
        const cap = this.cargo.requiredCapability(nature);
        if (cap && !fleet.vehicle[cap]) { rejected.push({ parcelId, reason: `vehicle_missing_${cap}` }); continue; }
        if (parcel.fragile && !fleet.allowsFragile) { rejected.push({ parcelId, reason: 'fragile_not_allowed_on_vehicle' }); continue; }
        if (loadKg + parcel.weightKg > fleet.capacityKg) { rejected.push({ parcelId, reason: 'vehicle_full' }); continue; }
      }

      loadedNatures.push(nature);
      parcel.status = 'On_Bus';
      parcel.corridorId = corridorId;
      parcel.driverBadgeId = badgeId;
      parcel.shortShippedAt = undefined; // it made the bus after all — clear any earlier short-ship marker
      parcel.shortShipReason = undefined;
      if (fleet && parcel.actualPerKm == null) parcel.actualPerKm = fleet.vehicle.pricePerKm; // the real carrier rate → flexible rebate
      parcel.handedToBusAt = new Date().toISOString();
      loadKg += parcel.weightKg;
      this.handTo(parcel, 'driver', this.driverIdOf(badgeId), `handed to the bus · manifest ${manifestId}`);
      this.scan(parcel, 'On_Bus', badgeId, `manifest ${manifestId}`);
      handed.push(parcelId);
      void this.events.publish(GlosEvent.Pudo.ParcelHandedToBus, { parcelId, driverBadgeId: badgeId, corridorId, manifestId }, { source: 'pudo' }).catch(() => undefined);
    }

    // Reconcile completeness against what ACTUALLY loaded, not merely what was scanned: any expected parcel
    // still on the shelf — whether the agent chose to leave it (acknowledged) OR the vehicle rejected it
    // (fragile / over-weight / full) — is a genuine left-behind. Stamp each so the control tower sees it now
    // (the Short_Shipped monitor flag), not after the 48 h stagnant window.
    const handedSet = new Set(handed);
    const rejectionReason = new Map(rejected.map((r) => [r.parcelId, r.reason]));
    const operatorReason = (input.shortShipReason ?? '').trim() || 'not loaded';
    const missed = expected.filter((id) => !handedSet.has(id) && this.parcels.get(id)?.status === 'At_PUDO');
    if (missed.length) {
      const at = new Date().toISOString();
      for (const parcelId of missed) {
        const parcel = this.parcels.get(parcelId)!; // guaranteed At_PUDO by the filter above
        parcel.shortShippedAt = at;
        // The vehicle's concrete rejection reason wins; otherwise the agent's acknowledged reason.
        parcel.shortShipReason = rejectionReason.get(parcelId) ?? operatorReason;
        // The scan note stays GENERIC: the reason lives on shortShipReason (control-tower only), never in the
        // timeline that BOTH the sender and receiver twins can read via toConsumerView (mirrors buyerDispute, S23).
        this.scan(parcel, 'At_PUDO', badgeId, `short-ship · left behind at manifest ${manifestId}`);
        void this.events.publish(GlosEvent.Pudo.ParcelShortShipped, { parcelId, driverBadgeId: badgeId, corridorId, manifestId, reason: parcel.shortShipReason }, { source: 'pudo' }).catch(() => undefined);
      }
    }

    // Pay the agent the handover fee once for the batch.
    if (handed.length) this.gate.payLabour(input.agentDid, HANDOVER_FEE, manifestId, 'manifest');

    // REP2 — surface the DID of the fleet driver who took the batch, so the shop can rate them for this leg
    // (a legacy corridor-whitelist driver has no registry DID and isn't rateable → undefined).
    return { manifestId, driverBadgeId: badgeId, driverDid: fleet ? fleet.driverDid : undefined, corridorId, vehicle: fleet ? vehicleType : this.corridors.chooseVehicle(loadKg), handed, rejected, expected, missed, shortShipped: missed.length > 0 };
  }

  /**
   * Arrival at the destination PUDO → Ready_For_Pickup, shelved and waiting.
   *
   * It no longer issues (or returns) the release code. The code was minted with the parcel and is held by
   * the sender and receiver; the shop that is about to hand the goods over must not be the shop that
   * knows the secret, or "the customer tells you the code" degrades into "you tell the customer the code".
   * A pre-slice parcel that arrives without one is given a code here as a fallback — that record's secret
   * genuinely does not exist yet, and refusing the arrival would strand real goods on a real shelf.
   */
  arrive(parcelId: string, destAgentDid: string): { parcelId: string; status: string; binSlot: string } {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'On_Bus') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected On_Bus`);
    parcel.status = 'Ready_For_Pickup';
    parcel.destAgentDid = destAgentDid;
    if (!parcel.otp && !parcel.collectionCode) parcel.otp = releaseOtp(); // legacy record, minted before the code moved to genesis
    parcel.otpAttempts = 0;
    parcel.otpLockedAt = undefined;
    parcel.binSlot = this.shelf.assign(destAgentDid, parcelId, parcel.size); // commit to a shelf slot for pickup (small parcels may bundle)
    this.handTo(parcel, 'shop', destAgentDid, 'arrived at the collection point');
    parcel.readyAt = new Date().toISOString(); // when the wait began — see Parcel.readyAt
    // The shelving half, paid HERE rather than at release. Receiving, scanning and committing a shelf
    // slot is finished work at this moment, and it stays finished whether or not anybody ever comes.
    this.gate.payLabour(destAgentDid, SHELVING_FEE, parcelId, 'parcel', parcel.sellerEntityId);
    this.scan(parcel, 'Ready_For_Pickup', destAgentDid, `arrived · shelf ${parcel.binSlot}`);
    void this.events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId, destAgentDid, binSlot: parcel.binSlot }, { source: 'pudo' }).catch(() => undefined);
    // No secret in this response: the customer brings the code, the shop checks it.
    return { parcelId, status: parcel.status, binSlot: parcel.binSlot };
  }

  /** Screen 3 — Customer Pickup (release) with the code the CUSTOMER brings. */
  pickup(parcelId: string, agentDid: string, otp: string, deliveredPhotoRef?: string): Parcel {
    const parcel = this.require(parcelId);
    // Unclaimed releases exactly like Ready_For_Pickup. The window closing changes what is OWED, never
    // whether the person standing at the counter with the right code may have their parcel.
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    if (parcel.otpLockedAt) throw new GlosError('OTP_LOCKED', 'Too many wrong codes — ask the control tower to reissue');

    if (parcel.otp !== (otp || '').trim()) {
      parcel.otpAttempts = (parcel.otpAttempts ?? 0) + 1;
      if (parcel.otpAttempts >= OTP_MAX_ATTEMPTS) {
        // Burn it. This is the only check standing between a stranger and someone else's parcel.
        parcel.otpLockedAt = new Date().toISOString();
        this.scan(parcel, 'Ready_For_Pickup', agentDid, 'OTP locked after repeated wrong codes');
        throw new GlosError('OTP_LOCKED', 'Too many wrong codes — ask the control tower to reissue');
      }
      this.persist(parcel); // keep the attempt counter durable so a restart can't reset the lockout
      throw new GlosError('OTP_INVALID', 'Incorrect OTP');
    }

    parcel.status = 'Delivered';
    parcel.deliveredAt = new Date().toISOString();
    parcel.deliveredPhotoRef = deliveredPhotoRef;
    // S26: the delivered proof + any earlier drop-off proof enter the 90-day shipment-proof window now.
    this.media.link(deliveredPhotoRef, { type: 'parcel', id: parcelId }, 'pod');
    this.media.anchorParcelTerminal(parcelId);
    this.shelf.release(parcel.destAgentDid ?? agentDid, parcelId); // free the shelf slot
    this.handTo(parcel, 'receiver', parcel.receiverPhoneHash ?? 'receiver', 'collected in person');
    this.endCustody(parcel);
    this.scan(parcel, 'Delivered', agentDid, 'OTP verified');
    void this.events.publish(GlosEvent.Pudo.ParcelDelivered, { parcelId, agentDid }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /** Reverse logistics — void within the 5-minute window; refunds the shipping charge. */
  void(parcelId: string, agentDid: string, voidedPhotoRef: string): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.originAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Only the accepting PUDO can void');
    if (parcel.status !== 'At_PUDO') throw new GlosError('INVALID_STATE', 'Only an At_PUDO parcel can be voided');
    if (Date.now() - new Date(parcel.acceptedAt).getTime() > VOID_WINDOW_MS) throw new GlosError('WINDOW_EXPIRED', 'Void window has expired');
    if (!voidedPhotoRef) throw new GlosError('PHOTO_REQUIRED', 'A photo of the voided label is required');

    parcel.status = 'Voided';
    // S26: the torn-label void proof + the original drop-off proof enter the shipment-proof window now.
    this.media.link(voidedPhotoRef, { type: 'parcel', id: parcel.parcelId }, 'dropoff');
    this.media.anchorParcelTerminal(parcel.parcelId);
    this.endCustody(parcel); // undone at the counter: the network is not holding it any more
    this.scan(parcel, 'Voided', agentDid, 'voided + refunded');
    this.reverseIntakeCharge(parcel, agentDid);
    void this.events.publish(GlosEvent.Pudo.ParcelVoided, { parcelId, agentDid }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /**
   * Undo the money an At_PUDO cash intake moved, so a void/cancel nets the agent wallet to zero. TWO cash
   * intakes charge differently and must be reversed differently: a peer-send (senderMobile 'app') was
   * charged its LOCKED shipmentCost AND credited a LABOUR_FEE at intake — reverse BOTH; a legacy walk-up
   * was charged a flat WHOLESALE and paid no labour — refund WHOLESALE. A prepaid vendor inbound moved no
   * agent cash here (its billing is the vendor's), so nothing to reverse.
   */
  private reverseIntakeCharge(parcel: Parcel, agentDid: string): void {
    if (parcel.paymentMode !== 'cash') return;
    if (parcel.senderMobile === 'app') {
      // The locked price the shop remitted, and the tax inside it — reversed together, because a voided
      // sale un-owes its tax as surely as it un-earns its revenue.
      this.gate.refund(agentDid, parcel.shipmentCost ?? 0, parcel.parcelId, parcel.shipmentTax, parcel.shipmentProvision);
      this.gate.clawbackLabour(agentDid, LABOUR_FEE, parcel.parcelId); // reverse the +LABOUR_FEE paid at intake
    } else {
      // At the rate stamped on the parcel at intake, never today's — a sister that changed its rate inside
      // the void window must not make a refund differ from the charge it reverses. A parcel from before
      // the stamp existed reads zero, which is exactly what it was charged.
      const bill = taxOn(WHOLESALE, parcel.taxPct ?? 0);
      this.gate.refund(agentDid, bill.gross, parcel.parcelId, bill.tax);
    }
  }

  /** Reverse logistics: cancel a parcel that has NOT yet been delivered/picked up. Refunds a cash
   * shipping charge if it is still at the accepting PUDO. (A more complete return-to-sender is future.) */
  cancel(parcelId: string, by = 'ops', reason?: string): Parcel {
    const parcel = this.require(parcelId);
    // Ready_For_Pickup is admitted, but ONLY once it has genuinely been abandoned. Without the window
    // this would be a button that cancels a shipment which arrived an hour ago and is about to be
    // collected; with it, it is the only way out of the one state that had none.
    // 'Unclaimed' says this out loud now, so the arithmetic is only a fallback for a parcel the sweep
    // has not reached yet. Both kept: a cancel must not depend on a timer having run.
    const abandoned =
      parcel.status === 'Unclaimed' ||
      (parcel.status === 'Ready_For_Pickup' &&
        Date.now() - new Date(parcel.readyAt ?? parcel.acceptedAt).getTime() > UNCOLLECTED_H * 3_600_000);
    if (!abandoned && !['Created', 'At_PUDO', 'At_MDP'].includes(parcel.status)) {
      throw new GlosError(
        'INVALID_STATE',
        parcel.status === 'Ready_For_Pickup'
          ? `It is waiting to be collected — it can only be called off after ${Math.round(UNCOLLECTED_H / 24)} days unclaimed`
          : `Cannot cancel a ${parcel.status} parcel`,
      );
    }
    // The shelf is the scarce thing. A cancelled parcel that still counted against a shop's capacity would
    // leave the network exactly as short of slots as the uncollected one it replaced.
    if (isCollectable(parcel.status) && parcel.destAgentDid) this.shelf.release(parcel.destAgentDid, parcel.parcelId);
    // Only an At_PUDO cash parcel moved agent cash at intake; reverse it flow-correctly (peer-send vs walk-up).
    // Only a parcel a SHOP took in has an intake charge to reverse — a dock parcel never had one, because
    // no shop ever handled it.
    if (parcel.status === 'At_PUDO' && parcel.originAgentDid) this.reverseIntakeCharge(parcel, parcel.originAgentDid);
    parcel.status = 'Voided';
    this.media.anchorParcelTerminal(parcel.parcelId); // S26: shipment-proof retention starts at this terminal state
    this.scan(parcel, 'Voided', by, reason ? `cancelled · ${reason}` : 'cancelled');
    void this.events.publish(GlosEvent.Pudo.ParcelVoided, { parcelId, agentDid: by, cancelled: true }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  // --- inbound (e-commerce pickup-at-PUDO) ---

  /**
   * Vendor mint: create an inbound parcel from a checkout selection. The size tier is DERIVED from the
   * declared dimensions + weight (not chosen — kills "small for the vendor is large for the shipper").
   * Generates the handover collection code AND a public tracking key, persists the label, and books the
   * split/contribution settlement (buyer's capped share + the vendor's share).
   */
  createInbound(input: { vendorId: string; externalOrderId?: string; originAgentDid?: string; originZone?: string; destAgentDid: string; buyerMobile: string; buyerEmail?: string; size?: ParcelSize; dimensionsCm?: { l: number; w: number; h: number }; weightKg?: number; contentPhotoRef: string; fragile?: boolean; natureCode?: CargoNature; items?: Array<{ name: string; qty: number }>; subtotal?: number; declaredValue?: number; shippingPolicy: ShippingPolicy; routeMode?: 'flexible' | 'locked'; quote: ShipmentQuote }): { parcel: Parcel; label: PhygitalLabel | null; paid: boolean } {
    const dest = this.agents.get(input.destAgentDid);
    const vendor = this.vendors.get(input.vendorId); // the store IS the birthplace — read it, don't infer it
    // A parcel handed in at a shop names that shop; one collected from the store's own dock names none,
    // and takes its zone from the dock. It is not origin-LESS — it is born at the store either way — it
    // simply has no first PUDO, which is a different fact and now recorded as one.
    const origin = input.originAgentDid ? this.agents.get(input.originAgentDid) : undefined;
    const originZone = origin?.zone ?? input.originZone;
    if (!originZone) throw new GlosError('FIELD_REQUIRED', 'A shipment needs an origin: a drop-off PUDO, or the store collection point it leaves from');
    if (!input.contentPhotoRef) throw new GlosError('PHOTO_REQUIRED', 'A photo of the contents is required (the baseline for dispute resolution)');
    // Derive the tier from dimensions+weight when provided; otherwise trust the explicit size.
    const size: ParcelSize = input.dimensionsCm ? classifySize({ ...input.dimensionsCm, kg: input.weightKg ?? SIZE_WEIGHT_KG[input.size ?? 'M'] }) : (input.size ?? 'M');
    const weightKg = input.weightKg ?? SIZE_WEIGHT_KG[size];
    // S30: derive the cargo class from the SAME weight+dims and gate the pipeline. A vendor can genuinely
    // mint an over-limit order (a pallet of tiles), so unlike the counter flow this gate really bites: a
    // P4+ load can never enter the PUDO/tote network and is refused here (dedicated freight, a later slice).
    const natureCode: CargoNature = input.natureCode ?? 'GEN';
    const cargoClass = this.cargo.classify({ kg: weightKg, dimsCm: input.dimensionsCm ? [input.dimensionsCm.l, input.dimensionsCm.w, input.dimensionsCm.h] : undefined });
    if (this.cargo.dedicatedRequired(cargoClass)) {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', `Cargo class ${cargoClass} is too large for the PUDO network — it needs dedicated freight transport`);
    }
    const now = new Date().toISOString();
    const quote = input.quote;
    // THE CROSSING IS A STEP, and this is its precondition — checked before an id, a DID or a ledger anchor
    // is spent, because a shipment that cannot legally travel should leave no trace of having been started.
    // A store selling across a border already types both of these at checkout; one that does not cannot
    // ship there, and is told which part it is missing.
    const customs = quote.crossesBorder
      ? declareFor({
          crossings: quote.crossings,
          items: input.items,
          declaredValue: input.subtotal,
          currency: quote.currency,
          exporterId: input.vendorId,
          importerRef: hashPhone(input.buyerMobile) || undefined,
          at: now,
          context: 'This shipment',
        })
      : undefined;

    const parcelId = `PUD-${randomBytes(5).toString('hex').toUpperCase()}`;
    const collectionCode = `COL-${randomBytes(4).toString('hex').toUpperCase()}`;
    const trackingKey = `T-${randomBytes(5).toString('hex').toUpperCase()}`;
    const anchorTxId = this.ledger.anchor({ p: parcelId, v: input.vendorId, o: input.originAgentDid, d: input.destAgentDid, at: now }).txId;

    // Open-data quote: vendor is billed the FULL cost (prepaid). flexible reserves the ceiling (rebated on
    // delivery); locked commits the cheapest route. The buyer-charge is REPORTED only (collected at checkout).
    const routeMode = input.routeMode === 'locked' ? 'locked' : 'flexible';
    const chosen = routeMode === 'locked' ? quote.locked : quote.flexible;
    // GROSS — what actually leaves the store's float. `chosen.total` is the sister's own price and stays
    // the basis of every margin figure; what a customer is billed is that plus the tax on it.
    // THE COVER. A merchant order already says what the goods are worth — the buyer paid that at
    // checkout — so the subtotal IS the declaration and nobody is asked a question they have already
    // answered. `declaredValue` overrides it for a store that insures at a different figure.
    const cover = coverFor({ declaredValue: input.declaredValue ?? input.subtotal, ...quote.insurance });
    // GROSS — what actually leaves the store's float. `chosen.total` is the sister's own price and stays
    // the basis of every margin figure; what a customer is billed is that, plus the tax on it, plus the
    // premium for cover they chose to buy. The premium is its OWN line and never hides inside the fee.
    const shipmentCost = Math.round((chosen.gross + cover.premium) * 100) / 100;
    const platformFee = Math.round((chosen.total - chosen.base) * 100) / 100;
    const buyerCharge = this.buyerCharge(input.shippingPolicy, shipmentCost, input.subtotal ?? 0);

    const parcel: Parcel = {
      parcelId,
      did: this.mintShipmentDid(parcelId, 'inbound'), // DT — the twin's stable GLOS identity, minted at creation
      direction: 'inbound',
      size,
      dimensionsCm: input.dimensionsCm,
      weightKg,
      cargoClass,
      natureCode,
      fragile: input.fragile ?? false,
      originAgentDid: input.originAgentDid,
      // Committed to a first-mile shop only when there is one. A dock parcel commits to nobody: it waits at
      // the store until a driver takes it, which is the whole point of collecting from the store.
      committedNodeDid: input.originAgentDid,
      originZone,
      destZone: dest.zone,
      destAgentDid: input.destAgentDid,
      // R1 — a vendor order is paid by the store, so the store's sister collects (and bills its float).
      collectingEntityId: this.vendors.entityIdOf(this.vendors.get(input.vendorId)),
      senderMobile: 'vendor',
      receiverMobile: input.buyerMobile,
      // Vendor is not a person → no sender hash; the buyer (receiver) is, so they see this in their app.
      receiverPhoneHash: hashPhone(input.buyerMobile) || undefined,
      buyerEmail: input.buyerEmail,
      paymentMode: 'prepaid',
      status: 'Created',
      vendorId: input.vendorId,
      externalOrderId: input.externalOrderId,
      collectionCode,
      trackingKey,
      items: input.items,
      contentPhotoRef: input.contentPhotoRef,
      subtotal: input.subtotal,
      routeMode,
      routeKm: quote.totalKm,
      nodeFees: quote.nodeFees,
      transportCost: chosen.transport,
      platformFee,
      platformFeePct: quote.platformFeePct, // the rate quoted, locked to this parcel
      // …and what that rate was MADE of, for the same reason: a knob turned tomorrow must not rewrite
      // why a shipment sold today was priced as it was.
      rateStack: { costOfRiskPct: quote.rates.costOfRiskPct, profitOnRiskPct: quote.rates.profitOnRiskPct, marginPct: quote.rates.marginPct },
      // …and the size factor the transport was quoted at, for exactly the same reason. It is a network
      // constant today, but it is one somebody will retune — and the flexible rebate RE-COMPUTES this
      // parcel's real cost at delivery. Unstamped, retuning it would silently re-price every parcel
      // already sold and in the air, which is the one thing this whole block exists to prevent.
      transportFactor: quote.transportFactor,
      // …and the tax, which is stamped for a reason the knobs above do not have: a rate is changed by a
      // government on a date, and every sale before it was correctly taxed at the old one. Recomputing
      // from today's rate would restate history that the authority itself does not restate.
      taxPct: quote.tax.ratePct,
      taxLabel: quote.tax.label,
      shipmentTax: chosen.tax,
      // …and the cover inside the platform fee. Stamped for the same reason and one more: a refund must
      // release exactly what the billing set aside, and a knob turned in between must not change that.
      shipmentProvision: chosen.provision,
      // …and what we promised to cover if we break it, at the policy in force the day it was sold.
      declaredValue: cover.declaredValue || undefined,
      coverLimit: cover.limit,
      shipmentPremium: cover.premium,
      // What the price IS, and — where the route crossed a currency line — the rates it was struck at.
      // Same reason as the margin rate above: a promise is made at a moment, and the rate behind it moves.
      currency: quote.currency,
      fx: quote.fx,
      customs,
      sellerEntityId: quote.sellerEntityId,
      shipmentCost,
      ceilingCost: quote.flexible.gross, // the money HELD, so gross — the rebate gives back the same kind
      ceilingTax: quote.flexible.tax,
      ceilingProvision: quote.flexible.provision, // …and the tax within it, so the rebate can un-owe exactly what was owed
      buyerCharge,
      paidStatus: 'unpaid',
      acceptedAt: now,
      // Born at the STORE, not at the shop it will be handed in at — the two were always different facts
      // and only one of them was recorded. The store holds its own goods until it parts with them, whether
      // that is over a counter or onto a driver at its own dock.
      birthplace: { kind: 'store', atId: input.vendorId, label: vendor.name, location: vendor.location, at: now },
      custody: [{ holderId: input.vendorId, holderKind: 'sender', from: now, note: 'packed at the store' }],
      scans: [{ at: now, status: 'CREATED', by: input.vendorId, note: `inbound · order ${input.externalOrderId ?? '—'}`, anchorTxId }],
    };
    this.parcels.set(parcelId, parcel);
    // S26: attach the vendor's content photo (the baseline a dispute is judged against) to the parcel →
    // shipment-proof bin. Without this link the orphan-reaper would delete it before the parcel is delivered.
    this.media.link(input.contentPhotoRef, { type: 'parcel', id: parcelId }, 'content');

    // Prepaid gate: bill the vendor's balance with the country daughter company → 'ParcelPaid' or 'unpaid'.
    const bill = this.vendors.billShipment(input.vendorId, parcelId, shipmentCost, quote.fx?.buffer, chosen.tax, Math.round((chosen.provision + cover.premium) * 100) / 100);
    parcel.paidStatus = bill.paid ? 'ParcelPaid' : 'unpaid';
    const label = this.label(parcel, dest.shopName);
    if (bill.paid) {
      parcel.label = label; // label issues only once paid (printing is no longer blocked)
      void this.events.publish(GlosEvent.Pudo.InboundCreated, { parcelId, vendorId: input.vendorId, originAgentDid: input.originAgentDid, destAgentDid: input.destAgentDid }, { source: 'pudo' }).catch(() => undefined);
      void this.events.publish(GlosEvent.Pudo.ParcelPaid, { parcelId, vendorId: input.vendorId, originAgentDid: input.originAgentDid, amount: shipmentCost, externalOrderId: input.externalOrderId }, { source: 'pudo' }).catch(() => undefined);
    }
    this.persist(parcel); // paidStatus/label were mutated after the initial set()
    return { parcel, label: bill.paid ? label : null, paid: bill.paid };
  }

  // --- consumer pre-mint (PG1) — the Send app's parcel genesis, identical to the vendor console's ---

  /**
   * PG1 — a signed-in PERSON mints their peer send in-app, BEFORE drop-off: the same derived size +
   * cargo gate, the same price lock, the same shipment DID + twin-with-journey + printable label the
   * vendor mint gets. Cash at the counter: nothing is billed here — the price LOCKS now and the shop
   * collects it at the drop-off scan, so the label issues immediately (it is the sender's drop-off
   * credential, not a payment receipt).
   */
  createConsumerSend(input: { senderPersonDid: string; senderPhoneHash: string; receiverMobile: string; originAgentDid: string; destAgentDid: string; dimensionsCm: { l: number; w: number; h: number }; weightKg: number; fragile?: boolean; natureCode?: CargoNature; quote: ShipmentQuote }): { parcel: Parcel; label: PhygitalLabel } {
    const origin = this.agents.get(input.originAgentDid);
    const dest = this.agents.get(input.destAgentDid);
    if (input.originAgentDid === input.destAgentDid) throw new GlosError('INVALID_INPUT', 'Drop-off and collection shop must be two different shops');
    // A person sending from a counter declares nothing — the flow asks for a size and a photo, not a
    // contents list and a value — so a crossing cannot be papered. Refusing is the honest answer: the
    // alternative is minting an undeclared international shipment and letting a border post discover it.
    if (input.quote.crossesBorder) {
      throw new GlosError(
        'CUSTOMS_INCOMPLETE',
        'Sending to another country needs a declared contents list and value, which a counter send cannot take yet — a store can ship there today',
        { crossings: input.quote.crossings.map((c) => `${c.fromCountry}→${c.toCountry}`) },
      );
    }
    const size = classifySize({ ...input.dimensionsCm, kg: input.weightKg });
    const natureCode: CargoNature = input.natureCode ?? 'GEN';
    const cargoClass = this.cargo.classify({ kg: input.weightKg, dimsCm: [input.dimensionsCm.l, input.dimensionsCm.w, input.dimensionsCm.h] });
    if (this.cargo.dedicatedRequired(cargoClass)) {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', `Cargo class ${cargoClass} is too large for the PUDO network — it needs dedicated freight transport`);
    }
    const parcelId = `PUD-${randomBytes(5).toString('hex').toUpperCase()}`;
    const trackingKey = `T-${randomBytes(5).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const anchorTxId = this.ledger.anchor({ p: parcelId, s: input.senderPersonDid, o: input.originAgentDid, d: input.destAgentDid, at: now }).txId;
    const quote = input.quote;
    // Always the LOCKED (cheapest) leg: flexible's ceiling is refunded on delivery via the VENDOR prepaid
    // rail (rebateFlexible), which a cash-at-counter person has no account on — flexible here would just
    // keep the over-hold. ceilingCost stays stamped for artefact parity with the vendor mint.
    const routeMode = 'locked' as const;
    const chosen = quote.locked;
    const parcel: Parcel = {
      parcelId,
      did: this.mintShipmentDid(parcelId, 'outbound'), // DT — the twin's stable GLOS identity, minted at creation
      direction: 'outbound',
      size,
      dimensionsCm: input.dimensionsCm,
      weightKg: input.weightKg,
      cargoClass,
      natureCode,
      fragile: input.fragile ?? false,
      originAgentDid: input.originAgentDid,
      committedNodeDid: input.originAgentDid,
      originZone: origin.zone,
      destZone: dest.zone,
      destAgentDid: input.destAgentDid,
      // R1 — a peer send is paid in cash at the drop-off counter, so the origin shop's sister collects.
      collectingEntityId: this.agents.entityIdOf(origin),
      // The sender is an authenticated PERSON: the join key is their verified-phone HASH (S32d — never the
      // number). 'app' marks an in-app mint the way 'vendor' marks a store mint.
      senderMobile: 'app',
      senderPhoneHash: input.senderPhoneHash,
      receiverMobile: input.receiverMobile,
      receiverPhoneHash: hashPhone(input.receiverMobile) || undefined,
      paymentMode: 'cash', // collected by the shop at drop-off, against the locked price below
      status: 'Created',
      trackingKey,
      routeMode,
      routeKm: quote.totalKm,
      nodeFees: quote.nodeFees,
      transportCost: chosen.transport,
      platformFee: Math.round((chosen.total - chosen.base) * 100) / 100,
      platformFeePct: quote.platformFeePct, // the rate quoted, locked to this parcel
      // …and what that rate was MADE of, for the same reason: a knob turned tomorrow must not rewrite
      // why a shipment sold today was priced as it was.
      rateStack: { costOfRiskPct: quote.rates.costOfRiskPct, profitOnRiskPct: quote.rates.profitOnRiskPct, marginPct: quote.rates.marginPct },
      // …and the size factor the transport was quoted at, for exactly the same reason. It is a network
      // constant today, but it is one somebody will retune — and the flexible rebate RE-COMPUTES this
      // parcel's real cost at delivery. Unstamped, retuning it would silently re-price every parcel
      // already sold and in the air, which is the one thing this whole block exists to prevent.
      transportFactor: quote.transportFactor,
      // …and the tax, which is stamped for a reason the knobs above do not have: a rate is changed by a
      // government on a date, and every sale before it was correctly taxed at the old one. Recomputing
      // from today's rate would restate history that the authority itself does not restate.
      taxPct: quote.tax.ratePct,
      taxLabel: quote.tax.label,
      shipmentTax: chosen.tax,
      // …and the cover inside the platform fee. Stamped for the same reason and one more: a refund must
      // release exactly what the billing set aside, and a knob turned in between must not change that.
      shipmentProvision: chosen.provision,
      currency: quote.currency, // the cash the shop will take at the counter is in a named money
      fx: quote.fx,
      sellerEntityId: quote.sellerEntityId,
      shipmentCost: chosen.total,
      ceilingCost: quote.flexible.gross, // the money HELD, so gross — the rebate gives back the same kind
      ceilingTax: quote.flexible.tax,
      ceilingProvision: quote.flexible.provision, // …and the tax within it, so the rebate can un-owe exactly what was owed
      paidStatus: 'unpaid',
      acceptedAt: now,
      // Minted with the parcel (see accept()): the sender holds the release code in their own twin from
      // this moment and relays it to the receiver. Nothing about the handover secret waits for arrival.
      otp: releaseOtp(),
      otpAttempts: 0,
      // Born in the sender's own hands. We know WHOSE, not WHERE — a person packs a parcel wherever they
      // are — so the point is honestly absent rather than guessed at from the shop they chose.
      birthplace: { kind: 'hand', atId: input.senderPersonDid, label: 'the sender', at: now },
      custody: [{ holderId: input.senderPersonDid, holderKind: 'sender', from: now, note: 'packed by the sender' }],
      scans: [{ at: now, status: 'CREATED', by: input.senderPersonDid, note: `peer send · drop off at ${origin.shopName}`, anchorTxId }],
    };
    parcel.label = this.label(parcel, dest.shopName); // outbound branch: tracking key, no handover secret
    this.parcels.set(parcelId, parcel);
    void this.events.publish(GlosEvent.Pudo.ParcelMinted, { parcelId, originAgentDid: input.originAgentDid, destAgentDid: input.destAgentDid }, { source: 'pudo' }).catch(() => undefined);
    return { parcel, label: parcel.label };
  }

  /** What the e-commerce checkout charges the buyer (reported only — full price, or up to the cap). */
  private buyerCharge(policy: ShippingPolicy, cost: number, subtotal: number): number {
    if (policy.mode === 'full') return cost;
    if (subtotal >= policy.freeOverSubtotal) return 0;
    return Math.round(Math.min(policy.buyerContributionCap, cost) * 100) / 100;
  }

  /** Retry the prepaid gate after a top-up: bill an unpaid parcel → issue the label + ParcelPaid on success. */
  settleUnpaid(parcelId: string): { parcel: Parcel; label: PhygitalLabel | null; paid: boolean } {
    const parcel = this.require(parcelId);
    if (parcel.direction !== 'inbound' || !parcel.vendorId) throw new GlosError('NOT_INBOUND', 'Not a vendor shipment');
    if (parcel.paidStatus === 'ParcelPaid') return { parcel, label: parcel.label ?? null, paid: true };
    const dest = parcel.destAgentDid ? this.agents.get(parcel.destAgentDid) : undefined;
    // The buffer travels on the parcel, so a shipment billed later — after a top-up — splits exactly as
    // one billed at mint would. The rate it was struck at is not re-derived; it is the one it was quoted at.
    const bill = this.vendors.billShipment(parcel.vendorId, parcelId, parcel.shipmentCost ?? 0, parcel.fx?.buffer, parcel.shipmentTax, parcel.shipmentProvision);
    if (!bill.paid) return { parcel, label: null, paid: false };
    parcel.paidStatus = 'ParcelPaid';
    parcel.label = dest ? this.label(parcel, dest.shopName) : parcel.label;
    this.persist(parcel);
    void this.events.publish(GlosEvent.Pudo.ParcelPaid, { parcelId, vendorId: parcel.vendorId, originAgentDid: parcel.originAgentDid, amount: parcel.shipmentCost, externalOrderId: parcel.externalOrderId }, { source: 'pudo' }).catch(() => undefined);
    return { parcel, label: parcel.label ?? null, paid: true };
  }

  /** Public track-and-trace by the shareable tracking key — no PII, no handover secret (Risk: code leak). */
  track(trackingKey: string): {
    ref: string;
    status: ParcelStatus;
    size: ParcelSize;
    destination: string;
    destZone: string;
    steps: Array<{ status: string; at: string }>;
    binSlot?: string;
    destinationLandmark?: string;
    destinationLocation?: { lat: number; lng: number };
  } {
    const parcel = [...this.parcels.values()].find((p) => p.trackingKey === trackingKey);
    if (!parcel) throw new GlosError('NOT_FOUND', 'No parcel for that tracking key');
    const dest = parcel.destAgentDid ? this.agents.list().find((a) => a.did === parcel.destAgentDid) : undefined;
    return {
      ref: parcel.parcelId,
      status: parcel.status,
      size: parcel.size,
      destination: dest?.shopName ?? parcel.destZone,
      destZone: parcel.destZone,
      binSlot: isCollectable(parcel.status) ? parcel.binSlot : undefined,
      // The collect card (rev 5 "show me the way"): landmark + pin of the destination shop.
      // Both are already public via GET /network/points, so this adds no new exposure —
      // still no PII and no collection code on this surface. Additive for the legacy page.
      destinationLandmark: dest?.landmark,
      destinationLocation: dest?.location,
      // O2 audit (S22): status + time ONLY — the raw operator scan NOTE is deliberately NOT exposed here.
      // It carried the vendor's externalOrderId ("inbound · order …") and other operator text; the public
      // track ladder derives its words from `status`, so dropping the note removes the leak with no UI cost.
      steps: parcel.scans.map((s) => ({ status: s.status, at: s.at })),
    };
  }

  /**
   * PG2 — origin PUDO scans a PERSON's pre-minted parcel in (Created → At_PUDO): the counter half of the
   * in-app mint. The shop collects the LOCKED price in cash and remits it from its wallet (then earns the
   * same labour fee as any intake — its net is exactly a vendor intake plus holding the cash), the drop-off
   * photo is taken NOW (walk-up parity, fraud defence), and acceptedAt is re-stamped — the void window runs
   * from PHYSICAL drop-off, not from the at-home mint.
   */
  intakeConsumerSend(parcelId: string, agentDid: string, dropoffPhotoRef?: string): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.direction !== 'outbound' || !parcel.senderPhoneHash || parcel.vendorId) throw new GlosError('INVALID_STATE', 'Not a pre-minted peer send');
    if (parcel.status !== 'Created') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Created`);
    if (parcel.originAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Drop-off only at the shop the sender chose — the price is locked to that route');
    if (!dropoffPhotoRef) throw new GlosError('PHOTO_REQUIRED', 'A drop-off photo is mandatory (fraud defence)');
    const due = parcel.shipmentCost ?? 0;
    const gate = this.gate.canTransact(agentDid);
    if (!gate.ok || gate.balance < due) throw new GlosError('WALLET_INSUFFICIENT', 'Insufficient funds to remit this parcel — top up first.');
    parcel.status = 'At_PUDO';
    parcel.acceptedAt = new Date().toISOString();
    parcel.dropoffPhotoRef = dropoffPhotoRef;
    parcel.paidStatus = 'ParcelPaid'; // the sender paid the shop in cash, against the price locked at mint
    this.handTo(parcel, 'shop', agentDid, 'dropped off at the counter');
    this.scan(parcel, 'At_PUDO', agentDid, 'peer-send drop-off · cash collected');
    // adopt(), not link(): the photo id came from the CLIENT — only a photo the acting shop owns and that
    // isn't attached elsewhere may bind here (S29/S33a media-laundering guard).
    this.media.adopt(dropoffPhotoRef, agentDid, { type: 'parcel', id: parcelId }, 'dropoff');
    if (due > 0) this.gate.chargeShipping(agentDid, due, parcelId, parcel.shipmentTax, parcel.shipmentProvision); // remit the collected cash, tax and all (a 0-priced route charges nothing)
    this.gate.payLabour(agentDid, LABOUR_FEE, parcelId, 'parcel', parcel.sellerEntityId);
    void this.events.publish(GlosEvent.Pudo.ParcelAccepted, { parcelId, agentDid, destZone: parcel.destZone, mode: 'cash' }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /** Origin PUDO scans the vendor's parcel in (Created → At_PUDO). Pre-paid: labour fee, no gate. */
  intakeInbound(parcelId: string, agentDid: string): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.direction !== 'inbound') throw new GlosError('NOT_INBOUND', 'Not an inbound parcel');
    if (parcel.status !== 'Created') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Created`);
    if (parcel.paidStatus !== 'ParcelPaid') throw new GlosError('SHIPMENT_NOT_PAID', 'Shipment is not paid — the vendor must prepay before the PUDO accepts it');
    if (parcel.originAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Intake only at the vendor-selected origin PUDO');
    parcel.status = 'At_PUDO';
    parcel.acceptedAt = new Date().toISOString();
    this.handTo(parcel, 'shop', agentDid, 'handed in at the counter');
    this.scan(parcel, 'At_PUDO', agentDid, 'inbound intake');
    this.gate.payLabour(agentDid, LABOUR_FEE, parcelId, 'parcel', parcel.sellerEntityId);
    void this.events.publish(GlosEvent.Pudo.ParcelAccepted, { parcelId, agentDid, destZone: parcel.destZone, mode: 'prepaid' }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /**
   * Close a stranded parcel because it is going home instead.
   *
   * Deliberately NOT 'Delivered': nobody collected it, and writing one down as though somebody had would
   * put a lie in the very history a damage claim is judged against. Deliberately not 'Voided' either —
   * the shipment was performed, it did arrive; what failed afterwards is that nobody came for it.
   * 'Returned' is its own ending and it carries a pointer to the journey home, so the two parcels read as
   * one story rather than as an abandonment and an unexplained new shipment.
   */
  /**
   * The free collection window has run out.
   *
   * A change in TERMS, not in availability. The parcel is still on the shelf and still releases to
   * whoever holds the code — every guard on the release paths asks isCollectable() for exactly this
   * reason. What changes is that the shop starts being paid by the day and somebody owes for that.
   *
   * The transition lives here rather than in the service that decides WHEN, because this is the class
   * that owns a parcel's fields and its scan trail; putting the write anywhere else means a state change
   * that never reaches the timeline two people later have to argue over.
   */
  markUnclaimed(parcelId: string, at: number = Date.now()): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'Ready_For_Pickup') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    parcel.status = 'Unclaimed';
    parcel.unclaimedAt = new Date(at).toISOString();
    this.scan(parcel, 'Unclaimed', parcel.destAgentDid ?? 'network', 'collection window closed · still on the shelf');
    return parcel;
  }

  /**
   * …and the way back: a receiver bought more time.
   *
   * Straight back to Ready_For_Pickup with a fresh readyAt, which is not a trick — somebody who has just
   * been granted a new window is inside a free one by definition. It matters that this is the SAME pair
   * of fields the ordinary path uses: the monitor flag, the uncollected reminder and the return sweep
   * all key off (status, readyAt), so all three resume correctly without knowing extensions exist.
   *
   * A chargeable extension keeps its holding clock running by re-stamping unclaimedAt to now, so the
   * meter restarts rather than compounding what was already owed.
   */
  reopenCollection(parcelId: string, at: number, chargeable: boolean, note: string): Parcel {
    const parcel = this.require(parcelId);
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    parcel.status = 'Ready_For_Pickup';
    parcel.readyAt = new Date(at).toISOString();
    parcel.unclaimedAt = chargeable ? new Date(at).toISOString() : undefined;
    parcel.extensionsUsed = (parcel.extensionsUsed ?? 0) + 1;
    parcel.uncollectedRemindedAt = undefined; // a new window earns a new reminder
    this.scan(parcel, 'Ready_For_Pickup', 'receiver', note);
    return parcel;
  }

  /**
   * Write a note into a parcel's timeline without moving it.
   *
   * For the facts that are real and change no state: who was named to collect, that the receiver gave up
   * their claim, that somebody says they never ordered this. Persisting is the side effect that matters
   * — collaborating services mutate the live record and this is what flushes it.
   */
  annotate(parcelId: string, by: string, note: string): Parcel {
    const parcel = this.require(parcelId);
    this.scan(parcel, parcel.status, by, note);
    return parcel;
  }

  closeAsReturned(parcelId: string, returnParcelId: string): Parcel {
    const parcel = this.require(parcelId);
    // Unclaimed is the ordinary input: a store is only asked about a return once the window has closed.
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    parcel.status = 'Returned';
    parcel.returnParcelId = returnParcelId;
    this.scan(parcel, 'Returned', parcel.destAgentDid ?? 'network', `uncollected · returning as ${returnParcelId}`);
    this.parcels.set(parcel.parcelId, parcel);
    return parcel;
  }

  /** Destination PUDO shelves an arrived parcel in a chaos-shelf slot → Ready_For_Pickup + buyer notified. */
  shelve(parcelId: string, agentDid: string, binId?: string): { parcelId: string; binSlot: string; status: string } {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'On_Bus') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected On_Bus`);
    if (parcel.destAgentDid && parcel.destAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Shelve only at the buyer-selected destination PUDO');
    parcel.destAgentDid = agentDid;
    parcel.binSlot = this.shelf.assign(agentDid, parcelId, parcel.size); // chaos-shelf slot from the grid (binId hint ignored; small parcels may bundle)
    void binId;
    parcel.status = 'Ready_For_Pickup';
    // The collection code becomes live at this moment — start its attempt budget clean, exactly as
    // arrive() does for the peer-send OTP (a counter carried over from an earlier leg would burn a
    // parcel that nobody has yet tried to collect).
    parcel.otpAttempts = 0;
    parcel.otpLockedAt = undefined;
    this.handTo(parcel, 'shop', agentDid, 'shelved at the collection point');
    parcel.readyAt = new Date().toISOString(); // when the wait began — see Parcel.readyAt
    this.gate.payLabour(agentDid, SHELVING_FEE, parcelId, 'parcel', parcel.sellerEntityId); // see arrive()
    this.scan(parcel, 'Ready_For_Pickup', agentDid, `shelved · bin ${parcel.binSlot}`);
    void this.events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId, destAgentDid: agentDid, collectionCode: parcel.collectionCode, binSlot: parcel.binSlot, vendorId: parcel.vendorId, externalOrderId: parcel.externalOrderId }, { source: 'pudo' }).catch(() => undefined);
    return { parcelId, binSlot: parcel.binSlot, status: parcel.status };
  }

  /**
   * Buyer presents the collection QR → resolve the parcel + shelf slot, opening the handover screen.
   * A burned code opens nothing: the counter learns at the lookup that this parcel needs a reissue,
   * rather than being walked to the confirm step only to be refused there.
   */
  collect(collectionCode: string, agentDid: string): { parcel: Parcel; binSlot?: string; holdingOwed?: number } {
    const parcel = [...this.parcels.values()].find(
      (p) => (p.collectionCode === collectionCode || p.collectProxy?.code === collectionCode) && p.destAgentDid === agentDid && isCollectable(p.status),
    );
    if (!parcel) throw new GlosError('NOT_FOUND', 'No parcel awaiting collection for that code at this PUDO');
    if (parcel.otpLockedAt) throw new GlosError('CODE_LOCKED', 'Too many wrong codes — ask the control tower to reissue');
    // What is owed comes back with the LOOKUP, not with the release. A shopkeeper who discovers a charge
    // only after the customer has the box in their hands has to ask for money back, which is the one
    // conversation across a counter that nobody wins.
    const holdingOwed = holdingFeeFor({ unclaimedAt: parcel.unclaimedAt, shipmentCost: parcel.shipmentCost, settled: parcel.holdingSettled });
    return { parcel, binSlot: parcel.binSlot, ...(holdingOwed > 0 ? { holdingOwed } : {}) };
  }

  /**
   * Buyer confirms the parcel is correct → Delivered, transaction closed. Pays the pickup labour fee.
   *
   * The collection code is the whole custody check on an inbound parcel, so it is counted and burned
   * exactly like the peer-send OTP in pickup() — the two release paths now fail the same way. Before
   * this, a wrong code could be retried forever; the code is no longer printed on the parcel, so
   * getting it wrong repeatedly is someone guessing.
   */
  collectConfirm(parcelId: string, agentDid: string, collectionCode: string): Parcel {
    const parcel = this.require(parcelId);
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    if (parcel.destAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Release only at the destination PUDO');
    if (parcel.otpLockedAt) throw new GlosError('CODE_LOCKED', 'Too many wrong codes — ask the control tower to reissue');
    const supplied = (collectionCode || '').trim();
    // EITHER code opens it: the receiver's own, or the one held by somebody they named. Nominating a
    // neighbour to collect does not stop you collecting it yourself, and the shop still learns neither.
    const byProxy = !!parcel.collectProxy && parcel.collectProxy.code === supplied;
    if (parcel.collectionCode !== supplied && !byProxy) {
      parcel.otpAttempts = (parcel.otpAttempts ?? 0) + 1;
      if (parcel.otpAttempts >= OTP_MAX_ATTEMPTS) {
        parcel.otpLockedAt = new Date().toISOString();
        this.scan(parcel, 'Ready_For_Pickup', agentDid, 'collection code locked after repeated wrong codes');
        throw new GlosError('CODE_LOCKED', 'Too many wrong codes — ask the control tower to reissue');
      }
      this.persist(parcel); // keep the attempt counter durable so a restart can't reset the lockout
      throw new GlosError('CODE_MISMATCH', 'Collection code does not match');
    }
    // Settled BEFORE the status flips, while the clock still has an end to measure to. The receiver
    // pays the shop in cash at the counter and the shop keeps it, so nothing is posted — this records
    // that the debt is gone, which is what stops the network paying the shop for it a second time.
    const holdingPaid = holdingFeeFor({ unclaimedAt: parcel.unclaimedAt, shipmentCost: parcel.shipmentCost, settled: parcel.holdingSettled });
    if (holdingPaid > 0) parcel.holdingSettled = (parcel.holdingSettled ?? 0) + holdingPaid;

    parcel.status = 'Delivered';
    parcel.deliveredAt = new Date().toISOString();
    this.media.anchorParcelTerminal(parcelId); // S26: shipment-proof retention starts at collection
    this.shelf.release(agentDid, parcelId); // free the shelf slot
    // WHO took it, recorded. The point of a nomination over a code read down the phone is that afterwards
    // there is an answer to "who did you hand it to" other than "somebody who knew the number".
    this.handTo(
      parcel,
      'receiver',
      byProxy ? `proxy:${parcel.collectProxy!.name}` : parcel.receiverPhoneHash ?? 'receiver',
      byProxy ? `collected by ${parcel.collectProxy!.name}, named by the receiver` : 'collected in person',
    );
    this.endCustody(parcel);
    this.scan(parcel, 'Delivered', agentDid, byProxy ? 'collected · by a named proxy' : 'collected · OK');
    this.gate.payLabour(agentDid, RELEASE_FEE, parcelId, 'parcel', parcel.sellerEntityId);
    this.rebateFlexible(parcel); // a flexible parcel taken by a cheaper carrier → refund the over-hold
    void this.events.publish(GlosEvent.Pudo.ParcelDelivered, { parcelId, agentDid, vendorId: parcel.vendorId, externalOrderId: parcel.externalOrderId }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /**
   * Stamp parcels as knowingly left behind. Shared by the two ways a load can be short: a driver's
   * manifest at handover, and a shop sealing a bag without everything that was waiting for it. Both
   * record the SAME thing, so the control tower cannot tell which flow left a parcel on the shelf —
   * only that somebody chose to, and why.
   *
   * The scan note stays generic: the reason lives on shortShipReason (control-tower only) and never in
   * the timeline both consumer twins can read.
   */
  markShortShipped(parcelIds: string[], by: string, manifestRef: string, reason: string): string[] {
    const at = new Date().toISOString();
    const stamped: string[] = [];
    for (const parcelId of parcelIds) {
      const parcel = this.parcels.get(parcelId);
      if (!parcel || parcel.status !== 'At_PUDO') continue;
      parcel.shortShippedAt = at;
      parcel.shortShipReason = reason;
      this.scan(parcel, 'At_PUDO', by, `short-ship · left behind at ${manifestRef}`);
      void this.events.publish(GlosEvent.Pudo.ParcelShortShipped, { parcelId, manifestId: manifestRef, reason }, { source: 'pudo' }).catch(() => undefined);
      stamped.push(parcelId);
    }
    return stamped;
  }

  /**
   * Operator recovery for a burned release secret — the other half of the lockout.
   *
   * A lockout with no way out is a bricked parcel: the goods are on the shelf, the customer is at the
   * counter, and nothing can hand it over. So the control tower can reissue, and reissue ROTATES rather
   * than merely unlocks — an attacker who burned the code through five guesses must not have the old
   * code handed back to them, and the legitimate owner needs a code that works. Whichever secret the
   * parcel releases on is replaced:
   *   - peer-send (OTP): a fresh 4-digit code. It lands in the sender's and receiver's twins, and is also
   *     returned HERE — to the control tower, which can phone the sender when neither party has an app.
   *     The tower is a recovery authority, not the party holding the goods; what must never happen is the
   *     code reaching the destination shop, which is why it is not in the arrive() response any more.
   *   - inbound (collection code): a fresh COL- code, NOT returned to the caller — it goes to the buyer's
   *     authenticated twin and to the vendor's ready-for-pickup callback, the same two channels the
   *     original travelled. The operator performing the reissue never needs to see it.
   */
  reissueRelease(parcelId: string, byDid: string): { parcelId: string; kind: 'otp' | 'collection'; otp?: string } {
    const parcel = this.require(parcelId);
    // Including Unclaimed — a receiver who lost their code while the window lapsed is the likeliest
    // person in the network to need a reissue, and refusing them one strands the goods for good.
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    parcel.otpAttempts = 0;
    parcel.otpLockedAt = undefined;

    // Which secret does this parcel release on? An inbound parcel carries a collection code from mint;
    // a peer-send gets its OTP at arrival. Rotate the one that is actually in play.
    const kind: 'otp' | 'collection' = parcel.collectionCode ? 'collection' : 'otp';
    if (kind === 'collection') {
      parcel.collectionCode = `COL-${randomBytes(4).toString('hex').toUpperCase()}`;
      this.scan(parcel, 'Ready_For_Pickup', byDid, 'collection code reissued');
      void this.events
        .publish(GlosEvent.Pudo.ParcelReleaseCodeReissued, { parcelId, destAgentDid: parcel.destAgentDid, vendorId: parcel.vendorId, externalOrderId: parcel.externalOrderId }, { source: 'pudo' })
        .catch(() => undefined);
      return { parcelId, kind };
    }

    const otp = releaseOtp();
    parcel.otp = otp;
    this.scan(parcel, 'Ready_For_Pickup', byDid, 'release code reissued');
    void this.events
      .publish(GlosEvent.Pudo.ParcelReleaseCodeReissued, { parcelId, destAgentDid: parcel.destAgentDid }, { source: 'pudo' })
      .catch(() => undefined);
    return { parcelId, kind, otp };
  }

  /**
   * The size factor this parcel's transport was priced at.
   *
   * Stamped at mint; a record written before the field existed falls back to today's constant, which is
   * the honest answer for it — that parcel WAS quoted at whatever the constant then said, and the constant
   * is the only version of that number we still have.
   */
  static transportFactorOf(parcel: Pick<Parcel, 'size' | 'transportFactor'>): number {
    const stamped = parcel.transportFactor;
    // Not `?? `: a stored 0 or a non-finite value would poison the price, and a zero-cost transport is
    // never a real answer — it is a corrupted record, and the constant is a better guess than free.
    return typeof stamped === 'number' && Number.isFinite(stamped) && stamped > 0 ? stamped : SIZE_TRANSPORT_FACTOR[parcel.size];
  }

  /**
   * Close out a flexible shipment: the vendor reserved the ceiling, but the carrier that actually moved it
   * may have been cheaper. Refund (ceiling − actual) to the vendor's balance — GLOS keeps only the 2%.
   */
  private rebateFlexible(parcel: Parcel): void {
    if (parcel.routeMode !== 'flexible' || !parcel.vendorId || parcel.rebate != null) return;
    if (parcel.ceilingCost == null || parcel.nodeFees == null || parcel.routeKm == null) return;
    const perKm = parcel.actualPerKm ?? this.vehicles.priceRange().min;
    // The rates the parcel was MINTED at, never today's — the margin knob AND the size factor both. A
    // sister may turn the first while this parcel is in transit and the network may retune the second;
    // settling against either new number would quietly rewrite a price the customer already agreed to.
    // A parcel from before a field existed falls back to the network default.
    const actualNet = withPlatformFee(
      Math.round((parcel.nodeFees + parcel.routeKm * perKm * ParcelService.transportFactorOf(parcel)) * 100) / 100,
      parcel.platformFeePct,
    );
    // …and the TAX rate it was minted at, for the same reason and one of its own: settling a shipment at
    // a rate a government set after it was sold would hand back a different tax than the one collected,
    // and the difference would sit in the payable forever with nothing to explain it.
    const actual = taxOn(actualNet, parcel.taxPct ?? 0);
    parcel.actualCost = actual.gross;
    // The ceiling is gross and so is the actual, so the rebate is gross — and the tax inside it is the
    // difference between the two tax figures. Both are figures we HELD rather than figures we re-derive:
    // reconstructing the ceiling's tax by dividing the gross back out would be inclusive arithmetic, and
    // it can land a cent away from the number actually posted.
    const rebate = Math.round(Math.max(0, parcel.ceilingCost - actual.gross) * 100) / 100;
    const rebateTax = rebate > 0 ? Math.min(Math.max(Math.round(((parcel.ceilingTax ?? 0) - actual.tax) * 100) / 100, 0), rebate) : 0;
    // The cover follows the price down. The cost-of-risk layer is charged on the provider cost, so a
    // cheaper journey than the ceiling held for was over-provisioned by the same proportion — computed
    // from the parcel's OWN stamped rate, never today's, for the reason above.
    const actualProvision = Math.round((actualNet / (1 + (parcel.platformFeePct ?? 0))) * (parcel.rateStack?.costOfRiskPct ?? 0) * 100) / 100;
    const rebateProvision = rebate > 0 ? Math.min(Math.max(Math.round(((parcel.ceilingProvision ?? 0) - actualProvision) * 100) / 100, 0), rebate) : 0;
    parcel.rebate = rebate;
    this.persist(parcel); // actualCost/rebate mutated after collectConfirm's scan
    if (rebate > 0) this.vendors.rebate(parcel.vendorId, parcel.parcelId, rebate, 'flexible-route rebate', rebateTax, rebateProvision);
  }

  /** Buyer reports a discrepancy at collection → Disputed, with mandatory photo proof. */
  dispute(parcelId: string, agentDid: string, reason: string, photoProofRef: string): Parcel {
    const parcel = this.require(parcelId);
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    if (parcel.destAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Dispute is raised at the destination PUDO');
    if (!reason?.trim() || !photoProofRef) throw new GlosError('DISPUTE_INCOMPLETE', 'A reason and a photo proof are required to dispute');
    // The CASE opens before the status flips, and it remembers where the parcel was: these goods are
    // still on this shop's shelf, so a rejected claim has to leave them collectable rather than
    // stranding them in an exception state nobody can clear.
    parcel.dispute = { state: 'open', origin: 'counter', fromStatus: parcel.status, reason, raisedBy: agentDid, raisedAt: new Date().toISOString() };
    parcel.status = 'Disputed';
    parcel.disputeReason = reason;
    parcel.disputePhotoRef = photoProofRef;
    // S26: attach the proof to the dispute-evidence bin and start its clock at filing (no resolution flow yet).
    this.media.link(photoProofRef, { type: 'parcel', id: parcel.parcelId }, 'dispute');
    this.media.holdParcelForDispute(parcel.parcelId);
    this.scan(parcel, 'Disputed', agentDid, `dispute · ${reason}`);
    void this.events.publish(GlosEvent.Pudo.ParcelDisputed, { parcelId, agentDid, reason, photoProofRef, vendorId: parcel.vendorId, externalOrderId: parcel.externalOrderId }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /** Every dispute still waiting on a decision — the operator's queue, oldest first, because the case
   *  somebody has waited longest for is the one that most needs an answer. */
  openDisputes(): Parcel[] {
    return this.list({ status: 'Disputed' }).sort((a, b) => (a.dispute?.raisedAt ?? '').localeCompare(b.dispute?.raisedAt ?? ''));
  }

  /**
   * Decide a dispute — the ending `Disputed` never had.
   *
   * Before this, a person reported that their goods arrived broken and the parcel stopped there
   * forever: the status was terminal, adjudication was a comment saying "control-tower/ops", and there
   * was no path in the code by which anybody could ever be told yes or no. That is also why the
   * cost-of-risk pricing layer had to stay pinned at zero — a provision that can never be drawn down
   * is an accumulating fiction.
   *
   * THE AWARD IS THE OPERATOR'S NUMBER, deliberately, and it is bounded only against a fat finger.
   * There is no declared-value cover in this system yet, so the network's liability for a broken thing
   * is not defined anywhere — and inventing a cap here (the shipping price? the subtotal?) would be
   * inventing a policy in a service method. A REJECTION still records its note and still closes the
   * case: somebody whose goods arrived broken is owed an explanation even when they are not owed money.
   */
  resolveDispute(
    parcelId: string,
    input: { decision: DisputeDecision; award?: number; note: string; by?: string },
  ): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'Disputed') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Disputed`);
    if (!input.note?.trim()) throw new GlosError('FIELD_REQUIRED', 'A decision needs a reason the claimant can be shown — including a rejection');
    const open = parcel.dispute;
    // A dispute filed before cases existed has no record to close. Rather than refuse to adjudicate it
    // — which would leave exactly the parcels that have waited longest permanently stuck — reconstruct
    // the case from what the parcel does carry. Origin follows the evidence: a buyer's dispute is the
    // one with a receiver behind it.
    const origin: DisputeOrigin = open?.origin ?? (parcel.buyerDisputeReason ? 'buyer' : 'counter');
    const fromStatus: ParcelStatus = open?.fromStatus ?? (origin === 'buyer' ? 'Delivered' : 'Ready_For_Pickup');

    const award = input.decision === 'rejected' ? 0 : Math.round(Math.max(0, Number(input.award) || 0) * 100) / 100;
    if (input.decision !== 'rejected' && award <= 0) {
      throw new GlosError('INVALID_INPUT', 'Upholding a claim means awarding something — reject it instead of awarding nothing');
    }
    // THE COVER IS THE CAP — a policy rather than a guardrail: the free limit this sister carries, raised
    // by whatever the shipper declared and paid a premium for.
    //
    // A limit of ZERO is read as "no policy has been stated", not as "a policy of nothing", and falls back
    // to the sanity bound. The distinction matters: every sister starts at zero because inventing a free
    // limit here would be inventing a promise nobody costed, and treating that as a hard cap would have
    // made damage resolution inert on the day cover shipped — an operator who has DECIDED to pay could
    // not. A sister that genuinely wants to cover nothing expresses it by rejecting claims, which it can
    // already do with a reason the claimant is shown.
    const stated = parcel.coverLimit != null && parcel.coverLimit > 0;
    const cap = stated ? parcel.coverLimit! : MAX_CLAIM_AWARD;
    if (award > cap) {
      throw new GlosError(
        'INVALID_INPUT',
        stated
          ? `This shipment is covered to ${cap.toFixed(2)}${parcel.declaredValue ? ' (declared)' : ' — the free limit, nothing was declared'}. Award up to that, or settle the excess off-platform.`
          : `An award over ${MAX_CLAIM_AWARD} needs to be settled off-platform — this is a sanity bound, not a policy`,
      );
    }

    let funding: { fromProvision: number; fromExpense: number } | undefined;
    let paidTo: { kind: 'vendor' | 'off_platform'; id: string } | undefined;
    if (award > 0) {
      const note = `damage claim · ${parcel.parcelId}`;
      if (parcel.vendorId && this.vendors.has(parcel.vendorId)) {
        // The store is the counterparty: it bought the shipment, and the shipment failed.
        funding = this.vendors.payClaim(parcel.vendorId, parcel.parcelId, award, note);
        paidTo = { kind: 'vendor', id: parcel.vendorId };
      } else {
        // A walk-up sender paid cash and has no account. The award becomes a visible payable rather
        // than a balance we invent for somebody who never asked us to hold their money.
        const claimant = parcel.senderPhoneHash || parcel.parcelId;
        const entityId = parcel.collectingEntityId ?? parcel.sellerEntityId;
        if (!entityId) throw new GlosError('INVALID_STATE', 'This parcel names no sister company, so there are no books to award against');
        funding = this.gate.recordClaimPayable(entityId, parcel.parcelId, award, claimant);
        paidTo = { kind: 'off_platform', id: claimant };
      }
    }

    parcel.dispute = {
      ...(open ?? { state: 'open', origin, fromStatus, reason: parcel.buyerDisputeReason ?? parcel.disputeReason ?? '', raisedBy: 'unknown', raisedAt: parcel.deliveredAt ?? parcel.acceptedAt }),
      state: 'resolved',
      decision: input.decision,
      award,
      note: input.note.trim(),
      decidedBy: input.by ?? 'ops',
      decidedAt: new Date().toISOString(),
      funding,
      paidTo,
    };
    // Back to what the parcel factually IS. `Disputed` was never a description of the goods — it was a
    // description of an open question, and the question now has an answer.
    parcel.status = fromStatus;
    this.scan(parcel, fromStatus, input.by ?? 'ops', `dispute ${input.decision}${award > 0 ? ` · awarded ${award.toFixed(2)}` : ''}`);
    this.persist(parcel);
    return parcel;
  }

  get(parcelId: string): Parcel {
    return this.require(parcelId);
  }

  /**
   * MDP transit transition (At_MDP / On_Bus) driven by the tote-bag flow. Records the scan + the
   * current tote, but leaves wallet/shelf untouched — sorting is a hub operation, not a PUDO charge.
   */
  setTransit(parcelId: string, status: Extract<Parcel['status'], 'At_MDP' | 'On_Bus'>, by: string, note: string, toteId?: string): Parcel {
    const parcel = this.require(parcelId);
    parcel.status = status;
    parcel.toteId = toteId;
    // On an On_Bus leg `by` is the carrying driver's badge (the bag/tote path — dropBag's At_MDP `by` is the hub
    // name, so only stamp On_Bus). Track the CURRENT carrier per leg, exactly as the direct handover stamps it —
    // otherwise a bag parcel keeps driverBadgeId undefined and REP2's "received a bag from" rating can't verify
    // the interaction (the dest shop could never rate the driver that actually delivered its late bag).
    if (status === 'On_Bus') {
      parcel.driverBadgeId = by;
      if (!parcel.handedToBusAt) parcel.handedToBusAt = new Date().toISOString();
    }
    // The bag path's hand-offs, which are the same transfers the direct path makes one parcel at a time:
    // onto a vehicle (a driver now answers for it), or into a hub (the hub does). `by` is a badge on the
    // bus leg and the hub's own name on the other — the chain records the party, not the token scanned.
    if (status === 'On_Bus') this.handTo(parcel, 'driver', this.driverIdOf(by), note);
    else this.handTo(parcel, 'hub', by, note);
    this.scan(parcel, status, by, note);
    return parcel;
  }

  /**
   * The phygital label.
   *
   * Until S18 the "QR" here was a black square with the letters QR drawn in it — the whole
   * product is scan-driven and nothing in it was scannable. It is now a real, spec-correct
   * QR (level Q, ~25% recovery, because this gets printed on cheap thermal stock, taped to
   * a box and scanned in a dusty shop). The payload is namespaced `sbg:parcel:<id>` so a
   * scanner can tell a parcel from a bag, a badge or a vehicle.
   *
   * XML-escaped: a shop name is operator-entered text and would otherwise break the SVG
   * (or inject into it) the first time someone typed an ampersand.
   *
   * What the label may NOT carry: the release secret. It used to print the inbound buyer's collection
   * code in bold — the very code collectConfirm() releases the parcel on — which handed the key to
   * everyone who touched the box: the origin agent, the driver, the hub sorter, anyone glancing at the
   * shelf. A parcel must not carry its own key. The code reaches the buyer through the two channels
   * built for it (their authenticated twin since S22, and the vendor's own order notification via the
   * ready-for-pickup callback); the label carries only the PUBLIC tracking key, which is safe to print,
   * safe to read aloud, and is what someone should quote when they ask after a parcel.
   */
  private label(parcel: Parcel, destShop?: string): PhygitalLabel {
    const qrPayload = `sbg:parcel:${parcel.parcelId}`;
    const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">`,
      `<rect width="320" height="180" fill="#fff" stroke="#0B1F5C"/>`,
      qrSvgGroup(qrPayload, 12, 12, 96),
      `<text x="120" y="32" font-family="Arial" font-size="15" font-weight="bold" fill="#0B1F5C">SeeBuyGet</text>`,
      `<text x="120" y="52" font-family="monospace" font-size="11">${esc(parcel.parcelId)}</text>`,
      `<text x="120" y="72" font-family="Arial" font-size="10">To: ${esc(destShop ?? parcel.destZone)}</text>`,
      `<text x="120" y="92" font-family="Arial" font-size="9" fill="#4A5261">${esc(parcel.destZone)}</text>`,
      // The age of the parcel, readable in a blink: a box dated a week ago and still on the shelf is a
      // question the shopkeeper can ask without scanning anything.
      `<text x="120" y="110" font-family="Arial" font-size="9" fill="#6E7684">Created ${labelDate(parcel.acceptedAt)}</text>`,
      `<text x="12" y="130" font-family="Arial" font-size="10" fill="#4A5261">Track this parcel:</text>`,
      `<text x="12" y="152" font-family="monospace" font-size="15" font-weight="bold" fill="#0B1F5C">${esc(parcel.trackingKey ?? '')}</text>`,
      `<text x="12" y="171" font-family="Arial" font-size="8" fill="#6E7684">${parcel.direction === 'inbound' ? 'Pre-paid · ' : ''}${esc(qrPayload)}</text>`,
      `</svg>`,
    ].join('');
    return { parcelId: parcel.parcelId, qrPayload, svg };
  }

  /** DT — the printable label for a parcel (reprint surface). Returns the persisted one, or generates it on
   *  demand (e.g. an inbound parcel not yet paid still has no label → generated so an operator can inspect it). */
  labelFor(parcelId: string): PhygitalLabel {
    const parcel = this.require(parcelId);
    if (parcel.label) return parcel.label;
    const destShop = parcel.destAgentDid ? this.agents.get(parcel.destAgentDid).shopName : undefined;
    return this.label(parcel, destShop);
  }

  list(filter: { status?: Parcel['status']; agentDid?: string; vendorId?: string } = {}): Parcel[] {
    return [...this.parcels.values()].filter((p) => (!filter.status || p.status === filter.status) && (!filter.agentDid || p.originAgentDid === filter.agentDid || p.destAgentDid === filter.agentDid) && (!filter.vendorId || p.vendorId === filter.vendorId));
  }

  // --- vendor shipment register (R0) — server-side search / filter / sort / paginate / export -------------

  /** One page of the vendor shipment register: the projected rows + the full match count. Owner-scoped. */
  vendorOrdersPage(vendorId: string, q: VendorOrdersQuery): Page<VendorOrderRow> {
    const filtered = filterVendorParcels(this.list({ vendorId }), q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map(vendorOrderRowOf), total };
  }

  /** The whole matching set (every page) rendered as CSV — the vendor's export of their shipments. */
  vendorOrdersCsv(vendorId: string, q: VendorOrdersQuery): string {
    return vendorOrdersToCsv(filterVendorParcels(this.list({ vendorId }), q));
  }

  /** Store-wide shipment counts (total / unpaid / active) — the header nudge + spoken summary read these
   *  so they stay honest regardless of the register's active filter or page. */
  vendorOrderStats(vendorId: string): VendorOrderStats {
    return vendorOrderStatsOf(this.list({ vendorId }));
  }

  // --- agent parcel-history register (R4): the shop's OWN parcels (origin or dest), owner-scoped by caller ---

  /** What each margin rate did to volume and to earnings, spell by spell, for one sister's shipments. */
  rateImpact(entityId: string): { spells: RateSpell[]; unpriced: number } {
    return rateImpactOf(this.list({}), this.agents.homeEntityId(), entityId);
  }

  agentParcelsPage(agentDid: string, q: AgentParcelsQuery): Page<AgentParcelRow> {
    const filtered = filterAgentParcels(this.list({ agentDid }), agentDid, q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map((p) => agentParcelRowOf(p, agentDid)), total };
  }

  agentParcelsCsv(agentDid: string, q: AgentParcelsQuery): string {
    return agentParcelsToCsv(filterAgentParcels(this.list({ agentDid }), agentDid, q), agentDid);
  }

  // --- internals ---

  /**
   * Hand the parcel to somebody: close whoever was holding it, open a leg for whoever now is.
   *
   * One door for every transfer, so the chain cannot grow a gap the day a new path is added — a gap being
   * precisely the thing that makes a damage claim unanswerable. Idempotent about the obvious: handing it to
   * the party already holding it does nothing rather than inventing a hand-off that did not happen.
   */
  private handTo(parcel: Parcel, holderKind: CustodyKind, holderId: string, note?: string): void {
    const at = new Date().toISOString();
    parcel.custody = parcel.custody ?? [];
    const open = parcel.custody.find((l) => !l.to);
    if (open && open.holderKind === holderKind && open.holderId === holderId) return;
    if (open) open.to = at;
    parcel.custody.push({ holderId, holderKind, from: at, note });
  }

  /** Close the chain: nobody holds it any more (it was delivered, or it never left). */
  private endCustody(parcel: Parcel): void {
    const open = (parcel.custody ?? []).find((l) => !l.to);
    if (open) open.to = new Date().toISOString();
  }

  /**
   * The driver behind a badge, for the custody chain. A badge is what gets scanned; a DID is who is
   * answerable — and the chain must name the second. An unknown badge falls back to the badge itself
   * rather than dropping the leg: a hand-off we cannot fully identify still happened.
   */
  private driverIdOf(badgeId: string): string {
    try {
      return this.fleet.resolveBadge(badgeId)?.driverDid ?? badgeId;
    } catch {
      return badgeId;
    }
  }

  private scan(parcel: Parcel, status: Parcel['status'], by: string, note: string): void {
    const at = new Date().toISOString();
    const anchorTxId = this.ledger.anchor({ p: parcel.parcelId, st: status, by, at }).txId;
    const scan: ParcelScan = { at, status, by, note, anchorTxId };
    parcel.scans.push(scan);
    this.persist(parcel); // every state transition durably captures the parcel's current state
  }

  /** Re-store the (in-place-mutated) parcel so the snapshot store flushes it to disk. */
  private persist(parcel: Parcel): void {
    this.parcels.set(parcel.parcelId, parcel);
  }

  private require(parcelId: string): Parcel {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) throw new GlosError('NOT_FOUND', `Parcel not found: ${parcelId}`);
    return parcel;
  }
}
