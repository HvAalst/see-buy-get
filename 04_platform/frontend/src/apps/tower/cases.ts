import type { MessageKey, Translate } from '../../shared/i18n';

/*
 * FLAGS AS CASES in the console (backend flag-case.types.ts). What a case says in words, how loud it is, and what the
 * person reading it may do next.
 */

export type CaseSeverity = 'critical' | 'high' | 'medium' | 'low';
export type CaseState = 'open' | 'taken' | 'done' | 'cleared';
export type CaseAct = 'take' | 'let-go' | 'note' | 'done';
/** Which cases a list shows: the live ones (open and taken), the taken ones, or the closed ones. */
export type CaseListName = 'live' | 'taken' | 'closed';

export interface CaseEvent {
  at: string;
  act: 'opened' | 'opened_again' | 'taken' | 'let_go' | 'note' | 'escalated' | 'done' | 'cleared';
  by?: string;
  text?: string;
}

export interface FlagCaseRow {
  caseId: string;
  kind: string;
  subject: string;
  detail: string;
  severity: CaseSeverity;
  state: CaseState;
  openedAt: string;
  openHours: number;
  owner?: { name: string };
  escalatedAt?: string;
  quietUntil?: string;
  closedAt?: string;
  follows?: string;
  history: CaseEvent[];
}

/** How many cases of one kind: all, nobody's, and of those, escalated. */
export interface CaseKindCount {
  kind: string;
  severity: CaseSeverity;
  count: number;
  waiting: number;
  escalated: number;
}

/** What one read of the cases says: a page of them, and the counts of all of them. */
export interface CaseBoard {
  items: FlagCaseRow[];
  /** How many there are of what was asked for; more than items when the list was cut. */
  total: number;
  /** Live cases nobody has taken, whichever list was read. */
  waiting: number;
  kinds: CaseKindCount[];
}

/** The tag colour a severity is read in: only critical is the danger colour. */
export function severityTone(s: CaseSeverity): 'danger' | 'warn' | 'info' | 'quiet' {
  return s === 'critical' ? 'danger' : s === 'high' ? 'warn' : s === 'medium' ? 'info' : 'quiet';
}

const KINDS = ['Stagnant_Inventory', 'Ghost_Bus', 'Stuck_At_MDP', 'Uncollected', 'Never_Dropped_Off', 'Connectivity_Loss', 'Blocked_Corridor', 'Buyer_Dispute', 'Short_Shipped', 'Temp_Breach', 'Not_Seen', 'Pilot_Off_Target', 'Tamper_Hold', 'Held_By_Authority'];

/** Round 35 — the kind whose case closes only by releasing the unit it holds (the tamper protocol). */
export const HOLD_KIND = 'Tamper_Hold';

/** The kind in words; a kind this build has never heard of is shown as it came. */
export function kindWords(kind: string, t: Translate): string {
  return KINDS.includes(kind) ? t(`tower.cases.kind.${kind}` as MessageKey) : kind;
}

/** "3 h", "2 d": how long a case has been open, in the unit a person would say. */
export function openFor(hours: number, t: Translate): string {
  return hours < 48 ? t('tower.cases.hours', { n: Math.max(0, Math.round(hours)) }) : t('tower.cases.days', { n: Math.round(hours / 24) });
}

/** Who has it, or that nobody does — and, when nobody has it past its time, that it was escalated. */
export function ownerLine(c: Pick<FlagCaseRow, 'state' | 'owner' | 'escalatedAt'>, t: Translate): string {
  if (c.state === 'taken' && c.owner) return t('tower.cases.ownedBy', { name: c.owner.name });
  return t(c.escalatedAt ? 'tower.cases.nobodyEscalated' : 'tower.cases.nobody');
}

/** One line of a case's history, in words. */
export function eventLine(e: CaseEvent, t: Translate): string {
  const what = t(`tower.cases.act.${e.act}` as MessageKey, { by: e.by ?? '' });
  return e.text ? `${what}: ${e.text}` : what;
}

/** How a closed case was closed — by whom and why, or by itself — from its history. */
export function closedLine(c: Pick<FlagCaseRow, 'history'>, t: Translate): string {
  const e = [...c.history].reverse().find((x) => x.act === 'done' || x.act === 'cleared');
  return e ? eventLine(e, t) : '';
}

/** What closing a case asks for: a reason of a few words, and a time to look again within a week. */
export function doneBlocker(reason: string, recheckHours: number, t: Translate): string | null {
  if (reason.trim().length < 3) return t('tower.cases.needReason');
  if (!Number.isFinite(recheckHours) || recheckHours < 1 || recheckHours > 168) return t('tower.cases.needRecheck');
  return null;
}

/** Under a kind: how many, how many nobody has, and how many of those were escalated — the parts that are not zero. */
export function kindCountLine(k: Pick<CaseKindCount, 'count' | 'waiting' | 'escalated'>, t: Translate): string {
  const parts = [t('tower.cases.kindCount', { n: k.count })];
  if (k.waiting) parts.push(t('tower.cases.kindWaiting', { n: k.waiting }));
  if (k.escalated) parts.push(t('tower.cases.kindEscalated', { n: k.escalated }));
  return parts.join(' · ');
}

/** The choices for when to look again. */
export const RECHECK_CHOICES = [4, 24, 72, 168] as const;
