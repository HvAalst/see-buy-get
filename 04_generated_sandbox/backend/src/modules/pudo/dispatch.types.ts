// Dispatch marketplace types (Compendium Ch 19 — opportunistic line-haul). A driver declares a route
// A→B; the platform offers full/aged totes (and bulk freight) that sit near that route, sized to the
// remaining capacity of the driver's coupled vehicle. The driver claims, ignores, or lets it lapse.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoPoint } from './pudo.types';
import { CARGO_CLASS_CODES, CARGO_NATURES, CargoClass, CargoNature, EQUIPMENT, Equipment, VEHICLE_CAPABILITIES, VehicleCapability } from './cargo.types';
import { TRUCK_SUBTYPES, TruckSubtype, VEHICLE_CLASSES, VehicleClass } from './fleet.config';
import { PACKAGING, type Packaging } from './packaging';

/**
 * FB0b — how much the body derivation actually had to work with. Carried alongside the answer because the
 * whole point of the market series is that someone invests real money on it, and "we measured this load" and
 * "we guessed from its weight because nobody measured it" are not the same claim.
 */
export type BodyBasis =
  | 'measured' // dimensions AND weight were recorded — the derivation saw the load
  | 'weight-only'; // no dimensions on the record (a freight registered before FB0b, or a loose bulk load)

/** The body a load canonically needs, and the strength of the claim. Derived in freight-body.ts. */
export class DerivedBody {
  @ApiProperty({ enum: TRUCK_SUBTYPES })
  body: TruckSubtype;
  @ApiProperty({ enum: ['measured', 'weight-only'] })
  basis: BodyBasis;
}
import { SafetyItem, TempBand, TempReading } from './heavy-cargo';

/** The transparent price breakdown shown on an offer card — every term the driver can see and trust. */
export class PriceBreakdown {
  baseFee: number; // B — the flag-down / loading fee
  distanceKm: number; // D — deadhead + haul. The BILLED distance; the price is computed on this and only this.
  /**
   * FB0a — the two halves of D, kept apart instead of summed away.
   *
   * They add up to distanceKm and change no money: the price has always been charged on the total, and still
   * is. What was missing is the question an operator with a fixed asset actually asks — "how far do I run
   * EMPTY to earn this?" — which a single collapsed number cannot answer. Loaded km is also the only honest
   * denominator for a market series: an empty kilometre is cost, not work done.
   *
   * OPTIONAL because a breakdown is DURABLE — it is locked onto a freight at claim and outlives this slice.
   * A price locked before FB0a has no split, and there is no way to recover one from the total (any division
   * would be invention). Read them through `distanceSplit()`, which returns null rather than guessing.
   */
  deadheadKm?: number; // the empty run: where the vehicle is now → the pickup
  loadedKm?: number; // the paid run: pickup → dropoff
  ratePerKm: number; // R_base
  multiplier: number; // M — already clamped to the driver's bounds
  effectiveRate: number; // R_base × M
  total: number; // B + D × effectiveRate — the driver's earning (the offer price)
}

export class RoutePlan {
  from: GeoPoint;
  to: GeoPoint;
  departAt?: string;
}

export type ClaimableKind = 'tote' | 'freight';
// 'scheduled' — booked for a FUTURE pickup date; held out of the driver marketplace until due, then
// promoted to 'available' (the freight analogue of a tote that isn't full/aged yet).
export const FREIGHT_STATUSES = ['scheduled', 'available', 'claimed', 'in_transit', 'delivered'] as const;
export type FreightStatus = (typeof FREIGHT_STATUSES)[number];

/** A bulk/dedicated freight job (sugar/cement, or a P4+ order diverted out of the PUDO network) — trucks
 *  only, never via MDP. Same marketplace as totes. */
