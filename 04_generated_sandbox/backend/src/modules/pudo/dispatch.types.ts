// Dispatch marketplace types (Compendium Ch 19 — opportunistic line-haul). A driver declares a route
// A→B; the platform offers full/aged totes (and bulk freight) that sit near that route, sized to the
// remaining capacity of the driver's coupled vehicle. The driver claims, ignores, or lets it lapse.

import { GeoPoint } from './pudo.types';
import { CargoClass, CargoNature, Equipment, VehicleCapability } from './cargo.types';
import { PriceBreakdown } from './pricing';
import { SafetyItem } from './heavy-cargo';

export class RoutePlan {
  from: GeoPoint;
  to: GeoPoint;
  departAt?: string;
}

export type ClaimableKind = 'tote' | 'freight';
export type FreightStatus = 'available' | 'claimed' | 'in_transit' | 'delivered';

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
  timeline!: Array<{ status: FreightStatus; at: string }>;
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
