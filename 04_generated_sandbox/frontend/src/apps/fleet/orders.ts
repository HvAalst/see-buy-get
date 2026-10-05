import type { Result, SbgClient } from '../../lib/sbg';
import type { components } from '../../lib/sbg/schema';
import type { MessageKey, Translate } from '../../shared/i18n';

export type FleetOrder = components['schemas']['FleetOrderRow'];
export type Contract = components['schemas']['CarriageContractView'];
export type InviteIssued = components['schemas']['ContractInviteIssued'];
export type ImportResult = components['schemas']['OrderImportResult'];
export type ImportRow = components['schemas']['OrderImportRow'];
export type DayPlan = components['schemas']['DayPlanView'];
export type DayPlanState = components['schemas']['DayPlanState'];
export type PlanLeft = components['schemas']['PlanLeftView'];
export type PlanLeftReason = PlanLeft['reason'];
export type PlanSendResult = components['schemas']['PlanSendResult'];
export type PlanSendTruck = components['schemas']['PlanSendTruck'];
/** What a plan for a day is asked with: the day, and whatever the office changes about its own day. */
export interface PlanAsk {
  day: string;
  excludeVehicleIds?: string[];
  dayStart?: string;
  dayHours?: number;
  speedKmh?: number;
  loadMin?: number;
  unloadMin?: number;
}

/**
 * P1 — THE FLEET'S CONTRACTS AND THE ORDERS THAT ARRIVE UNDER THEM, over the wire.
 *
 * Kept beside the screen rather than in the app's one big hook: the queue is read when the office opens it, and
 * nothing else in the app depends on it.
 */
export function ordersApi(sbg: SbgClient, did: string) {
  const path = { did };
  return {
    orders: (q: { from?: string; to?: string } = {}): Promise<Result<{ items: FleetOrder[]; total: number }>> =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/orders', { params: { path, query: q } })) as never,
    contracts: (): Promise<Result<{ items: Contract[] }>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/contracts', { params: { path } })) as never,
    createContract: (body: { shipperName: string; reference?: string; startsOn?: string; endsOn?: string }): Promise<Result<Contract>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/contracts', { params: { path }, body })) as never,
    invite: (contractId: string): Promise<Result<InviteIssued>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/contracts/{contractId}/invite', { params: { path: { did, contractId } } })) as never,
    endContract: (contractId: string, reason?: string): Promise<Result<Contract>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/contracts/{contractId}/end', { params: { path: { did, contractId } }, body: reason ? { reason } : {} })) as never,
    /** Who is on a shift now, with the room left on their vehicle — the drivers an order can be put on today. */
    onShift: (): Promise<Result<{ drivers: Array<{ did: string; name: string; plate: string; remainingKg: number }> }>> =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/dispatch', { params: { path, query: {} } })) as never,
    assign: (freightId: string, driverDid: string): Promise<Result<unknown>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/dispatch', { params: { path }, body: { freightId, driverDid } })) as never,
    /** P1b — a sheet of orders: a check (`dryRun`) judges every line and creates nothing; an import creates the good ones. */
    importOrders: (contractId: string, body: { text: string; pickupLabel?: string; pickupLat?: number; pickupLng?: number; dryRun: boolean }): Promise<Result<ImportResult>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/contracts/{contractId}/orders/import', { params: { path: { did, contractId } }, body })) as never,
    template: (): Promise<Result<{ fileName: string; csv: string }>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/orders/template', { params: { path } })) as never,
    withdraw: (freightId: string, reason: string): Promise<Result<{ withdrawn: true }>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/withdraw', { params: { path: { did, freightId } }, body: { reason } })) as never,
    /** P3 — a proposal for a day (changes nothing), accepting one (kept, and written onto its orders), and the day's accepted plan. */
    proposePlan: (ask: PlanAsk): Promise<Result<DayPlan>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/plan', { params: { path }, body: ask })) as never,
    acceptPlan: (ask: PlanAsk): Promise<Result<DayPlan>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/plan/accept', { params: { path }, body: ask })) as never,
    /** P3b — send the next trip to every truck in today's accepted plan that is ready for one. */
    sendPlan: (day: string): Promise<Result<PlanSendResult>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/plan/send', { params: { path }, body: { day } })) as never,
    planState: (day: string): Promise<Result<DayPlanState>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/plan', { params: { path, query: { day } } })) as never,
    pin: (freightId: string, at: { lat: number; lng: number }): Promise<Result<{ pinned: true }>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/pin', { params: { path: { did, freightId } }, body: at })) as never,
    geocode: (q: string): Promise<Result<{ location: { lat: number; lng: number }; confidence: 'exact' | 'approx' | 'fallback'; matched?: string }>> =>
      sbg.request((c) => c.GET('/v1/sbg/geocode', { params: { query: { q } } })) as never,
  };
}

