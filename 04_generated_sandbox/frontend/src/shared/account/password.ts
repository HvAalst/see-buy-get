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

/** What stops a PIN change: four digits, typed twice, and not the one it replaces. */
export function pinChangeBlocker(form: { current: string; next: string; again?: string }): MessageKey | null {
  if (!/^\d{4}$/.test(form.current)) return 'account.pin.needCurrent';
  if (!/^\d{4}$/.test(form.next)) return 'account.pin.fourDigits';
  if (form.again !== undefined && form.next !== form.again) return 'account.pin.mismatch';
  if (form.next === form.current) return 'account.pin.same';
  return null;
}
