/**
 * Local view types for the fleet app. Same contract stance as the other apps: honest view
 * types declared once, `narrow()` in api.ts as the single cast site. Field names mirror
 * backend fleet.types.ts / vehicle.service.ts / driver.service.ts and the fleet dashboard
 * controller mapping.
 */

export const VEHICLE_CLASSES = ['bike', 'motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

/** Classes that put a driver in the HEAVY registry (licence + KYC + vetting). */
export const HEAVY_CLASSES: readonly VehicleClass[] = ['tuktuk', 'car', 'van', 'bus', 'truck'];

export type DriverStatus = 'DRAFT' | 'KYC_PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface ManagerView {
  did: string;
  companyName: string;
  status: string;
  loginCode?: string;
}

/* ------------------------------------------------- FP4: the papers that switch things off -- */

export type { PaperKind, PaperState, PaperView } from '../../shared/papers';
import type { PaperKind, PaperView } from '../../shared/papers';

/** A paper on the dashboard's list: which thing, and whether it is on a shift the sweep will end. */
export interface PaperRow {
  subject: 'vehicle' | 'driver';
  id: string;
  label: string;
  kind: PaperKind;
  state: 'due' | 'lapsed';
  expiresAt?: string;
  daysLeft?: number;
  onShift: boolean;
}

export interface PapersReport {
  lapsed: PaperRow[];
  due: PaperRow[];
  /** Papers with a date that is neither due nor lapsed — so "nothing listed" can be told from "nothing recorded". */
  inDate: number;
  unrecorded: number;
}

export interface VehicleDocumentsView {
  registrationPhotoRef?: string;
  factoryId?: string;
  insuranceRef?: string;
  insuranceExpiresAt?: string;
  inspectionRef?: string;
  inspectionExpiresAt?: string;
}

export interface VehicleRow {
  vehicleId: string;
  qr: string;
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype?: string;
  capacityKg: number;
  pricePerKm: number;
  verified: boolean;
  status: string;
  managerDid?: string;
  vehiclePhotoRefs?: string[]; // S26 — mediaIds of the vehicle-body photos
  trailerPhotoRefs?: string[]; // S26 — mediaIds of a coupled trailer's photos
  /** FP4 — the owner's read carries the papers as recorded, their state today, and the lapsed ones in words. */
  documents?: VehicleDocumentsView;
  papers?: PaperView[];
  offRoad?: string[];
}

export interface DriverRow {
  did: string;
  displayName: string;
  badgeId?: string;
  registry: 'light' | 'heavy';
  status: DriverStatus;
  licence?: { classes?: string[]; number?: string; expiresAt?: string };
  managerDid?: string;
  /**
   * What this driver's VEHICLE RATE is costing them in work, today.
   *
   * It arrives on the manager's list and not on the driver's own card, because the price per km lives on
   * the vehicle and the vehicle is the manager's: telling a driver their price is losing them work when
   * they hold no way to change it is an accusation, not information.
   *
   * Their earnings FLOOR is deliberately absent. That is the driver's own decision about their own time,
   * and putting it in front of whoever schedules them turns a setting into a negotiation.
   */
  rateReach?: { overBudget: number; ratePerKm?: number; rateLooksHigh: boolean };
  /** FP4 — the licence's state today, and why no shift can start when it has lapsed. */
  papers?: PaperView[];
  offRoad?: string[];
}

export interface AssignmentRow {
  assignmentId: string;
  driverDid: string;
  vehicleId: string;
  corridorId?: string;
  startedAt: string;
}

export interface CorridorRow {
  corridorId: string;
  name: string;
  originZone: string;
  destZone: string;
  /** proposed (a fleet's line waiting for the network) · active · blocked */
  status: string;
  /** Absent for the network's own corridors. */
  owner?: { kind: 'fleet'; managerDid: string; company: string };
  vehicleType?: 'bus' | 'truck';
  schedule?: string;
  note?: string;
}

export interface SubtypeRow {
  id: string;
  label: string;
  capacityKg: number;
  coldChain?: boolean;
  bulk?: boolean;
  liquid?: boolean;
  hazmat?: boolean;
  oversized?: boolean;
}

export interface PositionRow {
  plate: string;
  driverName: string;
  vehicleClass: string;
  hoursOnDuty: number;
  location: { lat: number; lng: number };
  /** When that position was reported. Absent on a record from before it was stamped. */
  lastLocatedAt?: string;
}

export interface SessionRow {
  driverName: string;
  plate: string;
  vehicleClass: string;
  hoursOnDuty: number;
  location?: { lat: number; lng: number } | null;
  lastLocatedAt?: string;
}

export interface CargoRow {
  ref: string;
  kind: string;
  weightKg: number;
  destLabel: string;
  driver: string;
  status: string;
}

export interface DashboardView {
  vehicles: { total?: number; active?: number };
  drivers: { total?: number; onShift?: number; offShift?: number };
  sessions: { active?: number; todayHours?: number; list?: SessionRow[] };
  positions?: PositionRow[];
  cargo: { count?: number; totalKg?: number; items?: CargoRow[] };
  /** FP4 — what is off the road and what is running out, from the same rules the six-hourly sweep enforces. */
  papers?: PapersReport | null;
}

/* ------------------------------------------------- FP1: the fleet's earnings register -- */

export interface FleetJobRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  status: 'available' | 'claimed' | 'in_transit' | 'delivered' | string;
  cargoClass: string;
  weightKg: number;
  earning?: number;
  /** BOOKED by the network at delivery — owed to the fleet, not yet money that moved. */
  paid: boolean;
  claimedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  driverDid: string;
  driverName: string;
}

export interface FleetEarningsSummary {
  earned: number;
  paid: number;
  unpaid: number;
  delivered: number;
  count: number;
  byDriver: Array<{ driverDid: string; driverName: string; earned: number; delivered: number; count: number }>;
  byMonth: Array<{ month: string; earned: number; delivered: number; count: number }>;
  /** The money, apart from the register: booked as owed (null where no sister pays this fleet), on its way, left. */
  settlement?: { payeeDid: string; owed: number | null; settled: number; inFlight: number; currency?: string };
}
