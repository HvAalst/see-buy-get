/*
 * A COMPANY'S CLOSED DATES, as its own Settings keeps them while they are being edited.
 *
 * The user, 2026-10-08: "the country should set it's own public holidays and/or one off closure." The server holds
 * the list and checks every date; this only keeps what is on the screen in the shape it will be saved in — one of
 * each date, in date order — so what the company sees before pressing Save is what it will have afterwards.
 */

export interface ClosedDate {
  date: string;
  note?: string;
}

/** Add a date, or change what an existing date is called. Nothing, for something that is not a date. */
export function addClosedDate(list: ClosedDate[], date: string, note: string): ClosedDate[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return list;
  const said = note.trim().slice(0, 60);
  return [...list.filter((c) => c.date !== date), { date, ...(said ? { note: said } : {}) }].sort((a, b) => a.date.localeCompare(b.date));
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
