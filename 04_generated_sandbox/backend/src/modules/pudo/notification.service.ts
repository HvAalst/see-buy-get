import { Inject, Injectable, Logger } from '@nestjs/common';
import { createECDH, createHash, randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { PushConnection, PushKeys, PushLast } from './connections.types';
import { OutboxPushSender } from './push-sender';
import {
  NotificationPayload,
  NotificationRecord,
  PushSender,
  PushSubscriptionRecord,
  PUSH_SENDER,
  WebPushSubscription,
} from './notification.types';

/**
 * VAPID keypair (RFC 8292). The PUBLIC key is the `applicationServerKey` the browser needs to build a
 * subscription — it is not a secret and is served openly at GET /notifications/vapid-public-key. The
 * PRIVATE key signs the push JWT and MUST stay server-side (never returned by any route).
 *
 * Injected from the environment the same inline way every other GLOS secret is (GLOS_AUTH_SECRET,
 * GLOS_PHONE_PEPPER, …), with a REAL dev-default P-256 keypair baked in so the sandbox works out of the
 * box: the default public key is a valid base64url uncompressed EC point, so `pushManager.subscribe`
 * accepts it and a browser genuinely subscribes. In production, set GLOS_VAPID_PUBLIC/PRIVATE to a
 * freshly generated pair (rotating the default) and GLOS_VAPID_SUBJECT to a real mailto:/https: contact.
 */
const BUILT_IN_PUBLIC = 'BGdKs8o8SwKFtZWmRYPEy5j8tccJ2bbBzExTX0xJW2qzb6ft9Rot26iGI9p4u5_5e0jXTskaRLJrNW7p3oIP37U';
const BUILT_IN_PRIVATE = 'oREOkpH8LKZI0b2iVJ8hPeuhCqJTMLBppOQsoml4Cc8';
const VAPID_PUBLIC = process.env.GLOS_VAPID_PUBLIC || BUILT_IN_PUBLIC;
const VAPID_PRIVATE = process.env.GLOS_VAPID_PRIVATE || BUILT_IN_PRIVATE;
const VAPID_SUBJECT = process.env.GLOS_VAPID_SUBJECT || 'mailto:ops@seebuyget.example';

/**
 * WHOSE KEYS A PAIR IS, worked out from the pair itself rather than from which variables are set.
 *
 * `mismatched` — the public key is not the one the private key makes. That is one of the two set and the other left
 * at the built-in, or a pair pasted from two places: a browser enrols against the public key, the server signs with
 * a private key that is not its partner, and every push service refuses it. `built_in` — the pair written in this
 * file, which anybody who can read the source can sign with. `own` — a matching pair that is nobody else's.
 */
export function vapidKeysOf(publicKey: string, privateKey: string): PushKeys {
  let made: string | undefined;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    made = ecdh.getPublicKey().toString('base64url');
  } catch {
    made = undefined; // not a private key at all
  }
  if (!made || made !== publicKey.trim().replace(/=+$/, '')) return 'mismatched';
  return made === BUILT_IN_PUBLIC ? 'built_in' : 'own';
}