export class Freight {
  freightId: string;
  code: string; // human-readable reference
  description: string;
  pickupLocation: GeoPoint;
  pickupLabel: string;
  destLabel: string;
  destLocation?: GeoPoint;
  weightKg: number;
  // FB0b — the load's own measured facts, KEPT this time. Dimensions were accepted at registration, used to
  // classify the cargo, and then dropped on the floor, which is why "does this fit a flatbed rather than a box
  // body" has never been answerable. Optional because loose bulk genuinely has no dimensions, and because a
  // freight registered before FB0b has none — such a load derives its body from weight alone and SAYS SO
  // (DerivedBody.basis), rather than being quietly counted as measured.
  // The explicit @ApiPropertyOptional is load-bearing: @nestjs/swagger cannot read a fixed-length TUPLE type
  // and reports it as a false circular dependency on this very property (the same failure mode as an inline
  // Array<{}> response prop — see the S33b/DT notes). Describing it as a 3-number array fixes the emitter and
  // documents the length the type already enforces.
  @ApiPropertyOptional({ type: [Number], minItems: 3, maxItems: 3, description: 'Length, width, height in cm (orientation-free)' })
  dimensionsCm?: [number, number, number];
  /** Can the load be split into two smaller ones? The single most decision-changing fact about anything
   *  oversize: a divisible 30 t is two ordinary trips, an indivisible 30 t is a low-loader and a permit. */
  indivisible?: boolean;
  /** The minter's own body pick. ADVISORY — shown, compared and counted, NEVER used to filter (user, 2026-08-30).
   *  A shop clerk booking a walk-up cannot reliably tell a skeletal from a flatbed, and a binding wrong pick
   *  would invisibly exclude the one operator who could have taken the load. Where it disagrees with the
   *  derived body, that disagreement is itself a market signal worth reporting. */
  @ApiPropertyOptional({ enum: TRUCK_SUBTYPES })
  bodyHint?: TruckSubtype;
  /** Bodies the SHIPPER rules out — theft risk, an insurer's wording, a customer's requirement. A PREFERENCE,
   *  and typed as one: the board says "the shipper ruled out open bodies", never dressing it up as physics. */
  @ApiPropertyOptional({ enum: TRUCK_SUBTYPES, isArray: true })
  excludedBodies?: TruckSubtype[];
  /** FB0b — the body this load canonically needs, STAMPED at registration (and the basis it was derived on).
   *  Frozen rather than computed on read for the same reason a price is frozen at claim: "kilometres of
   *  flatbed offered in 2026" must not change when someone tunes a threshold in 2027. Absent on a pre-FB0b
   *  freight, which is derived live and reports itself as weight-only. */
  bodyDerived?: DerivedBody;
  fragile: boolean;
  /**
   * FB5 — how the goods are PRESENTED for handling, which is what decides the body and the kit.
   *
   * Recorded per consignment rather than inferred from the commodity, because the same commodity is handled
   * completely differently from place to place (user, 2026-08-30): sugar is poured into a food-grade bulk
   * trailer in Holland and stacked in sacks on a flatbed in Kenya. A rule keyed on "is it sugar" gets one of
   * those two wrong wherever it is deployed.
   */
  @ApiPropertyOptional({ enum: PACKAGING })
  packaging?: Packaging;
  /**
   * DERIVED from packaging (`loose`), and kept because vehicle matching is written against it.
   *
   * It used to be the stored truth and it meant two opposite things — "loose, it tips or augers" in the body
   * derivation, "sugar/cement bags" in the vehicle spec. It now has exactly one meaning, the loose one, which
   * is what `Vehicle.carriesBulk` and the board's NO_BULK_BODY blocker already assumed.
   */
  bulk: boolean;
  // S32 — the freight's cargo model, so it matches vehicles like a tote does: class (drives required
  // equipment), primary nature (drives required vehicle capability), and the resolved requirements a
  // claiming vehicle must satisfy. `shipperDid` links the originator (a vendor whose P4+ order was diverted).
  // These three enums predate FB0c and were emitting into the contract as bare, typeless objects: a string
  // UNION has no runtime type for the emitter to read, so every generated client saw `cargoClass: object`.
  // Named here (with status and paidStatus below) because the board is about to be built against this
  // contract, and a screen cannot switch on a field whose values the types do not know.
  @ApiProperty({ enum: CARGO_CLASS_CODES })
  cargoClass: CargoClass;
  @ApiProperty({ enum: CARGO_NATURES })
  natureCode: CargoNature;
  requiredCapabilities: VehicleCapability[];
  requiredEquipment: Equipment[];
  /** S32c — the ends whose SITE cannot handle this cargo (no qualifying load/unload equipment on hand). An
   *  ADVISORY flag ("arrange a forklift at the destination"), not a block — a Local Admin resolves it. Empty
   *  when both ends are equipped (or their equipment is unknown, e.g. a bulletin freight with only geo labels). */
  equipmentGaps: Array<'origin' | 'dest'>;
  shipperDid?: string;
  // S34c — the shipper's budget: the most they will pay (the all-in shipperCharge = earning + platform fee) for
  // this haul. Dispatch will not OFFER or let a driver CLAIM the job above it — the load waits for a cheaper
  // vehicle or a cooler market. The driver owns their [min,max] corridor; the shipper owns this ceiling. Undefined
  // = no cap (the pre-S34c behaviour). Set from the diverting vendor's shipping policy.
  maxSpend?: number;
  // S32d — the buyer whose order was diverted keeps sight of it: a phone-HASH join to their identity (so it
  // shows in "my shipments") — never the cleartext number, since the raw Freight is returned to drivers /
  // operators (listFreight, pickup/deliver) — plus a public tracking key, the order ref, and per-transition
  // timestamps → a timeline. Absent for a bulletin freight (no buyer).
  buyerPhoneHash?: string;
  trackingKey?: string;
  externalOrderId?: string;
  claimedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  // S34 — the price is LOCKED at claim (the claiming vehicle's profile × the market multiplier at that
  // moment), so a later surge or a driver profile edit never changes what was agreed. paidStatus tracks the
  // shipper charge at claim ('billed' paid | 'billing_failed' known shipper short of prepaid funds, a debt to
  // collect | 'unpaid' bulletin freight settled off-platform); driverPaid tracks the driver payout at delivery.
  lockedPrice?: number;
  priceBreakdown?: PriceBreakdown;
  /** FB0c — where lockedPrice came from. 'computed' (or absent, for anything locked before FB0c) means it IS
   *  priceBreakdown.total. 'negotiated' means two parties agreed a number, so lockedPrice is authoritative and
   *  may differ from the breakdown — which is kept anyway, because its distances are real and are what the
   *  market series reads. Every money path already reads lockedPrice; nothing bills off the breakdown. */
  @ApiPropertyOptional({ enum: ['computed', 'negotiated'] })
  priceOrigin?: 'computed' | 'negotiated';
  lockedAt?: string;
  @ApiPropertyOptional({ enum: ['unpaid', 'billed', 'billing_failed'] })
  paidStatus?: 'unpaid' | 'billed' | 'billing_failed';
  /**
   * What the SHIPPER was actually charged, stamped at the moment of charging.
   *
   * `lockedPrice` is the driver's earning; this is the other side — the driver's earning plus the platform's
   * take plus tax. It is stamped rather than recomputed because a release has to reverse what was charged,
   * and both of the rates behind it (the sister's fee stack, its tax) are knobs somebody may turn between
   * the claim and the no-show. Recomputing on the way out is how a rebate stops matching its own charge and
   * leaves a residue in the books that nothing explains.
   *
   * Absent on a freight nobody was billed for — the bulletin load settled off-platform, which is most of them.
   */
  billed?: { net: number; tax: number; gross: number; feePct: number; taxPct: number; provision: number };
  driverPaid?: boolean;
  // S33 — the heavy-cargo safety gate. loadSafety is stamped at pickup (the confirmed checklist keys + the
  // securement photo mediaId); unloadReport at delivery. Absent until the driver passes each gate.
  loadSafety?: { confirmed: string[]; securementPhotoRef: string; at: string; by?: string };
  unloadReport?: { confirmed: string[]; at: string; by?: string };
  // S33b — cold-chain temperature monitoring. A reading log (each stamped with its own breach verdict) + a
  // STICKY tempBreached flag: once the chain is broken the cargo is suspect even if the temperature recovers.
  // Only meaningful for a temperature-controlled cargo (tempBand(natureCode) != null).
  tempReadings?: TempReading[];
  tempBreached?: boolean;
  // A future pickup date (canonical UTC ISO). Set → the load is booked for later. Pickup is gated to on/after
  // this time regardless of when it is claimed.
  scheduledPickupAt?: string;
  // F1 — the SHIPPER's choice for a scheduled load: true (default) → drivers can RESERVE it ahead of its date
  // (it shows in the marketplace + pings now, so a scarce truck can commit early); false → it stays hidden
  // until due. Ignored for a ship-now load.
  allowEarlyClaim?: boolean;
  /** FB0c — how this load may be taken. 'instant' (the default, and what every pre-FB0c load is read as) means
   *  a fit driver claims it at the computed price. 'negotiate' means the minter wants to agree a price first:
   *  drivers PROPOSE, the poster accepts one, and only that acceptance claims the load. */
  @ApiPropertyOptional({ enum: ['instant', 'negotiate'] })
  commitMode?: FreightCommitMode;
  /** FB0c — who posted the load, and therefore who negotiates for it. Distinct from shipperDid, which is who
   *  PAYS: a counter booking deliberately has no shipperDid (the customer's cash settles off-platform) yet
   *  still has a shop that must be able to answer a proposal. Absent for a bulletin freight → operators only. */
  postedByDid?: string;
  @ApiProperty({ enum: FREIGHT_STATUSES })
  status: FreightStatus;
  claimedBy?: string;
  /**
   * FB4a — what actually CARRIED it, stamped at claim. The mirror of `bodyDerived`: that one records the body
   * the load needed, this one the body that turned up.
   *
   * Frozen for exactly the reason the derived body and the price are frozen. Only `claimedBy` was ever
   * recorded, so "kilometres moved by container chassis in 2026" could only be answered by looking up what
   * that driver is coupled to TODAY — and a driver who sells a flatbed and buys a box van would silently
   * rewrite every haul they have ever done. A market series that changes retroactively is not a series.
   *
   * Absent on a load claimed before FB4a, and on one whose claimer had no truck subtype (a van or a bus).
   * Such a haul is counted as UNKNOWN in the analytics, never attributed to a body by inference.
   */
  carriedBy?: CarriedBody;
  createdAt: string;
}

