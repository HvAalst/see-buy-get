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
  const share = p.get('share') === '1' ? { title: clean(p.get('title')), text: clean(p.get('text')), url: clean(p.get('url')) } : undefined;
  const shared = share && (share.title || share.text || share.url) ? share : undefined;
  if (!go && !shared) return null;
  return { ...(go ? { go } : {}), ...(shared ? { share: shared } : {}) };
}

/** The address without what it asked for: the app's own address stays as it was. */
export function withoutIntent(href: string): string {
  const u = new URL(href);
  for (const k of ['go', 'share', 'title', 'text', 'url']) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ''}${u.hash}`;
}

type Listener = (intent: LaunchIntent) => void;
const listeners = new Set<Listener>();
let pending: LaunchIntent[] = [];
let started = false;

function deliver(intent: LaunchIntent | null): void {
  if (!intent) return;
  if (listeners.size === 0) {
    // Nobody listening yet (the app is still signing in): kept for the first who does.
    pending.push(intent);
    return;
  }
  listeners.forEach((l) => l(intent));
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
 * Listen for what the app is opened for. Anything that came before the first listener is handed to it at once. Returns
 * the way to stop listening.
 */
export function onLaunch(listener: Listener): () => void {
  start();
  listeners.add(listener);
  if (pending.length) {
    const held = pending;
    pending = [];
    held.forEach((i) => listener(i));
  }
  return () => void listeners.delete(listener);
}
