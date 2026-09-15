/**
 * The notification layer — the data shapes shared by the push spine (N1) and, later, the event
 * dispatcher + in-app inbox (N2/N3). Kept dependency-free (no Nest, no services) so both the sender
 * implementations and the service can import it without a cycle.
 *
 * The apps are PWAs: a notification is not only a mail or an in-app toast — it is a REAL Web Push
 * message that the browser's service worker paints on the device's lock/start screen even when the
 * app is closed. That path needs (a) the browser's PushSubscription (endpoint + keys) captured per
 * device, and (b) a VAPID-signed, payload-encrypted POST to the push service. This file models the
 * former; `push-sender.ts` is the seam for the latter.
 */

/** The raw browser PushSubscription, exactly as `pushManager.subscribe(...).toJSON()` yields it. */
export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * One subscribed device, durably stored. `ownerDid` is the token's acting DID (a person's personDid
 * for a consumer, the entity DID for an agent/driver/…); `role` is captured so the dispatcher can
 * fan a payload out by role without a second lookup. A person may hold several (phone + tablet), so
 * the store is keyed by `${ownerDid}:${endpointHash}`, never by owner alone.
 */
export interface PushSubscriptionRecord {
  ownerDid: string;
  role: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
  lastSeenAt?: string;
}

/** The closed vocabulary of what we push. The spine (N1) fires `test`; N2/N3 add the rest;
 *  `intake_expected` (a parcel minted → its drop-off PUDO should expect it) is the genesis rule. */
export const NOTIFICATION_KINDS = ['test', 'parcel_ready', 'load_nearby', 'load_assigned', 'load_instructions', 'load_cancelled', 'freight_problem', 'claim_decided', 'papers_due', 'papers_lapsed', 'bus_inbound', 'intake_expected', 'bag_ready_to_close', 'message'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * One inbox entry (N2). Every notification we push is ALSO recorded here, so the in-app notification
 * centre can show history and an unread count even on a device that never enabled push (or missed the
 * live message). `readAt` is set when the owner opens/marks it. Durable — a user's notification history
 * must survive a restart.
 */
export interface NotificationRecord {
  id: string;
  ownerDid: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  data?: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
}

/**
 * What the service worker renders. `title`/`body` are the visible lines; `link` is the app-relative
 * deep link opened on tap (notificationclick); `tag` lets the SW collapse a re-send of the same event
 * onto the existing notification instead of stacking duplicates; `data` carries anything the click
 * handler needs. Deliberately small and self-contained — it is the JSON the SW receives verbatim.
 */
export interface NotificationPayload {
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  tag?: string;
  /**
   * Buttons on the notification itself — a phone shows at most two, which is exactly what a decision taken
   * at the wheel can hold. The service worker maps `action` to what it does: anything but a known action
   * falls through to opening `link`.
   */
  actions?: Array<{ action: string; title: string }>;
  data?: Record<string, unknown>;
}

/**
 * The delivery seam. The sandbox implementation (`OutboxPushSender`) records what WOULD be delivered —
 * no real push service is reachable from a dev box or a test run. A production `WebPushSender` that
 * VAPID-signs and AES-GCM-encrypts the payload and POSTs it to `sub.endpoint` slots in behind this same
 * interface, exactly as `FsBlobStore` ↔ a cloud BlobStore. Provided under the `PUSH_SENDER` token so the
 * swap is one line in the module.
 */
export interface PushSender {
  send(sub: PushSubscriptionRecord, payload: NotificationPayload): Promise<void>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');
