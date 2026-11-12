import { clockAt, minutesOf, momentAt } from './fleet-clock';
import { TRIP_DAY_WORDS, type StoredTrip } from './saved-trip.types';

/*
 * 2026-11-12 — WHEN A SAVED TRIP RUNS (pure, for the test): its days of the week, at its start time, on its own clock —
 * never a skipped day, never while paused. A week runs Sunday (0) to Saturday (6), read off the date itself.
 */

/** The weekday of a calendar day (YYYY-MM-DD): Sunday 0 … Saturday 6, whatever clock it was read on. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The calendar day after (or before, with -1) a day. */
export function dayAfter(day: string, by = 1): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

export interface TripRun {
  day: string;
  minutes: number;
  clock: string;
  at: number;
}

/** The next `count` runs from `now` (a run that has started is past), looking at most `days` days ahead. */
export function nextRuns(trip: Pick<StoredTrip, 'days' | 'startTime' | 'zone' | 'skips' | 'paused'>, now: number, count = 1, days = 8): TripRun[] {
  if (trip.paused) return [];
  const minutes = minutesOf(trip.startTime);
  if (minutes == null || !trip.days.length) return [];
  const out: TripRun[] = [];
  let day = clockAt(now, trip.zone).day;
  for (let i = 0; i <= days && out.length < count; i++, day = dayAfter(day)) {
    if (!trip.days.includes(weekdayOf(day)) || trip.skips.includes(day)) continue;
    const at = momentAt(day, minutes, trip.zone);
    if (at > now) out.push({ day, minutes, clock: trip.startTime, at });
  }
  return out;
}

/** The days a trip runs, said short: "Mon–Sat", "Mon, Wed, Fri", "Every day". English, for the bell and the log. */
export function daysWords(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return 'Every day';
  // A run of three or more days in a row is said as its ends.
  const runs: number[][] = [];
  for (const d of set) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${TRIP_DAY_WORDS[r[0]]}–${TRIP_DAY_WORDS[r[r.length - 1]]}` : r.map((d) => TRIP_DAY_WORDS[d]).join(', '))).join(', ');
}
