// Dispatch marketplace types (Compendium Ch 19 — opportunistic line-haul). A driver declares a route
// A→B; the platform offers full/aged totes (and bulk freight) that sit near that route, sized to the
// remaining capacity of the driver's coupled vehicle. The driver claims, ignores, or lets it lapse.

import { ClientRef } from './business-client.types';
import { ContractRef } from './carriage-contract.types';
import { PlannedOn } from './fleet-plan.types';
import { BorderAdvice } from './border-rules.types';
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
/**
 * `ordered` — P1: an order placed under a standing contract with ONE fleet. It is that fleet's to plan and put on a
 * truck, and on no market: a status rather than a flag, so that every board, offer, nudge and market series — which
 * all read `available` — leaves it out without having to be told, including the ones written after this.
 */
export const FREIGHT_STATUSES = ['scheduled', 'available', 'ordered', 'claimed', 'in_transit', 'delivered', 'cancelled'] as const;
export type FreightStatus = (typeof FREIGHT_STATUSES)[number];

/** FP3b — a delivery the driver could not make: they were there, the goods were not handed over, and why. */
export const DELIVERY_FAILURES = ['absent', 'refused', 'unreachable'] as const;
export type DeliveryFailure = (typeof DELIVERY_FAILURES)[number];
export class FreightDeliveryAttempt {
  @ApiProperty({ enum: DELIVERY_FAILURES })
  outcome: DeliveryFailure;
  note?: string;
  at: string;
  by?: string;
}

/**
 * FP7 — the sender's instructions: CMR box 13. Free text for the door ("call Joseph on arrival", "gate on the
 * north side"), plus the two things something else has to ACT on and so are fields of their own: a contact the
 * driver can dial, and a delivery window the office can dispatch against. The phone is a field so it can be
 * redacted from the public tracking page — free text cannot be.
 */
export class FreightInstructions {
  text?: string;
  contactName?: string;
  contactPhone?: string;
  deliveryWindow?: string;
  at: string;
  by?: string;
}

/** FP7 — a "subsequent instruction" (CMR practice): given while the goods are on the road, appended never overwritten. */
export class FreightInstructionAmendment {
  text: string;
  at: string;
  by?: string;
}

/** FP7 — the instructions as the driver, the sender and the office read them. */
export class FreightInstructionsView {
  text?: string;
  contactName?: string;
  contactPhone?: string;
  deliveryWindow?: string;
  at?: string;
  @ApiPropertyOptional({ type: [FreightInstructionAmendment] }) amendments?: Array<Pick<FreightInstructionAmendment, 'text' | 'at'>>;
}

/** FP3b — what the sender says went wrong with a delivered load. */
export const FREIGHT_CLAIM_KINDS = ['damaged', 'short', 'not_received'] as const;
export type FreightClaimKind = (typeof FREIGHT_CLAIM_KINDS)[number];
export const FREIGHT_CLAIM_DECISIONS = ['upheld', 'partly_upheld', 'rejected'] as const;
export type FreightClaimDecision = (typeof FREIGHT_CLAIM_DECISIONS)[number];

/**
 * FP3b — the claim against a delivered load. The freight analogue of the parcel's DisputeCase, with one
 * difference that matters: a freight has no declared cover, so an award can only come from the provision the
 * sender's charge carried — and where nobody was billed through the network there is nothing to award from,
 * only a decision with a reason.
 */
