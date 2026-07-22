import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
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

   Vite's root is the app directory itself, NOT `src/`. The 26 legacy vanilla pages
   in `src/*.html` stay a pure http-server concern (npm start, port 4173) — Vite
   never sees, serves, transforms or builds them.
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
/** Every OTHER app's deploy folder, e.g. ['driver', 'agent', …] — used to fence the root SW. */
const SIBLING_DIRS = Object.values(APPS)
  .map((a) => a.base.replace(/^\/|\/$/g, ''))
  .filter(Boolean);
const APP_DIR = resolve(ROOT, 'src/apps', APP_ID);
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

  plugins: [
    preact(),
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
        background_color: '#FFFFFF',
        theme_color: '#4C46E0',
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
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        /**
         * The root app (`home`) builds INTO dist/, so an unrestricted glob swept up all six
         * sibling apps — 97 entries / 1.5 MB, including their service workers. That is bloat
         * on first visit AND a staleness trap: the root worker would keep serving a cached
         * copy of another app's index.html after that app shipped an update, fighting its own
         * update prompt. A leaf app's outDir contains only itself, so it needs no ignores.
         */
        globIgnores: IS_ROOT ? SIBLING_DIRS.map((d) => `${d}/**`) : [],
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
  ],

  build: {
    // OUTSIDE src/ — `src` is also a generated-output tree (seo-build.mjs writes
    // areas.html / area/*.html / sitemap.xml into it). An outDir inside src with
    // emptyOutDir would delete legacy and SEO-generated pages.
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
