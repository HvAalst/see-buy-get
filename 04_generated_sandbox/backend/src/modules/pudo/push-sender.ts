import { Injectable } from '@nestjs/common';
import { NotificationPayload, PushSender, PushSubscriptionRecord } from './notification.types';

/** One recorded delivery — what the sandbox WOULD have pushed to a device. Inspectable via `outboxFor`. */
export interface PushDelivery {
  ownerDid: string;
  role: string;
  endpoint: string;
  payload: NotificationPayload;
  at: string;
}

/**
 * OutboxPushSender — the sandbox `PushSender`. A dev box and a Jest run cannot reach Google/Apple/Mozilla
 * push services, so instead of a real VAPID-encrypted POST this records the delivery to an in-memory
 * outbox (mirroring `VendorService.notify`'s callback outbox — "real HTTP in prod"). The spine above it
 * is genuine: real VAPID keys, a real browser subscription, a real service-worker `push` handler. Only
 * this last hop is stubbed, and it is stubbed behind the `PushSender` seam so a production sender drops
 * in with no change to the service or the callers.
 *
 * PROD SWAP (documented, not built here): a `WebPushSender` that, per delivery, derives the shared secret
 * from `sub.keys` (ECDH), AES-128-GCM-encrypts the JSON payload (RFC 8291), signs a VAPID JWT with the
 * server's private key (RFC 8292), and POSTs the ciphertext to `sub.endpoint` — all doable with Node's
 * built-in `crypto`, no third-party lib required. On a 404/410 it would evict the dead subscription.
 */
@Injectable()
export class OutboxPushSender implements PushSender {
  private readonly outbox: PushDelivery[] = [];

  async send(sub: PushSubscriptionRecord, payload: NotificationPayload): Promise<void> {
    this.outbox.push({
      ownerDid: sub.ownerDid,
      role: sub.role,
      endpoint: sub.endpoint,
      payload,
      at: new Date().toISOString(),
    });
  }

  /** The recent deliveries (newest first), optionally scoped to one owner. History for the watchtower/tests. */
  outboxFor(ownerDid?: string): PushDelivery[] {
    return (ownerDid ? this.outbox.filter((d) => d.ownerDid === ownerDid) : this.outbox).slice(-200).reverse();
  }
}
