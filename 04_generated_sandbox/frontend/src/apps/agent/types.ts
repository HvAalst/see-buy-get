/**
 * Local view types for the agent app.
 *
 * The generated schema leaves most sbg responses untyped (`Record<string, never>`) and
 * erases the enum fields on the rest, so — exactly as in the driver app — the boundary is
 * declared here once and `narrow()` in api.ts is the single sanctioned place the casts
 * happen. Field names mirror backend/src/modules/pudo/pudo.types.ts.
 */

import type { GiveBackReason } from '../../shared/giveBack';
import type { RunCancelReason } from '../../shared/runCancel';

export type AgentStatus = 'DRAFT' | 'KYC_PENDING' | 'APPROVED_UNFUNDED' | 'ACTIVE' | 'LOCKED';
export type OpenState = 'open' | 'closed';
export type ParcelSize = 'S' | 'M' | 'L' | 'HEAVY';
export type ParcelStatus =
  | 'Created'
  | 'At_PUDO'
  | 'On_Bus'
  | 'At_MDP'
  | 'Ready_For_Pickup'
  // The free window has run out. STILL COLLECTABLE — this changes the terms, never the door.
  | 'Unclaimed'
  | 'Delivered'
  | 'Disputed'
  | 'Voided';

/** One bag's worth of work: the waiting parcels that share a NEXT HOP, and the open bag for it if any. */
export interface BagGroup {
  key: string; // the next hop — an MDP id, or a zone where the route runs direct
  label: string;
  via: 'direct' | 'hub';
  parcelIds: string[];
  openBagCode?: string;
}

/** How much floor room the shop has for outbound bags, and how much of it is taken right now. */
export interface BagStaging {
  capacity: number;
  used: number;
  free: number;
}

/** A bag already open on the shop's floor. */
export interface OpenBag {
  code: string;
  destinationLabel?: string;
  /** What is actually in it — a bag is filled across a working day, so re-opening one must restore it. */
  parcelIds: string[];
  parcels: number;
  fillPct: number;
  status: string;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}
/** Weekly opening schedule. A missing/null day means closed that day. */
export type WeeklyHours = Partial<Record<Weekday, DayHours | null>>;

export interface AgentView {
  agentId: string;
  did: string;
  shopName: string;
  zone: string;
  /** The country the shop stands in (absent on a record written before sites had one — the home country). */
  country?: string;
  location?: { lat: number; lng: number };
  landmark?: string;
  openState: OpenState;
  pricePerParcel: number;
  status: AgentStatus;
  openingHours?: WeeklyHours;
  shopfrontMediaId?: string; // the shop-front photo (owner-gated media)
  /** Floor room for outbound bags. Absent until the shop says — the plan's `staging.capacity` is the answer. */
  bagBays?: number;
  /** Merged in by the controller alongside the record. NULL where we hold no money for this shop at all —
   *  a different fact from an empty float, and never to be shown as 0.00. */
  balance: number | null;
  rating?: { count: number; average: number; isNew?: boolean } | null;
}

/** One pickup-shelf slot: a colour column + numbered row (e.g. "Green-3"). A normal slot holds one parcel; a
 *  consolidation ("bundle") slot pools multiple small ones. */
export interface ShelfSlotView {
  label: string;
  color: string;
  row: number;
  col: number;
  occupiedBy?: string; // a normal slot's single parcel
  consolidation?: boolean; // a bundle slot
  items?: string[]; // a bundle slot's pooled parcels
  maxItems?: number; // a bundle slot's capacity
}

/** GET /agents/{did}/shelf — the whole slot grid + capacity + the live free-slot count. */
export interface ShelfGrid {
  grid: ShelfSlotView[];
  capacity: number;
  available: number;
}

/** GET /agents/{did}/can-transact — the 'no money, no scan' gate as readable state. */
export interface GateView {
  ok: boolean;
  canTransact?: boolean;
  code?: 'WALLET_INSUFFICIENT' | 'AGENT_LOCKED' | 'ID_HELD' | string;
  balance: number;
  shortfall?: number;
}

