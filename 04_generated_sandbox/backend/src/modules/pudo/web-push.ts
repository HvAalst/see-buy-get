import { Injectable } from '@nestjs/common';
import { createCipheriv, createECDH, createHash, createPrivateKey, hkdfSync, randomBytes, sign, type ECDH } from 'crypto';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { NotificationPayload, PushSender, PushSubscriptionRecord } from './notification.types';
import { OutboxPushSender } from './push-sender';
import { vapidIdentity, type VapidIdentity } from './vapid';

/**
 * THE PUSH THAT REACHES A PHONE — the last hop, which was the only part not built.
 *
 * Everything before it was real already: a browser subscribed against this server's key, the subscription was kept,
 * the app's service worker knew what to do with a message. What stood here was an outbox, so a driver handed a trip
 * found out when they next opened the app, and a receiver whose parcel had arrived found out the same way.
 *
 * NO ACCOUNT WITH ANYBODY. A push subscription is an address at the browser maker's own push service (Google's for
 * Chrome, Mozilla's for Firefox, Apple's for Safari) which the BROWSER obtained. This server needs no project, no
 * API key and no agreement with any of them: it proves who it is with a key of its own (VAPID, RFC 8292) and posts.
 *
 * THE PUSH SERVICE CANNOT READ IT. The message is sealed to the one device before it leaves (RFC 8291): encrypted
 * with a key agreed between a throwaway key made here for this one message and the device's own, which only that
 * browser holds the private half of. What the service sees is who is sending, to which of its addresses, and how big.
 *
 * Node's own `crypto`, and nothing added to the server for it.
 */

const b64u = (b: Buffer): string => b.toString('base64url');

/** A subscription the push service says is gone (404, 410): the browser unsubscribed or was wiped. Not to be tried again. */
export class PushGone extends Error {
  constructor(readonly status: number) {
    super(status ? `the push service no longer knows this device (${status})` : 'that address is not a push service this server posts to');
  }
}

/** Anything else the push service would not take, with its status and what it said. */
export class PushRefused extends Error {
  constructor(
    readonly status: number,
    said: string,
  ) {
    super(`the push service refused it (${status})${said ? `: ${said}` : ''}`);
  }
}

/**
 * WHERE A PUSH MAY BE POSTED: the push services browsers actually use, over https, and nowhere else.
 *
 * The address a device enrols with is typed by nobody — a browser makes it — but it ARRIVES in a request from
 * whoever is signed in, and this server then posts to it. Left open, anybody with an account could enrol an address
 * inside our own network and have the server knock on it for them. So an address is a push service's or it is
 * refused: when the device enrols (the person is told), and again before anything is posted (for an address kept
 * from before this rule).
 *
 * Google's service carries Chrome, Edge on Android, Samsung, Opera and Brave; Mozilla's carries Firefox; Apple's
 * carries Safari and every browser on an iPhone; Microsoft's carries Edge on Windows. A browser maker that opens a
 * new one is added here on purpose.
 */
export const PUSH_SERVICES = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'] as const;

/** The push service an address belongs to, or null when it is not one this server posts to. */
export function pushServiceOf(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  // https, the service's own port, and nobody's name and password in front of the host.
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICES.find((service) => host === service || host.endsWith(`.${service}`)) ?? null;
}

/** A device's own two keys, as a browser hands them over: a point on the curve (65 bytes) and a 16-byte secret. */
export function isDeviceKeys(keys: { p256dh?: string; auth?: string } | undefined): boolean {
  const point = Buffer.from(keys?.p256dh ?? '', 'base64url');
  return point.length === 65 && point[0] === 4 && Buffer.from(keys?.auth ?? '', 'base64url').length === 16;
}

/** The most a message may be before it is sealed: a push service takes 4096 bytes in all, and the seal costs 103. */
export const PUSH_MAX_PLAINTEXT = 3900;

/**
 * Seal one message to one device — the body of the request, as `Content-Encoding: aes128gcm` (RFC 8188) lays it out:
 * salt(16) · record size(4) · key length(1) · this message's public key(65) · the encrypted record.
 *
 * `made` exists for the test, which has to hand over the salt and the throwaway key to check the arithmetic.
 */
