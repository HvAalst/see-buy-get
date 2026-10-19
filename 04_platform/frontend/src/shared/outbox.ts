/**
 * THE OUTBOX — the handover that happens whether or not there is a signal.
 *
 * Everything in this network reduces to one event: did this parcel move from A's hands to B's, and can
 * both prove it. Until now that event needed connectivity. The apps showed "No signal — showing what we
 * last knew" and a scan simply failed, which is a reasonable answer for a page that is only reading and
 * an unreasonable one for the act the whole custody chain is built on. A shopkeeper in a dead spot and a
 * driver on the road between two towns are not edge cases here; they are the normal operating condition.
 *
 * So a queued write is COMPLETE from the person's point of view — they scanned it, it is recorded, they
 * can hand the box over — and settles with the server later. Three things make that honest rather than
 * merely optimistic:
 *
 *  - **The attempt is NAMED BEFORE IT IS FIRST SENT.** The failure we most fear is not "it did not go
 *    through", it is "it went through and the answer never came back". A key minted at enqueue time would
 *    not cover that case, because by then the server may already have done the work. So every queueable
 *    write carries an `Idempotency-Key` from its very first attempt, and every retry reuses it.
 *  - **Only the custody events queue.** Signing in, topping up and paying need an answer from the server
 *    to be worth anything; queueing them would be a promise this file cannot keep. The allowlist below is
 *    a policy, and it is short on purpose.
 *  - **It is FIFO and it stops at the first stuck item.** Shelving a parcel the server has not been told
 *    arrived would fail in a way nobody could read. Order is part of the meaning.
 */

import { forgetHeld, heldPhoto, heldRefsIn, withRefs } from './heldPhotos';

/** Where the queue lives. Versioned: a shape change must not try to replay yesterday's records. */
const STORE_KEY = 'sbg.outbox.v1';

/** How many times a single item is retried before it stops asking and waits for a person. */
export const MAX_ATTEMPTS = 8;

export type OutboxState = 'pending' | 'sending' | 'blocked';

export interface OutboxItem {
  id: string;
  /** The `Idempotency-Key` this attempt was named with, minted BEFORE the first send and never changed. */
  key: string;
  method: string;
  /** Origin-relative, so a queue survives the API base moving. */
  path: string;
  body?: unknown;
  /** What a person should see in a list of unsent work — never an id, never a URL. */
  label: string;
  at: string;
  attempts: number;
  state: OutboxState;
  /** Why it is stuck, in the server's own words, once it has stopped trying. */
  error?: string;
  /** Who did it, on a phone several people sign in on — sent only under their own sign-in (`setOutboxActor`). */
  by?: OutboxActor;
}

/**
 * WHO IS SIGNED IN ON THIS PHONE, for a phone several people use: a shop's counter, where the owner and the people they
 * added each sign in as themselves (the user, 2026-10-18: "who is at the counter"). Every write queued here is stamped
 * with who made it, and goes only under that same sign-in — never under whoever happens to be signed in when the signal
 * comes back, which would put one person's act under another's name (or, before, under another SHOP's).
 *
 * The queue stays in order: it stops at the first act that is somebody else's, as it stops at a stuck one, because a
 * parcel shelved by the owner after Wanjiru took it in cannot reach the server before her take-in does. Whoever is signed
 * in is told whose acts are waiting, and may send them under their own name — recorded as theirs, by their choice.
 *
 * An app that never says who is signed in (one person to a phone) stamps nothing and sends everything, as before.
 */
export interface OutboxActor {
  key: string;
  name: string;
}

let actor: OutboxActor | null = null;

export function setOutboxActor(next: OutboxActor | null): void {
  if (actor?.key === next?.key && actor?.name === next?.name) return;
  actor = next;
  announce();
}

export function outboxActor(): OutboxActor | null {
  return actor;
}

/** Whether this queued write may go under the sign-in there is now: one stamped by nobody, or by whoever is signed in. */
export function goesNow(item: Pick<OutboxItem, 'by'>): boolean {
  return !item.by || item.by.key === actor?.key;
}

/**
 * The acts made here by somebody else, still waiting, in order and by who made them — what the outbox note shows.
 */
export function waitingForOthers(): Array<{ by: OutboxActor; items: OutboxItem[] }> {
  const out: Array<{ by: OutboxActor; items: OutboxItem[] }> = [];
  for (const item of read()) {
    if (item.state === 'blocked' || goesNow(item) || !item.by) continue;
    const group = out.find((g) => g.by.key === item.by!.key);
    if (group) group.items.push(item);
    else out.push({ by: item.by, items: [item] });
  }
  return out;
}

