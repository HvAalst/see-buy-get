import type { ArrivalView, CrossingView, PassageView } from '../../shared/passages';

/**
 * Local view types for the Send app. All four surfaces this app touches are @Public
 * (S13): the network directory, the two quote endpoints and track-and-trace. Field names
 * mirror pudo.controller.ts (networkPoints), routing.service.ts (ShipmentQuote) and
 * parcel.service.ts (track).
 */

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
  | 'Voided'
  // Uncollected and on its way back to whoever sent it (the return is a parcel of its own).
  | 'Returned'
  // Declared lost by SeeBuyGet's staff after a search; it can be found again and carry on.
  | 'Lost';

/** One row of the public network directory — the sanitized slice a sender may see. */
export interface NetworkPoint {
  did: string;
  shopName: string;
  zone: string;
  /** ISO-3166 alpha-2 — where an address typed to find the nearest shops is looked for. */
  country?: string;
  location?: { lat: number; lng: number };
  landmark?: string;
  openState: 'open' | 'closed';
  /** False: no new parcel can name this shop. It still hands out what it holds, so it is on the map — and is not offered here. */
  takesNew?: boolean;
  pricePerParcel: number;
  /** The money its price is in: its company's. */
  currency?: string;
  // REP1 — the PII-free public reputation: the aggregate + a cold-start flag (a mean of one review is noise,
  // so below the backend's floor `isNew` is true and the UI shows "New" instead of a headline average).
  rating?: { count: number; average: number; isNew?: boolean } | null;
  freeSlots?: number;
  since?: string; // REP1 — "serving since" (the shop's onboarding date; a public trust signal, not PII)
}

export interface QuoteHop {
  type: 'pudo' | 'mdp';
  id: string;
  label: string;
}

export interface QuoteLegPrice {
  transport: number;
  base: number;
  /** The network's own price, NET of tax. Not what a person pays — see `gross`. */
  total: number;
  /** The tax on it. Zero wherever the selling sister has not been told to charge any, which is the
   *  default; a zero line is never rendered. */
  tax: number;
  /** What the sender actually hands over. `total + tax`, to the cent. */
  gross: number;
}

export interface QuoteView {
  /** The money the price is in: the selling company's. */
  currency?: string;
  hops: QuoteHop[];
  /** Whether the transport was priced on the box the sender MEASURED or on the tier it was declared as.
   *  Absent from a quote taken before this existed, which reads as the tier — the honest answer for it. */
  factorBasis?: 'measured' | 'band';
  nodes: Array<{ type: string; id: string; label: string; fee: number }>;
  legs: Array<{ from: string; to: string; km: number }>;
  totalKm: number;
  nodeFees: number;
  size: ParcelSize;
  /**
   * The per-km rates the road was priced from (2026-10-25): only vehicles that can carry this parcel, in the quote's
   * money. `from` says whose — the carriers near the asker, every carrier that can, or (none can yet) the country's
   * own road rate — `carriers` how many, and `nearWanted` that "near me" was asked and nobody near can carry it yet.
   * Absent `from` on a quote from before this, which reads as nothing to say.
   */
  perKm: { min: number; max: number; from?: 'near' | 'carriers' | 'company'; carriers?: number; nearWanted?: true };
  platformFeePct: number;
  /** The tax the selling sister charges, and the authority it collects under. The one part of a price
   *  breakdown that is nobody's secret — unlike the platform's three rate layers, which never leave the
   *  server at all. `ratePct` is 0 wherever no sister has been told to charge. */
  tax?: { ratePct: number; label: string; registration?: string };
  /** What the selling sister covers if it breaks this, and what it charges to cover more. Public for a
   *  reason: nobody can decide whether to declare a value without knowing what is already covered. */
  insurance?: { premiumPct: number; freeLimit: number };
  /** Any carrier takes it — priced at the top of the per-km market. */
  flexible: QuoteLegPrice;
  /** Waits for the cheapest carrier — priced at the bottom of the market. */
  locked: QuoteLegPrice;
}

