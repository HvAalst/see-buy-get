/**
 * 2026-11-02 — HOW THE APP WAS OPENED (the owner: "make it as native as today can be"; "it should show up in the share
 * list").
 *
 * An installed app is opened in more ways than its icon: a shortcut from holding the icon (`?go=<screen>`), something
 * shared to it from another app (`?share=1&title=…&text=…&url=…`), a tapped notification. With the manifest's
 * `launch_handler` set to focus the window already open, the browser does not load the page again: it hands the address
 * to `window.launchQueue` instead. Either way it arrives here, once, and is passed to whoever listens — the app's
 * navigation for `go`, the share sheet for `share` — and the address is put back clean, so a reload does not repeat it.
 */
export interface SharedIn {
  title?: string;
  text?: string;
  url?: string;
}

export interface LaunchIntent {
  /** A screen of this app, by its key, from a shortcut. Whether it is one is the app's to say. */
  go?: string;
  /** Text or a link shared to this app from another. */
  share?: SharedIn;
}

const clean = (v: string | null): string | undefined => {
  const s = v?.trim();
  return s ? s.slice(0, 4000) : undefined;
};

/** What an address asks for, or null when it asks for nothing. */
export function intentOf(href: string): LaunchIntent | null {
  let u: URL;
  try {
    u = new URL(href, 'https://app.invalid/');
  } catch {
    return null;
  }
  const p = u.searchParams;
  const go = clean(p.get('go'));
  // The share target's own fields (vite.config.ts): a GET share replaces the address's query with exactly these.
  // `?share=1&title=…&text=…&url=…` is read too, for a link made by hand.
  const marked = p.get('share') === '1';
  const field = (k: 'title' | 'text' | 'url') => clean(p.get(`share_${k}`)) ?? (marked ? clean(p.get(k)) : undefined);
  const share: SharedIn = { title: field('title'), text: field('text'), url: field('url') };
  for (const k of ['title', 'text', 'url'] as const) if (share[k] === undefined) delete share[k];
  const shared = share.title || share.text || share.url ? share : undefined;
  if (!go && !shared) return null;
  return { ...(go ? { go } : {}), ...(shared ? { share: shared } : {}) };
}

/** The address without what it asked for: the app's own address stays as it was. */
export function withoutIntent(href: string): string {
  const u = new URL(href);
  for (const k of ['go', 'share', 'title', 'text', 'url', 'share_title', 'share_text', 'share_url']) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ''}${u.hash}`;
}

/** What each kind of launch carries: a screen's key, or what was shared. */
export interface LaunchKinds {
  go: string;
  share: SharedIn;
}
type Kind = keyof LaunchKinds;
type Listener<K extends Kind> = (value: LaunchKinds[K]) => void;

/**
 * Each kind waits for its own listener (the share helper's catch, 2026-11-02): a share made to a closed app arrives
 * before anybody listens, and must reach the share sheet when it mounts — not whichever listener came first.
 */
const listeners: { [K in Kind]: Set<Listener<K>> } = { go: new Set(), share: new Set() };
const pending: { [K in Kind]: Array<LaunchKinds[K]> } = { go: [], share: [] };
let started = false;

function deliverKind<K extends Kind>(kind: K, value: LaunchKinds[K] | undefined): void {
  if (value === undefined) return;
  const set = listeners[kind] as Set<Listener<K>>;
  // Nobody listening for this kind yet (the app is still signing in): kept for the first who does.
  if (set.size === 0) (pending[kind] as Array<LaunchKinds[K]>).push(value);
  else set.forEach((l) => l(value));
}

function deliver(intent: LaunchIntent | null): void {
  if (!intent) return;
  deliverKind('go', intent.go);
  deliverKind('share', intent.share);
}

/** Read the address the app was opened at, and the launch queue, once per page. */
function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const here = window.location?.href;
  if (here) {
    const intent = intentOf(here);
    if (intent) {
      try {
        window.history.replaceState(window.history.state, '', withoutIntent(here));
      } catch {
        /* an address that cannot be rewritten still opens the right thing */
      }
      deliver(intent);
    }
  }
  const queue = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { targetURL?: string }) => void): void } }).launchQueue;
  queue?.setConsumer((params) => {
    if (params.targetURL && params.targetURL !== here) deliver(intentOf(params.targetURL));
  });
}

/**
 * Listen for one kind of launch: 'go' (a screen's key, from a shortcut) or 'share' (what another app shared).
 * Whatever of that kind came before its first listener is handed to it at once. Returns the way to stop listening.
 */
export function onLaunch<K extends Kind>(kind: K, listener: Listener<K>): () => void {
  start();
  const set = listeners[kind] as Set<Listener<K>>;
  set.add(listener);
  const held = pending[kind] as Array<LaunchKinds[K]>;
  if (held.length) {
    const now = held.splice(0, held.length);
    now.forEach((v) => listener(v));
  }
  return () => void set.delete(listener);
}

/** Tests only: forget every listener and everything waiting, as a fresh page would. */
export function resetLaunchForTests(): void {
  listeners.go.clear();
  listeners.share.clear();
  pending.go.length = 0;
  pending.share.length = 0;
  started = false;
}