/**
 * NotificationService — the push spine (N1). It owns the VAPID identity, the per-device subscription
 * registry, and the one primitive the dispatcher (N2/N3) builds on: fan a payload out to every device
 * an owner has enrolled. Delivery itself goes through the injected `PushSender` seam, so the sandbox
 * records to an outbox while production encrypts and POSTs — the service does not know which.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  // Durable: a subscription is a device saying "reach me here" and must survive a restart — losing it
  // silently drops every future notification to that device with no signal to re-subscribe. Keyed by
  // `${ownerDid}:${endpointHash}` so one owner can enrol many devices and a re-subscribe overwrites,
  // never duplicates. The endpoint (a long push-service URL) is hashed only to keep the key compact.
  private readonly subs = new PersistentMap<string, PushSubscriptionRecord>('sbg-push-subscriptions');

  // Durable inbox (N2): every notification is recorded here as well as pushed, so the in-app
  // notification centre shows history + an unread count even for a device that never enabled push or
  // was offline when the live message fired. Keyed by record id.
  private readonly inbox = new PersistentMap<string, NotificationRecord>('sbg-notifications');

  /** Since this server started: kept in memory, and a restart forgets it. */
  private handed = 0;
  private failed = 0;
  private last?: PushLast;

  constructor(@Inject(PUSH_SENDER) private readonly sender: PushSender) {}

  /** The `applicationServerKey` a browser needs to subscribe. Public by design — not a secret. */
  vapidPublicKey(): string {
    return VAPID_PUBLIC;
  }

  /** The signing identity a production `WebPushSender` needs. Server-side only — never routed. */
  vapidCredentials(): { publicKey: string; privateKey: string; subject: string } {
    return { publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE, subject: VAPID_SUBJECT };
  }

  /** Enrol (or refresh) a device for an owner. Idempotent per endpoint — a re-subscribe updates in place. */
  subscribe(ownerDid: string, role: string, sub: WebPushSubscription): PushSubscriptionRecord {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw new GlosError('INVALID_INPUT', 'A push subscription needs an endpoint and both keys (p256dh, auth).');
    }
    const existing = this.subs.get(this.key(ownerDid, sub.endpoint));
    const record: PushSubscriptionRecord = {
      ownerDid,
      role,
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    this.subs.set(this.key(ownerDid, sub.endpoint), record);
    return record;
  }

  /** Drop one device for an owner (the browser unsubscribed, or the user turned notifications off). */
  unsubscribe(ownerDid: string, endpoint: string): void {
    this.subs.delete(this.key(ownerDid, endpoint));
  }

  /** Every device an owner has enrolled. */
  subscriptionsFor(ownerDid: string): PushSubscriptionRecord[] {
    return [...this.subs.values()].filter((s) => s.ownerDid === ownerDid);
  }

  /**
   * Fan a payload out to every device an owner has enrolled. Best-effort PER DEVICE — one device's
   * failure never blocks the others (they are sent concurrently, each catching its own error), so a
   * single stale endpoint cannot swallow a notification the owner's other devices would have received.
   * Returns the number of devices targeted (0 if the owner has none — a silent no-op by design).
   */
  async pushToOwner(ownerDid: string, payload: NotificationPayload): Promise<number> {
    const targets = this.subscriptionsFor(ownerDid);
    await Promise.all(
      targets.map((sub) =>
        this.sender.send(sub, payload).then(
          () => this.pushed(true),
          (err) => {
            this.pushed(false);
            this.logger.warn(`push to ${ownerDid} (${sub.endpoint.slice(0, 40)}…) failed: ${(err as Error).message}`);
          },
        ),
      ),
    );
    return targets.length;
  }

  private pushed(ok: boolean): void {
    this.handed += 1;
    if (!ok) this.failed += 1;
    this.last = { at: new Date().toISOString(), ok };
  }

  /**
   * Where a push goes, for staff. `sends` is READ OFF THE SENDER, as the mail's is: the outbox keeps, and anything
   * put in its place sends. The keys are judged from the pair this server signs with. Counted per device, since a
   * push is to a device: a person with a phone and a laptop enrolled is two.
   */
  connection(): PushConnection {
    const devices = [...this.subs.values()];
    return {
      sends: !(this.sender instanceof OutboxPushSender),
      keys: vapidKeysOf(VAPID_PUBLIC, VAPID_PRIVATE),
      devices: devices.length,
      people: new Set(devices.map((s) => s.ownerDid)).size,
      handed: this.handed,
      failed: this.failed,
      ...(this.last ? { last: { ...this.last } } : {}),
    };
  }

  private key(ownerDid: string, endpoint: string): string {
    return `${ownerDid}:${createHash('sha256').update(endpoint).digest('hex').slice(0, 16)}`;
  }

  // --- inbox (N2) ---------------------------------------------------------------------------------

  /**
   * Deliver a notification to an owner: RECORD it to the durable inbox first (the source of truth the
   * in-app centre reads), THEN fan it out to their devices. Recording first means a push-delivery
   * hiccup never loses the notification — the user still sees it in-app. Returns the stored record.
   */
  async notify(ownerDid: string, payload: NotificationPayload): Promise<NotificationRecord> {
    const record: NotificationRecord = {
      id: `ntf_${randomBytes(8).toString('hex')}`,
      ownerDid,
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      data: payload.data,
      createdAt: new Date().toISOString(),
    };
    this.inbox.set(record.id, record);
    await this.pushToOwner(ownerDid, payload);
    return record;
  }

  /** An owner's notifications, newest first, capped (the centre paginates later if it ever needs to). */
  inboxFor(ownerDid: string, limit = 50): NotificationRecord[] {
    return [...this.inbox.values()]
      .filter((n) => n.ownerDid === ownerDid)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }

  /** How many of an owner's notifications are unread — the bell badge count. */
  unreadCount(ownerDid: string): number {
    let count = 0;
    for (const n of this.inbox.values()) if (n.ownerDid === ownerDid && !n.readAt) count += 1;
    return count;
  }

  /** Mark one notification read. Ownership-guarded — a caller can only ever touch its OWN notifications. */
  markRead(ownerDid: string, id: string, by?: string): void {
    const n = this.inbox.get(id);
    if (n && n.ownerDid === ownerDid && !n.readAt) {
      n.readAt = new Date().toISOString();
      if (by) n.readBy = by;
      this.inbox.set(id, n);
    }
  }

  /** Mark every one of an owner's unread notifications read (the "mark all read" affordance). */
  markAllRead(ownerDid: string, by?: string): void {
    const now = new Date().toISOString();
    for (const n of this.inbox.values()) {
      if (n.ownerDid === ownerDid && !n.readAt) {
        n.readAt = now;
        if (by) n.readBy = by;
        this.inbox.set(n.id, n);
      }
    }
  }
}
