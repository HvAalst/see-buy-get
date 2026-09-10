import { dirname, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// `type: module` package — no __dirname, derive it.
const ROOT = dirname(fileURLToPath(import.meta.url));

// @types/node is deliberately NOT a dependency (this file is outside tsconfig's
// `include`, and the browser code must never see Node globals), so the one Node global
// this config reads is declared locally. esbuild strips the declaration.
declare const process: { env: Record<string, string | undefined> };

/* ==========================================================================
   FIVE apps, one config.

   Vite 5 has exactly one `root` and one `base` per build, and each PWA is
   installed at its own origin-relative path, so five installable apps means five
   `vite build` runs — not one build with five inputs. This file is therefore a
   FACTORY: it describes every app in APPS and then configures the ONE app named
   by SBG_APP (default `driver`, so a bare `vite`/`vite build` behaves exactly as
   it did when this repo had a single app).

   `npm run build` loops the five over `scripts/build-all.mjs`.

   Vite's root is the app directory itself, NOT `src/`. What still lives at `src/` root is
   ONE hand-rolled vanilla page — control-tower, the M7 simulator surface — served by
   http-server (npm start, port 4173) and never seen, transformed or built by Vite. The 26
   legacy vanilla copies of the apps that used to sit beside it were deleted once the PWAs
   superseded them, and pudo-tower followed once the `tower` app had every one of its panels.
   ========================================================================== */

type AppSpec = {
  /** Deploy path. Baked into manifest scope/start_url and the SW registration URL. */
  base: string;
  /** Full manifest name; `short_name` is this minus the "SeeBuyGet " prefix. */
  name: string;
  short: string;
  description: string;
  /** Vite dev server port. 4173 belongs to http-server (legacy pages). */
  devPort: number;
  previewPort: number;
  /**
   * Does this app INSTALL — manifest, icons, service worker, offline shell? Default yes.
   *
   * The seven field apps do, and must: a shop in a dead spot and a driver between towns are the normal
   * operating environment here. The operator console does NOT, and that is the same reasoning read the
   * other way. It runs on a desk with a wired connection, and everything it shows is a queue somebody is
   * about to act on — a cached hazard list would let an operator clear a dispute that was resolved an
   * hour ago, from a screen that looked current. Where the phone apps must survive no signal, this one
   * must never pretend to have one.
   */
  installable?: boolean;
};

const APPS = {
  /**
   * The front door. Ships at the web ROOT, so a visitor who types the domain lands on a
   * chooser instead of a 404 — and it is the app that carries JOINING the network (every
   * other app can only sign an existing participant in).
   */
  home: {
    base: '/',
    name: 'SeeBuyGet',
    short: 'SeeBuyGet',
    description: 'Send, track, collect — or join the SeeBuyGet network.',
    devPort: 5180,
    previewPort: 5190,
  },
  driver: {
    base: '/driver/',
    name: 'SeeBuyGet Driver',
    short: 'Driver',
    description: 'Claim, load and deliver work on the SeeBuyGet network.',
    devPort: 5173,
    previewPort: 5174,
  },
  agent: {
    base: '/agent/',
    name: 'SeeBuyGet Agent',
    short: 'Agent',
    description: 'Run a SeeBuyGet pickup and drop-off point.',
    devPort: 5175,
    previewPort: 5185,
  },
  genesis: {
    base: '/send/',
    name: 'SeeBuyGet Send',
    short: 'Send',
    description: 'Send a parcel on the SeeBuyGet network.',
    devPort: 5176,
    previewPort: 5186,
  },
  fleet: {
    base: '/fleet/',
    name: 'SeeBuyGet Fleet',
    short: 'Fleet',
    description: 'Dispatch and follow a fleet on the SeeBuyGet network.',
    devPort: 5177,
    previewPort: 5187,
  },
  mdp: {
    base: '/mdp/',
    name: 'SeeBuyGet Hub',
    short: 'Hub',
    description: 'Run a SeeBuyGet merchant distribution hub.',
    devPort: 5178,
    previewPort: 5188,
  },
  vendor: {
    base: '/vendor/',
    name: 'SeeBuyGet Vendor',
    short: 'Vendor',
    description: 'Mint and follow your store orders on the SeeBuyGet network.',
    devPort: 5179,
    previewPort: 5189,
  },
  /**
   * The operator console — the first app in this family built for a LARGE SCREEN and a mouse, for the
   * people who operate the network rather than use it. Not installable (see `installable` above), and
   * it is deliberately not on the front door's role chooser: nobody joins as an operator.
   */
  tower: {
    base: '/tower/',
    name: 'SeeBuyGet Operator',
    short: 'Operator',
    description: 'Operate the SeeBuyGet network.',
    devPort: 5181,
    previewPort: 5191,
    installable: false,
  },
} satisfies Record<string, AppSpec>;

type AppId = keyof typeof APPS;

/** The single app this invocation builds/serves. */
const APP_ID = (process.env.SBG_APP ?? 'driver') as AppId;
if (!(APP_ID in APPS)) {
  throw new Error(
    `SBG_APP="${process.env.SBG_APP}" is not an app. Known: ${Object.keys(APPS).join(', ')}`,
  );
}

const app = APPS[APP_ID];
const BASE = app.base;

/** The root app ships at '/', so its output and service-worker scope cover every sibling. */
const IS_ROOT = BASE === '/';
/** Whether this app ships a manifest and a service worker at all — see AppSpec.installable. */
const INSTALLABLE = app.installable !== false;
/** Every OTHER app's deploy folder, e.g. ['driver', 'agent', …] — used to fence the root SW. */
const SIBLING_DIRS = Object.values(APPS)
  .map((a) => a.base.replace(/^\/|\/$/g, ''))
  .filter(Boolean);
const APP_DIR = resolve(ROOT, 'src/apps', APP_ID);

/**
 * Emit the ONE canonical Web Push SW handler (scripts/push-sw.js) into this app's build output as a
 * fixed, unhashed `push-sw.js`, so the generated Workbox SW can `importScripts('push-sw.js')` it (see
 * workbox.importScripts below) and every installed app stays self-contained — no cross-app file
 * dependency. Runs on build only; the SW is disabled in dev (devOptions.enabled: false).
 */
function pushSwPlugin(): Plugin {
  // The SW's ONE outbound call (declining an offer from its "Not now" button) needs the API origin, and a
  // service worker cannot read `window.SBG_API`. Bake in the same build-time env the app resolves from,
  // with the same localhost fallback — see src/lib/sbg/config.ts.
  const apiBase = process.env.VITE_SBG_API ?? 'http://localhost:3000';
  // Match the QUOTED placeholder, not the bare token: the file's own header explains the substitution and
  // names it, and a plain first-match replace rewrote that sentence while leaving the constant untouched.
  const raw = readFileSync(resolve(ROOT, 'scripts/push-sw.js'), 'utf8');
  const source = raw.replace("'__SBG_API_BASE__'", JSON.stringify(apiBase));
  if (source === raw) throw new Error('push-sw.js: API base placeholder not found — the decline button would call nowhere');
  return {
    name: 'sbg-push-sw',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'push-sw.js', source });
    },
  };
}
/**
 * Sweep the ROOT app's own build artefacts before it rebuilds.
 *
 * `emptyOutDir` is off for the root app because its outDir IS dist/, and emptying that would delete
 * every sibling app already built into dist/agent, dist/driver and so on. The consequence went
 * unnoticed for months: nothing ever removed the root app's own hash-named output, so dist/assets
 * accumulated every build since July — 133 files, 16 MB — and the service worker's glob dutifully
 * PRECACHED all of it. A first visit to the front door was fetching 8 MB of dead artefacts before
 * the app was usable, which on the connections these apps are built for means it never arrives.
 *
 * Narrowly scoped on purpose: dist/assets and the hashed workbox runtime belong to the root app
 * alone (each sibling has its own dist/<app>/assets), and everything else at the root — the sibling
 * folders, the widget's embed/, the legacy pages — is left untouched. A leaf app needs none of this;
 * `emptyOutDir` already does it there.
 */