/** FB4a — the vehicle that took a load, as much of it as the market series needs. */
export class CarriedBody {
  @ApiProperty({ enum: VEHICLE_CLASSES })
  vehicleClass: VehicleClass;
  /** The truck body. Absent for a vehicle class that has no subtype — a van is a van. */
  @ApiPropertyOptional({ enum: TRUCK_SUBTYPES })
  truckSubtype?: TruckSubtype;
}

/* ------------------------------------------------------ FB1: the open board -- */

/**
 * FB1 — what KIND of "no" this is. The board shows every load and marks the ones an operator cannot take,
 * so each reason has to say what sort of obstacle it is; an untyped board is a grey wall.
 *
 * 'unknown' is not a refusal. It is the system declining to pretend it checked something it cannot check —
 * bridge clearances and axle limits, which no data exists for. Absence of a report is not clearance.
 */
export const BLOCKER_KINDS = ['legal', 'physical', 'resolvable', 'preference', 'unknown'] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

export class BoardBlocker {
  @ApiProperty({ enum: BLOCKER_KINDS })
  kind: BlockerKind;
  /** Stable machine code — a screen switches on this, never on the message. */
  code: string;
  /** The English sentence. Not yet translated; the codes exist so it can be, without moving the logic. */
  message: string;
}

/** FB1 — one load as the board shows it: the market's facts, this driver's price, and every reason why not. */
export class BoardRow {
  freightId: string;
  code: string;
  description: string;
  pickupLabel: string;
  pickupLocation: GeoPoint;
  destLabel: string;
  destLocation?: GeoPoint;
  weightKg: number;
  @ApiProperty({ enum: CARGO_CLASS_CODES })
  cargoClass: CargoClass;
  @ApiProperty({ enum: CARGO_NATURES })
  natureCode: CargoNature;
  @ApiPropertyOptional({ type: [Number], minItems: 3, maxItems: 3 })
  dimensionsCm?: [number, number, number];
  indivisible?: boolean;
  /** What body the load needs, and how strong that claim is (measured, or guessed from weight alone). */
  bodyDerived?: DerivedBody;
  @ApiPropertyOptional({ enum: TRUCK_SUBTYPES })
  bodyHint?: TruckSubtype;
  @ApiProperty({ enum: ['instant', 'negotiate'] })
  commitMode: FreightCommitMode;
  scheduledPickupAt?: string;
  /** The empty run to reach it, the paid run, and their sum — the numbers the whole decision turns on. */
  deadheadKm: number;
  loadedKm: number;
  totalKm: number;
  /** Indicative, priced against THIS driver's vehicle. Absent when they are not coupled to one. */
  price?: PriceBreakdown;
  /** Earnings per TOTAL kilometre, empty run included — the board's sort key. Null when it cannot be computed
   *  (no vehicle, or a zero-distance job): an unsortable row is shown as unsortable, never floated to the top. */
  earningsPerKm?: number | null;
  /** True when nothing but an 'unknown' stands in the way. */
  canTake: boolean;
  blockers: BoardBlocker[];
}

