// Dispatch marketplace types (Compendium Ch 19 — opportunistic line-haul). A driver declares a route
// A→B; the platform offers full/aged totes (and bulk freight) that sit near that route, sized to the
// remaining capacity of the driver's coupled vehicle. The driver claims, ignores, or lets it lapse.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoPoint } from './pudo.types';
import { CargoClass, CargoNature, Equipment, VehicleCapability } from './cargo.types';
import { TRUCK_SUBTYPES, TruckSubtype } from './fleet.config';

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
import { PriceBreakdown } from './pricing';
import { SafetyItem, TempBand, TempReading } from './heavy-cargo';

export class RoutePlan {
  from: GeoPoint;
  to: GeoPoint;
  departAt?: string;
}

export type ClaimableKind = 'tote' | 'freight';
// 'scheduled' — booked for a FUTURE pickup date; held out of the driver marketplace until due, then
// promoted to 'available' (the freight analogue of a tote that isn't full/aged yet).
export type FreightStatus = 'scheduled' | 'available' | 'claimed' | 'in_transit' | 'delivered';

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
  bodyHint?: TruckSubtype;
  /** Bodies the SHIPPER rules out — theft risk, an insurer's wording, a customer's requirement. A PREFERENCE,
   *  and typed as one: the board says "the shipper ruled out open bodies", never dressing it up as physics. */
  excludedBodies?: TruckSubtype[];
  /** FB0b — the body this load canonically needs, STAMPED at registration (and the basis it was derived on).
   *  Frozen rather than computed on read for the same reason a price is frozen at claim: "kilometres of
   *  flatbed offered in 2026" must not change when someone tunes a threshold in 2027. Absent on a pre-FB0b
   *  freight, which is derived live and reports itself as weight-only. */
  bodyDerived?: DerivedBody;
  fragile: boolean;
  bulk: boolean; // requires a bulk-capable vehicle (truck)
  // S32 — the freight's cargo model, so it matches vehicles like a tote does: class (drives required
  // equipment), primary nature (drives required vehicle capability), and the resolved requirements a
  // claiming vehicle must satisfy. `shipperDid` links the originator (a vendor whose P4+ order was diverted).
  cargoClass: CargoClass;
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
  lockedAt?: string;
  paidStatus?: 'unpaid' | 'billed' | 'billing_failed';
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
  status: FreightStatus;
  claimedBy?: string;
  createdAt: string;
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
  /** S34 — the haul destination coordinate, when known (freight sets it), so pricing can compute the
   *  pickup→dropoff leg. A tote carries only a dest label, so this stays undefined for totes. */
  destLocation?: GeoPoint;
  weightKg: number;
  fragile: boolean;
  bulk: boolean;
  /** S32b — the underlying tote/freight status (available | claimed | in_transit | …). Lets the driver app
   *  decide the next action on a claimed load: a claimed freight needs PICK-UP, an in-transit one needs DELIVER. */
  status?: string;
  /** F1 — a booked-for-later freight's pickup date, so the driver's offer reads "reserve now, pick up on <date>". */
  scheduledPickupAt?: string;
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
  weightKg: number;
  detourKm: number;
  minutesAway: number;
  message: string;
  /** S34 — the priced offer: the driver's earning + the transparent B + D·R·M breakdown. Freight only; a
   *  tote offer stays unpriced (totes settle on the pre-paid parcel model). */
  price?: PriceBreakdown;
  createdAt: string;
  expiresAt: string;
  status: OfferStatus;
}
