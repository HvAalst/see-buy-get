/**
 * WHEN IT WAS SEEN (the user, 2026-10-18: breakdown and hazard reports made with no signal are kept on the phone and sent
 * when the signal returns).
 *
 * A report is dated by when the person made it, not by when it arrived: a vehicle that broke down at 10:02 and was heard
 * of at 12:10 broke down at 10:02, and a bridge seen this morning was seen this morning. The phone's word is taken within
 * reason — never in the future (a clock running ahead reads as now), never more than a week back — and the moment it
 * reached SeeBuyGet is kept beside it whenever the two differ, so nobody mistakes a late word for a fresh one.
 */
export const OBSERVED_WINDOW_MS = 7 * 24 * 3_600_000;
/** A phone's clock and ours may differ by this much without the report counting as sent late. */
const CLOCK_SKEW_MS = 2 * 60_000;

export interface Seen {
  /** When it was seen, as the record dates it. */
  at: number;
  /** When it reached SeeBuyGet, where that is later than it was seen. */
  receivedAt?: string;
}

export function whenSeen(observedAt: string | undefined, now: number = Date.now()): Seen {
  const said = observedAt ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(said)) return { at: now };
  const at = Math.min(now, Math.max(now - OBSERVED_WINDOW_MS, said));
  return now - at > CLOCK_SKEW_MS ? { at, receivedAt: new Date(now).toISOString() } : { at };
}

/**
 * WHEN IT CHANGED HANDS, as the person did it (round 22: a driver's pickup and delivery; round 23: every custody step at a
 * counter or a hub): the phone's time within limits (whenSeen), and never before the step before it — whose order is part
 * of what the steps mean. With when it reached us, where that is later.
 */
export interface Step {
  /** When it was done, as the record dates it. */
  at: string;
  /** When it reached SeeBuyGet, where that is later than it was done. */
  receivedAt?: string;
}

export function handedAt(observedAt: string | undefined, now: number, before: Array<string | undefined>): Step {
  const seen = whenSeen(observedAt, now);
  const floor = Math.max(0, ...before.map((x) => (x ? Date.parse(x) : 0)).filter((x) => Number.isFinite(x)));
  // whenSeen never says later than now, and every step before it is a time already on record: no later than now either.
  const at = Math.max(seen.at, floor);
  // Late only as whenSeen counts late: a step the one before it lifts to within the clocks' allowance of now arrived as it
  // was done (round 25: a reading lifted to a moment after the one before said "read with no signal, reached us" — the
  // same minute).
  return { at: new Date(at).toISOString(), ...(seen.receivedAt && now - at > CLOCK_SKEW_MS ? { receivedAt: seen.receivedAt } : {}) };
}
