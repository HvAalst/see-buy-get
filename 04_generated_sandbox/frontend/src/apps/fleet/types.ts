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
}

export interface DriverRow {
  did: string;
  displayName: string;
  badgeId?: string;
  registry: 'light' | 'heavy';
  status: DriverStatus;
  licence?: { classes?: string[]; number?: string; expiresAt?: string };
  managerDid?: string;
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
  status: string;
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
}

export interface SessionRow {
  driverName: string;
  plate: string;
  vehicleClass: string;
  hoursOnDuty: number;
  location?: { lat: number; lng: number } | null;
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
}
