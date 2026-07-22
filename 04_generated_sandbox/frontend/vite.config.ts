import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// `type: module` package — no __dirname, derive it.
const ROOT = dirname(fileURLToPath(import.meta.url));

// Vite's root is the driver app itself, NOT `src/`. The 26 legacy vanilla pages in
// `src/*.html` stay a pure http-server concern (npm start, port 4173) — Vite never
// sees, serves, transforms or builds them.
const APP = resolve(ROOT, 'src/apps/driver');

// Same-origin sub-path deploy. This value is baked into the manifest scope/start_url
// and into the service worker registration URL, so it must equal the real deploy path.
const BASE = '/driver/';

export default defineConfig({
  root: APP,
  base: BASE,
  // envDir defaults to `root`; without this, VITE_SBG_API (read by src/lib/sbg/config.ts)
  // would be looked up in src/apps/driver/.env instead of frontend/.env.
  envDir: ROOT,
  publicDir: resolve(APP, 'public'),

  plugins: [
    preact(),
    VitePWA({
      strategies: 'generateSW',
      // 'prompt' is the mode that does NOT inject skipWaiting. Never switch to
      // 'autoUpdate' — that forces skipWaiting: true.
      registerType: 'prompt',
      // The app owns the update UI (icon-only prompt — low-literacy rule).
      injectRegister: null,
      // No `includeAssets` / `includeManifestIcons`: everything in public/ is copied into
      // the build output and already picked up by workbox.globPatterns below. Listing the
      // icons again would only put duplicate entries in the precache manifest.
      includeManifestIcons: false,

      manifest: {
        id: BASE,
        name: 'SeeBuyGet Driver',
        short_name: 'Driver',
        description: 'Claim, load and deliver work on the SeeBuyGet network.',
        scope: BASE,
        start_url: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFFFFF',
        theme_color: '#4C46E0',
        lang: 'en',
        dir: 'ltr',
        categories: ['business', 'productivity'],
        // Relative srcs resolve against the manifest URL (/driver/manifest.webmanifest),
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
    outDir: resolve(ROOT, 'dist/driver'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: { driver: resolve(APP, 'index.html') },
    },
  },

  server: {
    // 4173 belongs to http-server (legacy pages).
    port: 5173,
    // The app imports ../../lib/sbg, which lives outside `root`.
    fs: { allow: [ROOT] },
  },

  preview: {
    port: 5174,
  },
});
