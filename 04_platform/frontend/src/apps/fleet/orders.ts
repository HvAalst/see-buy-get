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
export type LoadOf = components['schemas']['LoadOf'];
export type OrderLoads = components['schemas']['OrderLoads'];
export type PlanStop = components['schemas']['PlanStopView'];
export type PlanAdvice = components['schemas']['PlanAdviceView'];
export type AdviserFailure = NonNullable<PlanAdvice['failed']>;
export type RosterView = components['schemas']['RosterView'];
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
    importOrders: (contractId: string, body: { text?: string; workbook?: string; pickupLabel?: string; pickupLat?: number; pickupLng?: number; dryRun: boolean }): Promise<Result<ImportResult>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/contracts/{contractId}/orders/import', { params: { path: { did, contractId } }, body })) as never,
    template: (): Promise<Result<{ fileName: string; csv: string }>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/orders/template', { params: { path } })) as never,
    /** An order split into loads by weight (they add up to it), and put back together while nothing has been done with any of them. */
    splitOrder: (freightId: string, loadsKg: number[]): Promise<Result<OrderLoads>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/split', { params: { path: { did, freightId } }, body: { loadsKg } })) as never,
    rejoinOrder: (freightId: string): Promise<Result<OrderLoads>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/rejoin', { params: { path: { did, freightId } } })) as never,
    withdraw: (freightId: string, reason: string): Promise<Result<{ withdrawn: true }>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/{freightId}/withdraw', { params: { path: { did, freightId } }, body: { reason } })) as never,
    /** P3 — a proposal for a day (changes nothing), accepting one (kept, and written onto its orders), and the day's accepted plan. */
    proposePlan: (ask: PlanAsk): Promise<Result<DayPlan>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/plan', { params: { path }, body: ask })) as never,
    acceptPlan: (ask: PlanAsk): Promise<Result<DayPlan>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/plan/accept', { params: { path }, body: ask })) as never,
    /** P3b — send the next trip to every truck in today's accepted plan that is ready for one. */
    sendPlan: (day: string): Promise<Result<PlanSendResult>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/plan/send', { params: { path }, body: { day } })) as never,
    planState: (day: string): Promise<Result<DayPlanState>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/plan', { params: { path, query: { day } } })) as never,
    /** Who drives on a day: as it stands, and saying it — the whole list, which replaces what was said for that day. */
    roster: (day: string): Promise<Result<RosterView>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/roster', { params: { path, query: { day } } })) as never,
    setRoster: (day: string, driverDids: string[], starts: Array<{ driverDid: string; siteId: string }> = []): Promise<Result<RosterView>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/roster', { params: { path }, body: { day, driverDids, ...(starts.length ? { starts } : {}) } })) as never,
    /** The fleet's sites, for where a driver starts on a day. */
    sites: (): Promise<Result<components['schemas']['FleetSitesView']>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/sites', { params: { path } })) as never,
    /** The fleet's own clock: which time zone its plans, its "today" and its deliveries are read on — and choosing it. */
    clock: (): Promise<Result<FleetClock>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/clock', { params: { path } })) as never,
    setClock: (timeZone: string): Promise<Result<FleetClock>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/clock', { params: { path }, body: { timeZone } })) as never,
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
    /** A partner that took orders offers them on to its own partners — where the fleet they came from allows it. */
    passOnOrders: (freightIds: string[]): Promise<Result<HandOnResult>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/orders/pass-on', { params: { path }, body: { freightIds } })) as never,
    /** The offering fleet's switch: may this partner pass its orders on to a fleet of its own. */
    setPassOn: (partnershipId: string, allowed: boolean): Promise<Result<Partnership>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/partners/{partnershipId}/pass-on', { params: { path: { did, partnershipId } }, body: { allowed } })) as never,
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
  // Taken by this fleet and on offer to its own partners: on offer, not waiting for one of its trucks.
  if (o.role === 'partner' && o.handOn?.onward) return 'onOffer';
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
  // Nor is one this fleet passed on: another fleet carries it, and it is in that fleet's day.
  const live = orders.filter((o) => o.status !== 'cancelled' && o.role !== 'offered' && o.role !== 'passed');
  return {
    orders: live.length,
    kg: Math.round(live.reduce((s, o) => s + o.weightKg, 0)),
    // Without a truck and in nobody's hands: not planned, not offered, not with a partner. (On the board it is `available`.)
    unplanned: live.filter((o) => o.status === 'ordered' && !o.planned && (!o.handOn || (o.role === 'partner' && !o.handOn.onward))).length,
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
 * WHO THE PLAN COUNTED AS DRIVING, in a line under its answer: the day's roster, by name — or, where nobody has said
 * who drives that day, that it counted every active driver. Nothing for a plan kept from before there were rosters.
 */
export function rosterLine(plan: Pick<DayPlan, 'roster' | 'totals'>, t: Translate): { tone: 'warn' | 'idle'; text: string } | null {
  if (!plan.roster) return null;
  if (plan.roster.source === 'everyone') return { tone: 'warn', text: t('fleet.roster.planEveryone', { n: plan.totals.drivers }) };
  if (plan.roster.names.length === 0) return { tone: 'warn', text: t('fleet.roster.planNobody') };
  return { tone: 'idle', text: t('fleet.roster.planCounted', { n: plan.roster.names.length, names: plan.roster.names.join(', ').replace(/\.$/, '') }) };
}

/** The drivers ticked on a day's roster card, as first shown: whoever the day counts now. */
export function rosterPicks(view: Pick<RosterView, 'list'>): Set<string> {
  return new Set(view.list.filter((d) => d.rostered).map((d) => d.driverDid));
}

/**
 * Whether what is ticked says something new. A day nobody has rostered is not the same as one rostered with everybody:
 * a driver who joins later is counted on the first and not on the second — so saying "everybody" is a change too.
 */
export function rosterChanged(view: Pick<RosterView, 'list' | 'source'>, picked: ReadonlySet<string>, starts: Readonly<Record<string, string>> = {}, shifts: Readonly<Record<string, string>> = {}): boolean {
  if (view.source === 'everyone') return true;
  const was = rosterPicks(view);
  if (was.size !== picked.size || [...picked].some((did) => !was.has(did))) return true;
  // Somebody on the day starting from another site, or on another shift, than the roster has them is a change too.
  return view.list.some(
    (d) => picked.has(d.driverDid) && ((starts[d.driverDid] !== undefined && starts[d.driverDid] !== d.siteId) || (shifts[d.driverDid] !== undefined && shifts[d.driverDid] !== d.shiftId)),
  );
}

/** Which shift each driver starts on, as the roster has it; nothing for a driver whose site has no shifts. */
export function rosterShifts(view: Pick<RosterView, 'list'>): Record<string, string> {
  return Object.fromEntries(view.list.filter((d) => d.shiftId).map((d) => [d.driverDid, d.shiftId!]));
}

/** ONE SHIFT AT ONE SITE, in a line: when it starts, the drivers rostered on it and the drivers it needs — short, it warns. */
export function shiftLine(s: { siteName: string; shiftName?: string; start: string; rostered: number; needed: number }, t: Translate): { tone: 'warn' | 'idle'; text: string } {
  const text = t(s.shiftName ? 'fleet.plan.shiftLine' : 'fleet.plan.dayLine', { site: s.siteName, shift: s.shiftName ?? '', start: s.start, rostered: s.rostered, needed: s.needed });
  return { tone: s.needed > s.rostered ? 'warn' : 'idle', text };
}

/** Where each driver starts on the day, as the roster has it: their own site unless the office said another. */
export function rosterStarts(view: Pick<RosterView, 'list'>): Record<string, string> {
  return Object.fromEntries(view.list.map((d) => [d.driverDid, d.siteId]));
}

/** PER SITE, in a line: how many of its trucks went out, and how many drivers start there — a site short of drivers says so. */
export function siteLine(s: { name: string; trucksAvailable: number; trucksUsed: number; drivers: number }, t: Translate): { tone: 'warn' | 'idle'; text: string } {
  const text = t('fleet.plan.siteLine', { site: s.name, used: s.trucksUsed, trucks: s.trucksAvailable, drivers: s.drivers });
  return { tone: s.drivers < s.trucksAvailable && s.trucksUsed === s.drivers ? 'warn' : 'idle', text };
}

/** The largest workbook sent. The server holds the same line; said here so a big file is refused before it is read. */
export const MAX_WORKBOOK_BYTES = 1_000_000;

/** An Excel workbook the server reads as it is (.xlsx, and .xlsm — the same file with macros, which are not run). */
export function isWorkbook(fileName: string): boolean {
  return ['xlsx', 'xlsm'].includes(extOf(fileName));
}

/** What comes after the last dot of a file's name — nothing, for a name without one. */
function extOf(fileName: string): string {
  return /\.([a-z0-9]+)$/.exec(fileName.trim().toLowerCase())?.[1] ?? '';
}

/** A workbook's bytes as base64, for the wire. In pieces: one call with a megabyte of arguments is too many. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * P1b — a file this cannot read as a sheet, by its name: the spreadsheet formats that are neither text nor an .xlsx
 * workbook (an old .xls, OpenDocument, Numbers), and things that are not sheets at all. Said before anything is sent.
 * Null means it may be a sheet — as text, or as a workbook (see isWorkbook).
 */
export function notASheet(fileName: string): MessageKey | null {
  const ext = extOf(fileName);
  if (['xls', 'xlsb', 'ods', 'numbers'].includes(ext)) return 'fleet.upload.notText';
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

/**
 * WHAT CAME OF A STOP'S DELIVERY WINDOW, as one line and how loudly to say it — or nothing, when the door is reached
 * inside its window or never had one. Late and early are the plan not doing what was asked (the order is delivered
 * all the same); waiting is the plan doing it; unread is the plan saying it did not understand the words.
 */
export function windowLine(stop: Pick<PlanStop, 'deliveryWindow' | 'window' | 'windowUnread' | 'lateMin' | 'earlyMin' | 'waitMin'>, t: Translate): { tone: 'danger' | 'warn' | 'idle'; text: string } | null {
  if (stop.lateMin) return { tone: 'danger', text: t('fleet.plan.win.late', { by: hoursWords(stop.lateMin), window: stop.window ?? '' }) };
  if (stop.earlyMin) return { tone: 'danger', text: t('fleet.plan.win.early', { by: hoursWords(stop.earlyMin), window: stop.window ?? '' }) };
  if (stop.windowUnread) return { tone: 'warn', text: t('fleet.plan.win.unread', { words: stop.deliveryWindow ?? '' }) };
  if (stop.waitMin) return { tone: 'idle', text: t('fleet.plan.win.waits', { by: hoursWords(stop.waitMin), window: stop.window ?? '' }) };
  return null;
}

/**
 * THE FLEET'S OWN CLOCK. `country` — its country keeps one time zone, so nobody chose it · `office` — the office chose
 * it · `none` — its country keeps several and nobody has chosen yet.
 */
export interface FleetClock {
  timeZone?: string;
  name?: string;
  now?: string;
  today?: string;
  source: 'country' | 'office' | 'none';
  /** The clocks its country keeps: each with what people call it and what time it is there now. */
  choices: Array<{ timeZone: string; name: string; now: string }>;
}

/**
 * WHICH CLOCK A PLAN'S TIMES ARE ON, in a line — and, said louder, that there is none: then "today" is the day in UTC
 * and nobody can be told whether a delivery was on time or is running late, which an office should know before it
 * reads a time off the board.
 */
export function clockLine(clock: FleetClock, t: Translate): { tone: 'idle' | 'warn'; text: string } {
  if (clock.source === 'none' || !clock.timeZone) return { tone: 'warn', text: t('fleet.plan.clock.none') };
  return { tone: 'idle', text: t(clock.source === 'office' ? 'fleet.plan.clock.office' : 'fleet.plan.clock.country', { name: clock.name ?? clock.timeZone, zone: clock.timeZone, now: clock.now ?? '' }) };
}

/** May the office choose its clock here: it must where it has none, and it may where its country keeps several. */
export function mayChooseClock(clock: FleetClock): boolean {
  return clock.source === 'none' || clock.choices.length > 1;
}

/** Is this day the fleet's today — on its own clock where it has one, on this device's where it has not. */
export function isFleetToday(day: string, clock: FleetClock | null, now: Date): boolean {
  return day === (clock?.today ?? dayOf(now));
}

/**
 * WHEN AN ORDER WAS HANDED OVER, on the office's own clock, and where that fell against what its shipper asked for —
 * the same thing the shipper is told. Louder where it missed the window or the day: the office is the one that can do
 * something about the next one. Nothing for a delivery made before the fleet had a clock.
 */
export function deliveredLine(o: Pick<FleetOrder, 'deliveryTiming' | 'deliverOn'>, t: Translate): { tone: 'idle' | 'warn'; text: string } | null {
  const d = o.deliveryTiming;
  if (!d) return null;
  if (d.otherDay === 'late') return { tone: 'warn', text: t('fleet.orders.done.dayLate', { at: d.at, day: d.day, ordered: o.deliverOn }) };
  if (d.otherDay === 'early') return { tone: 'idle', text: t('fleet.orders.done.dayEarly', { at: d.at, day: d.day, ordered: o.deliverOn }) };
  if (d.window && d.lateMin) return { tone: 'warn', text: t('fleet.orders.done.after', { at: d.at, by: hoursWords(d.lateMin), window: d.window }) };
  if (d.window && d.earlyMin) return { tone: 'warn', text: t('fleet.orders.done.before', { at: d.at, by: hoursWords(d.earlyMin), window: d.window }) };
  return { tone: 'idle', text: d.window ? t('fleet.orders.done.inside', { at: d.at, window: d.window }) : t('fleet.orders.done.at', { at: d.at }) };
}

/**
 * WILL ACCEPTING THIS PLAN TELL A SHIPPER SOMETHING? It does when the plan leaves an order out, or has one outside its
 * window — and pressing Accept is then an act that reaches outside the office, so the board says so beforehand. (Only
 * a shipper that placed the order itself is told; the server knows which, the board does not, so it says "where".)
 * A plan with nothing on a vehicle cannot be accepted, and tells nobody.
 */
export function acceptTellsShippers(plan: Pick<DayPlan, 'unplanned' | 'totals'>): boolean {
  return plan.totals.planned > 0 && (plan.unplanned.length > 0 || (plan.totals.outsideWindow ?? 0) > 0);
}

/**
 * WHAT A PLAN'S DISTANCES ARE, in a line. By road, from the routing server (and how many legs it knew no road for);
 * an estimate, as a plan was always made; or — said louder, because it is not what the office expects where there IS
 * a routing server — an estimate because the routing server could not be used, with why. A plan kept from before
 * there was one to ask was an estimate.
 */
export function distanceLine(d: DayPlan['distances'], t: Translate): { tone: 'idle' | 'warn'; text: string } {
  if (d?.source === 'roads') return { tone: 'idle', text: [t('fleet.plan.dist.roads'), d.gaps ? t(d.gaps === 1 ? 'fleet.plan.dist.gapOne' : 'fleet.plan.dist.gaps', { n: d.gaps }) : ''].filter(Boolean).join(' ') };
  return d?.why ? { tone: 'warn', text: t('fleet.plan.dist.fallback', { why: d.why }) } : { tone: 'idle', text: t('fleet.plan.dist.estimate') };
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

/** The most loads one order goes in. The server holds the same line. */
export const MAX_ORDER_LOADS = 20;

/**
 * AN ORDER'S WEIGHT SHARED OUT OVER `n` LOADS, as evenly as whole kilos allow — and adding up to the order exactly,
 * because the server refuses a split that does not. The kilos left over go one each onto the first loads; any part
 * of a kilo goes on the first.
 */
export function evenLoads(weightKg: number, n: number): number[] {
  const count = Math.max(2, Math.min(MAX_ORDER_LOADS, Math.floor(n) || 2));
  const base = Math.floor(weightKg / count);
  const loads: number[] = Array(count).fill(base);
  let rest = Math.round((weightKg - base * count) * 100) / 100;
  for (let i = 0; rest >= 1 && i < count; i++) {
    loads[i] += 1;
    rest = Math.round((rest - 1) * 100) / 100;
  }
  loads[0] = Math.round((loads[0] + rest) * 100) / 100;
  return loads;
}

/** A load, said: which one, of how many, of which order, and what the whole order weighs. */
export function loadLine(p: Pick<LoadOf, 'no' | 'of' | 'rootCode' | 'orderKg'>, t: Translate): string {
  return t('fleet.split.loadOf', { no: p.no, of: p.of, order: p.rootCode, weight: weightWords(p.orderKg) });
}

/** May the office split this order: its own, still without a truck, in nobody else's hands, not one piece, and more than one kilo. */
export function maySplit(o: Pick<FleetOrder, 'role' | 'status' | 'handOn' | 'weightKg'> & { indivisible?: boolean }): boolean {
  return o.role === 'own' && o.status === 'ordered' && !o.handOn && !o.indivisible && o.weightKg >= 2;
}

/** May the office ASK to put a split order back together — from any load of it that is still its own to plan. */
export function mayRejoin(o: Pick<FleetOrder, 'role' | 'status' | 'handOn'> & { partOf?: unknown }): boolean {
  return Boolean(o.partOf) && o.role === 'own' && o.status === 'ordered' && !o.handOn;
}

/** P4 — may this fleet hand this order on (offer it, or release it)? Its own, still without a truck, and nobody's yet. */
export function mayHandOn(o: Pick<FleetOrder, 'role' | 'status' | 'handOn'>): boolean {
  return o.role === 'own' && o.status === 'ordered' && !o.handOn;
}

/**
 * WHETHER THIS FLEET MAY PASS AN ORDER ON to a fleet of its own, and if not, why not — so the screen offers it only
 * where the server will allow it, and says the one thing that is in somebody else's hands.
 *  - `yes` it took the order, has not passed it on already, the fleet it came from allows it, and it has a partner of its own;
 *  - `not_allowed` everything but the leave of the fleet it came from;
 *  - `no` not this fleet's to pass on (or nobody to pass it to): nothing is said.
 * The server decides again when it is done, and again when the order is taken.
 */
export function passOnState(o: Pick<FleetOrder, 'role' | 'status' | 'handOn' | 'contract'>, lists: Pick<PartnerLists, 'offeringTo' | 'offeredBy'> | null): 'yes' | 'not_allowed' | 'no' {
  if (o.role !== 'partner' || o.status !== 'ordered' || !o.handOn || o.handOn.via || o.handOn.onward) return 'no';
  const from = o.contract.fleetDid;
  // A partner of its own that is not the fleet the order came from.
  if (!(lists?.offeringTo ?? []).some((p) => p.status === 'active' && p.toFleetDid && p.toFleetDid !== from)) return 'no';
  return (lists?.offeredBy ?? []).some((p) => p.status === 'active' && p.fromFleetDid === from && p.mayPassOn === true) ? 'yes' : 'not_allowed';
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
    case 'off_road':
      return t('fleet.plan.send.offRoad', { why: truck.held[0]?.why ?? truck.plate });
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
