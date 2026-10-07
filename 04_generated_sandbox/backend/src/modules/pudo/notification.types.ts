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
export const NOTIFICATION_KINDS = [
  /** A consignment note is a month from the end of its retention window; export it while it is here. */
  'note_expiring',
  'test',
  'parcel_ready',
  'load_nearby',
  'load_assigned',
  'load_instructions',
  'load_cancelled',
  'freight_problem',
  'claim_decided',
  'papers_due',
  'papers_lapsed',
  /** A renewed licence the courier sent was recorded, or refused with a reason they can act on. */
  'papers_checked',
  'bus_inbound',
  'intake_expected',
  'bag_ready_to_close',
  'message',
  /**
   * Joining stopped short, and the applicant is the one who can finish it.
   *
   * A shop that registers and sends no documents sits in DRAFT for ever. The console could see it — a
   * chase list names the missing papers — and the shop itself was told nothing at all, so the one party
   * who could act was the only party kept in the dark. Both halves of onboarding now speak: what is
   * still needed, and what a rejection decided and why.
   */
  /**
   * A BOX IS DUE BACK, and this is the notification the detention story turns on.
   *
   * The charge arrives on an invoice weeks later, by which time nothing can be done about it. Both the
   * agent who booked the box and the importer who pays are told before the date, in days rather than in
   * money — what it costs is between them and the line.
   */
  'box_due',
  'signup_incomplete',
  'signup_rejected',
  /**
   * A PAYMENT THE SHOP MADE WAS CONFIRMED — or came back.
   *
   * Since money coming in stopped resting on the payer's word, a shop pays at a kiosk and then waits: the
   * confirmation arrives on a provider's callback minutes later, and until this existed the only way to
   * learn of it was to reopen the app and press "Check again". A shopkeeper standing at a counter, unable
   * to scan, refreshing a screen, is the worst moment this network has to offer.
   *
   * One kind for both directions. The title says which, exactly as `papers_checked` covers a licence that
   * was recorded and one that was refused: what a reader wants is the outcome, not a taxonomy.
   */
  'money_in',
  /**
   * GOODS A SHIPPER SENT REACHED THE OTHER END.
   *
   * Its own kind rather than folded into `freight_problem`, because it is the only message in this list
   * that is unambiguously good news — and because until F3's ending existed there was nothing to send:
   * a run went departed and simply stopped, so the last thing a shipper ever heard about their load was
   * that they had booked it.
   */
  'freight_delivered',
  /**
   * Space on a fleet's run was bought. The event had been published since F3 under a comment promising
   * "the fleet office learns its space went" — and nothing listened, so the office learned nothing.
   */
  'space_sold',
  /** A shipper opened a claim on a load. The carrier is the one who has to answer it, so the carrier is told. */
  'claim_opened',
  /** The carrier answered a claim. The shipper who raised it is the one waiting to hear. */
  'claim_answered',
  /**
   * Somebody joined or left a fleet's roster: a driver took the fleet's offer, said no to it, left for another
   * fleet, or the fleet took them off. Whoever did not do it is told — a fleet learns it from us rather than from
   * an empty seat, and a driver taken off learns it, and why, from us rather than from a refused shift.
   */
  'roster_changed',
  /** The fleet office put a vehicle on this driver's list for today. Theirs to start, with their PIN. */
  'vehicle_today',
  /**
   * P4 — orders moved between a fleet and its partners: a partner is offered a batch, or the offer is taken back; the
   * fleet that offered hears that one was taken, that nobody took it, or that a partner gave it back and why. Whoever
   * did not do it is told — an order changing hands is two offices planning on the same thing.
   */
  'order_handed_on',
  'order_split',
  /**
   * The carrier's plan for the day has an order outside the window its shipper asked for — or, after that was said,
   * inside it again. Said to the shipper when the plan is accepted: the day before is when it can still ring the
   * door, or the carrier.
   */
  'order_window',
  /**
   * The carrier's accepted plan for the day leaves an order on no vehicle. The user, 2026-10-06: "It's commonly a
   * phonecall away, but he needs at least a notification." Said once per day and reason; that it is on a vehicle
   * after all is said as an `order_window` notice, with about when.
   */
  'order_left_out',
  /**
   * A load is running late, on its carrier's own clock: the hour its plan had it at the door has passed, or the whole
   * day it was ordered for. Nothing happens when a load does not arrive, so a sweep says it — once for the hour, and
   * once more for the day.
   */
  'order_late',
  /** A fleet offered this driver a place, or took the offer back. Only the driver can answer it, so only they are told. */
  'fleet_offer',
  /**
   * Something happened to the way somebody signs in that they did not do — five wrong PINs locked it. Said to the
   * person, because the one who typed them may know their number, and the owner is the only one who can act.
   */
  'security',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * One inbox entry (N2). Every notification we push is ALSO recorded here, so the in-app notification
 * centre can show history and an unread count even on a device that never enabled push (or missed the
 * live message). `readAt` is set when the owner opens/marks it — once: who read a shared notice first stays who read it. Durable — a user's notification history
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
  /** Who read it, where the inbox is one several people share (a business's). Absent in a person's own. */
  readBy?: string;
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
