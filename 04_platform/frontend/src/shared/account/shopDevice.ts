import type { Result, SbgError } from '../../lib/sbg';
import type { PinDevices, PinDevicesApi } from './devices';
import { accountPasskeyApi } from './passkey';
import { dropAccountUnlockMark } from './unlock';

/*
 * A SHOP'S OWN PHONES (the user, 2026-10-18: "who is at the counter"). A shop's email and password work only on a phone
 * or browser the shop confirmed with a code texted to its number. The key that confirmation hands back is kept here, per
 * shop address, and sent with every sign-in from this phone.
 */

/**
 * 2026-11-03 — ONE KEY PER KIND OF ACCOUNT. One email may sign in to a shop, a hub and a store (account.service secondKind),
 * and their apps share this browser's storage: a key kept by the address alone was overwritten by the next kind's, and each
 * sign-in asked for a code again. The key is kept by kind and address; the slot of before (by address alone) is still read,
 * so a phone confirmed before this asks for nothing new.
 */
export type DeviceParty = 'shop' | 'hub' | 'store';
const slot = (email: string, party: DeviceParty) => `sbg-shop-device:${party}:${email.trim().toLowerCase()}`;
const before = (email: string) => `sbg-shop-device:${email.trim().toLowerCase()}`;

/** This phone's key for the account of this kind at this address, if it was confirmed here. */
export function shopDeviceKey(email: string | null | undefined, party: DeviceParty): string | undefined {
  if (!email) return undefined;
  try {
    return localStorage.getItem(slot(email, party)) ?? localStorage.getItem(before(email)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveShopDeviceKey(email: string, key: string | undefined, party: DeviceParty): void {
  if (!key) return;
  try {
    localStorage.setItem(slot(email, party), key);
  } catch {
    /* a phone that keeps nothing asks for the code again next time: said, not hidden */
  }
}

/**
 * EVERY SHOP'S AND HUB'S KEY THIS BROWSER HOLDS — one per address whose own sign-in was used on it. Sent when a colleague
 * opens a counter session here (2026-11-02: the owner, "a 1 person shop could use fingerprint to unlock as you said"):
 * the server notes the one that is that place's own phone as a phone colleagues use, and takes the place's fingerprint
 * off it. A key alone opens nothing.
 */
export function allShopDeviceKeys(): string[] {
  const found: string[] = [];
  try {
    for (let i = 0; i < localStorage.length && found.length < 20; i++) {
      const name = localStorage.key(i);
      const key = name?.startsWith('sbg-shop-device:') ? localStorage.getItem(name) : null;
      if (key) found.push(key);
    }
  } catch {
    /* storage unavailable — nothing to send */
  }
  return found;
}

export function dropShopDeviceKey(email: string | null | undefined, party: DeviceParty): void {
  if (!email) return;
  try {
    const key = shopDeviceKey(email, party);
    localStorage.removeItem(slot(email, party));
    // The slot of before, only where it held this kind's key — another kind's stays.
    if (key && localStorage.getItem(before(email)) === key) localStorage.removeItem(before(email));
  } catch {
    /* nothing kept, nothing to drop */
  }
}

/**
 * The sign-in's "this phone is new to the shop": where the code went, and — in a sandbox — the code itself. Round 40: a hub
 * or a store with no number yet is asked for one first (`needsPhone`), and the code goes to it.
 */
export interface DeviceAsk {
  challenge: string;
  sentTo: string;
  code?: string;
  needsPhone?: boolean;
  /** 2026-11-03 — no code could be texted: the new phone is linked by one the account already uses (pairing.ts), or not at all. */
  pairOnly?: boolean;
}

export function deviceAskOf(error: SbgError | null | undefined): DeviceAsk | null {
  const p = error?.params ?? {};
  // 2026-11-03 — no code could be texted to the account's number, but the password was right: a challenge that only pairs.
  if ((error?.code === 'SMS_NOT_SENT' || error?.code === 'PHONE_NOT_SERVED') && p.pairOnly === true && typeof p.challenge === 'string') return { challenge: p.challenge, sentTo: '', pairOnly: true };
  if (error?.code !== 'DEVICE_NOT_KNOWN') return null;
  if (typeof p.challenge !== 'string') return null;
  return { challenge: p.challenge, sentTo: typeof p.sentTo === 'string' ? p.sentTo : '', ...(typeof p.code === 'string' ? { code: p.code } : {}), ...(p.needsPhone === true ? { needsPhone: true } : {}) };
}

type Post = <T>(path: string, body: unknown) => Promise<Result<T>>;

/**
 * The shop's phones in Settings, in the shape the PIN's list has — and asked with the PASSWORD where the PIN's are asked
 * with the PIN. Forgetting this phone drops its key here too.
 */
export function shopDevicesApi(post: Post, email: () => string | null, party: DeviceParty = 'shop'): PinDevicesApi {
  const key = () => shopDeviceKey(email(), party);
  return {
    secret: 'password',
    party,
    read: () => post<PinDevices>('/v1/sbg/account/shop-devices', { device: key() }),
    forgetOthers: (password) => post<{ forgotten: number; kept: boolean }>('/v1/sbg/account/shop-devices/forget-others', { password, device: key() }),
    forgetThis: async () => {
      const r = await post<{ forgotten: boolean; which: number }>('/v1/sbg/account/shop-devices/forget-this', { device: key() });
      if (!r.error && r.data?.forgotten) {
        dropShopDeviceKey(email(), party);
        // Its fingerprint-or-face note with it (2026-11-02): the server dropped that passkey with the phone.
        dropAccountUnlockMark(email());
      }
      return r;
    },
    // 2026-11-02 (the owner: "ok go ahead with the fingerprint") — on these phones, a fingerprint or face in place of the password.
    passkey: accountPasskeyApi(post, email, key, party),
    // 2026-11-03 — a new phone linked from this one: the code it shows, scanned or typed here (pairing.ts).
    pair: (code) => post<{ linked: true }>('/v1/sbg/account/pair', { code, device: key() }),
  };
}
