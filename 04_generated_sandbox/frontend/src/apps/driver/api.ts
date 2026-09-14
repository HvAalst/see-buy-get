import {
  createConversationsApi,
  createDriverApi,
  createNotificationsApi,
  createSeededClient,
  makeConfig,
  publicRequest,
  type ConversationsApi,
  type DriverApi,
  type MintedToken,
  type NotificationsApi,
  type Result,
  type SeededAppClient,
} from '../../lib/sbg';

export { isMintSourced, isSignInRequired } from '../../lib/sbg';

const APP_VERSION = '1.0.0';

/**
 * sessionStorage namespace for driver bearer tokens.
 *
 * ONE KEY PER DID. The single fixed key this used to carry was a cross-driver token leak: a new
 * Session is built whenever the DID changes, and its constructor re-hydrates whatever is under
 * the key. Driver B therefore started life holding driver A's token — and `softDeadlineMono` is
 * 0 after a re-hydrate, so `getToken()` handed it straight out without minting. Every request for
 * B went out as A. Nothing recovers from that either: the library re-mints only on a 401, and a
 * scoped backend answers a wrong-subject token with 403.
 */
const TOKEN_PREFIX = 'sbg:driver:';

/** The storage slot for one driver's token. Exported for the identity tests. */
export function tokenKeyFor(did: string): string {
  return `${TOKEN_PREFIX}${did}`;
}

/**
 * Drop stored driver tokens, keeping only `keepDid`'s (pass `null` to drop them all).
 *
 * Namespacing alone stops a foreign token being *read*; this stops it being *kept*. A phone
 * shared between two drivers must not leave the previous driver's bearer token sitting in
 * sessionStorage after the handover, so every identity transition (sign-in, sign-out, `?driver=`
 * adoption, DID change) runs this.
 */
export function purgeDriverTokens(keepDid: string | null): void {
  const keep = keepDid ? tokenKeyFor(keepDid) : null;
  try {
    const store = globalThis.sessionStorage;
    if (!store) return;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(TOKEN_PREFIX) && k !== keep) doomed.push(k);
    }
    // Collected first: removing during the walk renumbers the remaining indices.
    for (const k of doomed) store.removeItem(k);
  } catch {
    /* storage unavailable — nothing was persisted in the first place */
  }
}

export interface DriverClient {
  api: DriverApi;
  /** The seeded session: a sign-in hands it the token the server minted. */
  client: SeededAppClient;
  /** Persona-agnostic Web Push controls, bound to the same token (N1). */
  notifications: NotificationsApi;
  /** CV1 — asking about a load, and the threads that follow. */
  conversations: ConversationsApi;
}

export function driverConfig() {
  return makeConfig('driver', APP_VERSION);
}

/**
 * The driver's client. The token comes from a real sign-in (phone + PIN → `POST /v1/sbg/drivers/session`) and is
 * seeded into a per-driver session; when it dies the shell gets `isSignInRequired` and returns to sign-in, because
 * the PIN never lives on the phone.
 *
 * It used to mint its own token from `/v1/auth/token` for whatever driver ID was typed in — anyone who had read
 * an ID off a badge could drive as that person. That grant is now closed outside a sandbox.
 */
export function createDriverClient(did: string): DriverClient {
  const client = createSeededClient(driverConfig(), tokenKeyFor(did));
  return { api: createDriverApi(client.sbg), client, notifications: createNotificationsApi(client.sbg), conversations: createConversationsApi(client.sbg) };
}

/* ------------------------------------------------------ signing in -- */

export interface DriverSignIn {
  did: string;
  displayName: string;
  status: string;
  token: MintedToken;
}

/** Phone + PIN → the driver this phone was registered to, and a token for them. */
export function driverSession(phone: string, pin: string): Promise<Result<DriverSignIn>> {
  return publicRequest<DriverSignIn>(driverConfig(), '/v1/sbg/drivers/session', { body: { phone, pin } });
}

/** First time, or a forgotten PIN: a one-time code to the phone (echoed back only in a sandbox). */
export function requestPhoneCode(phone: string): Promise<Result<{ sent: boolean; code?: string }>> {
  return publicRequest(driverConfig(), '/v1/sbg/auth/phone/request', { body: { phone } });
}

export function verifyPhoneCode(phone: string, code: string): Promise<Result<{ verified: boolean }>> {
  return publicRequest(driverConfig(), '/v1/sbg/auth/phone/verify', { body: { phone, code } });
}

/** Choose (or replace) the PIN for a phone that has just been verified by code. */
export function choosePin(phone: string, pin: string): Promise<Result<unknown>> {
  return publicRequest(driverConfig(), '/v1/sbg/identity/enroll', { body: { phone, pin } });
}

/**
 * The single sanctioned cast site.
 *
 * `session`, `claims`, `suggest-work`, `pricing/near`, `mdps`, `agents` and `totes/{code}/load`
 * are all `Record<string, never>` in the generated schema, and the enums on the typed
 * responses are erased to the same thing. Rather than sprinkle `as unknown as` through the
 * screens, every boundary crossing goes through here, so the places where the contract is
 * lying to us are greppable in one line.
 */
export function narrow<T>(data: unknown): T {
  return data as T;
}