/** Send somebody else's waiting acts under the sign-in there is now: they are recorded as that person's, by their choice. */
export function sendAsMine(fromKey: string): void {
  if (!actor) return;
  const mine = actor;
  write(read().map((i) => (i.by?.key === fromKey && i.state !== 'blocked' ? { ...i, by: mine } : i)));
  announce();
  // Now, not on the next tick: the person who chose this is looking at the note.
  if (loop) void drain(loop);
}

/**
 * The writes that may be completed without a server.
 *
 * Every one of them is a CUSTODY event — a statement about where a physical thing is, which the person
 * making it can see with their own eyes and does not need us to confirm. Nothing that moves money on its
 * own, nothing that grants access, and nothing whose answer the person is waiting to read.
 */
const QUEUEABLE: Array<{ method: string; test: RegExp; label: string }> = [
  { method: 'POST', test: /^\/v1\/sbg\/parcels\/accept$/, label: 'Parcel taken in at the counter' },
  { method: 'POST', test: /^\/v1\/sbg\/parcels\/handover$/, label: 'Handed to the bus' },
  { method: 'POST', test: /^\/v1\/sbg\/parcels\/[^/]+\/intake$/, label: 'Parcel taken in' },
  { method: 'POST', test: /^\/v1\/sbg\/parcels\/[^/]+\/arrive$/, label: 'Parcel arrived' },
  { method: 'POST', test: /^\/v1\/sbg\/parcels\/[^/]+\/shelve$/, label: 'Parcel shelved' },
  { method: 'POST', test: /^\/v1\/sbg\/totes\/[^/]+\/(fill|load|assign|release)$/, label: 'Bag moved' },
  { method: 'POST', test: /^\/v1\/sbg\/agents\/[^/]+\/totes\/[^/]+\/(fill|seal)$/, label: 'Bag filled at the shop' },
  { method: 'POST', test: /^\/v1\/sbg\/dispatch\/freight\/[^/]+\/(pickup|deliver)$/, label: 'Freight moved' },
  // A cold-chain reading is taken on the road, which is exactly where the signal is worst — and a gap in
  // the record breaks the chain as surely as a breach does. It reports a measurement rather than asking
  // for a decision, so it is safe to complete without an answer.
  { method: 'POST', test: /^\/v1\/sbg\/dispatch\/freight\/[^/]+\/temperature$/, label: 'Temperature logged' },
  // A border post is where a phone loses its signal (round 14: "The driver, by a tap"). At the border, cleared it, at a
  // hub: each says where the load is, dated by the phone (`observedAt`), and asks nothing of anybody. The same step sent
  // twice is answered as it was, so a replay costs nothing.
  { method: 'POST', test: /^\/v1\/sbg\/dispatch\/freight\/[^/]+\/passages$/, label: 'Border or hub said' },
  // Round 15 — a seal found broken on the road: what the driver sees, dated when seen; a second report of the same seal is
  // refused by the server, so a replay costs nothing.
  { method: 'POST', test: /^\/v1\/sbg\/dispatch\/freight\/[^/]+\/seals\/[^/]+\/broken$/, label: 'Broken seal reported' },
  // The vehicle is parked and the driver can see it. Ending twice is a no-op, so a replay costs nothing.
  { method: 'POST', test: /^\/v1\/sbg\/fleet\/drivers\/[^/]+\/end-session$/, label: 'Shift ended' },
  // WHAT THE DRIVER SEES ON THE ROAD (the user, 2026-10-18: "queue reports, rest online"). A breakdown and a road hazard
  // are said where the signal is worst, and both report what is in front of the driver rather than ask for a decision.
  // Each carries the moment it was made (`observedAt`), so it is dated then, not when the signal came back. A second
  // breakdown is refused by the server and a driver's word on a hazard is one word, so a replay costs nothing.
  { method: 'POST', test: /^\/v1\/sbg\/fleet\/drivers\/[^/]+\/breakdown$/, label: 'Breakdown reported' },
  { method: 'POST', test: /^\/v1\/sbg\/route-constraints$/, label: 'Road hazard reported' },
  { method: 'POST', test: /^\/v1\/sbg\/route-constraints\/[^/]+\/(confirm|refute)$/, label: 'Road hazard answered' },
];