/**
 * A top-up the shop has asked for and is waiting on.
 *
 * It is a REQUEST, not a movement: `reference` is what the shopkeeper quotes when they pay, and the float
 * only changes when the payment provider confirms the payment. See `foundation/funding` on the server.
 */
export interface FundingView {
  fundingId: string;
  amount: number;
  currency: string;
  status: 'awaiting' | 'confirmed' | 'failed' | 'expired' | 'reversed';
  /** What the payer quotes. Short and unambiguous on purpose — it is read off one screen, typed into another. */
  reference: string;
  /** The provider's own words about how to pay. Shown verbatim so this screen cannot drift from the rail. */
  instructions: string;
  /**
   * WHETHER A PROMPT WENT TO A PHONE, or whether this payer pays the long way round.
   *
   * The two faces of the waiting screen turn on it. True and the shopkeeper is watching a handset for an
   * M-Pesa PIN request; false and they are reading a reference off this screen to type at a kiosk. A
   * screen that guessed wrong would leave somebody staring at a phone that is never going to ring.
   */
  pushed?: boolean;
  /** The provider's handle for that prompt — quoted to support when no prompt ever came. */
  railRef?: string;
  /** Why it will not be paid, in the provider's own words ("Request cancelled by user"). */
  failureReason?: string;
  openedAt: string;
  confirmedAmount?: number;
  confirmedAt?: string;
}

export interface CorridorRow {
  corridorId: string;
  name: string;
  originZone: string;
  destZone: string;
  status: string;
}

export interface ParcelView {
  parcelId: string;
  size: ParcelSize;
  status: ParcelStatus;
  destZone: string;
  destAgentDid?: string;
  senderMobile?: string;
  receiverMobile?: string;
  binSlot?: string;
  toteId?: string;
  items?: Array<{ name: string; qty: number }>;
  collectionCode?: string;
  /** ISO time the parcel was accepted — drives the 5-minute void window countdown. */
  acceptedAt?: string;
  /** ISO time it reached this shop's shelf and became collectable. */
  readyAt?: string;
  /**
   * Waiting to be collected for longer than it should be.
   *
   * DERIVED ON THE SERVER, where the threshold lives — a shopkeeper's screen and an operator's flag
   * disagreeing about what "overdue" means is the kind of thing nobody notices until two people are
   * arguing across a counter about whose number is right. Absent unless it is true.
   */
  overdue?: boolean;
}

/** A destination PUDO the counter can pick from the public directory (Map/Address intake picker). */
export interface NetworkPoint {
  did: string;
  shopName: string;
  zone: string;
  /** The country the shop stands in. A counter walk-up cannot cross a border, so the picker filters on it. */
  country?: string;
  location?: { lat: number; lng: number };
  landmark?: string;
  openState: 'open' | 'closed';
  pricePerParcel: number;
  rating?: { count: number; average: number; isNew?: boolean } | null;
  freeSlots?: number;
}

/** F3 — a consolidation lot the shop owns: durable dry commodity accumulating toward a truckload, posting
 *  as one bulk freight when full or aged. */
export interface ConsignmentView {
  consignmentId: string;
  code: string;
  status: 'open' | 'posted';
  ownerDid: string;
  natureCode: string;
  pickupLabel: string;
  destLabel: string;
  targetKg: number;
  weightKg: number;
  deposits: Array<{ memberRef: string; weightKg: number; at: string }>;
  maxSpend?: number;
  openedAt: string;
  postedAt?: string;
  freightId?: string;
}

/** GET /sbg/geocode — a typed area/place resolved to a point (the Address intake mode). */
export interface GeocodeView {
  location: { lat: number; lng: number };
  confidence: 'exact' | 'approx' | 'fallback';
  matched?: string;
}

/** POST /sbg/size/classify — the derived tier + cargo class for measured dims (shown live at the counter). */
export interface ClassifyView {
  size: ParcelSize;
  cargoClass: string;
  dedicated: boolean;
}

