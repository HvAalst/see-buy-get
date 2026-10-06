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
export type Partnership = components['schemas']['FleetPartnershipView'];
export type PartnerLists = components['schemas']['FleetPartnerLists'];
export type PartnerInvite = components['schemas']['PartnerInviteIssued'];
export type HandOnResult = components['schemas']['HandOnBatchResult'];
export type PlanRule = components['schemas']['PlanRuleView'];
export type PlanAdvice = components['schemas']['PlanAdviceView'];
export type AdviserFailure = NonNullable<PlanAdvice['failed']>;
/** One order and one vehicle: what a rule on a plan names. */
export interface PlanPair {
  freightId: string;
  vehicleId: string;
}
/** A turn of the talk with the adviser, as the screen keeps it. `changed` is the server's account, shown under a reply. */
export interface AdviserTurn {
  role: 'user' | 'assistant';
  text: string;
  changed?: string[];
}
/** What a plan for a day is asked with: the day, and whatever the office changes about its own day. */
export interface PlanAsk {
  day: string;
  excludeVehicleIds?: string[];
  dayStart?: string;
  dayHours?: number;
  speedKmh?: number;
  loadMin?: number;
  unloadMin?: number;
  /** P5 — keep these orders off these vehicles; put these orders on these vehicles. */
  keepOff?: PlanPair[];
  putOn?: PlanPair[];
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
    /** P5 — whether this service has an adviser at all, and saying something to it about the plan made with `ask`. */
    adviserStatus: (): Promise<Result<{ configured: boolean }>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/plan/adviser', { params: { path } })) as never,
    advise: (ask: PlanAsk, message: string, history: Array<{ role: 'user' | 'assistant'; text: string }>): Promise<Result<PlanAdvice>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/plan/advise', { params: { path }, body: { ask, message, history } })) as never,
    /* P4 — partners, and handing orders on to them or to the open board. */
    partners: (): Promise<Result<PartnerLists>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/partners', { params: { path } })) as never,
    invitePartner: (partnerName: string): Promise<Result<PartnerInvite>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/partners', { params: { path }, body: { partnerName } })) as never,
    reissuePartner: (partnershipId: string): Promise<Result<PartnerInvite>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/partners/{partnershipId}/invite', { params: { path: { did, partnershipId } } })) as never,
    linkPartner: (code: string): Promise<Result<Partnership>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/partners/link', { params: { path }, body: { code } })) as never,
    endPartner: (partnershipId: string): Promise<Result<Partnership>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/partners/{partnershipId}/end', { params: { path: { did, partnershipId } } })) as never,
    offerOrders: (freightIds: string[]): Promise<Result<HandOnResult>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/offer', { params: { path }, body: { freightIds } })) as never,
    releaseOrders: (freightIds: string[]): Promise<Result<HandOnResult>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/release', { params: { path }, body: { freightIds } })) as never,
    withdrawOffer: (freightId: string): Promise<Result<unknown>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/offer/withdraw', { params: { path: { did, freightId } } })) as never,
    takeOffer: (freightId: string): Promise<Result<unknown>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/offer/take', { params: { path: { did, freightId } } })) as never,
    leaveOffer: (freightId: string): Promise<Result<unknown>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/offer/leave', { params: { path: { did, freightId } } })) as never,
    handBack: (freightId: string, reason: string): Promise<Result<unknown>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/hand-back', { params: { path: { did, freightId } }, body: { reason } })) as never,
    takeBack: (freightId: string): Promise<Result<unknown>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/take-back', { params: { path: { did, freightId } } })) as never,
    pin: (freightId: string, at: { lat: number; lng: number }): Promise<Result<{ pinned: true }>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/pin', { params: { path: { did, freightId } }, body: at })) as never,
    geocode: (q: string): Promise<Result<{ location: { lat: number; lng: number }; confidence: 'exact' | 'approx' | 'fallback'; matched?: string }>> =>
      sbg.request((c) => c.GET('/v1/sbg/geocode', { params: { query: { q } } })) as never,
  };
}

/* ------------------------------------------------------------------- logic -- */

/** What an order's tag says, from the facts on it. `late` outranks everything but done and withdrawn. */
export type OrderTag = 'unplanned' | 'planned' | 'onTruck' | 'onRoad' | 'delivered' | 'withdrawn' | 'late' | 'offeredToYou' | 'onOffer' | 'withPartner' | 'onBoard';

export function orderTag(o: Pick<FleetOrder, 'status' | 'late' | 'planned'> & Partial<Pick<FleetOrder, 'role' | 'handOn'>>): OrderTag {
  if (o.status === 'delivered') return 'delivered';
  if (o.status === 'cancelled') return 'withdrawn';
  // Something a partner is asking: that it is waiting for an answer comes before anything about its day.
  if (o.role === 'offered') return 'offeredToYou';
  if (o.late) return 'late';
  if (o.status === 'in_transit') return 'onRoad';
  if (o.status === 'claimed') return 'onTruck';
  // P4 — handed on, and where to: none of these is "without a truck" in the sense of being nobody's.
  if (o.handOn?.state === 'board') return 'onBoard';
  if (o.role !== 'partner' && o.handOn?.state === 'partner') return 'withPartner';
  if (o.handOn?.state === 'offered') return 'onOffer';
  // In the accepted plan for its day, and not yet sent out to a driver.
  return o.planned ? 'planned' : 'unplanned';
}

