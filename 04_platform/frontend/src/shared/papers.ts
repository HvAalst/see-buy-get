import { formatDate, type Translate } from './i18n';

/**
 * FP4 — a paper's state today, as the server derives it from its expiry date at the moment of asking.
 *
 * Shared between the fleet app (its own vehicles and drivers) and the operator console (the couriers and
 * vehicles no fleet office looks after), so the two can never describe the same date in two ways.
 */
export type PaperKind = 'insurance' | 'inspection' | 'licence' | 'operator_licence' | 'carrier_insurance';
/** ok = in date · due = within 30 days · lapsed = the date has passed · none = no date recorded (switches nothing off). */
export type PaperState = 'ok' | 'due' | 'lapsed' | 'none';

export interface PaperView {
  kind: PaperKind;
  state: PaperState;
  expiresAt?: string;
  /** Whole days until it lapses; negative once it has. Absent without a date. */
  daysLeft?: number;
  reference?: string;
}

/** A stop, a warning, a gap, or quiet. */
export function paperTone(state: PaperState): 'danger' | 'warn' | 'idle' | 'ok' {
  return state === 'lapsed' ? 'danger' : state === 'due' ? 'warn' : state === 'none' ? 'idle' : 'ok';
}

/**
 * A total map, not a ternary chain: the chain ended in 'Driving licence', so an operator's transport licence
 * would have been named as a lorry driver's card — and a refusal naming the wrong paper sends somebody to
 * fetch the wrong thing. A kind added to PaperKind without a label here is now a type error.
 */
const KIND_KEYS = {
  insurance: 'fleet.papers.insurance',
  inspection: 'fleet.papers.inspection',
  licence: 'fleet.papers.licence',
  operator_licence: 'fleet.papers.operatorLicence',
  carrier_insurance: 'fleet.papers.carrierInsurance',
} as const satisfies Record<PaperKind, string>;

export function paperKindLabel(kind: PaperKind, t: Translate): string {
  return t(KIND_KEYS[kind]);
}

/**
 * The day a paper runs out, in the viewer's locale. A date-only expiry ("2026-09-03") is read as that calendar
 * day, not as midnight UTC — which in a western time zone would print the day before.
 */
export function paperDay(expiresAt: string | undefined): string {
  if (!expiresAt) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresAt);
  return formatDate(m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : expiresAt);
}

/** One line that says what the date did: "Insurance lapsed 3 Sep 2026", "Driving licence runs out 12 Oct 2026 (27 days)". */
export function paperLine(p: Pick<PaperView, 'kind' | 'state' | 'expiresAt' | 'daysLeft'>, t: Translate): string {
  const kind = paperKindLabel(p.kind, t);
  const day = paperDay(p.expiresAt);
  if (p.state === 'lapsed') return t('fleet.papers.lapsed', { kind, day });
  if (p.state === 'due') return (p.daysLeft ?? 0) <= 1 ? t('fleet.papers.dueToday', { kind }) : t('fleet.papers.due', { kind, day, days: p.daysLeft ?? 0 });
  if (p.state === 'none') return t('fleet.papers.none', { kind });
  return t('fleet.papers.ok', { kind, day });
}

/** The row line's class: red for a stop, navy for a warning, the quiet grey for a gap. */
export function paperLineClass(state: PaperState): string {
  return state === 'lapsed' ? 'row__s row__s--danger' : state === 'due' ? 'row__s row__s--warn' : 'row__s';
}

/** The papers worth a line on a list row: everything that is not simply in date. */
export function papersToShow(papers: PaperView[] | undefined): PaperView[] {
  return (papers ?? []).filter((p) => p.state !== 'ok');
}

/**
 * Whether a typed renewal date can be saved: present, and after today. The server refuses a past one as
 * the typo it is; saying so before the round trip is a courtesy, not the rule.
 */
export function renewalBlocker(expiresAt: string, today: Date = new Date()): 'tower.papers.needDate' | 'tower.papers.datePast' | null {
  if (!expiresAt) return 'tower.papers.needDate';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresAt);
  if (!m) return 'tower.papers.needDate';
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return day.getTime() <= start.getTime() ? 'tower.papers.datePast' : null;
}