export class FreightClaim {
  state: 'open' | 'resolved';
  @ApiProperty({ enum: FREIGHT_CLAIM_KINDS })
  kind: FreightClaimKind;
  description: string;
  photoRef?: string;
  raisedBy: string;
  raisedAt: string;
  @ApiPropertyOptional({ enum: FREIGHT_CLAIM_DECISIONS })
  decision?: FreightClaimDecision;
  award?: number;
  note?: string;
  decidedBy?: string;
  decidedAt?: string;
  funding?: { fromProvision: number; fromExpense: number };
  paidTo?: { kind: 'vendor' | 'between_parties'; id?: string };
}

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
  /**
   * HOW TALL THE LOAD STANDS ON A DECK, in metres — the half the bridge map never had.
   *
   * `dimensionsCm` cannot answer this: it is orientation-free by design, so nothing can tell which of the
   * three numbers is the height. Dispatch has carried a comment since the hazard map shipped explaining
   * why it passed NO height at all — "a 4.0 m load is 5.2 m on a flatbed and 4.4 m on a lowboy" — and
   * this is one of the two numbers that comment was waiting for. The other is the vehicle's deck.
   *
   * Absent means unknown, and unknown stays HEIGHT_UNKNOWN against a low bridge rather than becoming a
   * pass. A 40ft high-cube sets it from the container catalogue; an open top sets it from the declared
   * cargo height, because the box's own figure is the floor the cargo sits on.
   */
  @ApiPropertyOptional()
  heightM?: number;
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
  /** CA6 — the country at each end, where it is known (a shop's), so the rules of crossing can be asked. */
  @ApiPropertyOptional() pickupCountry?: string;
  @ApiPropertyOptional() destCountry?: string;
  /**
   * FP2 — WHO took the goods over and IN WHAT, fixed at pickup for the consignment note. Read live it would follow
   * the driver's later shifts; a note must name the vehicle that carried this load.
   */
  @ApiPropertyOptional() carriage?: { vehicleId: string; plate: string; vehicleClass: string; driverDid: string; managerDid?: string; at: string };
  /** FP3 — proof of delivery: who took the goods in, the driver's photo of them as put down, and what the receiver
   *  said about them. This is box 24 of the consignment note; without it "delivered" is only the driver's word. */
  @ApiPropertyOptional() proofOfDelivery?: { receiverName: string; photoRef?: string; remarks?: string; at: string; by?: string };
  /** FP3 — the carrier's reservations about the goods as handed over at taking over (box 18): a torn sack, a
   *  short count, a wet pallet. Written by the driver at pickup, before the goods are theirs to answer for. */
  @ApiPropertyOptional() reservations?: { note: string; at: string; by?: string };
  /** FP3 — withdrawn by the sender (or the network) before the goods were taken over. Terminal; the record stays. */
  @ApiPropertyOptional() cancelledAt?: string;
  @ApiPropertyOptional() cancellation?: { by: string; role: 'shipper' | 'operator'; reason: string; at: string; refunded?: number };
  /** FP3b — every time the driver stood at the door and could not hand over. The load stays in transit. */
  @ApiPropertyOptional({ type: [FreightDeliveryAttempt] }) deliveryAttempts?: FreightDeliveryAttempt[];
  /** FP3b — the sender's claim against the delivered goods, and how it ended. One per load. */
  @ApiPropertyOptional({ type: FreightClaim }) claim?: FreightClaim;
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
  /**
   * Y2 — THE BOX THIS LEG IS CARRYING, where the load is a container rather than goods in one.
   *
   * Kept on the leg as well as on the box because the board reads it: a haulier deciding whether to take
   * a run wants to know it is a box going home, and a driver wants to know before they arrive.
   */
  containerNo?: string;
  /**
   * TRUE WHERE THERE IS NOTHING IN IT — an empty container being repositioned.
   *
   * Said out loud rather than inferred from a small weight, and never dressed up as freight: an empty run
   * is real work with no cargo to bill, and a board that quietly published it as a load would be lying to
   * the driver who takes it. The weight is the box's own tare, which is painted on its door.
   */
  emptyRun?: boolean;
  /**
   * UNDER BOND — the goods are in the country and have not entered it.
   *
   * A container discharged at a coastal port and cleared inland travels the first leg before any customs
   * entry is made: no duty has been paid, and the movement runs under a transporter's transit licence
   * with a bond standing behind what would be owed if the box never arrived. It is a different job from
   * the delivery that follows release, and only a carrier licensed for it may take it.
   *
   * `bondCountry` is where that licence has to be held, which is the country the leg runs inside.
   */
  bonded?: boolean;
  bondCountry?: string;
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
  /**
   * B2 — WHO SETTLES THIS HAUL, stamped when it is posted and never re-derived.
   *
   * `between_parties`: the shipper pays the carrier directly, or through its own payment network, and nothing is
   * accrued for the carrier on any of our books at delivery. Every load a customer's business posts is this (the
   * user, 2026-10-04: "we don't handle their payments at all"). Absent: the network's older rule — a carrier we
   * contract with is owed their earning on delivery whoever the shipper was.
   */
  @ApiPropertyOptional({ enum: ['between_parties'] }) settlement?: 'between_parties';
  /** Which person in a business posted it — the business's DID is shared by everybody in it. */
  @ApiPropertyOptional() postedByName?: string;
  /** B4 — the client an expeditor sent this for, as their agent. The client is the SENDER on the note. A copy, not a link. */
  @ApiPropertyOptional({ type: ClientRef }) onBehalfOf?: ClientRef;
  /**
   * P1 — the standing contract this order was placed under: which fleet must carry it, for whom. A copy, stamped when
   * it was ordered, so the papers never change if either side renames itself or the contract later ends.
   */
  @ApiPropertyOptional({ type: ContractRef }) contract?: ContractRef;
  /** P1 — the calendar day a contract order must ARRIVE. What the fleet plans against, and what makes it late. */
  @ApiPropertyOptional() deliverOn?: string;
  /**
   * P1b — the SHIPPER's own number for this order (a webshop's order number). Kept apart from `externalOrderId`, which
   * names a shop order or a consignment and makes the consignee "the buyer of order …, collecting at a shop". Under one
   * contract a number is used once: it is what makes uploading the same sheet twice harmless.
   */
  @ApiPropertyOptional() orderRef?: string;
  /**
   * P3 — the truck and trip this order is on in the plan its fleet accepted for its day. A plan, not a fact about the
   * goods: it goes on a driver only when the office sends that trip out. Rewritten when the day is planned again.
   */
  @ApiPropertyOptional({ type: PlannedOn }) planned?: PlannedOn;
  /**
   * WHO the network owed for this haul, and on whose books — fixed when it was accrued at delivery. A claim
   * upheld weeks later takes the money back from this same party: never from whichever fleet the driver has
   * moved to since, which carried nothing and was paid nothing for it. Absent where nothing was accrued.
   */
  @ApiPropertyOptional() driverPayee?: { payeeDid: string; entityId: string };
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
   * THE CARRIER OF RECORD — the party the network contracted with when the job was taken: the driver's fleet,
   * or the driver themselves when they drive for nobody. Fixed at the claim, like the price and the body.
   *
   * Only the driver used to be recorded, so "whose job was this" was answered from the driver's fleet TODAY.
   * The day a driver can move to another fleet that answer changes under every haul they ever did: the old
   * fleet's earnings statement — the list its payday is reconciled against — loses them, and the new fleet
   * reads a competitor's customers and prices. A history keyed to the present is not a history.
   * Absent on a load claimed before it was recorded, which is read from the driver as it always was.
   */
  @ApiPropertyOptional() carrierDid?: string;
  /** FP5 — when the load was put on the driver by their fleet office rather than claimed by them. Who, and when. */
  @ApiPropertyOptional() assignedBy?: { managerDid: string; name?: string; at: string };
  /** FP6 — the shipper's rating of the carrier after delivery: stars, the tags, and when. One per load, last wins. */
  @ApiPropertyOptional() rating?: { stars: number; issues: string[]; at: string; by: string };
  /** FP8 — every time a driver gave this load back before pickup: who, why, when. The load went back on the market. */
  /**
   * CL1 — the trade term the two parties agreed, and the place it names. Recorded, never inferred: it is a
   * term of THEIR sale contract, and guessing it would be guessing who owns a loss.
   *
   * It changes exactly one thing in this system, and that thing is money: who may claim when the goods are
   * damaged in transit. See riskBearerOf in foundation/incoterms/catalogue.
   */
  @ApiPropertyOptional() incoterm?: string;
  @ApiPropertyOptional() namedPlace?: string;
  /** Each hand-back names the driver and the carrier they gave it back for (absent on one recorded before that was kept). */
  @ApiPropertyOptional() handBacks?: Array<{ driverDid: string; carrierDid?: string; reason: string; at: string }>;
  /** FP8 — what the carrier bore of an upheld claim, taken back from what they were paid for the haul. */
  @ApiPropertyOptional() clawback?: { amount: number; at: string; note: string };
  /** FP7 — CMR box 13, as given at posting (or edited before the goods were taken over). */
  @ApiPropertyOptional({ type: FreightInstructions }) instructions?: FreightInstructions;
  /** FP7 — subsequent instructions, given while the goods are on the road. Appended, never overwritten. */
  @ApiPropertyOptional({ type: [FreightInstructionAmendment] }) instructionAmendments?: FreightInstructionAmendment[];
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
/**
 * P1 — ONE ORDER IN A FLEET'S QUEUE, as the office plans from it: what, from where to where, for which day, and how
 * far it has got. Read by the fleet that must carry it, and nobody else.
 */
