import type { SavedRoute } from './types';

/**
 * Persistence for the two things that must survive a cold start.
 *
 * The legacy page read the driver's identity from `?driver=<did>` on every render, which is
 * fine for a link out of a sign-in page and fatal for an installed PWA: a home-screen launch
 * opens `start_url` with no query string, so the app dead-ended on "Open this app with
 * ?driver=…" forever. The DID is therefore captured from the URL once and kept.
 *
 * Every accessor is try/catch-wrapped: private mode, a locked-down WebView, and a full quota
 * all throw on plain `localStorage` access, and none of them should take the app down.
 */

const DID_KEY = 'glos-driver-did';

function get(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable — the session simply will not survive a cold start */
  }
}

function drop(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* no-op */
  }
}

export function readDid(): string | null {
  return get(DID_KEY);
}

export function saveDid(did: string): void {
  set(DID_KEY, did);
}

export function clearDid(): void {
  drop(DID_KEY);
}

/**
 * Take the DID from `?driver=` when a sign-in page hands us one, persist it, and strip it
 * back out of the address bar so the identity is never sitting in a shared/bookmarked URL.
 */
export function adoptDidFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  const fromUrl = new URLSearchParams(location.search).get('driver');
  if (!fromUrl) return readDid();
  saveDid(fromUrl);
  try {
    const url = new URL(location.href);
    url.searchParams.delete('driver');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* no-op */
  }
  return fromUrl;
}

/* ----------------------------------------------------------------- route -- */

/** Namespaced per DID — two drivers sharing a phone must not inherit each other's route. */
const routeKey = (did: string) => `glos-driver-route:${did}`;

export function savedRoute(did: string): SavedRoute | null {
  try {
    return JSON.parse(get(routeKey(did)) || 'null') as SavedRoute | null;
  } catch {
    return null;
  }
}

/**
 * Coordinates are stored alongside the labels deliberately: "repeat my route" then needs no
 * node list at all, so it skips both /mdps and /agents and goes straight to suggest-work —
 * two fewer round trips on the screen a driver taps most often.
 */
export function saveRoute(did: string, route: SavedRoute): void {
  try {
    set(routeKey(did), JSON.stringify(route));
  } catch {
    /* no-op */
  }
}