export interface TrackStep {
  status: string;
  at: string;
  note?: string;
}

/**
 * FP6 — a LOAD behind a tracking key. Every consignment note has carried this link as a QR since FP2; until
 * now the page answered "no parcel" to it. The key names one thing: a freight answers with kind 'freight',
 * a parcel with none (the shape below, unchanged).
 */
export interface FreightTrackView {
  kind: 'freight';
  ref: string;
  status: 'scheduled' | 'available' | 'ordered' | 'claimed' | 'in_transit' | 'delivered' | 'refused' | 'cancelled';
  description: string;
  weightKg: number;
  pickupLabel: string;
  destLabel: string;
  destLocation?: { lat: number; lng: number };
  scheduledPickupAt?: string;
  carrier?: { name: string; driverName?: string; plate?: string; vehicleClass?: string };
  steps: TrackStep[];
  attempts?: Array<{ outcome: 'absent' | 'refused' | 'unreachable'; at: string }>;
  receiverName?: string;
  cancelled?: { at: string; by: 'sender' | 'network' | 'carrier' };
  /** Refused at the door (the user, 2026-10-27): when, and once decided, the load the goods went on — or that they were given up. */
  refused?: { at: string; choice?: 'back' | 'elsewhere' | 'give_up'; returnCode?: string; part?: { packages: number; of: number } };
  /** One load of an order its carrier brings in several — and all of them, each with where it has got to. */
  partOf?: { rootCode: string; no: number; of: number; orderKg: number };
  loads?: Array<{ no: number; code: string; weightKg: number; status: FreightTrackView['status'] }>;
  /** This load was put back together with the rest of its order: it is not coming on its own. */
  rejoined?: boolean;
  /** The day it was ordered for, while it is still to come — and, once it is on the road, about when its carrier's plan has it at the door. */
  expectedOn?: string;
  expectedAbout?: string;
  /** It is late on its carrier's own clock: the day it was expected has gone, or the hour above has passed. */
  late?: 'hour' | 'day';
  /** `run` — space booked on a carrier's scheduled run, which leaves at `scheduledPickupAt`. Absent: a load off the board. */
  on?: 'board' | 'run';
  /** Round 14 — what its driver said on the road: at a border post, cleared it, at a hub. Never who, never where the phone was. */
  /** Held on the way by an authority, as its driver said: since when — never by whom. */
  heldOnTheWay?: { since: string };
  passages?: PassageView[];
  /** Round 14 — across a border, on the road: where it has got to, the allowance and on what, when it is expected. */
  crossing?: CrossingView;
  /** Round 26 — in one country, on the road: when it is expected, and at what pace. Absent where the carrier's plan says the hour. */
  arrival?: ArrivalView;
  /** Round 15 — the seal numbers, to look at the door; and whether each is still on. */
  seals?: Array<{ number: string; state: 'on' | 'replaced' | 'broken' }>;
}

export type AnyTrackView = TrackView | FreightTrackView;

export function isFreightTrack(v: AnyTrackView): v is FreightTrackView {
  return (v as FreightTrackView).kind === 'freight';
}

export interface TrackView {
  kind?: 'parcel';
  ref: string;
  status: ParcelStatus;
  size: ParcelSize;
  destination: string;
  destZone: string;
  steps: TrackStep[];
  binSlot?: string;
  /** The collect card (rev 5): where the shop is, in words and as a pin. */
  destinationLandmark?: string;
  destinationLocation?: { lat: number; lng: number };
  /** Present while it is running late: past the time it was promised to be ready, and still on its way. */
  runningLate?: RunningLate;
}

/** A parcel running late — the server's one rule, behind the notice, this page and the list alike. */
export interface RunningLate {
  promisedAt: string;
  lateHours: number;
  /** Where it is: still at the shop it was handed in at, on the road, or at a sorting hub. */
  where: 'shop' | 'road' | 'hub';
}

