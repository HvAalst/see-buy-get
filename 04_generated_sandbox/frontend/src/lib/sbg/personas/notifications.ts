import type { SbgClient } from '../client';

/**
 * Notifications persona facade — the Web Push spine (N1), and the ONE part of the API that is
 * persona-agnostic: every human app (driver, agent, buyer, …) enrols and manages its OWN devices
 * through these same routes, bound server-side to the token's verified DID. The @Public
 * vapid-public-key sits here too so a single api object drives the whole opt-in flow.
 *
 * Responses are untyped in the generated schema (the backend returns plain objects), so callers
 * narrow the `data` — see shared/push.ts, which is the only consumer.
 */
export function createNotificationsApi(sbg: SbgClient) {
  return {
    /** The VAPID applicationServerKey the browser needs before it can subscribe. Public route. */
    vapidPublicKey: () => sbg.request((c) => c.GET('/v1/sbg/notifications/vapid-public-key', {})),

    /** Enrol this device's browser PushSubscription for the signed-in owner (idempotent per endpoint). */
    subscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      sbg.request((c) => c.POST('/v1/sbg/notifications/subscribe', { body: sub })),

    /** Drop one device (the browser unsubscribed, or the user turned notifications off). */
    unsubscribe: (endpoint: string) =>
      sbg.request((c) => c.DELETE('/v1/sbg/notifications/subscribe', { body: { endpoint } })),

    /** Fire a test push to every device the owner has enrolled — the post-opt-in "it works". */
    test: () => sbg.request((c) => c.POST('/v1/sbg/notifications/test', {})),
  };
}

export type NotificationsApi = ReturnType<typeof createNotificationsApi>;
