import { publicRequest, type Result, type SbgConfig, type SbgError } from '../../lib/sbg';
import { allDeviceKeys, readDeviceKey } from './pin';
import { dropAccountUnlockMark, dropUnlockMark, dropUnlockMarkBySlot, markAccountUnlock, markUnlock } from './unlock';

/**
 * UNLOCK WITH FINGERPRINT OR FACE — the ceremonies (the owner, 2026-11-02: "if face unlock works, integrate it, but then
 * in settings users should be able to undo it and get back to a preferred option"). The server's half is
 * backend/src/modules/pudo/passkey.service.ts; what the browser keeps is unlock.ts.
 *
 * The WebAuthn code (@simplewebauthn/browser) is fetched only by a screen that will use it — a sign-in screen showing
 * the fingerprint button, Settings opening the row — never with an app's first download.
 */
type WebAuthn = typeof import('@simplewebauthn/browser');
let webAuthn: Promise<WebAuthn> | null = null;
const loadWebAuthn = (): Promise<WebAuthn> => (webAuthn ??= import('@simplewebauthn/browser'));

type PKC = {
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
};
const pkc = (): PKC | undefined => (globalThis as { PublicKeyCredential?: PKC }).PublicKeyCredential;

let supported: Promise<boolean> | null = null;
/**
 * CAN THIS PHONE OR BROWSER CHECK A FINGERPRINT OR FACE ITSELF — the browser's own answer
 * (`isUserVerifyingPlatformAuthenticatorAvailable`). Where it says no, Settings offers nothing: a row that can only
 * fail is not an option. Asked once a page.
 */
export function passkeySupported(): Promise<boolean> {
  supported ??= (async () => {
    try {
      const ask = pkc()?.isUserVerifyingPlatformAuthenticatorAvailable;
      if (!ask || (globalThis as { isSecureContext?: boolean }).isSecureContext === false) return false;
      return (await ask.call(pkc())) === true;
    } catch {
      return false;
    }
  })();
  return supported;
}
/** For tests: ask the browser again. */
export function forgetPasskeySupport(): void {
  supported = null;
}

/* ------------------------------------------------------------------------------------- Settings -- */

/** What Settings is told about this device (passkey.service.ts `PasskeyHere`). */
export interface PasskeyHere {
  on: boolean;
  /** Which of this browser's device keys is the signed-in person's; -1 when none is. */
  which: number;
  id?: string;
  addedAt?: string;
  dropped?: string;
  rpId?: string;
}

type Post = <T>(path: string, body: unknown) => Promise<Result<T>>;
type Options = Record<string, unknown> & { user?: Record<string, unknown> };

export interface PasskeyApi {
  /** What it stands in for, and what turning it on asks for again: a person's PIN, or (2026-11-02) an account's password. */
  secret?: 'pin' | 'password';
  /** Whose account, where it stands in for a password: the shop's, the hub's or the store's. */
  party?: 'shop' | 'hub' | 'store';
  /** Is it on here? The browser's note is put in step with the answer. */
  read: () => Promise<Result<PasskeyHere>>;
  /** Turning it on, step one: the PIN again. What the phone needs comes back, or the PIN's refusal. */
  prepare: (pin: string) => Promise<Result<{ options: Options; which: number }>>;
  /** …step two, on a tap: the phone's own prompt, then its answer to the server. `cancelled` when the phone said no. */
  create: (prepared: { options: Options; which: number }) => Promise<{ here?: PasskeyHere; error?: SbgError | null; cancelled?: boolean }>;
  /** Turn it off here. The PIN is the way in again; the phone is asked to forget the passkey too, where it can. */
  turnOff: () => Promise<Result<PasskeyHere>>;
  /** Fetch the WebAuthn code ahead of the tap. */
  warm: () => void;
}

/**
 * The calls, keyed to the token. Each sends EVERY device key this browser holds (an account does not know its own
 * number) and the server says which is this person's — the same as the devices list (devices.ts).
 */
