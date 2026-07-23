import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { hashPhone } from '../../foundation/identity/phone';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { AgentService } from './agent.service';
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { FleetService } from './fleet.service';
import { HANDOVER_FEE, LABOUR_FEE, OTP_MAX_ATTEMPTS, PICKUP_FEE, SIZE_TRANSPORT_FACTOR, SIZE_WEIGHT_KG, VOID_WINDOW_MS, WHOLESALE, classifySize, withPlatformFee } from './pudo.config';
import { ConsumerParcelView, Parcel, ParcelScan, ParcelSize, ParcelStatus, PaymentMode, PhygitalLabel, ShippingPolicy } from './pudo.types';
import { VendorService } from './vendor.service';
import { VehicleService } from './vehicle.service';
import type { ShipmentQuote } from './routing.service';
import { qrSvgGroup } from '../../foundation/label/qr';

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
  destPudoDid?: string; // optional: nominate the destination PUDO up front (enables MDP pre-sort routing)
}

export interface HandoverResult {
  manifestId: string;
  driverBadgeId: string;
  corridorId?: string;
  vehicle: 'bus' | 'truck';
  handed: string[];
  rejected: Array<{ parcelId: string; reason: string }>;
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
  ) {}

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
    return ParcelService.toConsumerView(p, phoneHash);
  }

  private static toConsumerView(p: Parcel, phoneHash: string): ConsumerParcelView {
    return {
      parcelId: p.parcelId,
      relation: p.receiverPhoneHash === phoneHash ? 'received' : 'sent',
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
    };
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
    const now = new Date().toISOString();
    const anchorTxId = this.ledger.anchor({ p: input.parcelId, a: input.agentDid, s: input.size, dest: input.destZone, photo: input.dropoffPhotoRef, at: now }).txId;
    const parcel: Parcel = {
      parcelId: input.parcelId,
      direction: 'outbound',
      size: input.size,
      weightKg,
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
    this.parcels.set(parcel.parcelId, parcel);

    if (mode === 'cash') this.gate.chargeShipping(input.agentDid, WHOLESALE, parcel.parcelId);
    else this.gate.payLabour(input.agentDid, LABOUR_FEE, parcel.parcelId, 'parcel');

    void this.events.publish(GlosEvent.Pudo.ParcelAccepted, { parcelId: parcel.parcelId, agentDid: input.agentDid, destZone: input.destZone, mode }, { source: 'pudo' }).catch(() => undefined);
    return parcel;
  }

  /** Screen 2 — Give to Bus (handover). Scan driver badge → manifest; scan each parcel; finish at 100%.
   * The badge resolves first to a registered fleet driver (with their coupled vehicle + capacity and
   * handling rules enforced); failing that, to a legacy corridor driver. */
  handover(input: { agentDid: string; driverBadgeId: string; parcelIds: string[] }): HandoverResult {
    const fleet = this.fleet.resolveBadge(input.driverBadgeId);
    let badgeId: string;
    let corridorId: string;
    let vehicleType: 'bus' | 'truck';
    if (fleet) {
      if (!fleet.corridorId) throw new GlosError('INVALID_STATE', 'Driver is not assigned to a corridor — assign one before handover');
      badgeId = fleet.badgeId;
      corridorId = this.corridors.requireCorridor(fleet.corridorId).corridorId;
      vehicleType = fleet.vehicleType;
    } else {
      const driver = this.corridors.driverByBadge(input.driverBadgeId);
      if (!driver) throw new GlosError('INVALID_INPUT', 'Unknown driver badge — not a registered fleet driver or on the corridor whitelist');
      badgeId = driver.badgeId;
      corridorId = this.corridors.requireCorridor(driver.corridorId).corridorId;
      vehicleType = driver.vehicleType;
    }

    const handed: string[] = [];
    const rejected: Array<{ parcelId: string; reason: string }> = [];
    const manifestId = `man_${randomBytes(6).toString('hex')}`;
    let loadKg = 0;

    for (const parcelId of input.parcelIds) {
      const parcel = this.parcels.get(parcelId);
      if (!parcel) { rejected.push({ parcelId, reason: 'unknown' }); continue; }
      if (parcel.originAgentDid !== input.agentDid) { rejected.push({ parcelId, reason: 'not_at_this_pudo' }); continue; }
      if (parcel.status !== 'At_PUDO') { rejected.push({ parcelId, reason: `status_${parcel.status}` }); continue; }
      // Vehicle handling rules (fleet drivers only): per-parcel weight, fragile, and total capacity.
      if (fleet) {
        if (parcel.weightKg > fleet.maxParcelKg) { rejected.push({ parcelId, reason: `over_${fleet.maxParcelKg}kg_for_vehicle` }); continue; }
        if (parcel.fragile && !fleet.allowsFragile) { rejected.push({ parcelId, reason: 'fragile_not_allowed_on_vehicle' }); continue; }
        if (loadKg + parcel.weightKg > fleet.capacityKg) { rejected.push({ parcelId, reason: 'vehicle_full' }); continue; }
      }

      parcel.status = 'On_Bus';
      parcel.corridorId = corridorId;
      parcel.driverBadgeId = badgeId;
      if (fleet && parcel.actualPerKm == null) parcel.actualPerKm = fleet.vehicle.pricePerKm; // the real carrier rate → flexible rebate
      parcel.handedToBusAt = new Date().toISOString();
      loadKg += parcel.weightKg;
      this.scan(parcel, 'On_Bus', badgeId, `manifest ${manifestId}`);
      handed.push(parcelId);
      void this.events.publish(GlosEvent.Pudo.ParcelHandedToBus, { parcelId, driverBadgeId: badgeId, corridorId, manifestId }, { source: 'pudo' }).catch(() => undefined);
    }

    // Pay the agent the handover fee once for the batch.
    if (handed.length) this.gate.payLabour(input.agentDid, HANDOVER_FEE, manifestId, 'manifest');

    return { manifestId, driverBadgeId: badgeId, corridorId, vehicle: fleet ? vehicleType : this.corridors.chooseVehicle(loadKg), handed, rejected };
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
  createInbound(input: { vendorId: string; externalOrderId?: string; originAgentDid: string; destAgentDid: string; buyerMobile: string; buyerEmail?: string; size?: ParcelSize; dimensionsCm?: { l: number; w: number; h: number }; weightKg?: number; contentPhotoRef: string; fragile?: boolean; items?: Array<{ name: string; qty: number }>; subtotal?: number; shippingPolicy: ShippingPolicy; routeMode?: 'flexible' | 'locked'; quote: ShipmentQuote }): { parcel: Parcel; label: PhygitalLabel | null; paid: boolean } {
    const origin = this.agents.get(input.originAgentDid);
    const dest = this.agents.get(input.destAgentDid);
    if (!input.contentPhotoRef) throw new GlosError('PHOTO_REQUIRED', 'A photo of the contents is required (the baseline for dispute resolution)');
    // Derive the tier from dimensions+weight when provided; otherwise trust the explicit size.
    const size: ParcelSize = input.dimensionsCm ? classifySize({ ...input.dimensionsCm, kg: input.weightKg ?? SIZE_WEIGHT_KG[input.size ?? 'M'] }) : (input.size ?? 'M');
    const weightKg = input.weightKg ?? SIZE_WEIGHT_KG[size];
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
      direction: 'inbound',
      size,
      dimensionsCm: input.dimensionsCm,
      weightKg,
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
    steps: Array<{ status: string; at: string; note?: string }>;
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
      steps: parcel.scans.map((s) => ({ status: s.status, at: s.at, note: s.note })),
    };
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
  private label(parcel: Parcel, destShop: string): PhygitalLabel {
    const qrPayload = `sbg:parcel:${parcel.parcelId}`;
    const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">`,
      `<rect width="320" height="180" fill="#fff" stroke="#0B1F5C"/>`,
      qrSvgGroup(qrPayload, 12, 12, 96),
      `<text x="120" y="32" font-family="Arial" font-size="15" font-weight="bold" fill="#0B1F5C">SeeBuyGet</text>`,
      `<text x="120" y="52" font-family="monospace" font-size="11">${esc(parcel.parcelId)}</text>`,
      `<text x="120" y="72" font-family="Arial" font-size="10">To: ${esc(destShop)}</text>`,
      `<text x="120" y="92" font-family="Arial" font-size="9" fill="#4A5261">${esc(parcel.destZone)}</text>`,
      `<text x="12" y="130" font-family="Arial" font-size="10" fill="#4A5261">Collect at the shop with this code:</text>`,
      `<text x="12" y="152" font-family="monospace" font-size="16" font-weight="bold" fill="#0B1F5C">${esc(parcel.collectionCode ?? '')}</text>`,
      `<text x="12" y="171" font-family="Arial" font-size="8" fill="#6E7684">Pre-paid · pick-up and drop-off · ${esc(qrPayload)}</text>`,
      `</svg>`,
    ].join('');
    return { parcelId: parcel.parcelId, qrPayload, svg };
  }

  list(filter: { status?: Parcel['status']; agentDid?: string; vendorId?: string } = {}): Parcel[] {
    return [...this.parcels.values()].filter((p) => (!filter.status || p.status === filter.status) && (!filter.agentDid || p.originAgentDid === filter.agentDid || p.destAgentDid === filter.agentDid) && (!filter.vendorId || p.vendorId === filter.vendorId));
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
