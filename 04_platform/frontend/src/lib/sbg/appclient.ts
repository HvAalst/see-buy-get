import { isBrowserOffline, markOffline, markOnline } from '../../shared/connectivity';
import { createSbgClient, type Result, type SbgClient } from './client';
import type { SbgConfig } from './config';
import { clientError, toSbgError, type SbgError } from './errors';
import { Session, type MintedToken } from './session';

/**
 * App-client machinery shared by every SeeBuyGet PWA (S10).
 *
 * The S8 driver app proved this shape file-by-file (see apps/driver/api.ts, whose machinery
 * this generalizes): a per-identity Session, a mint that records WHY it failed, a "truthful"
 * wrapper that reports the mint's reason instead of the NETWORK cover story, and a purge that
 * runs on every identity transition so a shared phone never keeps the previous person's
 * bearer. The driver's own copy is committed and tested; new apps use THIS module so the
 * next fix lands once.
 *
 * Two session flavours:
 *  - `createSeededClient` — for apps whose token comes from the real S2 login
 *    (POST /v1/sbg/auth/login): the session is seeded once with the login's token and can
 *    NEVER re-mint by itself (the app does not hold the password). When the token dies the
 *    caller gets a mint-sourced UNAUTHORIZED and the shell routes back to sign-in.
 *  - `createMintedClient` — for apps that mint per-DID actor tokens from the sandbox
 *    endpoint (POST /v1/auth/token). Same known limitation as the driver app: that path is
 *    client-secret gated outside the sandbox.
 */

/* ------------------------------------------------------------------ narrow -- */

/**
 * The single sanctioned cast site per app. Many sbg responses are `Record<string, never>` in
 * the generated schema (the backend returns them untyped), so each app declares honest view
 * types and funnels every boundary crossing through here — greppable in one line.
 */
export function narrow<T>(data: unknown): T {
  return data as T;
}

/* ------------------------------------------------------------------ tokens -- */

/** The storage slot for one identity's token under an app's namespace. */
export function tokenKeyFor(prefix: string, did: string): string {
  return `${prefix}${did}`;
}

/**
 * Drop stored tokens under `prefix`, keeping only `keepDid`'s (pass null to drop all).
 * Namespacing stops a foreign token being READ; this stops it being KEPT — a phone changing
 * hands must not leave the previous identity's bearer behind. Run on every identity
 * transition (sign-in, sign-out, adoption, DID change) — but never before the first identity
 * is established, or it wipes the very token that survives a cold start.
 */
export function purgeTokens(prefix: string, keepDid: string | null): void {
  const keep = keepDid ? tokenKeyFor(prefix, keepDid) : null;
  try {
    const store = globalThis.sessionStorage;
    if (!store) return;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(prefix) && k !== keep) doomed.push(k);
    }
    // Collected first: removing during the walk renumbers the remaining indices.
    for (const k of doomed) store.removeItem(k);
  } catch {
    /* storage unavailable — nothing was persisted in the first place */
  }
}

/* ----------------------------------------------------------- mint truthing -- */

/**
 * Choose the error the user is actually told about. The mint runs inside openapi-fetch's
 * onRequest middleware, so its failure reaches the library only as a thrown value, which
 * `normalize()` can only call NETWORK/TIMEOUT. When the mint recorded a real reason, it wins.
 * Only those two client-synthesised codes are ever a cover story — a real 402/409 from the
 * endpoint itself is already the truth.
 */
export function preferMintFailure(observed: SbgError, mint: SbgError | null): SbgError {
  if (!mint) return observed;
  if (observed.code !== 'NETWORK' && observed.code !== 'TIMEOUT') return observed;
  return mint;
}

/** Did this error come from the TOKEN MINT rather than the endpoint the caller asked for? */
export function isMintSourced(error: SbgError | null | undefined): boolean {
  return (error?.params as { source?: string } | undefined)?.source === 'mint';
}

function fromMint(error: SbgError): SbgError {
  return { ...error, params: { ...(error.params ?? {}), source: 'mint' } };
}

/**
 * Does this failure mean the IDENTITY itself was rejected at mint time? The backend answers
 * an unknown DID on the mint path with 400 (BadRequestException), never 404 — so only a
 * mint-sourced 400 may erase a stored identity. A mint-sourced 404 is a wrong base URL or a
 * moved proxy, and erasing on that would sign out everyone in the field over one misrouted
 * deploy.
 */
export function isUnknownIdentity(error: SbgError | null | undefined): boolean {
  if (!error || !isMintSourced(error)) return false;
  return error.status === 400 || error.code === 'BAD_REQUEST';
}

