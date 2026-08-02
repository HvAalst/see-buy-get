import { narrow, type NotificationsApi, type SbgError } from '../lib/sbg';

/**
 * Web Push — the browser glue that turns the notifications API (network) into a real subscription on
 * THIS device. The apps are PWAs, so "notify me" means a genuine push subscription whose messages the
 * service worker paints on the lock/start screen even when the app is closed. This module owns the
 * permission prompt, the pushManager handshake and the VAPID-key conversion; the SW-side handlers that
 * render the message live in scripts/push-sw.js.
 *
 * Everything is defensive: an old browser, a blocked permission, a transient registration failure and a
 * server hiccup each return a distinct, truthful reason instead of throwing — the opt-in UI must be able
 * to say something the user can act on.
 */

export type PushState = 'unsupported' | 'denied' | 'prompt' | 'on';

export type PushFailure = 'unsupported' | 'denied' | 'dismissed' | 'no-serviceworker' | 'no-key' | 'subscribe-failed' | 'save-failed';

export interface PushOutcome {
  ok: boolean;
  state: PushState;
  reason?: PushFailure;
  error?: SbgError;
}

/** Web Push needs a service worker, the Push API and the Notifications API — all three, all present. */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Where this device stands right now, WITHOUT prompting: on / prompt / denied / unsupported. */
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub && Notification.permission === 'granted') return 'on';
  } catch {
    /* a transient registration read is just "not on yet" — fall through to prompt */
  }
  return 'prompt';
}

/**
 * The opt-in flow, end to end: ask permission → wait for the app's service worker → fetch the VAPID key
 * → subscribe (reusing an existing subscription) → persist it to the server. Every early return carries
 * the reason so the UI can say something true ("you blocked notifications" vs "we couldn't save it").
 */
export async function enablePush(api: NotificationsApi): Promise<PushOutcome> {
  if (!isPushSupported()) return { ok: false, state: 'unsupported', reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    // 'denied' is a hard block (fix in browser settings); 'default' means the user just DISMISSED the
    // prompt (X/Esc) — still retryable, and telling them to unblock settings would be a false dead end.
    const denied = permission === 'denied';
    return { ok: false, state: denied ? 'denied' : 'prompt', reason: denied ? 'denied' : 'dismissed' };
  }

  // The SW is registered by useRegisterSW (prompt mode) in each app's shell; wait for it to be active.
  // Race a timeout: with no SW ever activating (dev has none; a failed registration never resolves),
  // `.ready` hangs forever — which would strand the opt-in with `busy` stuck. Fail cleanly instead.
  let reg: ServiceWorkerRegistration;
  try {
    reg = await withTimeout(navigator.serviceWorker.ready, 8000);
  } catch {
    return { ok: false, state: 'prompt', reason: 'no-serviceworker' };
  }

  const keyRes = await api.vapidPublicKey();
  // Check the error BEFORE touching data: a failed Result carries `data: null`, and `narrow` is a bare
  // cast, so reading `.key` off it would throw a TypeError out of enablePush — stranding the opt-in with
  // `busy` stuck and no flash. Guard first, then narrow the (now non-null) data.
  if (keyRes.error) return { ok: false, state: 'prompt', reason: 'no-key', error: keyRes.error };
  const key = narrow<{ key?: string }>(keyRes.data ?? {}).key;
  if (!key) return { ok: false, state: 'prompt', reason: 'no-key' };

  let sub: PushSubscription | null;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    }
  } catch {
    return { ok: false, state: 'prompt', reason: 'subscribe-failed' };
  }

  const body = toSubscribeBody(sub);
  if (!body) return { ok: false, state: 'prompt', reason: 'subscribe-failed' };

  const saveRes = await api.subscribe(body);
  if (saveRes.error) return { ok: false, state: 'prompt', reason: 'save-failed', error: saveRes.error };

  return { ok: true, state: 'on' };
}

/** Turn it off on THIS device: unsubscribe the browser, then tell the server to drop the record. */
export async function disablePush(api: NotificationsApi): Promise<void> {
  if (!isPushSupported()) return;
  let sub: PushSubscription | null = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    sub = reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return;
  }
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* the browser may have already dropped it — still tell the server so the record does not linger */
  }
  await api.unsubscribe(endpoint);
}

/** Fire the server-side test push to every enrolled device. Returns how many were targeted. */
export async function sendTestPush(api: NotificationsApi): Promise<{ ok: boolean; sent: number; error?: SbgError }> {
  const res = await api.test();
  if (res.error) return { ok: false, sent: 0, error: res.error };
  return { ok: true, sent: narrow<{ sent?: number }>(res.data).sent ?? 0 };
}

/** Reject if a promise has not settled within `ms` — so a never-resolving `.ready` cannot wedge opt-in. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** The browser hands back a PushSubscription; the server wants { endpoint, keys:{p256dh,auth} }. */
function toSubscribeBody(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/**
 * VAPID keys travel as base64url; PushManager.subscribe wants the applicationServerKey as raw bytes.
 * Standard conversion (pad to base64, swap URL-safe chars, decode). Exported for the unit test.
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Back it with a concrete ArrayBuffer so the result is a BufferSource `pushManager.subscribe`
  // accepts (a bare `new Uint8Array(n)` is typed over ArrayBufferLike, which is not assignable).
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