/* ------------------------------------------------- booking (PG3) -- */

/** The derived tier + cargo class for typed dims + weight (POST /size/classify, @Public). */
export interface ClassifyView {
  size: ParcelSize;
  cargoClass: string;
  /** True = too big for the parcel network — a person's send is refused (dedicated freight is vendor-only for now). */
  dedicated: boolean;
}

/** The locked price a mint returns — what the sender pays in cash at the drop-off shop. */
export interface MintPrice {
  routeMode: 'locked' | 'flexible';
  /** The money every figure here is in: the parcel's. */
  currency?: string;
  /** The GROSS — the cash handed over at the drop-off shop, tax included. */
  total: number;
  transport?: number;
  nodeFees?: number;
  platformFee?: number;
  km?: number;
  ceiling?: number;
  /** The tax inside `total`, and what the authority calls it. Absent or zero where none was charged. */
  tax?: number;
  taxLabel?: string;
}

/** POST /identity/parcels — the sender's authenticated twin + their drop-off credential + the locked price. */
export interface MintResult {
  parcel: ConsumerParcelView;
  label: { parcelId: string; qrPayload: string; svg: string };
  price: MintPrice;
  journey?: { hops: string[]; mdpRouted: boolean; pickupReadyAt: string };
}

/* ------------------------------------------------- identity (S20/S21) -- */

/** The person-facing roles a consumer may hold (mirrors backend PersonRole / lib/sbg). */
export type PersonRole = 'consumer' | 'driver' | 'agent' | 'mdp' | 'fleet_manager' | 'vendor';

export interface RoleLinkView {
  role: PersonRole;
  entityDid: string;
  status: 'active' | 'pending' | 'suspended';
}

