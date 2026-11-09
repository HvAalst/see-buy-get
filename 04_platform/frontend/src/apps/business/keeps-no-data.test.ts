import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 2026-11-02 — THE BUSINESS APP INSTALLS, AND STILL KEEPS NO COPY OF ITS DATA (the owner: "can the business app also get
 * the sticky 'install this app, how'"). It shows papers and containers somebody is about to act on, and a cached copy
 * would be a copy that lies (vite.config.ts, its `business` entry). What keeps that true, held here:
 *
 * - its page turns the read cache off before anything is asked, and then a read the network cannot answer is NOT
 *   answered from the phone — while the same read in any other app still is;
 * - its service worker keeps only the app: the build's one runtime cache is the front page's, and the handler it imports
 *   (scripts/push-sw.js) answers no read at all — only the POST another app shares photos with, to an app whose manifest
 *   asks for shares, which the Business app's does not — and the one cache it opens is for those photos.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
});

const ORIGIN = 'https://api.test';
const URL_ = `${ORIGIN}/v1/sbg/business/e1/loads`;
const ok = async () => new Response(JSON.stringify({ items: [{ code: 'FRT-1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

/** A fresh copy of the read cache, as a page that has just loaded has. */
async function freshCache() {
  vi.resetModules();
  return import('../../shared/readcache');
}

describe('a read the network cannot answer', () => {
  beforeEach(() => store.clear());

  it('is answered from the phone in an app that keeps its reads — the cache is there to be turned off', async () => {
    const { cachedFetch, keepsReads, CACHED_AT_HEADER } = await freshCache();
    expect(keepsReads()).toBe(true);
    await cachedFetch(ok, () => ORIGIN)(URL_);
    expect(store.size).toBe(1);
    const res = await cachedFetch(offline, () => ORIGIN)(URL_);
    expect(res.headers.get(CACHED_AT_HEADER)).toBeTruthy();
  });

  it('is never answered from the phone in the Business app, and nothing of it is kept', async () => {
    const { cachedFetch, keepNoReads, keepsReads } = await freshCache();
    keepNoReads();
    expect(keepsReads()).toBe(false);
    const live = await cachedFetch(ok, () => ORIGIN)(URL_);
    expect(live.status).toBe(200);
    expect(store.size).toBe(0);
    // Even with an answer on the phone from another app's page, the business's page does not hand it back.
    store.set('sbg.cache.v1:anon:/v1/sbg/business/e1/loads', JSON.stringify({ at: '2026-11-01T09:00:00Z', status: 200, body: '{"items":[]}' }));
    await expect(cachedFetch(offline, () => ORIGIN)(URL_)).rejects.toThrow('Failed to fetch');
  });

  it('the Business app turns it off before it draws anything', () => {
    const main = readFileSync('src/apps/business/main.tsx', 'utf8');
    const off = main.indexOf('keepNoReads();');
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(main.indexOf('render(<App />'));
  });
});

describe('what its service worker keeps', () => {
  it('the app and nothing else: what it keeps once fetched is the camera reader’s code; every other runtime cache is the front page’s; the push handler answers no read', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    const caches = [...config.matchAll(/runtimeCaching:/g)];
    expect(caches.length).toBe(1);
    const at = caches[0].index ?? 0;
    const block = config.slice(at, config.indexOf('navigateFallback:', at));
    // 2026-11-09 — every app keeps one thing once fetched: the camera reader for a phone without one (zxingDetector) —
    // code, never a read, never data.
    const everyApp = block.slice(0, block.indexOf('...(IS_ROOT'));
    expect([...everyApp.matchAll(/urlPattern:/g)]).toHaveLength(1);
    expect(everyApp).toMatch(/\/\\\/assets\\\/zxingDetector-\[\\w-\]\+\\\.js\$\//);
    expect(everyApp).not.toMatch(/v1|navigate/);
    // …and the rest inside the front page's own branch, and that front page is not the Business app.
    expect(block).toMatch(/\.\.\.\(IS_ROOT\s*\?\s*\[/);
    expect(block.slice(block.indexOf('...(IS_ROOT'))).toMatch(/request\.mode === 'navigate'/);
    expect(config).toMatch(/const IS_ROOT = BASE === '\/'/);
    expect(config).toMatch(/business: \{\s*base: '\/business\/'/);
    // The handler it imports: a notification, a window, and a share's photos — never a read answered, never data kept.
    expect(config).toMatch(/importScripts: \['push-sw\.js'\]/);
    const push = readFileSync('scripts/push-sw.js', 'utf8');
    expect(push).toMatch(/addEventListener\('push'/);
    const fetches = [...push.matchAll(/addEventListener\(\s*['"]fetch['"]/g)];
    expect(fetches.length).toBe(1);
    const handler = push.slice(fetches[0].index ?? 0, (fetches[0].index ?? 0) + 600);
    expect(handler).toMatch(/if \(req\.method !== 'POST'\) return;/);
    expect(handler).toMatch(/url\.pathname !== scope\.pathname \+ SHARE_ACTION\) return;/);
    expect([...push.matchAll(/caches\.open\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['SHARED_CACHE']);
    // …and the Business app asks the phone for no shares, so that POST never comes to it (src/shared/manifest.test.ts).
  });
});
