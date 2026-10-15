import type { Result, SbgClient } from '../../lib/sbg';
import type { components } from '../../lib/sbg/schema';
import type { MessageKey, Translate } from '../../shared/i18n';

export type VehicleCare = components['schemas']['VehicleCareView'];
export type OffRoadSpell = components['schemas']['OffRoadSpell'];
export type OffRoadReason = OffRoadSpell['reason'];

/**
 * A VEHICLE'S UPKEEP, over the wire — read when its sheet is opened, so it lives beside the sheet rather than in the
 * app's one big hook. What the network keeps about whether a vehicle goes out; never parts, mechanics' time or costs.
 */
export function careApi(sbg: SbgClient) {
  return {
    care: (vehicleId: string): Promise<Result<VehicleCare>> => sbg.request((c) => c.GET('/v1/sbg/vehicles/{id}/care', { params: { path: { id: vehicleId } } })) as never,
    takeOffRoad: (vehicleId: string, body: { reason: OffRoadReason; note?: string; fromDay?: string; untilDay?: string }): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/off-road', { params: { path: { id: vehicleId } }, body })) as never,
    endSpell: (vehicleId: string, spellId: string): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/off-road/{spellId}/end', { params: { path: { id: vehicleId, spellId } } })) as never,
    recordReading: (vehicleId: string, km: number, newMeter: boolean): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/readings', { params: { path: { id: vehicleId } }, body: { km, ...(newMeter ? { newMeter: true } : {}) } })) as never,
    decideDefect: (vehicleId: string, defectId: string, decision: 'fixed' | 'cleared', note: string): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/defects/{defectId}/decide', { params: { path: { id: vehicleId, defectId } }, body: { decision, note } })) as never,
    /** A defect's photograph, for <AuthImage>: the key is "vehicleId|defectId". */
    defectPhoto: (key: string): Promise<{ data: Blob | null; error: unknown }> => {
      const [id, defectId] = key.split('|');
      return sbg.request((c) => c.GET('/v1/sbg/vehicles/{id}/defects/{defectId}/photo', { params: { path: { id, defectId }, query: { variant: 'thumb' } }, parseAs: 'blob' } as never)) as never;
    },
    settings: (fleetDid: string): Promise<Result<CareSettings>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/care-settings', { params: { path: { did: fleetDid } } })) as never,
    /** Either rule, or both: what is not sent stays as it was. */
    setSettings: (fleetDid: string, body: Partial<CareSettings>): Promise<Result<CareSettings>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/care-settings', { params: { path: { did: fleetDid } }, body })) as never,
    setServicePlan: (vehicleId: string, body: { everyKm?: number; everyMonths?: number; useClassUsual?: boolean }): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/service-plan', { params: { path: { id: vehicleId } }, body })) as never,
    recordService: (vehicleId: string, body: { day: string; what: ServiceKind; km?: number; workshop?: string; note?: string; photoRef?: string }): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/services', { params: { path: { id: vehicleId } }, body })) as never,
    /** A job card's photograph, for <AuthImage>: the key is "vehicleId|recordId". */
    servicePhoto: (key: string): Promise<{ data: Blob | null; error: unknown }> => {
      const [id, recordId] = key.split('|');
      return sbg.request((c) => c.GET('/v1/sbg/vehicles/{id}/services/{recordId}/photo', { params: { path: { id, recordId }, query: { variant: 'thumb' } }, parseAs: 'blob' } as never)) as never;
    },
    backOnRoad: (vehicleId: string): Promise<Result<VehicleCare>> => sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/back-on-road', { params: { path: { id: vehicleId } } })) as never,
    /** A breakdown the office heard of by telephone. */
    recordBreakdown: (vehicleId: string, body: { cause: BreakdownCause; note: string }): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/breakdowns', { params: { path: { id: vehicleId } }, body })) as never,
    resolveBreakdown: (vehicleId: string, breakdownId: string, body: { outcome: 'back_on_road' | 'workshop'; note: string; untilDay?: string }): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/breakdowns/{breakdownId}/resolve', { params: { path: { id: vehicleId, breakdownId } }, body })) as never,
    /** A breakdown's photograph, for <AuthImage>: the key is "vehicleId|breakdownId". */
    breakdownPhoto: (key: string): Promise<{ data: Blob | null; error: unknown }> => {
      const [id, breakdownId] = key.split('|');
      return sbg.request((c) => c.GET('/v1/sbg/vehicles/{id}/breakdowns/{breakdownId}/photo', { params: { path: { id, breakdownId }, query: { variant: 'thumb' } }, parseAs: 'blob' } as never)) as never;
    },
    /** Who of the fleet could take a breakdown's loads: out in another vehicle now, and the room each has. */
    takers: (vehicleId: string, breakdownId: string): Promise<Result<BreakdownTaker[]>> =>
      sbg.request((c) => c.GET('/v1/sbg/vehicles/{id}/breakdowns/{breakdownId}/takers', { params: { path: { id: vehicleId, breakdownId } } })) as never,
    handOver: (vehicleId: string, breakdownId: string, toDriverDid: string): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/breakdowns/{breakdownId}/hand-over', { params: { path: { id: vehicleId, breakdownId } }, body: { toDriverDid } })) as never,
    /** The fleet's vehicles broken down now. */
    fleetBreakdowns: (fleetDid: string): Promise<Result<VehicleBreakdown[]>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/breakdowns', { params: { path: { did: fleetDid } } })) as never,
  };
}

