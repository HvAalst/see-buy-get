import type { Result } from '../../lib/sbg';
import { getLocale } from '../i18n';
import { allDeviceKeys } from './pin';

/**
 * MESSAGES IN THE CAR, UNDER SETTINGS (05_engineering/android-auto-messages.md; the owner, 2026-11-02: "we start with
 * 2"). The server's half is backend/src/modules/pudo/car-messages.service.ts.
 *
 * Settings is told whether it is on for this phone, and whether the phone's native part has answered yet. Turning it on
 * takes the PIN again; the server answers with the car key, once, which the page hands to the native part through the
 * app's own link (shared/playApp.ts) and keeps nowhere. Turning it off takes one tap.
 */
export interface CarHere {
  on: boolean;
  /** Which of this browser's device keys is the signed-in person's; -1 when none is. */
  which: number;
  /** `waiting` — made, and the phone has not answered yet; `on` — the phone said where to wake it. */
  phone?: 'waiting' | 'on';
  addedAt?: string;
  tokenAt?: string;
}

type Post = <T>(path: string, body: unknown) => Promise<Result<T>>;

export interface CarApi {
  /** Is it on here? The app's language goes with it: a quick reply is read aloud in it. */
  read: () => Promise<Result<CarHere>>;
  /** Turn it on here: the PIN again. The key comes back once, in this answer. */
  turnOn: (pin: string) => Promise<Result<CarHere & { key: string }>>;
  /** Turn it off here: the key opens nothing from now on. */
  turnOff: () => Promise<Result<CarHere>>;
}

/** The calls, keyed to the token. Each sends EVERY device key this browser holds, and the server says which is this person's. */
export function carApi(post: Post, lang: () => string = getLocale): CarApi {
  const devices = () => allDeviceKeys().map((k) => k.key);
  return {
    read: () => post<CarHere>('/v1/sbg/account/car', { devices: devices(), lang: lang() }),
    turnOn: (pin) => post<CarHere & { key: string }>('/v1/sbg/account/car/on', { devices: devices(), pin, lang: lang() }),
    turnOff: () => post<CarHere>('/v1/sbg/account/car/off', { devices: devices() }),
  };
}

/**
 * The row's second line — off, waiting for the phone, on — or null where there is no row: outside the Play app (only
 * its native part can read a message aloud in the car), not known yet, or on a browser where this person's PIN does not
 * work (nothing could be turned on here).
 */
export function carRowSub(state: { inside: boolean; here: CarHere | null; unread: boolean; tooOld?: boolean }, t: (key: never) => string): string | null {
  const say = t as (key: string) => string;
  if (!state.inside) return null;
  // 2026-11-02 — the car part needs Android 9 or newer (the integrator): said, rather than offered and failing. One
  // somehow on already can still be turned off.
  if (state.tooOld && !state.here?.on) return say('account.car.subOld');
  if (state.unread) return say('account.car.unread');
  if (!state.here || state.here.which < 0) return null;
  if (!state.here.on) return say('account.car.subOff');
  return say(state.here.phone === 'on' ? 'account.car.subOn' : 'account.car.subWaiting');
}

/** While the phone has not answered, Settings asks again this often, for this long — and whenever the page is shown again. */
export const CAR_POLL_MS = 3000;
export const CAR_POLL_FOR_MS = 2 * 60_000;
