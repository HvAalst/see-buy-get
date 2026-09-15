import type { BorderAdviceView } from './border';
/**
 * Local view types for the driver app.
 *
 * Six of the responses this app depends on are `Record<string, never>` in the generated
 * `schema.d.ts` (session, claims, suggest-work, pricing/near, mdps, agents, totes/load) —
 * the backend returns them untyped, so `Result<T>` gives no field safety at all. The enum
 * fields on the ones that ARE typed (`status`, `vehicleClass`, `kind`) are erased the same
 * way. So the boundary is declared here, once, and everything downstream is honestly typed.
 *
 * `narrow()` in api.ts is the single sanctioned place these casts happen.
 */

export type DriverStatus = 'DRAFT' | 'KYC_PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface DriverRecord {
  driverId: string;
  did: string;
  displayName: string;
  badgeId?: string;
  status: DriverStatus;
  assignedVehicleId?: string;
  homeZone?: string;
  licence?: { classes?: string[]; number?: string; expiresAt?: string };
  // REP4 — the driver's own rating + whether it has fallen below the network floor (freight is then paused
  // until it recovers). So the app can explain WHY the freight marketplace went quiet.
  rating?: { average: number; count: number; isNew?: boolean } | null;
  freightPaused?: boolean;
  /** FP4 — the licence's state today, and why no shift can start (the server's words) when it has lapsed. */
  papers?: Array<{ kind: 'insurance' | 'inspection' | 'licence'; state: 'ok' | 'due' | 'lapsed' | 'none'; expiresAt?: string; daysLeft?: number }>;
  offRoad?: string[];
}

/** R5 — one row of the driver jobs + earnings register (a claimed freight haul). No buyer identity. */
export interface DriverJobRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  status: 'available' | 'claimed' | 'in_transit' | 'delivered' | string;
  cargoClass: string;
  weightKg: number;
  earning?: number;
  paid: boolean;
  claimedAt?: string;
  deliveredAt?: string;
  createdAt: string;
}

/** R5 — the earnings register's running totals for the current filtered view. */
export interface DriverJobsSummary {
  earned: number;
  /** BOOKED, not paid. Set when a load is delivered and the network accrues what it owes — it has never
   *  meant money reached anybody, and since settlement shipped that difference is real. */
  paid: number;
  unpaid: number;
  delivered: number;
  count: number;
  /**
   * What has actually LEFT, and who it goes to.
   *
   * A separate question from the numbers above, kept separate on the screen too: merging them is how "we
   * owe you this" came to be displayed as "you have been paid". `paidToMe` is false for a fleet driver,
   * whose earnings are real and theirs to read but whose payment is their employer's to receive.
   * Absent on an older backend.
   */
  settlement?: { payeeDid: string; paidToMe: boolean; settled: number; inFlight: number; currency?: string };
}

export interface VehicleView {
  vehicleId: string;
  qr: string;
  plate: string;
  vehicleClass: string;
  truckSubtype?: string;
  capacityKg: number;
  pricePerKm: number;
  maxParcelKg: number;
  allowsFragile: boolean;
  coldChain: boolean;
  carriesBulk: boolean;
  verified: boolean;
  status: string;
}

/** GET /sbg/geocode — a typed place resolved to a point, with how sure the gazetteer is of it. */
export interface GeocodeResult {
  location: { lat: number; lng: number };
  confidence: 'exact' | 'approx' | 'fallback';
  matched?: string;
}

/** A vehicle this driver has driven before — the morning "which one today?" list. */
export interface RecentVehicleView {
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  truckSubtype?: string;
  capacityKg: number;
  verified: boolean;
  /** Someone else is on shift with it right now. Shown and blocked, never hidden. */
  busy: boolean;
  /** FP4 — the papers that have lapsed, in words. Non-empty: listed, marked, and refused at the coupling. */
  offRoad?: string[];
}

/**
 * The road the driver said this shift is running. It is what "a load near you" is matched against: without
 * it the network can only see how NEAR a driver is, and pings one heading north about a bag going south.
 */
export interface DeclaredLegView {
  kind?: 'leg';
  fromLabel: string;
  from: { lat: number; lng: number };
  toLabel: string;
  to: { lat: number; lng: number };
  declaredAt: string;
  /** Who decided this road. 'derived' means WE worked it out from a load the driver took — which the screen
   *  has to say out loud, because presenting our inference as their decision is a lie about who chose. */
  source?: 'declared' | 'derived';
}

