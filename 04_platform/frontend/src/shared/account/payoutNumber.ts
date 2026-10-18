import type { Translate } from '../i18n';

/*
 * A PAYEE'S OWN PAYOUT NUMBER (backend payout-number.types.ts). Where the payee's country pays by M-Pesa, money goes to a
 * number the payee set and confirmed with a code; a change pauses payouts for a day and the old number is texted.
 */

export interface PayoutNumberView {
  way: 'mpesa' | 'by_hand';
  country: string;
  notPayee?: string;
  masked?: string;
  confirmedAt?: string;
  heldUntil?: string;
}

export interface PayoutNumberSaved extends PayoutNumberView {
  oldNumber?: 'texted' | 'kept' | 'not_sent';
}

/** Settings has a payout-number row only for a payee whose country pays to a number of its own. */
export function hasPayoutNumber(view: PayoutNumberView | null | undefined): boolean {
  return Boolean(view && view.way === 'mpesa' && !view.notPayee);
}

/** The line under the row: not set (nothing is paid), paused after a change, or the number, masked. */
export function payoutNumberSub(view: PayoutNumberView, t: Translate, when: (iso: string) => string): string {
  if (!view.masked) return t('account.payout.subNone');
  if (view.heldUntil) return t('account.payout.subHeld', { number: view.masked, when: when(view.heldUntil) });
  return view.masked;
}

/** After saving: where payouts go, from when, and what became of the text to the old number. */
export function payoutSavedSays(saved: PayoutNumberSaved, t: Translate, when: (iso: string) => string): { title: string; detail?: string } {
  const title = t('account.payout.savedTitle', { number: saved.masked ?? '' });
  const parts: string[] = [];
  if (saved.heldUntil) parts.push(t('account.payout.savedHeld', { when: when(saved.heldUntil) }));
  if (saved.oldNumber === 'texted') parts.push(t('account.payout.oldTexted'));
  if (saved.oldNumber === 'kept') parts.push(t('account.payout.oldKept'));
  if (saved.oldNumber === 'not_sent') parts.push(t('account.payout.oldNotSent'));
  return parts.length ? { title, detail: parts.join(' ') } : { title };
}