export class FleetOrderRow {
  freightId: string;
  code: string;
  @ApiProperty({ type: ContractRef }) contract: ContractRef;
  /** The shipper's own order number, where it gave one. */
  @ApiPropertyOptional() orderRef?: string;
  /** Whether this fleet's office uploaded it (and so may withdraw it) rather than the shipper ordering it. */
  uploaded: boolean;
  /** P3 — where the accepted plan for its day puts it. */
  @ApiPropertyOptional({ type: PlannedOn }) planned?: PlannedOn;
  /** The day it must arrive. */
  deliverOn: string;
  @ApiPropertyOptional() deliveryWindow?: string;
  description: string;
  weightKg: number;
  @ApiProperty({ enum: PACKAGING }) packaging: Packaging;
  pickupLabel: string;
  pickupLocation: GeoPoint;
  destLabel: string;
  @ApiPropertyOptional() destLocation?: GeoPoint;
  @ApiProperty({ enum: FREIGHT_STATUSES }) status: FreightStatus;
  /** Who in the shipper's business ordered it, and the client an expeditor ordered it for. */
  @ApiPropertyOptional() postedByName?: string;
  @ApiPropertyOptional({ type: ClientRef }) onBehalfOf?: ClientRef;
  /** On a truck: who drives it and which vehicle. */
  @ApiPropertyOptional() driverName?: string;
  @ApiPropertyOptional() plate?: string;
  createdAt: string;
  @ApiPropertyOptional() claimedAt?: string;
  @ApiPropertyOptional() pickedUpAt?: string;
  @ApiPropertyOptional() deliveredAt?: string;
  @ApiPropertyOptional() receiverName?: string;
  @ApiPropertyOptional() cancelledAt?: string;
  /** Its delivery day is over and it has not arrived. Computed on the server's clock, never typed. */
  late: boolean;
  trackingKey: string;
  trackingUrl: string;
}