export interface AssignmentView {
  assignmentId: string;
  vehicleId: string;
  corridorId?: string;
  /** A road or a patch — whichever this driver declared for the shift. */
  work?: DeclaredLegView | { kind: 'area'; radiusKm: number; declaredAt: string };
  /** New offers are held until this instant. Absent = taking work. */
  snoozedUntil?: string;
  /** The driver has switched off the road we work out from the loads they take. One decision, held for
   *  the shift — so turning it off is a switch rather than an argument with the next claim. */
  derivedLegOff?: boolean;
  startedAt: string;
}

export interface SessionView {
  active: boolean;
  assignment?: AssignmentView;
  vehicle?: VehicleView;
  /**
   * WHY today was quiet, split by the two causes a driver can act on.
   *
   * Silence has three explanations needing three different answers — there was no work, your own floor
   * stopped it, or shippers would not pay what you charge — and two of those the network knew all along
   * and never said. The counts travel with the settings on purpose: a control that silences a phone
   * without saying so is how somebody hears nothing for a week and blames us.
   *
   * `rateLooksHigh` is the network's own thickness test, not a judgement: one load refused on price says
   * nothing. `rateIsYours` is false for a fleet driver, whose vehicle — and so whose rate — is the
   * manager's. Absent on an older backend.
   */
  quiet?: {
    floor?: number;
    belowFloor: number;
    overBudget: number;
    ratePerKm?: number;
    rateIsYours: boolean;
    rateLooksHigh: boolean;
  };
}

export type ClaimKind = 'tote' | 'freight';

/** S33 — one confirmable safety-checklist line (mirrors the backend heavy-cargo SafetyItem). */
export interface SafetyItem {
  key: string;
  label: string;
}

/** S34 — the transparent price breakdown behind a freight offer/claim (B + D·R·M). */
export interface PriceBreakdown {
  baseFee: number;
  distanceKm: number;
  /** FB0a — the two halves of distanceKm. Absent on a price locked before the split existed; show nothing
   *  rather than deriving one, since any derivation would invent the figure the driver is judging the job on. */
  deadheadKm?: number;
  loadedKm?: number;
  ratePerKm: number;
  multiplier: number;
  effectiveRate: number;
  total: number;
}

export interface Claimable {
  kind: ClaimKind;
  ref: string; // the API id used for pickup/load/deliver
  code?: string; // S32b — the human reference to show (TOTE-042 / FRT-007); ref for freight is an opaque id
  pickupLocation?: { lat: number; lng: number };
  pickupLabel: string;
  destLabel: string;
  weightKg: number;
  fragile?: boolean;
  bulk?: boolean;
  status?: string; // S32b — freight status (claimed | in_transit | …) drives the pickup/deliver control
  lockedPrice?: number; // S34 — the driver's agreed earning on a claimed freight (locked at claim)
  priceBreakdown?: PriceBreakdown; // S34 — the breakdown behind lockedPrice
  cargoClass?: string; // S33 — P4/P5/P6 (heavy badge)
  natureCode?: string; // S33 — the commodity nature (GEN…HUM)
  loadChecklist?: SafetyItem[]; // S33 — the load-safety items to confirm at pickup
  unloadChecklist?: SafetyItem[]; // S33 — the unload items to confirm at delivery
  tempBand?: { minC: number; maxC: number }; // S33b — the safe band to keep (present ⇒ cold-chain, show the log control)
  lastTempC?: number; // S33b — the last logged reading
  tempBreached?: boolean; // S33b — the chain has been broken
  /** FP5 — put on this driver by their fleet office, so the app can say it was the office's call, and whose. */
  assignedBy?: { name?: string; at: string };
  /** FP7 — the sender's instructions for the door, with a contact to dial. Only the driver holding the load has them. */
  instructions?: InstructionsView;
}

/**
 * FB1 — what kind of "no" a board row carries. The screen groups and colours by this, never by the message.
 *
 * 'unknown' is not a refusal: it is the system saying it could not check something (bridge clearances, axle
 * limits — no data exists) rather than pretending it did. A row whose only marks are 'unknown' is still
 * takeable, because deciding otherwise would be the platform overruling the operator who drives the road.
 */
import type { InstructionsView } from '../../shared/instructions';
export type { BlockerKind, BoardBlocker } from '../../shared/board';
import type { BoardBlocker } from '../../shared/board';

/** FB1 — one load on the open board: the market's facts, this vehicle's price, and every reason why not. */
export interface BoardRow {
  freightId: string;
  code: string;
  description: string;
  pickupLabel: string;
  pickupLocation?: { lat: number; lng: number };
  destLabel: string;
  weightKg: number;
  cargoClass?: string;
  natureCode?: string;
  dimensionsCm?: number[];
  indivisible?: boolean;
  bodyDerived?: { body: string; basis: 'measured' | 'weight-only' };
  bodyHint?: string;
  commitMode: 'instant' | 'negotiate';
  scheduledPickupAt?: string;
  deadheadKm: number;
  loadedKm: number;
  totalKm: number;
  price?: PriceBreakdown;
  /** Earnings per TOTAL km, empty run included. Null when there is no vehicle to price against. */
  earningsPerKm?: number | null;
  canTake: boolean;
  blockers: BoardBlocker[];
}

