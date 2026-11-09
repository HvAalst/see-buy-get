import { dirname, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';

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

   Vite's root is the app directory itself, NOT `src/`. NO hand-rolled page lives at `src/`
   root any more: the 26 legacy vanilla copies went once the PWAs superseded them, pudo-tower
   followed once the `tower` app had every one of its panels, and control-tower — the M7
   simulator surface — was deleted rather than migrated, because what it drove was written for
   a global freight forwarder and not for this network. Nothing serves `src/` statically now;
   what is left there is source, plus the site files the build copies into `dist/`.
   ========================================================================== */

type AppSpec = {
  /** Deploy path. Baked into manifest scope/start_url and the SW registration URL. */
  base: string;
  /**
   * Full manifest name — the install dialog and the app switcher, where there is room. `short` is the label under the
   * icon on a home screen, which phones cut at about twelve characters: "SBG Send", never "SeeBuyGet Send", or every app
   * would read "SeeBuyGet…" and look the same (the user, 2026-10-22: "we need a distinction ... the text under has to
   * change"). The icon's glyph says which app; the label adds whose it is.
   */
  name: string;
  short: string;
  description: string;
  /** Vite dev server port. 4173 is left free — it belonged to the static server for the legacy pages. */
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
  /**
   * Does this app ship on ITS OWN ADDRESS, outside the public site? Default no.
   *
   * The operator console does (the user, 2026-10-03: the staff entrance must not be obvious). It builds into
   * `dist-console/` instead of a folder of `dist/`, so copying the public site to a web root carries none of it —
   * not its sign-in page, not its code. It is never proxied by the front door in dev, and it is deployed to its own
   * host (e.g. ops.seebuyget.com) behind a gate at the edge: see "The operator console's entrance" in README.md.
   */
  standalone?: boolean;
  /**
   * 2026-11-02 — WHAT THE PHONE KNOWS ABOUT THE APP (the owner: "make it as native as today can be").
   *
   * `shortcuts`: what holding the app's icon offers — its most common jobs, each opening one screen. `screenshots`: the
   * pictures of the real app the install window shows beside its description, so installing reads like a store page and
   * not a bare "Install app?". `chats`: the app has conversations, so it is offered in the phone's share list for a text
   * or a link. Words here are the manifest's, in English, as the name and description are.
   */
  shortcuts?: Shortcut[];
  screenshots?: Screenshot[];
  chats?: boolean;
};

/**
 * A job reached by holding the app's icon. `go` is a key of the app's own Screen type: the app is opened at `?go=<key>`
 * and goes there (shared/launch.ts reads it). Its picture is icons/shortcuts/<go>-96.png and <go>-192.png in the app's
 * public folder — the nav glyph in navy on a white round tile, over the orange bar the bottom nav marks the open tab with.
 */
type Shortcut = { go: string; name: string; short: string; description: string };

/**
 * A picture of the real app for the install window: screenshots/<file> in the app's public folder, a 390 × 844 phone at
 * twice its size (780 × 1688). The screens are the apps' own, drawn with made-up shops, places and amounts.
 */
type Screenshot = { file: string; label: string };

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
    description: 'Send a parcel from a shop near you at a price you see first, and the person it is for collects it at a shop near them with a code. Or join the SeeBuyGet network as a shop, driver, hub, store or fleet.',
    devPort: 5180,
    previewPort: 5190,
    // Its own screens only (logic.ts readDeepLink): sending and tracking are the Send app's, which installs on its own.
    shortcuts: [
      { go: 'signin', name: 'Open your app', short: 'Open my app', description: 'Sign in to the app you work with' },
      { go: 'market', name: 'The freight market', short: 'Market', description: 'What freight moves around a place, and what it pays' },
      { go: 'agents', name: 'Find a clearing agent', short: 'Agents', description: 'Clearing agents by what they clear and where' },
      { go: 'roles', name: 'Sign up', short: 'Sign up', description: 'Join as a shop, driver, hub, store or fleet' },
    ],
    screenshots: [
      { file: 'welcome.png', label: 'Drop a parcel at a shop near you; the person it is for collects it at a shop near them with a code' },
      { file: 'signin.png', label: 'Open your app: one for each way you work with SeeBuyGet' },
      { file: 'market.png', label: 'The freight market around a town, and what each load pays' },
    ],
  },
  driver: {
    base: '/driver/',
    name: 'SeeBuyGet Driver',
    short: 'SBG Driver',
    description: 'Start your shift, find loads on your way and on the freight market, carry them, and see what you have earned — on the SeeBuyGet network.',
    devPort: 5173,
    previewPort: 5174,
    // Find work and My loads need a shift; opened off shift, the app shows the vehicle to start one with.
    shortcuts: [
      { go: 'route', name: 'Find work', short: 'Find work', description: 'Loads on your way that fit the space you have left' },
      { go: 'loads', name: 'My loads', short: 'My loads', description: 'What you are carrying now' },
      { go: 'board', name: 'The freight market', short: 'Market', description: 'Every load out there, and why you can or cannot take it yet' },
      { go: 'earnings', name: 'Earnings', short: 'Earnings', description: 'What you earned, and what is still to come' },
    ],
    screenshots: [
      { file: 'home.png', label: 'On shift: the space left on your van, and your vehicle' },
      { file: 'board.png', label: 'The freight market: each load, what it pays per kilometre, and whether you can take it' },
      { file: 'earnings.png', label: 'Earnings: what you earned and every job behind it' },
    ],
    chats: true,
  },
  agent: {
    base: '/agent/',
    // The Shop app: what the front door and the app itself call it (its folder keeps the older name, agent).
    name: 'SeeBuyGet Shop',
    short: 'SBG Shop',
    description: 'Run a SeeBuyGet pickup and drop-off point: take parcels in, hand them over by their code, give them to the bus, and see your float and your shelf at a glance.',
    devPort: 5175,
    previewPort: 5185,
    shortcuts: [
      { go: 'accept', name: 'Take in a parcel', short: 'Take in', description: 'A customer drops something off' },
      { go: 'release', name: 'Hand over a parcel', short: 'Hand over', description: 'Any customer collecting anything' },
      { go: 'handover', name: 'Hand to the bus', short: 'To the bus', description: 'Give waiting parcels to the driver' },
      { go: 'receivebag', name: 'Receive a bag', short: 'Receive bag', description: 'A bus dropped a bag for your shop' },
    ],
    screenshots: [
      { file: 'home.png', label: 'Your shop at a glance: the money in your wallet, shelf space and the counter’s jobs' },
      { file: 'release.png', label: 'Hand over a parcel: the customer’s code, and the parcels waiting on your shelf' },
      { file: 'accept.png', label: 'Take in a parcel: scan its label and measure it; the size is worked out for you' },
    ],
    chats: true,
  },
  genesis: {
    base: '/send/',
    name: 'SeeBuyGet Send',
    short: 'SBG Send',
    description: 'Send a parcel on the SeeBuyGet network: see the price before you decide, drop it at a shop near you, and follow it until it is collected.',
    devPort: 5176,
    previewPort: 5186,
    shortcuts: [
      { go: 'send', name: 'Send a parcel', short: 'Send', description: 'See the price before you decide' },
      { go: 'track', name: 'Track a parcel', short: 'Track', description: 'Type the tracking code from your message' },
      { go: 'parcels', name: 'My parcels', short: 'My parcels', description: 'Everything you send and receive, in one place' },
    ],
    screenshots: [
      { file: 'send.png', label: 'What are you sending? Measure it, and the size comes from the numbers' },
      { file: 'track.png', label: 'Where is my parcel? Every step, and the shop it waits at' },
      { file: 'parcels.png', label: 'My parcels: what is coming to you, and what you are sending' },
    ],
    chats: true,
  },
  fleet: {
    base: '/fleet/',
    name: 'SeeBuyGet Fleet',
    short: 'SBG Fleet',
    description: 'Dispatch and follow a fleet on the SeeBuyGet network: who is on shift in which vehicle, the loads you put on them, the runs you sell space on and the orders you carry.',
    devPort: 5177,
    previewPort: 5187,
    shortcuts: [
      { go: 'dispatch', name: 'Dispatch a load', short: 'Dispatch', description: 'Put a load on one of your drivers on shift' },
      { go: 'sessions', name: 'Shifts', short: 'Shifts', description: 'Who drives which vehicle today' },
      { go: 'runs', name: 'Runs', short: 'Runs', description: 'The departures you sell space on' },
      { go: 'orders', name: 'Orders', short: 'Orders', description: 'Your shippers’ orders, by the day they must arrive' },
    ],
    screenshots: [
      { file: 'dash.png', label: 'Your fleet at a glance: vehicles, drivers on shift and cargo moving' },
      { file: 'sessions.png', label: 'Shifts: who drives which vehicle today' },
      { file: 'runs.png', label: 'Runs: the departures you sell space on, and what is left on each' },
    ],
    chats: true,
  },
  mdp: {
    base: '/mdp/',
    name: 'SeeBuyGet Hub',
    short: 'SBG Hub',
    description: 'Run a SeeBuyGet sort hub: take in the bags and the stores’ parcels coming in, scan each parcel to the bag it goes in, and load the bags onward.',
    devPort: 5178,
    previewPort: 5188,
    shortcuts: [
      { go: 'arrivals', name: 'Coming in', short: 'Coming in', description: 'Stores’ parcels arriving in bulk' },
      { go: 'drop', name: 'Drop a bag', short: 'Drop a bag', description: 'Scan the bag the bus brought in' },
      { go: 'sort', name: 'Sort parcels', short: 'Sort', description: 'Scan a parcel: the screen answers which bag it goes in' },
      { go: 'load', name: 'Load a bag onward', short: 'Load a bag', description: 'Hand a bag to the driver taking it on' },
    ],
    screenshots: [
      { file: 'home.png', label: 'Your hub at a glance: parcels to sort and the bags going out' },
      { file: 'sort.png', label: 'Sort parcels: scan one, and the screen says which bag it goes in' },
    ],
  },
  vendor: {
    base: '/vendor/',
    // The Store app: what the front door and the app itself call it (its folder keeps the older name, vendor).
    name: 'SeeBuyGet Store',
    short: 'SBG Store',
    description: 'Ship your store’s orders on the SeeBuyGet network: make labels from your buyers’ checkouts, follow every shipment, and keep your prepaid balance and your books.',
    devPort: 5179,
    previewPort: 5189,
    shortcuts: [
      { go: 'mint', name: 'Ship an order', short: 'Ship', description: 'A label from a buyer’s checkout, or by hand' },
      { go: 'orders', name: 'Orders', short: 'Orders', description: 'Every shipment, and where it is' },
      { go: 'dock', name: 'Dock', short: 'Dock', description: 'Let a driver collect from your own door' },
      { go: 'books', name: 'Bookkeeping', short: 'Books', description: 'Your balance, payments and settlements' },
    ],
    screenshots: [
      { file: 'orders.png', label: 'Your prepaid balance, and every shipment with where it is' },
      { file: 'mint.png', label: 'Ship an order: start from a buyer’s checkout' },
    ],
    chats: true,
  },
  /**
   * B1 — the Business app: shippers, importers, expeditors, clearing agents and container yards, run by the
   * people in them, each signed in with their own phone and PIN (the user, 2026-10-04: separate from the
   * staff console). Built for a desk first and usable on a phone.
   *
   * It shows papers and containers somebody is about to act on, and a cached copy would be a copy that lies — which is
   * why, for a long time, it did not install at all. Since 2026-11-02 it installs (the owner: "can the business app also
   * get the sticky 'install this app, how' … It works very well"), and the reason still holds, because what installing
   * keeps on the phone is the APP and never its data:
   *  - its service worker precaches only its own scripts, styles, icons and page, as every leaf app's does: no runtime
   *    caching of any kind (that is the front page's alone, below), so not one answer from the API is ever kept by it;
   *  - push-sw.js, which it imports, shows a notification and opens a window — it handles no fetch and keeps nothing;
   *  - and the app's own read cache (shared/readcache.ts), which answers the other apps' reads from the phone in a dead
   *    spot, is switched off for this one (keepNoReads in its main.tsx). Without a signal its screens say they cannot
   *    reach SeeBuyGet, as they did before; they never show what they last knew as if it were now.
   */
  business: {
    base: '/business/',
    name: 'SeeBuyGet Business',
    short: 'Business',
    description: 'Ship, import and clear goods on the SeeBuyGet network, for your whole team: post loads and book space on carriers’ runs, send parcels, and follow your exports and imports with their papers — each person with their own sign-in.',
    devPort: 5182,
    previewPort: 5192,
    // Its sections (logic.ts Section; app.tsx SECTIONS): one a business does not do opens its overview.
    shortcuts: [
      { go: 'loads', name: 'Loads', short: 'Loads', description: 'Post a load, or follow the ones on the road' },
      { go: 'exports', name: 'Exports', short: 'Exports', description: 'Goods going out through a port, and their papers' },
      { go: 'imports', name: 'Imports', short: 'Imports', description: 'Containers coming in, and where they are' },
      { go: 'parcels', name: 'Parcels', short: 'Parcels', description: 'Send a parcel from one of your places' },
    ],
    screenshots: [
      { file: 'home.png', label: 'Your business at a glance: SeeBuyGet’s check, and the work it does' },
      { file: 'loads.png', label: 'Loads: post one, see the prices carriers offer, and follow it to the door' },
      { file: 'parcels.png', label: 'Parcels: your parcel balance, and every parcel sent from your places' },
    ],
  },
  /**
   * The operator console — the first app in this family built for a LARGE SCREEN and a mouse, for the
   * people who operate the network rather than use it. Not installable (see `installable` above), and
   * it is deliberately not on the front door's role chooser: nobody joins as an operator.
   */
  tower: {
    // Its own address, so it sits at the root of it — and nowhere under the public site.
    base: '/',
    standalone: true,
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

/**
 * The web manifest of one app — exported so a test can hold every app's to what it promises (src/shared/manifest.test.ts):
 * each shortcut a screen of that app, each picture there at its size.
 *
 * Relative addresses resolve against the manifest's own (e.g. /agent/manifest.webmanifest), so they stay right if the
 * base moves: `./?go=accept` is /agent/?go=accept, and icons/… is /agent/icons/….
 */
export function manifestFor(id: AppId): Partial<ManifestOptions> {
  const spec: AppSpec = APPS[id];
  return {
    id: spec.base,
    name: spec.name,
    short_name: spec.short,
    description: spec.description,
    scope: spec.base,
    start_url: spec.base,
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
    // 2026-11-02 — holding the icon offers the app's most common jobs, each straight to its screen.
    shortcuts: (spec.shortcuts ?? []).map((s) => ({
      name: s.name,
      short_name: s.short,
      description: s.description,
      url: `./?go=${s.go}`,
      icons: [
        { src: `icons/shortcuts/${s.go}-96.png`, sizes: '96x96', type: 'image/png' },
        { src: `icons/shortcuts/${s.go}-192.png`, sizes: '192x192', type: 'image/png' },
      ],
    })),
    // 2026-11-02 — the install window shows these beside the description, as a store page would. A phone's, so 'narrow'.
    screenshots: (spec.screenshots ?? []).map((s) => ({
      src: `screenshots/${s.file}`,
      sizes: '780x1688',
      type: 'image/png',
      form_factor: 'narrow' as const,
      label: s.label,
    })),
    /*
     * 2026-11-02 — ONE WINDOW. A shortcut, something shared to the app or a tapped notification brings the window already
     * open forward and hands it the address (window.launchQueue, read by shared/launch.ts) instead of opening a second
     * copy of the app beside the first; with no window open, the browser does what it always does.
     */
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
    /*
     * 2026-11-02 — IN THE SHARE LIST, for the apps with conversations: a text, a link, or PHOTOS shared from another app.
     * Photos cannot ride in an address, so the share is a POST — answered on the phone by the app's own service worker
     * (scripts/push-sw.js), never by the server: it keeps the photos in the app's cache and opens the app at
     * `?share_files=<name>`, or, for words and a link alone, at `?share_title=…&share_text=…&share_url=…` exactly as the
     * GET share used to (shared/launch.ts reads both). A photo is then filed to a load or a parcel, never sent loose (the
     * owner: "Damage claims should be fingerprinted and just sharing blurs this"). Android puts a shared link in `text`.
     * Should a POST ever reach the server instead (a phone that cleared the worker), the edge sends it back to the app at
     * `?share_files=lost`, which says so (Caddyfile).
     */
    ...(spec.chats
      ? {
          share_target: {
            action: './share-target',
            method: 'POST' as const,
            enctype: 'multipart/form-data' as const,
            params: { title: 'share_title', text: 'share_text', url: 'share_url', files: [{ name: 'share_files', accept: ['image/*'] }] },
          },
        }
      : {}),
  };
}

/** The root app ships at '/', so its output and service-worker scope cover every sibling. */
const IS_ROOT = BASE === '/' && !('standalone' in app && app.standalone);
/** An app on its own address — see AppSpec.standalone. */
const STANDALONE = 'standalone' in app && app.standalone === true;
/** Whether this app ships a manifest and a service worker at all — see AppSpec.installable. */
const INSTALLABLE = app.installable !== false;
/** Every OTHER app's deploy folder, e.g. ['driver', 'agent', …] — used to fence the root SW. */
const SIBLING_DIRS = Object.values(APPS)
  .map((a) => a.base.replace(/^\/|\/$/g, ''))
  .filter(Boolean);
/**
 * The front door's files a first visit does NOT download into its offline store: every page but the front page (its own
 * HTML, kept when it is first opened), the help's words and screen, the fonts only the app screens use, and the build's
 * own pre-rendering code. See `runtimeCaching` below. And the picture a shared link shows (img/share-card.png): only a
 * messenger fetches it, never a page.
 */
const ROOT_ON_DEMAND = ['help/**', 'towns/**', 'directory/**', 'assets/DirectoryScreen-*', 'for/**', 'about/**', 'terms/**', 'privacy/**', 'cookies/**', 'help.html', 'assets/en.help-*', 'assets/HelpScreen-*', 'assets/prerenderEntry-*', 'assets/inter-*', 'assets/bricolage-grotesque-latin-wdth-*', 'img/share-card.png'];
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

      // The name, icons, shortcuts, install pictures, one window and the share list — manifestFor above.
      manifest: manifestFor(APP_ID),

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
          // 2026-11-09 — the camera reader for a phone whose browser has none (an iPhone): fetched only there, the first
          // time it scans, and kept by the rule in runtimeCaching — an Android phone never downloads it.
          '**/zxingDetector-*.js',
          // 2026-11-09 — the apps' words in each language: fetched when that language is chosen, kept by the rule below.
          '**/words-*.js',
          // 2026-11-02 — the install window's pictures and the shortcuts' icons are fetched by the phone when the app is
          // installed, never by a page: ~400 KB a first visit on a 2G phone would download for nothing.
          'screenshots/**',
          'icons/shortcuts/**',
          ...(IS_ROOT ? SIBLING_DIRS.map((d) => `${d}/**`) : []),
          ...(IS_ROOT ? ROOT_ON_DEMAND : []),
        ],
        /*
         * WHAT THE FRONT DOOR KEEPS ONLY ONCE IT HAS BEEN USED (the user, 2026-10-23: "the loading time of the homepage
         * should be short for a low quality phone with poor connection"). Everything precached is downloaded on the first
         * visit, whatever the visitor came for: it was 120 files, 2.4 MB — every help article and town page as HTML, every
         * font, the help's words. Those are kept here when they are first opened, and offered from here offline after.
         */
        runtimeCaching: [
          // 2026-11-09 — the camera reader (zxingDetector, left out of the precache above), kept once a phone without a
          // reader of its own has fetched it: it scans offline from then on. In every app, which each scan.
          {
            urlPattern: ({ url }: { url: URL }) => /\/assets\/zxingDetector-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst' as const,
            options: { cacheName: 'sbg-scanner', expiration: { maxEntries: 4, maxAgeSeconds: 180 * 24 * 3600 } },
          },
          // 2026-11-09 — the words of the language its reader chose (left out of the precache above): kept once fetched, so
          // the app speaks it offline from then on. Code, never a read.
          {
            urlPattern: ({ url }: { url: URL }) => /\/assets\/words-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst' as const,
            options: { cacheName: 'sbg-words', expiration: { maxEntries: 120, maxAgeSeconds: 365 * 24 * 3600 } },
          },
          ...(IS_ROOT
            ? [
                {
                  urlPattern: ({ request, url }: { request: Request; url: URL }) => request.mode === 'navigate' && /^\/(help|towns|directory|for|about|terms|privacy|cookies)(\/|$)/.test(url.pathname),
                  handler: 'NetworkFirst' as const,
                  options: { cacheName: 'sbg-pages', networkTimeoutSeconds: 6, expiration: { maxEntries: 40, maxAgeSeconds: 30 * 24 * 3600 } },
                },
                {
                  urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/assets/') && /\.(?:js|css|woff2)$/.test(url.pathname),
                  handler: 'CacheFirst' as const,
                  options: { cacheName: 'sbg-assets', expiration: { maxEntries: 60, maxAgeSeconds: 90 * 24 * 3600 } },
                },
              ]
            : []),
        ],
        navigateFallback: `${BASE}index.html`,
        /**
         * Never serve an app shell for an API path — nor, from the root worker (whose scope
         * is the WHOLE origin), for a sibling app's route: without this, navigating to
         * /driver/ before that app is cached renders the LANDING page at the driver's URL.
         */
        // The pages kept on demand (above) are their own finished HTML: never answered with the front page's shell.
        navigateFallbackDenylist: [/^\/v1\//, ...(IS_ROOT ? SIBLING_DIRS.map((d) => new RegExp(`^/${d}/`)) : []), ...(IS_ROOT ? [/^\/(help|towns|for|about|terms|privacy|cookies)(\/|$)/] : [])],
      },

      // Keep the service worker out of dev (also avoids writing an ungitignored dev-dist/).
      devOptions: { enabled: false },
    }),
  ];
}

