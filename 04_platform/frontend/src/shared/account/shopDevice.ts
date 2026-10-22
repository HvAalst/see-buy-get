import type { Result, SbgError } from '../../lib/sbg';
import type { PinDevices, PinDevicesApi } from './devices';

/*
 * A SHOP'S OWN PHONES (the user, 2026-10-18: "who is at the counter"). A shop's email and password work only on a phone
 * or browser the shop confirmed with a code texted to its number. The key that confirmation hands back is kept here, per
 * shop address, and sent with every sign-in from this phone.
 */

const slot = (email: string) => `sbg-shop-device:${email.trim().toLowerCase()}`;

/** This phone's key for the shop at this address, if it was confirmed here. */
export function shopDeviceKey(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  try {
    return localStorage.getItem(slot(email)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveShopDeviceKey(email: string, key: string | undefined): void {
  if (!key) return;
  try {
    localStorage.setItem(slot(email), key);
  } catch {
    /* a phone that keeps nothing asks for the code again next time: said, not hidden */
  }
}

export function dropShopDeviceKey(email: string | null | undefined): void {
  if (!email) return;
  try {
    localStorage.removeItem(slot(email));
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
}

export function deviceAskOf(error: SbgError | null | undefined): DeviceAsk | null {
  if (error?.code !== 'DEVICE_NOT_KNOWN') return null;
  const p = error.params ?? {};
  if (typeof p.challenge !== 'string') return null;
  return { challenge: p.challenge, sentTo: typeof p.sentTo === 'string' ? p.sentTo : '', ...(typeof p.code === 'string' ? { code: p.code } : {}), ...(p.needsPhone === true ? { needsPhone: true } : {}) };
}

type Post = <T>(path: string, body: unknown) => Promise<Result<T>>;

/**
 * The shop's phones in Settings, in the shape the PIN's list has — and asked with the PASSWORD where the PIN's are asked
 * with the PIN. Forgetting this phone drops its key here too.
 */
export function shopDevicesApi(post: Post, email: () => string | null, party: 'shop' | 'hub' | 'store' = 'shop'): PinDevicesApi {
  const key = () => shopDeviceKey(email());
  return {
    secret: 'password',
    party,
    read: () => post<PinDevices>('/v1/sbg/account/shop-devices', { device: key() }),
    forgetOthers: (password) => post<{ forgotten: number; kept: boolean }>('/v1/sbg/account/shop-devices/forget-others', { password, device: key() }),
    forgetThis: async () => {
      const r = await post<{ forgotten: boolean; which: number }>('/v1/sbg/account/shop-devices/forget-this', { device: key() });
      if (!r.error && r.data?.forgotten) dropShopDeviceKey(email());
      return r;
    },
  };
}
