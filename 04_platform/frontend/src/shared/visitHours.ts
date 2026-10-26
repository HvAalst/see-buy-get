/**
 * WHEN A COMPANY RECEIVES VISITORS, AS IT IS SAID — shared by the person's ticket and the console, so both say the
 * same hours the same way.
 *
 * A day of the week may keep hours of its own ("a Saturday morning only"), so "Monday to Saturday, 09:00 to 16:00"
 * is no longer always true. The days are grouped by the hours they keep, in the order they first come in the week —
 * which runs Sunday to Saturday (the user, 2026-10-26): Monday, Tuesday, Wednesday, Thursday, Friday · 09:00 to 16:00;
 * Saturday · 09:00 to 12:00.
 */

export const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface VisitPlace {
  visitDays?: string[];
  visitFrom?: string;
  visitTo?: string;
  visitHoursByDay?: Partial<Record<string, { from: string; to: string }>>;
}

export interface VisitSpan {
  days: string[];
  /** Absent where neither the day nor most days have hours: the day alone is said. */
  from?: string;
  to?: string;
}

export function visitSpans(place: VisitPlace | undefined): VisitSpan[] {
  const out: VisitSpan[] = [];
  for (const day of WEEK.filter((d) => place?.visitDays?.includes(d))) {
    const own = place?.visitHoursByDay?.[day];
    const from = own?.from ?? place?.visitFrom;
    const to = own?.to ?? place?.visitTo;
    const same = out.find((s) => s.from === (from && to ? from : undefined) && s.to === (from && to ? to : undefined));
    if (same) same.days.push(day);
    else out.push({ days: [day], ...(from && to ? { from, to } : {}) });
  }
  return out;
}

const minutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** An hour to choose, as a button says it: "10:00" for a whole hour, "16:00–16:30" for the last part of one. */
export function slotLabel(at: string, until?: string): string {
  return until && minutes(until) - minutes(at) !== 60 ? `${at}–${until}` : at;
}
