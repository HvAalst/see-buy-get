/**
 * A FLEET'S OWN CLOCK.
 *
 * A fleet plans in clock times — "vehicles leave at 07:00", "at the door about 10:40", "deliver between 8 and 12" —
 * and the server had no idea which clock. It judged "today" in UTC, could not say whether a delivery fell inside its
 * window, and showed a tracking page an hour that had long passed as if it were still to come. The user, 2026-10-07:
 * "so time zone first you say, that would work."
 *
 * So a fleet has a time zone, and this is everything that reads a moment on it. No table of our own: the platform
 * carries the time-zone database (which country keeps which zones, and every zone's rules — daylight saving
 * included), and it is asked. A country with ONE zone gives its fleets that zone without anybody typing it; a
 * country with several does not guess, and the office says which.
 *
 * Kept dependency-free, so the plan, the dispatcher and the tracking page can all read the same clock.
 */

/** A moment as a zone's own clock shows it. */
export interface ClockTime {
  /** The day there, YYYY-MM-DD. */
  day: string;
  /** How far into that day, in minutes. */
  minutes: number;
  /** The same, as the clock shows it: HH:MM, 00:00 to 23:59. */
  clock: string;
}

/** The time zones a country keeps, as the platform's own data has them. None for a code that is not a country. */
export function zonesOfCountry(code?: string): string[] {
  const cc = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return [];
  try {
    const locale = new Intl.Locale(`und-${cc}`) as Intl.Locale & { getTimeZones?: () => string[]; timeZones?: string[] };
    const zones = typeof locale.getTimeZones === 'function' ? locale.getTimeZones() : locale.timeZones;
    return Array.isArray(zones) ? [...zones] : [];
  } catch {
    return [];
  }
}

/** How far a zone's clock stands from UTC at a moment, in minutes: +180 in Nairobi, all year. */
export function offsetAt(now: number, zone: string): number {
  const there = clockAt(now, zone);
  const utc = clockAt(now, 'UTC');
  const days = there.day === utc.day ? 0 : there.day > utc.day ? 1 : -1;
  return days * 1440 + there.minutes - utc.minutes;
}

/**
 * THE CLOCKS A COUNTRY KEEPS — its zones, less the ones that are the same clock under another name. Germany has two
 * zones in the database (Berlin, and the exclave of Büsingen) and one clock; a German fleet must not be asked to
 * choose between them. Two zones are one clock when they stand the same distance from UTC through the year — read
 * at four moments a quarter apart, which is what tells summer time from none. The first name of each stands for it.
 */
export function clocksOfCountry(code: string | undefined, now: number): string[] {
  const kept = new Map<string, string>();
  for (const zone of zonesOfCountry(code)) {
    const through = [0, 91, 182, 273].map((d) => offsetAt(now + d * 86_400_000, zone)).join(',');
    if (!kept.has(through)) kept.set(through, zone);
  }
  return [...kept.values()];
}

/**
 * Is this a time zone a fleet can keep: a place's own (Africa/Nairobi), which carries that place's rules, or UTC.
 * Not a bare offset such as +03:00 — it is right today and wrong the day a country changes its clocks.
 */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string') return false;
  const z = zone.trim();
  if (!z || z.length > 64 || z !== zone) return false;
  if (z !== 'UTC' && !/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(z)) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

const FORMATS = new Map<string, Intl.DateTimeFormat>();
function formatOf(zone: string): Intl.DateTimeFormat {
  let f = FORMATS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    FORMATS.set(zone, f);
  }
  return f;
}

/** The moment `now`, on a zone's own clock. */
export function clockAt(now: number, zone: string): ClockTime {
  const parts: Record<string, string> = {};
  for (const p of formatOf(zone).formatToParts(new Date(now))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + minute, clock: `${String(hour).padStart(2, '0')}:${parts.minute}` };
}

/** The day in UTC — what "today" was everywhere before a fleet had a clock, and still is for one that has none. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** A clock time (HH:MM) as minutes into its day, or nothing where it is not one. */
export function minutesOf(clock: string | undefined): number | undefined {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((clock ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** A zone as somebody names it — "East Africa Time" — and the zone itself where the platform has no name for it. */
export function zoneName(zone: string, now: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'long' }).formatToParts(new Date(now)).find((p) => p.type === 'timeZoneName')?.value ?? zone;
  } catch {
    return zone;
  }
}