export function encryptPush(plaintext: Buffer, keys: { p256dh: string; auth: string }, made?: { salt?: Buffer; sender?: ECDH }): Buffer {
  const device = Buffer.from(keys.p256dh ?? '', 'base64url');
  const authSecret = Buffer.from(keys.auth ?? '', 'base64url');
  if (!isDeviceKeys(keys)) throw new Error('that is not a push subscription’s key pair');
  if (plaintext.length > PUSH_MAX_PLAINTEXT) throw new Error(`a push carries at most ${PUSH_MAX_PLAINTEXT} bytes, and this is ${plaintext.length}`);

  const sender = made?.sender ?? createECDH('prime256v1');
  if (!made?.sender) sender.generateKeys();
  const ours = sender.getPublicKey();
  const shared = sender.computeSecret(device);
  const salt = made?.salt ?? randomBytes(16);

  // RFC 8291 §3.4: the device's auth secret binds the agreed secret to THIS subscription.
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), device, ours]), 32));
  // RFC 8188 §2.2–2.3: one content key and one nonce for the single record.
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  // 0x02 ends the last (here the only) record; nothing is padded after it.
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = ours.length;
  return Buffer.concat([header, ours, record]);
}

/**
 * Who is sending, signed (RFC 8292): `vapid t=<a token good for twelve hours, for this push service only>, k=<our key>`.
 * The token names the push service's origin, so one lifted from a request to one service is no use at another.
 */
export function vapidAuthorization(endpoint: string, identity: VapidIdentity, nowMs: number = Date.now()): string {
  const point = Buffer.from(identity.publicKey, 'base64url');
  const key = createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: b64u(identity.privateKey), x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33, 65)) },
  });
  const part = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: identity.subject })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${identity.publicKey}`;
}

/**
 * How long a push service keeps a message for a device that is switched off, and how hard it tries.
 *
 * An offer of work is worth ten minutes: delivered an hour later it is an invitation to a job somebody else took.
 * Everything else — a parcel that has arrived, money that came in — is as true tomorrow morning, and waits a day.
 */
export function deliveryOf(payload: Pick<NotificationPayload, 'kind' | 'tag'>): { ttl: number; urgency: 'normal' | 'high'; topic?: string } {
  const now = payload.kind === 'load_nearby';
  return {
    ttl: now ? 10 * 60 : 24 * 3600,
    urgency: now ? 'high' : 'normal',
    // A newer message with the same tag REPLACES an undelivered older one at the push service, as it does on the
    // phone. A topic is at most 32 characters of the URL-safe alphabet, which a tag is not promised to be.
    ...(payload.tag ? { topic: createHash('sha256').update(payload.tag).digest('base64url').slice(0, 32) } : {}),
  };
}

type Post = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: Buffer; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

@Injectable()
export class WebPushSender implements PushSender {
  constructor(
    private readonly identity: () => VapidIdentity = vapidIdentity,
    // The bytes as bytes: a typed array is a request body, and the type `fetch` is given does not know a Buffer is one.
    private readonly post: Post = (url, init) => fetch(url, { ...init, body: new Uint8Array(init.body) }),
  ) {}

  async send(sub: PushSubscriptionRecord, payload: NotificationPayload): Promise<void> {
    // Asked again here, whatever was asked when the device enrolled: nothing is posted to an address that is not a
    // push service's. Said as GONE, so the address is forgotten rather than tried at every notification.
    if (!pushServiceOf(sub.endpoint)) throw new PushGone(0);
    const body = encryptPush(Buffer.from(JSON.stringify(payload)), sub.keys);
    const { ttl, urgency, topic } = deliveryOf(payload);
    const res = await this.post(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, this.identity()),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
        ...(topic ? { Topic: topic } : {}),
      },
      body,
      // A push service that does not answer must not hold up the thing that was being told about.
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 200 && res.status < 300) return;
    if (res.status === 404 || res.status === 410) throw new PushGone(res.status);
    throw new PushRefused(res.status, (await res.text().catch(() => '')).slice(0, 200));
  }
}

/**
 * WHICH SENDER THIS SERVER STARTS WITH. A sandbox keeps what it is handed, as it does with mail and texts: nothing
 * leaves a laptop for anybody's phone. Anything else sends — and has already refused to start on a signing key that
 * is printed in the source (vapid.ts).
 */
export function choosePushSender(outbox: OutboxPushSender, web: WebPushSender): PushSender {
  return isSandbox() ? outbox : web;
}
