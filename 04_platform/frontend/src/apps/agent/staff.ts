import { publicRequest, type Result, type SbgConfig } from '../../lib/sbg';
import { readDeviceKey, saveDeviceKey } from '../../shared/account/pin';
import type { Screen } from './useAgentApp';

/*
 * THE PEOPLE AT THE COUNTER, signing in (backend shop-staff.types.ts; the user, 2026-10-18: "own phone + PIN"). A person
 * signs in on the shop's phone as themselves — their number and their PIN, the same as in any SeeBuyGet app — sees the
 * shops that added them, says yes, and opens a session at one: a sign-in that acts as the shop under their name. The
 * owner's doors (money, prices, hours, people, the shop's account) refuse it on the server; the screens here leave them
 * out, so nobody is shown a button that can only be refused.
 */

/** A person, signed in as themselves (`POST /identity/login` or `/identity/enroll`). */
export interface PersonSignIn {
  personId: string;
  token: { access_token: string; expires_in?: number };
}

/** A shop that added this person: still to say yes to, or theirs to work. */
export interface CounterPlace {
  memberId: string;
  shopDid: string;
  shopName: string;
  name: string;
  state: 'invited' | 'working';
  invitedAt: string;
}

/** A session at one shop's counter, under this person's name. */
export interface StaffSession {
  shopDid: string;
  shopName: string;
  name: string;
  /** Their place at this counter: what their acts are kept under, and what taking them out ends. */
  memberId: string;
  token: { access_token: string; expires_in?: number };
}

/** Who is at the counter on this phone, for as long as their session lasts (the tab's, like the token). */
export interface StaffAtCounter {
  shopDid: string;
  shopName: string;
  name: string;
  memberId: string;
}

/** The doors before anybody is signed in: a PIN, or a first one chosen once the code to the phone is checked. */
export function staffDoors(config: SbgConfig) {
  return {
    login: (phone: string, pin: string): Promise<Result<PersonSignIn>> => publicRequest<PersonSignIn>(config, '/v1/sbg/identity/login', { body: { phone: phone.trim(), pin, device: readDeviceKey(phone) } }),
    codeTo: (phone: string) => publicRequest<{ sent: boolean; code?: string }>(config, '/v1/sbg/auth/phone/request', { body: { phone: phone.trim() } }),
    checkCode: (phone: string, code: string) => publicRequest<{ verified: boolean }>(config, '/v1/sbg/auth/phone/verify', { body: { phone: phone.trim(), code } }),
    /** A first PIN wants a recovery email behind it: the server asks, and the address and its code come on a second try. */
    choosePin: async (phone: string, pin: string, recovery?: { email: string; code: string }): Promise<Result<PersonSignIn>> => {
      const r = await publicRequest<PersonSignIn & { device?: string }>(config, '/v1/sbg/identity/enroll', {
        body: { phone: phone.trim(), pin, device: readDeviceKey(phone), ...(recovery ? { email: recovery.email.trim(), emailCode: recovery.code } : {}) },
      });
      // The code was typed on this phone: it is handed the key the PIN is asked with from now on.
      saveDeviceKey(phone, (r.data as { device?: string } | null)?.device);
      return r;
    },
  };
}

/**
 * WITH THE PERSON'S OWN SIGN-IN: the shops that added them, their yes or no, and a session at one. Their own token is
 * needed for a minute. It is held here and nowhere else — not stored, and not a signed-in client, which would start the
 * page's outbox loop under it and send the counter's queued acts with a sign-in that is not the shop's — and it is let
 * go once a session at a counter is open, because the counter's phone is the shop's and not theirs.
 */
export function counterPlaces(config: SbgConfig, signIn: PersonSignIn) {
  let bearer: string | null = signIn.token.access_token;
  const call = <T>(path: string, method: 'GET' | 'POST'): Promise<Result<T>> =>
    bearer ? publicRequest<T>(config, path, { method, bearer, ...(method === 'POST' ? { body: {} } : {}) }) : Promise.resolve(signedOut<T>());
  const get = <T>(path: string) => call<T>(path, 'GET');
  const post = <T>(path: string) => call<T>(path, 'POST');
  return {
    list: () => get<CounterPlace[]>('/v1/sbg/shop-invitations'),
    accept: (memberId: string) => post<CounterPlace>(`/v1/sbg/shop-invitations/${encodeURIComponent(memberId)}/accept`),
    decline: (memberId: string) => post<{ declined: true }>(`/v1/sbg/shop-invitations/${encodeURIComponent(memberId)}/decline`),
    open: async (shopDid: string): Promise<Result<StaffSession>> => {
      const r = await post<StaffSession>(`/v1/sbg/shops/${encodeURIComponent(shopDid)}/staff-session`);
      if (!r.error) forget();
      return r;
    },
    forget,
  };
  function forget(): void {
    bearer = null;
  }
}

export type CounterPlacesApi = ReturnType<typeof counterPlaces>;

function signedOut<T>(): Result<T> {
  return { data: null, error: { code: 'UNAUTHORIZED', status: 401, title: 'Please sign in again', detail: 'Sign in with your number and PIN.', retryable: false }, status: 401 };
}

/** The places worth showing: shops to work first, then invitations, each by name. */
export function placesInOrder(places: CounterPlace[]): CounterPlace[] {
  return [...places].sort((a, b) => (a.state === b.state ? a.shopName.localeCompare(b.shopName) : a.state === 'working' ? -1 : 1));
}

/* ------------------------------------------------------------------ who is at the counter on this phone -- */

const STAFF_KEY = 'glos-agent-staff';

/** The person working this shop's counter on this phone, if the session here is theirs — never another shop's. */
export function readStaff(shopDid: string | null): StaffAtCounter | null {
  if (!shopDid) return null;
  try {
    const raw = globalThis.sessionStorage?.getItem(STAFF_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<StaffAtCounter>) : null;
    return v && v.shopDid === shopDid && typeof v.name === 'string' && typeof v.memberId === 'string' ? { shopDid, shopName: String(v.shopName ?? ''), name: v.name, memberId: v.memberId } : null;
  } catch {
    return null;
  }
}

export function saveStaff(who: StaffAtCounter): void {
  try {
    globalThis.sessionStorage?.setItem(STAFF_KEY, JSON.stringify(who));
  } catch {
    /* storage unavailable — the screens show the owner's rows, and the server refuses them by name */
  }
}

export function clearStaff(): void {
  try {
    globalThis.sessionStorage?.removeItem(STAFF_KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * THE OWNER'S SCREENS — money, prices, freight posted for the shop, the shelf's layout, the shop's books and papers.
 * One of the shop's people at the counter is shown the counter instead (the server refuses them these doors by name).
 */
const OWNER_SCREENS: ReadonlySet<Screen> = new Set<Screen>(['records', 'rates', 'freight', 'shelf']);

export function ownerOnlyScreen(screen: Screen): boolean {
  return OWNER_SCREENS.has(screen);
}
