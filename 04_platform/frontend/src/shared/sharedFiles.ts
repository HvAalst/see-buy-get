/**
 * 2026-11-02 — PHOTOS SHARED TO THE APP FROM THE PHONE'S GALLERY, read back where the app's own service worker kept them
 * (scripts/push-sw.js: the share target's POST is answered on the phone, the photos kept untouched in the `sbg-shared-in`
 * cache, the app opened at `?share_files=<name>`). Untouched matters: the date the phone wrote into each photo is read
 * from these bytes (shared/exifDate.ts) before the app makes it smaller.
 *
 * Kept an hour at most, as a shared text waiting for a sign-in is (conversation/sharedInLogic.ts): long enough to sign in
 * and file them, short enough that a photo nobody filed does not stay on the phone.
 */

import type { InstallApp } from './ui/InstallBar';

export const SHARED_CACHE = 'sbg-shared-in';
export const SHARED_KEEP_MS = 60 * 60 * 1000;

export interface SharedPhotoFile {
  blob: Blob;
  name: string;
  type: string;
}

export interface SharedFiles {
  id: string;
  files: SharedPhotoFile[];
  /** The words shared with them, if any — a caption from a messenger. Shown; never sent anywhere by themselves. */
  words?: string;
}

type Caches = Pick<CacheStorage, 'open'>;

function cachesHere(): Caches | undefined {
  try {
    return globalThis.caches;
  } catch {
    return undefined;
  }
}

const inShare = (id: string) => (url: string) => url.includes(`/__shared/${id}/`);

/**
 * The photos kept under this name, or null — never kept, already filed and let go, or older than an hour (and then let
 * go on the way). Each photo exactly as the phone handed it over.
 */
export async function takeSharedFiles(id: string, now = Date.now(), caches: Caches | undefined = cachesHere()): Promise<SharedFiles | null> {
  if (!caches || !/^[a-z0-9]{1,40}$/i.test(id)) return null;
  try {
    const cache = await caches.open(SHARED_CACHE);
    const keys = (await cache.keys()).filter((k) => inShare(id)(k.url));
    const metaKey = keys.find((k) => k.url.endsWith('/meta'));
    const meta = metaKey ? ((await (await cache.match(metaKey))?.json()) as { at?: number; files?: Array<{ key: string; type?: string; name?: string }>; title?: string; text?: string; url?: string } | undefined) : undefined;
    if (!meta || typeof meta.at !== 'number' || now - meta.at > SHARED_KEEP_MS) {
      for (const k of keys) await cache.delete(k);
      return null;
    }
    const files: SharedPhotoFile[] = [];
    for (const f of meta.files ?? []) {
      const res = await cache.match(f.key);
      if (!res) continue;
      const blob = await res.blob();
      files.push({ blob, name: f.name ?? '', type: f.type || blob.type });
    }
    if (!files.length) return null;
    const words = [meta.title, meta.text, meta.url].filter((w): w is string => typeof w === 'string' && Boolean(w.trim())).join('\n');
    return { id, files, ...(words ? { words } : {}) };
  } catch {
    return null;
  }
}

/** Let them go: filed, or put away. Nothing of them stays on the phone. */
export async function forgetSharedFiles(id: string, caches: Caches | undefined = cachesHere()): Promise<void> {
  if (!caches) return;
  try {
    const cache = await caches.open(SHARED_CACHE);
    for (const k of await cache.keys()) if (inShare(id)(k.url)) await cache.delete(k);
  } catch {
    /* the browser clears its caches in its own time */
  }
}

/* --------------------------------------------- waiting for the sign-in -- */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const filesHoldKey = (app: InstallApp) => `sbg.sharedFiles.${app}`;

function session(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Remember which photos wait, through a sign-in or a reload — the photos themselves are already in the cache. */
export function holdFiles(app: InstallApp, id: string, now = Date.now(), store: Store | null = session()): void {
  try {
    store?.setItem(filesHoldKey(app), JSON.stringify({ at: now, id }));
  } catch {
    /* shown now all the same; it just will not outlive the window */
  }
}

/** The name of the photos waiting for this app, if any still young enough. */
export function heldFiles(app: InstallApp, now = Date.now(), store: Store | null = session()): string | null {
  try {
    const raw = store?.getItem(filesHoldKey(app));
    if (!raw) return null;
    const kept = JSON.parse(raw) as { at?: unknown; id?: unknown };
    const ok = typeof kept.at === 'number' && typeof kept.id === 'string' && now - kept.at <= SHARED_KEEP_MS && now - kept.at >= -5 * 60 * 1000;
    if (!ok) store?.removeItem(filesHoldKey(app));
    return ok ? (kept.id as string) : null;
  } catch {
    return null;
  }
}

export function letGoFiles(app: InstallApp, store: Store | null = session()): void {
  try {
    store?.removeItem(filesHoldKey(app));
  } catch {
    /* nothing to let go of */
  }
}