/**
 * The board's response, NAMED rather than returned as an inline `{ items, total }`.
 *
 * An anonymous response object emits into the contract as an untyped blob: BoardRow and BoardBlocker never
 * appear at all, and the generated client hands a screen `unknown` for every row. Same family as the
 * inline-Array<{}> false-circular already on record — if a shape crosses the wire, it needs a name.
 */
export class FreightBoardResponse {
  @ApiProperty({ type: [BoardRow] })
  items: BoardRow[];
  total: number;
}

/**
 * FB3b — one load as the PUBLIC market shows it, to a caller with no account and no vehicle.
 *
 * A deliberately different shape from BoardRow, not a filtered one. The two answer different questions:
 * BoardRow answers "can I take this", which needs a vehicle to judge against; this answers "what work
 * exists here, and what would I need to do it" — which is the question someone deciding whether to buy a
 * truck, or move to a city, is actually asking.
 *
 * What is MISSING is the design. No code, no description, no shop name and no exact pin: the public list
 * is a standing, anonymous, searchable inventory of valuable goods with pickup dates against them, and an
 * address on it serves nobody who is deciding where to invest. A town and a distance say everything the
 * market question needs. Everything about the WORK stays — weight, body, distances, money — because that
 * is the half we are here to publish.
 */
export class MarketRow {
  /** Coarse: the nearest town we know, not the pickup's own label. Absent where nothing is near enough
   *  to name honestly — a distance with no name beats a name that implies precision we do not have. */
  area?: string;
  /** Likewise for the far end: what corridor this load runs, in towns. */
  destArea?: string;
  /** Rounded to ~0.05° (≈5 km) so the market can be mapped without a load being met at its gate. */
  pickupAbout: GeoPoint;
  weightKg: number;
  @ApiProperty({ enum: CARGO_CLASS_CODES })
  cargoClass: CargoClass;
  @ApiProperty({ enum: CARGO_NATURES })
  natureCode: CargoNature;
  indivisible?: boolean;
  /** The body this load needs and how strong that claim is. THE field the whole page exists for: it is what
   *  turns "there is work here" into "there is work here for a flatbed". */
  bodyDerived?: DerivedBody;
  /** Kit a vehicle must have to load and unload it — the other half of the investment question. */
  @ApiPropertyOptional({ enum: EQUIPMENT, isArray: true })
  requiredEquipment?: Equipment[];
  @ApiPropertyOptional({ enum: VEHICLE_CAPABILITIES, isArray: true })
  requiredCapabilities?: VehicleCapability[];
  /** From the point the caller asked about — their question, not ours. */
  deadheadKm: number;
  loadedKm: number;
  totalKm: number;
  scheduledPickupAt?: string;
  /** INDICATIVE ONLY, and named so. Computed at the network's default rate for a typical vehicle, because
   *  an anonymous caller has no vehicle whose rate card we could price against. What an actual operator
   *  earns is their own rate on their own corridor — this is the market's shape, not an offer. */
  indicativeTotal?: number;
  /** Indicative earnings per TOTAL kilometre, empty run included. Null when it cannot be computed. */
  indicativePerKm?: number | null;
}

