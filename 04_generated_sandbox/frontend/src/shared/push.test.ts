import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsApi } from '../lib/sbg';
import { enablePush, isPushSupported, loadInbox, relativeTime, urlBase64ToUint8Array, whenLine } from './push';

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
    inbox: () => Promise.resolve(ok({ items: [], unread: 0 })),
    markRead: () => Promise.resolve(ok({ ok: true })),
    markAllRead: () => Promise.resolve(ok({ ok: true })),
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

describe('relativeTime', () => {
  const base = Date.parse('2026-08-02T12:00:00Z');
  it('formats each bucket', () => {
    expect(relativeTime('2026-08-02T11:59:30Z', base)).toBe('just now');
    expect(relativeTime('2026-08-02T11:59:05Z', base)).toBe('just now'); // 55s — never "0m ago"
    expect(relativeTime('2026-08-02T11:59:00Z', base)).toBe('1m ago'); // exactly 60s
    expect(relativeTime('2026-08-02T11:55:00Z', base)).toBe('5m ago');
    expect(relativeTime('2026-08-02T09:00:00Z', base)).toBe('3h ago');
    expect(relativeTime('2026-08-01T12:00:00Z', base)).toBe('yesterday');
    expect(relativeTime('2026-07-30T12:00:00Z', base)).toBe('3d ago');
    expect(relativeTime('2026-07-19T12:00:00Z', base)).toBe('2w ago');
  });
  it('returns empty for an unparseable date and clamps a future time', () => {
    expect(relativeTime('nonsense', base)).toBe('');
    expect(relativeTime('2026-08-02T12:05:00Z', base)).toBe('just now');
  });
});

describe('whenLine', () => {
  const base = Date.parse('2026-08-02T12:00:00Z');
  const came = '2026-08-02T11:55:00Z';
  it('says when a notice came, and who read it where the inbox is one several people share', () => {
    expect(whenLine({ createdAt: came }, base)).toBe('5m ago');
    expect(whenLine({ createdAt: came, readAt: '2026-08-02T11:58:00Z', readBy: 'Selam Owner' }, base)).toBe('5m ago · read by Selam Owner');
  });
  it('names nobody on a notice read in a person’s own inbox, and never on one still unread', () => {
    expect(whenLine({ createdAt: came, readAt: '2026-08-02T11:58:00Z' }, base)).toBe('5m ago');
    expect(whenLine({ createdAt: came, readBy: 'Selam Owner' }, base)).toBe('5m ago');
  });
});

describe('loadInbox', () => {
  it('narrows items + unread', async () => {
    const item = { id: '1', kind: 'parcel_ready', title: 't', body: 'b', createdAt: '2026-08-02T12:00:00Z' };
    const api = fakeApi({ inbox: (() => Promise.resolve(ok({ items: [item], unread: 1 }))) as unknown as NotificationsApi['inbox'] });
    expect(await loadInbox(api)).toEqual({ items: [item], unread: 1 });
  });

  it('returns null when the fetch fails (centre shows a retry, not a crash)', async () => {
    const api = fakeApi({
      inbox: (() => Promise.resolve({ data: null, error: { code: 'NETWORK', status: 0, title: 'x', detail: 'x', retryable: true }, status: 0 })) as unknown as NotificationsApi['inbox'],
    });
    expect(await loadInbox(api)).toBeNull();
  });

  it('defaults missing fields to an empty inbox', async () => {
    const api = fakeApi({ inbox: (() => Promise.resolve(ok({}))) as unknown as NotificationsApi['inbox'] });
    expect(await loadInbox(api)).toEqual({ items: [], unread: 0 });
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
