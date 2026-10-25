import { useT } from '../i18n';
import { pinGuessable } from './pin';

/**
 * Under a PIN being CHOSEN: "too easy to guess", said as it is typed (2026-10-25) — the server refuses the same PINs,
 * and on a slow connection its refusal is the slowest way to learn the rule. Nothing otherwise. Never under a PIN typed
 * to sign in: that one is already chosen.
 */
export function PinGuessHint({ pin }: { pin: string }) {
  const t = useT();
  return pinGuessable(pin) ? (
    <p class="card__note" role="status">
      {t('account.pin.guessable')}
    </p>
  ) : null;
}
