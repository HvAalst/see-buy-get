import { beforeEach, describe, expect, it } from 'vitest';
import { CACHED_AT_HEADER, MAX_ENTRY_CHARS, cacheKey, cachedFetch, clearReadCache, readCached, subjectOf, writeCached } from './readcache';
import { connectivity, isOfflineNow, resetConnectivity } from './connectivity';

/**
 * The read half of working without a signal: what a screen last loaded is kept on the phone and handed back when
 * the network cannot be reached — for the person who loaded it, and only for reads.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (store.size >= 6 && !store.has(k)) throw new Error('QuotaExceededError'); // a small phone
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
});

const ORIGIN = 'https://api.test';
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
const tokenFor = (did: string) => `h.${b64({ did, sub: did })}.sig`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const offline = async () => {
  throw new TypeError('Failed to fetch');
};

describe('the read cache', () => {
  beforeEach(() => {
    store.clear();
    resetConnectivity();
  });

  it('names the person a token belongs to, and nobody when there is none', () => {
    expect(subjectOf(`Bearer ${tokenFor('did:a')}`)).toBe('did:a');
    expect(subjectOf(undefined)).toBe('anon');
    expect(subjectOf('Bearer not-a-token')).toBe('anon');
  });

  it('answers a GET from what it last knew when the network is gone, and says when from', async () => {
    let network: typeof fetch = async () => json({ shelf: ['a', 'b'] });
    const f = cachedFetch((...a) => network(...a), () => ORIGIN);
    const headers = { authorization: `Bearer ${tokenFor('did:shop')}` };

    const live = await f(`${ORIGIN}/v1/sbg/parcels?agent=x`, { method: 'GET', headers });
    expect(await live.json()).toEqual({ shelf: ['a', 'b'] });
    expect(live.headers.get(CACHED_AT_HEADER)).toBeNull();
    expect(connectivity().online).toBe(true);

    network = offline;
    const kept = await f(`${ORIGIN}/v1/sbg/parcels?agent=x`, { method: 'GET', headers });
    expect(await kept.json()).toEqual({ shelf: ['a', 'b'] });
    expect(kept.headers.get(CACHED_AT_HEADER)).toMatch(/^\d{4}-/);
    expect(isOfflineNow()).toBe(true);
    expect(connectivity().online).toBe(false);
  });

  it('keeps one person’s answers away from another on the same phone', async () => {
    let network: typeof fetch = async () => json({ mine: true });
    const f = cachedFetch((...a) => network(...a), () => ORIGIN);
    await f(`${ORIGIN}/v1/sbg/identity/parcels`, { method: 'GET', headers: { authorization: `Bearer ${tokenFor('did:amina')}` } });
    network = offline;
    await expect(f(`${ORIGIN}/v1/sbg/identity/parcels`, { method: 'GET', headers: { authorization: `Bearer ${tokenFor('did:brian')}` } })).rejects.toThrow('Failed to fetch');
  });

  it('never answers a write from memory, and never keeps an error, another origin, or a giant', async () => {
    let network: typeof fetch = async () => json({ code: 'NOT_FOUND' }, 404);
    const f = cachedFetch((...a) => network(...a), () => ORIGIN);
    await f(`${ORIGIN}/v1/sbg/parcels/x`, { method: 'GET' });
    network = async () => new Response('x'.repeat(MAX_ENTRY_CHARS + 1), { status: 200, headers: { 'content-type': 'application/json' } });
    await f(`${ORIGIN}/v1/sbg/big`, { method: 'GET' });
    network = async () => json({ ok: true });
    await f('https://elsewhere.test/v1/thing', { method: 'GET' });
    await f(`${ORIGIN}/v1/sbg/parcels/accept`, { method: 'POST', body: '{}' });
    expect(store.size).toBe(0);

    network = offline;
    await expect(f(`${ORIGIN}/v1/sbg/parcels/accept`, { method: 'POST', body: '{}' })).rejects.toThrow();
    await expect(f(`${ORIGIN}/v1/sbg/parcels/x`, { method: 'GET' })).rejects.toThrow();
  });

  it('makes room by forgetting the oldest half when the phone is full', () => {
    for (let i = 0; i < 6; i++) writeCached(cacheKey('anon', `/v1/old/${i}`), { at: `2026-09-1${i}T00:00:00Z`, status: 200, body: '{}' });
    writeCached(cacheKey('anon', '/v1/new'), { at: '2026-09-20T00:00:00Z', status: 200, body: '{}' });
    expect(readCached(cacheKey('anon', '/v1/new'))).not.toBeNull();
    expect(readCached(cacheKey('anon', '/v1/old/0'))).toBeNull();
    expect(readCached(cacheKey('anon', '/v1/old/5'))).not.toBeNull();
  });

  it('forgets one person on their sign-out and leaves the others', () => {
    writeCached(cacheKey('did:a', '/v1/x'), { at: '2026-09-13T00:00:00Z', status: 200, body: '{}' });
    writeCached(cacheKey('did:b', '/v1/x'), { at: '2026-09-13T00:00:00Z', status: 200, body: '{}' });
    clearReadCache('did:a');
    expect(readCached(cacheKey('did:a', '/v1/x'))).toBeNull();
    expect(readCached(cacheKey('did:b', '/v1/x'))).not.toBeNull();
  });
});