/**
 * FB4 — one truck body's two lines in the market series: what shippers asked for, against what moved.
 *
 * `body` is a truck subtype, or the literal 'unknown' for kilometres we decline to attribute — a load whose
 * body was never derived, or a haul whose carrier was never recorded. A bucket named 'unknown' is a true
 * statement about our records; spreading those kilometres across the real bodies would be a false one.
 */
export class BodySeries {
  @ApiProperty({ enum: [...TRUCK_SUBTYPES, 'unknown'] })
  body: TruckSubtype | 'unknown';
  /** Loads POSTED in the window whose derived body is this one. */
  offeredLoads: number;
  /** Their LOADED kilometres — pickup → dropoff. Work asked for; empty running is never in here. */
  offeredKm: number;
  /** How many of those had a MEASURED body rather than one guessed from weight. The rest still count; they
   *  are a softer claim, and a reader investing against this is entitled to know the difference. */
  offeredMeasured: number;
  /** Loads CLAIMED in the window and carried by a vehicle of this body. */
  movedLoads: number;
  /** Their loaded kilometres. THE number — "km of containers moved". */
  movedKm: number;
  /** The empty run to reach that work. Beside movedKm, never inside it: a market whose fleet turns 40% of its
   *  wheels empty is a different investment from one that does not, and only a separate figure says so. */
  deadheadKm: number;
}

