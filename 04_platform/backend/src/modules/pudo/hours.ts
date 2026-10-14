import { DayHours, Weekday, WeeklyHours } from './pudo.types';

const DAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // index = Date.getUTCDay()

const toMin = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const dayOf = (date: Date): Weekday => DAYS[date.getUTCDay()];
const minutesOfDay = (date: Date): number => date.getUTCHours() * 60 + date.getUTCMinutes();

/** Average open hours across the days the agent is open (the eligibility measure). */
export function averageOpenHours(hours: WeeklyHours): number {
  const open = DAYS.map((d) => hours[d]).filter((d): d is DayHours => !!d);
  if (!open.length) return 0;
  const total = open.reduce((sum, d) => sum + Math.max(0, toMin(d.close) - toMin(d.open)) / 60, 0);
  return Math.round((total / open.length) * 10) / 10;
}

export function isOpenAt(hours: WeeklyHours, date: Date): boolean {
  const d = hours[dayOf(date)];
  if (!d) return false;
  const t = minutesOfDay(date);
  return t >= toMin(d.open) && t < toMin(d.close);
}

/**
 * The next instant the PUDO is open at/after `from`. If `from` is during opening hours, returns
 * `from`. Otherwise returns the next opening (today later, or a following open day). Used to ensure a
 * parcel's pickup-ready time never lands when the shop is closed (the ETA-vs-opening-hours rule).
 */
export function nextOpenAt(hours: WeeklyHours, from: Date): Date {
  if (isOpenAt(hours, from)) return from; // already open → exact instant (preserve seconds)
  for (let i = 0; i < 8; i += 1) {
    const day = new Date(from.getTime() + i * 86_400_000);
    const d = hours[dayOf(day)];
    if (!d) continue;
    const openMin = toMin(d.open);
    const cursorMin = i === 0 ? minutesOfDay(from) : 0;
    if (cursorMin < openMin) {
      const at = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0));
      at.setUTCMinutes(openMin); // the start of the next open window
      return at;
    }
    // otherwise the shop has already closed for this day → try the next day
  }
  return from; // no schedule in the next week — fall back
}