/** The bearer an enroll/login returns (shape of the backend AccessToken). */
export interface AccessTokenView {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** The signed-in person + roles (GET /identity/me, and the enroll/login envelope minus the token). */
export interface PersonView {
  personId: string;
  roles: RoleLinkView[];
  hasPin: boolean;
  createdAt: string;
  /** Self profile (S29) — the person's own display name (revealed from the vault) + avatar mediaId.
   *  Self-view only: these are never present on any counterparty projection. */
  displayName?: string;
  avatarMediaId?: string;
  /** When the PIN was last changed. */
  pinChangedAt?: string;
}

/** enroll/login response = a PersonView + isNew + the actor token to seed. */
export interface AuthResult extends PersonView {
  isNew?: boolean;
  token: AccessTokenView;
}

/** The role-switch response — a NEW actor token for the target role, bound to its entity. */
export interface SwitchResult {
  role: PersonRole;
  entityDid: string;
  token: AccessTokenView;
}

/** One authenticated parcel twin the consumer is a party to (PII-free; mirrors backend ConsumerParcelView). */
export interface ConsumerParcelView {
  parcelId: string;
  did?: string; // DT — the shipment's stable GLOS identity (the digital twin)
  relation: 'sent' | 'received';
  direction: 'inbound' | 'outbound';
  status: ParcelStatus;
  originZone: string;
  destZone: string;
  size: ParcelSize;
  fragile?: boolean;
  items?: Array<{ name: string; qty: number }>;
  trackingKey?: string;
  vendorOrder: boolean;
  createdAt: string;
  updatedAt: string;
  timeline: Array<{ at: string; status: ParcelStatus | 'CREATED'; note?: string }>;
  /** Present while it is running late (see RunningLate). */
  runningLate?: RunningLate;
  /** The in-app collection token (S22) — only on the single-parcel detail, for the receiver, when ready. */
  collectToken?: { code: string; qrPayload: string };
  /** There is a code and it is not shown until then: the account was moved to a new number without its PIN. */
  codeHeldUntil?: string;
  /** It was sent to a number this account has moved off. The sender does not know the new one. */
  sentToOldNumber?: boolean;
  /** S23: the receiver's own photos + reason (present only on their own — received — view). */
  podPhotoRef?: string;
  disputePhotoRef?: string;
  disputeReason?: string;
  /**
   * How a reported problem ENDED — on the receiver's view and the sender's: the decision, the network's own
   * reason, and when something was awarded, how much and to whom. Absent while it is open, or there was none.
   */
  disputeOutcome?: DisputeOutcome;
  /** The damage claim report made when a problem was reported. The receiver's only: it holds what they wrote and photographed. */
  damageReport?: { number: string };
  /** Declared lost by staff after a search, in their words — and, once it turned up, found again. */
  lost?: { declaredAt: string; reason: string; foundAt?: string; foundNote?: string };
  /** The closed-window facts — RECEIVER ONLY. A sender owns the shipment, not the goods, so whether the
   *  person at the other end has come and what that is costing them is not the sender's business. */
  unclaimedAt?: string;
  holdingOwed?: number;
  /** The money `holdingOwed` is in — the same the counter asks for it in. */
  holdingCurrency?: string;
  extensionsUsed?: number;
  receiverResponse?: { choice: 'coming' | 'proxy' | 'relinquish' | 'not-mine'; at: string; note?: string };
  collectProxy?: { name: string; code?: string };
  relinquishedAt?: string;
  /**
   * Withdrawn at a hub (the user, 2026-10-27: "Back to its shop, sender pays"): on the parcel taking the goods back to their
   * sender, the one it takes back and what they pay in cash at the counter as they collect it; on the one withdrawn, the
   * parcel taking it back.
   */
  returnOf?: string;
  returnParcelId?: string;
  /** The receiver's side of one turned round: it went back to its sender, and will not come. */
  wentBack?: boolean;
  payAtCollection?: { amount: number; currency: string };
}

/** S32d — a diverted dedicated-freight job the buyer is a party to (the freight analogue of a parcel twin).
 *  Shown in a "Dedicated freight" section of "my parcels" so an order too big for the network stays visible. */
export interface FreightShipmentView {
  freightId: string;
  code: string; // human FRT-NNN reference
  status: 'available' | 'claimed' | 'in_transit' | 'delivered' | 'cancelled';
  cargoClass: string;
  destLabel: string;
  weightKg: number;
  trackingKey?: string;
  externalOrderId?: string;
  equipmentGaps: Array<'origin' | 'dest'>;
  createdAt: string;
  timeline: Array<{ status: string; at: string }>;
}

export interface MyParcels {
  sent: ConsumerParcelView[];
  received: ConsumerParcelView[];
  freights: FreightShipmentView[];
}

/* ------------------------------------------------- invites (S24) -- */

export interface InviteView {
  inviteId: string;
  token: string;
  channels?: string[];
  joined: number; // distinct people who joined through this link
  createdAt: string;
}

export interface InviteSummary {
  invites: InviteView[]; // the person's one reusable link (or empty)
  joined: number; // total joins it drove
}

/** How a dispute ended, as the two people on the parcel read it. */
export interface DisputeOutcome {
  /** Where it was raised: from the receiver's own app, or by the shop at its counter. */
  origin: 'buyer' | 'counter';
  /** `report_only`: nobody of ours decided anything — the problem was recorded and a damage claim report was made. */
  decision: 'upheld' | 'partly_upheld' | 'rejected' | 'report_only';
  note: string;
  decidedAt: string;
  award?: number;
  currency?: string;
  /** Who the award goes to: the store that sold the shipment, or the sender who paid for it at a counter. */
  paidTo?: 'store' | 'sender';
}

/**
 * An address or a place, found (GET /v1/sbg/geocode). A house is `exact`; a street, a suburb or a town is `approx`, its
 * middle. What nothing finds is an error (NOT_FOUND), never a stand-in point.
 */
export interface PlaceFound {
  location: { lat: number; lng: number };
  confidence: 'exact' | 'approx' | 'fallback';
  matched?: string;
}
