// Dispatch marketplace types (Compendium Ch 19 — opportunistic line-haul). A driver declares a route
// A→B; the platform offers full/aged totes (and bulk freight) that sit near that route, sized to the
// remaining capacity of the driver's coupled vehicle. The driver claims, ignores, or lets it lapse.

export interface RoutePlan {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  departAt?: string;
}

export type ClaimableKind = 'tote' | 'freight';
export type FreightStatus = 'available' | 'claimed' | 'in_transit' | 'delivered';

/** A bulk freight job (sugar/cement etc.) — trucks only, never via MDP. Same marketplace as totes. */
export interface Freight {
  freightId: string;
  code: string; // human-readable reference
  description: string;
  pickupLocation: { lat: number; lng: number };
  pickupLabel: string;
  destLabel: string;
  destLocation?: { lat: number; lng: number };
  weightKg: number;
  fragile: boolean;
  bulk: boolean; // requires a bulk-capable vehicle (truck)
  status: FreightStatus;
  claimedBy?: string;
  createdAt: string;
}

/** A unit a driver can claim, normalised across totes and freight. */
export interface Claimable {
  kind: ClaimableKind;
  ref: string; // toteCode | freightId
  pickupLocation: { lat: number; lng: number };
  pickupLabel: string;
  destLabel: string;
  weightKg: number;
  fragile: boolean;
  bulk: boolean;
}

export type OfferStatus = 'pending' | 'claimed' | 'ignored' | 'expired';

/** A suggestion pushed to a driver: "≈N min from <place>, a shipment is ready — claim it?" */
export interface Offer {
  offerId: string;
  driverDid: string;
  kind: ClaimableKind;
  ref: string;
  pickupLabel: string;
  pickupLocation: { lat: number; lng: number };
  destLabel: string;
  weightKg: number;
  detourKm: number;
  minutesAway: number;
  message: string;
  createdAt: string;
  expiresAt: string;
  status: OfferStatus;
}
