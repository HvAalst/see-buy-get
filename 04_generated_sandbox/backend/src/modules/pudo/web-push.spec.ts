import { createPublicKey, randomBytes, verify } from 'crypto';
import { aDevice, openAsBrowser } from './push.test-util';
import { NotificationService } from './notification.service';
import type { NotificationPayload, PushSender, PushSubscriptionRecord } from './notification.types';
import { OutboxPushSender } from './push-sender';
import { BUILT_IN_PRIVATE, BUILT_IN_PUBLIC, privateKeyBytes, publicKeyOf, vapidIdentity, type VapidIdentity } from './vapid';
import { PUSH_MAX_PLAINTEXT, PUSH_SERVICES, PushGone, PushRefused, WebPushSender, choosePushSender, deliveryOf, encryptPush, isDeviceKeys, pushServiceOf, vapidAuthorization } from './web-push';

/**
 * THE PUSH THAT REACHES A PHONE.
 *
 * No push service can be reached from a test, and none should be. What CAN be held here is everything this server
 * does before the request leaves, checked from the other side: a "browser" is made in this file (a key pair and an
 * auth secret, exactly what `pushManager.subscribe` hands back), the sender is pointed at an address that is only a
 * function, and what arrives is opened the way a browser opens it — by an implementation written here from RFC 8291
 * and RFC 8188 with HMAC by hand, sharing no code with the sender. If the two disagree about one byte of the key
 * schedule, nothing decrypts.
 *
 * What this does NOT prove: that Google's, Mozilla's or Apple's service accepts the request. That is said on
 * progress.html, like the mail and text providers that have never been sent through from here either.
 */

/** A key of this server's own, as a deployment would give it. */
function ourIdentity(): VapidIdentity {
  const priv = randomBytes(32);
  return { publicKey: publicKeyOf(priv)!, privateKey: priv, subject: 'mailto:ops@seebuyget.test' };
}

/** A push service that is only a function: what it was sent, and what it answers. */
function aPushService(status = 201, said = '') {
  const got: Array<{ url: string; headers: Record<string, string>; body: Buffer }> = [];
  const post = async (url: string, init: { headers: Record<string, string>; body: Buffer }) => {
    got.push({ url, headers: init.headers, body: init.body });
    return { status, text: async () => said };
  };
  return { got, post };
}

const PAYLOAD: NotificationPayload = { kind: 'parcel_ready', title: 'Your parcel is ready', body: 'Collect it at Mama Sarah Shop · Blue gate', link: '/?parcel=PUD-1', tag: 'parcel:PUD-1', data: { parcelId: 'PUD-1' } };
const AT_GOOGLE = 'https://fcm.googleapis.com/fcm/send/abc123';
const sub = (device: ReturnType<typeof aDevice>, endpoint = AT_GOOGLE): PushSubscriptionRecord => ({ ownerDid: 'did:person:rx', role: 'consumer', endpoint, keys: device.keys, createdAt: '2026-10-11T08:00:00.000Z' });

describe('a message sealed to one device', () => {
  it('opens on that device, as that device opens it — and says exactly what was sent', () => {
    const device = aDevice();
    const body = encryptPush(Buffer.from(JSON.stringify(PAYLOAD)), device.keys);
    const opened = openAsBrowser(body, device);
    expect(JSON.parse(opened.text)).toEqual(PAYLOAD);
    // Laid out as the encoding says: a 16-byte salt, the record size, and this message's own 65-byte public key.
    expect(opened.recordSize).toBe(4096);
    expect(opened.senderKey).toHaveLength(65);
    expect(opened.senderKey[0]).toBe(4);
    expect(body.length).toBe(16 + 4 + 1 + 65 + Buffer.byteLength(JSON.stringify(PAYLOAD)) + 1 + 16);
  });

  it('carries words in any script whole', () => {
    const device = aDevice();
    const text = 'Kifurushi chako kiko tayari — የእርስዎ ጥቅል ዝግጁ ነው · طردك جاهز';
    expect(openAsBrowser(encryptPush(Buffer.from(text), device.keys), device).text).toBe(text);
  });

  it('is a different sealing every time: a new key and a new salt for each message', () => {
    const device = aDevice();
    const a = encryptPush(Buffer.from('the same words'), device.keys);
    const b = encryptPush(Buffer.from('the same words'), device.keys);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false); // the salt
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false); // the message's own key
    expect(openAsBrowser(a, device).text).toBe('the same words');
    expect(openAsBrowser(b, device).text).toBe('the same words');
  });

  it('opens on no other device, and not with another auth secret — the push service holds neither', () => {
    const device = aDevice();
    const other = aDevice();
    const body = encryptPush(Buffer.from('for one phone only'), device.keys);
    expect(() => openAsBrowser(body, other)).toThrow();
    expect(() => openAsBrowser(body, { ecdh: device.ecdh, auth: other.auth })).toThrow();
    // …and not if one byte of it was changed on the way.
    const touched = Buffer.from(body);
    touched[touched.length - 20] ^= 1;
    expect(() => openAsBrowser(touched, device)).toThrow();
  });

  it('refuses what is not a subscription’s keys, and a message too long to send', () => {
    const device = aDevice();
    expect(() => encryptPush(Buffer.from('x'), { p256dh: 'not-a-key', auth: device.keys.auth })).toThrow('not a push subscription');
    expect(() => encryptPush(Buffer.from('x'), { p256dh: device.keys.p256dh, auth: 'c2hvcnQ' })).toThrow('not a push subscription');
    expect(() => encryptPush(Buffer.alloc(PUSH_MAX_PLAINTEXT + 1, 97), device.keys)).toThrow(`at most ${PUSH_MAX_PLAINTEXT} bytes`);
    // The longest allowed still fits what a push service takes in all.
    expect(encryptPush(Buffer.alloc(PUSH_MAX_PLAINTEXT, 97), device.keys).length).toBeLessThanOrEqual(4096);
  });
});

