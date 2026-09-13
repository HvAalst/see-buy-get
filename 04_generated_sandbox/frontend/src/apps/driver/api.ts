import {
  Session,
  clientError,
  createDriverApi,
  createConversationsApi,
  createNotificationsApi,
  createSbgClient,
  type ConversationsApi,
  makeConfig,
  toSbgError,
  type DriverApi,
  type NotificationsApi,
  type SbgClient,
  type SbgError,
} from '../../lib/sbg';

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

/**
 * Choose the error the user is actually told about.
 *
 * The mint runs inside openapi-fetch's `onRequest` middleware, which resolves BEFORE the injected
 * fetch is called — so a mint failure never reaches the library as an HTTP response, only as a
 * thrown value, and `normalize()` can only classify a throw as NETWORK (or TIMEOUT on an abort).
 * That told a driver who mistyped their DID that their phone had no signal, and set `stale: true`
 * on data that was never stale. When the mint recorded a real reason, it wins.
 *
 * Pure, and exported, because this is the whole of the lie: given an observed error and whatever
 * the mint recorded, which one is true.
 */
export function preferMintFailure(observed: SbgError, mint: SbgError | null): SbgError {
  if (!mint) return observed;
  // Only the two client-synthesised codes are ever a cover story. A real 402/409 from the
  // endpoint itself is the truth already and must not be overwritten by a stale mint note.
  if (observed.code !== 'NETWORK' && observed.code !== 'TIMEOUT') return observed;
  return mint;
}

/**
 * Marks an error as having come from the TOKEN MINT rather than from the endpoint the caller asked
 * for. This distinction is destructive if lost: `refresh()` signs the driver out and erases their
 * stored DID when the driver record is genuinely gone, and a mint-sourced 404 (a wrong
 * VITE_SBG_API, a moved proxy path, an HTML 404 page) is otherwise indistinguishable from that —
 * one misrouted deploy would log out every driver in the field and delete the ID they signed in with.
 */
export function isMintSourced(error: SbgError | null | undefined): boolean {
  return (error?.params as { source?: string } | undefined)?.source === 'mint';
}

function fromMint(error: SbgError): SbgError {
  return { ...error, params: { ...(error.params ?? {}), source: 'mint' } };
}

/**
 * Does this mint failure mean the IDENTITY is wrong (as opposed to the network or the deployment)?
 *
 * The backend validates the DID on this path: POST /v1/auth/token with {role,did} routes to
 * mintActorToken -> issueToken({type:'did'}), which throws BadRequestException("Unknown DID") — a
 * 400, NOT a 404. So an unrecoverably mistyped ID arrives as BAD_REQUEST, which carries no
 * presentation entry and is not retryable: the driver used to be stranded on a generic
 * "Something went wrong" with no retry and no way back to sign-in. This is what routes them home.
 */
export function isUnknownIdentity(error: SbgError | null | undefined): boolean {
  if (!error || !isMintSourced(error)) return false;
  return error.status === 400 || error.code === 'BAD_REQUEST';
}

/** An error the library's `normalize()` will classify as TIMEOUT rather than NETWORK. */
function abortError(detail: string): Error {
  const e = new Error(detail);
  e.name = 'AbortError';
  return e;
}

export interface DriverClient {
  api: DriverApi;
  session: Session;
  /** Persona-agnostic Web Push controls, bound to the same token (N1). */
  notifications: NotificationsApi;
  /** CV1 — asking about a load, and the threads that follow. */
  conversations: ConversationsApi;
}

export function createDriverClient(did: string): DriverClient {
  const config = makeConfig('driver', APP_VERSION);

  /**
   * Why the mint failed, if it did. Set at the moment of failure, cleared at the start of every
   * attempt and on success — so it can only ever describe the mint the failing request tried to
   * use (no token means the next request mints again, which resets this first).
   */
  let mintFailure: SbgError | null = null;

  const session = new Session(tokenKeyFor(did), async () => {
    mintFailure = null;

    // The mint carries its OWN timeout. It is not covered by the library's: openapi-fetch awaits
    // every onRequest middleware (where getToken() runs) before it ever calls the injected fetch,
    // so the 15s AbortController inside `timeoutFetch` has not been armed yet. A hung mint socket
    // used to leave `refreshing` true forever, `run()`'s finally unreached and `busy` stuck — every
    // control on the screen disabled, permanently, with no way back but a reload.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.timeoutMs);

    // The timer is cleared in ONE outer finally, so the abort window covers the response BODY too.
    // Clearing it right after the fetch resolved left `await res.json()` unguarded: a server that
    // sends headers and then stalls the body hung getToken() forever — the very wedge this timeout
    // exists to prevent (refreshing stuck true, run()'s finally unreached, every control disabled).
    try {
      let res: Response;
      try {
        res = await fetch(`${config.baseUrl}/v1/auth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'driver', did, type: 'client_credentials' }),
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

      // An HTTP rejection is NOT a network failure. Keep the status and the problem+json body so
      // the shell can say "we could not find that, check the code" instead of "no signal".
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        mintFailure = fromMint(toSbgError(body, res.status));
        throw new Error(`Token mint failed (${res.status})`);
      }

      const minted = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
      if (!minted?.access_token) {
        // A 200 with no token would otherwise be persisted and sent as `Bearer undefined`.
        mintFailure = fromMint(toSbgError({ code: 'INTERNAL', detail: 'Sign-in returned no token.' }, res.status));
        throw new Error('Token mint returned no access_token');
      }
      // A missing lifetime falls back to an hour rather than 0: 0 would put the soft deadline in
      // the past on arrival and re-mint on every single request. The 401 remains the real authority.
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

  const sbg = createSbgClient({ config, session });

  // One wrap point for the whole persona facade: every Result leaves here carrying the true
  // reason it failed, so no screen has to know that the mint exists.
  const truthful: SbgClient = {
    raw: sbg.raw,
    request: (fn) =>
      sbg.request(fn).then((r) => {
        if (!r.error) return r;
        const error = preferMintFailure(r.error, mintFailure);
        // `status` travels with the error it belongs to — a 404 envelope must not read 0.
        return error === r.error ? r : { data: null, error, status: error.status };
      }),
  };

  return { api: createDriverApi(truthful), session, notifications: createNotificationsApi(truthful), conversations: createConversationsApi(truthful) };
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
