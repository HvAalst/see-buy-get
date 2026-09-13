import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDriverClient, isSignInRequired, purgeDriverTokens, tokenKeyFor } from './api';

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

/* ---------------------------------------------------------- the client -- */

describe('createDriverClient', () => {
  it('sends the token a sign-in seeded, and each driver keeps their own', async () => {
    const auth: (string | null)[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      auth.push((input as Request).headers.get('authorization'));
      return jsonResponse({ did: 'x' });
    });

    const a = createDriverClient('did:a');
    await a.client.seed({ access_token: 'tok:a', expires_in: 3600 });
    await a.api.me('did:a');
    const b = createDriverClient('did:b');
    await b.client.seed({ access_token: 'tok:b', expires_in: 3600 });
    await b.api.me('did:b');

    expect(auth).toEqual(['Bearer tok:a', 'Bearer tok:b']);
    expect(sessionStorage.getItem(tokenKeyFor('did:a'))).toContain('tok:a');
  });

  it('never mints a token by itself — with no sign-in it asks for one, and calls nobody', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      urls.push(urlOf(input));
      return jsonResponse({ access_token: 'minted-by-a-driver-id' });
    });

    const r = await createDriverClient('did:typed-off-a-badge').api.me('did:typed-off-a-badge');

    expect(isSignInRequired(r.error)).toBe(true);
    expect(urls.some((u) => u.endsWith('/v1/auth/token'))).toBe(false);
    expect(urls).toEqual([]);
  });
});
