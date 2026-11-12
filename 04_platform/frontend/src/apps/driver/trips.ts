import type { components } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

/*
 * 2026-11-12 — SAVED TRIPS, LIKE AN ALARM (the owner: "driving route a to b monday to saturday from 5:30 AM and from b to a
 * monday to saturday from 16:00 PM"). What the Driver app says of a trip, and what it sends to save one. A week runs Sunday
 * (0) to Saturday (6).
 */
export type SavedTrip = components['schemas']['SavedTripView'];

/** The days a trip runs, said short: "Mon–Sat", "Mon, Wed, Fri", "Every day" — three or more in a row said as their ends. */
export function tripDaysWords(days: readonly number[], t: Translate, words: 'driver.trips' | 'fleet.trips' = 'driver.trips'): string {
  const set = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (set.length === 7) return t(`${words}.everyDay` as MessageKey);
  const word = (d: number) => t(`${words}.day.${d}` as MessageKey);
  const runs: number[][] = [];
  for (const d of set) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${word(r[0])}–${word(r[r.length - 1])}` : r.map(word).join(', '))).join(', ');
}

/** When the next run is, in words: today, tomorrow, or its weekday — `today` the phone's own date (YYYY-MM-DD). */
export function nextWords(next: { day: string; clock: string } | undefined, today: string, t: Translate, words: 'driver.trips' | 'fleet.trips' = 'driver.trips'): string | null {
  if (!next) return null;
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (next.day === today) return t(`${words}.today` as MessageKey, { clock: next.clock });
  if (next.day === tomorrow) return t(`${words}.tomorrow` as MessageKey, { clock: next.clock });
  const weekday = new Date(`${next.day}T00:00:00Z`).getUTCDay();
  return t(`${words}.onDay` as MessageKey, { day: t(`${words}.day.${weekday}` as MessageKey), date: String(Number(next.day.slice(8, 10))), clock: next.clock });
}

export interface TripEndInput {
  label: string;
  lat: number;
  lng: number;
}

/** What is sent to save a trip — and, given a time to come back, the trip back on the same days. Nothing until complete. */
export function tripBodies(from: TripEndInput | undefined, to: TripEndInput | undefined, days: readonly number[], startTime: string, backAt: string, zone: string | undefined, name?: string): Array<Record<string, unknown>> | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!from || !to || !days.length || !time.test(startTime) || (backAt && !time.test(backAt))) return null;
  const base = { days: [...new Set(days)].sort((a, b) => a - b), ...(zone ? { zone } : {}) };
  const leg = (a: TripEndInput, b: TripEndInput, at: string, label?: string) => ({ ...base, fromLabel: a.label, fromLat: a.lat, fromLng: a.lng, toLabel: b.label, toLat: b.lat, toLng: b.lng, startTime: at, ...(label?.trim() ? { name: label.trim() } : {}) });
  return [leg(from, to, startTime, name), ...(backAt ? [leg(to, from, backAt)] : [])];
}

/** The phone's own clock, said as a zone (Europe/Amsterdam) — the server's country clock where it cannot say. */
export function phoneZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