/** PG4 — what the counter learns about a scanned sticker BEFORE confirming (GET parcels/:id/intake-preview). */
export interface IntakePreview {
  parcelId: string;
  kind: 'peer_send' | 'vendor_order' | 'walk_up';
  status: ParcelStatus;
  intakeReady: boolean;
  size: ParcelSize;
  weightKg: number;
  fragile: boolean;
  destZone: string;
  destShopName?: string;
  /** The locked price the shop collects in cash — 0 for a prepaid store order. */
  cashDue: number;
  /** P3 — whose promise, who answers, and this parcel's own cover. */
  terms?: TakeInTerms;
}

/**
 * P3 — WHAT THE COUNTER SAYS OUT LOUD before goods are accepted. The server computes it from the same
 * presence its refusal uses, so the screen repeats it rather than working it out again.
 */
export interface TakeInTerms {
  promise: 'ours' | 'theirs' | 'none';
  jurisdiction: string;
  level: string;
  answeredBy?: string;
  coverLimit: number;
  coverBasis: 'declared' | 'free-limit' | 'no-stated-limit' | 'none';
  currency: string;
  cashAccepted: boolean;
  /** P4 — false where the promise is ours but this country cannot be paid out in: owed, not paid. */
  paidOut: boolean;
}

export interface HandoverView {
  handed: string[];
  vehicle?: string;
  /** S25 completeness gate: every parcel that belonged on this bus, and any knowingly left behind. */
  expected?: string[];
  missed?: string[];
  shortShipped?: boolean;
  /** REP2 — the fleet driver who took the batch, so the shop can rate them for this leg (absent for a legacy driver). */
  driverDid?: string;
}

export interface CollectView {
  parcel: ParcelView;
  binSlot?: string;
  /**
   * What the customer owes for the days this parcel sat past its free window — absent when nothing does.
   *
   * On the LOOKUP rather than the release, deliberately. A shopkeeper who discovers a charge after the
   * box has changed hands has to ask for money back, which is the one conversation across a counter that
   * nobody wins.
   */
  holdingOwed?: number;
}

export interface ReceiveBagView {
  delivered: string[];
  /** REP2 — the driver who carried the bag here, so the receiving shop can rate the arrival. */
  driverDid?: string;
}

/** REP2 — a provider's public reputation profile (a driver or an agent): PII-free name + aggregate rating. */
export interface ReputationProfileView {
  did: string;
  kind: 'agent' | 'driver';
  name: string;
  zone?: string;
  rating: { average: number; count: number; isNew?: boolean };
  since?: string;
}

export interface Benchmark {
  count: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
}

export interface RatePin {
  id: string;
  label: string;
  price: number;
  km?: number;
  location?: { lat: number; lng: number };
}

export interface RatesView {
  benchmark?: Benchmark;
  pins: RatePin[];
  radiusKm?: number;
}

/* ------------------------------------------------------------- registers (R4) -- */

/** One row of the shop's parcel-history register — the shop's OWN handling, no buyer PII, no collection code. */
export interface AgentParcelRow {
  parcelId: string;
  did?: string;
  status: ParcelStatus;
  role: 'origin' | 'dest'; // took it in (drop-off) vs handed it out (collection)
  originZone: string;
  destZone: string;
  size: ParcelSize;
  trackingKey?: string;
  createdAt: string;
}

/** One row of the shop's earnings ledger. */
export interface AgentLedgerRow {
  id: string;
  type: 'TOP_UP' | 'FEE' | 'LABOR_PAYOUT' | 'REFUND' | string;
  sign: '+' | '-';
  amount: number;
  reference: string;
  refType?: string;
  at: string;
}

/** The earnings register's running totals for the CURRENT filtered view, plus the always-current wallet balance. */
export interface LedgerSummary {
  in: number;
  out: number;
  net: number;
  count: number;
  balance: number;
}

/* ------------------------------------ F3: space on a run that is already going -- */

