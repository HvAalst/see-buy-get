import { pinGuessable, pinReady } from './pin';
import type { MessageKey } from '../i18n';

/**
 * What stops a password change — said before the server has to. The server checks the same things (and the
 * current password, which only it can), so this is courtesy, never the rule.
 */
export function passwordChangeBlocker(form: { current: string; next: string; again: string }, minLength = 8): MessageKey | null {
  if (!form.current) return 'account.password.needCurrent';
  if (form.next.length < minLength) return minLength >= 10 ? 'account.password.tooShort10' : 'account.password.tooShort';
  if (form.next !== form.again) return 'account.password.mismatch';
  if (form.next === form.current) return 'account.password.same';
  return null;
}

/** What stops a PIN change: the right number of digits, typed twice, and not the one it replaces. */
export function pinChangeBlocker(form: { current: string; next: string; again?: string }): MessageKey | null {
  if (!pinReady(form.current)) return 'account.pin.needCurrent';
  if (!pinReady(form.next)) return 'account.pin.digits';
  if (pinGuessable(form.next)) return 'account.pin.guessable';
  if (form.again !== undefined && form.next !== form.again) return 'account.pin.mismatch';
  if (form.next === form.current) return 'account.pin.same';
  return null;
}

/**
 * How often a MACHINE credential is worth changing: a store's signing secret, a fleet's code, a secret API key. They
 * sit in config files, scripts and other people's heads, so they leak quietly, and changing one costs only an update
 * where it is used. A person's password or PIN has no such clock — forcing those to change on a schedule makes people
 * choose weaker ones (NIST SP 800-63B) — so for those the age is shown and never nagged about.
 */
export const MACHINE_SECRET_MAX_DAYS = 90;

/** How old a credential is in whole days, and whether a machine secret is due. Null when there is no honest date. */
export function credentialAge(iso: string | undefined, nowMs: number = Date.now()): { days: number; due: boolean } | null {
  const then = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(then)) return null;
  const days = Math.max(0, Math.floor((nowMs - then) / 86_400_000));
  return { days, due: days > MACHINE_SECRET_MAX_DAYS };
}

/** The words for an age: today, yesterday, or N days. */
export function credentialAgeKey(days: number): { key: MessageKey; n: number } {
  if (days === 0) return { key: 'account.age.today', n: 0 };
  if (days === 1) return { key: 'account.age.yesterday', n: 1 };
  return { key: 'account.age.days', n: days };
}