/** Totals across every body, so the headline does not have to be assembled from the table. */
export class MarketSeriesTotals {
  offeredLoads: number;
  offeredKm: number;
  movedLoads: number;
  movedKm: number;
  deadheadKm: number;
  /** Loads posted in the window that NOTHING ever claimed — demand the fleet did not meet. The gap between
   *  this and the moved figures is the sentence somebody deciding what to buy is actually paying for. */
  unmetLoads: number;
  unmetKm: number;
}

/** FB4 — the market series. The response of the analytics endpoint, and the moat. */
export class MarketSeries {
  /** The window these figures cover, echoed as ISO instants. A kilometre count means nothing without the
   *  period it accrued over, and "yearly km" is a rate a reader has to be able to check for themselves. */
  from: string;
  to: string;
  @ApiProperty({ type: [BodySeries] })
  bodies: BodySeries[];
  totals: MarketSeriesTotals;
}

/** The public market's response. Named for the same reason FreightBoardResponse is. */
export class MarketResponse {
  @ApiProperty({ type: [MarketRow] })
  items: MarketRow[];
  total: number;
  /** Said in the payload, not just in the docs: every price here is the network default applied to this
   *  load, so a client cannot render these numbers as an offer without stepping over the word. */
  basis: 'indicative-network-default';
}

/** FB0c — how a load is taken: at the computed price, or at one agreed first. */
export type FreightCommitMode = 'instant' | 'negotiate';

export type ProposalStatus =
  | 'open' // awaiting the poster's answer
  | 'accepted' // the poster took it — this proposal claimed the load
  | 'declined' // the poster said no to this one specifically
  | 'withdrawn' // the driver pulled it
  | 'superseded'; // another proposal on the same load was accepted

/**
 * FB0c — a driver's offer to carry a load for a stated price.
 *
 * The counterpart of a claim, for loads the minter marked 'negotiate'. A proposal binds nobody: it is an
 * offer to treat, and the load stays available to everyone (including to instant-claim, if it is not a
 * negotiate load) until a poster accepts one.
 */
export class FreightProposal {
  proposalId: string;
  freightId: string;
  driverDid: string;
  /** The DRIVER's earning they are asking for — the same quantity as lockedPrice, not the shipper's charge. */
  price: number;
  /** The driver's case for the number, in their own words ("I'm empty-running past your gate on Thursday"). */
  note?: string;
  /** The two legs AS AT the proposal, from the position the driver proposed from. Carried so the accepted
   *  haul records a real deadhead/loaded split rather than one invented at acceptance time. */
  deadheadKm: number;
  loadedKm: number;
  @ApiProperty({ enum: ['open', 'accepted', 'declined', 'withdrawn', 'superseded'] })
  status: ProposalStatus;
  createdAt: string;
  decidedAt?: string;
}

/** Named for the same reason as FreightBoardResponse — an inline `{ items }` puts nothing in the contract. */
export class FreightProposalsResponse {
  @ApiProperty({ type: [FreightProposal] })
  items: FreightProposal[];
}

/**
 * FB2b — one of MY posted loads, as the shop that posted it sees it.
 *
 * A projection, not the raw Freight: the poster needs to decide, not to inspect. It deliberately carries no
 * buyerPhoneHash, no trackingKey and no claimedBy — a screen that only answers prices has no business
 * holding the identifiers that join a load to a person.
 */
