import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMintedClient,
  createSeededClient,
  isMintSourced,
  isSignInRequired,
  isUnknownIdentity,
  preferMintFailure,
  publicRequest,
  purgeTokens,
  tokenKeyFor,
} from './appclient';
import { makeConfig } from './config';
import type { SbgError } from './errors';

const cfg = (timeoutMs = 1000) => makeConfig('test', '0.0.0', { baseUrl: 'http://sbg.test', timeoutMs });

const err = (over: Partial<SbgError>): SbgError => ({
  code: 'NETWORK',
  status: 0,
  title: 't',
  detail: 'd',
  retryable: true,
  ...over,
});

/** Minimal Storage shim — node has no sessionStorage and purge must walk keys by index. */
class StorageShim {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('purgeTokens', () => {
  beforeEach(() => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = new StorageShim();
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it('drops every token under the prefix except the keeper, and nothing else', () => {
    const store = globalThis.sessionStorage!;
    store.setItem(tokenKeyFor('sbg:agent:', 'did:a'), 'ta');
    store.setItem(tokenKeyFor('sbg:agent:', 'did:b'), 'tb');
    store.setItem('sbg:driver:did:c', 'tc');
    store.setItem('unrelated', 'x');

    purgeTokens('sbg:agent:', 'did:b');

    expect(store.getItem('sbg:agent:did:a')).toBeNull();
    expect(store.getItem('sbg:agent:did:b')).toBe('tb');
    expect(store.getItem('sbg:driver:did:c')).toBe('tc');
    expect(store.getItem('unrelated')).toBe('x');
  });

  it('null keeper drops the whole namespace', () => {
    const store = globalThis.sessionStorage!;
    store.setItem('sbg:agent:did:a', 'ta');
    store.setItem('sbg:agent:did:b', 'tb');
    purgeTokens('sbg:agent:', null);
    expect(store.length).toBe(0);
  });
});

describe('preferMintFailure', () => {
  const mint = err({ code: 'PAYMENT_REQUIRED', status: 402, params: { source: 'mint' } });

  it('replaces only the client-synthesised cover stories', () => {
    expect(preferMintFailure(err({ code: 'NETWORK' }), mint)).toBe(mint);
    expect(preferMintFailure(err({ code: 'TIMEOUT' }), mint)).toBe(mint);
  });

  it('never overwrites a real endpoint answer', () => {
    const real = err({ code: 'CONFLICT', status: 409 });
    expect(preferMintFailure(real, mint)).toBe(real);
  });

  it('passes through when the mint recorded nothing', () => {
    const observed = err({ code: 'NETWORK' });
    expect(preferMintFailure(observed, null)).toBe(observed);
  });
});

describe('mint-sourced classification', () => {
  it('isUnknownIdentity requires a mint-sourced 400', () => {
    expect(isUnknownIdentity(err({ code: 'BAD_REQUEST', status: 400, params: { source: 'mint' } }))).toBe(true);
    // The endpoint's own 400 is not an identity verdict.
    expect(isUnknownIdentity(err({ code: 'BAD_REQUEST', status: 400 }))).toBe(false);
    // A mint-sourced 404 is a misrouted deploy, not a deleted identity.
    expect(isUnknownIdentity(err({ code: 'NOT_FOUND', status: 404, params: { source: 'mint' } }))).toBe(false);
  });

  it('isSignInRequired matches the seeded-session expiry signal only when mint-sourced', () => {
    expect(isSignInRequired(err({ code: 'UNAUTHORIZED', status: 401, params: { source: 'mint' } }))).toBe(true);
    expect(isSignInRequired(err({ code: 'UNAUTHORIZED', status: 401 }))).toBe(false);
    expect(isMintSourced(err({ params: { source: 'mint' } }))).toBe(true);
  });
});

describe('publicRequest', () => {
  it('resolves data on 200', async () => {
    const r = await publicRequest<{ ok: boolean }>(cfg(), '/v1/sbg/auth/login', {
      body: { email: 'a@b.c', password: 'x' },
      fetch: async (input, init) => {
        expect(String(input)).toBe('http://sbg.test/v1/sbg/auth/login');
        expect(init?.method).toBe('POST');
        return json({ ok: true });
      },
    });
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ ok: true });
  });

  it('maps problem+json onto the typed error', async () => {
    const r = await publicRequest(cfg(), '/v1/sbg/auth/login', {
      body: {},
      fetch: async () => json({ code: 'AUTH_FAILED', title: 'Wrong email or password' }, 401),
    });
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('AUTH_FAILED');
    expect(r.status).toBe(401);
  });

  it('a hung socket resolves TIMEOUT, not a hang', async () => {
    const r = await publicRequest(cfg(20), '/v1/sbg/auth/login', {
      body: {},
      fetch: (_i, init) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    });
    expect(r.error?.code).toBe('TIMEOUT');
  });

  it('a refused connection resolves NETWORK', async () => {
    const r = await publicRequest(cfg(), '/x', {
      fetch: async () => {
        throw new Error('Failed to fetch');
      },
    });
    expect(r.error?.code).toBe('NETWORK');
  });
});