/**
 * Is the app being told to go back to sign-in? True for the seeded session's expiry signal
 * (mint-sourced UNAUTHORIZED/AUTH_FAILED) — the shell routes to the sign-in screen instead
 * of rendering a dead retry loop.
 */
export function isSignInRequired(error: SbgError | null | undefined): boolean {
  if (!error || !isMintSourced(error)) return false;
  return error.code === 'UNAUTHORIZED' || error.code === 'AUTH_FAILED' || error.status === 401;
}

/** An error the library's `normalize()` will classify as TIMEOUT rather than NETWORK. */
function abortError(detail: string): Error {
  const e = new Error(detail);
  e.name = 'AbortError';
  return e;
}

/* ---------------------------------------------------------- public request -- */

const HEX = '0123456789abcdef';
function traceId(): string {
  let s = 'trc_';
  const seed = (typeof performance !== 'undefined' ? performance.now() : 0) * 1000;
  for (let i = 0; i < 16; i++) s += HEX[Math.floor((seed + i * 7.13) % 16)];
  return s;
}

/**
 * One unauthenticated call to an @Public sbg endpoint (login/forgot/reset — and the consumer
 * read surfaces once they are public), normalized to the same Result envelope as every
 * authenticated call, with the same timeout discipline: its own AbortController covering the
 * response BODY too, so a stalled body cannot hang the caller.
 */