export class FleetOrderList {
  @ApiProperty({ type: [FleetOrderRow] }) items: FleetOrderRow[];
  total: number;
}

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
  /** FP7 — the sender's delivery window, the one instruction a dispatcher decides against. Never the contact. */
  deliveryWindow?: string;
  /** Y2 — the container this leg carries, where the load IS a box. */
  containerNo?: string;
  /** Y2 — an empty box going home. Real work, no cargo, and it says so on the board rather than reading
   *  like freight with a suspiciously small weight. */
  emptyRun?: boolean;
  /** BL1 — uncleared goods, carried under a transit licence. Said on the board, because a driver who
   *  cannot take it is entitled to know that before tapping it, and one who can should see the job. */
  bonded?: boolean;
  bondCountry?: string;
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
  /** CL3 — posted in the window and then WITHDRAWN by the shipper. Counted here and excluded from unmet,
   *  because a load nobody was asked to carry is not demand the fleet failed to meet. */
  cancelledLoads: number;
  /**
   * CL3 — posted in the window, still standing, and claimed by somebody at some point.
   *
   * The ONLY figure that completes the posted population: `offeredLoads` = metLoads + unmetLoads +
   * cancelledLoads, exactly, always. `movedLoads` cannot do that job and must not be read as if it could —
   * it counts loads CLAIMED in the window whenever they were posted, so it answers a different question over
   * a different population. Both are real (see `buildSeries`), but only this one partitions what was asked
   * for, and a screen that shows moved beside unmet and withdrawn invites a reader to add three numbers that
   * come to more than the total above them.
   */
  metLoads: number;
}

/**
 * CL3 — ONE DAY of the market: what was asked for, and what the fleet took.
 *
 * The windowed totals answer "how big was the market"; only a day-by-day line answers "is it turning". A
 * fleet withdrawing capacity does not change what shippers post — it changes how much of it gets taken, and
 * that separation is only visible with the two counts side by side, per day.
 */
export class MarketDay {
  /** The day these counts fell in, YYYY-MM-DD in UTC. */
  day: string;
  /** Loads POSTED on this day. */
  postedLoads: number;
  /** Loads CLAIMED on this day — not necessarily the same loads. */
  claimedLoads: number;
  postedKm: number;
  claimedKm: number;
}

