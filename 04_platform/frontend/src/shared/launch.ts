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
  /**
   * 2026-11-02 — PHOTOS shared to this app from the phone's gallery: the name they wait under on this phone (the service
   * worker received them — scripts/push-sw.js — and kept them in the app's cache, shared/sharedFiles.ts), or SHARE_LOST
   * when what was shared never reached the app. Filed to a load or parcel, never sent loose (the owner, 2026-11-02).
   */
  files?: string;
  /**
   * 2026-11-02 — WHAT A NOTICE POINTS AT (the owner: "on the notifications on the start screen I need a 'mark as read'
   * or 'respond' button"): a chat (`?chat=<conversation>`), a parcel (`?parcel=<id>`, the Send app's), an offer of a load
   * (`?offer=<id>`, the Driver app's). A tapped notification opens the app at its link; the bell's Reply or Open hands
   * the same link over inside the page (`followLink`), so both land in the same place.
   */
  chat?: string;
  parcel?: string;
  offer?: string;
  /**
   * 2026-11-02 — A LOAD, told to whoever posted it (the owner: "wire it in"): `?load=<freightId>&about=<part>`, the same
   * link for a shop, a store and a business — each opens that load where it reads its loads.
   */
  load?: LoadAsked;
}

/** The part of a load a notice is about, where plain (backend notification.types.ts, loadLink). None: where the answer waits. */
export type LoadAbout = 'road' | 'seals' | 'claim';
const LOAD_ABOUT: readonly LoadAbout[] = ['road', 'seals', 'claim'];

/** A load a notice names, and what part of it the notice is about. */
export interface LoadAsked {
  id: string;
  about?: LoadAbout;
}

/** What `share_files` says when the share reached the server instead of the app's own worker, or could not be read. */
export const SHARE_LOST = 'lost';

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
  // A name the worker made (letters and digits), or SHARE_LOST — nothing else is a place photos wait. The share target's
  // own address with nothing after it is a share that arrived without what was shared (an open app handed the address,
  // not the photos): said, rather than nothing happening.
  const named = p.get('share_files')?.trim();
  const files = named && /^[a-z0-9]{1,40}$/i.test(named) ? named : /\/share-target\/?$/.test(u.pathname) ? SHARE_LOST : undefined;
  // What a notice points at: a record's own id, and nothing a hand-made address could slip past it.
  const id = (k: 'chat' | 'parcel' | 'offer' | 'load') => {
    const v = p.get(k)?.trim();
    return v && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v) ? v : undefined;
  };
  const chat = id('chat');
  const parcel = id('parcel');
  const offer = id('offer');
  const loadId = id('load');
  // A part not one of the load's own is no part: the load opens where its answer waits.
  const about = LOAD_ABOUT.find((a) => a === p.get('about'));
  const load: LoadAsked | undefined = loadId ? { id: loadId, ...(about ? { about } : {}) } : undefined;
  if (!go && !shared && !files && !chat && !parcel && !offer && !load) return null;
  return {
    ...(go ? { go } : {}),
    ...(shared ? { share: shared } : {}),
    ...(files ? { files } : {}),
    ...(chat ? { chat } : {}),
    ...(parcel ? { parcel } : {}),
    ...(offer ? { offer } : {}),
    ...(load ? { load } : {}),
  };
}

/** The address without what it asked for: the app's own address stays as it was. */
export function withoutIntent(href: string): string {
  const u = new URL(href);
  // `about` is a load's part only beside a load: the front page's contact form reads an `about` of its own.
  if (u.searchParams.has('load')) u.searchParams.delete('about');
  for (const k of ['go', 'share', 'title', 'text', 'url', 'share_title', 'share_text', 'share_url', 'share_files', 'chat', 'parcel', 'offer', 'load']) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ''}${u.hash}`;
}

/** What each kind of launch carries: a screen's key, what was shared, where shared photos wait, or what a notice points at. */
export interface LaunchKinds {
  go: string;
  share: SharedIn;
  files: string;
  chat: string;
  parcel: string;
  offer: string;
  load: LoadAsked;
}
type Kind = keyof LaunchKinds;
type Listener<K extends Kind> = (value: LaunchKinds[K]) => void;

/**
 * Each kind waits for its own listener (the share helper's catch, 2026-11-02): a share made to a closed app arrives
 * before anybody listens, and must reach the share sheet when it mounts — not whichever listener came first.
 */
const listeners: { [K in Kind]: Set<Listener<K>> } = { go: new Set(), share: new Set(), files: new Set(), chat: new Set(), parcel: new Set(), offer: new Set(), load: new Set() };
const pending: { [K in Kind]: Array<LaunchKinds[K]> } = { go: [], share: [], files: [], chat: [], parcel: [], offer: [], load: [] };
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
  deliverKind('files', intent.files);
  deliverKind('chat', intent.chat);
  deliverKind('parcel', intent.parcel);
  deliverKind('offer', intent.offer);
  deliverKind('load', intent.load);
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

/**
 * 2026-11-02 — WHAT A NOTICE'S LINK CAN LEAD TO INSIDE THE APP: a chat, a parcel, an offer, a load, a screen — never a
 * share or photos, which only another app hands over. A chat first: a message notice is answered there.
 */
const LINK_KINDS = ['chat', 'parcel', 'offer', 'load', 'go'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * Where a notice's link leads in THIS app: the kind of place it names, when something here opens that kind — or null.
 * Null for a link to the app's home ('/', where the bell already is), to a page outside the app, or to a kind of place
 * this app does not have (a parcel's link in the Shop app): nothing is offered that would go nowhere.
 */
export function linkLeadsTo(link: string | undefined): LinkKind | null {
  if (!link) return null;
  const intent = intentOf(link);
  if (!intent) return null;
  return LINK_KINDS.find((k) => intent[k] !== undefined && listeners[k].size > 0) ?? null;
}

/**
 * Follow a notice's link inside the page, as a tapped notification arrives (scripts/push-sw.js opens the app at the same
 * link): handed to whoever opens that kind of place here, with no page loaded again. False when it leads nowhere here.
 */
export function followLink(link: string | undefined): boolean {
  const kind = linkLeadsTo(link);
  const value = kind ? intentOf(link!)?.[kind] : undefined;
  if (!kind || value === undefined) return false;
  deliverKind<LinkKind>(kind, value);
  return true;
}

/** Tests only: forget every listener and everything waiting, as a fresh page would. */
export function resetLaunchForTests(): void {
  for (const k of Object.keys(listeners) as Kind[]) {
    listeners[k].clear();
    pending[k].length = 0;
  }
  started = false;
}
