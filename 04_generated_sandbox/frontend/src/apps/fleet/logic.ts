/**
 * Pure fleet domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The registry rules, the free-pool selectors and the map projection are harvested from
 * the legacy fleet.js so console and PWA can never disagree about who may drive what.
 */

import {
  HEAVY_CLASSES,
  type AssignmentRow,
  type DriverRow,
  type DriverStatus,
  type PositionRow,
  type SubtypeRow,
  type VehicleClass,
  type VehicleRow,
} from './types';

/* --------------------------------------------------------------- registry -- */

/** Any class beyond bike/motorcycle puts the driver in the heavy registry. */
export function isHeavySelection(classes: Iterable<string>): boolean {
  return [...classes].some((c) => (HEAVY_CLASSES as readonly string[]).includes(c));
}

/* ------------------------------------------------------------------ forms -- */

export interface VehicleForm {
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype: string;
  ownerType: string;
  ownerName: string;
  capacityKg: string;
  pricePerKm: string;
  registrationPhotoRef: string;
  factoryId: string;
}

export const EMPTY_VEHICLE: VehicleForm = {
  plate: '',
  vehicleClass: 'bike',
  truckSubtype: '',
  ownerType: 'driver_owned',
  ownerName: '',
  capacityKg: '',
  pricePerKm: '',
  registrationPhotoRef: '',
  factoryId: '',
};

/** The next thing the vehicle form needs, or null when it can submit. */
export function vehicleMissing(f: VehicleForm): string | null {
  if (!f.plate.trim()) return 'Type the number plate.';
  if (!f.ownerName.trim()) return 'Name the owner.';
  if (f.vehicleClass === 'truck' && !f.truckSubtype) return 'Pick the truck body.';
  return null;
}

export interface DriverForm {
  displayName: string;
  fullName: string;
  nationalId: string;
  mobile: string;
  classes: string[];
  licenceNumber: string;
  licenceExpiresAt: string;
  criminalRecordClear: boolean;
}

export const EMPTY_DRIVER: DriverForm = {
  displayName: '',
  fullName: '',
  nationalId: '',
  mobile: '',
  classes: ['bike'],
  licenceNumber: '',
  licenceExpiresAt: '',
  criminalRecordClear: false,
};

export function driverMissing(f: DriverForm): string | null {
  if (!f.displayName.trim()) return 'Give the driver a display name.';
  if (!f.fullName.trim()) return 'Type their full legal name.';
  if (!f.nationalId.trim()) return 'Type their national ID.';
  if (!f.mobile.trim()) return 'Type their mobile number.';
  if (f.classes.length === 0) return 'Pick at least one vehicle class.';
  if (isHeavySelection(f.classes) && !f.licenceNumber.trim()) return 'Heavy classes need the licence number.';
  return null;
}

export function toggleClass(classes: string[], c: string): string[] {
  return classes.includes(c) ? classes.filter((x) => x !== c) : [...classes, c];
}

/* ------------------------------------------------------------------ pools -- */

/** Drivers who can take a session now: ACTIVE and not already coupled. */
export function freeDrivers(drivers: DriverRow[], assignments: AssignmentRow[]): DriverRow[] {
  const coupled = new Set(assignments.map((a) => a.driverDid));
  return drivers.filter((d) => d.status === 'ACTIVE' && !coupled.has(d.did));
}

/** Vehicles free to be coupled: ACTIVE and not in an active assignment. */
export function freeVehicles(vehicles: VehicleRow[], assignments: AssignmentRow[]): VehicleRow[] {
  const coupled = new Set(assignments.map((a) => a.vehicleId));
  return vehicles.filter((v) => v.status === 'ACTIVE' && !coupled.has(v.vehicleId));
}

/* ------------------------------------------------------------------- map -- */

export interface MapPoint {
  x: number;
  y: number;
  plate: string;
  title: string;
}

/**
 * Project GPS positions into a 0–100 box with padding — the legacy console's projection,
 * kept pure so it is testable: clamped to 4–96 / 6–94 so a dot never clips the frame, and
 * a degenerate span (one vehicle) centres instead of dividing by zero.
 */
export function projectPositions(positions: PositionRow[]): MapPoint[] {
  const pts = positions ?? [];
  if (pts.length === 0) return [];
  const lats = pts.map((p) => p.location.lat);
  const lngs = pts.map((p) => p.location.lng);
  const pad = 0.05;
  const b = {
    minLat: Math.min(...lats) - pad,
    maxLat: Math.max(...lats) + pad,
    minLng: Math.min(...lngs) - pad,
    maxLng: Math.max(...lngs) + pad,
  };
  const span = (mx: number, mn: number) => mx - mn || 1;
  return pts.map((p) => ({
    x: Math.max(4, Math.min(96, ((p.location.lng - b.minLng) / span(b.maxLng, b.minLng)) * 100)),
    y: Math.max(6, Math.min(94, ((b.maxLat - p.location.lat) / span(b.maxLat, b.minLat)) * 100)),
    plate: p.plate,
    title: `${p.plate} · ${p.driverName} · ${p.vehicleClass}`,
  }));
}

/* ------------------------------------------------------------------ views -- */

export function shortDid(s: string | undefined | null): string {
  const v = s ?? '';
  return v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v || '—';
}

export function statusTone(status: DriverStatus | string): 'ok' | 'warn' | 'info' | 'danger' {
  switch (status) {
    case 'ACTIVE':
      return 'ok';
    case 'KYC_PENDING':
      return 'warn';
    case 'SUSPENDED':
      return 'danger';
    default:
      return 'info';
  }
}

/** What the trailing control on a driver row is — the manager's honest scope. */
export type DriverAction = 'submit-kyc' | 'awaiting-glos' | 'none';

export function driverAction(d: Pick<DriverRow, 'status' | 'registry'>): DriverAction {
  if (d.status === 'DRAFT' && d.registry === 'heavy') return 'submit-kyc';
  if (d.status === 'KYC_PENDING') return 'awaiting-glos';
  return 'none';
}

export function subtypeLine(sub: SubtypeRow | undefined): string | null {
  if (!sub) return null;
  const caps = [
    sub.coldChain && 'cold-chain',
    sub.bulk && 'dry-bulk',
    sub.liquid && 'liquid',
    sub.hazmat && 'hazmat',
    sub.oversized && 'oversized',
  ].filter(Boolean);
  return `${sub.label}: about ${sub.capacityKg} kg${caps.length ? ` · ${caps.join(', ')}` : ''}`;
}

export function hoursLabel(h: number | undefined): string {
  return `${h ?? 0}h`;
}

export function dashboardSummary(d: { drivers: { onShift?: number; total?: number }; cargo: { count?: number; totalKg?: number } }): string {
  return `${d.drivers.onShift ?? 0} of ${d.drivers.total ?? 0} drivers on shift. ${d.cargo.count ?? 0} loads moving, ${d.cargo.totalKg ?? 0} kilograms in total.`;
}
