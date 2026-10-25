import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RestingAccounts } from '../../foundation/auth/resting-accounts';
import { createECDH, createHash, randomBytes } from 'crypto';
import { BUILT_IN_PUBLIC, vapidIdentity } from './vapid';
import { PushGone, isDeviceKeys, pushServiceOf } from './web-push';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { PushConnection, PushKeys, PushLast } from './connections.types';
import { OutboxPushSender } from './push-sender';
import { LiveService } from './live.service';
import {
  NotificationPayload,
  NotificationRecord,
  PushSender,
  PushSubscriptionRecord,
  PUSH_SENDER,
  WebPushSubscription,
} from './notification.types';

// The key this server is known to a push service by — where it comes from, and why it is one value: vapid.ts.

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

  /** Read as this service is made, like every secret: outside a sandbox a server that cannot sign a push does not start. */
  private readonly identity = vapidIdentity();

  constructor(
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    // Optional so a hand-built service keeps compiling: without it nobody is ever at rest.
    @Optional() private readonly rest?: RestingAccounts,
    // Optional for the same reason: without it no screen is told its bell changed, and every bell still reads on opening.
    @Optional() private readonly live?: LiveService,
  ) {}

  /** The `applicationServerKey` a browser needs to subscribe. Public by design — not a secret. */
  vapidPublicKey(): string {
    return this.identity.publicKey;
  }

  /** The signing identity, as text. Server-side only — never routed. */
  vapidCredentials(): { publicKey: string; privateKey: string; subject: string } {
    return { publicKey: this.identity.publicKey, privateKey: this.identity.privateKey.toString('base64url'), subject: this.identity.subject };
  }

  /** Enrol (or refresh) a device for an owner. Idempotent per endpoint — a re-subscribe updates in place. */
  subscribe(ownerDid: string, role: string, sub: WebPushSubscription): PushSubscriptionRecord {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw new GlosError('INVALID_INPUT', 'A push subscription needs an endpoint and both keys (p256dh, auth).');
    }
    // WHERE THIS SERVER WILL POST is decided here, when the address is given, and the person is told. A sandbox
    // keeps every push in its outbox and posts to nobody, so there it takes whatever a test or a tool hands it.
    if (!isSandbox()) {
      if (!pushServiceOf(sub.endpoint)) throw new GlosError('INVALID_INPUT', 'That address is not a push service this server sends to. Notifications still reach you in the app.');
      if (!isDeviceKeys(sub.keys)) throw new GlosError('INVALID_INPUT', 'Those are not a push subscription’s keys. Turn notifications off and on again in this browser.');
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
            // GONE IS AN ANSWER, not a fault: the browser unsubscribed, or the phone was wiped. The address is
            // forgotten, so this person's next notification is not posted to nowhere again — and counted, so a
            // screen that says how many devices can be reached does not go on counting one that cannot.
            if (err instanceof PushGone) this.subs.delete(this.key(ownerDid, sub.endpoint));
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
      keys: vapidKeysOf(this.identity.publicKey, this.identity.privateKey.toString('base64url')),
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
    // A fleet office with its screens open sees the bell's count move now, not when it is next opened.
    this.live?.toOwner(ownerDid);
    // AN ACCOUNT AT REST is not rung — it is in the inbox, where its owner can read it — unless it is about the
    // account's own safety, which reaches it wherever it is.
    if (payload.kind !== 'security' && this.rest?.isResting(ownerDid)) return record;
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
      // Read by one manager is read for them all: the others' bells say so at once.
      this.live?.toOwner(ownerDid);
    }
  }

  /** Mark every one of an owner's unread notifications read (the "mark all read" affordance). */
  markAllRead(ownerDid: string, by?: string): void {
    const now = new Date().toISOString();
    let read = 0;
    for (const n of this.inbox.values()) {
      if (n.ownerDid === ownerDid && !n.readAt) {
        n.readAt = now;
        if (by) n.readBy = by;
        this.inbox.set(n.id, n);
        read += 1;
      }
    }
    if (read) this.live?.toOwner(ownerDid);
  }
}
