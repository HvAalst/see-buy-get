// Dispatch marketplace types (Compendium Ch 19 — opportunistic line-haul). A driver declares a route
// A→B; the platform offers full/aged totes (and bulk freight) that sit near that route, sized to the
// remaining capacity of the driver's coupled vehicle. The driver claims, ignores, or lets it lapse.

import { GeoPoint } from './pudo.types';

export class RoutePlan {
  from: GeoPoint;
  to: GeoPoint;
  departAt?: string;
}

export type ClaimableKind = 'tote' | 'freight';
export type FreightStatus = 'available' | 'claimed' | 'in_transit' | 'delivered';

/** A bulk freight job (sugar/cement etc.) — trucks only, never via MDP. Same marketplace as totes. */
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
  status: FreightStatus;
  claimedBy?: string;
  createdAt: string;
}

/** A unit a driver can claim, normalised across totes and freight. */
export class Claimable {
  kind: ClaimableKind;
  ref: string; // toteCode | freightId
  pickupLocation: GeoPoint;
  pickupLabel: string;
  destLabel: string;
  weightKg: number;
  fragile: boolean;
  bulk: boolean;
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
