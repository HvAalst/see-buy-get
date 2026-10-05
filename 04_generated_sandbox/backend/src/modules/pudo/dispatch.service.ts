import type { ContractRef } from './carriage-contract.types';
import type { ClientRef } from './business-client.types';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { TransitAuthorityService, transitRefusal } from './transit-authority.service';
import { BorderRuleService } from './border-rules.service';
import type { BorderAdvice, BorderRefusal } from './border-rules.types';
import { mobilisationForCarrier, type HandBack, type Mobilisation } from './mobilisation';
import { GlosError } from '../../foundation/http/glos-error';
import { incotermEntry, riskBearerOf } from '../../foundation/incoterms/catalogue';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { GeoPoint, Tote, ToteHaul } from './pudo.types';
import { haversineKm } from './geo';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { CargoService } from './cargo.service';
import { CargoNature, Equipment, VehicleCapability } from './cargo.types';
import { VendorService } from './vendor.service';
import { RouteConstraintService } from './route-constraint.service';
import { RatingService, belowFloor, type DriverIssue } from './rating.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { WalletGateService } from './wallet-gate.service';
import { clampMultiplier, computeFreightPrice, computeToteHaul, distanceSplit, earningsPerKm, freightMultiplier, shipperCharge, type PriceBreakdown } from './pricing';
import { canonicalBody, bodyOf, excludedByShipper } from './freight-body';
import { blockersFor, takeable } from './freight-board';
import { nearestPlace } from './geo-gazetteer';
import { isPackaging, selfLoading, type Packaging } from './packaging';
import { buildSeries, carriersOn } from './market-series';
import { TruckSubtype } from './fleet.config';
import { isTempBreach, loadSafetyItems, missingKeys, requiredLoadKeys, requiredUnloadKeys, tempBand, unloadSafetyItems } from './heavy-cargo';
import { MediaService } from './media.service';
import { MarketPulseStore } from './market-pulse.store';
import { DEFAULT_MAX_MULTIPLIER, DEFAULT_MIN_MULTIPLIER, toteCapacityOf, VEHICLE_SPEC } from './fleet.config';
import { Router, ROUTER } from './router';
import { DEFAULT_PACKAGING, DEFAULT_PRICE_PER_KM, DEFAULT_WORK_RADIUS_KM, DISPATCH_MAX_DETOUR_KM, DISPATCH_MAX_PICKUP_MIN, FREIGHT_NOSHOW_GRACE_H, MARKET_MIN_DEMAND, MAX_WORK_RADIUS_KM, NETWORK_CURRENCY, NUDGE_RADIUS_KM, OFFER_TTL_MIN, PLATFORM_FEE_PCT, taxOn, TOTE_LOAD_FEE, TOTE_MAX_WAIT_H, VEHICLE_SPEED_KMH, MAX_CLAIM_AWARD } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import { hashPhone } from '../../foundation/identity/phone';
import { Vehicle } from './fleet.types';
import { BoardRow, Claimable, ClaimableKind, FleetOrderRow, Freight, FreightCommitMode, FreightProposal, FreightShipmentView, FreightStatus, MarketRow, MarketSeries, Offer, PostedFreightRow, RoutePlan, DeliveryFailure, FreightClaimKind, FreightClaimDecision, FreightClaimQueueRow, DELIVERY_FAILURES, FREIGHT_CLAIM_KINDS, FREIGHT_CLAIM_DECISIONS } from './dispatch.types';
import { paginate, textMatch, toCsv, withinDates, type Page } from './query';
import { buildOfferResponse, type OfferResponse } from './offer-response';

/**
 * FB0c — how a load may be taken, defaulted ON READ.
 *
 * Every freight registered before FB0c has no commitMode, and there is exactly one safe reading of that:
 * 'instant', which is how those loads have always behaved. Defaulting the other way would freeze the whole
 * existing marketplace behind a negotiation nobody was asked to have.
 */
export function commitModeOf(f: { commitMode?: FreightCommitMode }): FreightCommitMode {
  return f.commitMode === 'negotiate' ? 'negotiate' : 'instant';
}

/** Distances the board shows are read by a person, not settled against — one decimal is the honest precision
 *  for a road estimate, and it keeps deadhead + loaded === total instead of drifting by a rounding crumb. */
function round1(km: number): number {
  return Number.isFinite(km) ? Math.round(km * 10) / 10 : 0;
}

/**
 * FB3b — the rate card the PUBLIC market is priced on.
 *
 * Every price a driver sees is computed against their own vehicle's baseFee, per-km rate and multiplier
 * corridor. A caller with no account has no such card, and the choice is between showing no money at all
 * and showing the network's own defaults. The defaults win, but only because they are LABELLED: the
 * response carries `basis: 'indicative-network-default'`, and the page says it in words.
 *
 * Deliberately not a per-body rate table. The system holds no evidence that a flatbed's cost per kilometre
 * differs from a box body's, and inventing one would put a fabricated number under a page whose entire
 * purpose is to be the honest source somebody invests against.
 */
const REFERENCE_PROFILE = {
  baseFee: VEHICLE_SPEC.truck.defaultBaseFee,
  ratePerKm: DEFAULT_PRICE_PER_KM,
  min: DEFAULT_MIN_MULTIPLIER,
  max: DEFAULT_MAX_MULTIPLIER,
};

/** Round a pin to ~0.05° (≈5 km) — enough to map the market, not enough to meet a load at its gate. */
function coarsePoint(p: GeoPoint): GeoPoint {
  const snap = (n: number) => Math.round(n / 0.05) * 0.05;
  return { lat: Number(snap(p.lat).toFixed(3)), lng: Number(snap(p.lng).toFixed(3)) };
}

/* --------------------- driver jobs + earnings register (R5) — a driver's freight hauls -------------- */

/** A driver's "jobs" are the dedicated-freight hauls they CLAIMED (Freight.claimedBy === driverDid); each
 *  carries the driver's agreed earning (lockedPrice, locked at claim) and whether it has been paid out.
 *  Totes are excluded — they are unpriced to the driver (they settle on the parcel model). */
/** FP3b — how long after delivery a sender may still claim (the CMR's seven days for non-apparent damage). */
export const FREIGHT_CLAIM_WINDOW_DAYS = 7;
/** FP6 — how long after delivery the shipper may still rate the carrier. Longer than the claim window: a verdict is not a dispute. */
export const FREIGHT_RATING_WINDOW_DAYS = 30;

/** FP7 — the box-13 record from what the sender typed: nothing, when every field is blank. */
function instructionsOf(input: { text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string }, by: string | undefined, now: number): { instructions: Freight['instructions'] } | undefined {
  const text = input.text?.trim();
  const contactName = input.contactName?.trim();
  const contactPhone = input.contactPhone?.trim();
  const deliveryWindow = input.deliveryWindow?.trim();
  if (!text && !contactName && !contactPhone && !deliveryWindow) return undefined;
  return { instructions: { ...(text ? { text } : {}), ...(contactName ? { contactName } : {}), ...(contactPhone ? { contactPhone } : {}), ...(deliveryWindow ? { deliveryWindow } : {}), at: new Date(now).toISOString(), ...(by ? { by } : {}) } };
}

/** FP7 — the instructions as read: the box, plus every subsequent instruction with its time. Nothing when there are none. */
function instructionsViewOf(f: Freight): { text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string; at?: string; amendments?: Array<{ text: string; at: string }> } | undefined {
  if (!f.instructions && !f.instructionAmendments?.length) return undefined;
  const i = f.instructions;
  return {
    ...(i?.text ? { text: i.text } : {}),
    ...(i?.contactName ? { contactName: i.contactName } : {}),
    ...(i?.contactPhone ? { contactPhone: i.contactPhone } : {}),
    ...(i?.deliveryWindow ? { deliveryWindow: i.deliveryWindow } : {}),
    ...(i?.at ? { at: i.at } : {}),
    ...(f.instructionAmendments?.length ? { amendments: f.instructionAmendments.map((a) => ({ text: a.text, at: a.at })) } : {}),
  };
}

/** FP6 — the public tracking link for a key: the Send app's track page, which now answers loads as well as parcels. */
function trackingUrlOf(trackingKey: string): string {
  return `${appUrl('send')}?track=${encodeURIComponent(trackingKey)}`;
}

export interface DriverJobsQuery {
  q?: string; // job code / description / destination / tracking / order ref
  status?: FreightStatus;
  paid?: 'paid' | 'unpaid'; // the driver payout for this job
  from?: string; // ISO or YYYY-MM-DD (inclusive)
  to?: string;
  sort?: 'newest' | 'oldest' | 'earn_desc' | 'earn_asc';
  limit?: number | string;
  offset?: number | string;
}

export interface DriverJobRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  status: FreightStatus;
  cargoClass: string;
  weightKg: number;
  earning?: number; // lockedPrice — the driver's agreed pay for the haul
  paid: boolean; // driverPaid
  /** B2 — the shipper pays the carrier for this one directly; nothing is owed by us, now or later. */
  direct?: boolean;
  /** FP8 — what an upheld claim took back from that pay. */
  clawback?: number;
  claimedAt?: string;
  deliveredAt?: string;
  createdAt: string;
}

/** The date a job is filed under in the register — when the driver CLAIMED it (falls back to creation). */
function jobDate(f: Freight): string {
  return f.claimedAt ?? f.createdAt;
}

export function driverJobRowOf(f: Freight): DriverJobRow {
  return { freightId: f.freightId, code: f.code, description: f.description, destLabel: f.destLabel, status: f.status, cargoClass: f.cargoClass, weightKg: f.weightKg, earning: f.status === 'cancelled' ? undefined : f.lockedPrice, paid: Boolean(f.driverPaid), ...(f.settlement === 'between_parties' ? { direct: true } : {}), ...(f.clawback ? { clawback: f.clawback.amount } : {}), claimedAt: f.claimedAt, deliveredAt: f.deliveredAt, createdAt: f.createdAt };
}

export interface DriverJobsSummary {
  earned: number; // sum of the agreed earning over the set
  paid: number; // of that, what has been paid out
  unpaid: number; // earned - paid - direct (still owed by us)
  /** B2 — earned on hauls the shipper pays the carrier for directly: earned, and never owed by us. */
  direct: number;
  delivered: number; // jobs completed
  count: number;
}

export function driverJobsSummaryOf(rows: Freight[]): DriverJobsSummary {
  let earned = 0;
  let paid = 0;
  let direct = 0;
  let delivered = 0;
  for (const f of rows) {
    const e = f.status === 'cancelled' ? 0 : (f.lockedPrice ?? 0) - (f.clawback?.amount ?? 0); // FP3 — a withdrawn load pays nothing; FP8 — an upheld claim takes back
    earned += e;
    if (f.driverPaid) paid += e;
    else if (f.settlement === 'between_parties') direct += e;
    if (f.status === 'delivered') delivered += 1;
  }
  earned = Math.round(earned * 100) / 100;
  paid = Math.round(paid * 100) / 100;
  direct = Math.round(direct * 100) / 100;
  return { earned, paid, unpaid: Math.round((earned - paid - direct) * 100) / 100, direct, delivered, count: rows.length };
}

function driverJobSort(sort?: DriverJobsQuery['sort']): (a: Freight, b: Freight) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => jobDate(a).localeCompare(jobDate(b));
    case 'earn_desc':
      return (a, b) => (b.lockedPrice ?? 0) - (a.lockedPrice ?? 0);
    case 'earn_asc':
      return (a, b) => (a.lockedPrice ?? 0) - (b.lockedPrice ?? 0);
    default:
      return (a, b) => jobDate(b).localeCompare(jobDate(a)); // newest first
  }
}

/** Filter + search + sort a driver's freight jobs (PURE — restricts to THIS driver's claimed hauls). */
export function filterDriverJobs(rows: Freight[], driverDid: string, q: DriverJobsQuery): Freight[] {
  return filterJobsFor(rows, (f) => f.claimedBy === driverDid, q);
}

/* ---------------------------------------------------- FP1 — the FLEET's register: every driver's hauls ---- */

export interface FleetJobsQuery extends DriverJobsQuery {
  /** One of the fleet's drivers, or every one. */
  driver?: string;
}

export interface FleetJobRow extends DriverJobRow {
  driverDid: string;
  driverName: string;
}

export interface FleetEarningsSummary extends DriverJobsSummary {
  /** Who earned what, most first — the question a manager asks on payday. */
  byDriver: Array<{ driverDid: string; driverName: string; earned: number; delivered: number; count: number }>;
  /** Filed by the month the job was claimed, newest first. */
  byMonth: Array<{ month: string; earned: number; delivered: number; count: number }>;
}

/**
 * The fleet's own register over its drivers' hauls. A fleet is paid as ONE supplier for all of them, so the
 * register is one list with the driver as a column — and the summary cuts it by driver and by month, which are
 * the two ways a fleet owner reads it: who earned it, and what the month came to.
 */
/** `isTheFleets` answers whether a haul was taken for the fleet — see DispatchService.carrierOf. */
export function filterFleetJobs(rows: Freight[], isTheFleets: (f: Freight) => boolean, q: FleetJobsQuery): Freight[] {
  return filterJobsFor(rows, (f) => Boolean(f.claimedBy) && isTheFleets(f) && (!q.driver || f.claimedBy === q.driver), q);
}

export function fleetJobRowOf(f: Freight, nameOf: (did: string) => string): FleetJobRow {
  return { ...driverJobRowOf(f), driverDid: f.claimedBy ?? '', driverName: nameOf(f.claimedBy ?? '') };
}

export function fleetEarningsSummaryOf(rows: Freight[], nameOf: (did: string) => string): FleetEarningsSummary {
  const base = driverJobsSummaryOf(rows);
  const drivers = new Map<string, { driverDid: string; driverName: string; earned: number; delivered: number; count: number }>();
  const months = new Map<string, { month: string; earned: number; delivered: number; count: number }>();
  for (const f of rows) {
    const did = f.claimedBy ?? '';
    const d = drivers.get(did) ?? { driverDid: did, driverName: nameOf(did), earned: 0, delivered: 0, count: 0 };
    const month = jobDate(f).slice(0, 7);
    const m = months.get(month) ?? { month, earned: 0, delivered: 0, count: 0 };
    const e = f.status === 'cancelled' ? 0 : (f.lockedPrice ?? 0) - (f.clawback?.amount ?? 0); // FP3 — a withdrawn load pays nothing; FP8 — an upheld claim takes back
    d.earned += e;
    m.earned += e;
    d.count += 1;
    m.count += 1;
    if (f.status === 'delivered') {
      d.delivered += 1;
      m.delivered += 1;
    }
    drivers.set(did, d);
    months.set(month, m);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    ...base,
    byDriver: [...drivers.values()].map((d) => ({ ...d, earned: r2(d.earned) })).sort((a, b) => b.earned - a.earned),
    byMonth: [...months.values()].map((m) => ({ ...m, earned: r2(m.earned) })).sort((a, b) => b.month.localeCompare(a.month)),
  };
}

export function fleetJobsToCsv(rows: Freight[], nameOf: (did: string) => string): string {
  return toCsv(
    ['Driver', 'Job', 'Description', 'Destination', 'Status', 'Class', 'Weight kg', 'Earning', 'Currency', 'Booked', 'Claimed', 'Delivered'],
    rows.map((f) => [nameOf(f.claimedBy ?? ''), f.code, f.description, f.destLabel, f.status, f.cargoClass, f.weightKg, f.lockedPrice ?? '', f.lockedPrice == null ? '' : NETWORK_CURRENCY, f.driverPaid ? 'yes' : f.settlement === 'between_parties' ? 'by the shipper' : 'no', f.claimedAt ?? '', f.deliveredAt ?? '']),
  );
}

/** The register's one filter, for whichever set of hauls a caller may see. */
function filterJobsFor(rows: Freight[], mine: (f: Freight) => boolean, q: DriverJobsQuery): Freight[] {
  let out = rows.filter(mine);
  if (q.status) out = out.filter((f) => f.status === q.status);
  if (q.paid) out = out.filter((f) => (q.paid === 'paid' ? f.driverPaid === true : !f.driverPaid && f.settlement !== 'between_parties'));
  if (q.from || q.to) out = out.filter((f) => withinDates(jobDate(f), q.from, q.to));
  if (q.q) out = out.filter((f) => textMatch([f.code, f.description, f.destLabel, f.trackingKey, f.externalOrderId], q.q));
  return [...out].sort(driverJobSort(q.sort));
}

export function driverJobsToCsv(rows: Freight[]): string {
  return toCsv(
    ['Job', 'Description', 'Destination', 'Status', 'Class', 'Weight kg', 'Earning', 'Currency', 'Paid', 'Claimed', 'Delivered'],
    rows.map((f) => [f.code, f.description, f.destLabel, f.status, f.cargoClass, f.weightKg, f.lockedPrice ?? '', f.lockedPrice == null ? '' : NETWORK_CURRENCY, f.driverPaid ? 'yes' : f.settlement === 'between_parties' ? 'by the shipper' : 'no', f.claimedAt ?? '', f.deliveredAt ?? '']),
  );
}

/**
 * DispatchService — the opportunistic line-haul marketplace (Compendium Ch 19). PUDO agents (and
 * MDPs) bag parcels into totes bound for a destination; a full tote — or one that has waited the max
 * 24 h — is PUBLISHED for claim. A driver declares a route A→B and the platform suggests the loads
 * sitting on the way ("≈5 min from <place>, a shipment is ready — claim it?"), sized to the REMAINING
 * capacity of the driver's coupled vehicle (whose total load the fleet manager set). The driver
 * claims, ignores, or simply doesn't answer — in which case the offer auto-ignores when it lapses.
 */
@Injectable()
export class DispatchService {
  // Durable: a freight job is a real transport obligation (a diverted P4+ order is a paid commitment),
  // so — unlike the ephemeral offer bulletin — it must survive a restart.
  private readonly freights = new PersistentMap<string, Freight>('pudo-freights');
  private readonly offers = new Map<string, Offer>();
  // FB0c — durable like the freight it negotiates over, and for the same reason: a price a driver named is a
  // commercial position the shipper is weighing, not a bulletin entry that may quietly vanish on a restart.
  private readonly proposals = new PersistentMap<string, FreightProposal>('pudo-freight-proposals');
  /** Live "decline this one offer" capabilities (see mintDeclineToken). In-memory like the offers they answer. */
  private readonly declineTokens = new Map<string, { offerId: string; expiresAt: number }>();
  /** WHY it was quiet today, split by cause: their own floor, and their own rate. Same-day and in memory —
   *  a restart losing it is correct for a figure whose whole meaning is "since this morning". */
  private readonly quietToday = new Map<string, { day: string; belowFloor: number; overBudget: number }>();
  private freightSeq = 0;

  constructor(
    private readonly totes: ToteService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly fleet: FleetService,
    private readonly events: EventBus,
    private readonly cargo: CargoService,
    private readonly vendors: VendorService,
    private readonly gate: WalletGateService,
    private readonly market: MarketPulseStore,
    private readonly media: MediaService,
    private readonly ratings: RatingService,
    private readonly constraints: RouteConstraintService,
    // For the driver's own standing "do not wake me below this". Read HERE rather than passed in, because
    // the caller is a GPS fix and there is no request to carry it — which is exactly why this path had no
    // floor at all until now.
    private readonly drivers: DriverService,
    // For the selling sister's rate on a dedicated haul — the lane where a specialised vehicle is bought
    // and where profit-on-risk is actually earned.
    private readonly entities: EntityService,
    @Inject(ROUTER) private readonly router: Router,
    // CA6 — the rules of crossing a border. Optional so the many specs that build dispatch by hand keep working;
    // the app always provides it, and app.boot.spec is what would catch it missing.
    @Optional() private readonly borders?: BorderRuleService,
    // BL1 — who may move uncleared goods. Optional for the same reason as borders above: the specs that
    // build dispatch by hand keep working, and app.boot.spec is what catches it missing from the module.
    @Optional() private readonly transit?: TransitAuthorityService,
  ) {
    this.freightSeq = [...this.freights.values()].length; // continue the human FRT-NNN sequence after a restart
  }

  // --- publishing ---

