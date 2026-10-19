import type { BorderAdviceView } from './border';
import type { PassageForDriver } from './passage';
import type { SealToFind } from '../../shared/seals';
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
  /** Present when a fleet employs them — whose office records their licence. Absent: they ride on their own. */
  managerDid?: string;
  /** The fleet's name, when a fleet employs them — what the account menu says they drive for. */
  fleetName?: string;
  /**
   * A fleet took them off and nobody has taken them on: they are between fleets, and cannot start a shift until a
   * fleet offers them a place. Who, when, and the reason the fleet gave.
   */
  /** `own`: they left by themselves. The other three are the fleet's words, from when its office took them off. */
  removedFrom?: { fleetDid: string; companyName: string; reason: 'left' | 'ended' | 'other' | 'own'; note?: string; at: string };
  /** Light is a bicycle or a motorcycle: cleared with no check, and so able to ride for themselves at once. */
  registry?: 'light' | 'heavy';
  /** FP4 — a renewed licence they sent, not yet checked. Its date is their reading and switches nothing on. */
  licenceRenewal?: { copyRef: string; expiresAt: string; number?: string; sentAt: string };
  /** Why the last card they sent was not accepted, so they can send a better one. */
  licenceRenewalRefusal?: { reason: string; at: string };
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
  /** The money `earning` is in, frozen when the price was locked. Absent on a haul locked before it was kept: that one
   *  is read in the money the session names. */
  currency?: string;
  paid: boolean;
  /** B2 — the shipper pays the carrier for this haul directly; nothing is owed by SeeBuyGet. */
  direct?: boolean;
  /** FP8 — what an upheld claim took back from that pay. The earning above is what was agreed; net is the difference. */
  clawback?: number;
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
   *
   * `standing` is where they stand TODAY: on their `own`, in a `fleet`, or in `none` — taken off a fleet or
   * left, and nobody's courier. The figures are only ever what reached this driver themselves, never a
   * fleet's. `payeeDid` is absent for somebody in no fleet: nobody is being paid for work done now.
   * Absent altogether on an older backend, as `standing` is on one a little newer.
   */
  settlement?: { payeeDid?: string; paidToMe: boolean; standing?: 'own' | 'fleet' | 'none'; settled: number; inFlight: number; currency?: string };
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
  /** The dashboard sticker, present only for a vehicle no fleet owns — see RecentVehicle on the server. */
  qr?: string;
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
  /** The money everything priced for this driver is in — board, offers, their loads, earnings: that of the company
   *  that pays them. Absent where no company of ours does (their price is then what they agree). Write money with
   *  `cash(…, session.currency)`. */
  currency?: string;
  /**
   * FP8 — the shift clock: hours on duty, the limit, whether it is passed (`near`: in its last hour), and the rest
   * owed after a working day (`restOwed`: this shift is one already, so ending it now owes the rest). Off duty and resting: `restUntil` is when the next shift can start, and
   * `tellWhenRested` that they asked to be told at that moment.
   */
  hours?: { onDuty: number; limit: number; over: boolean; near?: boolean; restOwed?: boolean; restHours: number; restUntil?: string; tellWhenRested?: boolean };
  /** What a counter scans to hand this driver parcels: their badge and this shift's code. Sent to the driver's own
   *  sign-in only, and only on shift — see `badgeToShow`. */
  handoverPass?: string;
  /** Round 11 — their fleet's own system is told where they are while on this shift, at most this often. Absent otherwise. */
  positionsToFleetSystem?: { fleetName: string; everyMin: number };
  /** Round 16 — their fleet's office is told if the vehicle stands in one place longer than this, away from any reason to. Absent when the fleet has it off. */
  standstillWatchMin?: number;
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
  /** Freight crossing a border whose shipper has not signed its commercial invoice: not to be taken over yet. */
  invoiceMissing?: boolean;
  /** Round 14 — on the road: what the driver may say of it (at a border post, cleared it, at a hub). */
  passage?: PassageForDriver;
  /** Round 15 — the seals to read off the door: what each is, never its number; a fingerprint to check a reading on the phone. */
  seals?: SealToFind[];
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
  /** Y2 — the container this load IS, where the load is a box rather than goods in one. */
  containerNo?: string;
  /** Y2 — an empty box going back to its depot: real work, no cargo, and it says so before you arrive. */
  emptyRun?: boolean;
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
  /** The money every figure in `benchmark` is in — the money this driver is paid in. Absent where no company of
   *  ours pays them, and then the benchmark is of nobody. */
  currency?: string;
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
  /**
   * What each side actually said, in order, with no identities — and what they photographed.
   *
   * The counts above say how many; this says what. It was already on the wire and the driver's app simply
   * did not declare it, which is the quiet half of this defect class: nothing errors, the screen just
   * shows a number where there is a photograph of the bridge.
   */
  accounts?: RoadAccount[];
}