describe('createSeededClient', () => {
  it('sends the seeded token, and reports sign-in-required once it cannot re-mint', async () => {
    const seen: string[] = [];
    const client = createSeededClient(cfg(), 'sbg:test:did:a', {
      fetch: async (input, init) => {
        const headers = new Headers((init as RequestInit | undefined)?.headers ?? (input as Request).headers);
        seen.push(headers.get('authorization') ?? '');
        return json([]);
      },
    });

    await client.seed({ access_token: 'tok-1', expires_in: 3600 });
    const ok = await client.sbg.request((c) => c.GET('/v1/sbg/agents', {}));
    expect(ok.error).toBeNull();
    expect(seen[0]).toBe('Bearer tok-1');

    // The shift token dies and there is no password on the device to re-mint with.
    client.session.clear();
    const dead = await client.sbg.request((c) => c.GET('/v1/sbg/agents', {}));
    expect(dead.error?.code).toBe('UNAUTHORIZED');
    expect(isSignInRequired(dead.error)).toBe(true);
  });
});

describe('createMintedClient', () => {
  it('mints once, then calls the endpoint with the bearer', async () => {
    const calls: string[] = [];
    const client = createMintedClient(cfg(), 'fleet_manager', 'did:m', 'sbg:fleet:did:m', {
      tenant: 'did:m',
      fetch: async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url);
        if (url.endsWith('/v1/auth/token')) {
          expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ role: 'fleet_manager', did: 'did:m', tenant: 'did:m' });
          return json({ access_token: 'minted-1', expires_in: 3600 });
        }
        const headers = new Headers((init as RequestInit | undefined)?.headers ?? (input as Request).headers);
        expect(headers.get('authorization')).toBe('Bearer minted-1');
        return json([]);
      },
    });

    const r = await client.sbg.request((c) => c.GET('/v1/sbg/agents', {}));
    expect(r.error).toBeNull();
    expect(calls[0]).toContain('/v1/auth/token');
  });

  it('a mint rejection keeps its status and problem body — never "no signal"', async () => {
    const client = createMintedClient(cfg(), 'fleet_manager', 'did:x', 'sbg:fleet:did:x', {
      fetch: async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/v1/auth/token')) return json({ code: 'BAD_REQUEST', detail: 'Unknown DID' }, 400);
        throw new Error('endpoint must not be reached without a token');
      },
    });

    const r = await client.sbg.request((c) => c.GET('/v1/sbg/agents', {}));
    expect(r.error?.code).toBe('BAD_REQUEST');
    expect(r.status).toBe(400);
    expect(isUnknownIdentity(r.error)).toBe(true);
  });
});