  /**
   * Promote filling totes that are full or have waited ≥ 24 h to 'available' (claimable).
   *
   * A SHOP bag is never promoted here. It is a physical bag on a counter, open until a human shuts it, and
   * publishing it behind the shopkeeper would advertise a bag a driver cannot take — and lock the shop out
   * of the completeness gate, which only accepts a bag that is still filling. So the sweep ASKS instead:
   * one nudge when it fills, one more when it has waited out the clock, and the parcels are never stranded
   * quietly because someone forgot to close a bag.
   */
  publishReady(now: number = Date.now()): string[] {
    const published: string[] = [];
    for (const t of this.totes.list({ status: 'filling' })) {
      const aged = t.filledAt ? now - new Date(t.filledAt).getTime() >= TOTE_MAX_WAIT_H * 3_600_000 : false;
      if (!t.parcels.length) continue;
      const full = this.totes.isFull(t);
      if (!full && !aged) continue;
      if (t.sealRequired) {
        this.promptSeal(t, aged ? 'max_wait' : 'full');
        continue;
      }
      this.totes.markAvailable(t.code);
      published.push(t.code);
      void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code: t.code, reason: full ? 'full' : 'max_wait', weightKg: t.weightKg, destination: t.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
    }
    return published;
  }

  /**
   * Ask a shop to close a bag that is ready to go. Once per reason and never backwards: a bag that filled
   * (one nudge) and then waited out the clock earns a second, sharper one — but a sweep running every few
   * minutes must not nag a counter every few minutes.
   */
  private promptSeal(tote: Tote, reason: 'full' | 'max_wait'): void {
    if (tote.sealPromptedFor === reason || (reason === 'full' && tote.sealPromptedFor === 'max_wait')) return;
    this.totes.noteSealPrompt(tote.code, reason);
    void this.events
      .publish(
        GlosEvent.Pudo.ToteNeedsSeal,
        { code: tote.code, agentDid: tote.locationId, reason, destination: tote.destinationLabel, parcels: tote.parcels.length },
        { source: 'pudo' },
      )
      .catch(() => undefined);
  }

  /** Agent manually publishes a not-yet-full tote early. */
  release(code: string): { code: string; status: string } {
    // A shop bag has its own early-publish, and it is the seal: closing the bag runs the completeness gate
    // and publishes in one act. Releasing it from here would put a bag on the marketplace with parcels for
    // it still sitting on the shelf, unrecorded — the exact hole the gate exists to close.
    const bag = this.totes.requireByCode(code);
    if (bag.sealRequired) throw new GlosError('INVALID_STATE', `Bag ${code} is a shop bag — close it at the counter to send it`);
    const t = this.totes.markAvailable(code);
    void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code: t.code, reason: 'manual', weightKg: t.weightKg, destination: t.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
    return { code: t.code, status: t.status };
  }

  registerFreight(input: { description: string; pickupLocation: { lat: number; lng: number }; pickupLabel: string; destLabel: string; destLocation?: { lat: number; lng: number }; weightKg: number; fragile?: boolean; bulk?: boolean; packaging?: Packaging; natureCode?: CargoNature; dimensionsCm?: [number, number, number]; heightM?: number; indivisible?: boolean; bodyHint?: TruckSubtype; excludedBodies?: TruckSubtype[]; commitMode?: FreightCommitMode; postedByDid?: string; postedByName?: string; onBehalfOf?: ClientRef; shipperDid?: string; originEquipment?: Equipment[]; destEquipment?: Equipment[]; buyerMobile?: string; externalOrderId?: string; maxSpend?: number; scheduledPickupAt?: string; allowEarlyClaim?: boolean; pickupCountry?: string; destCountry?: string; instructions?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string; incoterm?: string; namedPlace?: string; containerNo?: string; emptyRun?: boolean; bonded?: boolean; bondCountry?: string; contract?: ContractRef; deliverOn?: string }, now: number = Date.now()): Freight {
    this.freightSeq += 1;
    // A future pickup date parks the load for later; a past/absent date ships now. A supplied-but-unparseable
    // date is a CALLER ERROR — fail closed (never silently ship-now what was meant to be scheduled). Store the
    // canonical UTC instant so the later due-comparison is unambiguous.
    let scheduledPickupAt: string | undefined;
    if (input.scheduledPickupAt != null) {
      const t = new Date(input.scheduledPickupAt).getTime();
      if (Number.isNaN(t)) throw new GlosError('INVALID_INPUT', 'scheduledPickupAt is not a valid date/time');
      if (t > now) scheduledPickupAt = new Date(t).toISOString();
    }
    const scheduled = scheduledPickupAt != null;
    // P1 — an order under a standing contract is that fleet's, on no market, for a day it must arrive by.
    const contract = input.contract;
    if (contract && !input.deliverOn) throw new GlosError('FIELD_REQUIRED', 'An order under a contract says which day it must arrive', { field: 'deliverOn' });
    // The shipper's early-claim choice (default: allow — a scarce truck can commit ahead of the date).
    const allowEarlyClaim = input.allowEarlyClaim ?? true;
    // S32: give the freight a cargo model so it matches vehicles like a tote does — class (from weight+dims)
    // drives the required equipment, the primary nature drives the required vehicle capability.
    const natureCode: CargoNature = input.natureCode ?? 'GEN';
    const cargoClass = this.cargo.classify({ kg: input.weightKg, dimsCm: input.dimensionsCm });
    // FB5 — how the load is PACKED, which decides both the body and whether anything has to lift it. Falls
    // back to the DEPLOYMENT's default rather than a hard-coded one: the ordinary way to send a tonne of
    // sugar is loose in Rotterdam and in sacks in Nakuru, and neither is "the" default for the network.
    const packaging = isPackaging(input.packaging) ? input.packaging : DEFAULT_PACKAGING;
    // `bulk` now means exactly one thing — loose — which is what the vehicle flag and the board's
    // NO_BULK_BODY blocker have always assumed. It is derived, never asked for.
    const bulk = selfLoading(packaging);
    // THE FIX THAT IS NOT ABOUT ANALYTICS: only loose goods load and discharge themselves. Bagged cement was
    // reporting that it needed NO handling equipment — the "you would need a forklift" signal going silent on
    // eighteen tonnes of sacks, which is the load that needs it most.
    const requiredEquipment = selfLoading(packaging) ? [] : this.cargo.requiredEquipment(cargoClass);
    const requiredCapabilities = this.cargo.requiredCapabilities([natureCode]);
    // FB0b — conclude which BODY this load needs, and stamp the conclusion. Derived from the load's own facts,
    // never from the minter's hint: the hint is advisory by decision, and a market series built on a shop
    // clerk's guess at "skeletal vs flatbed" would not be worth selling.
    const bodyDerived = canonicalBody({ requiredCapabilities, packaging, natureCode, weightKg: input.weightKg, dimensionsCm: input.dimensionsCm, indivisible: input.indivisible });
    // S32c: flag ends whose site cannot HANDLE this cargo — a site needs at least one qualifying piece of the
    // required equipment (any-of). Only checked when the site's manifest is known (a diverted order → its
    // PUDOs); a bulletin freight with only geo labels leaves both ends unknown → no gap flagged.
    const siteHandles = (have?: Equipment[]) => requiredEquipment.length === 0 || (have != null && requiredEquipment.some((eq) => have.includes(eq)));
    const equipmentGaps: Array<'origin' | 'dest'> = [];
    if (input.originEquipment != null && !siteHandles(input.originEquipment)) equipmentGaps.push('origin');
    if (input.destEquipment != null && !siteHandles(input.destEquipment)) equipmentGaps.push('dest');
    const freight: Freight = {
      freightId: `frt_${randomBytes(5).toString('hex')}`,
      code: `FRT-${String(this.freightSeq).padStart(3, '0')}`,
      description: input.description,
      pickupLocation: input.pickupLocation,
      pickupLabel: input.pickupLabel,
      destLabel: input.destLabel,
      destLocation: input.destLocation,
      weightKg: input.weightKg,
      // FB0b — KEEP the measurements. They were already being taken (cargo.classify above reads them); they
      // were simply never stored, so every downstream question about what body the load needs had to guess.
      dimensionsCm: input.dimensionsCm,
      // How tall it stands on a deck. Stored only when somebody actually knows — see the field's comment:
      // absent stays HEIGHT_UNKNOWN against a low bridge, which is the truth and not a pass.
      ...(input.heightM != null && input.heightM > 0 ? { heightM: Math.round(input.heightM * 100) / 100 } : {}),
      indivisible: input.indivisible,
      // ADVISORY only — never consulted by matching. Stored so the board can show what the shipper expects and
      // the analytics can report where shippers ask for a different body than the cargo actually needs.
      bodyHint: input.bodyHint,
      excludedBodies: input.excludedBodies?.length ? input.excludedBodies : undefined,
      bodyDerived,
      // FB0c — 'negotiate' means the minter wants to agree a price before anyone commits. Stored only when it
      // is actually chosen: absent reads as 'instant', which is how every load has always behaved.
      // P1 — never on an order under a contract: its price is the contract's, and a negotiable load cannot be assigned.
      commitMode: input.commitMode === 'negotiate' && !contract ? 'negotiate' : undefined,
      // Who NEGOTIATES for the load — not necessarily who pays. A counter booking has no shipperDid at all
      // (the customer's cash settles off-platform) and still needs a shop that can answer a proposal.
      postedByDid: input.postedByDid,
      ...(input.postedByName?.trim() ? { postedByName: input.postedByName.trim().slice(0, 80) } : {}),
      ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
      // B2 — a customer's business settles with the carrier itself: stamped here, once, from who posted it, so
      // every path a business posts through (its own form, an import's road leg, a box going home) is covered
      // and delivery never has to work out afterwards whose money it was.
      ...(this.entities.byDid(input.postedByDid)?.kind === 'business' || contract ? { settlement: 'between_parties' as const } : {}),
      // P1 — and a contract order is settled under the contract, between the two of them, whoever placed it.
      ...(contract ? { contract, deliverOn: input.deliverOn } : {}),
      fragile: input.fragile ?? false,
      bulk,
      packaging,
      cargoClass,
      natureCode,
      requiredCapabilities,
      // Handling equipment is for DISCRETE/palletised cargo (a forklift/pallet-jack/crane). Loose BULK
      // (cement in a tipper, grain in a hopper) self-loads via silo/tipping, so it needs no handling gear —
      // its constraint is `carriesBulk` (checked in vehicleCanCarry), not a forklift.
      requiredEquipment,
      equipmentGaps,
      shipperDid: input.shipperDid,
      // CA6 — the country at each end, where it is known (a shop's), so the rules of crossing can be asked.
      ...(input.pickupCountry ? { pickupCountry: input.pickupCountry.toUpperCase() } : {}),
      ...(input.destCountry ? { destCountry: input.destCountry.toUpperCase() } : {}),
      // S32d — keep the buyer joined to their diverted order by phone HASH only (never the cleartext number:
      // the raw Freight goes to drivers/operators). Plus a public tracking key + the order ref. Only when a
      // buyer is known (a diverted order; not a bulletin freight).
      buyerPhoneHash: input.buyerMobile ? hashPhone(input.buyerMobile) || undefined : undefined,
      // CL1 — the agreed term, canonicalised. An unknown code is dropped rather than stored: the caller was
      // already refused at the door, and a term nobody recognises must never end up deciding who may claim.
      ...(incotermEntry(input.incoterm) ? { incoterm: incotermEntry(input.incoterm)!.code } : {}),
      ...(input.namedPlace?.trim() ? { namedPlace: input.namedPlace.trim().slice(0, 120) } : {}),
      trackingKey: `T-${randomBytes(5).toString('hex').toUpperCase()}`,
      externalOrderId: input.externalOrderId,
      // Y2 — a box going home is a load whose subject is the CONTAINER, and an empty one says so.
      ...(input.containerNo ? { containerNo: input.containerNo } : {}),
      ...(input.emptyRun ? { emptyRun: true } : {}),
      // BL1 — uncleared goods. The country defaults to the leg's own, because a bond is held where the
      // wheels turn; it is stated separately only so a caller cannot quietly mean a different one.
      ...(input.bonded ? { bonded: true, bondCountry: (input.bondCountry ?? input.pickupCountry ?? '').toUpperCase() } : {}),
      // FP7 — box 13 at posting, when the poster said anything.
      ...(instructionsOf({ text: input.instructions, contactName: input.contactName, contactPhone: input.contactPhone, deliveryWindow: input.deliveryWindow }, input.postedByDid, now) ?? {}),
      // S34c — a positive, finite cap only; a zero/negative/NaN budget is treated as "no cap" (never a load
      // nobody can ever afford to move) so a bad value can't silently strand a diverted order.
      maxSpend: input.maxSpend != null && Number.isFinite(input.maxSpend) && input.maxSpend > 0 ? Math.round(input.maxSpend * 100) / 100 : undefined,
      // A scheduled load is booked for later; if allowEarlyClaim it is still reservable now (see availableLoads).
      scheduledPickupAt,
      allowEarlyClaim,
      status: contract ? 'ordered' : scheduled ? 'scheduled' : 'available',
      createdAt: new Date().toISOString(),
    };
    this.freights.set(freight.freightId, freight);
    // Ping nearby drivers NOW for a ship-now load OR an early-claimable scheduled one (so a scarce truck can
    // commit ahead of the date). A no-early-claim scheduled load stays silent until due (publishReadyFreight).
    // A contract order pings nobody: it is not for whoever is nearby.
    if (!contract && (!scheduled || allowEarlyClaim)) {
      void this.events
        .publish(GlosEvent.Pudo.FreightPosted, { freightId: freight.freightId, code: freight.code, pickupLocation: freight.pickupLocation, destLabel: freight.destLabel, weightKg: freight.weightKg, cargoClass: freight.cargoClass }, { source: 'pudo' })
        .catch(() => undefined);
    }
    return freight;
  }

  /**
   * The scheduled-freight maintenance pass — the freight analogue of publishReady() for totes. Called lazily
   * from suggest() (a driver requesting work always sees the current picture) and safe to call anywhere:
   *  1. PROMOTE a scheduled load whose pickup date has arrived to 'available'. A no-early-claim load pings
   *     drivers now (its first ping); an early-claimable one already pinged at booking, so it flips silently.
   *  2. RELEASE a no-show: an EARLY-claimed scheduled load not picked up by its date + grace goes back to the
   *     marketplace (rebating the shipper if billed), so an early reservation can never strand a shipment.
   * Returns the freightIds promoted.
   */
  publishReadyFreight(now: number = Date.now()): string[] {
    const activated: string[] = [];
    const ping = (f: Freight) =>
      void this.events
        .publish(GlosEvent.Pudo.FreightPosted, { freightId: f.freightId, code: f.code, pickupLocation: f.pickupLocation, destLabel: f.destLabel, weightKg: f.weightKg, cargoClass: f.cargoClass }, { source: 'pudo' })
        .catch(() => undefined);
    for (const f of this.freights.values()) {
      if (!f.scheduledPickupAt) continue;
      const due = new Date(f.scheduledPickupAt).getTime();
      if (f.status === 'scheduled' && due <= now) {
        // Its date arrived while still unclaimed → it becomes a normal available load.
        f.status = 'available';
        this.freights.set(f.freightId, f);
        activated.push(f.freightId);
        if (!f.allowEarlyClaim) ping(f); // an early-claim load already pinged at booking — don't double-notify
      } else if (
        (f.status === 'claimed' || f.status === 'scheduled') &&
        f.claimedBy &&
        !f.pickedUpAt &&
        // The grace window runs from the LATER of the pickup date and the claim instant — never from the fixed
        // date alone. A load claimed AFTER its date (a late reservation, or a load re-claimed after an earlier
        // release) gets a full fresh grace from its claim, so it can't be re-released before the driver can pick
        // up — the thrash that anchoring purely to a now-past `due` would cause.
        now > Math.max(due, f.claimedAt ? new Date(f.claimedAt).getTime() : due) + FREIGHT_NOSHOW_GRACE_H * 3_600_000
      ) {
        // A no-show: reserved ahead, but not picked up by the pickup date + grace → free it + undo the charge.
        if (f.paidStatus === 'billed' && f.shipperDid && this.vendors.has(f.shipperDid)) {
          // Reverses exactly what was charged, off the stamp — the rates behind that figure are knobs, and
          // a no-show can be days after the claim. A load billed before the stamp existed falls back to
          // recomputing, which is what it did before and is still right for a rate nobody has touched.
          const charged = f.billed ?? this.shipperBill(f.lockedPrice ?? 0, f);
          this.vendors.rebate(f.shipperDid, f.freightId, charged.gross, 'freight no-show release', charged.tax, charged.provision);
        }
        f.status = 'available';
        f.scheduledPickupAt = undefined; // its date has passed — it's now a plain ship-now load: no stale gate, no 'scheduled' timeline, and this loop skips it forever after (so it can never no-show-release twice)
        f.claimedBy = undefined;
        f.carrierDid = undefined; // nobody carried it: it goes back on the board belonging to no carrier
        // FB4a — and the body that never actually carried it. A released no-show must leave no trace in the
        // moved series: it was offered and not taken, which is precisely the gap the series exists to show.
        f.carriedBy = undefined;
        f.claimedAt = undefined;
        f.lockedPrice = undefined;
        f.priceBreakdown = undefined;
        f.lockedAt = undefined;
        f.paidStatus = undefined;
        f.driverPaid = undefined;
        this.freights.set(f.freightId, f);
        ping(f); // back on the market — re-notify nearby drivers
      }
    }
    return activated;
  }

  /** Every diverted freight a buyer (by phone hash) is a party to — the "my shipments" freight section. */
  freightsForPhoneHash(phoneHash: string): FreightShipmentView[] {
    if (!phoneHash) return [];
    return [...this.freights.values()]
      .filter((f) => f.buyerPhoneHash === phoneHash)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((f) => DispatchService.toShipmentView(f));
  }

  /** The buyer-facing, PII-free projection of a freight job + its status timeline (built from the stamped
   *  transition times). Never carries the buyer's number, the shipper, or the pickup coordinates. */
  static toShipmentView(f: Freight): FreightShipmentView {
    // A scheduled load's first milestone is 'scheduled' (booked for a future date), not 'available'.
    const timeline: Array<{ status: Freight['status']; at: string }> = [{ status: f.scheduledPickupAt ? 'scheduled' : 'available', at: f.createdAt }];
    if (f.claimedAt) timeline.push({ status: 'claimed', at: f.claimedAt });
    if (f.pickedUpAt) timeline.push({ status: 'in_transit', at: f.pickedUpAt });
    if (f.deliveredAt) timeline.push({ status: 'delivered', at: f.deliveredAt });
    if (f.cancelledAt) timeline.push({ status: 'cancelled', at: f.cancelledAt });
    return {
      freightId: f.freightId,
      code: f.code,
      status: f.status,
      cargoClass: f.cargoClass,
      destLabel: f.destLabel,
      weightKg: f.weightKg,
      trackingKey: f.trackingKey,
      externalOrderId: f.externalOrderId,
      equipmentGaps: f.equipmentGaps,
      createdAt: f.createdAt,
      scheduledPickupAt: f.scheduledPickupAt,
      timeline,
      tempBreached: f.tempBreached, // S33b — the only temp fact a buyer sees (a boolean; never the readings)
    };
  }

  // --- matching ---

  /** Suggest the loads sitting along a driver's A→B route, within remaining vehicle capacity. `minEarn` is the
   *  driver's own floor: hide freight paying less than this (their surge-threshold filter). */
  suggest(driverDid: string, route: RoutePlan, now: number = Date.now(), minEarn?: number): Offer[] {
    if (this.fleet.overHours(driverDid, now)) return []; // FP8 — nothing is offered to a driver who may not take it
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'Couple the driver to a vehicle before requesting work');
    if (!this.fleet.acceptingWork(driverDid, now)) return []; // snoozed: the screen says so, and says how to undo it
    this.publishReady(now);
    this.publishReadyFreight(now); // any scheduled freight that has come due joins the marketplace now
    const remaining = this.remainingCapacity(driverDid);
    const remainingTotes = this.remainingTotes(driverDid); // bag spaces, the constraint kilos cannot express
    const profile = this.pricingProfile(vehicle); // S34 — fixed for this driver+vehicle across all offers here
    const floor = minEarn != null && Number.isFinite(minEarn) && minEarn > 0 ? minEarn : undefined;

    // REP4 — the ENFORCING guard: a driver whose reliable rating has fallen below the network floor is barred
    // from the FREIGHT marketplace (the premium, high-value loads). They keep their tote/parcel line-haul work
    // — which is what earns them ratings — so the bar is RECOVERABLE: as fresh good ratings pull their average
    // back above the floor, freight returns. Cold-start safe (belowFloor never fires for a new/thinly-rated driver).
    const freightBarred = belowFloor(this.ratings.driverRating(driverDid));

    const matches = this.availableLoads()
      .filter((load) => !(freightBarred && load.kind === 'freight'))
      .map((load) => ({ load, detour: this.router.detourKm(route.from, load.pickupLocation, route.to), minutesAway: this.minutes(route.from, load.pickupLocation) }))
      .filter(({ load, detour, minutesAway }) => detour <= DISPATCH_MAX_DETOUR_KM && minutesAway <= DISPATCH_MAX_PICKUP_MIN && this.vehicleCanCarry(vehicle, load, remaining, remainingTotes) && this.borderRefusals(vehicle, driverDid, load).length === 0 && !this.bondRefusal(driverDid, load))
      .sort((a, b) => a.detour - b.detour || a.minutesAway - b.minutesAway);

