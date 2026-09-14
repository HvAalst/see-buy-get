import { markOffline, markOnline } from './connectivity';

/**
 * THE READ CACHE — what the app last knew, kept on the phone so a cold start in a dead spot shows the shelf, the
 * loads and the parcels instead of a spinner and an error.
 *
 * The outbox (outbox.ts) is the WRITE half of working without a signal; this is the READ half. Every successful
 * GET from our own API is kept, keyed by who asked and what for; when the same GET cannot reach the network, the
 * kept answer is handed back with a `x-sbg-cached-at` header on it, so the client can say "this is old" and the
 * apps can show it as such. Nothing here is ever served while the network answers — a real reply always wins.
 *
 * Three rules keep it honest:
 *  - **Scoped to the person.** The key carries the token's own subject, so two drivers on one phone never see
 *    each other's cache — the same rule the token slot keeps.
 *  - **Only what fits.** JSON only, 300 KB a reply, and the oldest half goes when the phone's storage is full.
 *    A voice recording or an export is fetched, never kept.
 *  - **Only reads.** A write answered from a cache would be a lie; the outbox has the write story.
 */
const PREFIX = 'sbg.cache.v1:';
export const MAX_ENTRY_CHARS = 300_000;
/** Older than this is not "what we last knew", it is history — served anyway, but the banner says when from. */
export const CACHED_AT_HEADER = 'x-sbg-cached-at';

interface Entry {
  at: string;
  status: number;
  body: string;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Who a token belongs to — the `did` (or `sub`) inside its payload. Anonymous when there is no token. */
export function subjectOf(authorization: string | null | undefined): string {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  const payload = token?.split('.')[1];
  if (!payload) return 'anon';
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { did?: string; sub?: string };
    return json.did || json.sub || 'anon';
  } catch {
    return 'anon';
  }
}

export function cacheKey(subject: string, pathAndQuery: string): string {
  return `${PREFIX}${subject}:${pathAndQuery}`;
}

export function readCached(key: string): Entry | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry;
    return e && typeof e.body === 'string' && typeof e.at === 'string' ? e : null;
  } catch {
    return null;
  }
}

export function writeCached(key: string, entry: Entry): void {
  const s = storage();
  if (!s || entry.body.length > MAX_ENTRY_CHARS) return;
  const raw = JSON.stringify(entry);
  try {
    s.setItem(key, raw);
  } catch {
    // Full. Drop the oldest half of what we keep and try once more; a cache that cannot grow is still a cache.
    evictOldest(s, 0.5);
    try {
      s.setItem(key, raw);
    } catch {
      /* still full — this one is simply not kept */
    }
  }
}

function evictOldest(s: Storage, share: number): void {
  const entries: Array<{ key: string; at: string }> = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    const e = readCached(k);
    entries.push({ key: k, at: e?.at ?? '' });
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  for (const e of entries.slice(0, Math.ceil(entries.length * share))) s.removeItem(e.key);
}

/** Forget everything kept for one person (their sign-out), or for everybody. */
export function clearReadCache(subject?: string): void {
  const s = storage();
  if (!s) return;
  const doomed: string[] = [];
  const head = subject ? `${PREFIX}${subject}:` : PREFIX;
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(head)) doomed.push(k);
  }
  for (const k of doomed) s.removeItem(k);
}

/**
 * Wrap a fetch so that a GET to our own API is remembered when it succeeds and answered from memory when the
 * network cannot be reached. Every outcome also tells the connectivity store what it saw.
 */
export function cachedFetch(base: typeof fetch, apiOrigin: () => string): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const origin = apiOrigin();
    const ours = url.startsWith(origin);
    if (!ours || method !== 'GET') {
      try {
        const res = await base(input, init);
        markOnline();
        return res;
      } catch (err) {
        markOffline();
        throw err;
      }
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const key = cacheKey(subjectOf(headers.get('authorization')), url.slice(origin.length));

    let res: Response;
    try {
      res = await base(input, init);
    } catch (err) {
      markOffline();
      const kept = readCached(key);
      if (!kept) throw err;
      return new Response(kept.body, { status: kept.status, headers: { 'content-type': 'application/json', [CACHED_AT_HEADER]: kept.at } });
    }
    markOnline();
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      // Read from a clone so the caller's stream is untouched; keep it only when it is small enough to be worth it.
      const body = await res.clone().text().catch(() => '');
      if (body && body.length <= MAX_ENTRY_CHARS) writeCached(key, { at: new Date().toISOString(), status: res.status, body });
    }
    return res;
  };
}