/**
 * RELEASE IS DELIBERATELY NOT HERE, and it is the most important line in this file.
 *
 * Handing a parcel to the person collecting it is a custody event, but it is also an AUTHORISATION: the
 * release code lives with the sender and the receiver, the shop that hands the goods over never learns it,
 * and only the server can say whether the code offered is the right one. Queue that and a shop in a dead
 * spot gives somebody's parcel away on a code nobody checked, and finds out hours later that it was wrong
 * — by which time the goods are gone and the queue reports a failure nobody can act on.
 *
 * The rest of this list is safe precisely because none of it is a decision. Taking a parcel in, shelving
 * it, putting it on a bus: the person doing it can see that it happened and needs nothing confirmed.
 * Release is the one where the app is checking something on the network's behalf, so it waits for signal.
 */

 /** Every pattern, for the contract-drift test. Exported so a wrong regex is a failing test rather than
  *  a feature that silently never queues anything — which is how the first version of this list shipped
  *  in my hands: half its paths did not exist. */
export const queueablePatterns = (): RegExp[] => QUEUEABLE.map((q) => q.test);

/** The label for a queueable request, or null when this one must not be queued. */
export function queueableLabel(method: string, path: string): string | null {
  const m = method.toUpperCase();
  return QUEUEABLE.find((q) => q.method === m && q.test.test(path))?.label ?? null;
}

/* ------------------------------------------------------------------ store -- */

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    // A corrupt or unavailable store must not take the app down with it. An unsendable queue is bad; an
    // app that will not open because of one is worse.
    return [];
  }
}