/* ------------------------------------------------------------------- logic -- */

/** What an order's tag says, from the facts on it. `late` outranks everything but done and withdrawn. */
export type OrderTag = 'unplanned' | 'planned' | 'onTruck' | 'onRoad' | 'delivered' | 'withdrawn' | 'late';

export function orderTag(o: Pick<FleetOrder, 'status' | 'late' | 'planned'>): OrderTag {
  if (o.status === 'delivered') return 'delivered';
  if (o.status === 'cancelled') return 'withdrawn';
  if (o.late) return 'late';
  if (o.status === 'in_transit') return 'onRoad';
  if (o.status === 'claimed') return 'onTruck';
  // In the accepted plan for its day, and not yet sent out to a driver.
  return o.planned ? 'planned' : 'unplanned';
}

export const TAG_TONE: Record<OrderTag, 'ok' | 'info' | 'warn' | 'danger' | 'idle'> = {
  unplanned: 'warn',
  planned: 'info',
  onTruck: 'info',
  onRoad: 'info',
  delivered: 'ok',
  withdrawn: 'idle',
  late: 'danger',
};

/** A day as YYYY-MM-DD in the office's own calendar, `offset` days from `now`. */
export function dayOf(now: Date, offset = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The orders, grouped by the day they must arrive, in day order. */
export function byDay(items: FleetOrder[]): Array<{ day: string; orders: FleetOrder[] }> {
  const groups = new Map<string, FleetOrder[]>();
  for (const o of items) groups.set(o.deliverOn, [...(groups.get(o.deliverOn) ?? []), o]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, orders]) => ({ day, orders }));
}

/**
 * ONE DAY IN NUMBERS — what a dispatcher reads first at midday: how many orders, how heavy, and how many still have
 * no truck. Withdrawn orders count for nothing.
 */
export function daySummary(orders: FleetOrder[]): { orders: number; kg: number; unplanned: number; late: number; delivered: number } {
  const live = orders.filter((o) => o.status !== 'cancelled');
  return {
    orders: live.length,
    kg: Math.round(live.reduce((s, o) => s + o.weightKg, 0)),
    unplanned: live.filter((o) => o.status === 'ordered' && !o.planned).length,
    late: live.filter((o) => o.late).length,
    delivered: live.filter((o) => o.status === 'delivered').length,
  };
}

/** "Today", "Tomorrow" or the date — the way an office says a delivery day. */
export function dayWord(day: string, now: Date, t: Translate): string {
  if (day === dayOf(now)) return t('fleet.orders.today');
  if (day === dayOf(now, 1)) return t('fleet.orders.tomorrow');
  if (day === dayOf(now, -1)) return t('fleet.orders.yesterday');
  return day;
}

/**
 * P1b — a file this cannot read as a sheet, by its name: a workbook is a zip of XML, not text, and reading one as
 * text would "check" a page of noise. Said before anything is sent. Null means it may be a sheet.
 */
