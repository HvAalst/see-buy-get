import { isSandbox } from './sandbox';

/** The code a new account's number (or recovery email) is confirmed with while the review code is on. */
export const REVIEW_CODE = '000000';

/**
 * THE REVIEW CODE — the user, 2026-10-22: "feature flag the twillio requirement and make every sign up pass with
 * 000000 for now. that will allow for quick review."
 *
 * The live server texts its codes through Twilio, and until Twilio is wired in nobody can sign up there. With
 * GLOS_REVIEW_CODE_UNTIL set to a day (YYYY-MM-DD, through the end of that day UTC), a NEW account's number — and the
 * recovery email a PIN asks for — is confirmed with 000000 instead, and the screen that asked shows it.
 *
 * A code everybody knows proves nobody: so it MAKES accounts and never OPENS one. A number or an address that already
 * belongs to an account gets no review code — signing in on a new phone, replacing a PIN, a shop's, a hub's or a
 * store's new browser and a payout number all still wait for a real text. It turns itself off on the day it names,
 * and on each channel the moment that channel really sends; on a sandbox it does nothing (a sandbox shows its codes).
 */
export function reviewCodeUntil(env: NodeJS.ProcessEnv = process.env): Date | undefined {
  const raw = env.GLOS_REVIEW_CODE_UNTIL?.trim();
  if (!raw) return undefined;
  const end = new Date(`${raw}T23:59:59.999Z`);
  // Only a day written YYYY-MM-DD that IS one: anything that does not come back the same (2026-11-31, "yes", a time of
  // day) is no day — off, rather than some other day.
  return Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== raw ? undefined : end;
}

/** Is the review code on now? Never on a sandbox, never without a day, never after it. */
export function reviewCodeOn(now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): boolean {
  if (isSandbox()) return false;
  const end = reviewCodeUntil(env);
  return Boolean(end && now <= end.getTime());
}

/** The day it ends, as set — for the console and the boot log — while it is on; otherwise null. */
export function reviewCodeState(now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): { until: string } | null {
  return reviewCodeOn(now, env) ? { until: (env.GLOS_REVIEW_CODE_UNTIL as string).trim() } : null;
}

/** What a number or address that already has an account is told: it gets no review code. */
export const REVIEW_CODE_HELD =
  'This already belongs to an account, and the review code 000000 only makes new ones: signing in to it on a new phone or browser waits until codes can be texted. To try another sign-up, use another number.';