/** One driver's account of a hazard. No author, ever: see the server's ConstraintAccountView. */
export interface RoadAccount {
  at: string;
  stance: 'there' | 'gone';
  note?: string;
  /** A media id. Fetchable by any signed-in driver now that the photo has been posted to the map. */
  photoRef?: string;
}

/* ------------------------------------------------------------ F3: the run --
   A scheduled departure the fleet has rostered this driver onto, and the clock at each gate. */

/** One stop's clock, as the driver recorded it. Both times are the SERVER's — see the persona. */
export interface WaitingRecordView {
  where: 'loading' | 'delivery';
  arrivedAt: string;
  /** Absent while the driver is still standing there. */
  freeAt?: string;
  waitedMin: number;
  /** Minutes past the free window — the only ones that cost anything. */
  billableMin: number;
  amount: number;
  /** Who it lands on: the shipper at the collection gate, the consignee at delivery. */
  bearer: 'shipper' | 'consignee';
  waivedReason?: string;
}

export interface DepartureBookingView {
  bookingId: string;
  description: string;
  weightKg: number;
  volumeM3?: number;
  /** `delivered` is the ending: the goods came off the truck and the driver said so. */
  status: 'booked' | 'delivered' | 'cancelled';
  /** What the goods are — it decides which load-safety items the checklist asks for. */
  nature?: string;
  /** The server’s OWN lists, in the server’s own words. Never a second list made on the phone. */
  checklists?: { load: SafetyItem[]; unload: SafetyItem[] };
  loadSafety?: { confirmed: string[]; securementPhotoRef?: string; at: string };
  deliveredAt?: string;
  receivedBy?: string;
  waiting: WaitingRecordView[];
}

export interface DepartureView {
  departureId: string;
  lineName: string;
  company: string;
  originZone: string;
  destZone: string;
  leavesAt: string;
  status: 'open' | 'closed' | 'departed' | 'cancelled';
  /** What the fleet charges for being kept waiting. Absent means it does not charge. */
  waiting?: { freeMin: number; perHour: number };
  rate: { basis: string; amount: number; currency: string; minCharge?: number };
  bookings: DepartureBookingView[];
}

/**
 * What riding for themselves would take, for a driver who is in no fleet: whether the app offers it, and the
 * server's sentence when it does not; what they are cleared to ride; and where a courier can register, with the
 * company of ours that would contract them there (none where the network only matches).
 */
export interface RideAloneTerms {
  offered: boolean;
  why?: string;
  classes: string[];
  countries: Array<{ jurisdiction: string; companyName?: string }>;
  /** Anything heavier than a motorcycle on their licence: an ask, with their ID and licence, that staff decide. */
  check?: boolean;
  /** An ask already with staff, and what it asked for. */
  waiting?: { country: string; vehicleClass: string; plate: string; askedAt: string };
  /** Why the last ask was refused, in staff's words. */
  refused?: { reason: string; at: string };
  /** A truck's possible bodies, when a truck is among what they may ride. */
  bodies?: Array<{ id: string; label: string }>;
}