describe('who is sending, signed', () => {
  const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
  const parts = (authorization: string) => {
    const m = /^vapid t=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(authorization);
    if (!m) throw new Error('not a vapid header: ' + authorization.slice(0, 40));
    const json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return { header: json(m[1]), claims: json(m[2]), signed: `${m[1]}.${m[2]}`, signature: Buffer.from(m[3], 'base64url'), key: m[4] };
  };
  const verifies = (p: ReturnType<typeof parts>, publicKey: string) => {
    const point = Buffer.from(publicKey, 'base64url');
    const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33, 65).toString('base64url') } });
    return verify('sha256', Buffer.from(p.signed), { key, dsaEncoding: 'ieee-p1363' }, p.signature);
  };

  it('is a token this server’s public key verifies, naming the push service it is for and nobody else’s', () => {
    const us = ourIdentity();
    const p = parts(vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123?x=1', us, NOW));
    expect(p.header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(p.claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: Math.floor(NOW / 1000) + 12 * 3600, sub: 'mailto:ops@seebuyget.test' });
    expect(p.key).toBe(us.publicKey);
    expect(p.signature).toHaveLength(64);
    expect(verifies(p, us.publicKey)).toBe(true);
    // Another server's key does not verify it; nor does it verify once a word of it is changed.
    expect(verifies(p, ourIdentity().publicKey)).toBe(false);
    expect(verifies({ ...p, signed: p.signed.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }, us.publicKey)).toBe(false);
    // A push service refuses a token good for more than a day.
    expect(p.claims.exp - Math.floor(NOW / 1000)).toBeLessThanOrEqual(24 * 3600);
  });

  it('names each push service by its own origin: a token for one is no use at another', () => {
    const us = ourIdentity();
    expect(parts(vapidAuthorization('https://updates.push.services.mozilla.com/wpush/v2/xyz', us, NOW)).claims.aud).toBe('https://updates.push.services.mozilla.com');
    expect(parts(vapidAuthorization('https://web.push.apple.com/QGuZ', us, NOW)).claims.aud).toBe('https://web.push.apple.com');
  });
});

