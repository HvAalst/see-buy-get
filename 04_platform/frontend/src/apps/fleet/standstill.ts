import type { Result, SbgClient } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

/**
 * ROUND 16 — A VEHICLE STANDING STILL ("A watch on stopped vehicles"; "The fleet's managers"; "Each fleet sets it; 45 min
 * to start"). A vehicle on a shift that stays in one place longer than the fleet allows, away from its stops, the fleet's
 * sites and the network's hubs, opens a case here. The office calls the driver and says how it was; the case ends by
 * itself when the vehicle moves on or the shift ends.
 */
export type StandstillOutcome = 'all_well' | 'no_answer' | 'problem';

export interface StandstillCase {
  caseId: string;
  plate: string;
  driverName?: string;
  location: { lat: number; lng: number };
  since: string;
  openedAt: string;
  minutes: number;
  afterMin: number;
  state: 'open' | 'answered' | 'over';
  answer?: { outcome: StandstillOutcome; note?: string; by: string; at: string };
  over?: { why: 'moved' | 'shift_ended' | 'breakdown'; at: string };
}

export interface StandstillSettings {
  on: boolean;
  afterMin: number;
  asStarted: boolean;
  setAt?: string;
  setBy?: string;
}

export interface StandstillView {
  settings: StandstillSettings;
  cases: StandstillCase[];
}

/** The minutes an office picks from: a short stop is not a case, a long one is too late to be told of. */
export const WATCH_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240] as const;

export function standstillApi(sbg: SbgClient, did: string) {
  const path = { did };
  return {
    view: (): Promise<Result<StandstillView>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/standstill', { params: { path } })) as never,
    setSettings: (on: boolean, afterMin: number): Promise<Result<StandstillSettings>> => sbg.request((c) => c.PUT('/v1/sbg/fleet/managers/{did}/standstill/settings', { params: { path }, body: { on, afterMin } })) as never,
    answer: (caseId: string, outcome: StandstillOutcome, note?: string): Promise<Result<StandstillCase>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/standstill/{caseId}/answer', { params: { path: { did, caseId } }, body: { outcome, ...(note?.trim() ? { note: note.trim() } : {}) } })) as never,
  };
}

/** Minutes as people say them: "52 min", "1 h 10 min". */
export function minutesWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

/** What the watch is set to, in a line. */
export function watchLine(s: StandstillSettings, t: Translate): string {
  return s.on ? t('fleet.still.watchOn', { minutes: minutesWords(s.afterMin) }) : t('fleet.still.watchOff');
}

const OUTCOME_WORD: Record<StandstillOutcome, MessageKey> = { all_well: 'fleet.still.outcome.all_well', no_answer: 'fleet.still.outcome.no_answer', problem: 'fleet.still.outcome.problem' };
const OVER_WORD: Record<NonNullable<StandstillCase['over']>['why'], MessageKey> = { moved: 'fleet.still.over.moved', shift_ended: 'fleet.still.over.shift_ended', breakdown: 'fleet.still.over.breakdown' };

export function outcomeWord(o: StandstillOutcome, t: Translate): string {
  return t(OUTCOME_WORD[o]);
}

/** How long, and where it stands now: standing, answered, or over and how. */
export function caseLine(c: StandstillCase, t: Translate, when: (iso: string) => string): string {
  if (c.over) return t('fleet.still.lineOver', { minutes: minutesWords(c.minutes), since: when(c.since), how: t(OVER_WORD[c.over.why]) });
  return t('fleet.still.lineStanding', { minutes: minutesWords(c.minutes), since: when(c.since) });
}

/** Still standing first, then answered, then over; the newest first within each. */
export function casesInOrder(cases: StandstillCase[]): StandstillCase[] {
  const rank = { open: 0, answered: 1, over: 2 } as const;
  return [...cases].sort((a, b) => rank[a.state] - rank[b.state] || b.openedAt.localeCompare(a.openedAt));
}
