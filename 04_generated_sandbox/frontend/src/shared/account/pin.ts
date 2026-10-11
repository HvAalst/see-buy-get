import type { SbgError } from '../../lib/sbg';

/**
 * HOW MANY DIGITS A PIN HAS — one number for every app. The server's is `PIN_LENGTH` in person.service.ts, and a PIN
 * of any other length is refused there; this is what makes the boxes on every screen the right number of boxes.
 *
 * Five (the user, 2026-10-11). It was four, the length of a mobile-money PIN and a bank card's.
 */
export const PIN_LENGTH = 5;

/** Exactly that many digits — the shape of a PIN, typed in full. */
export function pinReady(pin: string): boolean {
  return pin.length === PIN_LENGTH && /^\d+$/.test(pin);
}

/* ------------------------------------------------------------------------ the device a PIN works on -- */

/**
 * THE KEY THIS DEVICE WAS HANDED when a code to the phone was typed on it. A PIN is looked at by the server only when
 * this comes with it; without it the answer is "this device has not signed in to this account before", and the app
 * sends the code (`NewDeviceSheet`).
 *
 * Kept per phone NUMBER, because a tablet on a counter is several people's device, and by the last nine digits,
 * because the same number is typed with a zero in front one day and the country code the next. It is not a sign-in:
 * with it AND the PIN a person is in; with it alone, nobody is. It stays when somebody signs out — signing out ends
 * the session, not the fact that this phone once showed it holds the number.
 */
const keyFor = (phone: string): string => `sbg-device:${phone.replace(/\D/g, '').slice(-9)}`;

export function readDeviceKey(phone: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(keyFor(phone)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveDeviceKey(phone: string, key: string | undefined): void {
  if (!key) return;
  try {
    globalThis.localStorage?.setItem(keyFor(phone), key);
  } catch {
    /* storage unavailable — the next PIN sign-in here asks for the code again */
  }
}

/** The server's answer to a PIN typed on a device no code to that phone was ever typed on. Not an error to show: a step to take. */
export function isNewDevice(error: SbgError | null | undefined): boolean {
  return error?.code === 'DEVICE_NOT_KNOWN';
}