export interface ClaimsView {
  remainingCapacityKg: number;
  /** Bag spaces left in the hold — the capacity kilos cannot express (a bus's boot, not its scales). */
  remainingTotes?: number;
  claims: Claimable[];
}

export interface Benchmark {
  count: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
}

export interface RatesView {
  benchmark?: Benchmark;
  pins: unknown[];
}

export interface OfferView {
  offerId: string;
  kind: ClaimKind;
  ref: string;
  pickupLabel: string;
  pickupLocation?: { lat: number; lng: number };
  destLabel: string;
  /** Where it is going, as a place. A bag used to carry only a name here, so a driver could be navigated to
   *  the pickup and then left to work out the rest. Absent when the destination cannot be resolved. */
  destLocation?: { lat: number; lng: number };
  weightKg: number;
  detourKm: number;
  minutesAway: number;
  /** What the job costs in MINUTES — extra time to go and collect it, and the extra that carrying it then
   *  costs on top. The unit a driver actually spends, and the only one they can explain to a vehicle full
   *  of passengers. `deliverMin` is absent when the destination could not be placed. */
  collectMin?: number;
  deliverMin?: number;
  /** Server-composed sentence — already plain language, show it verbatim. */
  message: string;
  /** S34 — the freight offer's price + transparent breakdown (absent on a bag offer, which has no B + D·R·M). */
  price?: PriceBreakdown;
  /** What this job pays, all in — for BOTH kinds. Freight: the same as `price.total`. A bag: the handling
   *  fee plus the road. Read this for the headline figure; `price` is only the freight breakdown behind it. */
  earn?: number;
  /** BAGS ONLY — what that earning is made of, and what separates a bag worth a whole slot in the hold
   *  from one worth a fifth of it. */
  parcels?: number;
  fillPct?: number;
  /** CA6 — for a load that crosses a border: where to cross, what to carry, the limit. */
  border?: BorderAdviceView;
  createdAt: string;
  expiresAt: string;
  status: string;
}

/**
 * F3 — a load that is COMING but cannot be taken yet: a consolidation lot still filling at a co-op.
 *
 * Advisory only. It carries no offerId and no ref, on purpose: there is nothing to claim, and the shape
 * says so rather than relying on the screen to remember. A driver reads it to plan a return leg.
 */
export interface ExpectedLoadView {
  kind: 'consignment';
  code: string;
  natureCode: string;
  pickupLabel: string;
  pickupLocation?: { lat: number; lng: number };
  destLabel: string;
  weightKg: number;
  targetKg: number;
  fillPct: number;
  detourKm: number;
  minutesAway: number;
  /** The LATEST it goes to the marketplace — sooner if it fills first. */
  readyBy: string;
}

export interface SuggestView {
  remainingCapacityKg: number;
  /** Bag spaces left in the hold, alongside the kilos. */
  remainingTotes?: number;
  offers: OfferView[];
  /** F3 — lots filling along this route: nothing to claim, everything to plan around. */
  expected?: ExpectedLoadView[];
  /** REP4 — the live freight-bar verdict for this driver, so the pause note stays in sync with the offers. */
  freightPaused?: boolean;
}

export interface LoadBagView {
  moved: string[];
}

export interface MdpRow {
  mdpId: string;
  name: string;
  location: { lat: number; lng: number };
}

export interface AgentRow {
  did: string;
  shopName: string;
  location?: { lat: number; lng: number };
}

/** A place the driver can name as the start or the end of a route. */
export interface NodeOption {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

/** Persisted per-DID so "repeat my route" never needs the node list back. */
export interface SavedRoute {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  fromLabel: string;
  toLabel: string;
}

/**
 * One thing drivers have reported on the road — the crowd-sourced constraint map, as a screen sees it.
 *
 * Mirrors the backend's ConstraintView exactly, identities and all: there are none. Who reported a bridge
 * never crosses the wire, so a screen can only ever show how MANY agree, never who.
 */
export interface RoadConstraint {
  constraintId: string;
  kind: string;
  at: { lat: number; lng: number };
  /** Metres for a height, kilograms for a limit. Absent where the kind has nothing to measure. */
  value?: number;
  note?: string;
  status: 'active' | 'disputed' | 'cleared';
  reportedAt: string;
  confirmations: number;
  refutations: number;
}
