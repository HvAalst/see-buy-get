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
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { FleetService } from './fleet.service';
import { HANDOVER_FEE, LABOUR_FEE, OTP_MAX_ATTEMPTS, PICKUP_FEE, SIZE_TRANSPORT_FACTOR, SIZE_WEIGHT_KG, VOID_WINDOW_MS, WHOLESALE, classifySize, withPlatformFee } from './pudo.config';
import { ConsumerParcelView, Parcel, ParcelDirection, ParcelScan, ParcelSize, ParcelStatus, PaymentMode, PhygitalLabel, ShippingPolicy } from './pudo.types';
import { VendorService } from './vendor.service';
import { VehicleService } from './vehicle.service';
import { MediaService } from './media.service';
import { CargoService } from './cargo.service';
import { CargoNature } from './cargo.types';
import type { ShipmentQuote } from './routing.service';
import { paginate, textMatch, toCsv, withinDates, type Page } from './query';

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

/** Project a Parcel to a register row (adds the DID, buyer + product names the raw list lacked). */
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
    ['Order', 'Shipment DID', 'Buyer', 'Products', 'Status', 'Paid', 'Destination', 'Shipping cost', 'Buyer charge', 'Created'],
    rows.map((p) => [p.externalOrderId ?? p.parcelId, p.did ?? '', p.receiverMobile, vendorProducts(p), p.status, p.paidStatus ?? '', p.destZone, p.shipmentCost ?? '', p.buyerCharge ?? '', p.acceptedAt]),
  );
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
  };
}