export type OdometerReading = components['schemas']['OdometerReading'];
export type VehicleDefect = components['schemas']['VehicleDefect'];
export type CareSettings = components['schemas']['CareSettings'];
export type ServiceRecord = components['schemas']['ServiceRecord'];
export type ServiceKind = ServiceRecord['what'];
export type ServiceDue = components['schemas']['ServiceDueView'];
export type CareApi = ReturnType<typeof careApi>;
export type VehicleBreakdown = components['schemas']['VehicleBreakdown'];
export type BreakdownCause = VehicleBreakdown['cause'];
export type BreakdownTaker = components['schemas']['BreakdownTaker'];
export type BreakdownHandover = components['schemas']['BreakdownHandover'];

/** What broke, in the order a driver or an office meets it. */
export const BREAKDOWN_CAUSES: BreakdownCause[] = ['engine', 'tyre', 'electrical', 'brakes', 'fuel', 'accident', 'other'];
export const CAUSE_WORD: Record<BreakdownCause, MessageKey> = {
  engine: 'fleet.brk.cause.engine',
  tyre: 'fleet.brk.cause.tyre',
  electrical: 'fleet.brk.cause.electrical',
  brakes: 'fleet.brk.cause.brakes',
  fuel: 'fleet.brk.cause.fuel',
  accident: 'fleet.brk.cause.accident',
  other: 'fleet.brk.cause.other',
};

/** Where it broke down, in words: where the phone was, or the last known position — or that nobody knows. */
export function whereWords(b: Pick<VehicleBreakdown, 'location' | 'locationFrom'>, t: Translate): string {
  if (!b.location) return t('fleet.brk.whereNone');
  const at = `${b.location.lat.toFixed(5)}, ${b.location.lng.toFixed(5)}`;
  return t(b.locationFrom === 'phone' ? 'fleet.brk.wherePhone' : 'fleet.brk.whereLast', { at });
}

/** What can be recorded as done to a vehicle, in the order an office meets them. Only a service restarts the count. */
export const SERVICE_KINDS: ServiceKind[] = ['service', 'repair', 'tyres', 'inspection', 'other'];
export const SERVICE_WORD: Record<ServiceKind, MessageKey> = {
  service: 'fleet.svc.kind.service',
  repair: 'fleet.svc.kind.repair',
  tyres: 'fleet.svc.kind.tyres',
  inspection: 'fleet.svc.kind.inspection',
  other: 'fleet.svc.kind.other',
};