/**
 * CL3 — HOW LONG THE MARKET IS TAKING TO ANSWER, this window against the one before it.
 *
 * The clearest early sign of scarcity that needs nobody to report anything: when trucks get scarce, loads
 * still get posted and still get taken, but they wait longer first. Measured on loads CLAIMED in the window
 * (a load still sitting open has no time-to-claim yet, and treating its age as one would understate the
 * wait exactly when it is growing).
 */
export class TimeToClaim {
  /** Median hours from posting to claim. Null when nothing was claimed in the window. */
  medianHours: number | null;
  loads: number;
  /** The same figure for the window of equal length immediately before this one. */
  priorMedianHours: number | null;
  priorLoads: number;
  /** True only when BOTH windows have a median, BOTH are above the thin threshold, and it has lengthened
   *  materially. A claim this strong is never made on a guess. */
  stretching: boolean;
  /** Either window is too small to carry the claim. The figures are still shown; the flag says how far to
   *  trust them. */
  thin: boolean;
}

/**
 * CL3 — WHAT NEGOTIATED LOADS ACTUALLY CLEARED AT, against what the rate stack said.
 *
 * Only negotiated loads can answer this, and that is not a limitation but the whole point: a load taken at
 * the computed price IS the rate stack, so including those would drag every ratio towards 1 and hide the
 * signal. Where two parties agreed a number instead, the gap between what was agreed and what the stack
 * would have charged is the market telling you what a truck was worth that day.
 */
export class PriceVsStack {
  /** Loads with a negotiated price AND a computed one to compare it against. */
  loads: number;
  /** Median agreed ÷ computed. Above 1 means shippers paid over the stack to get a truck. */
  medianRatio: number | null;
  thin: boolean;
}

/**
 * CL3 — ONE LANE, town to town, this window against the one before.
 *
 * A lane is named from the two ends by the same gazetteer the public market uses to coarsen a pickup, so a
 * lane here reads the same as an area there. An end we cannot name honestly is 'unknown' rather than
 * snapped to the nearest big town — the never-infer rule, applied to places instead of bodies.
 */
export class LaneSeries {
  /** "Nairobi → Mombasa". Either end may be 'unknown'. */
  lane: string;
  from: string;
  to: string;
  /**
   * Where the two ends are, so a lane can be drawn and a radius can be measured.
   *
   * ABSENT WHERE THE END IS 'unknown' — a load more than 60 km from anywhere the gazetteer knows has no
   * honest place name and therefore no honest dot, and a lane with one is still a real lane. The reader
   * must keep it in the list and say it cannot be placed, never drop it for being unplottable.
   *
   * These are the gazetteer's CENTROIDS, not the loads' own coordinates. Two different lanes inside one
   * neighbourhood share a dot, which is the coarsening working rather than the map failing.
   */
  @ApiPropertyOptional()
  fromPoint?: GeoPoint;
  @ApiPropertyOptional()
  toPoint?: GeoPoint;
  postedLoads: number;
  claimedLoads: number;
  priorPostedLoads: number;
  /** Posting fell materially against the window before, and both windows are above the thin threshold. */
  quiet: boolean;
  thin: boolean;
}

/**
 * ONE CARRIER ON ONE LANE — who took the load, what they moved there, and where their page is.
 *
 * A FLEET OR AN OWNER-DRIVER, because those are the two kinds of party the network contracts with and
 * therefore the two kinds that hold a handle. A driver employed by a fleet is never named here: the load
 * was taken from their fleet, and the fleet's page speaks for it.
 */
export class LaneCarrier {
  name: string;
  @ApiProperty({ enum: ['fleet', 'driver'] })
  kind: 'fleet' | 'driver';
  /** Their page at /@handle. Absent only where the directory has not issued one yet. */
  @ApiPropertyOptional()
  handle?: string;
  /** Loads on this lane claimed by them inside the window. */
  loads: number;
}

