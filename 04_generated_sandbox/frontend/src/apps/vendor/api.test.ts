import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSignInRequired } from '../../lib/sbg';
import { clearCreds, createVendorClient, readCreds, readEmail, saveCreds, saveEmail } from './api';

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

/** Everything this device holds, in both stores, as one string to look through. */
const everything = () => {
  const all: Record<string, string | null> = {};
  for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) all[s.key(i)!] = s.getItem(s.key(i)!);
  return JSON.stringify(all);
};

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = mockStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * WHAT A STORE'S DEVICE KEEPS. The console used to keep the store ID and the SIGNING SECRET and sign itself back in
 * with them, so the secret that signs a store's callbacks sat readable in every browser the store had been opened
 * in. It now keeps which store it is and the address to fill in next time — and nothing that opens anything.
 */
describe('what the Store app keeps on a device', () => {
  it('which store, and the email for next time', () => {
    expect(readCreds()).toBeNull();
    saveCreds('ven_abc');
    saveEmail('orders@duka.example');
    expect(readCreds()).toEqual({ vendorId: 'ven_abc' });
    expect(readEmail()).toBe('orders@duka.example');
  });

  it('signing out forgets the store and keeps the address, as the Shop app does', () => {
    saveCreds('ven_abc');
    saveEmail('orders@duka.example');
    clearCreds();
    expect(readCreds()).toBeNull();
    expect(readEmail()).toBe('orders@duka.example');
  });

  it('takes a secret an older version left behind off the device the first time the app opens', () => {
    localStorage.setItem('glos-vendor-id', 'ven_old');
    localStorage.setItem('glos-vendor-secret', 'whsec_left_here_by_an_older_version');
    expect(readCreds()).toEqual({ vendorId: 'ven_old' });
    expect(localStorage.getItem('glos-vendor-secret')).toBeNull();
    expect(everything()).not.toContain('whsec_');
  });

  it('…also when that device remembers no store at all', () => {
    localStorage.setItem('glos-vendor-secret', 'whsec_orphan');
    expect(readCreds()).toBeNull();
    expect(everything()).not.toContain('whsec_');
  });
});

describe('createVendorClient', () => {
  it('sends the token a sign-in seeded, and each store keeps its own', async () => {
    const auth: (string | null)[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      auth.push((input as Request).headers.get('authorization'));
      return jsonResponse({ vendorId: 'x' });
    });

    const a = createVendorClient('ven_a');
    await a.client.seed({ access_token: 'tok:a', expires_in: 3600 });
    await a.api.me('ven_a');
    const b = createVendorClient('ven_b');
    await b.client.seed({ access_token: 'tok:b', expires_in: 3600 });
    await b.api.me('ven_b');

    expect(auth).toEqual(['Bearer tok:a', 'Bearer tok:b']);
  });

  it('never signs a store in by itself — with no sign-in it asks for one, and calls nobody', async () => {
    // A device that knows which store it was (and, from an older version, even its secret) signs nobody in.
    localStorage.setItem('glos-vendor-id', 'ven_old');
    localStorage.setItem('glos-vendor-secret', 'whsec_left_here_by_an_older_version');
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      urls.push(urlOf(input));
      return jsonResponse({ token: { access_token: 'signed-in-by-a-stored-secret' } });
    });

    const stored = readCreds()!;
    const r = await createVendorClient(stored.vendorId).api.me(stored.vendorId);

    expect(isSignInRequired(r.error)).toBe(true);
    expect(urls).toEqual([]);
  });

  it('when the server ends the sign-in, asks for a new one and does not try the old door', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      urls.push(urlOf(input));
      return jsonResponse({ code: 'UNAUTHORIZED', status: 401, title: 'Unauthorized', detail: 'Token revoked' }, 401);
    });

    const c = createVendorClient('ven_a');
    await c.client.seed({ access_token: 'tok:a', expires_in: 3600 });
    const r = await c.api.me('ven_a');

    expect(isSignInRequired(r.error)).toBe(true);
    expect(urls.some((u) => u.includes('/vendors/login') || u.includes('/vendors/session') || u.endsWith('/v1/auth/token'))).toBe(false);
  });
});
