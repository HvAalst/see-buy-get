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

export interface AssignmentView {
  assignmentId: string;
  vehicleId: string;
  corridorId?: string;
  startedAt: string;
}

export interface SessionView {
  active: boolean;
  assignment?: AssignmentView;
  vehicle?: VehicleView;
}

export type ClaimKind = 'tote' | 'freight';

export interface Claimable {
  kind: ClaimKind;
  ref: string;
  pickupLocation?: { lat: number; lng: number };
  pickupLabel: string;
  destLabel: string;
  weightKg: number;
  fragile?: boolean;
  bulk?: boolean;
}

export interface ClaimsView {
  remainingCapacityKg: number;
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
  pins: unknown[];
}

export interface OfferView {
  offerId: string;
  kind: ClaimKind;
  ref: string;
  pickupLabel: string;
  pickupLocation?: { lat: number; lng: number };
  destLabel: string;
  weightKg: number;
  detourKm: number;
  minutesAway: number;
  /** Server-composed sentence — already plain language, show it verbatim. */
  message: string;
  createdAt: string;
  expiresAt: string;
  status: string;
}

export interface SuggestView {
  remainingCapacityKg: number;
  offers: OfferView[];
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
