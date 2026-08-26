import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const ROOT = dirname(fileURLToPath(import.meta.url));
declare const process: { env: Record<string, string | undefined> };

/* ==========================================================================
   The embeddable quote widget — a LIBRARY build, not an eighth app.

   Everything in src/apps is an installable PWA: a manifest, a service worker,
   an origin-relative deploy path. This is none of those. It is one script a
   merchant pastes into a page we do not own, so it gets the opposite treatment:
   no PWA plugin, no Preact, no code splitting, no hashed filename — a stable
   URL a `<script src>` can point at forever.

   IIFE rather than an ES module on purpose. `<script type="module">` is fine on
   a modern site and impossible on plenty of real ones (older template engines,
   documents served without a MIME type a module loader will accept), and this
   file's whole job is to work on somebody else's page.

   Built by scripts/build-all.mjs after the apps, into dist/embed/.
   ========================================================================== */

// The API origin, baked the same way the push service worker's is: a merchant CAN override it per embed
// with the `api` attribute, but the paste-and-go path must not require them to know a URL.
const API_BASE = `${(process.env.VITE_SBG_API ?? 'http://localhost:3000').replace(/\/+$/, '')}/v1`;

export default defineConfig({
  root: ROOT,
  define: { __SBG_API_BASE__: JSON.stringify(API_BASE) },
  build: {
    outDir: resolve(ROOT, 'dist/embed'),
    emptyOutDir: true,
    target: 'es2020',
    lib: {
      entry: resolve(ROOT, 'src/widget/quote-widget.ts'),
      name: 'SbgShippingQuote',
      formats: ['iife'],
      // A STABLE name, deliberately unhashed: the whole point is a script tag a merchant pastes once and
      // never touches again. Cache-busting is a caching-header question, not a filename question, when the
      // consumer is somebody else's HTML.
      fileName: () => 'sbg-quote.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