/** How the next service stands, as a pill: its words and its tone. */
export const SERVICE_STATE: Record<ServiceDue['state'], { key: MessageKey; tone: 'ok' | 'warn' | 'danger' | 'idle' }> = {
  ok: { key: 'fleet.svc.state.ok', tone: 'ok' },
  soon: { key: 'fleet.svc.state.soon', tone: 'warn' },
  overdue: { key: 'fleet.svc.state.overdue', tone: 'danger' },
  unknown: { key: 'fleet.svc.state.unknown', tone: 'idle' },
};

/** How often, in words: "Serviced every 15,000 km or 6 months, whichever comes first". */
export function planWords(p: Pick<ServiceDue['plan'], 'everyKm' | 'everyMonths'>, t: Translate): string {
  if (p.everyKm && p.everyMonths) return t('fleet.svc.planKmMonths', { km: kmWords(p.everyKm), months: p.everyMonths });
  if (p.everyKm) return t('fleet.svc.planKm', { km: kmWords(p.everyKm) });
  return t('fleet.svc.planMonths', { months: p.everyMonths ?? 0 });
}

/** What a defect is about, in the office's words. */
export const DEFECT_WORD: Record<VehicleDefect['item'], MessageKey> = {
  tyres: 'fleet.care.item.tyres',
  brakes: 'fleet.care.item.brakes',
  lights: 'fleet.care.item.lights',
  mirrors: 'fleet.care.item.mirrors',
  horn: 'fleet.care.item.horn',
  wipers: 'fleet.care.item.wipers',
  leaks: 'fleet.care.item.leaks',
  chain: 'fleet.care.item.chain',
  load_gear: 'fleet.care.item.load_gear',
  body: 'fleet.care.item.body',
  other: 'fleet.care.item.other',
};

/** Who gave a reading, and when in the day: "at shift start", "by the office". */
export const SOURCE_WORD: Record<OdometerReading['source'], MessageKey> = {
  shift_start: 'fleet.care.src.start',
  shift_end: 'fleet.care.src.end',
  office: 'fleet.care.src.office',
};

/** "120,400 km" — in the reader's own way of grouping digits. */
export function kmWords(km: number): string {
  return `${km.toLocaleString()} km`;
}

/**
 * The reasons a spell is taken for, in the order the office meets them. Not a breakdown: that is recorded as one (the
 * driver's report, or the office's "It has broken down"), which tells the shippers of what is aboard and holds the plan.
 */
export const OFF_ROAD_REASONS: OffRoadReason[] = ['repair', 'service', 'accident', 'other'];
export const REASON_WORD: Record<OffRoadReason, MessageKey> = {
  repair: 'fleet.care.reason.repair',
  service: 'fleet.care.reason.service',
  accident: 'fleet.care.reason.accident',
  breakdown: 'fleet.care.reason.breakdown',
  other: 'fleet.care.reason.other',
};

/** A day as the office says it: "today", "tomorrow", or "Thu 16 Oct". Built at noon, so no clock moves the day. */
export function dayLabel(day: string, today: string, t: Translate): string {
  if (day === today) return t('fleet.care.today');
  if (day === addDays(today, 1)) return t('fleet.care.tomorrow');
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A spell's days in words: "today to Sat 18 Oct", "from Mon 20 Oct, until put back". */
export function spellSpan(s: Pick<OffRoadSpell, 'fromDay' | 'untilDay'>, today: string, t: Translate): string {
  const from = dayLabel(s.fromDay, today, t);
  if (!s.untilDay) return t('fleet.care.spanOpen', { from });
  if (s.untilDay === s.fromDay) return t('fleet.care.spanOne', { day: from });
  return t('fleet.care.span', { from, until: dayLabel(s.untilDay, today, t) });
}

/** Has it begun? One that has not is called off, not ended. */
export function spellBegun(s: Pick<OffRoadSpell, 'fromDay'>, today: string): boolean {
  return s.fromDay <= today;
}

/** Today, as YYYY-MM-DD on this device's clock — only until a sheet has the fleet's own today (VehicleCare.today). */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
