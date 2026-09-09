import type { components } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

/** One row of the disputed-hazard queue, exactly as the contract describes it. */
export type ConstraintView = components['schemas']['ConstraintView'];
export type ConstraintKind = ConstraintView['kind'];

/**
 * What each kind DOES to a load — a blocker stops a vehicle, an advisory only costs it time.
 *
 * The server owns this distinction (CONSTRAINT_EFFECT) and the view does not carry it, so it is
 * restated here for one purpose: an operator triaging a queue needs to see at a glance which of these
 * rows is stopping trucks. `Record<ConstraintKind, …>` is what keeps the restatement honest — a kind
 * added to the contract fails THIS FILE to compile rather than quietly rendering an empty column.
 */
export const KIND_EFFECT: Record<ConstraintKind, 'blocks' | 'advisory'> = {
  LOW_BRIDGE: 'blocks',
  HEIGHT_BARRIER: 'blocks',
  WEIGHT_LIMIT: 'blocks',
  NO_HAZMAT: 'blocks',
  WASHOUT: 'blocks',
  WEIGHBRIDGE: 'advisory',
  FERRY: 'advisory',
  CHECKPOINT: 'advisory',
};

/** The i18n key for each kind's name. Same rule as above: every kind has one, checked by the compiler. */
export const KIND_KEY: Record<ConstraintKind, MessageKey> = {
  LOW_BRIDGE: 'tower.kind.LOW_BRIDGE',
  HEIGHT_BARRIER: 'tower.kind.HEIGHT_BARRIER',
  WEIGHT_LIMIT: 'tower.kind.WEIGHT_LIMIT',
  NO_HAZMAT: 'tower.kind.NO_HAZMAT',
  WASHOUT: 'tower.kind.WASHOUT',
  WEIGHBRIDGE: 'tower.kind.WEIGHBRIDGE',
  FERRY: 'tower.kind.FERRY',
  CHECKPOINT: 'tower.kind.CHECKPOINT',
};

export function kindLabel(kind: ConstraintKind, t: Translate): string {
  return t(KIND_KEY[kind]);
}

/**
 * The posted number, in the unit it was posted in: metres for a clearance, TONNES for a limit.
 *
 * The wire carries kilograms because that is what a load is weighed in, and a road sign is written in
 * tonnes. Showing "12000" against a sign that says "12" is the kind of mismatch that makes somebody
 * check the wrong thing.
 */
export function measureLabel(row: Pick<ConstraintView, 'kind' | 'value'>, t: Translate): string {
  if (typeof row.value !== 'number') return '—';
  if (row.kind === 'WEIGHT_LIMIT') return t('tower.unit.tonnes', { n: round1(row.value / 1000) });
  if (row.kind === 'LOW_BRIDGE' || row.kind === 'HEIGHT_BARRIER') return t('tower.unit.metres', { n: round1(row.value) });
  return String(row.value);
}

/**
 * How long this dispute has been waiting on an operator.
 *
 * Measured from `disputedAt` — when somebody said the hazard was gone — and NOT from the report. A
 * bridge reported two years ago and disputed this morning has been waiting since this morning. Records
 * written before the field existed fall back to the report date, which is the only date they have.
 */
export function waitingHours(row: Pick<ConstraintView, 'disputedAt' | 'reportedAt'>, now: number): number {
  const since = Date.parse(row.disputedAt ?? row.reportedAt);
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, (now - since) / 3_600_000);
}

/**
 * A display threshold, and only that: nothing expires, nothing escalates, and a hazard nobody clears
 * keeps warning every driver either way. It marks the rows that have been sitting here long enough that
 * an operator should be able to see it without reading dates.
 */
export const LONG_WAIT_DAYS = 7;

export function waitLabel(row: Pick<ConstraintView, 'disputedAt' | 'reportedAt'>, now: number, t: Translate): string {
  const hours = waitingHours(row, now);
  if (hours < 1) return t('tower.wait.now');
  if (hours < 48) return t('tower.wait.hours', { n: Math.floor(hours) });
  return t('tower.wait.days', { n: Math.floor(hours / 24) });
}

export function isLongWait(row: Pick<ConstraintView, 'disputedAt' | 'reportedAt'>, now: number): boolean {
  return waitingHours(row, now) >= LONG_WAIT_DAYS * 24;
}

/** A point, written the way somebody can paste it into a map. Five decimals is about a metre. */
export function pointLabel(at: { lat: number; lng: number }): string {
  return `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`;
}

/**
 * May this clearance be submitted?
 *
 * The server refuses a blank reason ("a hazard removed without a reason cannot be reviewed later") and
 * this is the same rule said early, so an operator finds out before they have committed to the action
 * rather than after. It is deliberately NOT a stricter rule than the server's: a client that demands
 * more than the contract does is a client that blocks work the network would have accepted.
 */
export const CLEAR_REASON_MAX = 300;

export function canClear(reason: string): boolean {
  const r = reason.trim();
  return r.length > 0 && r.length <= CLEAR_REASON_MAX;
}

/**
 * The masthead's live line — WORK, never identity, the same rule the phone apps' TopBar follows.
 *
 * Zero is a real answer here and it is said out loud: an empty slot reads as "not loaded yet", and on a
 * queue screen that is the difference between "nothing to do" and "we do not know".
 */
export function towerWorkLine(disputed: number | null, t: Translate): string {
  if (disputed === null) return t('tower.work.unknown');
  return disputed === 0 ? t('tower.work.clear') : t('tower.work.waiting', { n: disputed });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