export function notASheet(fileName: string): MessageKey | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (['xlsx', 'xls', 'xlsm', 'ods', 'numbers'].includes(ext)) return 'fleet.upload.notText';
  if (['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'].includes(ext)) return 'fleet.upload.notSheet';
  return null;
}

/** P1b — one refused line of a sheet, as a sentence: which line, which order, and everything wrong with it. */
export function importVerdictLine(row: Pick<ImportRow, 'line' | 'reference' | 'problems'>, t: Translate): string {
  const what = row.problems.join('; ');
  return row.reference ? t('fleet.upload.lineRef', { line: row.line, ref: row.reference, what }) : t('fleet.upload.line', { line: row.line, what });
}

/** Whether the office may withdraw this order: one it uploaded itself, still not on the road. */
export function mayWithdraw(o: Pick<FleetOrder, 'uploaded' | 'status'>): boolean {
  return o.uploaded && (o.status === 'ordered' || o.status === 'claimed');
}

/**
 * P3 — the asks an accepted plan was made with, so planning the day AGAIN starts from the office's own settings (a
 * truck it left out stays out) and not from the defaults.
 */
export function askOf(day: string, accepted?: DayPlan | null): PlanAsk {
  if (!accepted) return { day };
  const s = accepted.settings;
  const out = accepted.vehicles.filter((v) => v.excluded).map((v) => v.vehicleId);
  return { day, dayStart: s.dayStart, dayHours: s.dayHours, speedKmh: s.speedKmh, loadMin: s.loadMin, unloadMin: s.unloadMin, ...(out.length ? { excludeVehicleIds: out } : {}) };
}

/** P3 — minutes as a working day is said: "9 h 30", "45 min". */
export function hoursWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h === 0 ? `${m} min` : m % 60 === 0 ? `${h} h` : `${h} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * P3 — what the plan left out, grouped by WHY, in the order somebody can act on it: an address to pin first (the
 * office can do that now), then what more trucks or drivers would fix, then what no truck of this fleet can take.
 */
const LEFT_ORDER: PlanLeftReason[] = ['no_pin', 'no_driver', 'no_time', 'no_trucks', 'no_truck_can_carry', 'too_heavy'];
export function leftByReason(left: PlanLeft[]): Array<{ reason: PlanLeftReason; orders: PlanLeft[] }> {
  return LEFT_ORDER.map((reason) => ({ reason, orders: left.filter((o) => o.reason === reason) })).filter((g) => g.orders.length > 0);
}

/** P3b — what happened when a truck was sent its next trip, as one line the office can act on. */
export function sendLine(truck: PlanSendTruck, t: Translate): string {
  switch (truck.state) {
    case 'no_driver':
      return t('fleet.plan.send.noDriver', { plate: truck.plate });
    case 'carrying':
      return t('fleet.plan.send.carrying', { plate: truck.plate, driver: truck.driverName ?? '' });
    case 'nothing_left':
      return t('fleet.plan.send.done', { plate: truck.plate });
    default: {
      const went = truck.sent.length ? t(truck.sent.length === 1 ? 'fleet.plan.send.sentOne' : 'fleet.plan.send.sent', { plate: truck.plate, driver: truck.driverName ?? '', trip: truck.tripNo ?? 0, n: truck.sent.length }) : '';
      const stuck = truck.held.map((h) => t('fleet.plan.send.held', { code: h.code, why: h.why })).join(' ');
      return [went || (truck.held.length ? t('fleet.plan.send.noneWent', { plate: truck.plate, trip: truck.tripNo ?? 0 }) : ''), stuck].filter(Boolean).join(' ');
    }
  }
}

/** Tonnes for a day's total, kilos for one order. */
export function weightWords(kg: number): string {
  return kg >= 1000 ? `${(Math.round(kg / 100) / 10).toLocaleString()} t` : `${kg.toLocaleString()} kg`;
}
