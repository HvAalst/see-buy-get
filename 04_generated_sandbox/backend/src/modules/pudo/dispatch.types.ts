// Dispatch marketplace types (Compendium Ch 19 — opportunistic line-haul). A driver declares a route
// A→B; the platform offers full/aged totes (and bulk freight) that sit near that route, sized to the
// remaining capacity of the driver's coupled vehicle. The driver claims, ignores, or lets it lapse.

import { GeoPoint } from './pudo.types';
import { CargoClass, CargoNature, Equipment, VehicleCapability } from './cargo.types';

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
  createdAt: string;
  expiresAt: string;
  status: OfferStatus;
}