export async function publicRequest<T>(
  config: SbgConfig,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown; fetch?: typeof fetch },
): Promise<Result<T>> {
  const doFetch = init?.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.timeoutMs);
  try {
    let res: Response;
    try {
      res = await doFetch(`${config.baseUrl}${path}`, {
        method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
        headers: {
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
          'X-SBG-Client': config.clientId,
          'X-SBG-Trace-Id': traceId(),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      if (ctl.signal.aborted) {
        return { data: null, error: clientError('TIMEOUT', `No answer within ${config.timeoutMs} ms.`), status: 0 };
      }
      // Nothing left the phone. Told as OFFLINE when the phone itself says the radio is off — a sign-in needs a connection.
      markOffline();
      return { data: null, error: clientError(isBrowserOffline() ? 'OFFLINE' : 'NETWORK', String((e as Error)?.message ?? e)), status: 0 };
    }
    markOnline();
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 426) {
      return { data: null, error: clientError('CLIENT_OUTDATED', 'This app must be updated to continue.'), status: 426 };
    }
    if (!res.ok) return { data: null, error: toSbgError(body, res.status), status: res.status };
    return { data: (body ?? null) as T, error: null, status: res.status };
  } catch (e) {
    if (ctl.signal.aborted) {
      return { data: null, error: clientError('TIMEOUT', `No answer within ${config.timeoutMs} ms.`), status: 0 };
    }
    return { data: null, error: clientError('NETWORK', String((e as Error)?.message ?? e)), status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One unauthenticated call that answers with a FILE. The same envelope and the same timeout as `publicRequest` — a
 * refusal is still read as the server's own JSON, so the caller can say why — and what is asked goes in the body,
 * never in the address: the one caller of this sends a key.
 */
export async function publicDownload(config: SbgConfig, path: string, init: { body: unknown; fetch?: typeof fetch }): Promise<Result<Blob>> {
  const doFetch = init.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.timeoutMs);
  try {
    let res: Response;
    try {
      res = await doFetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-SBG-Client': config.clientId, 'X-SBG-Trace-Id': traceId() },
        body: JSON.stringify(init.body),
        signal: ctl.signal,
      });
    } catch (e) {
      if (ctl.signal.aborted) return { data: null, error: clientError('TIMEOUT', `No answer within ${config.timeoutMs} ms.`), status: 0 };
      markOffline();
      return { data: null, error: clientError(isBrowserOffline() ? 'OFFLINE' : 'NETWORK', String((e as Error)?.message ?? e)), status: 0 };
    }
    markOnline();
    if (!res.ok) return { data: null, error: toSbgError(await res.json().catch(() => null), res.status), status: res.status };
    return { data: await res.blob(), error: null, status: res.status };
  } catch (e) {
    if (ctl.signal.aborted) return { data: null, error: clientError('TIMEOUT', `No answer within ${config.timeoutMs} ms.`), status: 0 };
    return { data: null, error: clientError('NETWORK', String((e as Error)?.message ?? e)), status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------- login surface -- */

/** What POST /v1/sbg/auth/login and /auth/signup resolve to (S2 account service). */
export interface LoginView {
  accountId: string;
  role: 'pudo' | 'driver' | 'mdp';
  did: string;
  email: string;
  entityStatus?: string;
  token: { access_token: string; expires_in?: number };
  /** This phone's key, once — when it was just confirmed as one of a shop's phones. */
  device?: string;
}

/** Email + password; for a shop, this phone's key with it (a shop's sign-in works only on its own phones). */
export function sbgLogin(config: SbgConfig, email: string, password: string, f?: typeof fetch, device?: string): Promise<Result<LoginView>> {
  return publicRequest<LoginView>(config, '/v1/sbg/auth/login', { body: { email, password, ...(device ? { device } : {}) }, fetch: f });
}

/** The code texted to the shop's number, typed on this phone: it is one of the shop's from now, and signed in. */
export function sbgConfirmDevice(config: SbgConfig, challenge: string, code: string, f?: typeof fetch): Promise<Result<LoginView>> {
  return publicRequest<LoginView>(config, '/v1/sbg/auth/device', { body: { challenge, code }, fetch: f });
}

/**
 * Change your own password, proven with the CURRENT one. Every other session holding the old password is signed
 * out; the answer carries a fresh sign-in for this device, which the caller seeds so it stays in.
 */
export function sbgChangePassword(config: SbgConfig, email: string, password: string, newPassword: string, f?: typeof fetch, device?: string): Promise<Result<LoginView>> {
  return publicRequest<LoginView>(config, '/v1/sbg/auth/password', { body: { email, password, newPassword, ...(device ? { device } : {}) }, fetch: f });
}

export function sbgForgot(config: SbgConfig, email: string, f?: typeof fetch): Promise<Result<{ sent: boolean; resetToken?: string }>> {
  return publicRequest(config, '/v1/sbg/auth/forgot', { body: { email }, fetch: f });
}

export function sbgReset(config: SbgConfig, token: string, password: string, f?: typeof fetch): Promise<Result<{ ok: boolean }>> {
  return publicRequest(config, '/v1/sbg/auth/reset', { body: { token, password }, fetch: f });
}

/* ---------------------------------------------------------- seeded session -- */

export interface AppClient {
  sbg: SbgClient;
  session: Session;
}

export interface SeededAppClient extends AppClient {
  /** Hand the session the token a login just returned; persists it under the identity's key. */
  seed(token: MintedToken): Promise<void>;
}

/**
 * The client for a login-authenticated app (agent, hub). The session's "mint" can only ever
 * return a token that a real login seeded; once that token dies, every call resolves to a
 * mint-sourced UNAUTHORIZED (`isSignInRequired`) and the shell returns to sign-in. It never
 * invents a NETWORK story for an expired shift.
 */
export function createSeededClient(config: SbgConfig, storageKey: string, opts?: { fetch?: typeof fetch; traceId?: () => string }): SeededAppClient {
  let pending: MintedToken | null = null;
  let mintFailure: SbgError | null = null;

  const session = new Session(storageKey, async () => {
    mintFailure = null;
    if (pending) {
      const t = pending;
      pending = null;
      return t;
    }
    const failure: SbgError = {
      code: 'UNAUTHORIZED',
      status: 401,
      title: 'Please sign in again',
      detail: 'Your sign-in has ended on this phone.',
      retryable: false,
    };
    mintFailure = fromMint(failure);
    throw abortError('sign-in required');
  });

  const base = createSbgClient({ config, session, fetch: opts?.fetch, traceId: opts?.traceId });
  const sbg: SbgClient = {
    raw: base.raw,
    request: (fn) =>
      base.request(fn).then((r) => {
        if (!r.error) return r;
        const error = preferMintFailure(r.error, mintFailure);
        return error === r.error ? r : { data: null, error, status: error.status };
      }),
  };

  return {
    sbg,
    session,
    async seed(token: MintedToken) {
      pending = token;
      await session.refresh();
    },
  };
}

/* ----------------------------------------------------- credentialed session -- */

/**
 * The client for an app whose CREDENTIAL lives on the device (the vendor console's store
 * ID + signing secret): unlike a password login, the session can re-mint by itself, so an
 * expired token never bounces the user to sign-in — the mint fn just logs in again. The
 * login is any Result-returning call ending in a token; its typed failure (AUTH_FAILED,
 * TIMEOUT, …) is recorded as the mint failure so the shell reports the truth, not
 * "no signal".
 */
type TokenShape = { access_token: string; expires_in?: number };

export function createCredentialedClient(
  config: SbgConfig,
  storageKey: string,
  login: () => Promise<Result<{ token: TokenShape } | TokenShape>>,
  opts?: { fetch?: typeof fetch; traceId?: () => string },
): AppClient {
  let mintFailure: SbgError | null = null;

  const session = new Session(storageKey, async () => {
    mintFailure = null;
    const r = await login();
    if (r.error) {
      mintFailure = fromMint(r.error);
      // TIMEOUT must classify as TIMEOUT downstream; everything else may wear the NETWORK
      // cover story, which preferMintFailure swaps back for the recorded truth.
      throw r.error.code === 'TIMEOUT' ? abortError(r.error.detail) : new Error(r.error.detail || r.error.title);
    }
    const raw = r.data as { token?: TokenShape; access_token?: string; expires_in?: number };
    const token = raw.token ?? (raw as TokenShape);
    if (!token?.access_token) {
      mintFailure = fromMint(toSbgError({ code: 'INTERNAL', detail: 'Sign-in returned no token.' }, 200));
      throw new Error('Login returned no access_token');
    }
    return { access_token: token.access_token, expires_in: token.expires_in ?? 3600 };
  });

  const base = createSbgClient({ config, session, fetch: opts?.fetch, traceId: opts?.traceId });
  const sbg: SbgClient = {
    raw: base.raw,
    request: (fn) =>
      base.request(fn).then((r) => {
        if (!r.error) return r;
        const error = preferMintFailure(r.error, mintFailure);
        return error === r.error ? r : { data: null, error, status: error.status };
      }),
  };

  return { sbg, session };
}

/* ---------------------------------------------------------- minted session -- */

/**
 * The client for an app that mints per-DID actor tokens from the sandbox endpoint
 * (POST /v1/auth/token) — the S8 driver pattern, generalized. Carries the driver app's
 * hard-won fixes: the mint has its OWN timeout (the library's is not armed yet inside the
 * middleware), the abort window covers the response BODY, an HTTP rejection keeps its status
 * and problem+json body (never reported as "no signal"), and a 200 with no token is INTERNAL
 * rather than a persisted `Bearer undefined`.
 *
 * KNOWN LIMITATION (unchanged from S8): this path is client-secret gated once
 * GLOS_CLIENT_SECRET is configured — sandbox only.
 */
export function createMintedClient(
  config: SbgConfig,
  role: string,
  did: string,
  storageKey: string,
  opts?: { fetch?: typeof fetch; traceId?: () => string; tenant?: string },
): AppClient {
  let mintFailure: SbgError | null = null;
  const doFetch = opts?.fetch ?? fetch;

  const session = new Session(storageKey, async () => {
    mintFailure = null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.timeoutMs);
    try {
      let res: Response;
      try {
        res = await doFetch(`${config.baseUrl}/v1/auth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `tenant` scopes the token's :own reach server-side (a fleet manager sees only
          // their fleet) — it must ride the mint, no request can add it later.
          body: JSON.stringify({ role, did, type: 'client_credentials', ...(opts?.tenant ? { tenant: opts.tenant } : {}) }),
          signal: ctl.signal,
        });
      } catch (e) {
        if (ctl.signal.aborted) {
          const detail = `Sign-in did not answer within ${config.timeoutMs} ms.`;
          mintFailure = fromMint(clientError('TIMEOUT', detail));
          throw abortError(detail);
        }
        const detail = String((e as Error)?.message ?? e);
        mintFailure = fromMint(clientError('NETWORK', detail));
        throw new Error(detail);
      }

      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        mintFailure = fromMint(toSbgError(body, res.status));
        throw new Error(`Token mint failed (${res.status})`);
      }

      const minted = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
      if (!minted?.access_token) {
        mintFailure = fromMint(toSbgError({ code: 'INTERNAL', detail: 'Sign-in returned no token.' }, res.status));
        throw new Error('Token mint returned no access_token');
      }
      // A missing lifetime falls back to an hour rather than 0 — 0 would re-mint on every request.
      return { access_token: minted.access_token, expires_in: minted.expires_in ?? 3600 };
    } catch (e) {
      if (ctl.signal.aborted && !mintFailure) {
        const detail = `Sign-in did not answer within ${config.timeoutMs} ms.`;
        mintFailure = fromMint(clientError('TIMEOUT', detail));
        throw abortError(detail);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  const base = createSbgClient({ config, session, fetch: opts?.fetch, traceId: opts?.traceId });
  const sbg: SbgClient = {
    raw: base.raw,
    request: (fn) =>
      base.request(fn).then((r) => {
        if (!r.error) return r;
        const error = preferMintFailure(r.error, mintFailure);
        return error === r.error ? r : { data: null, error, status: error.status };
      }),
  };

  return { sbg, session };
}