export function passkeyApi(post: Post): PasskeyApi {
  const keys = () => allDeviceKeys();
  const keep = (held: Array<{ slot: string; key: string }>, here: PasskeyHere | null | undefined) => {
    const mine = here && here.which >= 0 ? held[here.which] : undefined;
    if (!mine) return;
    if (here?.on) markUnlock(mine.slot, mine.key, here.id);
    else dropUnlockMarkBySlot(mine.slot);
  };
  return {
    read: async () => {
      const held = keys();
      const r = await post<PasskeyHere>('/v1/sbg/account/passkey', { devices: held.map((k) => k.key) });
      if (!r.error) keep(held, r.data);
      return r;
    },
    prepare: (pin) => post<{ options: Options; which: number }>('/v1/sbg/account/passkey/options', { devices: keys().map((k) => k.key), pin }),
    create: async ({ options, which }) => {
      const held = keys();
      const mine = held[which];
      // What the phone's own list of passkeys calls it: the app's name and the end of the number. The server keeps no number to say it.
      const ending = mine?.slot.replace(/\D/g, '').slice(-4);
      const optionsJSON = (ending ? { ...options, user: { ...options.user, name: `SeeBuyGet …${ending}`, displayName: `SeeBuyGet …${ending}` } } : options) as never;
      let response: unknown;
      try {
        response = await (await loadWebAuthn()).startRegistration({ optionsJSON });
      } catch {
        // The phone said no, the prompt was closed, or it timed out: nothing reached us, and nothing is counted.
        return { cancelled: true };
      }
      const r = await post<PasskeyHere>('/v1/sbg/account/passkey/on', { devices: held.map((k) => k.key), response });
      if (r.error || !r.data) return { error: r.error };
      keep(held, r.data);
      return { here: r.data };
    },
    turnOff: async () => {
      const held = keys();
      const r = await post<PasskeyHere>('/v1/sbg/account/passkey/off', { devices: held.map((k) => k.key) });
      if (r.error || !r.data) return r;
      keep(held, r.data);
      // The phone keeps its half until told: where the browser can be told (Chrome's Signal API), it is — best effort.
      tellPhoneToForget(r.data);
      return r;
    },
    warm: () => void loadWebAuthn().catch(() => undefined),
  };
}

/** Where the browser can be told, the phone is told to forget a passkey that was turned off (Chrome's Signal API). */
function tellPhoneToForget(here: PasskeyHere): void {
  const tell = pkc()?.signalUnknownCredential;
  if (tell && here.dropped && here.rpId) void tell.call(pkc(), { rpId: here.rpId, credentialId: here.dropped }).catch(() => undefined);
}

/**
 * 2026-11-02, later (the owner: "ok go ahead with the fingerprint") — THE SAME, IN PLACE OF A SHOP'S, A HUB'S OR A STORE'S
 * OWN PASSWORD, on one of its own phones. This phone holds one key for the account (shopDevice.ts), handed in here with
 * the address it is kept under; turning it on asks for the password again.
 */
export function accountPasskeyApi(post: Post, email: () => string | null, deviceKey: () => string | undefined, party: 'shop' | 'hub' | 'store'): PasskeyApi {
  const keep = (key: string | undefined, here: PasskeyHere | null | undefined) => {
    if (!here || here.which < 0) return;
    if (here.on) markAccountUnlock(email(), key, here.id);
    else dropAccountUnlockMark(email());
  };
  return {
    secret: 'password',
    party,
    read: async () => {
      const key = deviceKey();
      const r = await post<PasskeyHere>('/v1/sbg/account/shop-passkey', { device: key });
      if (!r.error) keep(key, r.data);
      return r;
    },
    prepare: (password) => post<{ options: Options; which: number }>('/v1/sbg/account/shop-passkey/options', { device: deviceKey(), password }),
    create: async ({ options }) => {
      const key = deviceKey();
      // What the phone's own list of passkeys calls it: the app's name and the address it signs in with.
      const address = (email() ?? '').trim().toLowerCase();
      const optionsJSON = (address ? { ...options, user: { ...options.user, name: address, displayName: `SeeBuyGet · ${address}` } } : options) as never;
      let response: unknown;
      try {
        response = await (await loadWebAuthn()).startRegistration({ optionsJSON });
      } catch {
        // The phone said no, the prompt was closed, or it timed out: nothing reached us, and nothing is counted.
        return { cancelled: true };
      }
      const r = await post<PasskeyHere>('/v1/sbg/account/shop-passkey/on', { device: key, response });
      if (r.error || !r.data) return { error: r.error };
      keep(key, r.data);
      return { here: r.data };
    },
    turnOff: async () => {
      const key = deviceKey();
      const r = await post<PasskeyHere>('/v1/sbg/account/shop-passkey/off', { device: key });
      if (r.error || !r.data) return r;
      keep(key, r.data);
      tellPhoneToForget(r.data);
      return r;
    },
    warm: () => void loadWebAuthn().catch(() => undefined),
  };
}