/** A departure as a SHIPPER reads it: where it goes, what it costs, and what is left. */
export interface OfferRow {
  departureId: string;
  lineName: string;
  company: string;
  originZone: string;
  destZone: string;
  leavesAt: string;
  rate: { basis: string; amount: number; currency: string; minCharge?: number };
  /** What the carrier charges for being kept standing. Absent means it does not charge. */
  waiting?: { freeMin: number; perHour: number };
  /** How the shipper pays them — directly, and never through us. Absent means the fleet has not said. */
  settle?: { method: string; when: string };
  /** What kind of vehicle it is going on. Not the plate: that is the fleet's own business. */
  vehicleClass?: string;
  /** What the CARRIER insures, or plainly none. Never ours, and absent means they have not said. */
  cover?: { limit: number; policy?: string };
  /** What the vehicle can handle — so a shipper knows before typing whether their load can go on it. */
  handles?: string[];
  km?: number;
  note?: string;
  remainingKg: number;
  remainingM3?: number;
  /** How many are already aboard — a run nobody has taken and a nearly-full one are different offers. */
  booked: number;
}

/** What a load would cost on a run, before anything is taken. */
export interface OfferQuote {
  price: number;
  units: number;
  /** Which axis this load actually fills: a pallet of foam binds on space, steel on weight. */
  binds: 'weight' | 'space';
  currency: string;
  waiting?: { freeMin: number; perHour: number };
}

/* ------------------------------------------------------------- F3: what I booked --
   The read the shipper's side shipped without: a shop took space, saw a toast, and the booking left
   their world. No time, no company, no way to give it back, and no way to learn it had been called off. */

export interface MyBookingRow {
  bookingId: string;
  departureId: string;
  company: string;
  lineName: string;
  originZone: string;
  destZone: string;
  leavesAt: string;
  description: string;
  /** What the goods are, in the same vocabulary the counter uses. */
  nature: string;
  /** What the shipper said they are worth. Never verified, never a promise of ours. */
  declaredValue?: number;
  weightKg: number;
  volumeM3?: number;
  price: number;
  currency: string;
  cover?: { limit: number; policy?: string };
  /** The proof the carrier recorded at the door — the shipper is the party it exists for. */
  pod?: { receiverName: string; photoRef: string; remarks?: string; at: string };
  /** What they said went wrong, and what the carrier said back. Never decided by us. */
  claim?: { kind: string; description: string; photoRef?: string; amount?: number; raisedAt: string; answer?: 'accepted' | 'refused'; answerNote?: string; answeredAt?: string };
  /** Whether there is still something, and still time, to claim about. */
  claimable?: boolean;
  bookingStatus: 'booked' | 'delivered' | 'cancelled';
  /** WHO gave it back, and the carrier's reason. Absent on a booking given back before this was kept. */
  cancellation?: { by: 'shipper' | 'carrier'; reason?: GiveBackReason; note?: string; at: string };
  /** The RUN's state, which is a different fact: goods given back and goods stranded are not the same. */
  runStatus: 'open' | 'closed' | 'departed' | 'cancelled';
  cancelledReason?: string;
  /** Why the RUN was called off, coded — and how many other runs on the route are open, when that helps. */
  runCancellation?: { reason: RunCancelReason; note?: string; at: string; constraintId?: string };
  alternatives?: number;
  deliveredAt?: string;
  receivedBy?: string;
  waiting?: { freeMin: number; perHour: number };
  /** How they pay the carrier. Absent means the fleet has not said — never that we are handling it. */
  settle?: { method: string; when: string };
  /** Their own standing time only — never another shipper's on the same truck. */
  waits: Array<{ where: 'loading' | 'delivery'; arrivedAt: string; freeAt?: string; waitedMin: number; billableMin: number; amount: number; bearer: 'shipper' | 'consignee'; waivedReason?: string }>;
  cancellable: boolean;
  at: string;
  /** The public tracking link for these goods — the same page a load's link opens. Absent on bookings made before. */
  trackingKey?: string;
  trackingUrl?: string;
}
