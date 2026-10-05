import type { Result, SbgClient } from '../../lib/sbg';
import type { components } from '../../lib/sbg/schema';
import type { MessageKey, Translate } from '../../shared/i18n';

export type FleetOrder = components['schemas']['FleetOrderRow'];
export type Contract = components['schemas']['CarriageContractView'];
export type InviteIssued = components['schemas']['ContractInviteIssued'];
export type ImportResult = components['schemas']['OrderImportResult'];
export type ImportRow = components['schemas']['OrderImportRow'];

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
    pin: (freightId: string, at: { lat: number; lng: number }): Promise<Result<{ pinned: true }>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/pin', { params: { path: { did, freightId } }, body: at })) as never,
    geocode: (q: string): Promise<Result<{ location: { lat: number; lng: number }; confidence: 'exact' | 'approx' | 'fallback'; matched?: string }>> =>
      sbg.request((c) => c.GET('/v1/sbg/geocode', { params: { query: { q } } })) as never,
  };
}

/* ------------------------------------------------------------------- logic -- */

/** What an order's tag says, from the facts on it. `late` outranks everything but done and withdrawn. */
export type OrderTag = 'unplanned' | 'onTruck' | 'onRoad' | 'delivered' | 'withdrawn' | 'late';

export function orderTag(o: Pick<FleetOrder, 'status' | 'late'>): OrderTag {
  if (o.status === 'delivered') return 'delivered';
  if (o.status === 'cancelled') return 'withdrawn';
  if (o.late) return 'late';
  if (o.status === 'in_transit') return 'onRoad';
  if (o.status === 'claimed') return 'onTruck';
  return 'unplanned';
}

export const TAG_TONE: Record<OrderTag, 'ok' | 'info' | 'warn' | 'danger' | 'idle'> = {
  unplanned: 'warn',
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
    unplanned: live.filter((o) => o.status === 'ordered').length,
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

/** Tonnes for a day's total, kilos for one order. */
export function weightWords(kg: number): string {
  return kg >= 1000 ? `${(Math.round(kg / 100) / 10).toLocaleString()} t` : `${kg.toLocaleString()} kg`;
}
