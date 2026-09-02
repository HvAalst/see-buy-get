/**
 * Pure fleet domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The registry rules, the free-pool selectors and the map projection are harvested from
 * the legacy fleet.js so console and PWA can never disagree about who may drive what.
 */

import type { MessageKey, Translate } from '../../shared/i18n';
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
  // S34 — the dynamic-pricing profile. All optional: left blank, each falls back to a sensible class default.
  // baseFee is the flag-down/loading fee; the two multipliers are the corridor the market may flex the rate in.
  baseFee: string;
  minMultiplier: string;
  maxMultiplier: string;
  registrationPhotoRef: string; // S26 — a mediaId (was a typed filename)
  factoryId: string;
  // S26 — mediaIds of the owner's uploaded vehicle-body and trailer photos.
  vehiclePhotoRefs: string[];
  trailerPhotoRefs: string[];
  equipment: Equipment[]; // S32 — declared load/unload equipment (a tail-lift, a pallet jack, …)
}

/** Load/unload equipment a fleet manager can declare (S32). Mirrors the backend EQUIPMENT tuple; plain
 *  labels for the console. 'MAN' is implicit (every vehicle can do manual handling) so it is not listed. */
export type Equipment = 'HTR' | 'PLT' | 'FLT' | 'TLT' | 'CRN' | 'RMP' | 'STR';
const EQUIPMENT_KEYS: Array<{ key: Equipment; labelKey: MessageKey; detailKey: MessageKey }> = [
  { key: 'HTR', labelKey: 'fleet.equipment.htr', detailKey: 'fleet.equipment.htrWhy' },
  { key: 'PLT', labelKey: 'fleet.equipment.plt', detailKey: 'fleet.equipment.pltWhy' },
  { key: 'TLT', labelKey: 'fleet.equipment.tlt', detailKey: 'fleet.equipment.tltWhy' },
  { key: 'FLT', labelKey: 'fleet.equipment.flt', detailKey: 'fleet.equipment.fltWhy' },
  { key: 'CRN', labelKey: 'fleet.equipment.crn', detailKey: 'fleet.equipment.crnWhy' },
  { key: 'RMP', labelKey: 'fleet.equipment.rmp', detailKey: 'fleet.equipment.rmpWhy' },
  { key: 'STR', labelKey: 'fleet.equipment.str', detailKey: 'fleet.equipment.strWhy' },
];

/** The declarable equipment options with their plain-words labels resolved in the active locale. */
export function equipmentOptions(t: Translate): Array<{ key: Equipment; label: string }> {
  return EQUIPMENT_KEYS.map((e) => ({ key: e.key, label: t(e.labelKey) }));
}

/** The same options with the sentence each picture is captioned by, for the help sheet. Kept beside the
 *  labels so a new piece of equipment cannot be added to one list and forgotten in the other. */
export function equipmentHelp(t: Translate): Array<{ key: Equipment; label: string; detail: string }> {
  return EQUIPMENT_KEYS.map((e) => ({ key: e.key, label: t(e.labelKey), detail: t(e.detailKey) }));
}

export const EMPTY_VEHICLE: VehicleForm = {
  plate: '',
  vehicleClass: 'bike',
  truckSubtype: '',
  ownerType: 'driver_owned',
  ownerName: '',
  capacityKg: '',
  pricePerKm: '',
  baseFee: '',
  minMultiplier: '',
  maxMultiplier: '',
  registrationPhotoRef: '',
  factoryId: '',
  vehiclePhotoRefs: [],
  trailerPhotoRefs: [],
  equipment: [],
};

