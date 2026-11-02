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
 * agree on: { kind, title, body, link?, tag?, actions?, data? }.
 *
 * `__SBG_API_BASE__` is substituted at build time by pushSwPlugin (vite.config.ts) with the same origin the
 * app itself uses. A service worker cannot read `window.SBG_API`, so the build-time env is the only shared
 * truth available to it — and the only call this file ever makes is the one-shot offer decline below.
 */
const SBG_API_BASE = '__SBG_API_BASE__';

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
    // Buttons on the notification itself, so a decision can be taken without opening anything. A phone shows
    // at most two and ignores the field entirely where it is unsupported — the banner still works, it just
    // falls back to "tap it to open", which is what every other notification here does anyway.
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : undefined,
    data: Object.assign({ link: link, kind: payload.kind }, payload.data || {}),
  };

  // 2026-11-02 — the app's icon is marked too, as a native app's is (shared/appBadge.ts): the exact count when the
  // message carries one, else a plain mark, set right the next time the app is open. Where badges are not drawn,
  // or the browser refuses, the notification shows all the same.
  var badge = Promise.resolve();
  try {
    var nav = self.navigator;
    if (nav && typeof nav.setAppBadge === 'function') {
      badge = (typeof payload.unread === 'number' && payload.unread > 0 ? nav.setAppBadge(payload.unread) : nav.setAppBadge()).catch(function () {});
    }
  } catch (_e) {
    /* no badges here */
  }

  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  // "Not now" — answer it here and leave the phone alone. The token is a one-shot capability that can
  // decline exactly this one offer and nothing else (the SW holds no session, and must not), so the load is
  // freed for another driver the moment it is declined rather than sitting reserved until it lapses.
  if (event.action === 'no' && data.declineToken) {
    event.waitUntil(
      fetch(SBG_API_BASE + '/v1/sbg/dispatch/offers/decline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: data.declineToken }),
      }).catch(function () {
        /* offline or already lapsed — the offer expires on its own; never surface an error on a lock screen */
      }),
    );
    return;
  }
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
        if (ofThisApp(client.url, self.registration.scope) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client && client.url !== target) {
            try {
              await client.navigate(target);
            } catch (_e) {
              // 2026-11-02 — a window this worker does not control cannot be sent somewhere: the link is opened
              // rather than dropped, so the tap still lands where the notice pointed.
              if (self.clients.openWindow) await self.clients.openWindow(target);
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

/**
 * 2026-11-02 — Is this window one of THIS app's? The front page's scope is the site's root, which every other app's
 * address also starts with: under it, a window of the Driver or the Shop app is not the front page's, and must not be
 * taken over by a notice meant for the front page.
 */
var OTHER_APPS = ['/driver/', '/agent/', '/send/', '/fleet/', '/mdp/', '/vendor/', '/business/', '/tower/'];
function ofThisApp(url, scope) {
  if (!url || !url.startsWith(scope)) return false;
  var scopePath = new URL(scope).pathname;
  if (scopePath !== '/') return true;
  var path = new URL(url).pathname;
  return !OTHER_APPS.some(function (base) {
    return path.startsWith(base);
  });
}

/** Resolve an app asset against the SW scope so the correct per-app icon is used. */
function iconUrl(path) {
  try {
    return new URL(path, self.registration.scope).href;
  } catch (_e) {
    return path;
  }
}

/*
 * 2026-11-02 — WHAT ANOTHER APP SHARES TO THIS ONE, photos included (the owner: a photo shared into the app from the
 * phone's gallery "is asked the same 'What is this?' and filed the same way"). The manifest's share target
 * (vite.config.ts, manifestFor) is a POST to `<app>/share-target`, multipart, because a photo cannot ride in an address.
 * It is answered HERE, on the phone, and never reaches the server:
 *   - photos are kept in this app's own cache (`sbg-shared-in`), untouched — the date the phone wrote into each is read
 *     from these very bytes before the app makes them smaller — and the app is opened at `?share_files=<name>`
 *     (shared/launch.ts), which offers them to be filed to a load or a parcel (shared/conversation/SharedPhotos.tsx);
 *   - words and a link alone are handed on in the address as before (`?share_title=…&share_text=…&share_url=…`), so a
 *     text or a link shared to the app reads exactly as it did when the share was a GET;
 *   - what cannot be read opens the app at `?share_files=lost`, which says so, rather than a blank window.
 * Kept an hour at most, like a share waiting for a sign-in; anything older is cleared when the next share arrives.
 * A POST is never Workbox's (it routes reads only), so this answers it whatever the precache does.
 */
var SHARE_ACTION = 'share-target';
var SHARED_CACHE = 'sbg-shared-in';
var SHARED_KEEP_MS = 60 * 60 * 1000;
var SHARED_MAX_FILES = 4;
var SHARED_MAX_BYTES = 25 * 1024 * 1024;

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'POST') return;
  var scope;
  var url;
  try {
    scope = new URL(self.registration.scope);
    url = new URL(req.url);
  } catch (_e) {
    return;
  }
  if (url.origin !== scope.origin || url.pathname !== scope.pathname + SHARE_ACTION) return;
  event.respondWith(receiveShare(req, scope));
});