describe('the key this server signs with', () => {
  it('is one value: the public half is worked out from the private, whichever way the 32 bytes are written', () => {
    const priv = randomBytes(32);
    const made = publicKeyOf(priv)!;
    const asHex = vapidIdentity({ GLOS_VAPID_PRIVATE: priv.toString('hex') });
    const asBase64 = vapidIdentity({ GLOS_VAPID_PRIVATE: priv.toString('base64url') });
    expect(asHex.publicKey).toBe(made);
    expect(asBase64.publicKey).toBe(made);
    expect(asHex.privateKey.equals(priv)).toBe(true);
    // A public key set beside it is not read: there is nothing to keep in step.
    expect(vapidIdentity({ GLOS_VAPID_PRIVATE: priv.toString('hex'), GLOS_VAPID_PUBLIC: BUILT_IN_PUBLIC }).publicKey).toBe(made);
    expect(vapidIdentity({ GLOS_VAPID_PRIVATE: priv.toString('hex'), GLOS_VAPID_SUBJECT: ' https://seebuyget.test/contact ' }).subject).toBe('https://seebuyget.test/contact');
  });

  it('in a sandbox falls back on the pair printed in the source, which is a real pair', () => {
    const builtIn = vapidIdentity({});
    expect(builtIn.publicKey).toBe(BUILT_IN_PUBLIC);
    expect(publicKeyOf(privateKeyBytes(BUILT_IN_PRIVATE)!)).toBe(BUILT_IN_PUBLIC);
  });

  it('outside a sandbox the server does not start on the printed pair, on none, or on something that is not a key', () => {
    const production = (over: Record<string, string | undefined>) => ({ GLOS_ENV: 'production', ...over });
    expect(() => vapidIdentity(production({}))).toThrow(/^GLOS_VAPID_PRIVATE is not set/);
    expect(() => vapidIdentity(production({ GLOS_VAPID_PRIVATE: BUILT_IN_PRIVATE }))).toThrow(/^GLOS_VAPID_PRIVATE is a value printed in the source/);
    expect(() => vapidIdentity(production({ GLOS_VAPID_PRIVATE: randomBytes(32).toString('hex') }))).not.toThrow();
    // Long and random enough to pass as a secret, and still not 32 bytes of key.
    expect(() => vapidIdentity(production({ GLOS_VAPID_PRIVATE: randomBytes(40).toString('hex') }))).toThrow('GLOS_VAPID_PRIVATE is not a key');
    expect(() => vapidIdentity({ GLOS_VAPID_PRIVATE: 'not a key at all' })).toThrow('GLOS_VAPID_PRIVATE is not a key');
    expect(privateKeyBytes('')).toBeNull();
    expect(privateKeyBytes(randomBytes(31).toString('hex'))).toBeNull();
  });
});

describe('what the push service is asked to do with it', () => {
  it('keeps an offer of work ten minutes and tries hard; keeps everything else a day', () => {
    expect(deliveryOf({ kind: 'load_nearby' })).toEqual({ ttl: 600, urgency: 'high' });
    expect(deliveryOf({ kind: 'parcel_ready' })).toEqual({ ttl: 86_400, urgency: 'normal' });
    expect(deliveryOf({ kind: 'test' })).toEqual({ ttl: 86_400, urgency: 'normal' });
  });

  it('lets a newer message with the same tag replace an undelivered older one, in the 32 characters a topic may be', () => {
    const { topic } = deliveryOf({ kind: 'parcel_ready', tag: 'parcel:PUD-1 · a tag with spaces/and slashes, far longer than thirty-two characters' });
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(deliveryOf({ kind: 'parcel_ready', tag: 'parcel:PUD-1' }).topic).toBe(deliveryOf({ kind: 'load_nearby', tag: 'parcel:PUD-1' }).topic);
    expect(deliveryOf({ kind: 'parcel_ready', tag: 'parcel:PUD-2' }).topic).not.toBe(deliveryOf({ kind: 'parcel_ready', tag: 'parcel:PUD-1' }).topic);
    expect(deliveryOf({ kind: 'parcel_ready' })).not.toHaveProperty('topic');
  });
});