function cleanRootAssetsPlugin(): Plugin {
  return {
    name: 'sbg-clean-root-assets',
    apply: 'build',
    buildStart() {
      if (!IS_ROOT) return;
      const dist = resolve(ROOT, 'dist');
      rmSync(resolve(dist, 'assets'), { recursive: true, force: true });
      if (existsSync(dist)) {
        for (const f of readdirSync(dist)) {
          if (/^workbox-.*\.js$/.test(f)) rmSync(resolve(dist, f), { force: true });
        }
      }
    },
  };
}

/**
 * Everything that makes an app INSTALLABLE: the push handler and the manifest + service worker.
 *
 * A function rather than two entries in the plugin list, because it is now conditional. An app that does
 * not install must not merely hide the install prompt — it must not SHIP a service worker at all, or the
 * first visit registers a worker that outlives the decision and keeps serving a cached shell.
 */
function installablePlugins(): PluginOption[] {
  return [
    pushSwPlugin(),
    VitePWA({
      strategies: 'generateSW',
      // 'prompt' is the mode that does NOT inject skipWaiting. Never switch to
      // 'autoUpdate' — that forces skipWaiting: true.
      registerType: 'prompt',
      // Each app owns its update UI (icon-only prompt — low-literacy rule).
      injectRegister: null,
      // No `includeAssets` / `includeManifestIcons`: everything in public/ is copied into
      // the build output and already picked up by workbox.globPatterns below. Listing the
      // icons again would only put duplicate entries in the precache manifest.
      includeManifestIcons: false,

      manifest: {
        id: BASE,
        name: app.name,
        short_name: app.short,
        description: app.description,
        scope: BASE,
        start_url: BASE,
        display: 'standalone',
        orientation: 'portrait',
        // Both the app's own surface, deliberately, and they are two different moments.
        // `background_color` paints the splash while the app boots; matching the first thing that
        // renders means the launch is a fade rather than an orange flash into a white screen. The
        // brand moment on that splash is the ICON, which is the whole tile.
        // `theme_color` paints the status bar directly above a white TopBar — see the note in each
        // app's index.html for why that must not be a brand colour here.
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        lang: 'en',
        dir: 'ltr',
        categories: ['business', 'productivity'],
        // Relative srcs resolve against the manifest URL (e.g. /agent/manifest.webmanifest),
        // so they stay correct if BASE changes.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // HARD CONSTRAINT: never skipWaiting. The waiting worker is activated only by
        // an explicit user gesture via updateServiceWorker(true).
        skipWaiting: false,
        clientsClaim: false,
        // Pull in the hand-written Web Push handlers (push + notificationclick). This ADDS to the
        // generated SW without changing its update contract; the file is emitted by pushSwPlugin
        // above and served at `${BASE}push-sw.js`, which is where importScripts resolves it.
        importScripts: ['push-sw.js'],
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        /**
         * The root app (`home`) builds INTO dist/, so an unrestricted glob swept up all six
         * sibling apps — 97 entries / 1.5 MB, including their service workers. That is bloat
         * on first visit AND a staleness trap: the root worker would keep serving a cached
         * copy of another app's index.html after that app shipped an update, fighting its own
         * update prompt. A leaf app's outDir contains only itself, so it needs no ignores.
         */
        globIgnores: [
          // The Leaflet tile-map chunk (G3a) is an ONLINE-ONLY, on-demand enhancement. Keep it out of
          // the precache so an offline-first install — and every user who never switches to the Map view
          // — does not pay ~166 KB for it. It is fetched from the network only when the map is opened.
          '**/PlaceMapLeaflet-*.js',
          '**/PlaceMapLeaflet-*.css',
          ...(IS_ROOT ? SIBLING_DIRS.map((d) => `${d}/**`) : []),
        ],
        navigateFallback: `${BASE}index.html`,
        /**
         * Never serve an app shell for an API path — nor, from the root worker (whose scope
         * is the WHOLE origin), for a sibling app's route: without this, navigating to
         * /driver/ before that app is cached renders the LANDING page at the driver's URL.
         */
        navigateFallbackDenylist: [/^\/v1\//, ...(IS_ROOT ? SIBLING_DIRS.map((d) => new RegExp(`^/${d}/`)) : [])],
      },

      // Keep the service worker out of dev (also avoids writing an ungitignored dev-dist/).
      devOptions: { enabled: false },
    }),
  ];
}

// Output mirrors the deploy path, not the app id (genesis ships at /send/), so the
// whole of dist/ can be copied to a web root and every base resolves as built.
const OUT_DIR = resolve(ROOT, 'dist', BASE.replace(/^\/|\/$/g, ''));

export default defineConfig({
  root: APP_DIR,
  base: BASE,
  // envDir defaults to `root`; without this, VITE_SBG_API (read by src/lib/sbg/config.ts)
  // would be looked up in src/apps/<app>/.env instead of frontend/.env.
  envDir: ROOT,
  publicDir: resolve(APP_DIR, 'public'),

  plugins: [preact(), cleanRootAssetsPlugin(), ...(INSTALLABLE ? installablePlugins() : [])],

  build: {
    // OUTSIDE src/, which is source and not a build target — an outDir inside it with
    // emptyOutDir would delete the operator's tower pages along with the build.
    outDir: OUT_DIR,
    /**
     * Each app owns a LEAF of dist/, so emptying its own folder never touches another —
     * except the root app (`home`, base '/'), whose outDir IS dist/. Emptying there would
     * delete every sibling app that had already been built. Its own output is
     * hash-named under dist/assets/, so leaving it non-empty is safe.
     */
    emptyOutDir: BASE !== '/',
    target: 'es2020',
    rollupOptions: {
      input: { [APP_ID]: resolve(APP_DIR, 'index.html') },
    },
  },

  server: {
    port: app.devPort,
    // The apps import ../../lib/sbg and ../../shared, which live outside `root`.
    fs: { allow: [ROOT] },
  },

  preview: {
    port: app.previewPort,
  },
});
