import type { Translate } from '../../shared/i18n';

/*
 * THE PILOT, WEEK BY WEEK (backend pilot.types.ts; the user, 2026-10-18). The compendium's four numbers per week, each
 * against its target: a finished week is frozen and never counted again; the week still running is "so far".
 */

export interface PilotWeekRow {
  week: string;
  from: string;
  to: string;
  frozen: boolean;
  frozenAt?: string;
  sha256?: string;
  handshake: { handed: number; missed: number; rate?: number };
  loss: { lost: number; damaged: number; takenIn: number; rate?: number };
  takeIn: { timed: number; medianSeconds?: number; p90Seconds?: number };
  retention?: { pilotWeek: number; original: number; active: number; rate?: number };
}

export interface PilotTargets {
  handshake: number;
  handshakeWarn: number;
  loss: number;
  lossWarn: number;
  takeInSeconds: number;
  takeInWarnSeconds: number;
  retention: number;
  retentionAtWeek: number;
}

export interface PilotBoardView {
  thisWeek: PilotWeekRow;
  weeks: PilotWeekRow[];
  targets: PilotTargets;
}

/** How a number stands against its target: on it, near the line, past it — or not measured that week. */
export type Standing = 'ok' | 'warn' | 'danger' | 'none';

export function handshakeStanding(rate: number | undefined, tg: PilotTargets): Standing {
  if (rate === undefined) return 'none';
  return rate >= tg.handshake ? 'ok' : rate >= tg.handshakeWarn ? 'warn' : 'danger';
}

export function lossStanding(rate: number | undefined, tg: PilotTargets): Standing {
  if (rate === undefined) return 'none';
  return rate < tg.loss ? 'ok' : rate <= tg.lossWarn ? 'warn' : 'danger';
}

export function takeInStanding(median: number | undefined, tg: PilotTargets): Standing {
  if (median === undefined) return 'none';
  return median < tg.takeInSeconds ? 'ok' : median <= tg.takeInWarnSeconds ? 'warn' : 'danger';
}

/** Retention is judged at the target's week and after it; before that it is shown, and not yet judged. */
export function retentionStanding(r: PilotWeekRow['retention'], tg: PilotTargets): Standing {
  if (!r || r.rate === undefined) return 'none';
  if (r.pilotWeek < tg.retentionAtWeek) return 'none';
  return r.rate >= tg.retention ? 'ok' : 'danger';
}

/** A share, as people say it: "96.4%". */
export function pct(rate: number | undefined): string {
  return rate === undefined ? '—' : `${(Math.round(rate * 1000) / 10).toLocaleString()}%`;
}

export function seconds(s: number | undefined, t: Translate): string {
  return s === undefined ? '—' : t('tower.pilot.seconds', { n: Math.round(s) });
}