describe('the sender', () => {
  it('posts the sealed message to the device’s own address, signed, and the device opens it', async () => {
    const us = ourIdentity();
    const device = aDevice();
    const service = aPushService(201);
    await new WebPushSender(() => us, service.post as never).send(sub(device), PAYLOAD);

    expect(service.got).toHaveLength(1);
    const sent = service.got[0];
    expect(sent.url).toBe(AT_GOOGLE);
    expect(sent.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' });
    expect(sent.headers.Topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(sent.headers.Authorization).toMatch(new RegExp(`^vapid t=[A-Za-z0-9_.-]+, k=${us.publicKey}$`));
    // What the service worker is handed: the notification, whole, as JSON.
    expect(JSON.parse(openAsBrowser(sent.body, device).text)).toEqual(PAYLOAD);
    // What the push service can read of it: nothing.
    expect(sent.body.toString('latin1')).not.toContain('Mama Sarah');
    expect(sent.body.toString('latin1')).not.toContain('PUD-1');
    expect(JSON.stringify(sent.headers)).not.toContain('PUD-1');
  });

  it('an offer of work is sent as urgent and short-lived', async () => {
    const service = aPushService(201);
    await new WebPushSender(ourIdentity, service.post as never).send(sub(aDevice()), { kind: 'load_nearby', title: 'Bag to Addis', body: '+4 min' });
    expect(service.got[0].headers).toMatchObject({ TTL: '600', Urgency: 'high' });
    expect(service.got[0].headers).not.toHaveProperty('Topic');
  });

  it('takes any 2xx as handed over; says GONE for a device the service no longer knows; says what else it was refused for', async () => {
    const device = aDevice();
    await expect(new WebPushSender(ourIdentity, aPushService(200).post as never).send(sub(device), PAYLOAD)).resolves.toBeUndefined();
    await expect(new WebPushSender(ourIdentity, aPushService(202).post as never).send(sub(device), PAYLOAD)).resolves.toBeUndefined();
    await expect(new WebPushSender(ourIdentity, aPushService(410).post as never).send(sub(device), PAYLOAD)).rejects.toBeInstanceOf(PushGone);
    await expect(new WebPushSender(ourIdentity, aPushService(404).post as never).send(sub(device), PAYLOAD)).rejects.toBeInstanceOf(PushGone);
    const refused = await new WebPushSender(ourIdentity, aPushService(403, 'the VAPID key does not match the subscription').post as never).send(sub(device), PAYLOAD).catch((e) => e);
    expect(refused).toBeInstanceOf(PushRefused);
    expect(refused).not.toBeInstanceOf(PushGone);
    expect((refused as PushRefused).status).toBe(403);
    expect((refused as Error).message).toBe('the push service refused it (403): the VAPID key does not match the subscription');
    await expect(new WebPushSender(ourIdentity, aPushService(429).post as never).send(sub(device), PAYLOAD)).rejects.toBeInstanceOf(PushRefused);
    await expect(new WebPushSender(ourIdentity, aPushService(500).post as never).send(sub(device), PAYLOAD)).rejects.toBeInstanceOf(PushRefused);
  });
});

describe('where a push may be posted: a push service, and nowhere else', () => {
  it('knows the services browsers use, by the host an address ends in', () => {
    expect(pushServiceOf('https://fcm.googleapis.com/fcm/send/abc:APA91b')).toBe('fcm.googleapis.com');
    expect(pushServiceOf('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')).toBe('updates.push.services.mozilla.com');
    expect(pushServiceOf('https://web.push.apple.com/QGuZ')).toBe('web.push.apple.com');
    expect(pushServiceOf('https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD')).toBe('notify.windows.com');
    expect(pushServiceOf('https://FCM.GoogleApis.com/fcm/send/abc')).toBe('fcm.googleapis.com');
    expect([...PUSH_SERVICES]).toEqual(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com']);
  });

  it('refuses everything else an account could hand it — our own network first', () => {
    for (const address of [
      'http://169.254.169.254/latest/meta-data/', // a cloud host's own secrets
      'http://localhost:3000/v1/sbg/operators',
      'https://10.0.0.5/admin',
      'https://internal.seebuyget.example/hook',
      'http://fcm.googleapis.com/fcm/send/abc', // not https
      'https://fcm.googleapis.com:8443/fcm/send/abc', // not its own port
      'https://user:pass@fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/fcm/send/abc', // ends in something else
      'https://evilfcm.googleapis.com.example/x',
      'https://notfcm.googleapis.com/x', // another host of the same owner is not the push service
      'https://googleapis.com/x',
      'ftp://fcm.googleapis.com/x',
      'fcm.googleapis.com/fcm/send/abc',
      '',
    ]) {
      expect([address, pushServiceOf(address)]).toEqual([address, null]);
    }
  });

  it('knows a device’s own keys from anything else', () => {
    expect(isDeviceKeys(aDevice().keys)).toBe(true);
    expect(isDeviceKeys({ p256dh: 'k1', auth: 'a1' })).toBe(false);
    expect(isDeviceKeys({ p256dh: aDevice().keys.p256dh, auth: 'c2hvcnQ' })).toBe(false);
    expect(isDeviceKeys(undefined)).toBe(false);
  });

  it('the sender posts nothing to an address that is not a push service, and calls it gone so it is forgotten', async () => {
    const service = aPushService(201);
    const sender = new WebPushSender(ourIdentity, service.post as never);
    for (const address of ['http://169.254.169.254/latest/meta-data/', 'https://internal.seebuyget.example/hook', 'http://localhost:3000/x']) {
      await expect(sender.send(sub(aDevice(), address), PAYLOAD)).rejects.toBeInstanceOf(PushGone);
    }
    expect(service.got).toEqual([]);
  });

  describe('when a device enrols', () => {
    const env = process.env.GLOS_ENV;
    afterEach(() => {
      if (env === undefined) delete process.env.GLOS_ENV;
      else process.env.GLOS_ENV = env;
    });
    const refusal = (act: () => unknown) => {
      try {
        act();
      } catch (e) {
        return (e as Error).message;
      }
      return 'taken';
    };

    it('outside a sandbox: an address that is not a push service is refused, and the person is told; so are keys that are not keys', () => {
      const svc = new NotificationService(new OutboxPushSender());
      process.env.GLOS_ENV = 'production';
      expect(refusal(() => svc.subscribe('did:person:rx', 'consumer', { endpoint: 'http://169.254.169.254/latest/meta-data/', keys: aDevice().keys }))).toContain('not a push service this server sends to');
      expect(refusal(() => svc.subscribe('did:person:rx', 'consumer', { endpoint: 'https://internal.seebuyget.example/hook', keys: aDevice().keys }))).toContain('not a push service this server sends to');
      expect(refusal(() => svc.subscribe('did:person:rx', 'consumer', { endpoint: AT_GOOGLE, keys: { p256dh: 'k1', auth: 'a1' } }))).toContain('not a push subscription’s keys');
      expect(svc.subscriptionsFor('did:person:rx')).toEqual([]);
      expect(refusal(() => svc.subscribe('did:person:rx', 'consumer', { endpoint: AT_GOOGLE, keys: aDevice().keys }))).toBe('taken');
      expect(svc.subscriptionsFor('did:person:rx')).toHaveLength(1);
    });

    it('in a sandbox, which posts to nobody, whatever a test or a tool hands it is kept', () => {
      delete process.env.GLOS_ENV;
      const svc = new NotificationService(new OutboxPushSender());
      expect(refusal(() => svc.subscribe('did:person:rx', 'consumer', { endpoint: 'https://push.example/dev1', keys: { p256dh: 'k1', auth: 'a1' } }))).toBe('taken');
    });
  });
});

describe('a device the push service no longer knows is forgotten; one that only failed is kept', () => {
  const browser = (endpoint: string) => ({ endpoint, keys: aDevice().keys });
  const senderThat = (answers: Record<string, Error | null>): PushSender => ({
    send: async (s) => {
      const answer = answers[s.endpoint];
      if (answer) throw answer;
    },
  });

  it('forgets the gone device, keeps the others, and counts what happened', async () => {
    const svc = new NotificationService(senderThat({ 'https://push.example.net/gone': new PushGone(410), 'https://push.example.net/busy': new PushRefused(503, 'try later'), 'https://push.example.net/fine': null }));
    svc.subscribe('did:person:rx', 'consumer', browser('https://push.example.net/gone'));
    svc.subscribe('did:person:rx', 'consumer', browser('https://push.example.net/busy'));
    svc.subscribe('did:person:rx', 'consumer', browser('https://push.example.net/fine'));
    svc.subscribe('did:person:other', 'consumer', browser('https://push.example.net/gone'));

    expect(await svc.pushToOwner('did:person:rx', PAYLOAD)).toBe(3);
    expect(svc.subscriptionsFor('did:person:rx').map((s) => s.endpoint).sort()).toEqual(['https://push.example.net/busy', 'https://push.example.net/fine']);
    // Somebody else's device at the same address is theirs to lose, when it is they who are told.
    expect(svc.subscriptionsFor('did:person:other')).toHaveLength(1);
    expect(svc.connection()).toMatchObject({ handed: 3, failed: 2, devices: 3 });
    // The notification itself was never at risk: it is in the bell whatever a push service said.
    await svc.notify('did:person:rx', PAYLOAD);
    expect(svc.inboxFor('did:person:rx')).toHaveLength(1);
  });
});

describe('which sender a server starts with', () => {
  const outbox = new OutboxPushSender();
  const web = new WebPushSender(ourIdentity, aPushService().post as never);
  const env = process.env.GLOS_ENV;
  afterEach(() => {
    if (env === undefined) delete process.env.GLOS_ENV;
    else process.env.GLOS_ENV = env;
  });

  it('a sandbox keeps what it is handed: nothing leaves a laptop for anybody’s phone', () => {
    delete process.env.GLOS_ENV;
    expect(choosePushSender(outbox, web)).toBe(outbox);
    process.env.GLOS_ENV = 'sandbox';
    expect(choosePushSender(outbox, web)).toBe(outbox);
  });

  it('anything else sends', () => {
    process.env.GLOS_ENV = 'production';
    expect(choosePushSender(outbox, web)).toBe(web);
  });
});
