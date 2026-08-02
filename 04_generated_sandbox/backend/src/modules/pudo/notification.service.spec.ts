import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';
import { NotificationPayload, PushSender, PushSubscriptionRecord, WebPushSubscription } from './notification.types';

const sub = (endpoint: string): WebPushSubscription => ({
  endpoint,
  keys: { p256dh: 'BPk_p256dh_key', auth: 'auth_secret' },
});

const payload: NotificationPayload = { kind: 'test', title: 'hi', body: 'there', link: '/' };

describe('NotificationService — the push spine (N1)', () => {
  describe('VAPID public key', () => {
    it('is a valid base64url uncompressed P-256 point (65 bytes, 0x04 lead) so a browser can subscribe', () => {
      const key = new NotificationService(new OutboxPushSender()).vapidPublicKey();
      const bytes = Buffer.from(key, 'base64url');
      expect(bytes.length).toBe(65);
      expect(bytes[0]).toBe(0x04);
    });

    it('never leaks the private key through the public accessor', () => {
      const svc = new NotificationService(new OutboxPushSender());
      expect(svc.vapidPublicKey()).not.toBe(svc.vapidCredentials().privateKey);
      expect(svc.vapidCredentials().privateKey.length).toBeGreaterThan(0);
    });
  });

  describe('subscription registry', () => {
    it('enrols a device and lists it back for its owner', () => {
      const svc = new NotificationService(new OutboxPushSender());
      svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      const devices = svc.subscriptionsFor('did:person:a');
      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({ ownerDid: 'did:person:a', role: 'consumer', endpoint: 'https://push/1' });
    });

    it('is idempotent per endpoint — a re-subscribe updates in place and preserves createdAt', () => {
      const svc = new NotificationService(new OutboxPushSender());
      const first = svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      const again = svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      expect(svc.subscriptionsFor('did:person:a')).toHaveLength(1);
      expect(again.createdAt).toBe(first.createdAt);
    });

    it('keeps multiple devices for one owner (phone + tablet)', () => {
      const svc = new NotificationService(new OutboxPushSender());
      svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      svc.subscribe('did:person:a', 'consumer', sub('https://push/2'));
      expect(svc.subscriptionsFor('did:person:a')).toHaveLength(2);
    });

    it('isolates owners — one person never sees another’s devices', () => {
      const svc = new NotificationService(new OutboxPushSender());
      svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      svc.subscribe('did:person:b', 'driver', sub('https://push/2'));
      expect(svc.subscriptionsFor('did:person:a')).toHaveLength(1);
      expect(svc.subscriptionsFor('did:person:b')).toHaveLength(1);
    });

    it('drops just the named device on unsubscribe', () => {
      const svc = new NotificationService(new OutboxPushSender());
      svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      svc.subscribe('did:person:a', 'consumer', sub('https://push/2'));
      svc.unsubscribe('did:person:a', 'https://push/1');
      const left = svc.subscriptionsFor('did:person:a');
      expect(left).toHaveLength(1);
      expect(left[0].endpoint).toBe('https://push/2');
    });

    it('rejects a subscription missing an endpoint or a key', () => {
      const svc = new NotificationService(new OutboxPushSender());
      expect(() => svc.subscribe('did:person:a', 'consumer', { endpoint: '', keys: { p256dh: 'x', auth: 'y' } })).toThrow(
        /endpoint/i,
      );
      expect(() =>
        svc.subscribe('did:person:a', 'consumer', { endpoint: 'https://push/1', keys: { p256dh: '', auth: 'y' } }),
      ).toThrow();
    });
  });

  describe('fan-out', () => {
    it('pushes to every device the owner has and returns the count', async () => {
      const outbox = new OutboxPushSender();
      const svc = new NotificationService(outbox);
      svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      svc.subscribe('did:person:a', 'consumer', sub('https://push/2'));
      const sent = await svc.pushToOwner('did:person:a', payload);
      expect(sent).toBe(2);
      expect(outbox.outboxFor('did:person:a')).toHaveLength(2);
      expect(outbox.outboxFor('did:person:a')[0].payload).toMatchObject({ kind: 'test', title: 'hi' });
    });

    it('is a silent no-op for an owner with no devices', async () => {
      const svc = new NotificationService(new OutboxPushSender());
      await expect(svc.pushToOwner('did:person:nobody', payload)).resolves.toBe(0);
    });

    it('is best-effort per device — one endpoint failing never blocks the others or throws', async () => {
      const flaky: PushSender = {
        send: (s: PushSubscriptionRecord) =>
          s.endpoint === 'https://push/bad' ? Promise.reject(new Error('gone')) : Promise.resolve(),
      };
      const svc = new NotificationService(flaky);
      svc.subscribe('did:person:a', 'consumer', sub('https://push/bad'));
      svc.subscribe('did:person:a', 'consumer', sub('https://push/good'));
      await expect(svc.pushToOwner('did:person:a', payload)).resolves.toBe(2);
    });
  });

  describe('inbox (N2)', () => {
    it('records every notification AND pushes it (inbox is the source of truth)', async () => {
      const outbox = new OutboxPushSender();
      const svc = new NotificationService(outbox);
      svc.subscribe('did:person:a', 'consumer', sub('https://push/1'));
      const record = await svc.notify('did:person:a', payload);
      expect(record).toMatchObject({ ownerDid: 'did:person:a', kind: 'test', title: 'hi' });
      expect(record.readAt).toBeUndefined(); // starts unread
      expect(svc.inboxFor('did:person:a')).toHaveLength(1);
      expect(outbox.outboxFor('did:person:a')).toHaveLength(1); // also pushed to the device
    });

    it('records even when the owner has no devices (the notification is not lost)', async () => {
      const svc = new NotificationService(new OutboxPushSender());
      await svc.notify('did:person:a', payload);
      expect(svc.inboxFor('did:person:a')).toHaveLength(1);
      expect(svc.unreadCount('did:person:a')).toBe(1);
    });

    it('lists newest-first and isolates owners', async () => {
      const svc = new NotificationService(new OutboxPushSender());
      await svc.notify('did:person:a', { ...payload, title: 'first' });
      await svc.notify('did:person:a', { ...payload, title: 'second' });
      await svc.notify('did:person:b', { ...payload, title: 'other' });
      const a = svc.inboxFor('did:person:a');
      expect(a.map((n) => n.title)).toEqual(['second', 'first']);
      expect(svc.inboxFor('did:person:b')).toHaveLength(1);
    });

    it('tracks unread and clears it on markRead / markAllRead', async () => {
      const svc = new NotificationService(new OutboxPushSender());
      const one = await svc.notify('did:person:a', { ...payload, title: 'one' });
      await svc.notify('did:person:a', { ...payload, title: 'two' });
      expect(svc.unreadCount('did:person:a')).toBe(2);
      svc.markRead('did:person:a', one.id);
      expect(svc.unreadCount('did:person:a')).toBe(1);
      svc.markAllRead('did:person:a');
      expect(svc.unreadCount('did:person:a')).toBe(0);
    });

    it('markRead is ownership-guarded — one person cannot mark another’s notification', async () => {
      const svc = new NotificationService(new OutboxPushSender());
      const mine = await svc.notify('did:person:a', payload);
      svc.markRead('did:person:b', mine.id); // B tries to touch A's notification
      expect(svc.unreadCount('did:person:a')).toBe(1); // unchanged
    });
  });
});
