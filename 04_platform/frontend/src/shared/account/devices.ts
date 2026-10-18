import type { Result } from '../../lib/sbg';
import { allDeviceKeys, dropDeviceKey } from './pin';

/**
 * THE PHONES AND BROWSERS A PIN WORKS ON, as their owner sees them in Settings.
 *
 * A PIN opens an account only on a device where a code to the number was once typed. Until this the owner could not
 * see how many such devices there were, and the only way to put one out was to replace the PIN. Now: how many, when
 * each was confirmed and last used, forget all the others (the PIN again), or sign out of this one and forget it —
 * which is what somebody on a borrowed computer wants.
 *
 * Dates and nothing else. No name of a device is kept anywhere to show: "a phone or browser" is all the server knows.
 */
export interface PinDevice {
  addedAt: string;
  usedAt?: string;
  /** The one this is being read on. */
  here: boolean;
}
export interface PinDevices {
  count: number;
  here: boolean;
  /** A device not used for this many days stops working until it is confirmed again. */
  unusedDays: number;
  devices: PinDevice[];
}

type Post = <T>(path: string, body: unknown) => Promise<Result<T>>;

export interface PinDevicesApi {
  /** What forgetting the others is asked with: the PIN (a person's), or the password (a shop's own phones). */
  secret?: 'pin' | 'password';
  read: () => Promise<Result<PinDevices>>;
  /** The PIN (or the password) again. On success EVERY session is over, this one included: the caller signs out. */
  forgetOthers: (secret: string) => Promise<Result<{ forgotten: number; kept: boolean }>>;
  /** This device's key is forgotten by the server and dropped here. The caller signs the person out. */
  forgetThis: () => Promise<Result<{ forgotten: boolean; which: number }>>;
}

/**
 * The three calls. Each sends EVERY key this browser holds — one per number that ever signed in on it — because an
 * account does not know its own number, so the browser cannot say which key is "mine". The server keeps the one that
 * belongs to who is signed in and drops the rest unread.
 */
export function pinDevicesApi(post: Post): PinDevicesApi {
  const held = () => allDeviceKeys().map((k) => k.key);
  return {
    read: () => post<PinDevices>('/v1/sbg/account/pin-devices', { devices: held() }),
    forgetOthers: (pin) => post<{ forgotten: number; kept: boolean }>('/v1/sbg/account/pin-devices/forget-others', { pin, devices: held() }),
    forgetThis: async () => {
      const keys = allDeviceKeys();
      const r = await post<{ forgotten: boolean; which: number }>('/v1/sbg/account/pin-devices/forget-this', { devices: keys.map((k) => k.key) });
      // The server no longer knows that key, so this browser's copy goes too — that one, and no other number's.
      if (!r.error && r.data?.forgotten) dropDeviceKey(keys[r.data.which]?.slot);
      return r;
    },
  };
}

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** The sentence above the list: how many, how each came to be one, and when one stops being one. */
export function devicesLede(v: PinDevices, t: (key: never, vars?: Record<string, string | number>) => string, whose: 'pin' | 'shop' = 'pin'): string {
  const say = t as Say;
  // A shop's own phones are its sign-in's, confirmed by a code to the shop's number — not a person's PIN.
  const k = whose === 'shop' ? 'account.shopDevices' : 'account.devices';
  const head = v.count === 0 ? say(`${k}.none`) : v.count === 1 ? say(`${k}.one`) : say(`${k}.many`, { n: v.count });
  return v.count === 0 ? head : `${head} ${say(`${k}.how`, { days: v.unusedDays })}`;
}

/** One device as a line: which it is, when it was confirmed, when it was last used. */
export function deviceLine(d: PinDevice, t: (key: never, vars?: Record<string, string | number>) => string, day: (iso: string) => string): { title: string; sub: string } {
  const say = t as Say;
  return {
    title: say(d.here ? 'account.devices.this' : 'account.devices.another'),
    sub: d.usedAt ? say('account.devices.confirmedUsed', { on: day(d.addedAt), used: day(d.usedAt) }) : say('account.devices.confirmed', { on: day(d.addedAt) }),
  };
}

/** "Forget all the others" is offered when there is another to forget. */
export function canForgetOthers(v: PinDevices | null): boolean {
  return Boolean(v?.devices.some((d) => !d.here));
}
