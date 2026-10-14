/*
 * A COMPANY'S CLOSED DATES, as its own Settings keeps them while they are being edited.
 *
 * The user, 2026-10-08: "the country should set it's own public holidays and/or one off closure." The server holds
 * the list and checks every date; this only keeps what is on the screen in the shape it will be saved in — one of
 * each date, in date order — so what the company sees before pressing Save is what it will have afterwards.
 */

/** A date it is closed — or, with `from` and `to`, a date it is open shorter: the half-day before a holiday. */
export interface ClosedDate {
  date: string;
  note?: string;
  from?: string;
  to?: string;
}

/** From when until when, `HH:MM`. */
export interface VisitWindow {
  from: string;
  to: string;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Both ends given, as times of day, the end after the start. */
export function windowOk(from: string, to: string): boolean {
  return CLOCK.test(from) && CLOCK.test(to) && from < to;
}

/**
 * Add a date, or change what an existing date is called. Nothing, for something that is not a date. With hours that
 * make a window it is a SHORTER day; without, it is closed.
 */
export function addClosedDate(list: ClosedDate[], date: string, note: string, from = '', to = ''): ClosedDate[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return list;
  const said = note.trim().slice(0, 60);
  const shorter = windowOk(from, to) ? { from, to } : {};
  return [...list.filter((c) => c.date !== date), { date, ...(said ? { note: said } : {}), ...shorter }].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * THE DAYS' OWN HOURS AS THEY ARE SAVED: a window for each ticked day that was given one, and nothing for a day that
 * is not ticked — the object replaces what the server keeps, so a day left out keeps the usual hours.
 */
export function ownHoursOf(days: readonly string[], own: Record<string, VisitWindow | undefined>): Record<string, VisitWindow> {
  return Object.fromEntries(days.filter((d) => own[d]).map((d) => [d, { from: own[d]!.from, to: own[d]!.to }]));
}

export function removeClosedDate(list: ClosedDate[], date: string): ClosedDate[] {
  return list.filter((c) => c.date !== date);
}

/** A date as somebody says it — "Tuesday 20 October 2026" — read the same whatever clock the browser is on. */
export function closedDateWords(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** What is typed for "visitors an hour", as the number the server is sent: nothing and nonsense are zero, which clears it. */
export function visitorsPerHourOf(typed: string): number {
  const n = Number(typed.trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}
