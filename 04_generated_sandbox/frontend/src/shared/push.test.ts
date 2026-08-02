import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsApi } from '../lib/sbg';
import { enablePush, isPushSupported, urlBase64ToUint8Array } from './push';

/** The real dev-default VAPID public key the backend serves (a base64url uncompressed P-256 point). */
const VAPID = 'BGdKs8o8SwKFtZWmRYPEy5j8tccJ2bbBzExTX0xJW2qzb6ft9Rot26iGI9p4u5_5e0jXTskaRLJrNW7p3oIP37U';

const ok = <T,>(data: T) => ({ data, error: null, status: 200 });

/** A fake notifications API — every method resolves OK unless the test overrides it. */
function fakeApi(over: Partial<NotificationsApi> = {}): NotificationsApi {
  return {
    vapidPublicKey: () => Promise.resolve(ok({ key: VAPID })),
    subscribe: () => Promise.resolve(ok({ subscribed: true })),
    unsubscribe: () => Promise.resolve(ok({ unsubscribed: true })),
    test: () => Promise.resolve(ok({ sent: 1 })),
    ...over,
  } as unknown as NotificationsApi;
}

/** Install a browser-ish global surface for the push flow; returns a restore fn. */
function installBrowser(opts: {
  permission?: NotificationPermission;
  requestPermission?: NotificationPermission;
  existingSub?: boolean;
  subscribeThrows?: boolean;
}) {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };

  const sub = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p256', auth: 'authsecret' } }),
    unsubscribe: () => Promise.resolve(true),
  };
  const reg = {
    pushManager: {
      getSubscription: () => Promise.resolve(opts.existingSub ? sub : null),
      subscribe: opts.subscribeThrows ? () => Promise.reject(new Error('blocked')) : () => Promise.resolve(sub),
    },
  };
  const Notif = {
    permission: opts.permission ?? 'default',
    requestPermission: () => Promise.resolve(opts.requestPermission ?? 'granted'),
  };

  set('Notification', Notif);
  set('window', { PushManager: function () {}, Notification: Notif });
  set('navigator', { serviceWorker: { ready: Promise.resolve(reg), getRegistration: () => Promise.resolve(reg) } });

  return () => {
    for (const [key, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

describe('urlBase64ToUint8Array', () => {
  it('decodes the real VAPID public key to a 65-byte uncompressed EC point (0x04 lead)', () => {
    const bytes = urlBase64ToUint8Array(VAPID);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('round-trips a known value and handles missing padding', () => {
    // "AQID" = [1,2,3]; url-safe with no padding "AQID" already, and a 3-char stub needs padding.
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
    expect(urlBase64ToUint8Array('-_8').length).toBe(2); // "-_8" -> bytes, url-safe chars decoded
  });
});

describe('isPushSupported', () => {
  it('is false with no browser globals (Node/test env)', () => {
    expect(isPushSupported()).toBe(false);
  });

  it('is true once serviceWorker + PushManager + Notification are present', () => {
    const restore = installBrowser({ permission: 'default' });
    try {
      expect(isPushSupported()).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('enablePush', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports unsupported when the browser cannot do push', async () => {
    const r = await enablePush(fakeApi());
    expect(r).toEqual({ ok: false, state: 'unsupported', reason: 'unsupported' });
  });

  it('subscribes and persists on the happy path', async () => {
    const restore = installBrowser({ requestPermission: 'granted' });
    const subscribe = vi.fn(() => Promise.resolve(ok({ subscribed: true })));
    try {
      const r = await enablePush(fakeApi({ subscribe: subscribe as unknown as NotificationsApi['subscribe'] }));
      expect(r).toEqual({ ok: true, state: 'on' });
      expect(subscribe).toHaveBeenCalledWith({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p256', auth: 'authsecret' } });
    } finally {
      restore();
    }
  });

  it('stops at denied when the user blocks the permission prompt', async () => {
    const restore = installBrowser({ requestPermission: 'denied' });
    const subscribe = vi.fn(() => Promise.resolve(ok({ subscribed: true })));
    try {
      const r = await enablePush(fakeApi({ subscribe: subscribe as unknown as NotificationsApi['subscribe'] }));
      expect(r).toMatchObject({ ok: false, state: 'denied', reason: 'denied' });
      expect(subscribe).not.toHaveBeenCalled(); // never reached the server
    } finally {
      restore();
    }
  });

  it('reports save-failed when the server rejects the subscription', async () => {
    const restore = installBrowser({ requestPermission: 'granted' });
    try {
      const r = await enablePush(
        fakeApi({
          subscribe: (() =>
            Promise.resolve({ data: null, error: { code: 'INTERNAL', status: 500, title: 'x', detail: 'x', retryable: true }, status: 500 })) as unknown as NotificationsApi['subscribe'],
        }),
      );
      expect(r).toMatchObject({ ok: false, state: 'prompt', reason: 'save-failed' });
    } finally {
      restore();
    }
  });

  it('returns no-key WITHOUT throwing when the VAPID key fetch fails (data:null on an Err)', async () => {
    const restore = installBrowser({ requestPermission: 'granted' });
    try {
      const r = await enablePush(
        fakeApi({
          vapidPublicKey: (() =>
            Promise.resolve({ data: null, error: { code: 'NETWORK', status: 0, title: 'x', detail: 'x', retryable: true }, status: 0 })) as unknown as NotificationsApi['vapidPublicKey'],
        }),
      );
      // The bug was `narrow(null).key` throwing out of enablePush and wedging busy — must be a clean return.
      expect(r).toMatchObject({ ok: false, state: 'prompt', reason: 'no-key' });
    } finally {
      restore();
    }
  });

  it('reports a DISMISSED prompt as its own reason, not denied (state stays prompt, retryable)', async () => {
    const restore = installBrowser({ requestPermission: 'default' }); // X/Esc leaves permission 'default'
    try {
      const r = await enablePush(fakeApi());
      expect(r).toEqual({ ok: false, state: 'prompt', reason: 'dismissed' });
    } finally {
      restore();
    }
  });

  it('reports subscribe-failed when the browser refuses the push subscription', async () => {
    const restore = installBrowser({ requestPermission: 'granted', subscribeThrows: true });
    try {
      const r = await enablePush(fakeApi());
      expect(r).toMatchObject({ ok: false, state: 'prompt', reason: 'subscribe-failed' });
    } finally {
      restore();
    }
  });
});