/** Who carried on one lane in one window. Alphabetical, never ranked; the basis says what it counted. */
export class LaneCarriers {
  lane: string;
  from: string;
  to: string;
  /** Every load on this lane that was CLAIMED in the window — the sum the rows below are drawn from. */
  claimedLoads: number;
  @ApiProperty({ type: [LaneCarrier] })
  carriers: LaneCarrier[];
  /**
   * Loads whose claim stamped no carriage at all — no fleet and no driver.
   *
   * It should be zero. It is carried anyway so the rows above always add up to `claimedLoads`, which is
   * how anybody would notice if it stopped being zero.
   */
  unattributedLoads: number;
  /** One sentence naming what was counted, shown verbatim. A list with no basis reads as a ranking. */
  basis: string;
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
  /* ---- CL3: scarcity, all of it derived from timestamps the loads already carry ---- */
  /** One row per day in the window, oldest first. */
  @ApiProperty({ type: [MarketDay] })
  days: MarketDay[];
  timeToClaim: TimeToClaim;
  priceVsStack: PriceVsStack;
  /** Busiest lane first. */
  @ApiProperty({ type: [LaneSeries] })
  lanes: LaneSeries[];
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
  /** B4 — the client an expeditor sent this for, as their agent. The client is the SENDER on the note. A copy, not a link. */
  @ApiPropertyOptional({ type: ClientRef }) onBehalfOf?: ClientRef;
  /** P1 — ordered under a standing contract: with which fleet, and the day it must arrive. */
  @ApiPropertyOptional({ type: ContractRef }) contract?: ContractRef;
  @ApiPropertyOptional() deliverOn?: string;
  @ApiPropertyOptional() orderRef?: string;
  /** Set once the load is taken, so the poster sees the outcome without a second call. */
  agreedPrice?: number;
  /** FP3 — the journey's stamps, so the list can say "on the road since", "delivered to", "cancelled". */
  pickedUpAt?: string;
  deliveredAt?: string;
  /** FP3 — who signed for the goods (box 24), once delivered. */
  receiverName?: string;
  cancelledAt?: string;
  /** FP3 — true while the sender may still withdraw the load: before the goods are taken over. */
  canCancel: boolean;
  /** FP3b — the door the driver stood at and could not hand over at, most recent last. */
  @ApiPropertyOptional({ type: [FreightDeliveryAttempt] }) attempts?: FreightDeliveryAttempt[];
  /** FP3b — the sender's claim, as far as it has got. */
  @ApiPropertyOptional({ type: FreightClaim }) claim?: FreightClaim;
  /** FP6 — the shareable key behind the tracking link, and the link itself, so the shipper can hand it on. */
  trackingKey?: string;
  trackingUrl?: string;
  /** FP6 — who is carrying it, once taken: the driver's display name and the plate. No phone, no fleet internals. */
  @ApiPropertyOptional() carrier?: { driverName?: string; plate?: string; vehicleClass?: string };
  /** FP6 — the shipper's rating, once given. */
  @ApiPropertyOptional() rating?: { stars: number; issues: string[]; at: string };
  /** FP6 — true while the shipper may rate: delivered, within the rating window. Re-rating is allowed (last wins). */
  canRate: boolean;
  /** FP8 — the times a driver handed this load back before pickup, most recent last. Reason and time only. */
  /** CL1 — the agreed term, the place it names, and who it puts the loss on. */
  @ApiPropertyOptional() incoterm?: string;
  @ApiPropertyOptional() namedPlace?: string;
  @ApiPropertyOptional({ enum: ['sender', 'receiver'] }) claimant?: 'sender' | 'receiver';
  @ApiPropertyOptional() handBacks?: Array<{ reason: string; at: string }>;
  /** FP7 — the sender's own instructions, and whether they can still be rewritten (before pickup) or only added to. */
  @ApiPropertyOptional({ type: FreightInstructionsView }) instructions?: FreightInstructionsView;
  @ApiProperty({ enum: ['edit', 'amend', 'none'] })
  instructionsMode: 'edit' | 'amend' | 'none';
  /** FP3b — true while the sender may still claim: delivered, no claim yet, within the claim window. */
  canClaim: boolean;
}

/** FP3b — what the sender gets back for opening a claim. */
export class FreightClaimResponse {
  freightId: string;
  code: string;
  @ApiProperty({ type: FreightClaim })
  claim: FreightClaim;
}

