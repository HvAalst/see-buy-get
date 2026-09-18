/**
 * Pure fleet domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The registry rules, the free-pool selectors and the map projection are harvested from
 * the legacy fleet.js so console and PWA can never disagree about who may drive what.
 */

import type { MessageKey, Translate } from '../../shared/i18n';
import {
  HEAVY_CLASSES,
  type AssignmentRow,
  type CorridorRow,
  type DriverRow,
  type DispatchRow,
  type DispatchView,
  type DriverStatus,
  type PapersReport,
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
  /** How high the loading DECK stands, in metres — the other half of a bridge check. Blank = unknown,
   *  and unknown stays unknown: a guessed deck would clear a load under a bridge on somebody else's
   *  arithmetic. */
  deckM: string;
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
  // FP4 — the papers, asked for where the vehicle is registered. Dates are YYYY-MM-DD; blank switches nothing off.
  insuranceRef: string;
  insuranceExpiresAt: string;
  inspectionRef: string;
  inspectionExpiresAt: string;
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
  deckM: '',
  pricePerKm: '',
  baseFee: '',
  minMultiplier: '',
  maxMultiplier: '',
  registrationPhotoRef: '',
  factoryId: '',
  vehiclePhotoRefs: [],
  trailerPhotoRefs: [],
  equipment: [],
  insuranceRef: '',
  insuranceExpiresAt: '',
  inspectionRef: '',
  inspectionExpiresAt: '',
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

/**
 * Vehicles as map pins — real coordinates, for a real map.
 *
 * Replaces the grid projection below for the dashboard. Projecting onto an abstract grid was fine while
 * the map was a hand-drawn plot, and it is the wrong shape for a map with tiles: the whole value of
 * geography is that the dots sit on the roads they are actually on.
 *
 * Labelled by PLATE, because that is what a manager says out loud on the phone. The driver and the class
 * ride along in the label so a pin can still answer "who is that".
 */
export function vehiclePins(positions: PositionRow[], now: number = Date.now()): Array<{ id: string; label: string; point: { lat: number; lng: number } }> {
  return (positions ?? []).map((p) => {
    const signal = signalState(p.lastLocatedAt, now);
    return {
      id: p.plate,
      // A dark vehicle says so on the pin itself: the last place we heard from it is not where it is.
      label: `${p.plate} · ${p.driverName}${signal.kind === 'dark' ? ` · no signal ${ageWords(signal.minutes)}` : ''}`,
      point: { lat: p.location.lat, lng: p.location.lng },
    };
  });
}

/** "12 min" up to an hour and a half, then hours: a vehicle dark since yesterday is not "1428 min" to anybody. */
export function ageWords(minutes: number): string {
  if (minutes < 90) return `${minutes} min`;
  const h = Math.round(minutes / 60);
  return h >= 48 ? `${Math.round(h / 24)} d` : `${h} h`;
}

/** After this long without a position the vehicle is DARK: a phone reports every 30 s while on shift. */
export const DARK_AFTER_MIN = 10;

/**
 * What a vehicle's last position is worth. `live`: heard from within the dark threshold. `dark`: it has stopped
 * reporting — the pin is where it WAS. `never`: this shift has not reported at all (an old record, or a phone
 * that refused location).
 */
export function signalState(lastLocatedAt: string | undefined | null, now: number = Date.now()): { kind: 'live' | 'dark' | 'never'; minutes: number } {
  const at = lastLocatedAt ? Date.parse(lastLocatedAt) : Number.NaN;
  if (!Number.isFinite(at)) return { kind: 'never', minutes: 0 };
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  return { kind: minutes >= DARK_AFTER_MIN ? 'dark' : 'live', minutes };
}


/* ------------------------------------------------------------------ views -- */

/* ------------------------------------------------------------ FP4: papers -- */

// The paper helpers live in shared/papers.ts, because the operator console reads the same dates for the
// couriers and vehicles no fleet office looks after; re-exported so this app's screens and tests keep one door.
export { paperDay, paperKindLabel, paperLine, paperLineClass, papersToShow, paperTone } from '../../shared/papers';

/** Read aloud after the dashboard summary: only what needs acting on, and nothing when nothing does. */
export function papersAloud(report: PapersReport | null | undefined, t: Translate): string {
  if (!report) return '';
  return (report.lapsed.length ? t('fleet.papers.aloudLapsed', { count: report.lapsed.length }) : '') + (report.due.length ? t('fleet.papers.aloudDue', { count: report.due.length }) : '');
}

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

/** FP8 — hours on a shift from when it started, to a tenth; the shift rows the office holds carry only the start. */
export function shiftHours(startedAt: string, now: number = Date.now()): number {
  const ms = now - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round((ms / 3_600_000) * 10) / 10 : 0;
}

/** Over the shift limit as the server judges it — its limit once the dashboard has said it, 13 h until then. */
export function overShiftLimit(startedAt: string, limit: number | undefined, now: number = Date.now()): boolean {
  return shiftHours(startedAt, now) > (limit ?? 13);
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

/* --------------------------------------------------------------- corridors -- */

/**
 * What a running shift's corridor IS — and "none" is not a blank, it is a limit.
 *
 * The field is optional when the shift starts, and that is correct: a rider taking marketplace loads
 * never needs one. It stops being correct the moment the same driver pulls up at a shop counter, where
 * the handover refuses outright without a corridor — and refuses on the SHOPKEEPER's screen, about
 * something only a manager can fix. So the screen says what empty COSTS instead of calling it optional.
 *
 *   none    — local and marketplace work only; no shop counter can hand over to this driver
 *   on      — a live corridor, named
 *   blocked — a corridor the network has closed: no shop can take in new parcels for that zone pair
 *   gone    — a corridor that is no longer published at all
 */
export type CorridorState = { kind: 'none' } | { kind: 'on' | 'blocked' | 'gone'; name: string };

/**
 * F1 — the corridors a shift of THIS fleet may be put on: published, not closed, and either the network's
 * or this fleet's own line. Another fleet's line and a proposal waiting for the network are never offered —
 * the server refuses both, and a picker offering what the server refuses is a mis-tap waiting to happen.
 */
export function usableCorridors(corridors: CorridorRow[], managerDid: string | undefined): CorridorRow[] {
  return corridors.filter((c) => c.status === 'active' && (!c.owner || c.owner.managerDid === managerDid));
}

/** F1 — this fleet's own lines, the ones waiting for the network first. */
export function ownLines(corridors: CorridorRow[], managerDid: string | undefined): CorridorRow[] {
  const rank = (s: string) => (s === 'proposed' ? 0 : s === 'blocked' ? 2 : 1);
  return corridors
    .filter((c) => managerDid !== undefined && c.owner?.managerDid === managerDid)
    .sort((a, b) => rank(a.status) - rank(b.status) || a.originZone.localeCompare(b.originZone));
}

export interface LineForm {
  name: string;
  originZone: string;
  destZone: string;
  vehicleType: 'bus' | 'truck';
  schedule: string;
  note: string;
}

export const EMPTY_LINE: LineForm = { name: '', originZone: '', destZone: '', vehicleType: 'bus', schedule: '', note: '' };

/**
 * Why this line cannot be proposed yet — said before the server has to. Only what is certain from the list
 * this fleet can see: both ends, two zones, and a pair nothing already runs or waits to run on.
 */
export function lineBlocker(form: LineForm, corridors: CorridorRow[]): 'fleet.lines.needZones' | 'fleet.lines.sameZone' | 'fleet.lines.duplicate' | null {
  const origin = form.originZone.trim();
  const dest = form.destZone.trim();
  if (!origin || !dest) return 'fleet.lines.needZones';
  if (origin === dest) return 'fleet.lines.sameZone';
  if (corridors.some((c) => c.status !== 'blocked' && c.originZone === origin && c.destZone === dest)) return 'fleet.lines.duplicate';
  return null;
}

/** Zones worth suggesting: every end of every corridor this fleet can see. Suggestions, never a closed list. */
export function lineZones(corridors: CorridorRow[]): string[] {
  return [...new Set(corridors.flatMap((c) => [c.originZone, c.destZone]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function corridorState(assignment: AssignmentRow, corridors: CorridorRow[]): CorridorState {
  if (!assignment.corridorId) return { kind: 'none' };
  const corridor = corridors.find((c) => c.corridorId === assignment.corridorId);
  // Named by its id when the list cannot name it. Saying "none" here would be the one wrong answer: it
  // reads as "local work only" about a driver who is on a line-haul run.
  if (!corridor) return { kind: 'gone', name: assignment.corridorId };
  return { kind: corridor.status === 'blocked' ? 'blocked' : 'on', name: corridor.name };
}

/* ------------------------------------------------------------ FP5: dispatch -- */

/** What the office can do with a row: put it on the driver, only name a price (negotiation), or nothing. */
export function dispatchRowState(row: Pick<DispatchRow, 'canTake' | 'commitMode'>): 'take' | 'negotiate' | 'blocked' {
  if (row.commitMode === 'negotiate') return 'negotiate';
  return row.canTake ? 'take' : 'blocked';
}

/** The two legs, said the way the money is split: what is driven empty, what is driven paid. */
export function dispatchDistanceLine(row: Pick<DispatchRow, 'deadheadKm' | 'loadedKm'>, t: Translate): string {
  return t('fleet.dispatch.distance', { empty: row.deadheadKm.toFixed(1), loaded: row.loadedKm.toFixed(1) });
}

/** Read aloud: how big the market is for this driver, and how much of it they could take. */
export function dispatchSummary(view: DispatchView | null, t: Translate): string {
  if (!view || !view.drivers.length) return t('fleet.dispatch.aloudNobody');
  const name = view.drivers.find((d) => d.did === view.driver)?.name ?? '';
  return t('fleet.dispatch.aloud', { n: view.rows.length, name, can: view.rows.filter((r) => dispatchRowState(r) === 'take').length });
}
