import type { BusinessActivity, BusinessView, CarriageContract, CheckState, Membership, MemberRole, NewBusiness, PostedLoad } from './api';
import type { MessageKey, Translate } from '../../shared/i18n';

/** Where somebody is in the Business app. */
export type Section = 'home' | 'loads' | 'runs' | 'contracts' | 'clients' | 'imports' | 'yard' | 'people' | 'details';

/**
 * WHICH SECTIONS A BUSINESS IS SHOWN — from what it says it does, never from what it is allowed.
 *
 * The server decides access; this decides attention. An importer who never clears and never runs a yard should not
 * have to look past a yard register to find their containers, and a section whose every answer is "nothing here"
 * teaches somebody that the app is empty. Imports for anybody whose goods or clients come through a border: the
 * importer, the clearing agent, and the expeditor who handles both for clients.
 */
export function sectionsFor(activities: BusinessActivity[]): Section[] {
  const has = (a: BusinessActivity) => activities.includes(a);
  return [
    'home',
    // B2 — whoever sends goods, or arranges sending them for clients: post a load, or take space on a carrier's run.
    ...(has('shipper') || has('expeditor') ? (['loads', 'runs'] as Section[]) : []),
    // P1 — the carriers it has a standing contract with, whose queue its orders go straight into.
    ...(has('shipper') || has('expeditor') ? (['contracts'] as Section[]) : []),
    // B4 — an expeditor's own book of the clients it sends for, as their agent.
    ...(has('expeditor') ? (['clients'] as Section[]) : []),
    ...(has('importer') || has('clearing_agent') || has('expeditor') ? (['imports'] as Section[]) : []),
    ...(has('depot') ? (['yard'] as Section[]) : []),
    'people',
    'details',
  ];
}

/**
 * WHAT THE CHECK NEEDS FROM THEM NEXT, as one step. The overview leads with it until the business is verified.
 *
 * `papers` add the two papers · `ask` ask for the check · `waiting` staff have it · `refused` put right what they
 * said, then ask again · `done` verified.
 */
export type CheckStep = 'papers' | 'ask' | 'waiting' | 'refused' | 'done';

export function checkStep(check: BusinessView['check']): CheckStep {
  if (check.state === 'verified') return 'done';
  if (check.state === 'asked' || check.state === 'checking') return 'waiting';
  if (check.missing.length) return 'papers';
  return check.state === 'refused' ? 'refused' : 'ask';
}

/** Only an owner changes who is in the business and what it says about itself. Mirrors the server; never replaces it. */
export function mayManage(role: MemberRole | undefined): boolean {
  return role === 'owner';
}

/** A viewer reads. Everybody else works. */
export function mayAct(role: MemberRole | undefined): boolean {
  return Boolean(role) && role !== 'viewer';
}

/**
 * WHICH BUSINESS TO OPEN WITHOUT ASKING, after signing in — or none, and show the list.
 *
 * An invitation always shows the list: somebody has asked them to join something, and opening a different business
 * over the top of that question is how it goes unanswered. Otherwise the one they last used, if they are still in it;
 * otherwise the only one they have. Two or more and no memory: ask.
 */
export function openOnArrival(items: Membership[], last: string | null): string | null {
  if (items.some((m) => m.state === 'invited')) return null;
  const joined = items.filter((m) => m.state === 'joined');
  if (last && joined.some((m) => m.entityId === last)) return last;
  return joined.length === 1 ? joined[0].entityId : null;
}

/**
 * IS THIS THE ONLY OWNER WHO HAS JOINED? Then they can neither leave nor become something else — the server refuses
 * both, because a business always has an owner — so the screen does not offer either. An owner who is only invited is
 * nobody's owner yet.
 */
export function isLastOwner(rows: Array<{ memberId: string; role: MemberRole; state: 'invited' | 'joined' }>, memberId: string): boolean {
  const owners = rows.filter((m) => m.role === 'owner' && m.state === 'joined');
  return owners.length === 1 && owners[0].memberId === memberId;
}

/** The tag a check state wears in a list. */
export function checkTone(state: CheckState): 'ok' | 'warn' | 'info' | 'quiet' {
  if (state === 'verified') return 'ok';
  if (state === 'refused') return 'warn';
  if (state === 'asked' || state === 'checking') return 'info';
  return 'quiet';
}

/** What the setup form is still missing, as field names — the screen says each in words. */
export function newBusinessGaps(form: NewBusiness): Array<keyof NewBusiness> {
  const gaps: Array<keyof NewBusiness> = [];
  if (!form.name.trim()) gaps.push('name');
  if (!/^[A-Za-z]{2}$/.test(form.country.trim())) gaps.push('country');
  if (!form.registrationNo.trim()) gaps.push('registrationNo');
  if (!form.activities.length) gaps.push('activities');
  if (!form.yourName.trim()) gaps.push('yourName');
  return gaps;
}