export class PostedFreightRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  weightKg: number;
  @ApiProperty({ enum: FREIGHT_STATUSES })
  status: FreightStatus;
  @ApiProperty({ enum: ['instant', 'negotiate'] })
  commitMode: FreightCommitMode;
  /** The cash cap the customer agreed — what a price is judged against. */
  maxSpend?: number;
  scheduledPickupAt?: string;
  createdAt: string;
  /** How many prices are waiting for an answer. The whole reason this row is on a screen. */
  openProposals: number;
  /** Set once the load is taken, so the poster sees the outcome without a second call. */
  agreedPrice?: number;
}

export class PostedFreightResponse {
  @ApiProperty({ type: [PostedFreightRow] })
  items: PostedFreightRow[];
}

/** The buyer-facing, PII-free projection of a diverted freight job — the freight analogue of a
 *  ConsumerParcelView, shown in the buyer's "my shipments" so a diverted order never disappears. */
export class FreightShipmentView {
  freightId!: string;
  code!: string; // human FRT-NNN reference
  status!: FreightStatus;
  cargoClass!: string;
  destLabel!: string;
  weightKg!: number;
  trackingKey?: string;
  externalOrderId?: string;
  equipmentGaps!: Array<'origin' | 'dest'>;
  createdAt!: string;
  /** When the load is booked to be picked up (ISO) — set for a scheduled/planned freight, absent for ship-now. */
  scheduledPickupAt?: string;
  timeline!: Array<{ status: FreightStatus; at: string }>;
  /** S33b — for a cold-chain order, whether its temperature chain was broken in transit (a PII-free boolean:
   *  the buyer sees "temperature maintained" vs a "temperature alert", never the raw readings). */
  tempBreached?: boolean;
}

/** A unit a driver can claim, normalised across totes and freight. */
export class Claimable {
  kind: ClaimableKind;
  ref: string; // toteCode | freightId — the API identifier the pickup/load/deliver calls use
  /** S32b — the human-readable reference to SHOW a driver (TOTE-042 / FRT-007). For a tote this equals ref;
   *  for freight ref is the opaque frt_… id, so the readable FRT-NNN code must ride separately. */
  code?: string;
  pickupLocation: GeoPoint;
  pickupLabel: string;
  destLabel: string;
  /**
   * The haul destination as a PLACE, so pricing and routing can work the pickup→dropoff leg.
   *
   * Freight has always set it. A bag now does too: it addresses itself to a node or to a zone, and both
   * resolve — a zone to the hub that serves it, which is genuinely where such a bag is driven. Still
   * absent where neither resolves, because a coordinate here becomes a distance and a direction, and a
   * guessed one would be worse than none.
   */
  destLocation?: GeoPoint;
  weightKg: number;
  fragile: boolean;
  bulk: boolean;
  /** S32b — the underlying tote/freight status (available | claimed | in_transit | …). Lets the driver app
   *  decide the next action on a claimed load: a claimed freight needs PICK-UP, an in-transit one needs DELIVER. */
  status?: string;
  /** F1 — a booked-for-later freight's pickup date, so the driver's offer reads "reserve now, pick up on <date>". */
  scheduledPickupAt?: string;
  /**
   * BAGS ONLY — how many parcels are inside, and how full it is against a bag's capacity.
   *
   * What the pay is made OF. A bag now earns for the road AND for what it carries, so a driver shown only a
   * figure has to take it on trust; these two are the reason it is that figure. The fill is also the only
   * way to tell a bag worth a whole slot from one worth a fifth of it, which is the decision when the hold
   * has two spaces left and the day is not over.
   */
  parcels?: number;
  fillPct?: number;
  /** S31 — vehicle capabilities this load's cargo requires (a tote's perishable/hazardous parcels →
   *  cold chain / hazmat). A vehicle lacking any is not offered the load. */
  requiredCapabilities?: VehicleCapability[];
  /** S32 — load/unload equipment this load requires (a heavy-class freight → a forklift/tail-lift/crane).
   *  A vehicle whose equipment manifest lacks any is not offered the load. */
  requiredEquipment?: Equipment[];
  /** S34 — once a freight is claimed its price is locked; a claimed load carries the driver's agreed earning
   *  (and its breakdown) so "my loads" always shows what the job pays. Undefined for a tote / an unclaimed load. */
  lockedPrice?: number;
  priceBreakdown?: PriceBreakdown;
  /** S34c — the shipper's spend cap for this freight (the all-in charge), so suggest can skip a load whose price
   *  at this vehicle's rate would blow the shipper's budget. Undefined for a tote / an uncapped freight. */
  maxSpend?: number;
  /** S33 — the cargo model the driver app needs to render the right safety checklist + a heavy badge. */
  cargoClass?: CargoClass;
  natureCode?: CargoNature;
  /** S33 — the exact load-safety + unload checklist items THIS freight must pass. Single source of truth: the
   *  driver ticks these and sends the keys back; the backend re-derives and enforces the same set. Freight only. */
  loadChecklist?: SafetyItem[];
  unloadChecklist?: SafetyItem[];
  /** S33b — cold-chain monitoring surfaced to the driver: the safe band to keep (null = not temperature-
   *  controlled → no log control), the last logged reading, and whether the chain has been breached. */
  tempBand?: TempBand;
  lastTempC?: number;
  tempBreached?: boolean;
}

