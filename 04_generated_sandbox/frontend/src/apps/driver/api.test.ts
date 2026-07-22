import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDriverClient, isMintSourced, isUnknownIdentity, preferMintFailure, purgeDriverTokens, tokenKeyFor } from './api';
import { clientError, toSbgError, type SbgError } from '../../lib/sbg';

function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(() => {
  (globalThis as { sessionStorage?: Storage }).sessionStorage = mockStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------ token keys -- */

describe('driver token storage', () => {
  it('namespaces the storage slot per DID (the fixed key was a cross-driver leak)', () => {
    expect(tokenKeyFor('did:a')).toBe('sbg:driver:did:a');
    expect(tokenKeyFor('did:a')).not.toBe(tokenKeyFor('did:b'));
  });

  it('purges every other driver, keeps the named one, and never touches foreign keys', () => {
    sessionStorage.setItem(tokenKeyFor('did:a'), 'tok-a');
    sessionStorage.setItem(tokenKeyFor('did:b'), 'tok-b');
    sessionStorage.setItem('glos-driver-route:did:a', '{}');

    purgeDriverTokens('did:b');

    expect(sessionStorage.getItem(tokenKeyFor('did:a'))).toBeNull();
    expect(sessionStorage.getItem(tokenKeyFor('did:b'))).toBe('tok-b');
    expect(sessionStorage.getItem('glos-driver-route:did:a')).toBe('{}');
  });

  it('drops every driver token when nothing is kept (sign-in / sign-out / ?driver=)', () => {
    sessionStorage.setItem(tokenKeyFor('did:a'), 'tok-a');
    sessionStorage.setItem(tokenKeyFor('did:b'), 'tok-b');

    purgeDriverTokens(null);

    expect(sessionStorage.getItem(tokenKeyFor('did:a'))).toBeNull();
    expect(sessionStorage.getItem(tokenKeyFor('did:b'))).toBeNull();
  });

  it('survives a tab with no sessionStorage at all (private mode / locked-down WebView)', () => {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = undefined;
    expect(() => purgeDriverTokens('did:a')).not.toThrow();
  });
});

/* -------------------------------------------------------- error selection -- */

describe('preferMintFailure', () => {
  const network = clientError('NETWORK', 'Failed to fetch');

  it('replaces the cover story when the mint knows the real reason', () => {
    const real = toSbgError({ code: 'NOT_FOUND', detail: 'Unknown driver' }, 404);
    expect(preferMintFailure(network, real)).toBe(real);
  });

  it('leaves a genuine network failure alone when the mint did not fail', () => {
    expect(preferMintFailure(network, null)).toBe(network);
  });

  it('never overwrites an error the endpoint itself returned', () => {
    const business: SbgError = { code: 'WALLET_INSUFFICIENT', status: 402, title: '', detail: '', retryable: false };
    const stale = toSbgError({ code: 'FORBIDDEN' }, 403);
    expect(preferMintFailure(business, stale)).toBe(business);
  });
});

/* -------------------------------------------------------------- the mint -- */

describe('createDriverClient', () => {
  it('gives each driver their own token — B never rides on A’s bearer', async () => {
    const auth: (string | null)[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/v1/auth/token')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { did: string };
        return jsonResponse({ access_token: `tok:${body.did}`, expires_in: 3600 });
      }
      auth.push((input as Request).headers.get('authorization'));
      return jsonResponse({ did: 'x' });
    });

    // Same tab, same sessionStorage: the second client used to re-hydrate the first one's token.
    await createDriverClient('did:a').api.me('did:a');
    await createDriverClient('did:b').api.me('did:b');

    expect(auth).toEqual(['Bearer tok:did:a', 'Bearer tok:did:b']);
    expect(sessionStorage.getItem(tokenKeyFor('did:a'))).toBe('tok:did:a');
    expect(sessionStorage.getItem(tokenKeyFor('did:b'))).toBe('tok:did:b');
  });

  it('reports an HTTP mint rejection truthfully, not as "no signal"', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (urlOf(input).endsWith('/v1/auth/token')) return jsonResponse({ code: 'NOT_FOUND', detail: 'Unknown driver' }, 404);
      return jsonResponse({ did: 'x' });
    });

    const r = await createDriverClient('did:typo').api.me('did:typo');

    expect(r.error?.code).toBe('NOT_FOUND'); // was NETWORK — "No signal right now" for a typo
    expect(r.error?.status).toBe(404);
    expect(r.status).toBe(404);
  });

  it('still reports a genuine network failure as NETWORK', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    const r = await createDriverClient('did:a').api.me('did:a');
    expect(r.error?.code).toBe('NETWORK');
  });

  it('times the mint out instead of wedging the app forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // A hung socket: answers nothing, only the abort.
          if (urlOf(input).endsWith('/v1/auth/token')) {
            const e = new Error('aborted');
            e.name = 'AbortError';
            init?.signal?.addEventListener('abort', () => reject(e));
          }
        }),
    );

    const pending = createDriverClient('did:a').api.me('did:a');
    await vi.advanceTimersByTimeAsync(15_000); // config.timeoutMs
    const r = await pending;

    expect(r.error?.code).toBe('TIMEOUT');
    expect(r.error?.retryable).toBe(true);
  });

  it('refuses a 200 that carries no token rather than sending "Bearer undefined"', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (urlOf(input).endsWith('/v1/auth/token')) return jsonResponse({});
      return jsonResponse({ did: 'x' });
    });

    const r = await createDriverClient('did:a').api.me('did:a');
    expect(r.error?.code).toBe('INTERNAL');
    expect(sessionStorage.getItem(tokenKeyFor('did:a'))).toBeNull();
  });
});

describe('identity vs deployment failures (the destructive sign-out guard)', () => {
  const mintErr = (status: number, code: string): SbgError => ({
    ...toSbgError({ code }, status),
    params: { source: 'mint' },
  });

  it('recognises a mint-sourced error', () => {
    expect(isMintSourced(mintErr(400, 'BAD_REQUEST'))).toBe(true);
    expect(isMintSourced(toSbgError({ code: 'NOT_FOUND' }, 404))).toBe(false);
    expect(isMintSourced(null)).toBe(false);
  });

  it('treats a mint 400 as an unknown identity — the backend rejects a bad DID with 400, not 404', () => {
    // POST /v1/auth/token {role,did} -> mintActorToken -> issueToken({type:'did'}) throws
    // BadRequestException('Unknown DID'). Without this the driver was stranded: BAD_REQUEST has no
    // presentation entry and is not retryable, so no message, no retry, no way back to sign-in.
    expect(isUnknownIdentity(mintErr(400, 'BAD_REQUEST'))).toBe(true);
  });

  it('never treats a mint-sourced 404/401/5xx as an unknown identity', () => {
    // A wrong VITE_SBG_API, a moved proxy path or an HTML 404 page must NOT erase the driver's ID.
    // One misrouted deploy would otherwise sign out every driver in the field.
    expect(isUnknownIdentity(mintErr(404, 'NOT_FOUND'))).toBe(false);
    expect(isUnknownIdentity(mintErr(401, 'UNAUTHORIZED'))).toBe(false);
    expect(isUnknownIdentity(mintErr(500, 'INTERNAL'))).toBe(false);
  });

  it('does not treat an endpoint 404 as a mint failure (that one IS a real missing driver)', () => {
    const fromEndpoint = toSbgError({ code: 'NOT_FOUND' }, 404);
    expect(isUnknownIdentity(fromEndpoint)).toBe(false);
    expect(isMintSourced(fromEndpoint)).toBe(false);
  });
});