/** What the load form still needs, as field names — the screen says each in words. */
export interface LoadForm {
  description: string;
  fromSiteId: string;
  toSiteId: string;
  weightKg: string;
}
export function loadGaps(form: LoadForm): Array<keyof LoadForm> {
  const gaps: Array<keyof LoadForm> = [];
  if (!form.description.trim()) gaps.push('description');
  if (!form.fromSiteId) gaps.push('fromSiteId');
  if (!form.toSiteId) gaps.push('toSiteId');
  const kg = Number(form.weightKg);
  if (!(Number.isFinite(kg) && kg >= 1)) gaps.push('weightKg');
  return gaps;
}

/**
 * WHERE A LOAD HAS GOT, as one word for its list. `posted` waiting for a carrier · `offers` carriers have named
 * prices · `taken` a carrier has it · `moving` picked up · `delivered` · `cancelled`.
 */
export type LoadStage = 'ordered' | 'posted' | 'offers' | 'taken' | 'moving' | 'delivered' | 'cancelled';
export function loadStage(l: { status: string; openProposals: number; pickedUpAt?: string; deliveredAt?: string; cancelledAt?: string; carrier?: unknown }): LoadStage {
  if (l.cancelledAt || l.status === 'cancelled') return 'cancelled';
  if (l.deliveredAt || l.status === 'delivered') return 'delivered';
  if (l.pickedUpAt || l.status === 'in_transit') return 'moving';
  if (l.carrier || l.status === 'claimed') return 'taken';
  // P1 — with the contract carrier, waiting to be put on one of its trucks. Never on the board, never offered prices.
  if (l.status === 'ordered') return 'ordered';
  return l.openProposals > 0 ? 'offers' : 'posted';
}

/** A span of minutes as somebody says it — "40 minutes", "1 hour", "2 hours 05 minutes" — in the words the notice of it uses. */
export function spanWords(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  if (h === 0) return m === 1 ? '1 minute' : `${m} minutes`;
  return m % 60 === 0 ? hours : `${hours} ${String(m % 60).padStart(2, '0')} minutes`;
}

/**
 * A PLAN THAT MISSES THE WINDOW, as the shipper reads it: a few words for the load's row, and the whole of it on the
 * load. Nothing when the carrier's plan has it inside the window, or there is no plan. Always "about": a plan's time
 * is an estimate, and the words must not make a promise of it.
 */
export function windowMiss(o: PostedLoad['outsideWindow'], t: Translate): { row: string; full: string } | null {
  const late = o?.lateMin ? true : o?.earlyMin ? false : null;
  if (!o || late === null) return null;
  const by = spanWords(o.lateMin ?? o.earlyMin ?? 0);
  const asked = o.window ? t('business.loads.win.asked', { window: o.window }) : t('business.loads.win.askedPlain');
  return {
    row: t(late ? 'business.loads.win.late' : 'business.loads.win.early', { at: o.arrive, by }),
    full: t(late ? 'business.loads.win.lateFull' : 'business.loads.win.earlyFull', { at: o.arrive, day: o.day, by, asked }),
  };
}

/**
 * WHAT THE CARRIER'S PLAN SAYS OF A LOAD, as one thing: `late` it should have arrived and has not · `left` it is on
 * no vehicle · `outside` it is planned outside the window asked for · `planned` it is planned, in time or with no
 * window to keep. The worst comes first, because a row says one thing: a day that has gone outranks everything, then
 * an order on no vehicle, then an hour that has passed. Nothing while there is no accepted plan to speak of.
 *
 * The first two are said in the colour of something to act on. The third is said quietly and never rings: an order
 * that is going to plan needs nobody — and the same few words are where a shipper looks when somebody asks "when?".
 */
export interface PlanSays {
  state: 'late' | 'left' | 'outside' | 'planned';
  /** A few words for the load's row. */
  row: string;
  /** The whole of it, on the load itself. */
  full: string;
  /** On no vehicle by the CLOCK, not by a plan: no accepted plan said anything of it, and it is not said that one did. */
  noPlan?: true;
}

/**
 * What to do about it, said after it. Whose word it is comes first: a plan's own time is an estimate and the plan can
 * be made again — but an order the clock found on no vehicle is in no plan, and is not said to be what a plan says.
 */
export function planDo(says: PlanSays, fleet: string, t: Translate): string {
  if (says.state === 'planned') return t('business.loads.plan.estimate');
  if (says.state === 'late') return t('business.loads.late.do', { fleet });
  if (says.state === 'left') return t(says.noPlan ? 'business.loads.left.doToday' : 'business.loads.left.do', { fleet });
  return t('business.loads.win.estimate', { fleet });
}