export const TAG_TONE: Record<OrderTag, 'ok' | 'info' | 'warn' | 'danger' | 'idle'> = {
  unplanned: 'warn',
  planned: 'info',
  offeredToYou: 'warn',
  onOffer: 'idle',
  withPartner: 'info',
  onBoard: 'idle',
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
export function daySummary(orders: FleetOrder[]): { orders: number; kg: number; unplanned: number; late: number; delivered: number; handedOn: number } {
  // An order a partner is only OFFERING is not this fleet's day yet: it counts for nothing until it is taken.
  const live = orders.filter((o) => o.status !== 'cancelled' && o.role !== 'offered');
  return {
    orders: live.length,
    kg: Math.round(live.reduce((s, o) => s + o.weightKg, 0)),
    // Without a truck and in nobody's hands: not planned, not offered, not with a partner. (On the board it is `available`.)
    unplanned: live.filter((o) => o.status === 'ordered' && !o.planned && (!o.handOn || o.role === 'partner')).length,
    handedOn: live.filter((o) => o.role !== 'partner' && Boolean(o.handOn) && (o.status === 'ordered' || o.status === 'available')).length,
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
  // A rule it was made under holds for the next plan too — a plan kept from before there were rules has none.
  const rules = rulesAsk(accepted.rules ?? []);
  return {
    day,
    dayStart: s.dayStart,
    dayHours: s.dayHours,
    speedKmh: s.speedKmh,
    loadMin: s.loadMin,
    unloadMin: s.unloadMin,
    ...(out.length ? { excludeVehicleIds: out } : {}),
    ...(rules.keepOff.length ? { keepOff: rules.keepOff } : {}),
    ...(rules.putOn.length ? { putOn: rules.putOn } : {}),
  };
}

/** P5 — a plan's rules, as the two lists a plan is asked with. Both always present, so sending them REPLACES what was asked before. */
export function rulesAsk(rules: PlanRule[]): { keepOff: PlanPair[]; putOn: PlanPair[] } {
  const pairs = (kind: PlanRule['kind']) => rules.filter((r) => r.kind === kind).map((r) => ({ freightId: r.freightId, vehicleId: r.vehicleId }));
  return { keepOff: pairs('keep_off'), putOn: pairs('put_on') };
}

/** P5 — the asks for the same plan with one rule taken off. Read from the plan's own rules: they are what is in force. */
export function withoutRule(rules: PlanRule[], gone: PlanRule): { keepOff: PlanPair[]; putOn: PlanPair[] } {
  return rulesAsk(rules.filter((r) => !(r.kind === gone.kind && r.freightId === gone.freightId && r.vehicleId === gone.vehicleId)));
}

/**
 * P5 — the asks for the same plan with one order kept off one vehicle, BY HAND: a rule must not need the adviser.
 * Asked twice it is one rule; and a put-on of that same order on that same vehicle gives way to it — the office has
 * just said the opposite.
 */
export function keptOff(rules: PlanRule[], pair: PlanPair): { keepOff: PlanPair[]; putOn: PlanPair[] } {
  const now = rulesAsk(rules);
  const same = (p: PlanPair) => p.freightId === pair.freightId && p.vehicleId === pair.vehicleId;
  return { keepOff: now.keepOff.some(same) ? now.keepOff : [...now.keepOff, { freightId: pair.freightId, vehicleId: pair.vehicleId }], putOn: now.putOn.filter((p) => !same(p)) };
}

/**
 * P5 — the asks for the same plan with one order put on one vehicle, BY HAND: that vehicle, or none. An order has one
 * such rule, so an earlier one for it gives way; and so does a keep-off of that same order on that same vehicle.
 */
export function putOnto(rules: PlanRule[], pair: PlanPair): { keepOff: PlanPair[]; putOn: PlanPair[] } {
  const now = rulesAsk(rules);
  return {
    keepOff: now.keepOff.filter((p) => !(p.freightId === pair.freightId && p.vehicleId === pair.vehicleId)),
    putOn: [...now.putOn.filter((p) => p.freightId !== pair.freightId), { freightId: pair.freightId, vehicleId: pair.vehicleId }],
  };
}

/** P5 — a rule as the office reads it. */
export function ruleLine(rule: Pick<PlanRule, 'kind' | 'code' | 'plate'>, t: Translate): string {
  return t(rule.kind === 'keep_off' ? 'fleet.plan.rules.keepOff' : 'fleet.plan.rules.putOn', { code: rule.code, plate: rule.plate });
}

/**
 * P5 — the talk so far, as it is sent with the next thing said: the words only, the newest turns. What changed under
 * a reply is not sent back — the plan as it stands now is, by the server, and that is the only account of it.
 */
export const ADVISER_HISTORY = 12;
export function historyOf(turns: AdviserTurn[]): Array<{ role: 'user' | 'assistant'; text: string }> {
  return turns
    .filter((x) => x.text.trim())
    .slice(-ADVISER_HISTORY)
    .map((x) => ({ role: x.role, text: x.text.slice(0, 4000) }));
}

/** P4 — may this fleet hand this order on (offer it, or release it)? Its own, still without a truck, and nobody's yet. */
export function mayHandOn(o: Pick<FleetOrder, 'role' | 'status' | 'handOn'>): boolean {
  return o.role === 'own' && o.status === 'ordered' && !o.handOn;
}

/** P4 — what came of offering or releasing a batch, as one sentence. */
export function handOnLine(what: 'offer' | 'release', r: HandOnResult, t: Translate): string {
  const n = r.done.length;
  const went = what === 'offer' ? t(n === 1 ? 'fleet.handOn.offeredOne' : 'fleet.handOn.offered', { n, to: r.to.join(', ') }) : t(n === 1 ? 'fleet.handOn.releasedOne' : 'fleet.handOn.released', { n });
  const not = r.refused.length ? ` ${t(r.refused.length === 1 ? 'fleet.handOn.refusedOne' : 'fleet.handOn.refused', { n: r.refused.length, why: r.refused[0].why })}` : '';
  return (n ? went : t('fleet.handOn.none')) + not;
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