// Output mirrors the deploy path, not the app id (genesis ships at /send/), so the
// whole of dist/ can be copied to a web root and every base resolves as built.
// A standalone app (the console) builds beside the public site, never inside it.
const OUT_DIR = STANDALONE ? resolve(ROOT, 'dist-console') : resolve(ROOT, 'dist', BASE.replace(/^\/|\/$/g, ''));

export default defineConfig({
  root: APP_DIR,
  base: BASE,
  // envDir defaults to `root`; without this, VITE_SBG_API (read by src/lib/sbg/config.ts)
  // would be looked up in src/apps/<app>/.env instead of frontend/.env.
  envDir: ROOT,
  publicDir: resolve(APP_DIR, 'public'),

  plugins: [
    preact(
      /*
       * THE FRONT PAGE IS PRERENDERED: built to finished HTML, then hydrated. Crawlers that do not run script — most
       * AI ones — read the HTML the server sends, and to them a client-rendered page is an empty <div>. Only the
       * front door, whose job is to be found; the apps behind sign-in have nothing to show a crawler.
       */
      APP_ID === 'home' ? { prerender: { enabled: true, renderTarget: '#app', prerenderScript: resolve(APP_DIR, 'prerender.tsx').replace(/\\/g, '/') } } : undefined,
    ),
    cleanRootAssetsPlugin(),
    ...(INSTALLABLE ? installablePlugins() : []),
  ],

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
    emptyOutDir: BASE !== '/' || STANDALONE,
    target: 'es2020',
    rollupOptions: {
      input: { [APP_ID]: resolve(APP_DIR, 'index.html') },
      /*
       * THE BUILD-TIME SCRIPT STAYS OUT OF WHAT A VISITOR DOWNLOADS. Left to itself, the prerender plugin sets a chunking
       * rule that puts its script (prerender.tsx: the page heads, the help's words, render-to-string) in the chunk the
       * page starts from. It finds that script by its path, which never matched on Windows — so the builds here split
       * cleanly — and does on Linux, where the release is built: there the homepage started from that chunk, 20 KB
       * heavier, and outside the first visit's offline copy, which leaves the prerender entry out (2026-10-23). A rule
       * of our own makes the plugin leave chunking alone, on every machine. The modulepreload polyfill keeps the chunk
       * the plugin gave it. scripts/check-start.mjs checks the built page after every build.
       */
      output: {
        ...(APP_ID === 'home' ? { manualChunks: (id: string) => (id.includes('vite/modulepreload-polyfill') ? 'index' : undefined) } : {}),
        /*
         * 2026-11-09 — A LANGUAGE'S WORDS, NAMED FOR IT (words/<locale>/<catalogue>.ts → words-<locale>-<catalogue>-…js): so
         * the precache can leave them out and the phone fetches only the language its reader chooses (the rule below keeps
         * it). Every language was downloaded by every phone before — Kiswahili onto a Dutch phone, Dutch onto a Kenyan one.
         */
        chunkFileNames: (chunk: { facadeModuleId?: string | null }) => {
          const m = /\/i18n\/words\/([a-z]{2,3})\/([\w-]+)\.ts$/.exec((chunk.facadeModuleId ?? '').replace(/\\/g, '/'));
          return m ? `assets/words-${m[1]}-${m[2]}-[hash].js` : 'assets/[name]-[hash].js';
        },
      },
    },
  },

  server: {
    port: app.devPort,
    // The apps import ../../lib/sbg and ../../shared, which live outside `root`.
    fs: { allow: [ROOT] },
    /**
     * IN DEV, THE FRONT DOOR STANDS IN FOR THE WHOLE SITE — as it does in production.
     *
     * Deployed, every app is one origin: `/`, `/driver/`, `/agent/`. So the sign-in router links to
     * `/driver/` and that is correct. In dev each app is its own server on its own port, and `/driver/`
     * on the root app's port is just… the root app — served back by its own navigate fallback. Clicking
     * "driver" on "I already work with SeeBuyGet" returned you to the front door, which is what the user
     * reported, and it made the whole sign-in path untestable without anybody noticing for months.
     *
     * The divergence is the bug, so this closes it rather than teaching the client about ports: the root
     * dev server proxies each sibling's base to that sibling's dev server, off the SAME `APPS` table that
     * defines the deploy paths. One origin in dev too — which also means the hand-off after sign-up
     * (localStorage, and localStorage is per ORIGIN) reaches the app it is handing off to.
     *
     * A sibling that is not running gives a proxy error, which is a far better answer than silently
     * rendering the front door at another app's address.
     */
    ...(IS_ROOT
      ? {
          proxy: Object.fromEntries(
            Object.values(APPS)
              .filter((a) => a.base !== '/')
              .map((a) => [a.base, { target: `http://localhost:${a.devPort}`, changeOrigin: false, ws: true }]),
          ),
        }
      : {}),
  },

  preview: {
    port: app.previewPort,
  },
});