    const out: Offer[] = [];
    for (const { load, detour, minutesAway } of matches) {
      // S34 — freight offers carry a transparent price: P = B + D·R_base·M, D = deadhead (driver→pickup) +
      // haul (pickup→dropoff), M the market multiplier flexed within THIS vehicle's own [min,max] corridor. The
      // price shown here is indicative; it is LOCKED (recomputed against the vehicle at that instant) on claim.
      const price = load.kind === 'freight'
        ? computeFreightPrice({
            baseFee: profile.baseFee,
            ratePerKm: profile.ratePerKm,
            deadheadKm: this.router.roadKm(route.from, load.pickupLocation),
            tripKm: load.destLocation ? this.router.roadKm(load.pickupLocation, load.destLocation) : 0,
            // S34b — the market multiplier for the PICKUP's zone (supply/demand + admin surge), clamped to the corridor.
            multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(load.pickupLocation, now)),
          })
        : undefined;
      // S34c — two gates BEFORE reusing/creating an offer, computed against the CURRENT price so a load that no
      // longer qualifies is dropped even if a stale offer exists: (1) the shipper's budget — don't offer a freight
      // whose all-in charge would exceed what the shipper agreed to pay (a cheaper vehicle may still get it);
      // (2) the driver's own minimum-earning filter. Both apply to freight only (totes settle on a different model).
      if (price && load.kind === 'freight') {
        if (load.maxSpend != null && this.shipperBillFor(price.total, load.ref).gross > load.maxSpend) continue;
        if (floor != null && price.total < floor) continue;
      }
      out.push(this.makeOffer(driverDid, load, { detour, minutesAway, price, ratePerKm: profile.ratePerKm, time: this.timeCost(vehicle, route, load), now }));
    }
    return out;
  }

  /**
   * Mint (or re-use) the one live offer for this driver + load. One live offer per pair: re-asking a driver
   * about a load they are already looking at is how a helpful app becomes a nuisance, and it would also let
   * two offers for the same bag disagree about the price.
   */
  /**
   * Nothing is offered to a driver who has snoozed new work.
   *
   * Checked at the one place every offer is born, so the route search, the near-me search and the moving
   * pop-up all go quiet together — three surfaces cannot drift apart if they share the gate. What is NOT
   * touched: anything already claimed. Snoozing offers is not going off shift, and a driver holding a bag
   * must still be able to hand it over, load it and deliver it.
   */
  private makeOffer(
    driverDid: string,
    load: Claimable,
    ctx: { detour: number; minutesAway: number; price?: PriceBreakdown; ratePerKm: number; time?: { collectMin: number; deliverMin?: number }; now: number },
  ): Offer {
    const { detour, minutesAway, price, now } = ctx;
    const earn = this.expectedEarn(load, price, ctx.ratePerKm);
    const existing = [...this.offers.values()].find((o) => o.driverDid === driverDid && o.ref === load.ref && o.status === 'pending' && new Date(o.expiresAt).getTime() > now);
    if (existing) return existing;
    const offer: Offer = {
      offerId: `ofr_${randomBytes(6).toString('hex')}`,
      driverDid,
      kind: load.kind,
      ref: load.ref,
      pickupLabel: load.pickupLabel,
      pickupLocation: load.pickupLocation,
      destLabel: load.destLabel,
      destLocation: load.destLocation,
      collectMin: ctx.time?.collectMin,
      deliverMin: ctx.time?.deliverMin,
      weightKg: load.weightKg,
      detourKm: detour,
      minutesAway,
      ...(this.borderAdviceFor(load) ? { border: this.borderAdviceFor(load) } : {}),
      message: `≈${minutesAway} min from ${load.pickupLabel}: a ${load.weightKg} kg shipment to ${load.destLabel} is ready. Claim it?`,
      price,
      earn,
      parcels: load.parcels,
      fillPct: load.fillPct,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + OFFER_TTL_MIN * 60_000).toISOString(),
      status: 'pending',
    };
    this.offers.set(offer.offerId, offer);
    return offer;
  }

  /**
   * The ONE load worth interrupting this driver for, right where they are — or null.
   *
   * The route list answers "what is on the road I named"; this answers "what am I about to drive past". It
   * is the same fitness question (heading, kilos, bag spaces, capability, budget, the freight bar) asked
   * against a live position instead of a planned trip, and it returns a single load on purpose: a driver at
   * speed can hold one question in their head, not a list. Minting the offer here is what makes the pop-up
   * actionable — the price is fixed at the moment they are asked, and the tap has something to open.
   */
  /** How far out to look when interrupting: a patch rider's own radius, else the tight driving-nudge one. */
  private nudgeRadiusFor(driverDid: string): number {
    const work = this.fleet.workFor(driverDid);
    return work?.kind === 'area' ? work.radiusKm : NUDGE_RADIUS_KM;
  }

  /**
   * Find work around a point rather than along a road — the bike/bajaj half of the marketplace.
   *
   * Same fitness rules as everything else (kilos, bag spaces, capability, budget, the freight bar); only the
   * geometry differs. There is no destination and no detour, because for a rider there is no "on the way":
   * there is only how far they must ride to fetch it, which is what `detourKm` carries here.
   */
  suggestNearby(driverDid: string, from: GeoPoint, radiusKm: number, now: number = Date.now(), minEarn?: number): Offer[] {
    if (this.fleet.overHours(driverDid, now)) return []; // FP8
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'Couple the driver to a vehicle before requesting work');
    if (!this.fleet.acceptingWork(driverDid, now)) return [];
    this.publishReady(now);
    this.publishReadyFreight(now);
    const remaining = this.remainingCapacity(driverDid);
    const remainingTotes = this.remainingTotes(driverDid);
    const profile = this.pricingProfile(vehicle);
    const floor = minEarn != null && Number.isFinite(minEarn) && minEarn > 0 ? minEarn : undefined;
    const freightBarred = belowFloor(this.ratings.driverRating(driverDid));
    const radius = Math.min(Math.max(radiusKm || DEFAULT_WORK_RADIUS_KM, 1), MAX_WORK_RADIUS_KM);

    const out: Offer[] = [];
    const matches = this.availableLoads()
      .filter((load) => !(freightBarred && load.kind === 'freight'))
      .filter((load) => this.vehicleCanCarry(vehicle, load, remaining, remainingTotes))
      .map((load) => ({ load, km: this.router.roadKm(from, load.pickupLocation) }))
      .filter(({ km }) => km <= radius)
      .sort((a, b) => a.km - b.km);

    for (const { load, km } of matches) {
      const price = load.kind === 'freight'
        ? computeFreightPrice({
            baseFee: profile.baseFee,
            ratePerKm: profile.ratePerKm,
            deadheadKm: km,
            tripKm: load.destLocation ? this.router.roadKm(load.pickupLocation, load.destLocation) : 0,
            multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(load.pickupLocation, now)),
          })
        : undefined;
      if (price && load.kind === 'freight') {
        if (load.maxSpend != null && this.shipperBillFor(price.total, load.ref).gross > load.maxSpend) continue;
        if (floor != null && price.total < floor) continue;
      }
      // No declared road here — this is the "near me" search, where there is no "on the way" to be extra to.
      out.push(this.makeOffer(driverDid, load, { detour: Math.round(km * 10) / 10, minutesAway: this.minutes(from, load.pickupLocation), price, ratePerKm: profile.ratePerKm, time: this.timeCost(vehicle, { from }, load), now }));
    }
    return out;
  }

  /**
   * The ONE load worth interrupting this driver for, or nothing.
   *
   * Two rules here that the list views do not have, because this is the only surface that speaks first.
   *
   * THE DRIVER'S OWN FLOOR (item 10). A minimum used to exist only as a box typed into a search, sent as a
   * query parameter — so this path, which is triggered by a GPS fix and has no request behind it, had
   * nowhere to read one from and applied none. A driver could set a floor, watch the list obey it, and
   * still be woken at the wheel for a job beneath it. The floor now lives on the driver and is read here.
   *
   * NEAREST THAT PASSES, not "the nearest, if it passes". This used to take the closest load and then
   * return null when it failed the shipper's budget — so a driver heard silence while a load two streets
   * further on was perfectly takeable. Every rejection now steps to the next candidate instead of ending
   * the search, which is what "the best one" was always supposed to mean.
   */
  offerNear(driverDid: string, point: GeoPoint, now: number = Date.now()): Offer | null {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return null;
    if (!this.fleet.acceptingWork(driverDid, now)) return null; // a snooze must silence the phone above all
    const remaining = this.remainingCapacity(driverDid);
    const remainingTotes = this.remainingTotes(driverDid);
    const profile = this.pricingProfile(vehicle);
    const freightBarred = belowFloor(this.ratings.driverRating(driverDid));
    const floor = this.nudgeFloorFor(driverDid);

    const candidates = this.availableLoads()
      .filter((load) => !(freightBarred && load.kind === 'freight'))
      .filter((load) => this.vehicleCanCarry(vehicle, load, remaining, remainingTotes))
      .map((load) => ({ load, km: this.router.roadKm(point, load.pickupLocation) }))
      // A rider who declared a patch is asking to hear about their whole patch; anyone else gets the tighter
      // interrupt-someone-driving radius. Either way the declaration below decides whether it is really theirs.
      .filter(({ load, km }) => km <= this.nudgeRadiusFor(driverDid) && this.worksNear(driverDid, load.pickupLocation))
      .sort((a, b) => a.km - b.km);

    // NOT `belowFloor` — that name is taken by the RATING floor helper imported above, and shadowing it
    // here would silently disarm the freight bar two lines up.
    let underMin = 0;
    let overBudget = 0;
    for (const { load, km } of candidates) {
      const price = load.kind === 'freight'
        ? computeFreightPrice({
            baseFee: profile.baseFee,
            ratePerKm: profile.ratePerKm,
            deadheadKm: km,
            tripKm: load.destLocation ? this.router.roadKm(load.pickupLocation, load.destLocation) : 0,
            multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(load.pickupLocation, now)),
          })
        : undefined;
      // The shipper's budget still binds — an interruption offering a price nobody will pay is worse than
      // silence. Counted, though: priced above what shippers will pay is the OTHER way a phone goes quiet,
      // and a driver who cannot tell it apart from "no work about" has no idea which lever to reach for.
      if (price && load.kind === 'freight' && load.maxSpend != null && this.shipperBillFor(price.total, load.ref).gross > load.maxSpend) {
        overBudget += 1;
        continue;
      }

      if (floor != null) {
        // The ALL-IN figure, for BOTH kinds. The old filter compared a freight price and let every bag
        // through, which was defensible only while a bag paid a flat handling fee; since a bag started
        // earning for the road as well it has had a real number, and a driver who said "not below 200"
        // meant it about bags too. This is the same function the lock screen prints and the claim locks.
        const earn = this.expectedEarn(load, price, profile.ratePerKm);
        // An earn we cannot state cannot be promised to clear a floor, and the lock screen would fall back
        // to the bare handling fee — which is under any real floor anyway. Silence is the honest answer.
        if (earn == null || earn < floor) {
          underMin += 1;
          continue;
        }
      }

      this.recordQuiet(driverDid, underMin, overBudget, now);
      return this.makeOffer(driverDid, load, { detour: Math.round(km * 10) / 10, minutesAway: this.minutes(point, load.pickupLocation), price, ratePerKm: profile.ratePerKm, time: this.timeCost(vehicle, { from: point }, load), now });
    }
    this.recordQuiet(driverDid, underMin, overBudget, now);
    return null;
  }

  /** The driver's standing "do not wake me below this", or undefined. Unknown driver → no floor: a missing
   *  record must not silence a phone, and every other guard here already fails open the same way. */
  private nudgeFloorFor(driverDid: string): number | undefined {
    try {
      const floor = this.drivers.get(driverDid).nudgeMinEarn;
      return floor != null && Number.isFinite(floor) && floor > 0 ? floor : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Why the phone was quiet today, split by the two causes a driver can actually do something about.
   *
   * Silence has three explanations and they need completely different answers: there was no work, your own
   * floor stopped it, or shippers would not pay what you charge. A driver who cannot tell them apart
   * reaches for the wrong lever, or for none — and the second and third are both things the network knows
   * and was simply never saying.
   *
   * WHAT THIS DELIBERATELY IS NOT. It reports the driver's OWN reach, never what anybody else charges. An
   * average rate pushed at independent operators is price signalling however kindly it is worded, and
   * warning only the expensive ones is not neutral either — it is the network leaning on prices in its own
   * favour. Reach has no such asymmetry: a competitively-priced driver simply has nothing here to read, and
   * nobody is ever told what to charge. (The same rule the merchant scorecard is committed to: publish only
   * what we measured, identically.)
   *
   * These are ABSOLUTE counts, never a fraction. The search stops at the first load worth offering, so the
   * ones behind it were never classified — "6 of 14" would be a denominator we did not actually count.
   *
   * In memory and same-day: a restart loses it, which is right for a figure that means "since this morning"
   * and on which no money depends.
   */
  quietReport(driverDid: string, now: number = Date.now()): {
    floor?: number;
    belowFloor: number;
    overBudget: number;
    ratePerKm?: number;
    rateIsYours: boolean;
    rateLooksHigh: boolean;
  } {
    const today = new Date(now).toISOString().slice(0, 10);
    const held = this.quietToday.get(driverDid);
    const fresh = held && held.day === today ? held : { day: today, belowFloor: 0, overBudget: 0 };
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    // A fleet-attached driver does not own the lever: the vehicle is the manager's and so is its rate.
    // Telling them their price is costing them work would be telling somebody about a control they cannot
    // reach — that belongs on the manager's console, not here.
    let rateIsYours = false;
    try {
      rateIsYours = this.drivers.get(driverDid).managerDid == null;
    } catch {
      rateIsYours = false;
    }
    return {
      floor: this.nudgeFloorFor(driverDid),
      belowFloor: fresh.belowFloor,
      overBudget: fresh.overBudget,
      ratePerKm: vehicle?.pricePerKm,
      rateIsYours,
      // One load refused on price says nothing at all, and a warning built on it is noise that teaches a
      // driver to ignore the real ones. The same threshold the market pulse uses before it will call a
      // cell busy or quiet — a number is only worth acting on once there is enough of it.
      rateLooksHigh: fresh.overBudget >= MARKET_MIN_DEMAND,
    };
  }

  /**
   * The RATE half of the same picture, for whoever owns the rate.
   *
   * A fleet driver cannot act on this — `pricePerKm` is on the vehicle and the vehicle is the manager's —
   * so `quietReport` withholds it from them and it surfaces here instead, on the manager's own list.
   *
   * WHAT IT DELIBERATELY LEAVES OUT: the driver's earnings floor, and what it suppressed. That is the
   * driver's own decision about their own time, and handing it to the person who schedules them turns a
   * setting into something to be talked out of. The manager gets the lever that is theirs and nothing else.
   */
  rateReachFor(driverDid: string, now: number = Date.now()): { overBudget: number; ratePerKm?: number; rateLooksHigh: boolean } {
    const full = this.quietReport(driverDid, now);
    return { overBudget: full.overBudget, ratePerKm: full.ratePerKm, rateLooksHigh: full.rateLooksHigh };
  }

  private recordQuiet(driverDid: string, underMin: number, overBudget: number, now: number): void {
    if (underMin === 0 && overBudget === 0) return;
    const today = new Date(now).toISOString().slice(0, 10);
    const held = this.quietToday.get(driverDid);
    const base = held && held.day === today ? held : { day: today, belowFloor: 0, overBudget: 0 };
    this.quietToday.set(driverDid, { day: today, belowFloor: base.belowFloor + underMin, overBudget: base.overBudget + overBudget });
  }

  /* --- declining from the lock screen --- */

  /**
   * A one-shot capability to decline ONE offer, and nothing else.
   *
   * "Not now" has to work from the notification itself — a driver who must open an app to say no will simply
   * not say it, and the load sits reserved-in-spirit while someone else could have taken it. But the service
   * worker that handles that tap has no session, and giving it the driver's token would hand a background
   * script the driver's whole identity to solve a one-word problem.
   *
   * So the push carries a capability instead: unguessable, bound to a single offer, single-use, and dead when
   * the offer lapses. Leaked, it can decline one load the driver was declining anyway.
   */
  mintDeclineToken(offerId: string, now: number = Date.now()): string {
    const token = randomBytes(24).toString('hex');
    this.declineTokens.set(token, { offerId, expiresAt: now + OFFER_TTL_MIN * 60_000 });
    return token;
  }

  /** Redeem a decline capability. Burned on use, and refused once it (or its offer) has lapsed. */
  declineByToken(token: string, now: number = Date.now()): Offer {
    const held = this.declineTokens.get(token);
    if (!held) throw new GlosError('NOT_FOUND', 'That link has already been used, or has expired');
    this.declineTokens.delete(token); // one shot, whatever happens next
    if (held.expiresAt <= now) throw new GlosError('WINDOW_EXPIRED', 'That offer has already lapsed');
    return this.ignore(held.offerId);
  }

  /** Driver accepts an offer → reserves the load (and its weight) for this driver. */
  claim(offerId: string, now: number = Date.now()): Offer {
    const offer = this.requireOffer(offerId);
    if (offer.status === 'expired' || new Date(offer.expiresAt).getTime() <= now) { offer.status = 'expired'; throw new GlosError('WINDOW_EXPIRED', 'Offer has lapsed (auto-ignored)'); }
    if (offer.status !== 'pending') throw new GlosError('INVALID_STATE', `Offer is ${offer.status}`);
    const vehicle = this.fleet.vehicleForDriver(offer.driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'Driver is no longer coupled to a vehicle');
    if (offer.weightKg > this.remainingCapacity(offer.driverDid)) throw new GlosError('CAPACITY_EXCEEDED', 'Not enough remaining capacity for this load');
    // …and room in the hold for one more BAG. Kilos are not the binding constraint on a line-haul: a driver
    // claiming from a coffee table could reserve twenty bags of letters against a weight limit they never
    // reach, and arrive at a bus whose boot holds twelve.
    if (offer.kind === 'tote' && this.remainingTotes(offer.driverDid) < 1) {
      throw new GlosError('CAPACITY_EXCEEDED', `Your ${vehicle.vehicleClass} is carrying all ${this.toteCapacityOf(vehicle)} bag(s) it holds — deliver one before taking another`);
    }
    // S31/S32: re-check the load's required capabilities AND equipment against the driver's CURRENT vehicle —
    // coupling is re-assignable, so what held when the offer was made (suggest → vehicleCanCarry) may not hold
    // now. Without this, a driver could re-couple to an unsuitable vehicle and RESERVE the load (markClaimed)
    // only to dead-end at load time, stranding it 'claimed' for everyone else.
    const need = this.loadRequirements(offer.kind, offer.ref);
    if (
      need.capabilities.some((cap) => !vehicle[cap]) ||
      !DispatchService.hasEquipmentFor(vehicle, need.equipment) ||
      (need.bulk && !vehicle.carriesBulk) ||
      (need.fragile && !vehicle.allowsFragile)
    ) {
      throw new GlosError('VEHICLE_MISSING_CAPABILITY', 'Your current vehicle lacks a capability or equipment this load requires — re-couple to a suitable vehicle');
    }
    this.requireBorderAllows(vehicle, offer.driverDid, offer.kind, offer.ref);

    if (offer.kind === 'tote') {
      this.totes.markClaimed(offer.ref, offer.driverDid);
      // A bag's road is priced HERE, exactly as a freight's is below, and for the same reason: the driver
      // agreed to the job whose distance and contents were what they were at this moment.
      this.lockToteHaul(offer.ref, vehicle);
    } else {
      const f = this.requireFreight(offer.ref);
      // FB0c — a load the minter posted for negotiation cannot be taken over the counter. The whole point of
      // marking it is that the price is not settled, so an instant claim would take it at a number nobody
      // agreed to. Refused BEFORE any mutation, and the driver is told what to do instead.
      if (commitModeOf(f) === 'negotiate') {
        throw new GlosError('NEGOTIATION_REQUIRED', 'This load is posted for negotiation — send the shipper your price instead of claiming it');
      }
      // FB0a — carry the offer's deadhead/loaded SPLIT into the lock, not just its sum. This breakdown is the
      // durable one (it is stamped onto the freight and is what any later market series reads), so re-deriving
      // it as "deadheadKm = the whole distance, tripKm = 0" would persist a load whose every kilometre looks
      // like empty running. The total is identical either way — only the labelling was wrong. An offer minted
      // before FB0a has no split; it falls back to the old shape and prices to the same total.
      const offerSplit = distanceSplit(offer.price);
      this.lockFreightToDriver(
        f,
        offer.driverDid,
        vehicle,
        {
          deadheadKm: offerSplit ? offerSplit.deadheadKm : offer.price?.distanceKm ?? 0,
          loadedKm: offerSplit ? offerSplit.loadedKm : 0,
        },
        undefined,
        now,
      );
    }

    offer.status = 'claimed';
    // TAKING A LOAD IS SAYING WHERE YOU ARE GOING. Both ends are known at this instant — the pickup, and
    // now the drop — and until this the network threw that away and went on matching a driver who had just
    // committed to a road against nothing at all. It never overrides what a driver said themselves, and it
    // is marked as ours so the app can say so and offer to switch it off; the whole of that restraint lives
    // in deriveLegFromLoad.
    if (offer.destLocation) {
      this.fleet.deriveLegFromLoad(offer.driverDid, {
        fromLabel: offer.pickupLabel,
        from: offer.pickupLocation,
        toLabel: offer.destLabel,
        to: offer.destLocation,
      });
    }
    // Retire the competing offers for the same load.
    for (const o of this.offers.values()) if (o.ref === offer.ref && o.offerId !== offer.offerId && o.status === 'pending') o.status = 'ignored';
    void this.events.publish(GlosEvent.Pudo.LoadClaimed, { offerId, driverDid: offer.driverDid, kind: offer.kind, ref: offer.ref, weightKg: offer.weightKg }, { source: 'pudo' }).catch(() => undefined);
    return offer;
  }

  /**
   * Commit a freight to a driver: gate it, price it, stamp it, settle the shipper.
   *
   * The ONE place a freight becomes claimed, shared by the instant claim and by accepting a proposal. They
   * must not drift: every gate the counter path applies — status, reputation floor, the shipper's budget —
   * has to apply just as hard when a poster accepts a price, and the S31 mirror-at-claim lesson is exactly
   * that a second route to the same mutation grows its own holes if it is written twice.
   *
   * `agreedPrice` set (FB0c) means the number was NEGOTIATED, so it becomes the locked price and the computed
   * breakdown is kept only for its terms and its real distances.
   */
  private lockFreightToDriver(f: Freight, driverDid: string, vehicle: Vehicle, legs: { deadheadKm: number; loadedKm: number }, agreedPrice: number | undefined, now: number, office?: string): Freight {
    // P1 — an order under a contract goes on a truck by ONE hand: the office of the fleet it was ordered from. A claim,
    // an offer or an accepted price are other doors onto this same lock, and none of them carries an office.
    if (f.status === 'ordered') {
      if (!office || f.contract?.fleetDid !== office) throw new GlosError('FORBIDDEN', 'This is an order under a contract — only the fleet it was ordered from puts it on a truck');
    } else if (!(f.status === 'available' || (f.status === 'scheduled' && f.allowEarlyClaim))) {
      // Claimable when live ('available') OR when it's a scheduled load the shipper opened to early reservation.
      throw new GlosError('INVALID_STATE', `Freight is ${f.status}`);
    }
    // REP4 — bar a below-floor driver from CLAIMING freight (defence-in-depth behind suggest's withholding, and
    // it also catches a stale offer claimed after the driver dropped below the floor). Recoverable; cold-start safe.
    if (belowFloor(this.ratings.driverRating(driverDid))) throw new GlosError('REPUTATION_BELOW_FLOOR', 'Your rating is below the network minimum — freight is paused until it recovers. Keep delivering to bring it back up.');
    // FP8 — over the shift limit: what is aboard is delivered, nothing new is taken. The board marks it, the offers
    // stop, and this — the one commit — refuses it, so an office cannot put a load on a driver the board would not.
    if (this.fleet.overHours(driverDid, now)) {
      const h = this.fleet.hoursFor(driverDid, now);
      throw new GlosError('HOURS_EXCEEDED', `On duty ${h.onDuty} h — over the ${h.limit} h limit. End the shift and rest before taking another load`);
    }
    // FB2c — the shipper's own exclusion now BINDS, deliberately only from the moment the board can explain
    // it. Enforcing it while no screen could show it would have dropped qualifying drivers with no reason
    // given, which is the invisible exclusion the whole board exists to remove; enforcing it here, where the
    // board has already marked the row "the shipper has ruled out your body type", is just honouring what the
    // driver was told. The mirror-at-claim rule (S31): what filters a load must also refuse it.
    if (vehicle.truckSubtype && excludedByShipper(vehicle.truckSubtype, f.excludedBodies)) {
      throw new GlosError('BODY_EXCLUDED', 'The shipper has ruled out your body type for this load — it is their choice, not a limit of your vehicle');
    }
    // S34 — compute the price to LOCK. The market can surge afterwards and the driver can edit their profile,
    // but what is agreed at this instant never changes. Recompute against THIS vehicle's current profile
    // (defaults resolved for a legacy vehicle) and the multiplier now, over the two legs.
    const profile = this.pricingProfile(vehicle);
    const breakdown = computeFreightPrice({
      baseFee: profile.baseFee,
      ratePerKm: profile.ratePerKm,
      deadheadKm: legs.deadheadKm,
      tripKm: legs.loadedKm,
      // S34b — lock against the market at the pickup's zone AT THIS INSTANT (a rule set since the offer, or a
      // shifted pulse, is honoured here); the corridor clamp still guarantees the driver's floor and ceiling.
      multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(f.pickupLocation, now)),
    });
    const earning = agreedPrice ?? breakdown.total;
    // S34c — the shipper's budget gate, checked BEFORE any mutation so a refused claim leaves the freight
    // untouched and available. suggest() already skips over-budget offers; this re-check catches a driver who
    // re-coupled to a pricier vehicle (or a surge) after the offer was made (the S31 mirror-at-claim lesson).
    // FB0c — it binds a NEGOTIATED price just as hard: agreeing above the budget would commit a haul nobody
    // has the money for. The proposal stays open, so the shipper can raise the cap and accept it then.
    if (f.maxSpend != null && this.shipperBill(earning, f).gross > f.maxSpend) {
      throw new GlosError('BUDGET_EXCEEDED', "This load's price now exceeds the shipper's budget — it stays open for a cheaper vehicle or a cooler market");
    }
    f.status = 'claimed';
    f.claimedBy = driverDid;
    // And for WHOM — the fleet, or the driver themselves — frozen for the same reason as the body below: a
    // driver who moves fleets must take none of this fleet's history with them. See Freight.carrierDid.
    f.carrierDid = this.carrierDidOf(driverDid);
    // FB4a — and WHAT took it, frozen here for the same reason the price is. Only the driver was recorded, so
    // "km moved by container chassis" could only be answered from what that driver is coupled to today: sell
    // the flatbed, buy a box van, and every haul you ever did silently changes body. A series that rewrites
    // its own history is not a series, and this one is meant to be invested against.
    f.carriedBy = { vehicleClass: vehicle.vehicleClass, truckSubtype: vehicle.truckSubtype as TruckSubtype | undefined };
    f.claimedAt = new Date(now).toISOString(); // stamp the injected clock — the no-show deadline is anchored to this
    f.priceBreakdown = breakdown;
    f.lockedPrice = earning;
    f.priceOrigin = agreedPrice == null ? 'computed' : 'negotiated';
    f.lockedAt = f.claimedAt;
    f.driverPaid = false;
    // Settle the shipper: a diverted vendor order (shipperDid = the vendor) is billed its earning + the
    // platform fee from its prepaid balance. THREE distinct states, so an uncollected debt is never silent:
    //  - 'billed'         a known shipper whose prepaid balance covered the charge;
    //  - 'billing_failed' a known shipper whose balance fell SHORT — a real debt for a Local Admin to collect;
    //  - 'unpaid'         a bulletin freight with no shipper, or a store no sister of ours settles (it stands in a
    //                     country we only match) — settled off-platform between shipper and carrier.
    // The driver is still paid on delivery in every case — labour done is owed regardless of shipper collection.
    if (f.shipperDid && this.vendors.has(f.shipperDid) && this.vendors.settlesWithUs(f.shipperDid)) {
      const bill = this.shipperBill(earning, f);
      const { paid } = this.vendors.billShipment(f.shipperDid, f.freightId, bill.gross, 0, bill.tax, bill.provision);
      f.paidStatus = paid ? 'billed' : 'billing_failed';
      // Stamped at the instant of charging, so a release reverses THIS, not whatever the rates resolve to
      // whenever the release happens to run. Kept even on a failed billing: what the shipper owes is a real
      // debt for a Local Admin to collect, and it is only collectable if somebody can say what it was.
      f.billed = bill;
    } else {
      f.paidStatus = 'unpaid';
    }
    this.freights.set(f.freightId, f);
    return f;
  }

  /* ------------------------------------------------------------ FB1: the open board -- */

  /**
   * The whole market, from where the operator is standing — with every load they cannot take MARKED, not removed.
   *
   * This is the other relationship to the market. Being offered work suits an opportunistic rider, where the
   * platform's curation is a favour; SHOPPING for work suits a fixed asset with fixed costs, where the whole
   * skill is repositioning — taking the marginal load because it puts you where the good one is. A push model
   * cannot serve the second, because relevance is exactly what the operator is trying to decide for themselves.
   *
   * So none of the filters that shape suggest()/offerNear() apply here:
   *  - NO 15 km clamp. That number is right for an interruption and wrong for browsing, which is not an
   *    interruption. The radius here is the OPERATOR's, and omitting it means the whole market.
   *  - NO detour or minutes-away cap, no minEarn filter, no maxSpend filter. Those decide whether to bother
   *    someone; here the operator is already looking, and every one of them becomes a marked row instead.
   *  - Negotiate loads are IN. They are deliberately kept out of the push offers precisely so they can live here.
   *
   * A claimed load is genuinely gone and is not shown: "show everything" means every load in the market, not
   * every load that ever existed.
   */
  board(input: { driverDid?: string; from: GeoPoint; radiusKm?: number }, now: number = Date.now()): BoardRow[] {
    this.publishReady(now);
    this.publishReadyFreight(now);
    const vehicle = input.driverDid ? this.fleet.vehicleForDriver(input.driverDid) ?? null : null;
    const profile = vehicle ? this.pricingProfile(vehicle) : null;
    const remainingKg = input.driverDid ? this.remainingCapacity(input.driverDid) : 0;
    const ratingBelowFloor = input.driverDid ? belowFloor(this.ratings.driverRating(input.driverDid)) : false;
    const overHours = input.driverDid ? this.fleet.overHours(input.driverDid, now) : false; // FP8
    // A radius is the operator narrowing the market. Absent, or non-positive, means they have not narrowed it.
    const radius = input.radiusKm != null && Number.isFinite(input.radiusKm) && input.radiusKm > 0 ? input.radiusKm : undefined;

    const rows: BoardRow[] = [];
    for (const f of this.freights.values()) {
      if (!(f.status === 'available' || (f.status === 'scheduled' && f.allowEarlyClaim))) continue;
      const deadheadKm = round1(this.router.roadKm(input.from, f.pickupLocation));
      if (radius != null && deadheadKm > radius) continue;
      const loadedKm = round1(f.destLocation ? this.router.roadKm(f.pickupLocation, f.destLocation) : 0);

      // Priced against THIS operator's vehicle — the same B + D·R·M the offer would carry, so what the board
      // shows and what a claim locks cannot disagree. Without a vehicle there is no rate to price on, and a
      // fabricated one would be the single most misleading number on the screen.
      const price = profile
        ? computeFreightPrice({
            baseFee: profile.baseFee,
            ratePerKm: profile.ratePerKm,
            deadheadKm,
            tripKm: loadedKm,
            multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(f.pickupLocation, now)),
          })
        : undefined;
      const blockers = blockersFor(
        {
          weightKg: f.weightKg,
          fragile: f.fragile,
          bulk: f.bulk,
          requiredCapabilities: f.requiredCapabilities ?? [],
          requiredEquipment: f.requiredEquipment ?? [],
          excludedBodies: f.excludedBodies,
          maxSpend: f.maxSpend,
          derivedBody: bodyOf(f).body,
          indivisible: f.indivisible,
        },
        vehicle,
        // Gross, like the gate it mirrors: the board marks a load as over the shipper's budget, and it must
        // mark exactly the loads the claim would refuse. Two different figures against one cap is how a
        // board tells an operator a load is takeable and the claim then says it is not.
        {
          remainingKg,
          ratingBelowFloor,
          overHours,
          indicativeCharge: price ? this.shipperBill(price.total, f).gross : undefined,
          // The road, as drivers reported it.
          //
          // A HEIGHT IS PASSED AT LAST, and only when BOTH halves are known. What matters at a bridge is
          // the load PLUS the deck it stands on — a 4.0 m load is 5.2 m on a flatbed and 4.4 m on a
          // lowboy — and for years neither number existed, so this passed nothing and the map answered
          // HEIGHT_UNKNOWN against every height limit. That was the truth, and it was also the reason a
          // 40ft high-cube booked exactly like a standard box.
          //
          // Now a vehicle may declare its DECK and a load its HEIGHT, and the sum goes to the map. Either
          // one missing still yields undefined, which still answers HEIGHT_UNKNOWN: half of a sum is not
          // a smaller answer, it is no answer, and passing the load height alone would clear a load that
          // does not fit — the precise silent pass this whole feature exists to refuse.
          routeBlockers: this.constraints.checkRoute({
            from: f.pickupLocation,
            to: f.destLocation,
            totalHeightM: vehicle?.deckM != null && f.heightM != null ? Math.round((vehicle.deckM + f.heightM) * 100) / 100 : undefined,
            grossWeightKg: f.weightKg,
            hazmat: (f.requiredCapabilities ?? []).includes('hazmat'),
          }).concat(
            // CA6 — what the law says about this vehicle carrying this load, marked like any other reason it
            // cannot. The BORDER half needs the vehicle (cabotage is about the plates, a limit about the
            // axles); the BOND half is about the carrier and is asked whether or not anything is coupled.
            (input.driverDid
              ? [...(vehicle ? this.borderRefusals(vehicle, input.driverDid, this.wrapFreight(f)) : []), ...(this.bondRefusal(input.driverDid, this.wrapFreight(f)) ? [this.bondRefusal(input.driverDid, this.wrapFreight(f))!] : [])]
              : []
            ).map((r) => ({
                  kind: 'physical' as const,
                  code: r.code,
                  message: r.message,
                })),
          ),
        },
      );
      rows.push({
        freightId: f.freightId,
        code: f.code,
        description: f.description,
        pickupLabel: f.pickupLabel,
        pickupLocation: f.pickupLocation,
        destLabel: f.destLabel,
        destLocation: f.destLocation,
        weightKg: f.weightKg,
        cargoClass: f.cargoClass,
        natureCode: f.natureCode,
        dimensionsCm: f.dimensionsCm,
        indivisible: f.indivisible,
        bodyDerived: bodyOf(f),
        bodyHint: f.bodyHint,
        commitMode: commitModeOf(f),
        scheduledPickupAt: f.scheduledPickupAt,
        deadheadKm,
        loadedKm,
        totalKm: round1(deadheadKm + loadedKm),
        price,
        earningsPerKm: earningsPerKm(price),
        canTake: takeable(blockers),
        blockers,
        ...(f.instructions?.deliveryWindow ? { deliveryWindow: f.instructions.deliveryWindow } : {}),
        // Y2 — a box going home, and whether there is anything in it. A haulier deciding on a run wants
        // both: an empty box is real work with no cargo, and the tare is why a bike cannot take it.
        ...(f.containerNo ? { containerNo: f.containerNo } : {}),
        ...(f.emptyRun ? { emptyRun: true } : {}),
        // BL1 — said on the board, because a driver who cannot take it is entitled to know why before
        // tapping it, and one who has just been licensed should see the work that licence is for.
        ...(f.bonded ? { bonded: true, bondCountry: f.bondCountry } : {}),
      });
    }

    // Sorted by what the money is worth per kilometre TURNED, empty run included — a 200 km haul reached by
    // 180 km of deadhead is a worse job than a 40 km haul at the door, and proximity sorting answers the
    // platform's question rather than the operator's. Rows with no computable rate sink rather than float:
    // an unsortable row must never lead the board. Nearest first among them, as the only honest fallback.
    return rows.sort((a, b) => (b.earningsPerKm ?? -1) - (a.earningsPerKm ?? -1) || a.deadheadKm - b.deadheadKm);
  }

  /**
   * FB3b — the market as a stranger sees it: no account, no vehicle, no session.
   *
   * A different question from board()'s, which is why it is a different method and a different row rather
   * than a filtered one. board() answers "can I take this", and needs a vehicle to judge against. This
   * answers "what work is there here, and what would I need to do it" — the question asked by someone
   * deciding whether to buy a flatbed, or whether the corridor they are thinking of moving to has a market
   * worth moving for. User, 2026-08-30: not just a driver, also someone planning to live and work abroad.
   *
   * Two things follow, and they pull in opposite directions.
   *
   * The WORK is published in full — weight, body needed, equipment, both distances, the money — because that
   * is the data an entrepreneur cannot get anywhere else and the whole reason the network should give it
   * away. The LOAD is not located: a coarse town, a pin rounded to about 5 km, and no code, label or
   * description at all. A public board that named the shop would be a standing, anonymous, searchable
   * inventory of valuable goods with dates against them, and nothing about the investment question needs it.
   *
   * Money is INDICATIVE and says so in the payload. Every price on the driver's board is computed against
   * that driver's own rate card; an anonymous caller has none, so this uses the network's defaults for a
   * typical vehicle. It is the same computeFreightPrice the offer uses — the same arithmetic, a different
   * rate card — so the public figure and a real offer can never diverge in method, only in whose rate it is.
   */
  publicMarket(input: { from: GeoPoint; radiusKm?: number }, now: number = Date.now()): MarketRow[] {
    this.publishReady(now);
    this.publishReadyFreight(now);
    const radius = input.radiusKm != null && Number.isFinite(input.radiusKm) && input.radiusKm > 0 ? input.radiusKm : undefined;

    const rows: MarketRow[] = [];
    for (const f of this.freights.values()) {
      if (!(f.status === 'available' || (f.status === 'scheduled' && f.allowEarlyClaim))) continue;
      const deadheadKm = round1(this.router.roadKm(input.from, f.pickupLocation));
      if (radius != null && deadheadKm > radius) continue;
      const loadedKm = round1(f.destLocation ? this.router.roadKm(f.pickupLocation, f.destLocation) : 0);
      const price = computeFreightPrice({
        baseFee: REFERENCE_PROFILE.baseFee,
        ratePerKm: REFERENCE_PROFILE.ratePerKm,
        deadheadKm,
        tripKm: loadedKm,
        multiplier: freightMultiplier(new Date(now), { min: REFERENCE_PROFILE.min, max: REFERENCE_PROFILE.max }, this.market.factorFor(f.pickupLocation, now)),
      });
      rows.push({
        area: nearestPlace(f.pickupLocation)?.name,
        destArea: f.destLocation ? nearestPlace(f.destLocation)?.name : undefined,
        pickupAbout: coarsePoint(f.pickupLocation),
        weightKg: f.weightKg,
        cargoClass: f.cargoClass,
        natureCode: f.natureCode,
        indivisible: f.indivisible,
        bodyDerived: bodyOf(f),
        requiredEquipment: f.requiredEquipment?.length ? f.requiredEquipment : undefined,
        requiredCapabilities: f.requiredCapabilities?.length ? f.requiredCapabilities : undefined,
        deadheadKm,
        loadedKm,
        totalKm: round1(deadheadKm + loadedKm),
        scheduledPickupAt: f.scheduledPickupAt,
        indicativeTotal: price.total,
        indicativePerKm: earningsPerKm(price),
      });
    }

    // Sorted exactly as the driver's board is — by what the work is worth per kilometre TURNED. The public
    // page is read to decide where the good corridors are, and proximity sorting would answer a question
    // nobody browsing a market from another country is asking.
    return rows.sort((a, b) => (b.indicativePerKm ?? -1) - (a.indicativePerKm ?? -1) || a.deadheadKm - b.deadheadKm);
  }

  /**
   * FB4 — the market series around a point: what was asked for, against what moved.
   *
   * Geography is applied to the LOAD's own pickup, not to anybody's vehicle, so the same question can be
   * asked about a city nobody involved has ever been to. Omit the radius and it is the whole network — which
   * is the honest default for "how much flatbed work is there", a question with no natural centre.
   *
   * The window is the caller's, and it is echoed back in the answer: a kilometre count means nothing without
   * the period it accrued over, and "yearly km" is a rate a reader has to be able to check.
   */
  marketSeries(input: { from?: GeoPoint; radiusKm?: number; since: number; until: number }): MarketSeries {
    const radius = input.radiusKm != null && Number.isFinite(input.radiusKm) && input.radiusKm > 0 ? input.radiusKm : undefined;
    const near = (f: Freight) => !input.from || radius == null || this.router.roadKm(input.from, f.pickupLocation) <= radius;
    // P1 — an order under a contract was never offered to anybody: counting it would invent demand the market did not
    // have, and publish whose lanes a fleet works.
    const scoped = [...this.freights.values()].filter((f) => !f.contract && near(f));
    return buildSeries(scoped, { from: input.since, to: input.until }, (a, b) => this.router.roadKm(a, b));
  }

  /**
   * Who carried on one lane. The lane is named by its two ENDS, the same way the series names it.
   *
   * Returns dids and counts; resolving a did to a trading name and a public handle belongs to the caller,
   * which already holds the fleet register and the handle directory. Keeping that out of here is what
   * stops a dispatch service growing two more dependencies for one read.
   */
  laneCarriage(input: { from: string; to: string; since: number; until: number }): ReturnType<typeof carriersOn> {
    // The driver registry is here and not in market-series, so the resolver is passed in: a driver who
    // drives for a fleet attributes to the fleet, and one who drives for themselves to themselves.
    const fleetOf = (driverDid: string): string | undefined => {
      try {
        return this.drivers.get(driverDid).managerDid ?? undefined;
      } catch {
        return undefined;
      }
    };
    return carriersOn([...this.freights.values()].filter((f) => !f.contract), input.from, input.to, { from: input.since, to: input.until }, fleetOf);
  }

  /* ------------------------------------------------- FB0c: negotiate before commit -- */

  /**
   * A driver's price for a load posted 'negotiate'.
   *
   * A proposal reserves NOTHING. The load stays open to every other driver and to every other proposal until
   * a poster accepts one — which is the honest reading of "negotiate": the shipper is shopping, and a
   * proposal that quietly held the load would turn the first bid into a claim by another name.
   *
   * `from` is required rather than optional so the accepted haul records a REAL deadhead. Defaulting an
   * unknown empty run to zero would flatter every negotiated job in the market series (FB0a's rule: never
   * invent a split), and the driver's app already reports its position.
   */
  propose(input: { freightId: string; driverDid: string; from: GeoPoint; price: number; note?: string }, now: number = Date.now()): FreightProposal {
    const f = this.requireFreight(input.freightId);
    if (commitModeOf(f) !== 'negotiate') throw new GlosError('INVALID_STATE', 'This load is taken at the offered price — claim it instead of proposing one');
    if (!(f.status === 'available' || (f.status === 'scheduled' && f.allowEarlyClaim))) throw new GlosError('INVALID_STATE', `Freight is ${f.status}`);
    if (!Number.isFinite(input.price) || input.price <= 0) throw new GlosError('INVALID_INPUT', 'Name a price above zero');
    // Gate the driver the same way the board does, so a proposal cannot be made by someone who could never be
    // accepted — a shipper reading bids they are not allowed to take is worse than an empty list.
    const vehicle = this.fleet.vehicleForDriver(input.driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'Couple to a vehicle before offering to carry a load');
    // The same capacity and capability checks acceptance makes, asked at the door. Found in the browser pass:
    // a driver on a bike offered a price on 600 kg, and the shop only learned it could never be taken when it
    // pressed Accept. An offer that can never be accepted is refused to the person who could fix it — the
    // driver — rather than delivered to the person who cannot. Accept still re-checks: coupling can change.
    if (f.weightKg > this.remainingCapacity(input.driverDid)) {
      throw new GlosError('CAPACITY_EXCEEDED', 'Your vehicle has no room for this load, so the poster could never accept an offer from it');
    }
    const need = this.loadRequirements('freight', f.freightId);
    if (
      need.capabilities.some((cap) => !vehicle[cap]) ||
      !DispatchService.hasEquipmentFor(vehicle, need.equipment) ||
      (need.bulk && !vehicle.carriesBulk) ||
      (need.fragile && !vehicle.allowsFragile)
    ) {
      throw new GlosError('VEHICLE_MISSING_CAPABILITY', 'Your vehicle lacks something this load needs, so the poster could never accept an offer from it');
    }
    this.requireBorderAllows(vehicle, input.driverDid, 'freight', f.freightId);
    if (belowFloor(this.ratings.driverRating(input.driverDid))) throw new GlosError('REPUTATION_BELOW_FLOOR', 'Your rating is below the network minimum — freight is paused until it recovers.');

    // One live proposal per driver per load: a driver changing their mind REPLACES their number rather than
    // stacking a second one, so a poster never has to guess which of two bids from the same person is current.
    for (const p of this.proposals.values()) {
      if (p.freightId === f.freightId && p.driverDid === input.driverDid && p.status === 'open') {
        p.status = 'withdrawn';
        p.decidedAt = new Date(now).toISOString();
        this.proposals.set(p.proposalId, p);
      }
    }
    const proposal: FreightProposal = {
      proposalId: `prp_${randomBytes(5).toString('hex')}`,
      freightId: f.freightId,
      driverDid: input.driverDid,
      price: Math.round(input.price * 100) / 100,
      note: input.note,
      deadheadKm: this.router.roadKm(input.from, f.pickupLocation),
      loadedKm: f.destLocation ? this.router.roadKm(f.pickupLocation, f.destLocation) : 0,
      status: 'open',
      createdAt: new Date(now).toISOString(),
    };
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /**
   * FB2b — the loads THIS shop posted, newest first, each with how many prices are waiting.
   *
   * Owner-scoped at the source rather than by filtering the public list: a screen that filters someone
   * else's data has already received it, and the register epic's data-firewall lesson was exactly this.
   * Matches on postedByDid OR shipperDid — usually the same party, but a counter booking has a shop that
   * posted it and no shipper at all, and a diverted vendor order has a shipper who never touched a counter.
   */
  postedBy(did: string): PostedFreightRow[] {
    if (!did) return [];
    const open = new Map<string, number>();
    for (const p of this.proposals.values()) {
      if (p.status === 'open') open.set(p.freightId, (open.get(p.freightId) ?? 0) + 1);
    }
    return [...this.freights.values()]
      .filter((f) => f.postedByDid === did || f.shipperDid === did)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((f) => ({
        freightId: f.freightId,
        code: f.code,
        description: f.description,
        destLabel: f.destLabel,
        weightKg: f.weightKg,
        status: f.status,
        commitMode: commitModeOf(f),
        maxSpend: f.maxSpend,
        scheduledPickupAt: f.scheduledPickupAt,
        createdAt: f.createdAt,
        openProposals: open.get(f.freightId) ?? 0,
        ...(f.onBehalfOf ? { onBehalfOf: f.onBehalfOf } : {}),
        ...(f.contract ? { contract: f.contract, deliverOn: f.deliverOn } : {}),
        agreedPrice: f.lockedPrice,
        pickedUpAt: f.pickedUpAt,
        deliveredAt: f.deliveredAt,
        receiverName: f.proofOfDelivery?.receiverName,
        cancelledAt: f.cancelledAt,
        canCancel: f.status === 'scheduled' || f.status === 'available' || f.status === 'claimed',
        ...(f.deliveryAttempts?.length ? { attempts: f.deliveryAttempts } : {}),
        ...(f.claim ? { claim: f.claim } : {}),
        canClaim: f.status === 'delivered' && !f.claim && (f.deliveredAt ? Date.now() - new Date(f.deliveredAt).getTime() <= FREIGHT_CLAIM_WINDOW_DAYS * 86_400_000 : true),
        // FP6 — the link to hand on, who is carrying it, and the verdict.
        ...(f.trackingKey ? { trackingKey: f.trackingKey, trackingUrl: trackingUrlOf(f.trackingKey) } : {}),
        ...(f.carriage ? { carrier: { driverName: this.driverNameOf(f.carriage.driverDid), plate: f.carriage.plate, vehicleClass: f.carriage.vehicleClass } } : {}),
        ...(f.rating ? { rating: { stars: f.rating.stars, issues: f.rating.issues, at: f.rating.at } } : {}),
        canRate: f.status === 'delivered' && Boolean(f.claimedBy) && (f.deliveredAt ? Date.now() - new Date(f.deliveredAt).getTime() <= FREIGHT_RATING_WINDOW_DAYS * 86_400_000 : true),
        ...(f.incoterm ? { incoterm: f.incoterm, claimant: riskBearerOf(f.incoterm) } : {}),
        ...(f.namedPlace ? { namedPlace: f.namedPlace } : {}),
        ...(f.handBacks?.length ? { handBacks: f.handBacks.map((h) => ({ reason: h.reason, at: h.at })) } : {}),
        // FP7 — box 13, and whether it is still the sender's to rewrite or only to add to.
        ...(instructionsViewOf(f) ? { instructions: instructionsViewOf(f) } : {}),
        instructionsMode: f.status === 'scheduled' || f.status === 'available' || f.status === 'claimed' ? 'edit' : f.status === 'in_transit' ? 'amend' : 'none',
      }));
  }

  /**
   * FP7 — the sender's instructions, after posting. Until the goods are taken over the box is the sender's to
   * rewrite. Once on the road it can only be ADDED to — a subsequent instruction with its own time, as the
   * CMR does it — so the note shows what the driver was told and when. The driver holding the load is told.
   */
  setInstructions(freightId: string, byDid: string, input: { text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    const at = new Date(now).toISOString();
    let amended = false;
    if (f.status === 'scheduled' || f.status === 'available' || f.status === 'ordered' || f.status === 'claimed') {
      const next = instructionsOf(input, byDid, now);
      if (next) f.instructions = next.instructions;
      else delete f.instructions;
    } else if (f.status === 'in_transit') {
      const text = input.text?.trim();
      if (!text) throw new GlosError('FIELD_REQUIRED', 'The goods are on the road — an instruction now is added to what the driver was told, so say what it is');
      f.instructionAmendments = [...(f.instructionAmendments ?? []), { text, at, by: byDid }];
      amended = true;
    } else {
      throw new GlosError('INVALID_STATE', `Freight is ${f.status} — there is nobody left to instruct`);
    }
    this.freights.set(f.freightId, f);
    if (f.claimedBy) {
      const v = instructionsViewOf(f);
      void this.events
        .publish(GlosEvent.Pudo.FreightInstructed, { freightId: f.freightId, code: f.code, driverDid: f.claimedBy, amended, text: amended ? f.instructionAmendments![f.instructionAmendments!.length - 1].text : v?.text, contactName: v?.contactName, contactPhone: v?.contactPhone, deliveryWindow: v?.deliveryWindow }, { source: 'pudo' })
        .catch(() => undefined);
    }
    return f;
  }

/**
   * P1 — THE ORDERS A FLEET MUST CARRY, by the day they must arrive: everything ordered under its contracts, whatever
   * has become of it, so the office plans tomorrow and still sees what yesterday left undone. Read for one fleet only.
   */
  ordersForFleet(fleetDid: string, q: { from?: string; to?: string } = {}, now: number = Date.now()): FleetOrderRow[] {
    const today = new Date(now).toISOString().slice(0, 10);
    const rows: FleetOrderRow[] = [];
    for (const f of this.freights.values()) {
      if (f.contract?.fleetDid !== fleetDid || !f.deliverOn) continue;
      if (q.from && f.deliverOn < q.from) continue;
      if (q.to && f.deliverOn > q.to) continue;
      let driverName: string | undefined;
      if (f.claimedBy) {
        try {
          driverName = this.drivers.get(f.claimedBy).displayName;
        } catch {
          /* a driver no longer on record is still on the haul — by plate below */
        }
      }
      const window = instructionsViewOf(f)?.deliveryWindow;
      // The vehicle is frozen onto the load when the goods are taken over. Until then the truck that will collect it
      // is whichever one its driver is out in now — read live, because before pickup that is still the office's to change.
      const plate = f.carriage?.plate ?? (f.claimedBy && f.status === 'claimed' ? this.fleet.vehicleForDriver(f.claimedBy)?.plate : undefined);
      rows.push({
        freightId: f.freightId,
        code: f.code,
        contract: f.contract,
        deliverOn: f.deliverOn,
        ...(window ? { deliveryWindow: window } : {}),
        description: f.description,
        weightKg: f.weightKg,
        packaging: f.packaging ?? DEFAULT_PACKAGING,
        pickupLabel: f.pickupLabel,
        pickupLocation: f.pickupLocation,
        destLabel: f.destLabel,
        ...(f.destLocation ? { destLocation: f.destLocation } : {}),
        status: f.status,
        ...(f.postedByName ? { postedByName: f.postedByName } : {}),
        ...(f.onBehalfOf ? { onBehalfOf: f.onBehalfOf } : {}),
        ...(driverName ? { driverName } : {}),
        ...(plate ? { plate } : {}),
        createdAt: f.createdAt,
        ...(f.claimedAt ? { claimedAt: f.claimedAt } : {}),
        ...(f.pickedUpAt ? { pickedUpAt: f.pickedUpAt } : {}),
        ...(f.deliveredAt ? { deliveredAt: f.deliveredAt } : {}),
        ...(f.proofOfDelivery?.receiverName ? { receiverName: f.proofOfDelivery.receiverName } : {}),
        ...(f.cancellation ? { cancelledAt: f.cancellation.at } : {}),
        // Late is a FACT about the day, not an estimate: the day it had to arrive is behind us and it has not.
        late: f.deliverOn < today && f.status !== 'delivered' && f.status !== 'cancelled',
        // Every order is minted with a key; one never is without.
        trackingKey: f.trackingKey!,
        trackingUrl: trackingUrlOf(f.trackingKey!),
      });
    }
    return rows.sort((a, b) => a.deliverOn.localeCompare(b.deliverOn) || a.createdAt.localeCompare(b.createdAt));
  }

  /** FP6 — the load behind a tracking key, or nothing. The key is the credential: no other lookup is offered. */
  freightByTrackingKey(trackingKey: string): Freight | undefined {
    return [...this.freights.values()].find((f) => f.trackingKey === trackingKey);
  }

  /**
   * FP6 — the shipper's verdict on a delivered load. Delivered only (there is nothing to judge before), within
   * the window, and only while a carrier is on the record. Last wins on the same load; the driver's composite
   * moves with it. Recorded on the freight so the shipper's list can show what they said.
   */
  rateFreight(freightId: string, byDid: string, input: { stars: number; issues?: DriverIssue[] }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    if (f.status !== 'delivered') throw new GlosError('INVALID_STATE', `Freight is ${f.status} — a load is rated once it has been delivered`);
    if (!f.claimedBy) throw new GlosError('INVALID_STATE', 'No carrier is recorded on this load');
    if (f.deliveredAt && now - new Date(f.deliveredAt).getTime() > FREIGHT_RATING_WINDOW_DAYS * 86_400_000) throw new GlosError('WINDOW_EXPIRED', `A load is rated within ${FREIGHT_RATING_WINDOW_DAYS} days of delivery`);
    const { rating } = this.ratings.rateFreight({ freightId: f.freightId, driverDid: f.claimedBy, byDid, stars: input.stars, issues: input.issues });
    f.rating = { stars: rating.stars, issues: rating.issues, at: rating.at, by: byDid };
    this.freights.set(f.freightId, f);
    return f;
  }

  private driverNameOf(did: string): string | undefined {
    try {
      return this.drivers.get(did).displayName;
    } catch {
      return undefined;
    }
  }

  /** The proposals on a load, newest first. The poster's whole view of the negotiation. */
  proposalsFor(freightId: string): FreightProposal[] {
    return [...this.proposals.values()].filter((p) => p.freightId === freightId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** A driver pulls their own price back — before a poster acts on a number they no longer mean. */
  withdrawProposal(proposalId: string, driverDid: string, now: number = Date.now()): FreightProposal {
    const p = this.requireProposal(proposalId);
    if (p.driverDid !== driverDid) throw new GlosError('FORBIDDEN', 'That proposal is not yours');
    if (p.status !== 'open') throw new GlosError('INVALID_STATE', `Proposal is ${p.status}`);
    p.status = 'withdrawn';
    p.decidedAt = new Date(now).toISOString();
    this.proposals.set(p.proposalId, p);
    return p;
  }

  /** The poster says no to one price without closing the negotiation — the load and the others stay open. */
  declineProposal(proposalId: string, now: number = Date.now()): FreightProposal {
    const p = this.requireProposal(proposalId);
    if (p.status !== 'open') throw new GlosError('INVALID_STATE', `Proposal is ${p.status}`);
    p.status = 'declined';
    p.decidedAt = new Date(now).toISOString();
    this.proposals.set(p.proposalId, p);
    return p;
  }

  /**
   * The poster takes a price — and THAT is what claims the load.
   *
   * Everything is re-checked against the world as it is now, not as it was when the price was named: the
   * driver may have de-coupled, re-coupled to an unsuitable vehicle, filled their capacity, or dropped below
   * the rating floor since. A proposal is an offer to treat with a shelf life, not a reservation.
   */
  acceptProposal(proposalId: string, now: number = Date.now()): { proposal: FreightProposal; freight: Freight } {
    const p = this.requireProposal(proposalId);
    if (p.status !== 'open') throw new GlosError('INVALID_STATE', `Proposal is ${p.status}`);
    const f = this.requireFreight(p.freightId);
    const vehicle = this.fleet.vehicleForDriver(p.driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'That driver is no longer coupled to a vehicle');
    if (f.weightKg > this.remainingCapacity(p.driverDid)) throw new GlosError('CAPACITY_EXCEEDED', 'That driver no longer has capacity for this load');
    // S31/S32 — the same capability/equipment re-check the counter claim does. Coupling is re-assignable, so
    // what held when the price was named may not hold now.
    const need = this.loadRequirements('freight', f.freightId);
    if (
      need.capabilities.some((cap) => !vehicle[cap]) ||
      !DispatchService.hasEquipmentFor(vehicle, need.equipment) ||
      (need.bulk && !vehicle.carriesBulk) ||
      (need.fragile && !vehicle.allowsFragile)
    ) {
      throw new GlosError('VEHICLE_MISSING_CAPABILITY', "That driver's current vehicle lacks a capability or equipment this load requires");
    }
    this.requireBorderAllows(vehicle, p.driverDid, 'freight', f.freightId);

    // The commit runs first: if it throws (budget, status, rating) nothing is marked accepted and the
    // negotiation is left exactly as it was, so the poster can raise a cap and try the same price again.
    const freight = this.lockFreightToDriver(f, p.driverDid, vehicle, { deadheadKm: p.deadheadKm, loadedKm: p.loadedKm }, p.price, now);
    const at = new Date(now).toISOString();
    p.status = 'accepted';
    p.decidedAt = at;
    this.proposals.set(p.proposalId, p);
    // Everyone else's price is now moot — say so explicitly rather than leaving open proposals against a load
    // that is gone. 'superseded' is a distinct outcome from 'declined': nobody judged these numbers.
    for (const other of this.proposals.values()) {
      if (other.freightId === f.freightId && other.proposalId !== p.proposalId && other.status === 'open') {
        other.status = 'superseded';
        other.decidedAt = at;
        this.proposals.set(other.proposalId, other);
      }
    }
    // Retire any live counter-offers on the same load, exactly as an instant claim does.
    for (const o of this.offers.values()) if (o.ref === f.freightId && o.status === 'pending') o.status = 'ignored';
    void this.events.publish(GlosEvent.Pudo.LoadClaimed, { driverDid: p.driverDid, kind: 'freight', ref: f.freightId, weightKg: f.weightKg }, { source: 'pudo' }).catch(() => undefined);
    return { proposal: p, freight };
  }

  /**
   * FP5 — the fleet office puts a load on one of its drivers.
   *
   * The third door to the one commit (lockFreightToDriver), beside the counter claim and an accepted
   * proposal, and it passes every gate they pass: the driver must be ON A SHIFT (a load is put on a vehicle,
   * and the price is that vehicle's), with room, with the capability and the papers the road needs, under
   * the shipper's budget and above the rating floor. What differs is who decided — recorded on the freight,
   * so a driver who did not choose this work can see that, and so the office's decisions are on the record.
   *
   * A load posted for negotiation cannot be assigned: its price is not settled, and an office committing
   * a driver at a counter rate would take it at a number nobody agreed to.
   *
   * Priced from where the driver IS, because the empty run is real kilometres the shipper pays for. A shift
   * that has never reported a position is priced from the pickup — an unknown empty run is not billed.
   */
  assign(freightId: string, driverDid: string, by: { managerDid: string; name?: string }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    // P1 — whose order it is comes before anything about the truck: another fleet learns nothing about whether it fits.
    if (f.status === 'ordered' && f.contract?.fleetDid !== by.managerDid) throw new GlosError('FORBIDDEN', 'This is an order under a contract — only the fleet it was ordered from puts it on a truck');
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'That driver is not on a shift — a load goes on a vehicle, and they have none yet');
    if (commitModeOf(f) === 'negotiate') throw new GlosError('NEGOTIATION_REQUIRED', 'This load is posted for negotiation — the driver can send the shipper a price from their board; it cannot be assigned at a counter rate');
    if (f.weightKg > this.remainingCapacity(driverDid)) throw new GlosError('CAPACITY_EXCEEDED', "That driver's vehicle has no room left for this load");
    const need = this.loadRequirements('freight', f.freightId);
    if (
      need.capabilities.some((cap) => !vehicle[cap]) ||
      !DispatchService.hasEquipmentFor(vehicle, need.equipment) ||
      (need.bulk && !vehicle.carriesBulk) ||
      (need.fragile && !vehicle.allowsFragile)
    ) {
      throw new GlosError('VEHICLE_MISSING_CAPABILITY', "That driver's vehicle lacks a capability or equipment this load requires");
    }
    this.requireBorderAllows(vehicle, driverDid, 'freight', f.freightId);
    const at = this.fleet.activeForDriver(driverDid)?.location;
    const deadheadKm = at ? round1(this.router.roadKm(at, f.pickupLocation)) : 0;
    const loadedKm = round1(f.destLocation ? this.router.roadKm(f.pickupLocation, f.destLocation) : 0);
    const freight = this.lockFreightToDriver(f, driverDid, vehicle, { deadheadKm, loadedKm }, undefined, now, by.managerDid);
    const atIso = new Date(now).toISOString();
    freight.assignedBy = { managerDid: by.managerDid, ...(by.name ? { name: by.name } : {}), at: atIso };
    this.freights.set(freight.freightId, freight);
    // Everyone else's price and every live counter-offer on this load are moot now, exactly as after a claim.
    for (const other of this.proposals.values()) {
      if (other.freightId === f.freightId && other.status === 'open') {
        other.status = 'superseded';
        other.decidedAt = atIso;
        this.proposals.set(other.proposalId, other);
      }
    }
    for (const o of this.offers.values()) if (o.ref === f.freightId && o.status === 'pending') o.status = 'ignored';
    // Taking a load is saying where you are going — the same restraint as a claim (deriveLegFromLoad).
    if (f.destLocation) this.fleet.deriveLegFromLoad(driverDid, { fromLabel: f.pickupLabel, from: f.pickupLocation, toLabel: f.destLabel, to: f.destLocation });
    void this.events.publish(GlosEvent.Pudo.LoadClaimed, { driverDid, kind: 'freight', ref: f.freightId, weightKg: f.weightKg }, { source: 'pudo' }).catch(() => undefined);
    void this.events
      .publish(GlosEvent.Pudo.FreightAssigned, { freightId: f.freightId, code: f.code, driverDid, managerDid: by.managerDid, byName: by.name, pickupLabel: f.pickupLabel, destLabel: f.destLabel, weightKg: f.weightKg, earning: freight.lockedPrice }, { source: 'pudo' })
      .catch(() => undefined);
    return freight;
  }

  /** Lookups the controller needs to authorise a negotiation before it acts. Read-only. */
  requireProposalPublic(proposalId: string): FreightProposal {
    return this.requireProposal(proposalId);
  }

  requireFreightPublic(freightId: string): Freight {
    return this.requireFreight(freightId);
  }

  private requireProposal(proposalId: string): FreightProposal {
    const p = this.proposals.get(proposalId);
    if (!p) throw new GlosError('NOT_FOUND', 'Proposal not found');
    return p;
  }

  /**
   * How often work at a given price is actually taken — the instrument for the question nobody could answer.
   *
   * *"Below some fee nobody takes the hop, and that number decides how dense the node network has to be."*
   * The data for it was never missing: every offer carries what it would pay and what the driver did about
   * it. Nothing read it. This reads it, and deliberately reports a CURVE rather than a threshold — see the
   * four rules in `offer-response.ts`, of which the sharpest is that a lapsed offer is not a refusal.
   *
   * KNOWN LIMIT, reported rather than papered over: offers live in memory, so the window is usually "since
   * the last restart". `observedFrom`/`observedTo` are read off the offers themselves so a reader can see
   * the real edges instead of trusting a period we never had the data to fill.
   */
  offerResponse(opts: { kind?: 'tote' | 'freight'; driverDid?: string } = {}, now: number = Date.now()): OfferResponse {
    const offers = [...this.offers.values()].filter(
      (o) => (!opts.kind || o.kind === opts.kind) && (!opts.driverDid || o.driverDid === opts.driverDid),
    );
    return buildOfferResponse(offers, now);
  }

  ignore(offerId: string): Offer {
    const offer = this.requireOffer(offerId);
    if (offer.status === 'pending') offer.status = 'ignored';
    return offer;
  }

  /** Offers still awaiting an answer (lapsed ones are reported as auto-ignored). */
  activeOffersFor(driverDid: string, now: number = Date.now()): Offer[] {
    const live: Offer[] = [];
    for (const o of this.offers.values()) {
      if (o.driverDid !== driverDid) continue;
      if (o.status === 'pending' && new Date(o.expiresAt).getTime() <= now) o.status = 'expired'; // auto-ignore
      if (o.status === 'pending') live.push(o);
    }
    return live.sort((a, b) => a.detourKm - b.detourKm);
  }

  // --- capacity ---

  /** Total load the fleet manager set on the vehicle, minus everything the driver is already carrying. */
  remainingCapacity(driverDid: string): number {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return 0;
    const toteKg = this.totes.list().filter((t) => t.claimedBy === driverDid && (t.status === 'claimed' || t.status === 'in_transit')).reduce((s, t) => s + t.weightKg, 0);
    const freightKg = [...this.freights.values()].filter((f) => f.claimedBy === driverDid && (f.status === 'claimed' || f.status === 'in_transit')).reduce((s, f) => s + f.weightKg, 0);
    return Math.round((vehicle.capacityKg - toteKg - freightKg) * 100) / 100;
  }

  /**
   * The platform's take on THIS freight — the selling sister's dedicated-lane stack.
   *
   * One helper, used by every gate and by the billing, because they must not disagree: a load that passed
   * a budget check at one rate and then billed at another would overshoot a cap the shipper was promised.
   *
   * No sister where there is no shipper — a counter-booked cash freight settles off-platform, so nobody is
   * billed and there is no seller whose rate could apply. Falls back rather than throwing for the same
   * reason everywhere else does: a pricing lookup must never be what stops a load being offered.
   */
  private freightFeePct(f?: { shipperDid?: string }): number {
    if (!f?.shipperDid) return PLATFORM_FEE_PCT;
    try {
      return this.entities.ratesFor(this.vendors.entityIdOf(this.vendors.get(f.shipperDid)), 'dedicated').totalPct;
    } catch {
      return PLATFORM_FEE_PCT;
    }
  }

  /**
   * The tax the shipper's own sister charges on a dedicated haul. Zero where there is no shipper — a
   * counter-booked cash freight settles off-platform, so nobody is billed and there is nothing to tax.
   *
   * Falls back rather than throwing for the same reason `freightFeePct` does: a pricing lookup must never
   * be the thing that stops a load being offered.
   */
  private freightTaxPct(f?: { shipperDid?: string }): number {
    if (!f?.shipperDid) return 0;
    try {
      return this.entities.taxFor(this.vendors.entityIdOf(this.vendors.get(f.shipperDid)), 'dedicated').ratePct;
    } catch {
      return 0;
    }
  }

  /**
   * What a shipper actually pays for a haul: the driver's earning, the platform's take, and the tax on
   * both — ONE computation, so a budget gate and the bill it gates can never disagree.
   *
   * Every budget check in this service goes through here for exactly that reason. `maxSpend` is the most a
   * shipper will part with, and what leaves their account is the gross; comparing a net figure to their
   * cap would commit them to a haul they cannot pay for and only find out at the billing.
   */
  private shipperBill(driverTotal: number, f?: { shipperDid?: string }): { net: number; tax: number; gross: number; feePct: number; taxPct: number; provision: number } {
    const feePct = this.freightFeePct(f);
    const taxPct = this.freightTaxPct(f);
    // The cost-of-risk slice, on the same base the fee was computed on — a haul's provider cost IS the
    // driver's earning, exactly as node fees plus transport are a parcel's.
    const provision = Math.round(Math.max(0, driverTotal) * this.freightRiskPct(f) * 100) / 100;
    return { ...taxOn(shipperCharge(driverTotal, feePct), taxPct), feePct, taxPct, provision };
  }

  /** The cost-of-risk rate for a dedicated haul. Falls back to none, like its two neighbours above: a
   *  pricing lookup must never be the thing that stops a load being offered. */
  private freightRiskPct(f?: { shipperDid?: string }): number {
    if (!f?.shipperDid) return 0;
    try {
      return this.entities.ratesFor(this.vendors.entityIdOf(this.vendors.get(f.shipperDid)), 'dedicated').costOfRiskPct;
    } catch {
      return 0;
    }
  }

  /** The same bill, from a load's ref — for the gates, which hold a Claimable. `shipperDid` deliberately
   *  does NOT ride on Claimable: that shape reaches drivers, and who pays is not a driver's business. */
  private shipperBillFor(driverTotal: number, ref: string): { gross: number } {
    return this.shipperBill(driverTotal, this.freights.get(ref));
  }

  /** The same rate, from a load's ref — for the gates, which hold a Claimable. `shipperDid` deliberately
   *  does NOT ride on Claimable: that shape reaches drivers, and who pays is not a driver's business. */
  private freightFeePctFor(ref: string): number {
    return this.freightFeePct(this.freights.get(ref));
  }

  /** How many BAGS this vehicle holds (the shared pure helper — see fleet.config toteCapacityOf). */
  toteCapacityOf(vehicle: Vehicle): number {
    return toteCapacityOf(vehicle);
  }

  /**
   * Bag spaces left in the hold — the capacity kilos cannot express.
   *
   * A tote of letters weighs nothing, so a bus with 500 kg free could be offered a hundred bags while its
   * boot holds a dozen. Counted in BAGS, against what the driver is already carrying or has reserved.
   */
  remainingTotes(driverDid: string): number {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return 0;
    const held = this.totes.list().filter((t) => t.claimedBy === driverDid && (t.status === 'claimed' || t.status === 'in_transit')).length;
    return Math.max(0, this.toteCapacityOf(vehicle) - held);
  }

  /**
   * Would this driver take a load HERE, given what they said about their day?
   *
   * "A load near you" has always meant near your last GPS fix, which is only half the question — a driver
   * leaving Hawassa for Addis is a hundred metres from a bag going the other way, and got pinged about it.
   * What they declared answers it, in one of two shapes:
   *   - a ROAD: is this load on my way? (the same detour budget the offer list uses, so being told about a
   *     load and being offered it agree with each other);
   *   - a PATCH: is this load within my radius of where I am NOW? A bajaj works a district, not a corridor,
   *     and the circle travels with the rider — which is the only reading of "near me" that survives them
   *     drifting across town all morning.
   *
   * A driver who has declared nothing is not excluded: we cannot say they are NOT going there, and going
   * quiet on them would punish the very drivers we most want to start declaring. Never throws — this is a
   * notification filter, and a rider with no fix yet is better over-told than silenced.
   */
  worksNear(driverDid: string, point: GeoPoint): boolean {
    const work = this.fleet.workFor(driverDid);
    if (!work) return true;
    try {
      if (work.kind === 'area') {
        const at = this.fleet.activeForDriver(driverDid)?.location;
        return at ? haversineKm(at, point) <= work.radiusKm : true;
      }
      return this.router.detourKm(work.from, point, work.to) <= DISPATCH_MAX_DETOUR_KM;
    } catch {
      return true; // an unroutable declaration must not silence a driver
    }
  }

  /**
   * Can this driver's CURRENTLY-coupled vehicle carry this freight? A capability-fitness check only —
   * the same capabilities / equipment / bulk / fragile predicate claim() enforces (loadRequirements +
   * hasEquipmentFor), minus the claim-time capacity/budget gates. Used to TARGET a freight-posted
   * notification at drivers who could actually claim it, so a bike/small-van driver is never pinged for a
   * pallet. Never throws (a notification filter): an uncoupled driver or an unknown freight → false.
   */
  freightCarryableByDriver(freightId: string, driverDid: string): boolean {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle || !this.freights.has(freightId)) return false;
    const need = this.loadRequirements('freight', freightId);
    return !(
      need.capabilities.some((cap) => !vehicle[cap]) ||
      !DispatchService.hasEquipmentFor(vehicle, need.equipment) ||
      (need.bulk && !vehicle.carriesBulk) ||
      (need.fragile && !vehicle.allowsFragile)
    );
  }

  /** Loads the driver currently holds (claimed or on the vehicle). */
  claimsFor(driverDid: string): Claimable[] {
    const totes = this.totes.list().filter((t) => t.claimedBy === driverDid && (t.status === 'claimed' || t.status === 'in_transit')).map((t) => this.wrapTote(t.code)).filter((c): c is Claimable => c != null);
    const freight = [...this.freights.values()].filter((f) => f.claimedBy === driverDid && (f.status === 'claimed' || f.status === 'in_transit')).map((f) => this.wrapFreight(f));
    return [...totes, ...freight];
  }

  /** Freight is picked up (claimed → in_transit) then delivered (→ delivered, capacity released). S32b: when
   *  a driver DID is given (the authenticated driver-app path), only the driver who CLAIMED it may advance it —
   *  a claimed freight is that driver's obligation, not a free-for-all. */
  pickupFreight(freightId: string, driverDid?: string, check?: { confirmed?: string[]; securementPhotoId?: string; reservations?: string }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    if (driverDid && f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'claimed') throw new GlosError('INVALID_STATE', `Freight is ${f.status}, expected claimed`);
    // A load reserved ahead of its date can't be picked up before it — the cargo (or the consolidated lot)
    // isn't ready yet. It becomes pickable on/after the booked pickup date.
    if (f.scheduledPickupAt && now < new Date(f.scheduledPickupAt).getTime()) throw new GlosError('INVALID_STATE', `Pickup is booked for ${f.scheduledPickupAt} — it can't be collected before then`);
    // S33 — the load-safety gate. Every dedicated freight must clear the load-safety checklist THIS cargo
    // requires (re-derived from the freight, so a client that under-reports can't bypass it) AND carry a
    // securement photo, before it leaves the pickup. The check happens BEFORE any mutation, so a failed gate
    // leaves the freight untouched (still 'claimed').
    const required = requiredLoadKeys({ bulk: f.bulk, fragile: f.fragile, requiredCapabilities: f.requiredCapabilities });
    const missing = missingKeys(required, check?.confirmed);
    if (missing.length) throw new GlosError('SAFETY_CHECK_INCOMPLETE', `Complete the load-safety checklist before pickup — ${missing.length} item(s) left`);
    const securementPhotoId = check?.securementPhotoId;
    if (!securementPhotoId) throw new GlosError('SECUREMENT_PHOTO_REQUIRED', 'Attach a photo of the secured load before pickup');
    f.status = 'in_transit';
    f.pickedUpAt = new Date().toISOString();
    f.loadSafety = { confirmed: [...new Set(check?.confirmed ?? [])], securementPhotoRef: securementPhotoId, at: f.pickedUpAt, by: driverDid };
    // FP3 — box 18: what the carrier saw when the goods were handed over. Optional, and only ever the driver's words.
    const reservations = check?.reservations?.trim();
    f.reservations = reservations ? { note: reservations.slice(0, 500), at: f.pickedUpAt, by: driverDid } : undefined;
    // Bind the securement photo to the freight so its retention clock is the freight's, not the 48h orphan
    // reaper. adopt() (not link()) because this id came from the CLIENT: it only re-kinds/links a photo the
    // DRIVER owns and that isn't attached elsewhere, so a passed id can never launder another actor's media
    // (S29). Anchored at delivery (the terminal state).
    this.media.adopt(securementPhotoId, driverDid ?? '', { type: 'freight', id: f.freightId }, 'securement');
    // FP2 — the consignment note names the vehicle that took the goods over. Fixed now, from the driver's shift.
    if (driverDid) {
      const session = this.fleet.sessionFor(driverDid);
      if (session.active) {
        let managerDid: string | undefined;
        try {
          managerDid = this.drivers.get(driverDid).managerDid ?? undefined;
        } catch {
          managerDid = undefined;
        }
        f.carriage = { vehicleId: session.vehicle.vehicleId, plate: session.vehicle.plate, vehicleClass: session.vehicle.vehicleClass, driverDid, ...(managerDid ? { managerDid } : {}), at: new Date(now).toISOString() };
      }
    }
    this.freights.set(f.freightId, f);
    // The goods are on the truck: the moment the sender's original is signed and stops being editable.
    // Published after the write, so nothing downstream reads a load that has not been saved yet.
    void this.events.publish(GlosEvent.Pudo.FreightPickedUp, { freightId: f.freightId, code: f.code, driverDid: f.claimedBy }, { source: 'pudo' }).catch(() => undefined);
    return f;
  }
  deliverFreight(freightId: string, driverDid?: string, check?: { confirmed?: string[]; receiverName?: string; podPhotoId?: string; remarks?: string }): Freight {
    const f = this.requireFreight(freightId);
    if (driverDid && f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}, expected in_transit`);
    // S33 — the unload gate: the unload checklist must be complete before the freight is marked delivered.
    const missing = missingKeys(requiredUnloadKeys(), check?.confirmed);
    if (missing.length) throw new GlosError('SAFETY_CHECK_INCOMPLETE', `Complete the unload checklist before delivery — ${missing.length} item(s) left`);
    // FP3 — proof of delivery. "Delivered" without a receiver's name and a photo of the goods as put down is the
    // driver's word against the sender's; with them it is box 24 of the consignment note. Both are required,
    // like the securement photo at pickup — it is the driver this protects first.
    const receiverName = check?.receiverName?.trim() ?? '';
    if (receiverName.length < 2) throw new GlosError('RECEIVER_REQUIRED', 'Record who received the goods before marking the load delivered');
    const podPhotoId = check?.podPhotoId;
    if (!podPhotoId) throw new GlosError('DELIVERY_PHOTO_REQUIRED', 'Attach a photo of the goods as delivered');
    f.status = 'delivered'; // no longer counts against the driver's remaining capacity
    f.deliveredAt = new Date().toISOString();
    f.unloadReport = { confirmed: [...new Set(check?.confirmed ?? [])], at: f.deliveredAt, by: driverDid };
    const remarks = check?.remarks?.trim();
    f.proofOfDelivery = { receiverName: receiverName.slice(0, 120), photoRef: podPhotoId, ...(remarks ? { remarks: remarks.slice(0, 500) } : {}), at: f.deliveredAt, by: driverDid };
    // Same adopt-not-link rule as the securement photo (S29): only the driver's own, unattached upload is taken.
    this.media.adopt(podPhotoId, driverDid ?? '', { type: 'freight', id: f.freightId }, 'pod');
    // S34 — pay the driver their LOCKED earning on delivery, exactly once. A system-level ledger outflow
    // (drivers hold no agent wallet). A legacy/bulletin freight claimed before pricing (no lockedPrice) is skipped.
    // B2 — never for a haul settled between the parties: the shipper pays the carrier, and a payable on our books
    // would be a second debt for the same work, owed by a company that never held the money.
    if (f.lockedPrice != null && !f.driverPaid && f.claimedBy && f.settlement !== 'between_parties') {
      // WHO it was owed to, read in the same turn the payout resolves it and kept on the load: a claim upheld
      // weeks later takes the money back from this party, not from a fleet the driver has joined since.
      const payee = this.drivers.payeeOrNone(f.claimedBy);
      if (this.gate.driverPayout(f.claimedBy, f.lockedPrice) && payee.entityId) f.driverPayee = { payeeDid: payee.payeeDid, entityId: payee.entityId };
      f.driverPaid = true;
    }
    // S33 — delivery is terminal: start the securement photo's retention clock (shipment-proof bin).
    this.media.anchorFreightTerminal(f.freightId);
    this.freights.set(f.freightId, f);
    // FP2 — the consignment closes: whoever documents and bills it is told.
    void this.events.publish(GlosEvent.Pudo.FreightDelivered, { freightId: f.freightId, code: f.code, driverDid: f.claimedBy }, { source: 'pudo' }).catch(() => undefined);
    return f;
  }

  /**
   * FP3b — the driver was at the door and could not hand over: nobody there, the receiver refused, or the place
   * could not be reached. The load STAYS in transit — the goods are still on the van and still the carrier's to
   * answer for — and the attempt is written down and told to the sender, who is the one who can do something
   * about it (ring the receiver, name another door, take it back). Box 24 of the note lists every attempt.
   */
  failDelivery(freightId: string, driverDid: string | undefined, input: { outcome: DeliveryFailure; note?: string }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    if (driverDid && f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}, expected in_transit`);
    if (!DELIVERY_FAILURES.includes(input.outcome)) throw new GlosError('INVALID_INPUT', 'Say what happened at the door: absent, refused or unreachable');
    const note = input.note?.trim();
    const at = new Date(now).toISOString();
    f.deliveryAttempts = [...(f.deliveryAttempts ?? []), { outcome: input.outcome, ...(note ? { note: note.slice(0, 500) } : {}), at, by: driverDid }];
    this.freights.set(f.freightId, f);
    void this.events
      .publish(GlosEvent.Pudo.FreightDeliveryFailed, { freightId: f.freightId, code: f.code, driverDid: f.claimedBy, posterDid: f.postedByDid ?? f.shipperDid, outcome: input.outcome, note, destLabel: f.destLabel, attempts: f.deliveryAttempts.length }, { source: 'pudo' })
      .catch(() => undefined);
    return f;
  }

  /**
   * FP3b — the sender says the delivered goods were damaged, short, or never arrived. One claim per load, within
   * the claim window (the CMR gives seven days for damage that was not apparent at delivery), and only against a
   * DELIVERED load: a load still on the road is a conversation with the driver, not a claim. The photo, if any,
   * is adopted under the same ownership rule as every other client-supplied picture, and all the load's proof —
   * securement, delivery, this — goes onto the dispute-evidence clock so nothing is swept while the case is open.
   */
  openFreightClaim(freightId: string, byDid: string, input: { kind: FreightClaimKind; description: string; photoRef?: string }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    if (f.status !== 'delivered') throw new GlosError('INVALID_STATE', f.status === 'in_transit' ? 'The goods are still on the road — talk to the driver; a claim is made against a delivered load' : `Freight is ${f.status}, expected delivered`);
    if (f.claim) throw new GlosError('INVALID_STATE', f.claim.state === 'open' ? 'A claim on this load is already open' : 'This load’s claim has already been decided');
    if (!FREIGHT_CLAIM_KINDS.includes(input.kind)) throw new GlosError('INVALID_INPUT', 'Say what is wrong: damaged, short, or not received');
    const description = (input.description ?? '').trim();
    if (description.length < 3) throw new GlosError('FIELD_REQUIRED', 'Say what you found — the operator deciding this has only your words and the photos');
    const deliveredAt = f.deliveredAt ? new Date(f.deliveredAt).getTime() : now;
    if (now - deliveredAt > FREIGHT_CLAIM_WINDOW_DAYS * 86_400_000) throw new GlosError('WINDOW_EXPIRED', `A claim is made within ${FREIGHT_CLAIM_WINDOW_DAYS} days of delivery`);
    const at = new Date(now).toISOString();
    f.claim = { state: 'open', kind: input.kind, description: description.slice(0, 1000), ...(input.photoRef ? { photoRef: input.photoRef } : {}), raisedBy: byDid, raisedAt: at };
    if (input.photoRef) this.media.adopt(input.photoRef, byDid, { type: 'freight', id: f.freightId }, 'dispute');
    this.media.holdFreightForDispute(f.freightId, new Date(now));
    this.freights.set(f.freightId, f);
    void this.events.publish(GlosEvent.Pudo.FreightClaimOpened, { freightId: f.freightId, code: f.code, kind: input.kind, byDid, driverDid: f.claimedBy }, { source: 'pudo' }).catch(() => undefined);
    return f;
  }

  /**
   * CL1 — WHO OWNS THE LOSS, and therefore who may open a claim on this load.
   *
   * Derived from the agreed term and nothing else. Under a C term the seller pays the carriage to the
   * destination while risk passed to the buyer at origin, so goods damaged on the road are the buyer's loss
   * and the sender is not the party to claim for them. Under the D terms the seller carries the risk the
   * whole way and the sender is.
   *
   * A load with no term recorded answers 'sender', which is what this system did before the term existed and
   * is what every load already on the record is entitled to. That default is the reason this change can ship
   * without rewriting history.
   */
  claimantOf(f: Freight): { party: 'sender' | 'receiver'; term?: string; why: string } {
    const term = incotermEntry(f.incoterm);
    if (!term) return { party: 'sender', why: 'No trade term was recorded for this load, so the sender claims, as before' };
    const party = riskBearerOf(term.code);
    const why =
      party === 'receiver'
        ? term.code + ' passes the risk at the origin, so a loss in transit belongs to the receiver'
        : term.code + ' keeps the risk with the sender until delivery, so a loss in transit belongs to the sender';
    return { party, term: term.code, why };
  }

  /** The claims waiting on a person, oldest first — the one somebody has waited longest for needs answering most. */
  openFreightClaims(): Freight[] {
    return [...this.freights.values()].filter((f) => f.claim?.state === 'open').sort((a, b) => (a.claim?.raisedAt ?? '').localeCompare(b.claim?.raisedAt ?? ''));
  }

  /** Whether a sister billed this load — and so holds a provision an award can be drawn from. */
  claimCoverable(f: Freight): boolean {
    return Boolean(f.billed && f.shipperDid && this.vendors.has(f.shipperDid));
  }

  freightClaimRowOf(f: Freight, names: { sender: string; carrier?: string }): FreightClaimQueueRow {
    const c = f.claim!;
    const coverable = this.claimCoverable(f);
    return {
      freightId: f.freightId,
      code: f.code,
      description: f.description,
      destLabel: f.destLabel,
      kind: c.kind,
      reason: c.description,
      raisedAt: c.raisedAt,
      raisedBy: c.raisedBy,
      senderName: names.sender,
      ...(names.carrier ? { carrierName: names.carrier } : {}),
      ...(f.billed ? { carriage: f.billed.gross, currency: NETWORK_CURRENCY } : f.lockedPrice != null ? { carriage: f.lockedPrice, currency: NETWORK_CURRENCY } : {}),
      // CL1 — the term, and who it gives standing to. An operator awarding money should see which party owns
      // the loss and why, not just who happened to file.
      ...(f.incoterm ? { incoterm: f.incoterm, claimant: this.claimantOf(f).party, standingWhy: this.claimantOf(f).why } : {}),
      // FP8 — what the network paid the carrier for this haul, and so the most an upheld award takes back from them.
      ...(f.driverPaid && f.claimedBy && (f.lockedPrice ?? 0) > 0 ? { carrierPaid: f.lockedPrice } : {}),
      coverable,
      awardCap: coverable ? MAX_CLAIM_AWARD : 0,
      capBasis: coverable ? 'sanity-bound' : 'none',
      evidence: [f.loadSafety?.securementPhotoRef, f.proofOfDelivery?.photoRef, c.photoRef].filter((x): x is string => Boolean(x)),
      attempts: f.deliveryAttempts?.length ?? 0,
      ...(f.proofOfDelivery ? { receiverName: f.proofOfDelivery.receiverName } : {}),
    };
  }

  /**
   * FP3b — decide the claim. Every ending carries a note the claimant is shown, including a rejection. An award
   * is paid the way a parcel award is — from the sender's sister's claims provision, to the store that was
   * billed — and ONLY where somebody was billed through the network: a load settled between sender and carrier
   * was announced as carried under nothing of ours, so upholding it records that the sender was right and that
   * the money is between the parties. Awarding on such a load is refused, not silently zeroed.
   */
  resolveFreightClaim(freightId: string, input: { decision: FreightClaimDecision; award?: number; note: string; by?: string }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    const c = f.claim;
    if (!c || c.state !== 'open') throw new GlosError('INVALID_STATE', c ? 'This claim has already been decided' : 'There is no claim on this load');
    if (!FREIGHT_CLAIM_DECISIONS.includes(input.decision)) throw new GlosError('INVALID_INPUT', 'A decision is upheld, partly upheld or rejected');
    const note = (input.note ?? '').trim();
    if (!note) throw new GlosError('FIELD_REQUIRED', 'A decision needs a reason the claimant can be shown — including a rejection');
    const award = input.decision === 'rejected' ? 0 : Math.round(Math.max(0, Number(input.award) || 0) * 100) / 100;
    const coverable = this.claimCoverable(f);
    if (award > 0 && !coverable) throw new GlosError('INVALID_STATE', 'Nobody was billed for this load through the network, so there is nothing to award from — uphold it with a reason that says the money is between sender and carrier, or reject it');
    if (award > 0 && award > MAX_CLAIM_AWARD) throw new GlosError('INVALID_INPUT', `An award over ${MAX_CLAIM_AWARD} needs to be settled off-platform — this is a sanity bound, not a policy`);
    if (input.decision !== 'rejected' && coverable && award <= 0) throw new GlosError('INVALID_INPUT', 'Upholding a covered claim means awarding something — reject it instead of awarding nothing');
    let funding: { fromProvision: number; fromExpense: number } | undefined;
    let paidTo: NonNullable<Freight['claim']>['paidTo'];
    if (award > 0) {
      funding = this.vendors.payClaim(f.shipperDid!, f.freightId, award, `freight claim · ${f.code}`);
      paidTo = { kind: 'vendor', id: f.shipperDid! };
    } else if (input.decision !== 'rejected') {
      paidTo = { kind: 'between_parties' };
    }
    const at = new Date(now).toISOString();
    // FP8 — the carrier bears what was awarded, up to what they were paid for the haul. Only where the network
    // actually paid them (accrued at delivery); a haul settled between the parties has nothing here to take back.
    if (award > 0 && f.claimedBy && f.driverPaid && (f.lockedPrice ?? 0) > 0) {
      const back = Math.round(Math.min(award, f.lockedPrice!) * 100) / 100;
      if (this.gate.driverClawback(f.claimedBy, back, f.freightId, f.driverPayee)) f.clawback = { amount: back, at, note: `claim upheld · ${f.code}` };
    }
    f.claim = { ...c, state: 'resolved', decision: input.decision, award, note: note.slice(0, 1000), ...(input.by ? { decidedBy: input.by } : {}), decidedAt: at, ...(funding ? { funding } : {}), ...(paidTo ? { paidTo } : {}) };
    this.freights.set(f.freightId, f);
    void this.events
      .publish(GlosEvent.Pudo.FreightClaimDecided, { freightId: f.freightId, code: f.code, decision: input.decision, award, note, posterDid: f.postedByDid ?? f.shipperDid, claimantDid: c.raisedBy, driverDid: f.claimedBy }, { source: 'pudo' })
      .catch(() => undefined);
    return f;
  }

  /**
   * FP8 — the driver hands a claimed load back before pickup. The other half of FP5: an office can put a load
   * on a driver, so a driver must be able to say no — and a driver who claimed it themselves can change their
   * mind before anything physical has happened. Nothing has been taken over, so it all unwinds the way a
   * withdrawal does: the sender's charge comes back, the price lock goes, and the load is on the market again
   * as if untouched — except that the hand-back is on the record, with the reason, and the sender and the
   * office that assigned it are told. From pickup on the goods are on the truck and this is no longer the word.
   */
  handBack(freightId: string, driverDid: string, reason: string, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    const why = (reason ?? '').trim();
    if (why.length < 3) throw new GlosError('REASON_REQUIRED', 'Say why you cannot take this load — the sender and your office are told');
    if (f.status !== 'claimed') throw new GlosError('INVALID_STATE', f.status === 'in_transit' ? 'The goods are on your vehicle — a load that has been taken over is delivered, or the sender is asked to turn it back' : `Freight is ${f.status}`);
    if (f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This load is on another driver');
    const at = new Date(now).toISOString();
    if (f.paidStatus === 'billed' && f.shipperDid && this.vendors.has(f.shipperDid)) {
      const charged = f.billed ?? this.shipperBill(f.lockedPrice ?? 0, f);
      this.vendors.rebate(f.shipperDid, f.freightId, charged.gross, 'load handed back by the driver before pickup', charged.tax, charged.provision);
    }
    const assignedBy = f.assignedBy;
    // The hand-back keeps the carrier it was given back BY, read before the claim is unwound below: it counts on
    // that fleet's record, not on whichever fleet the driver drives for when somebody next reads it.
    const carrierDid = this.carrierOf(f);
    f.handBacks = [...(f.handBacks ?? []), { driverDid, ...(carrierDid ? { carrierDid } : {}), reason: why.slice(0, 500), at }];
    // Back on the market as if untouched: a booked-for-later load whose day has not come goes back to waiting for it.
    f.status = f.scheduledPickupAt && new Date(f.scheduledPickupAt).getTime() > now ? 'scheduled' : 'available';
    for (const k of ['claimedBy', 'carrierDid', 'claimedAt', 'lockedPrice', 'priceBreakdown', 'priceOrigin', 'lockedAt', 'paidStatus', 'billed', 'assignedBy', 'carriedBy', 'driverPaid'] as const) delete (f as unknown as Record<string, unknown>)[k];
    this.freights.set(f.freightId, f);
    void this.events
      .publish(GlosEvent.Pudo.FreightHandedBack, { freightId: f.freightId, code: f.code, driverDid, driverName: this.driverNameOf(driverDid), reason: why, posterDid: f.postedByDid ?? f.shipperDid, managerDid: assignedBy?.managerDid, destLabel: f.destLabel }, { source: 'pudo' })
      .catch(() => undefined);
    return f;
  }

  /**
   * FP3 — the sender withdraws a load before the goods are taken over. Who may (the poster, the shipper, staff) is
   * decided by the caller; this is what withdrawing MEANS. Until pickup nothing has physically happened, so the
   * whole thing unwinds: a billed sender gets exactly the stamped charge back (the no-show rule), open prices
   * are moot, pending offers lapse, and a driver who had claimed it is told by event. From pickup on the goods
   * are on somebody's truck and "cancel" is no longer the word — a load on the road is turned back or a
   * delivered one is claimed against, never erased. The record stays, terminal, with the reason on it.
   */
  cancelFreight(freightId: string, by: { did: string; role: 'shipper' | 'operator' }, reason: string, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    const why = (reason ?? '').trim();
    if (why.length < 3) throw new GlosError('REASON_REQUIRED', 'Say why the load is withdrawn');
    if (f.status === 'cancelled') throw new GlosError('INVALID_STATE', 'This load is already cancelled');
    if (f.status === 'delivered') throw new GlosError('INVALID_STATE', 'This load is delivered — a problem with the goods is a claim, not a cancellation');
    if (f.status === 'in_transit') throw new GlosError('INVALID_STATE', 'The goods are already on the road — a load that has been taken over cannot be cancelled; talk to the driver');
    const at = new Date(now).toISOString();
    let refunded: number | undefined;
    if (f.paidStatus === 'billed' && f.shipperDid && this.vendors.has(f.shipperDid)) {
      const charged = f.billed ?? this.shipperBill(f.lockedPrice ?? 0, f);
      this.vendors.rebate(f.shipperDid, f.freightId, charged.gross, 'freight cancelled by the sender', charged.tax, charged.provision);
      refunded = charged.gross;
    }
    for (const p of this.proposals.values()) {
      if (p.freightId === f.freightId && p.status === 'open') {
        p.status = 'superseded'; // nobody judged these numbers — the load went away
        p.decidedAt = at;
        this.proposals.set(p.proposalId, p);
      }
    }
    for (const o of this.offers.values()) if (o.ref === f.freightId && o.status === 'pending') o.status = 'expired';
    const driverDid = f.claimedBy;
    f.status = 'cancelled';
    f.cancelledAt = at;
    f.cancellation = { by: by.did, role: by.role, reason: why.slice(0, 500), at, ...(refunded != null ? { refunded } : {}) };
    this.freights.set(f.freightId, f);
    void this.events.publish(GlosEvent.Pudo.FreightCancelled, { freightId: f.freightId, code: f.code, driverDid, shipperDid: f.shipperDid, reason: why, by: by.role, destLabel: f.destLabel }, { source: 'pudo' }).catch(() => undefined);
    return f;
  }

  /**
   * S33b — log a temperature reading for a cold-chain freight IN TRANSIT. Only the claiming driver may log it;
   * a reading outside the cargo's safe band marks the freight breached (STICKY — the chain, once broken, stays
   * flagged even if it recovers) and emits an event for the operator watchtower. A freight whose cargo is not
   * temperature-controlled has no band, so logging is refused (there is nothing to monitor).
   */
  recordTemp(freightId: string, celsius: number, driverDid?: string): Freight {
    const f = this.requireFreight(freightId);
    if (driverDid && f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}, expected in_transit`);
    const band = tempBand(f.natureCode);
    if (!band) throw new GlosError('NOT_TEMPERATURE_CONTROLLED', 'This freight is not temperature-controlled — no reading to log');
    if (!Number.isFinite(celsius)) throw new GlosError('INVALID_INPUT', 'A numeric temperature reading is required');
    const c = Math.round(celsius * 10) / 10;
    const breach = isTempBreach(c, band);
    f.tempReadings = [...(f.tempReadings ?? []), { celsius: c, at: new Date().toISOString(), by: driverDid, breach }];
    if (breach && !f.tempBreached) {
      f.tempBreached = true; // sticky
      void this.events.publish(GlosEvent.Pudo.FreightTempBreach, { freightId: f.freightId, code: f.code, celsius: c, band, driverDid }, { source: 'pudo' }).catch(() => undefined);
    }
    this.freights.set(f.freightId, f);
    return f;
  }

  listFreight(filter: { status?: Freight['status'] } = {}): Freight[] {
    return [...this.freights.values()].filter((f) => !filter.status || f.status === filter.status);
  }

  // --- driver jobs + earnings register (R5): the driver's OWN freight hauls, owner-scoped by the caller ---

  driverJobsPage(driverDid: string, q: DriverJobsQuery): Page<DriverJobRow> {
    const filtered = filterDriverJobs([...this.freights.values()], driverDid, q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map(driverJobRowOf), total };
  }

  /** Running totals (earned / paid / unpaid / delivered / count) for the CURRENT filtered view. */
  driverJobsSummary(driverDid: string, q: DriverJobsQuery): DriverJobsSummary {
    return driverJobsSummaryOf(filterDriverJobs([...this.freights.values()], driverDid, q));
  }

  driverJobsCsv(driverDid: string, q: DriverJobsQuery): string {
    return driverJobsToCsv(filterDriverJobs([...this.freights.values()], driverDid, q));
  }

  /* --- FP1: the fleet's register over every haul taken for it --- */

  /**
   * WHOSE JOB THIS WAS: the carrier of record, fixed at the claim. A load claimed before that was recorded is
   * read from the driver's fleet as it stands, which is what every reader did before — and still right for
   * them, because no driver could move fleets until the carrier was recorded.
   */
  carrierOf(f: Freight): string | undefined {
    if (f.carrierDid) return f.carrierDid;
    return f.claimedBy ? this.carrierDidOf(f.claimedBy) : undefined;
  }

  /** A fleet's register is the hauls taken FOR it — by whoever was driving for it then, whoever they drive for now. */
  private takenFor(fleetDid: string): (f: Freight) => boolean {
    return (f) => this.carrierOf(f) === fleetDid;
  }

  /** Whose a hand-back was — kept on it since the carrier was recorded, read from the driver before that. */
  private handBackCarrierOf = (h: HandBack): string | undefined => h.carrierDid ?? this.carrierDidOf(h.driverDid);

  /** CL4 — a carrier's mobilisation record: the loads taken for it (optionally by one driver), and given back by it. */
  mobilisationFor(carrierDid: string, driverDid?: string): Mobilisation {
    return mobilisationForCarrier([...this.freights.values()], carrierDid, (f) => this.carrierOf(f), this.handBackCarrierOf, driverDid);
  }

  /** Every driver who has taken or given back a load FOR this carrier — current drivers and those who have moved on. */
  driversWhoCarriedFor(carrierDid: string): string[] {
    const dids = new Set<string>();
    for (const f of this.freights.values()) {
      if (f.claimedBy && this.carrierOf(f) === carrierDid) dids.add(f.claimedBy);
      for (const h of f.handBacks ?? []) if (this.handBackCarrierOf(h) === carrierDid) dids.add(h.driverDid);
    }
    return [...dids];
  }

  /** The loads given back for this carrier, newest first. */
  handBacksFor(carrierDid: string): Array<{ code: string; driverDid: string; reason: string; at: string }> {
    return [...this.freights.values()]
      .flatMap((f) => (f.handBacks ?? []).filter((h) => this.handBackCarrierOf(h) === carrierDid).map((h) => ({ code: f.code, driverDid: h.driverDid, reason: h.reason, at: h.at })))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  fleetJobsPage(fleetDid: string, nameOf: (did: string) => string, q: FleetJobsQuery): Page<FleetJobRow> {
    const filtered = filterFleetJobs([...this.freights.values()], this.takenFor(fleetDid), q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map((f) => fleetJobRowOf(f, nameOf)), total };
  }

  fleetEarningsSummary(fleetDid: string, nameOf: (did: string) => string, q: FleetJobsQuery): FleetEarningsSummary {
    return fleetEarningsSummaryOf(filterFleetJobs([...this.freights.values()], this.takenFor(fleetDid), q), nameOf);
  }

  fleetJobsCsv(fleetDid: string, nameOf: (did: string) => string, q: FleetJobsQuery): string {
    return fleetJobsToCsv(filterFleetJobs([...this.freights.values()], this.takenFor(fleetDid), q), nameOf);
  }

  /** All cargo currently claimed or moving (optionally scoped to one fleet's drivers) for the dashboard. */
  activeCargo(driverDids?: Set<string>): { items: Array<{ kind: 'tote' | 'freight'; ref: string; weightKg: number; destLabel: string; status: string; driverDid: string; parcels?: number }>; count: number; totalKg: number } {
    const mine = (did: string) => !driverDids || driverDids.has(did);
    // Claimed off the board OR handed over a counter — both are cargo on somebody's vehicle, and only the
    // first used to count. A manager watching a driver ride around with three bags saw an empty fleet.
    const totes = this.totes
      .list()
      .map((t) => ({ t, holder: t.claimedBy ?? t.carriedBy }))
      .filter(({ t, holder }) => holder && mine(holder) && (t.status === 'claimed' || t.status === 'in_transit'))
      .map(({ t, holder }) => ({ kind: 'tote' as const, ref: t.code, weightKg: t.weightKg, destLabel: t.destinationLabel || 'destination', status: t.status, driverDid: holder!, parcels: t.parcels.length }));
    const freight = [...this.freights.values()].filter((f) => f.claimedBy && mine(f.claimedBy) && (f.status === 'claimed' || f.status === 'in_transit')).map((f) => ({ kind: 'freight' as const, ref: f.code, weightKg: f.weightKg, destLabel: f.destLabel, status: f.status, driverDid: f.claimedBy! }));
    const items = [...totes, ...freight];
    return { items, count: items.length, totalKg: Math.round(items.reduce((s, i) => s + i.weightKg, 0) * 100) / 100 };
  }

  // --- internals ---

  private availableLoads(): Claimable[] {
    const totes = this.totes.list({ status: 'available' }).map((t) => this.wrapTote(t.code)).filter((c): c is Claimable => c != null);
    // 'available' loads, PLUS a scheduled load the shipper lets drivers reserve ahead of its date (early claim).
    // FB0c — but never a load posted for NEGOTIATION. Everything downstream of here is a push: an offer card, a
    // lock-screen nudge, one decision and a Claim button. A load whose price is not settled cannot answer that
    // button, so pushing it would be an interruption that dead-ends. It is not hidden — it is on the freight
    // list and on the board, where the action is "send them your price" and the negotiation can actually happen.
    const freight = [...this.freights.values()]
      .filter((f) => f.status === 'available' || (f.status === 'scheduled' && f.allowEarlyClaim))
      .filter((f) => commitModeOf(f) === 'instant')
      .map((f) => this.wrapFreight(f));
    return [...totes, ...freight];
  }

  private wrapTote(code: string): Claimable | null {
    const t = this.totes.byCodeMaybe(code);
    if (!t) return null;
    // A bag has always known where it is going by NAME and never as a place. That gap is why "is this on my
    // way?" could be asked of a freight and not of a bag, why a driver could navigate to the pickup but not
    // through to the drop, and why the haul had to resolve the destination separately to price it. Resolved
    // through the one function that knows what a destination can be — a node, or the hub serving a zone.
    const dest = this.destinationPlace(t);
    // A loaded (in-transit) tote sits on the bus — fall back to an "on board" label so it still shows
    // among the driver's loads. Available/claimed totes resolve to their PUDO/MDP pickup point.
    const place = this.pickupPlace(t.locationId) ?? { loc: { lat: 0, lng: 0 }, label: 'on board' };
    const fragile = false; // totes are not individually flagged fragile here; parcel rules apply at load
    // S31: surface the capabilities the bag's cargo needs (perishable → cold chain, hazardous → hazmat) so a
    // vehicle that lacks one is never offered the tote — the offer would only dead-end at loadBag otherwise.
    return {
      kind: 'tote',
      ref: t.code,
      code: t.code,
      pickupLocation: place.loc,
      pickupLabel: place.label,
      destLabel: t.destinationLabel || 'destination',
      // Absent when the destination cannot be placed — never a guess, because a coordinate is about to be
      // used for distances and directions.
      destLocation: dest?.loc,
      weightKg: t.weightKg,
      // What the bag's pay is made of, and what tells a whole slot's worth from a fifth of one.
      parcels: t.parcels.length,
      fillPct: this.totes.fillPct(t),
      fragile,
      bulk: false,
      status: t.status,
      requiredCapabilities: this.mdps.toteRequiredCapabilities(t),
    };
  }

  /**
   * S34 — resolve a vehicle's pricing profile, filling class defaults for any missing field. A vehicle
   * persisted BEFORE S34a rehydrates with baseFee/minMultiplier/maxMultiplier undefined: PersistentMap.load()
   * does no migration, and vehicle.service.register() only defaults them for a NEWLY created vehicle. Reading
   * them raw would drive NaN into the price and, from there, into a vendor's durable balance and the ledger.
   * Every pricing read goes through here, so a legacy vehicle prices at its class default — mirroring the
   * write-time defaults in register(). (pricing.ts also sanitises non-finite inputs as a last-line backstop.)
   */
  private pricingProfile(vehicle: Vehicle): { baseFee: number; ratePerKm: number; min: number; max: number } {
    const spec = VEHICLE_SPEC[vehicle.vehicleClass];
    const baseFee = Number.isFinite(vehicle.baseFee) ? vehicle.baseFee : (spec?.defaultBaseFee ?? 1);
    const ratePerKm = Number.isFinite(vehicle.pricePerKm) ? vehicle.pricePerKm : DEFAULT_PRICE_PER_KM;
    const min = clampMultiplier(Number.isFinite(vehicle.minMultiplier) ? vehicle.minMultiplier : DEFAULT_MIN_MULTIPLIER);
    const max = Math.max(min, clampMultiplier(Number.isFinite(vehicle.maxMultiplier) ? vehicle.maxMultiplier : DEFAULT_MAX_MULTIPLIER));
    return { baseFee, ratePerKm, min, max };
  }

  private wrapFreight(f: Freight): Claimable {
    // S32: freight now carries its cargo model, so it matches vehicles on capability AND equipment like a tote.
    // S32b: status lets the driver app drive the claimed → picked-up → delivered flow in-app.
    return { kind: 'freight', ref: f.freightId, code: f.code, pickupLocation: f.pickupLocation, pickupLabel: f.pickupLabel, destLabel: f.destLabel, destLocation: f.destLocation, weightKg: f.weightKg, fragile: f.fragile, bulk: f.bulk, status: f.status, scheduledPickupAt: f.scheduledPickupAt, requiredCapabilities: f.requiredCapabilities, requiredEquipment: f.requiredEquipment, lockedPrice: f.lockedPrice, priceBreakdown: f.priceBreakdown, maxSpend: f.maxSpend, cargoClass: f.cargoClass, natureCode: f.natureCode, loadChecklist: loadSafetyItems({ bulk: f.bulk, fragile: f.fragile, requiredCapabilities: f.requiredCapabilities }), unloadChecklist: unloadSafetyItems(), tempBand: tempBand(f.natureCode) ?? undefined, lastTempC: f.tempReadings?.length ? f.tempReadings[f.tempReadings.length - 1].celsius : undefined, tempBreached: f.tempBreached, pickupCountry: f.pickupCountry, destCountry: f.destCountry, bonded: f.bonded, bondCountry: f.bondCountry, ...(f.assignedBy ? { assignedBy: { ...(f.assignedBy.name ? { name: f.assignedBy.name } : {}), at: f.assignedBy.at } } : {}), ...(instructionsViewOf(f) ? { instructions: instructionsViewOf(f) } : {}) };
  }

  /** CA6 — why the law does not let this vehicle carry this load (cabotage, a crossing's weight limit). Empty = it may. */
  private borderRefusals(vehicle: Vehicle, driverDid: string, load: Claimable): BorderRefusal[] {
    if (!this.borders || load.kind !== 'freight') return [];
    return this.borders.refusalsFor(load, this.drivers.homeCountryOf(driverDid, vehicle.managerDid));
  }

  /**
   * BL1 — WHO IS THE CARRIER? The fleet where there is one, the driver themselves where there is not.
   *
   * The same line the handle rule draws and the same line `settlingEntityIdOf` draws when deciding who
   * gets paid: the network contracts with the fleet, or with the owner-driver. A transit licence is held
   * by whoever contracts to carry, so it is asked of the same party.
   */
  private carrierDidOf(driverDid: string): string {
    try {
      return this.drivers.get(driverDid).managerDid ?? driverDid;
    } catch {
      return driverDid;
    }
  }

  /**
   * BL1 — why this carrier may not move uncleared goods. Undefined = they may, or it is not bonded.
   *
   * Shaped as a BorderRefusal on purpose: it belongs to the same family as cabotage and a crossing's
   * weight limit — something the LAW forbids, asked again at every take point, and said in a sentence
   * rather than as a code somebody has to interpret. The user's line was "not closing an eye and wait
   * for trouble", and the trouble here is a truck turning up at a bonded gate without a licence.
   */
  private bondRefusal(driverDid: string, load: Claimable): BorderRefusal | undefined {
    if (load.kind !== 'freight') return undefined;
    /*
     * READ OFF THE RECORD, NEVER OFF THE WRAPPER. `Claimable` is built field by field by `wrapFreight`,
     * and the first version of this asked it for `bonded` — a field that copy did not carry, so the gate
     * was dead and every test still passed. The freight itself cannot forget to copy something to itself.
     */
    const freight = this.freights.get(load.ref);
    if (!freight) return undefined;
    const carrier = this.carrierDidOf(driverDid);
    return transitRefusal(freight, (country) => this.transit?.permits(carrier, country) ?? false);
  }

  /** CA6 — asked again at every point a load is taken, because coupling (and so the vehicle's country) can change. */
  private requireBorderAllows(vehicle: Vehicle, driverDid: string, kind: ClaimableKind, ref: string): void {
    if (kind !== 'freight') return;
    const load = this.wrapFreight(this.requireFreight(ref));
    // BL1 first: it is the more specific refusal, and hearing "you need a transit authority" is more use
    // than hearing about cabotage on a leg that never leaves the country.
    const bond = this.bondRefusal(driverDid, load);
    if (bond) throw new GlosError('FORBIDDEN', bond.message);
    const refusal = this.borderRefusals(vehicle, driverDid, load)[0];
    if (refusal) throw new GlosError('FORBIDDEN', refusal.message);
  }

  /** CA6 — for a load that crosses a border: where it may cross, when, what to carry, and the limits. */
  private borderAdviceFor(load: Claimable): BorderAdvice | undefined {
    if (!this.borders || load.kind !== 'freight' || !load.pickupCountry || !load.destCountry || load.pickupCountry === load.destCountry) return undefined;
    return this.borders.adviceFor(load.pickupCountry, load.destCountry);
  }

  private vehicleCanCarry(vehicle: Vehicle, load: Claimable, remainingKg: number, remainingTotes = Number.POSITIVE_INFINITY): boolean {
    if (load.weightKg > remainingKg) return false;
    if (load.weightKg > vehicle.capacityKg) return false;
    // A bag needs a bag space, not just kilos — otherwise the offer list keeps offering bags to a full boot.
    if (load.kind === 'tote' && remainingTotes < 1) return false;
    if (load.fragile && !vehicle.allowsFragile) return false;
    if (load.bulk && !vehicle.carriesBulk) return false;
    // S31: the vehicle must satisfy EVERY capability the load's cargo requires (perishable → cold chain,
    // hazardous → hazmat — a load needing both needs both).
    if ((load.requiredCapabilities ?? []).some((cap) => !vehicle[cap])) return false;
    // S32: and it must carry AT LEAST ONE piece of qualifying load/unload equipment (requiredEquipment is an
    // any-of set — a P4 load can be handled by a hand-truck OR a pallet-jack OR a tail-lift OR a ramp).
    if (!DispatchService.hasEquipmentFor(vehicle, load.requiredEquipment)) return false;
    return true;
  }

  /** Does the vehicle carry at least one piece of the equipment a load requires? An empty requirement (bulk /
   *  light cargo) is always satisfied. requiredEquipment is ANY-OF, so one qualifying piece is enough. */
  private static hasEquipmentFor(vehicle: Vehicle, required?: Equipment[]): boolean {
    if (!required || required.length === 0) return true;
    const have = vehicle.equipment ?? [];
    return required.some((eq) => have.includes(eq));
  }

  /** Everything a claimable's cargo requires of a vehicle (tote via its parcels; freight from its record) —
   *  capabilities, equipment, AND the bulk/fragile flags. Used by claim() to re-check the driver's CURRENT
   *  vehicle (coupling is re-assignable), so it mirrors EVERY axis vehicleCanCarry filters on. */
  private loadRequirements(kind: ClaimableKind, ref: string): { capabilities: VehicleCapability[]; equipment: Equipment[]; bulk: boolean; fragile: boolean } {
    if (kind === 'tote') {
      const t = this.totes.byCodeMaybe(ref);
      return { capabilities: t ? this.mdps.toteRequiredCapabilities(t) : [], equipment: [], bulk: false, fragile: false };
    }
    const f = this.freights.get(ref);
    return { capabilities: f?.requiredCapabilities ?? [], equipment: f?.requiredEquipment ?? [], bulk: f?.bulk ?? false, fragile: f?.fragile ?? false };
  }

  /** Resolve a tote's locationId (an MDP id or an agent DID) → its coordinates + display label. */
  /**
   * Where a bag is standing, and what a driver should be told it is called.
   *
   * The one place that knows what a load's `locationId` can BE. It was a PUDO or a hub; a vendor's own dock
   * is the third kind, and adding it here is the whole of what "the network can collect from a warehouse"
   * required — everything downstream (the offer, the price, the notification) reads the pickup through this.
   * Public because the notification rules need the same answer, and two copies of this question would drift.
   */
  pickupPlace(locationId: string): { loc: { lat: number; lng: number }; label: string } | null {
    const mdp = this.mdps.list().find((m) => m.mdpId === locationId);
    if (mdp) return { loc: mdp.location, label: mdp.name };
    try {
      const a = this.agents.get(locationId);
      return { loc: a.location, label: a.shopName };
    } catch {
      /* not a PUDO — a vendor dock, or nowhere */
    }
    const vendor = this.vendors.byDid(locationId);
    if (vendor?.collection) return { loc: vendor.collection.location, label: vendor.collection.label };
    return null;
  }

  /**
   * Where a bag's DESTINATION is, on the ground.
   *
   * `destinationNodeId` is documented as "a PUDO did or an MDP id", and for a hub-sorted bag it is. But the
   * two bags that START a journey — a shop's and a vendor dock's — address themselves to a ZONE, which is a
   * name and not a place. So resolve a real node first, and fall back to the hub that SERVES that zone,
   * which is genuinely where such a bag is driven.
   *
   * Null when neither resolves. Nothing is invented — a zone centroid would be a number that looks like a
   * distance and is not one, and this figure is about to be paid to somebody.
   */
  private destinationPlace(tote: { destinationNodeId?: string }): { loc: { lat: number; lng: number }; label: string } | null {
    const id = tote.destinationNodeId;
    if (!id) return null;
    const node = this.pickupPlace(id); // a real node — an MDP, a shop, or a dock
    if (node) return node;
    const hub = this.mdps.mdpForZone(id); // …or the hub that serves the zone the bag names
    return hub ? { loc: hub.location, label: hub.name } : null;
  }

  /**
   * What the road on this bag is worth at a given per-km rate.
   *
   * ONE computation, used to SHOW the driver a number on the offer and to LOCK it at claim, because those
   * two must agree. A driver told one figure on a lock screen and paid another has been misled, and two
   * copies of this arithmetic is exactly how that happens.
   */
  private haulFor(code: string, ratePerKm: number): Omit<ToteHaul, 'lockedAt'> | null {
    const tote = this.totes.byCodeMaybe(code);
    if (!tote) return null;
    const from = this.pickupPlace(tote.locationId);
    const to = this.destinationPlace(tote);
    const resolved = Boolean(from && to);
    const haul = computeToteHaul({ ratePerKm, tripKm: resolved ? this.router.roadKm(from!.loc, to!.loc) : 0, units: tote.unitsUsed });
    return { ...haul, basis: resolved ? 'measured' : 'unresolved' };
  }

  /**
   * What this job pays the driver, all in — the number they are agreeing to when they tap Claim.
   *
   * Freight: the priced total. A bag: the handling fee for scanning it aboard PLUS the road. Before the road
   * existed, a bag's pay was a constant and every surface could hard-code it; now it varies with distance
   * and contents, so it has to be carried on the offer or the driver is consenting to a number nobody
   * showed them.
   */
  private expectedEarn(load: Claimable, price: PriceBreakdown | undefined, ratePerKm: number): number | undefined {
    if (load.kind === 'freight') return price?.total;
    const haul = this.haulFor(load.ref, ratePerKm);
    return haul ? Math.round((TOTE_LOAD_FEE + haul.road) * 100) / 100 : undefined;
  }

  /**
   * Price the road for a claimed bag and stamp it. See `ToteHaul` for why it is locked here.
   *
   * The rate is the CARRYING VEHICLE'S OWN advertised per-km — the same fuel-pump model the quote used to
   * price the parcels inside it, so the two sides are struck at one rate rather than two.
   */
  private lockToteHaul(code: string, vehicle: Vehicle): void {
    const haul = this.haulFor(code, this.pricingProfile(vehicle).ratePerKm);
    if (haul) this.totes.lockHaul(code, { ...haul, lockedAt: new Date().toISOString() });
  }

  /**
   * The two figures a driver actually decides on: the extra minutes to COLLECT a load, and the extra
   * minutes that DELIVERING it then costs on top.
   *
   * Measured against the road they declared, so both are genuinely additional:
   *
   *   collect = (here→pickup) + (pickup→road end) − (here→road end)
   *   deliver = (pickup→drop) + (drop→road end) − (pickup→road end)
   *
   * The two sum to the whole diversion, and splitting them is what makes the offer honest. `detourKm` has
   * always treated a load as a single via-point, which silently priced the DESTINATION at zero: a pickup
   * next door whose drop is an hour the wrong way reported a two-kilometre detour. The first line above is
   * that same old figure; the second is the part that was missing.
   *
   * With no declared road (`to` absent — a rider working a patch, where there is no "on the way") there is
   * nothing for the time to be extra TO, so each leg reports its plain travel time. That is the honest
   * reading rather than a special case: with no plan, all of it is extra.
   *
   * At the vehicle's own speed, because a bike and a truck do not spend the same minutes on the same road.
   */
  private timeCost(
    vehicle: Vehicle,
    route: { from: GeoPoint; to?: GeoPoint },
    load: Claimable,
  ): { collectMin: number; deliverMin?: number } {
    const speed = VEHICLE_SPEED_KMH[vehicle.vehicleClass === 'truck' ? 'truck' : 'bus'];
    const eta = (a: GeoPoint, b: GeoPoint) => this.router.etaMinutes(a, b, speed);
    const drop = load.destLocation;
    const end = route.to;
    if (!end) {
      return { collectMin: eta(route.from, load.pickupLocation), deliverMin: drop ? eta(load.pickupLocation, drop) : undefined };
    }
    const collect = Math.max(0, eta(route.from, load.pickupLocation) + eta(load.pickupLocation, end) - eta(route.from, end));
    if (!drop) return { collectMin: collect };
    const deliver = Math.max(0, eta(load.pickupLocation, drop) + eta(drop, end) - eta(load.pickupLocation, end));
    return { collectMin: collect, deliverMin: deliver };
  }

  private minutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    return this.router.etaMinutes(a, b, VEHICLE_SPEED_KMH.bus);
  }

  private requireOffer(offerId: string): Offer {
    const o = this.offers.get(offerId);
    if (!o) throw new GlosError('NOT_FOUND', `Offer not found: ${offerId}`);
    return o;
  }

  private requireFreight(freightId: string): Freight {
    const f = this.freights.get(freightId);
    if (!f) throw new GlosError('NOT_FOUND', `Freight not found: ${freightId}`);
    return f;
  }
}