interface AcceptInput {
  agentDid: string;
  parcelId: string; // pre-printed QR sticker id
  size: ParcelSize;
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
  ) {}

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
   * Full order detail for the external merchant console (`GET /vendors/:id/orders/:parcelId`) — everything
   * the parcel carries EXCEPT the control-tower-only short-ship marker. shortShipReason is operator text
   * (and shortShippedAt its timestamp): the orders LIST projection already omits it, so the detail must too,
   * or an internal reason for leaving a parcel behind would reach the vendor. (S25 — the counterpart of the
   * generic short-ship scan note that keeps the reason off the consumer twins.)
   */
  vendorOrderView(vendorId: string, parcelId: string): Omit<Parcel, 'shortShippedAt' | 'shortShipReason'> {
    const p = this.require(parcelId);
    if (p.vendorId !== vendorId) throw new GlosError('NOT_FOUND', 'Order does not belong to this vendor');
    const view: Partial<Parcel> = { ...p }; // shallow copy — never delete off the live stored parcel
    delete view.shortShippedAt;
    delete view.shortShipReason;
    return view as Omit<Parcel, 'shortShippedAt' | 'shortShipReason'>;
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
    };
    // S22: the receiver's in-app collection token — QR (scanned) + the COL code (typed fallback). Only on
    // the detail view, only for the receiver, only while collectable — the handover secret leaves the
    // vault of the twin no wider than it must.
    if (withToken && relation === 'received' && p.status === 'Ready_For_Pickup' && p.collectionCode) {
      view.collectToken = { code: p.collectionCode, qrPayload: `sbg:collect:${p.collectionCode}` };
    }
    return view;
  }

  /** Screen 1 — Accept Parcel (ingest). */
  accept(input: AcceptInput): Parcel {
    if (this.parcels.has(input.parcelId)) throw new GlosError('PARCEL_EXISTS', `Parcel ${input.parcelId} already exists`);
    if (!input.dropoffPhotoRef) throw new GlosError('PHOTO_REQUIRED', 'A drop-off photo is mandatory (fraud defence)');
    const agent = this.agents.get(input.agentDid);
    const mode: PaymentMode = input.paymentMode ?? 'cash';

    // 'No money, no scan' gate applies to cash parcels (they consume a platform credit).
    if (mode === 'cash' && !this.gate.canTransact(input.agentDid).ok) {
      throw new GlosError('WALLET_INSUFFICIENT', 'Insufficient funds. Top up to accept parcels.');
    }

    const weightKg = SIZE_WEIGHT_KG[input.size];
    // S30: derive the cargo class (a walk-up parcel has no measured dims, so from weight alone → at most P2)
    // and stamp the primary nature (default GEN). A class needing dedicated transport can never be a
    // counter parcel; the gate is defensive against a future size table that admits heavier walk-ups.
    const natureCode: CargoNature = input.natureCode ?? 'GEN';
    const cargoClass = this.cargo.classify({ kg: weightKg });
    if (this.cargo.dedicatedRequired(cargoClass)) {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', `Cargo class ${cargoClass} is too large for the PUDO network — it needs dedicated freight transport`);
    }
    const now = new Date().toISOString();
    const anchorTxId = this.ledger.anchor({ p: input.parcelId, a: input.agentDid, s: input.size, dest: input.destZone, photo: input.dropoffPhotoRef, at: now }).txId;
    const parcel: Parcel = {
      parcelId: input.parcelId,
      did: this.mintShipmentDid(input.parcelId, 'outbound'), // DT — the twin's stable GLOS identity, minted at creation
      direction: 'outbound',
      size: input.size,
      weightKg,
      cargoClass,
      natureCode,
      fragile: input.fragile ?? false,
      originAgentDid: input.agentDid,
      committedNodeDid: input.agentDid,
      originZone: agent.zone,
      destZone: input.destZone,
      destAgentDid: input.destPudoDid, // optional nominated destination PUDO (else set at arrive)
      senderMobile: input.senderMobile,
      receiverMobile: input.receiverMobile,
      senderPhoneHash: hashPhone(input.senderMobile) || undefined,
      receiverPhoneHash: hashPhone(input.receiverMobile) || undefined,
      dropoffPhotoRef: input.dropoffPhotoRef,
      paymentMode: mode,
      status: 'At_PUDO',
      acceptedAt: now,
      // Walk-up parcels track too (S14): the sender SMS carries this key, exactly as the
      // vendor flow's does. Public surface, no PII — inbound parcels had it since day one
      // and the counter flow simply never minted one.
      trackingKey: `T-${randomBytes(5).toString('hex').toUpperCase()}`,
      scans: [{ at: now, status: 'CREATED', by: input.agentDid, note: agent.shopName, anchorTxId }],
    };
    // DT — a printable label at creation for OUTBOUND too (the counter flow never issued one). Direction-aware:
    // shows the public tracking key, not a collection code. Persisted so it can be reprinted.
    parcel.label = this.label(parcel);
    this.parcels.set(parcel.parcelId, parcel);
    // S26: attach the drop-off proof to this parcel → shipment-proof bin (clock starts at terminal state).
    this.media.link(input.dropoffPhotoRef, { type: 'parcel', id: parcel.parcelId }, 'dropoff');

    if (mode === 'cash') this.gate.chargeShipping(input.agentDid, WHOLESALE, parcel.parcelId);
    else this.gate.payLabour(input.agentDid, LABOUR_FEE, parcel.parcelId, 'parcel');

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

    return { manifestId, driverBadgeId: badgeId, corridorId, vehicle: fleet ? vehicleType : this.corridors.chooseVehicle(loadKg), handed, rejected, expected, missed, shortShipped: missed.length > 0 };
  }

  /** Arrival at the destination PUDO → Ready_For_Pickup; OTP issued to the receiver. */
  arrive(parcelId: string, destAgentDid: string): { parcelId: string; otp: string; status: string; binSlot: string } {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'On_Bus') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected On_Bus`);
    const otp = String(Math.floor(parseInt(randomBytes(2).toString('hex'), 16) / 65536 * 9000 + 1000));
    parcel.status = 'Ready_For_Pickup';
    parcel.destAgentDid = destAgentDid;
    parcel.otp = otp;
    parcel.otpAttempts = 0;
    parcel.otpLockedAt = undefined;
    parcel.binSlot = this.shelf.assign(destAgentDid, parcelId); // commit to a shelf slot for pickup
    this.scan(parcel, 'Ready_For_Pickup', destAgentDid, `OTP issued · shelf ${parcel.binSlot}`);
    void this.events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId, destAgentDid, binSlot: parcel.binSlot }, { source: 'pudo' }).catch(() => undefined);
    // The destination agent reads the OTP aloud to the customer — no SMS, no per-parcel cost.
    return { parcelId, otp, status: parcel.status, binSlot: parcel.binSlot };
  }

  /** Screen 3 — Customer Pickup (release) with OTP. */
  pickup(parcelId: string, agentDid: string, otp: string, deliveredPhotoRef?: string): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'Ready_For_Pickup') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
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
    this.scan(parcel, 'Voided', agentDid, 'voided + refunded');
    if (parcel.paymentMode === 'cash') this.gate.refund(agentDid, WHOLESALE, parcel.parcelId);
    void this.events.publish(GlosEvent.Pudo.ParcelVoided, { parcelId, agentDid }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /** Reverse logistics: cancel a parcel that has NOT yet been delivered/picked up. Refunds a cash
   * shipping charge if it is still at the accepting PUDO. (A more complete return-to-sender is future.) */
  cancel(parcelId: string, by = 'ops', reason?: string): Parcel {
    const parcel = this.require(parcelId);
    if (!['Created', 'At_PUDO', 'At_MDP'].includes(parcel.status)) throw new GlosError('INVALID_STATE', `Cannot cancel a ${parcel.status} parcel`);
    if (parcel.paymentMode === 'cash' && parcel.status === 'At_PUDO') this.gate.refund(parcel.originAgentDid, WHOLESALE, parcel.parcelId);
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
  createInbound(input: { vendorId: string; externalOrderId?: string; originAgentDid: string; destAgentDid: string; buyerMobile: string; buyerEmail?: string; size?: ParcelSize; dimensionsCm?: { l: number; w: number; h: number }; weightKg?: number; contentPhotoRef: string; fragile?: boolean; natureCode?: CargoNature; items?: Array<{ name: string; qty: number }>; subtotal?: number; shippingPolicy: ShippingPolicy; routeMode?: 'flexible' | 'locked'; quote: ShipmentQuote }): { parcel: Parcel; label: PhygitalLabel | null; paid: boolean } {
    const origin = this.agents.get(input.originAgentDid);
    const dest = this.agents.get(input.destAgentDid);
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
    const parcelId = `PUD-${randomBytes(5).toString('hex').toUpperCase()}`;
    const collectionCode = `COL-${randomBytes(4).toString('hex').toUpperCase()}`;
    const trackingKey = `T-${randomBytes(5).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const anchorTxId = this.ledger.anchor({ p: parcelId, v: input.vendorId, o: input.originAgentDid, d: input.destAgentDid, at: now }).txId;

    // Open-data quote: vendor is billed the FULL cost (prepaid). flexible reserves the ceiling (rebated on
    // delivery); locked commits the cheapest route. The buyer-charge is REPORTED only (collected at checkout).
    const quote = input.quote;
    const routeMode = input.routeMode === 'locked' ? 'locked' : 'flexible';
    const chosen = routeMode === 'locked' ? quote.locked : quote.flexible;
    const shipmentCost = chosen.total;
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
      committedNodeDid: input.originAgentDid,
      originZone: origin.zone,
      destZone: dest.zone,
      destAgentDid: input.destAgentDid,
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
      shipmentCost,
      ceilingCost: quote.flexible.total,
      buyerCharge,
      paidStatus: 'unpaid',
      acceptedAt: now,
      scans: [{ at: now, status: 'CREATED', by: input.vendorId, note: `inbound · order ${input.externalOrderId ?? '—'}`, anchorTxId }],
    };
    this.parcels.set(parcelId, parcel);
    // S26: attach the vendor's content photo (the baseline a dispute is judged against) to the parcel →
    // shipment-proof bin. Without this link the orphan-reaper would delete it before the parcel is delivered.
    this.media.link(input.contentPhotoRef, { type: 'parcel', id: parcelId }, 'content');

    // Prepaid gate: bill the vendor's balance with the country daughter company → 'ParcelPaid' or 'unpaid'.
    const bill = this.vendors.billShipment(input.vendorId, parcelId, shipmentCost);
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
      shipmentCost: chosen.total,
      ceilingCost: quote.flexible.total,
      paidStatus: 'unpaid',
      acceptedAt: now,
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
    const bill = this.vendors.billShipment(parcel.vendorId, parcelId, parcel.shipmentCost ?? 0);
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
      binSlot: parcel.status === 'Ready_For_Pickup' ? parcel.binSlot : undefined,
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
    this.scan(parcel, 'At_PUDO', agentDid, 'peer-send drop-off · cash collected');
    // adopt(), not link(): the photo id came from the CLIENT — only a photo the acting shop owns and that
    // isn't attached elsewhere may bind here (S29/S33a media-laundering guard).
    this.media.adopt(dropoffPhotoRef, agentDid, { type: 'parcel', id: parcelId }, 'dropoff');
    this.gate.chargeShipping(agentDid, due, parcelId); // remit the collected cash
    this.gate.payLabour(agentDid, LABOUR_FEE, parcelId, 'parcel');
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
    this.scan(parcel, 'At_PUDO', agentDid, 'inbound intake');
    this.gate.payLabour(agentDid, LABOUR_FEE, parcelId, 'parcel');
    void this.events.publish(GlosEvent.Pudo.ParcelAccepted, { parcelId, agentDid, destZone: parcel.destZone, mode: 'prepaid' }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /** Destination PUDO shelves an arrived parcel in a chaos-shelf slot → Ready_For_Pickup + buyer notified. */
  shelve(parcelId: string, agentDid: string, binId?: string): { parcelId: string; binSlot: string; status: string } {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'On_Bus') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected On_Bus`);
    if (parcel.destAgentDid && parcel.destAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Shelve only at the buyer-selected destination PUDO');
    parcel.destAgentDid = agentDid;
    parcel.binSlot = this.shelf.assign(agentDid, parcelId); // chaos-shelf slot from the grid (binId hint ignored)
    void binId;
    parcel.status = 'Ready_For_Pickup';
    this.scan(parcel, 'Ready_For_Pickup', agentDid, `shelved · bin ${parcel.binSlot}`);
    void this.events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId, destAgentDid: agentDid, collectionCode: parcel.collectionCode, binSlot: parcel.binSlot, vendorId: parcel.vendorId, externalOrderId: parcel.externalOrderId }, { source: 'pudo' }).catch(() => undefined);
    return { parcelId, binSlot: parcel.binSlot, status: parcel.status };
  }

  /** Buyer presents the collection QR → resolve the parcel + shelf slot, opening the handover screen. */
  collect(collectionCode: string, agentDid: string): { parcel: Parcel; binSlot?: string } {
    const parcel = [...this.parcels.values()].find((p) => p.collectionCode === collectionCode && p.destAgentDid === agentDid && p.status === 'Ready_For_Pickup');
    if (!parcel) throw new GlosError('NOT_FOUND', 'No parcel awaiting collection for that code at this PUDO');
    return { parcel, binSlot: parcel.binSlot };
  }

  /** Buyer confirms the parcel is correct → Delivered, transaction closed. Pays the pickup labour fee. */
  collectConfirm(parcelId: string, agentDid: string, collectionCode: string): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'Ready_For_Pickup') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    if (parcel.destAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Release only at the destination PUDO');
    if (parcel.collectionCode !== collectionCode) throw new GlosError('CODE_MISMATCH', 'Collection code does not match');
    parcel.status = 'Delivered';
    parcel.deliveredAt = new Date().toISOString();
    this.media.anchorParcelTerminal(parcelId); // S26: shipment-proof retention starts at collection
    this.shelf.release(agentDid, parcelId); // free the shelf slot
    this.scan(parcel, 'Delivered', agentDid, 'collected · OK');
    this.gate.payLabour(agentDid, PICKUP_FEE, parcelId, 'parcel');
    this.rebateFlexible(parcel); // a flexible parcel taken by a cheaper carrier → refund the over-hold
    void this.events.publish(GlosEvent.Pudo.ParcelDelivered, { parcelId, agentDid, vendorId: parcel.vendorId, externalOrderId: parcel.externalOrderId }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /**
   * Close out a flexible shipment: the vendor reserved the ceiling, but the carrier that actually moved it
   * may have been cheaper. Refund (ceiling − actual) to the vendor's balance — GLOS keeps only the 2%.
   */
  private rebateFlexible(parcel: Parcel): void {
    if (parcel.routeMode !== 'flexible' || !parcel.vendorId || parcel.rebate != null) return;
    if (parcel.ceilingCost == null || parcel.nodeFees == null || parcel.routeKm == null) return;
    const perKm = parcel.actualPerKm ?? this.vehicles.priceRange().min;
    const actual = withPlatformFee(Math.round((parcel.nodeFees + parcel.routeKm * perKm * SIZE_TRANSPORT_FACTOR[parcel.size]) * 100) / 100);
    parcel.actualCost = actual;
    const rebate = Math.round(Math.max(0, parcel.ceilingCost - actual) * 100) / 100;
    parcel.rebate = rebate;
    this.persist(parcel); // actualCost/rebate mutated after collectConfirm's scan
    if (rebate > 0) this.vendors.rebate(parcel.vendorId, parcel.parcelId, rebate);
  }

  /** Buyer reports a discrepancy at collection → Disputed, with mandatory photo proof. */
  dispute(parcelId: string, agentDid: string, reason: string, photoProofRef: string): Parcel {
    const parcel = this.require(parcelId);
    if (parcel.status !== 'Ready_For_Pickup') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, expected Ready_For_Pickup`);
    if (parcel.destAgentDid !== agentDid) throw new GlosError('WRONG_PUDO', 'Dispute is raised at the destination PUDO');
    if (!reason?.trim() || !photoProofRef) throw new GlosError('DISPUTE_INCOMPLETE', 'A reason and a photo proof are required to dispute');
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
    if (status === 'On_Bus' && !parcel.handedToBusAt) parcel.handedToBusAt = new Date().toISOString();
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
   */
  private label(parcel: Parcel, destShop?: string): PhygitalLabel {
    const qrPayload = `sbg:parcel:${parcel.parcelId}`;
    const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
    // DT — direction-aware so OUTBOUND / peer-send parcels get a label too (they have no destShop and no
    // collection code). An inbound label shows the buyer's collection code; any other shows the PUBLIC tracking
    // key (safe to print — no PII), so the physical parcel always carries a scannable, trackable identity.
    const hasCode = parcel.direction === 'inbound' && Boolean(parcel.collectionCode);
    const bottom = hasCode
      ? [`<text x="12" y="130" font-family="Arial" font-size="10" fill="#4A5261">Collect at the shop with this code:</text>`, `<text x="12" y="152" font-family="monospace" font-size="16" font-weight="bold" fill="#0B1F5C">${esc(parcel.collectionCode ?? '')}</text>`]
      : [`<text x="12" y="130" font-family="Arial" font-size="10" fill="#4A5261">Track this parcel:</text>`, `<text x="12" y="152" font-family="monospace" font-size="15" font-weight="bold" fill="#0B1F5C">${esc(parcel.trackingKey ?? '')}</text>`];
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">`,
      `<rect width="320" height="180" fill="#fff" stroke="#0B1F5C"/>`,
      qrSvgGroup(qrPayload, 12, 12, 96),
      `<text x="120" y="32" font-family="Arial" font-size="15" font-weight="bold" fill="#0B1F5C">SeeBuyGet</text>`,
      `<text x="120" y="52" font-family="monospace" font-size="11">${esc(parcel.parcelId)}</text>`,
      `<text x="120" y="72" font-family="Arial" font-size="10">To: ${esc(destShop ?? parcel.destZone)}</text>`,
      `<text x="120" y="92" font-family="Arial" font-size="9" fill="#4A5261">${esc(parcel.destZone)}</text>`,
      ...bottom,
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

  agentParcelsPage(agentDid: string, q: AgentParcelsQuery): Page<AgentParcelRow> {
    const filtered = filterAgentParcels(this.list({ agentDid }), agentDid, q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map((p) => agentParcelRowOf(p, agentDid)), total };
  }

  agentParcelsCsv(agentDid: string, q: AgentParcelsQuery): string {
    return agentParcelsToCsv(filterAgentParcels(this.list({ agentDid }), agentDid, q), agentDid);
  }

  // --- internals ---

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
