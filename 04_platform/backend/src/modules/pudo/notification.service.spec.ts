import { createECDH } from 'crypto';
import { NotificationService, vapidKeysOf } from './notification.service';
import { OutboxPushSender } from './push-sender';
import { RestingAccounts } from '../../foundation/auth/resting-accounts';
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

  describe('where a push goes, as staff are shown it', () => {
    it('says no phone is woken while the outbox is the sender, and counts devices and the people they belong to', async () => {
      const svc = new NotificationService(new OutboxPushSender());
      const before = svc.connection();
      svc.subscribe('did:person:conn-a', 'consumer', sub('https://push/conn-phone'));
      svc.subscribe('did:person:conn-a', 'consumer', sub('https://push/conn-laptop'));
      svc.subscribe('did:person:conn-b', 'driver', sub('https://push/conn-b'));
      // The registry is kept across instances, so what was there before is counted from.
      expect(svc.connection()).toEqual({ sends: false, keys: 'built_in', devices: before.devices + 3, people: before.people + 2, handed: 0, failed: 0 });

      // The bell is not the push: a notification to somebody with no device is written, and nothing is handed over.
      await svc.notify('did:person:conn-nobody', payload);
      expect(svc.connection()).toMatchObject({ handed: 0, failed: 0 });
      expect(svc.connection().last).toBeUndefined();
      // Per device: a phone and a laptop are two.
      await svc.notify('did:person:conn-a', payload);
      expect(svc.connection()).toMatchObject({ sends: false, handed: 2, failed: 0, last: { ok: true } });
    });

    it('says it sends once anything but the outbox is the sender, and counts each device that could not be reached', async () => {
      let down = false;
      const real: PushSender = { send: () => (down ? Promise.reject(new Error('gone')) : Promise.resolve()) };
      const svc = new NotificationService(real);
      (svc as unknown as { logger: { warn: () => void } }).logger = { warn: () => undefined };
      svc.subscribe('did:person:conn-c', 'consumer', sub('https://push/conn-c'));
      expect(svc.connection()).toMatchObject({ sends: true, handed: 0, failed: 0 });
      await svc.pushToOwner('did:person:conn-c', payload);
      expect(svc.connection()).toMatchObject({ handed: 1, failed: 0, last: { ok: true } });
      down = true;
      await svc.pushToOwner('did:person:conn-c', payload);
      expect(svc.connection()).toMatchObject({ handed: 2, failed: 1, last: { ok: false } });
      down = false;
      await svc.pushToOwner('did:person:conn-c', payload);
      expect(svc.connection()).toMatchObject({ handed: 3, failed: 1, last: { ok: true } });
      svc.connection().last!.ok = false;
      expect(svc.connection().last!.ok).toBe(true);
    });

    it('judges the keys from the pair itself: its own, the pair written in the source, or two that do not belong together', () => {
      const pair = () => {
        const ecdh = createECDH('prime256v1');
        ecdh.generateKeys();
        return { pub: ecdh.getPublicKey().toString('base64url'), priv: ecdh.getPrivateKey().toString('base64url') };
      };
      const builtIn = new NotificationService(new OutboxPushSender()).vapidCredentials();
      const [mine, theirs] = [pair(), pair()];
      expect(vapidKeysOf(builtIn.publicKey, builtIn.privateKey)).toBe('built_in');
      expect(vapidKeysOf(mine.pub, mine.priv)).toBe('own');
      // Padded as some tools write it: still the same key.
      expect(vapidKeysOf(mine.pub + '=', mine.priv)).toBe('own');
      // One of the two set, the other left as it was — in either direction — and a pair pasted from two places.
      expect(vapidKeysOf(mine.pub, builtIn.privateKey)).toBe('mismatched');
      expect(vapidKeysOf(builtIn.publicKey, mine.priv)).toBe('mismatched');
      expect(vapidKeysOf(mine.pub, theirs.priv)).toBe('mismatched');
      // Not a key at all.
      expect(vapidKeysOf(mine.pub, 'not a key')).toBe('mismatched');
      expect(vapidKeysOf('', '')).toBe('mismatched');
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

    it('an account at rest (muted by its owner) is not rung — it is in the inbox — unless it is about its safety', async () => {
      const outbox = new OutboxPushSender();
      const rest = new RestingAccounts();
      rest.answerForDid((did) => did === 'did:person:resting');
      const svc = new NotificationService(outbox, rest);
      svc.subscribe('did:person:resting', 'consumer', sub('https://push/r'));
      svc.subscribe('did:person:awake', 'consumer', sub('https://push/w'));

      await svc.notify('did:person:resting', payload);
      expect(svc.inboxFor('did:person:resting')).toHaveLength(1);
      expect(outbox.outboxFor('did:person:resting')).toHaveLength(0);
      // Its own safety reaches it wherever it is.
      await svc.notify('did:person:resting', { ...payload, kind: 'security' });
      expect(outbox.outboxFor('did:person:resting')).toHaveLength(1);
      // Somebody else is rung as ever.
      await svc.notify('did:person:awake', payload);
      expect(outbox.outboxFor('did:person:awake')).toHaveLength(1);
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

    it('keeps who read a notice in an inbox several people share — the first to read it — and names nobody in a person’s own', async () => {
      const svc = new NotificationService(new OutboxPushSender());
      const tag = Math.random().toString(36).slice(2, 8);
      const owner = `did:glos:biz-${tag}`;
      const one = await svc.notify(owner, { ...payload, title: 'one' });
      const two = await svc.notify(owner, { ...payload, title: 'two' });
      const three = await svc.notify(owner, { ...payload, title: 'three' });
      const of = (id: string) => svc.inboxFor(owner).find((n) => n.id === id)!;
      svc.markRead(owner, one.id, 'Selam Owner');
      expect(of(one.id).readBy).toBe('Selam Owner');
      // Read is read: somebody opening it afterwards does not become the one who read it.
      svc.markRead(owner, one.id, 'Bekele Booker');
      expect(of(one.id).readBy).toBe('Selam Owner');
      // No name given — a person's own inbox: read, and nobody named.
      svc.markRead(owner, two.id);
      expect(of(two.id).readAt).toBeDefined();
      expect(of(two.id).readBy).toBeUndefined();
      // The rest at once: by the one who did it, and what was read already stays as it was.
      svc.markAllRead(owner, 'Bekele Booker');
      expect(of(three.id).readBy).toBe('Bekele Booker');
      expect([of(one.id).readBy, of(two.id).readBy]).toEqual(['Selam Owner', undefined]);
      // Somebody else's inbox is not theirs to mark, with a name or without.
      const theirs = await svc.notify(`did:glos:other-${tag}`, payload);
      svc.markRead(owner, theirs.id, 'Selam Owner');
      svc.markAllRead(owner, 'Selam Owner');
      expect(svc.inboxFor(`did:glos:other-${tag}`)[0]).toMatchObject({ id: theirs.id });
      expect([svc.inboxFor(`did:glos:other-${tag}`)[0].readAt, svc.inboxFor(`did:glos:other-${tag}`)[0].readBy]).toEqual([undefined, undefined]);
    });
  });
});