/** The next thing the vehicle form needs, or null when it can submit. */
export function vehicleMissing(f: VehicleForm, t: Translate): string | null {
  if (!f.plate.trim()) return t('fleet.logic.vMissingPlate');
  if (!f.ownerName.trim()) return t('fleet.logic.vMissingOwner');
  if (f.vehicleClass === 'truck' && !f.truckSubtype) return t('fleet.logic.vMissingBody');
  // S34 — the price corridor is set as a PAIR or not at all. A lone bound would be silently paired with the
  // other class default (a typed ceiling of 0.5 gets raised to the 0.8 floor), contradicting the on-screen
  // promise that the operator owns BOTH the floor and the ceiling — so require both, or neither.
  const min = f.minMultiplier.trim() ? Number(f.minMultiplier) : null;
  const max = f.maxMultiplier.trim() ? Number(f.maxMultiplier) : null;
  if ((min === null) !== (max === null)) return t('fleet.logic.vMissingBothMult');
  if (min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && min > max) {
    return t('fleet.logic.vMissingMultInverted');
  }
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

export function driverMissing(f: DriverForm, t: Translate): string | null {
  if (!f.displayName.trim()) return t('fleet.logic.dMissingDisplay');
  if (!f.fullName.trim()) return t('fleet.logic.dMissingFull');
  if (!f.nationalId.trim()) return t('fleet.logic.dMissingId');
  if (!f.mobile.trim()) return t('fleet.logic.dMissingMobile');
  if (f.classes.length === 0) return t('fleet.logic.dMissingClass');
  if (isHeavySelection(f.classes) && !f.licenceNumber.trim()) return t('fleet.logic.dMissingLicence');
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

/**
 * The truck bodies as the look-and-choose picker needs them: the server's label, our sentence, and the
 * capability line the form already showed underneath.
 *
 * The LABELS come from the server because it owns the catalogue — a body added there must not need a
 * frontend release to become choosable. Only the descriptions live in the catalog, and an id we have no
 * sentence for falls back to a neutral one rather than rendering a raw key: a new body should look
 * unexplained, not broken.
 */
export function bodyPickerOptions(subtypes: SubtypeRow[], t: Translate): Array<{ key: string; label: string; detail: string; meta?: string }> {
  return subtypes.map((s) => {
    const key = `fleet.body.${s.id}Why` as MessageKey;
    const detail = t(key);
    return {
      key: s.id,
      label: s.label,
      // t() returns the key itself when there is no entry — that is the signal to fall back.
      detail: detail === key ? t('fleet.body.unknownWhy') : detail,
      meta: subtypeLine(s, t) ?? undefined,
    };
  });
}

export function subtypeLine(sub: SubtypeRow | undefined, t: Translate): string | null {
  if (!sub) return null;
  const caps = [
    sub.coldChain && t('fleet.logic.capColdChain'),
    sub.bulk && t('fleet.logic.capDryBulk'),
    sub.liquid && t('fleet.logic.capLiquid'),
    sub.hazmat && t('fleet.logic.capHazmat'),
    sub.oversized && t('fleet.logic.capOversized'),
  ].filter(Boolean);
  const base = t('fleet.logic.subtypeBase', { label: sub.label, kg: sub.capacityKg });
  return caps.length ? `${base} · ${caps.join(', ')}` : base;
}

export function hoursLabel(h: number | undefined): string {
  return `${h ?? 0}h`;
}

export function dashboardSummary(d: { drivers: { onShift?: number; total?: number }; cargo: { count?: number; totalKg?: number } }, t: Translate): string {
  return t('fleet.logic.dashboardSummary', {
    onShift: d.drivers.onShift ?? 0,
    total: d.drivers.total ?? 0,
    loads: d.cargo.count ?? 0,
    kg: d.cargo.totalKg ?? 0,
  });
}

/**
 * THE LIVE LINE in the top bar — how much of this fleet is actually out.
 *
 * It replaced the company's name, which is fixed for the session and already on every screen a
 * manager opens. Vehicles out is the number a fleet manager is answering for all day, and it is the
 * one already on the dashboard — so this reads the SAME loaded figure rather than fetching its own,
 * and the bar can never disagree with the tiles underneath it.
 */
export function fleetWorkLine(
  dashboard: { vehicles?: { total?: number; active?: number }; drivers?: { onShift?: number } } | null,
  t: Translate,
): string | undefined {
  if (!dashboard) return undefined;
  const total = dashboard.vehicles?.total ?? 0;
  const active = dashboard.vehicles?.active ?? 0;
  const onShift = dashboard.drivers?.onShift ?? 0;
  // A fleet with no vehicles yet is being SET UP, and telling it "0 of 0 out" is noise on the one
  // screen where the real message is "add a vehicle".
  if (total === 0) return t('fleet.bar.empty');
  const bits = [t('fleet.bar.vehiclesOut', { active, total })];
  if (onShift > 0) bits.push(t('fleet.bar.driversOn', { count: onShift }));
  return bits.join(' · ');
}