/** FP3b — one open freight claim as the operator's queue reports it. */
export class FreightClaimQueueRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  @ApiProperty({ enum: FREIGHT_CLAIM_KINDS })
  kind: FreightClaimKind;
  reason: string;
  raisedAt: string;
  raisedBy: string;
  senderName: string;
  carrierName?: string;
  /** What the sender paid for carriage through the network, if anything — a figure, never a cap. */
  carriage?: number;
  /** FP8 — what the network paid the carrier for the haul (accrued at delivery); an upheld award is taken back up to this. */
  @ApiPropertyOptional() carrierPaid?: number;
  /** CL1 — the agreed trade term, and who it puts a loss in transit on. Absent where no term was recorded. */
  @ApiPropertyOptional() incoterm?: string;
  @ApiPropertyOptional({ enum: ['sender', 'receiver'] }) claimant?: 'sender' | 'receiver';
  /** CL1 — why that party has standing, in the words the console shows beside the decision. */
  @ApiPropertyOptional() standingWhy?: string;
  currency?: string;
  /** Whether a sister billed this load and so holds a provision to award from. False = decide with a reason only. */
  coverable: boolean;
  awardCap: number;
  @ApiProperty({ enum: ['sanity-bound', 'none'] })
  capBasis: 'sanity-bound' | 'none';
  evidence: string[];
  attempts: number;
  receiverName?: string;
}

/** FP3 — what a sender gets back for withdrawing a load: never the freight record (it carries the buyer's hash). */
export class FreightCancelledResponse {
  freightId: string;
  code: string;
  @ApiProperty({ enum: FREIGHT_STATUSES })
  status: FreightStatus;
  cancelledAt: string;
  /** The charge handed back to a billed sender, when there was one. */
  refunded?: number;
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
  /** FP5 — put on this driver by their fleet office (by whom, when), so the app can say it was not their choice. */
  @ApiPropertyOptional() assignedBy?: { name?: string; at: string };
  /** FP7 — the sender's instructions for the door, with a contact to dial. Only the driver holding the load reads them. */
  @ApiPropertyOptional({ type: FreightInstructionsView }) instructions?: FreightInstructionsView;
  /** F1 — a booked-for-later freight's pickup date, so the driver's offer reads "reserve now, pick up on <date>". */
  scheduledPickupAt?: string;
  /** CA6 — the country at each end of a freight, where it is known. */
  pickupCountry?: string;
  destCountry?: string;
  /** BL1 — uncleared goods, and the country whose transit licence carrying them needs. */
  bonded?: boolean;
  bondCountry?: string;
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
  /** CA6 — for a load that crosses a border: where it may cross, when, what to carry, and the limits. */
  @ApiPropertyOptional({ type: BorderAdvice }) border?: BorderAdvice;
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

/* ------------------------------------------------------ FP6: the public tracking view of a load -- */

/** One rung of a load's journey, as the public tracking page draws it. */
export class FreightTrackStep {
  @ApiProperty({ enum: FREIGHT_STATUSES })
  status: FreightStatus;
  at: string;
}

/**
 * FP6 — a load as the holder of its tracking link sees it: the journey, the carrier as they would meet
 * them at the door, and nothing that identifies a person beyond that. No phone hash, no note text, no
 * money, no proposals — the KEY is the credential, and a key can be forwarded.
 */
export class FreightTrackView {
  @ApiProperty({ enum: ['freight'] })
  kind: 'freight';
  /** The human reference (FRT-018). */
  ref: string;
  @ApiProperty({ enum: FREIGHT_STATUSES })
  status: FreightStatus;
  description: string;
  weightKg: number;
  pickupLabel: string;
  destLabel: string;
  destLocation?: GeoPoint;
  scheduledPickupAt?: string;
  /** Who is carrying it, once taken — the company, the driver's display name, the vehicle. */
  @ApiPropertyOptional() carrier?: { name: string; driverName?: string; plate?: string; vehicleClass?: string };
  @ApiProperty({ type: [FreightTrackStep] })
  steps: FreightTrackStep[];
  /** The doors the driver stood at and could not hand over at, most recent last. Outcome and time only. */
  @ApiPropertyOptional({ type: [FreightDeliveryAttempt] }) attempts?: Array<Pick<FreightDeliveryAttempt, 'outcome' | 'at'>>;
  /** Who took the goods in, once delivered — the name the driver recorded, as it stands on the consignment note. */
  receiverName?: string;
  /** Withdrawn: when, and by the sender, the network or — on a run — the carrier. Never the reason: that is between the parties. */
  @ApiPropertyOptional() cancelled?: { at: string; by: 'sender' | 'network' | 'carrier' };
  /**
   * Where the goods travel: `board` a load a carrier took off the open board (absent means this) · `run` space
   * booked on a carrier's scheduled run, which leaves at `scheduledPickupAt` whether or not anybody else is aboard.
   */
  @ApiPropertyOptional({ enum: ['board', 'run'] }) on?: 'board' | 'run';
}
