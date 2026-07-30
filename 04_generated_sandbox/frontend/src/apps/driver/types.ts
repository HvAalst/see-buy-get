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

/** S33 — one confirmable safety-checklist line (mirrors the backend heavy-cargo SafetyItem). */
export interface SafetyItem {
  key: string;
  label: string;
}

/** S34 — the transparent price breakdown behind a freight offer/claim (B + D·R·M). */
export interface PriceBreakdown {
  baseFee: number;
  distanceKm: number;
  ratePerKm: number;
  multiplier: number;
  effectiveRate: number;
  total: number;
}

export interface Claimable {
  kind: ClaimKind;
  ref: string; // the API id used for pickup/load/deliver
  code?: string; // S32b — the human reference to show (TOTE-042 / FRT-007); ref for freight is an opaque id
  pickupLocation?: { lat: number; lng: number };
  pickupLabel: string;
  destLabel: string;
  weightKg: number;
  fragile?: boolean;
  bulk?: boolean;
  status?: string; // S32b — freight status (claimed | in_transit | …) drives the pickup/deliver control
  lockedPrice?: number; // S34 — the driver's agreed earning on a claimed freight (locked at claim)
  priceBreakdown?: PriceBreakdown; // S34 — the breakdown behind lockedPrice
  cargoClass?: string; // S33 — P4/P5/P6 (heavy badge)
  natureCode?: string; // S33 — the commodity nature (GEN…HUM)
  loadChecklist?: SafetyItem[]; // S33 — the load-safety items to confirm at pickup
  unloadChecklist?: SafetyItem[]; // S33 — the unload items to confirm at delivery
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
  /** S34 — the freight offer's price + transparent breakdown (absent on a tote offer). */
  price?: PriceBreakdown;
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
