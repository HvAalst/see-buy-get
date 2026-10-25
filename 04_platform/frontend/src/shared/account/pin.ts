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

/**
 * THE PINS SOMEBODY WHO KNOWS YOU TRIES FIRST — the server's rule (`isGuessablePin`, person.service.ts), said on the
 * phone before anything is sent (2026-10-25): on a slow connection, a refusal after the round trip is the slowest way
 * to learn a rule the phone can say at once. The server still decides; this only says it sooner. Mostly one digit
 * (11111, 12121, 11222), a run up or down round the dial (12345, 98765, 78901, 13579, 24680), the same three over
 * again (12312), or the keypad's middle column (02580). Only for a PIN being CHOSEN — never one being typed to sign in.
 */
const KEYPAD_COLUMN = ['2580', '0852'];
export function pinGuessable(pin: string): boolean {
  if (!pinReady(pin)) return false;
  const d = pin.split('').map(Number);
  if (new Set(d).size < 3) return true;
  const runs = (step: number) => d.every((x, i) => i === 0 || x === (d[i - 1] + step + 10) % 10);
  if (runs(1) || runs(-1) || runs(2) || runs(-2)) return true;
  if (d.every((x, i) => i < 3 || x === d[i - 3])) return true;
  return KEYPAD_COLUMN.some((column) => pin.startsWith(column) || pin.endsWith(column));
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
const SLOT = 'sbg-device:';
const keyFor = (phone: string): string => `${SLOT}${phone.replace(/\D/g, '').slice(-9)}`;

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

/**
 * EVERY KEY THIS BROWSER HOLDS — one per number that ever signed in on it — and where each is kept. Settings sends
 * them all: an account does not know its own number, so nothing here can say which key is "mine"; the server picks
 * out the one that belongs to who is signed in. A key alone opens nothing, anybody's: it needs its PIN.
 */
export function allDeviceKeys(): Array<{ slot: string; key: string }> {
  const found: Array<{ slot: string; key: string }> = [];
  try {
    const store = globalThis.localStorage;
    for (let i = 0; store && i < store.length && found.length < 20; i++) {
      const slot = store.key(i);
      const key = slot?.startsWith(SLOT) ? store.getItem(slot) : null;
      if (slot && key) found.push({ slot, key });
    }
  } catch {
    /* storage unavailable — there is nothing to send, and the server marks none of them "this one" */
  }
  return found;
}

/** Drop ONE of them — the one the server has just forgotten. Never anything that is not a device key. */
export function dropDeviceKey(slot: string | undefined): void {
  if (!slot?.startsWith(SLOT)) return;
  try {
    globalThis.localStorage?.removeItem(slot);
  } catch {
    /* storage unavailable — the server has forgotten it, which is what counts */
  }
}

/** The server's answer to a PIN typed on a device no code to that phone was ever typed on. Not an error to show: a step to take. */
export function isNewDevice(error: SbgError | null | undefined): boolean {
  return error?.code === 'DEVICE_NOT_KNOWN';
}
