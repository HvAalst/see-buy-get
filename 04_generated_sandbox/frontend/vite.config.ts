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
        navigateFallback: `${BASE}index.html`,
        // Never serve the app shell for an API path.
        navigateFallbackDenylist: [/^\/v1\//],
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
    // Safe: each app owns a leaf of dist/, so a rebuild of one never touches another.
    emptyOutDir: true,
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