export type OfferStatus = 'pending' | 'claimed' | 'ignored' | 'expired';

/** A suggestion pushed to a driver: "≈N min from <place>, a shipment is ready — claim it?" */
export class Offer {
  offerId: string;
  driverDid: string;
  kind: ClaimableKind;
  ref: string;
  pickupLabel: string;
  pickupLocation: GeoPoint;
  destLabel: string;
  /** Where the load is going, as a place — so a driver can see and navigate the whole leg rather than only
   *  the trip to the pickup. Absent when the destination cannot be resolved to a coordinate. */
  destLocation?: GeoPoint;
  weightKg: number;
  detourKm: number;
  minutesAway: number;
  /**
   * WHAT THIS JOB COSTS THE DRIVER, IN MINUTES — the two figures a decision at the wheel is actually made
   * on, and the pair `detourKm` could never give.
   *
   * `collectMin` is the extra time to go and get it. `deliverMin` is the extra time that CARRYING it then
   * costs, on top of that — because a pickup next door whose destination is an hour the wrong way is not a
   * small job, and a kilometre figure computed over the pickup alone said it was.
   *
   * Time rather than distance because that is the unit a driver spends and the only one they can explain
   * to anybody else: a bus driver cannot justify eight kilometres to a bus full of passengers, but "this
   * costs you six minutes" is a sentence everybody in the vehicle understands.
   *
   * Both are measured against the road the driver DECLARED, so they are genuinely extra. With no declared
   * road there is nothing to be extra to, and they report the plain travel time instead — which is the
   * honest reading: when you have no plan, all of it is extra.
   *
   * `deliverMin` is absent when the destination cannot be placed. Never guessed: a made-up minute is worse
   * than a missing one, because this is the number somebody agrees to.
   */
  collectMin?: number;
  deliverMin?: number;
  message: string;
  /** S34 — the priced offer: the driver's earning + the transparent B + D·R·M breakdown. FREIGHT ONLY —
   *  a bag has no B + D·R·M, so read `earn` for the figure that covers both kinds. */
  price?: PriceBreakdown;
  /**
   * WHAT THIS JOB PAYS, all in — the one number the driver is agreeing to, for either kind of load.
   *
   * Freight: the same figure as `price.total`. A bag: the handling fee plus the road it will travel.
   *
   * It exists because a bag's pay stopped being a constant. Every surface used to hard-code the flat
   * loading fee, which was true then and became a LIE the moment distance and contents entered the
   * arithmetic — understating a real job on the very screen where somebody says yes to it. Indicative
   * here, against this driver's current vehicle; locked at claim, exactly as a freight's price is.
   */
  earn?: number;
  /** BAGS ONLY — what the earning is made of: how many parcels are inside, and how full the bag is. See
   *  Claimable.parcels for why a figure without them is a figure taken on trust. */
  parcels?: number;
  fillPct?: number;
  createdAt: string;
  expiresAt: string;
  status: OfferStatus;
}
