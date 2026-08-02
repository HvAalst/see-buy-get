/*
 * SeeBuyGet — Web Push service-worker handlers.
 *
 * This is the SW-side half of the notification spine. It is a standalone, dependency-free script
 * that Workbox's generated service worker pulls in via `workbox.importScripts` (see vite.config.ts).
 * Keeping it separate from the generated SW means it composes with the precache/update machinery
 * WITHOUT touching Workbox's skipWaiting:false / prompt-update contract — these two listeners simply
 * add push handling to whatever SW imported them.
 *
 * ONE canonical copy lives here; the Vite build emits it into every app's output so each app is
 * self-contained (no cross-app file dependency). Plain ES that runs in the SW global scope — no
 * bundler, no imports, no TypeScript.
 *
 * The message the server sends is the small JSON that shared/push.ts + the backend NotificationService
 * agree on: { kind, title, body, link?, tag?, data? }.
 */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event && event.data ? event.data.json() : {};
  } catch (_e) {
    // A push with no/garbled body still deserves a visible notification (userVisibleOnly requires one).
    payload = {};
  }

  const title = payload.title || 'SeeBuyGet';
  const link = payload.link || '/';
  const options = {
    body: payload.body || '',
    // Icons resolve against the SW scope, so each installed app shows its OWN icon.
    icon: iconUrl('icons/icon-192.png'),
    badge: iconUrl('icons/icon-192.png'),
    // A tag collapses a re-send of the same event onto the existing notification instead of stacking.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: Object.assign({ link: link, kind: payload.kind }, payload.data || {}),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Resolve the deep link RELATIVE TO THIS APP'S SCOPE. A leading-slash link is origin-absolute —
  // new URL('/', 'https://host/driver/') is the origin ROOT (the home app), not this app — which on a
  // multi-app single origin would send the click to the wrong PWA and break standalone. Strip leading
  // slashes so '/' means "this app's home" and '/x' means "x within this app", then resolve on scope.
  const rel = String((data && data.link) || '').replace(/^\/+/, '');
  const target = new URL(rel, self.registration.scope).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Prefer focusing an already-open window of THIS app, navigating it to the deep link.
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client && client.url !== target) {
            try {
              await client.navigate(target);
            } catch (_e) {
              /* cross-origin or detached — the focus alone is still the right outcome */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

/** Resolve an app asset against the SW scope so the correct per-app icon is used. */
function iconUrl(path) {
  try {
    return new URL(path, self.registration.scope).href;
  } catch (_e) {
    return path;
  }
}