function sharedWords(form, name) {
  var v = form.get(name);
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 4000) : '';
}

async function receiveShare(req, scope) {
  var back = new URL(scope.href);
  try {
    var form = await req.formData();
    var words = { title: sharedWords(form, 'share_title'), text: sharedWords(form, 'share_text'), url: sharedWords(form, 'share_url') };
    var files = form.getAll('share_files').filter(function (f) {
      return f && typeof f === 'object' && typeof f.size === 'number' && f.size > 0 && f.size <= SHARED_MAX_BYTES && /^image\//.test(f.type || '');
    });
    if (files.length) {
      var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      var cache = await caches.open(SHARED_CACHE);
      await forgetOldShares(cache);
      var base = scope.href + '__shared/' + id + '/';
      var kept = [];
      for (var i = 0; i < Math.min(files.length, SHARED_MAX_FILES); i += 1) {
        var f = files[i];
        await cache.put(base + i, new Response(f, { headers: { 'content-type': f.type } }));
        kept.push({ key: base + i, type: f.type, name: String(f.name || '').slice(0, 200), size: f.size, lastModified: f.lastModified || 0 });
      }
      await cache.put(base + 'meta', new Response(JSON.stringify({ at: Date.now(), files: kept, title: words.title, text: words.text, url: words.url }), { headers: { 'content-type': 'application/json' } }));
      back.searchParams.set('share_files', id);
    } else if (words.title || words.text || words.url) {
      if (words.title) back.searchParams.set('share_title', words.title);
      if (words.text) back.searchParams.set('share_text', words.text);
      if (words.url) back.searchParams.set('share_url', words.url);
    } else {
      back.searchParams.set('share_files', 'lost');
    }
  } catch (_e) {
    back.searchParams.set('share_files', 'lost');
  }
  // 303: the app opens with a plain read of its own address, never a second POST.
  return Response.redirect(back.href, 303);
}

/** Clear shares older than an hour: a photo nobody filed is not kept on the phone for ever. */
async function forgetOldShares(cache) {
  try {
    var keys = await cache.keys();
    var now = Date.now();
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i].url;
      if (!/\/meta$/.test(key)) continue;
      var res = await cache.match(keys[i]);
      var meta = res ? await res.json().catch(function () { return null; }) : null;
      if (meta && typeof meta.at === 'number' && now - meta.at <= SHARED_KEEP_MS) continue;
      var prefix = key.slice(0, -'meta'.length);
      for (var k = 0; k < keys.length; k += 1) if (keys[k].url.indexOf(prefix) === 0) await cache.delete(keys[k]);
    }
  } catch (_e) {
    /* a cache that cannot be read is cleared by the browser in its own time */
  }
}