function write(items: OutboxItem[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch {
    /* private mode, or full. The in-flight drain still works; only durability is lost. */
  }
}

const listeners = new Set<() => void>();
function announce(): void {
  for (const l of listeners) l();
}

const sentListeners = new Set<(item: OutboxItem, answer: unknown) => void>();
/**
 * Be told when a queued write reaches the server, with the server's answer. A take-in made without a signal has things
 * only the server makes — its label, its release code — and this is when they exist.
 */
export function onOutboxSent(fn: (item: OutboxItem, answer: unknown) => void): () => void {
  sentListeners.add(fn);
  return () => sentListeners.delete(fn);
}

/** Re-render when the queue changes. Returns its own unsubscribe. */
export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function outboxItems(): OutboxItem[] {
  return read();
}

/** How many pieces of work are waiting — the number a person sees in the bar. */
export function outboxCount(): number {
  return read().length;
}

/** Whether anything has stopped trying and needs a person to look at it. */
export function outboxBlocked(): OutboxItem[] {
  return read().filter((i) => i.state === 'blocked');
}

export function enqueue(item: Omit<OutboxItem, 'attempts' | 'state'>): void {
  const items = read();
  // A key is spent once. If this exact attempt is already queued (a double tap, a re-render), leave the
  // original in place rather than adding a twin that will replay the same name and be refused.
  if (items.some((i) => i.key === item.key)) return;
  items.push({ ...item, ...(actor && !item.by ? { by: actor } : {}), attempts: 0, state: 'pending' });
  write(items);
  announce();
}

/** Forget one — used by the operator-facing "give up on this" affordance, and by a successful send. */
export function discard(id: string): void {
  write(read().filter((i) => i.id !== id));
  announce();
}

/** Put a blocked item back in the queue for another go, after whatever blocked it has been dealt with. */
export function retry(id: string): void {
  write(read().map((i) => (i.id === id ? { ...i, state: 'pending', attempts: 0, error: undefined } : i)));
  announce();
}

/* ------------------------------------------------------------------ drain -- */

export interface DrainDeps {
  baseUrl: string;
  token: () => Promise<string>;
  fetch?: typeof fetch;
}

/**
 * Send what is waiting, oldest first, stopping at the first item that cannot go.
 *
 * The stop is the important part. These are custody events in sequence — taken in, handed over, shelved —
 * and pushing later ones past a stuck earlier one would ask the server to shelve a parcel it has never
 * been told arrived. It would fail in a way nobody could read, and the queue would look like it was
 * working. Head-of-line blocking is the correct behaviour here, not a limitation.
 *
 * ONE RUN AT A TIME, for the page. A second call while one is running joins it rather than reading the same items and
 * sending them again: the server's idempotency key would make the second send harmless, but every listener would be told
 * twice that it arrived (a late take-in's label shown twice). The driver app drains by itself before starting a shift,
 * which can meet the loop's own timed run.
 */
export function drain(deps: DrainDeps): Promise<{ sent: number; blocked: number }> {
  if (draining) return draining;
  draining = drainOnce(deps).finally(() => {
    draining = null;
  });
  return draining;
}

let draining: Promise<{ sent: number; blocked: number }> | null = null;

async function drainOnce(deps: DrainDeps): Promise<{ sent: number; blocked: number }> {
  const send = deps.fetch ?? fetch;
  let sent = 0;

  for (;;) {
    const items = read();
    const next = items.find((i) => i.state !== 'blocked');
    if (!next) break;
    // Somebody else's act, made on this phone: it waits for their sign-in, and everything after it waits with it.
    if (!goesNow(next)) break;

    let token = '';
    try {
      token = await deps.token();
    } catch {
      break; // no credential yet — this is not the item's fault, so nothing is marked blocked
    }

    // A photo held on this phone for this write (heldPhotos.ts) goes first, and the real one takes its place.
    const photos = await sendHeldPhotos(next, deps.baseUrl, token, send);
    if (photos === 'offline') break;
    if (photos === 'blocked') continue;
    const body = read().find((i) => i.id === next.id)?.body ?? next.body;

    let response: Response;
    try {
      response = await send(`${deps.baseUrl}${next.path}`, {
        method: next.method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          // The same name it was first sent with. This is what makes a replay free rather than a
          // second parcel, a second charge, or a second handover.
          'idempotency-key': next.key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Still no network. Leave everything exactly as it is and try again on the next trigger — a
      // failed connection is not an attempt the item should be punished for.
      break;
    }

    if (response.ok) {
      discard(next.id);
      sent += 1;
      const answer = await response.clone().json().catch(() => undefined);
      for (const l of sentListeners) {
        try {
          l(next, answer);
        } catch {
          /* a listener's trouble is not the queue's */
        }
      }
      continue;
    }

    // A 5xx or a 429 is the server having a bad moment; keep the item and count the attempt. Anything
    // else is a refusal that will be refused again forever — a parcel already collected, a shop that has
    // been locked — so it stops asking and waits for a person, with the server's own words attached.
    const transient = response.status >= 500 || response.status === 429;
    const detail = await problemDetail(response);
    const attempts = next.attempts + 1;
    const stuck = !transient || attempts >= MAX_ATTEMPTS;
    write(read().map((i) => (i.id === next.id ? { ...i, attempts, state: stuck ? 'blocked' : 'pending', error: detail } : i)));
    announce();
    if (!stuck) break; // a transient failure stops the run; the next trigger tries the same item again
  }

  return { sent, blocked: read().filter((i) => i.state === 'blocked').length };
}

/**
 * Upload the photos a queued write holds on this phone, one at a time, writing each real reference into the item the
 * moment it exists — so an answer lost after an upload never uploads the same photo twice. 'offline' leaves everything
 * as it was for the next trigger; 'blocked' means the item was marked for a person to look at.
 */
async function sendHeldPhotos(item: OutboxItem, baseUrl: string, token: string, send: typeof fetch): Promise<'ok' | 'offline' | 'blocked'> {
  for (const ref of heldRefsIn(item.body)) {
    const photo = heldPhoto(ref);
    const block = (error: string, attempts = item.attempts) => {
      write(read().map((i) => (i.id === item.id ? { ...i, attempts, state: 'blocked', error } : i)));
      announce();
      return 'blocked' as const;
    };
    if (!photo) return block('The photo kept on this phone for it is gone. Take it again and do this once more.');
    let up: Response;
    try {
      up = await send(`${baseUrl}/v1/sbg/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: photo.kind, dataUrl: photo.dataUrl, ...(photo.thumbDataUrl ? { thumbDataUrl: photo.thumbDataUrl } : {}) }),
      });
    } catch {
      return 'offline';
    }
    if (!up.ok) {
      const attempts = item.attempts + 1;
      const transient = up.status >= 500 || up.status === 429;
      if (transient && attempts < MAX_ATTEMPTS) {
        write(read().map((i) => (i.id === item.id ? { ...i, attempts } : i)));
        announce();
        return 'offline';
      }
      return block(await problemDetail(up), attempts);
    }
    const mediaId = ((await up.json().catch(() => ({}))) as { mediaId?: string }).mediaId;
    if (!mediaId) return block('The photo was not taken by the server. Take it again and do this once more.');
    write(read().map((i) => (i.id === item.id ? { ...i, body: withRefs(i.body, { [ref]: mediaId }) } : i)));
    forgetHeld(ref);
  }
  return 'ok';
}

/** The server's own explanation, from an RFC 9457 problem document, or a plain status when it has none. */
async function problemDetail(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { detail?: string; title?: string; message?: string };
    return body.detail || body.title || body.message || `Error ${response.status}`;
  } catch {
    return `Error ${response.status}`;
  }
}

/* ------------------------------------------------------------------ fetch -- */

/** A name for one attempt. Random, because it identifies an ACT, not the thing the act is about. */
function mintKey(): string {
  const rand = globalThis.crypto?.randomUUID?.();
  return rand ?? `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Wrap a fetch so that a queueable write survives having no signal.
 *
 * Two things happen here and both matter. Every queueable write gets an `Idempotency-Key` on its FIRST
 * attempt, so the server can recognise a replay of something it may already have done. And when the
 * request cannot leave the device at all, it is put in the outbox and answered with a synthetic 202 —
 * because from the person's point of view the parcel HAS moved, and telling them otherwise would be the
 * app arguing with something they can see in their hands.
 *
 * A 202 is deliberate: accepted, not completed. A caller that treats it as a finished 200 will show
 * stale data rather than a lie, and a caller that reads `queued` can say the honest thing.
 */
export function offlineFetch(base: typeof fetch, apiOrigin: () => string): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = pathOf(url, apiOrigin());
    const label = path ? queueableLabel(method, path) : null;

    if (!path || !label) return base(input, init);

    // Named before the first attempt — see the note at the top of this file.
    const key = mintKey();
    // …and its body read before it too. The generated client hands fetch a Request, and fetch spends a Request's body
    // whether or not the network answers: read afterwards, the copy throws, and a write with no signal was answered
    // "you are offline" instead of being queued.
    const body = await bodyOf(init, input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('idempotency-key', key);

    try {
      return await base(input, { ...init, headers });
    } catch (err) {
      // Only a genuine failure to reach the network queues. A refusal that arrived is an answer, and an
      // answer — even a bad one — must reach the caller rather than being quietly written to disk.
      enqueue({ id: `ob_${key}`, key, method, path, body, label, at: new Date().toISOString() });
      return new Response(JSON.stringify({ queued: true, id: `ob_${key}`, label }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }
  };
}

/** The origin-relative path, or null when the request is not going to our own API. */
function pathOf(url: string, origin: string): string | null {
  if (!url.startsWith(origin)) return null;
  const rest = url.slice(origin.length);
  return rest.split('?')[0] || '/';
}

async function bodyOf(init: RequestInit | undefined, input: RequestInfo | URL): Promise<unknown> {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/* ---------------------------------------------------------------- running -- */

let stopCurrent: (() => void) | null = null;
/** The loop that is keeping the queue moving now, for a send somebody asked for by hand. */
let loop: DrainDeps | null = null;

/**
 * Keep the queue moving, without anybody having to remember to ask.
 *
 * Three triggers, and each answers a different way a phone comes back to life: the browser saying the
 * network returned, the person opening the app again (which on a cheap Android is far more reliable than
 * the online event), and a slow tick for the case where neither fired because the radio never formally
 * dropped — it just stopped carrying anything, which is what a bad signal actually looks like.
 *
 * One loop per page. Calling this again replaces the previous one rather than stacking a second drain
 * that would race the first for the same items.
 */
export function startOutbox(deps: DrainDeps): () => void {
  stopCurrent?.();
  loop = deps;
  let running = false;
  const tick = async () => {
    if (running || typeof navigator !== 'undefined' && navigator.onLine === false) return;
    running = true;
    try {
      await drain(deps);
    } finally {
      running = false;
    }
  };

  const onFocus = () => void tick();
  const timer = setInterval(() => void tick(), 30_000);
  addEventListener('online', onFocus);
  addEventListener('focus', onFocus);
  void tick();

  const stop = () => {
    clearInterval(timer);
    removeEventListener('online', onFocus);
    removeEventListener('focus', onFocus);
    if (stopCurrent === stop) {
      stopCurrent = null;
      loop = null;
    }
  };
  stopCurrent = stop;
  return stop;
}