/* ------------------------------------------------------------------------------ a sign-in screen -- */

export interface UnlockOutcome {
  /** The ticket the app's own sign-in takes in the PIN's place. */
  ticket?: string;
  /** This device holds no passkey for this number after all: the note is dropped, and the PIN is asked for. */
  off?: boolean;
  /** The phone said no, or the prompt was closed: nothing happened. */
  cancelled?: boolean;
  error?: SbgError | null;
}

export interface UnlockCeremony {
  /** Ahead of the tap: the challenge and the WebAuthn code (Safari starts the phone's prompt only from the tap itself). */
  prepare: (phone: string) => Promise<'ready' | 'off' | 'failed'>;
  /** The tap: the phone's prompt, then the ticket. */
  unlock: (phone: string) => Promise<UnlockOutcome>;
}

/** A challenge is good for two minutes on the server; one older than this is asked for again. */
const FRESH_MS = 90_000;

/**
 * WHOSE SIGN-IN THE SCREEN IS: a person's, by number and PIN, or (2026-11-02) an account's — a shop's, a hub's, a store's —
 * by email and password, whose phone key the screen hands in (`keyOf`, shopDevice.ts). Each asks its own doors.
 */
interface Holder {
  options: string;
  unlock: string;
  body: (id: string, device: string | undefined) => Record<string, unknown>;
  keyOf: (id: string) => string | undefined;
  drop: (id: string) => void;
}
const PERSON: Holder = { options: '/v1/sbg/identity/unlock/options', unlock: '/v1/sbg/identity/unlock', body: (phone, device) => ({ phone, device }), keyOf: readDeviceKey, drop: dropUnlockMark };
const accountHolder = (keyOf: (email: string) => string | undefined): Holder => ({ options: '/v1/sbg/auth/unlock/options', unlock: '/v1/sbg/auth/unlock', body: (email, device) => ({ email, device }), keyOf, drop: dropAccountUnlockMark });

/** The ceremony at one app's sign-in screen, against its own config (it signs in nobody: the app's door does). */
export function unlockCeremony(config: SbgConfig, account?: { keyOf: (email: string) => string | undefined }): UnlockCeremony {
  const post = <T>(path: string, body: unknown) => publicRequest<T>(config, path, { body });
  const holder = account ? accountHolder(account.keyOf) : PERSON;
  let ready: { phone: string; at: number; options: Record<string, unknown> } | null = null;

  const prepare = async (phone: string): Promise<'ready' | 'off' | 'failed'> => {
    void loadWebAuthn().catch(() => undefined);
    const r = await post<Record<string, unknown> & { allowCredentials?: unknown[] }>(holder.options, holder.body(phone, holder.keyOf(phone)));
    if (r.error || !r.data) return 'failed';
    // Nothing offered for this device: the server has no passkey of this number here (turned off elsewhere, forgotten).
    if (!r.data.allowCredentials?.length) {
      holder.drop(phone);
      ready = null;
      return 'off';
    }
    ready = { phone, at: Date.now(), options: r.data };
    return 'ready';
  };

  return {
    prepare,
    unlock: async (phone) => {
      if (!ready || ready.phone !== phone || Date.now() - ready.at > FRESH_MS) {
        const now = await prepare(phone);
        if (now === 'off') return { off: true };
        if (now === 'failed' || !ready) return { error: null };
      }
      const optionsJSON = (ready as { options: Record<string, unknown> }).options as never;
      ready = null; // a challenge answers once
      let response: unknown;
      try {
        response = await (await loadWebAuthn()).startAuthentication({ optionsJSON });
      } catch {
        // The phone said no, the prompt was closed, or it timed out: nothing reached us, and nothing is counted.
        return { cancelled: true };
      }
      const r = await post<{ unlock: string }>(holder.unlock, { ...holder.body(phone, holder.keyOf(phone)), response });
      if (r.error?.code === 'UNLOCK_OFF' || r.error?.code === 'DEVICE_NOT_KNOWN') {
        holder.drop(phone);
        return { off: true, error: r.error };
      }
      if (r.error || !r.data?.unlock) return { error: r.error };
      return { ticket: r.data.unlock };
    },
  };
}
