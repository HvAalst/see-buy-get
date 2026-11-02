import { readDeviceKey } from './pin';

/**
 * UNLOCK WITH FINGERPRINT OR FACE — what a sign-in screen needs to know before anything is fetched (the owner,
 * 2026-11-02: "if face unlock works, integrate it, but then in settings users should be able to undo it and get back to
 * a preferred option"). Nothing here loads the WebAuthn code: that comes only when a person taps (passkey.ts).
 *
 * THE MARK. When it is turned on under Settings, this browser notes it beside the device key of the number it was
 * turned on for: the passkey's id, and WHICH device key it was made under. The sign-in screen offers the fingerprint
 * only where that note is there AND the device key is still the one it names — so a PIN replaced by a code, a device
 * confirmed again, or "forget this one" (each of which hands out a new key, or none) silently takes the offer away,
 * as the server has already taken the passkey away with the device. The note opens nothing: the server decides.
 */
const MARK = 'sbg-unlock:';
/** The same nine digits a device key is kept under (pin.ts): one note per number, beside its key. */
const nine = (phone: string): string => phone.replace(/\D/g, '').slice(-9);
const DEVICE_SLOT = 'sbg-device:';

interface Mark {
  /** The device key it was made under. */
  d: string;
  /** The passkey's id. */
  id: string;
}

function readMark(slot: string): Mark | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(slot);
    const m = raw ? (JSON.parse(raw) as Partial<Mark>) : undefined;
    return m && typeof m.d === 'string' && typeof m.id === 'string' ? { d: m.d, id: m.id } : undefined;
  } catch {
    return undefined;
  }
}

/** Is the fingerprint or face turned on here, for this number, on the device key this browser holds for it? */
export function hasUnlockHere(phone: string): boolean {
  if (!nine(phone)) return false;
  const mark = readMark(`${MARK}${nine(phone)}`);
  const key = readDeviceKey(phone);
  return Boolean(mark && key && mark.d === key);
}

/**
 * Note it, beside the device key that was the person's — Settings knows which by its slot (`allDeviceKeys`), never by
 * a number: an account does not know its own number.
 */
export function markUnlock(deviceSlot: string | undefined, deviceKey: string | undefined, id: string | undefined): void {
  if (!deviceSlot?.startsWith(DEVICE_SLOT) || !deviceKey || !id) return;
  try {
    globalThis.localStorage?.setItem(`${MARK}${deviceSlot.slice(DEVICE_SLOT.length)}`, JSON.stringify({ d: deviceKey, id } satisfies Mark));
  } catch {
    /* storage unavailable — the sign-in screen asks for the PIN, which always works */
  }
}

/** Forget the note for the number behind this device slot — turned off, or the server says there is none. */
export function dropUnlockMarkBySlot(deviceSlot: string | undefined): void {
  if (!deviceSlot?.startsWith(DEVICE_SLOT)) return;
  try {
    globalThis.localStorage?.removeItem(`${MARK}${deviceSlot.slice(DEVICE_SLOT.length)}`);
  } catch {
    /* storage unavailable */
  }
}

/** …and by the number, at a sign-in screen. */
export function dropUnlockMark(phone: string): void {
  if (nine(phone)) dropUnlockMarkBySlot(`${DEVICE_SLOT}${nine(phone)}`);
}

/* --------------------------------------------------------------------- the ticket, on the wire -- */

/** What an unlock ticket starts with (the server's UNLOCK_PREFIX). A PIN is digits, and never looks like one. */
export const UNLOCK_PREFIX = 'unl_';
export const isUnlockTicket = (secret: string | undefined): boolean => Boolean(secret?.startsWith(UNLOCK_PREFIX));

/**
 * A door that minted nothing handed the next door a fresh ticket (the fleet office's "which fleets are mine"). Kept in
 * memory only, for the few seconds until that next door: the screen goes on holding the first ticket where it held the
 * PIN, and the next call sends the fresh one in its place.
 */
const relayed = new Map<string, string>();
export function relayUnlock(spent: string | undefined, next: string | undefined): void {
  if (isUnlockTicket(spent) && isUnlockTicket(next)) relayed.set(spent as string, next as string);
}

/**
 * THE SECRET, AS A SIGN-IN DOOR TAKES IT: a PIN goes as `pin`; a ticket a fingerprint or face was just checked for goes
 * as `unlock`, in the PIN's place — one door, two keys. A screen hands either to its app's own sign-in, which never
 * needs to know which it was given.
 */
export function secretBody(secret: string): { pin: string } | { unlock: string } {
  if (!isUnlockTicket(secret)) return { pin: secret };
  const next = relayed.get(secret);
  if (next) relayed.delete(secret);
  return { unlock: next ?? secret };
}