export function planSays(l: Pick<PostedLoad, 'leftOut' | 'outsideWindow' | 'plannedAbout' | 'runningLate' | 'deliverOn'>, t: Translate): PlanSays | null {
  if (l.runningLate === 'day') return { state: 'late', row: t('business.loads.late.day', { day: l.deliverOn ?? '' }), full: t('business.loads.late.dayFull', { day: l.deliverOn ?? '' }) };
  if (l.runningLate === 'hour' && l.plannedAbout) {
    const at = l.plannedAbout.arrive;
    return { state: 'late', row: t('business.loads.late.hour', { at }), full: t('business.loads.late.hourFull', { at, day: l.plannedAbout.day }) };
  }
  if (l.leftOut) {
    const why = t(`business.loads.left.${l.leftOut.why}` as MessageKey, { day: l.leftOut.day });
    return { state: 'left', row: why, full: t('business.loads.left.full', { why }) };
  }
  // The day's work has begun and it is on no vehicle — in no plan, or off the trip it was planned on: the same thing
  // to a shipper as a plan that left it out, without a why.
  if (l.runningLate === 'unplanned') return { state: 'left', noPlan: true, row: t('business.loads.left.today'), full: t('business.loads.left.todayFull', { day: l.deliverOn ?? '' }) };
  const miss = windowMiss(l.outsideWindow, t);
  if (miss) return { state: 'outside', ...miss };
  const p = l.plannedAbout;
  if (!p) return null;
  return p.window
    ? { state: 'planned', row: t('business.loads.plan.rowIn', { at: p.arrive }), full: t('business.loads.plan.fullIn', { at: p.arrive, day: p.day, window: p.window }) }
    : { state: 'planned', row: t('business.loads.plan.row', { at: p.arrive }), full: t('business.loads.plan.full', { at: p.arrive, day: p.day }) };
}

/**
 * WHERE A HANDOVER FELL AGAINST WHAT WAS ASKED, as the shipper reads it: when it was handed over on the carrier's own
 * clock, and whether that was the day and the window asked for. "Inside your window" is said too — it is the answer
 * somebody asks for. Nothing where the carrier had no clock: no time was read, and none is made up.
 */
export interface DeliverySays {
  /** `warn` — after or before the window, or after its day · `quiet` — as asked, or with nothing to hold it against. */
  tone: 'warn' | 'quiet';
  tag?: string;
  row: string;
  full: string;
}
export function deliverySays(l: Pick<PostedLoad, 'deliveryTiming' | 'deliverOn'>, t: Translate): DeliverySays | null {
  const d = l.deliveryTiming;
  if (!d) return null;
  if (d.otherDay === 'late') return { tone: 'warn', tag: t('business.loads.done.tagDay'), row: t('business.loads.done.dayLate', { day: d.day, ordered: l.deliverOn ?? '' }), full: t('business.loads.done.dayLateFull', { at: d.at, day: d.day, ordered: l.deliverOn ?? '' }) };
  if (d.otherDay === 'early') return { tone: 'quiet', row: t('business.loads.done.dayEarly', { day: d.day }), full: t('business.loads.done.dayEarlyFull', { at: d.at, day: d.day, ordered: l.deliverOn ?? '' }) };
  if (d.window && d.lateMin) return { tone: 'warn', tag: t('business.loads.done.tagAfter'), row: t('business.loads.done.after', { at: d.at, by: spanWords(d.lateMin) }), full: t('business.loads.done.afterFull', { at: d.at, by: spanWords(d.lateMin), window: d.window }) };
  if (d.window && d.earlyMin) return { tone: 'warn', tag: t('business.loads.done.tagBefore'), row: t('business.loads.done.before', { at: d.at, by: spanWords(d.earlyMin) }), full: t('business.loads.done.beforeFull', { at: d.at, by: spanWords(d.earlyMin), window: d.window }) };
  if (d.window) return { tone: 'quiet', row: t('business.loads.done.inside', { at: d.at }), full: t('business.loads.done.insideFull', { at: d.at, window: d.window }) };
  return { tone: 'quiet', row: t('business.loads.done.at', { at: d.at }), full: t('business.loads.done.atFull', { at: d.at }) };
}

/** P1 — the day after `now`, as YYYY-MM-DD in the reader's own calendar: next-day delivery is the ordinary order. */
export function nextDay(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** P1 — the contracts a load can be ordered under: standing, and open on the day it must arrive. */
export function orderableContracts(items: CarriageContract[], deliverOn: string): CarriageContract[] {
  return items.filter((c) => c.status === 'active' && (!c.startsOn || deliverOn >= c.startsOn) && (!c.endsOn || deliverOn <= c.endsOn));
}

/** P1 — a contract's period in words. */
export function contractPeriod(c: Pick<CarriageContract, 'startsOn' | 'endsOn'>, t: Translate): string {
  if (c.startsOn && c.endsOn) return t('business.contracts.period', { from: c.startsOn, to: c.endsOn });
  if (c.startsOn) return t('business.contracts.from', { from: c.startsOn });
  if (c.endsOn) return t('business.contracts.until', { to: c.endsOn });
  return t('business.contracts.openEnded');
}

/** At least nine digits, the server's own test of a plausible number. */
export function phoneReady(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 9;
}

export function digitsReady(value: string, length: number): boolean {
  return new RegExp(`^\\d{${length}}$`).test(value);
}

export const ACTIVITIES: BusinessActivity[] = ['shipper', 'importer', 'expeditor', 'clearing_agent', 'depot'];
export const ROLES: MemberRole[] = ['owner', 'booker', 'finance', 'viewer'];
