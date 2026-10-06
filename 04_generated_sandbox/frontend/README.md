# GLOS Frontend Sandbox

The SeeBuyGet front end: seven installable PWAs, the operator console, and the two legacy vanilla
consoles they are replacing — against the NestJS backend in `../backend`.

## What is here
Seven installable PWAs under `src/apps/` — `home` (the front door, served at `/`), `genesis` (ships at
`/send/`), `driver`, `agent`, `fleet`, `mdp` and `vendor` — all built for a phone in a shop, a cab or a
queue.

`tower` is the eighth app and the first built for a LARGE SCREEN: the operator console, on ITS OWN ADDRESS
(see "The operator console's entrance" below — it is not part of the public site). It
is in the same build factory and uses the same tokens, and it differs in two deliberate ways. It follows
`src/shared/console.css` rather than the phone contract (density, tables, ~32px controls — with the 48px
rule restored under a coarse pointer), and it is **not installable**: no manifest, no icons beyond the
tab, and no service worker, because an operator acts on a queue and a cached queue is one that lies. See
`AppSpec.installable` in `vite.config.ts`.

`business` (B1, served at `/business/`, dev port 5182) is the Business app: shippers, importers, expeditors,
clearing agents and container yards, each person signed in with their own phone and PIN. It is part of the
PUBLIC site — customers, not staff — and is built for a desk like the console: it uses `console.css`, hosts the
console's import and yard screens unchanged, and is likewise not installable. Staff check a business in the
console's Businesses queue (two different members of staff).

`src/control-tower.html` is GONE too, and it was deleted rather than migrated. It drove the M7 module —
scenarios, disruption, network design, carbon — whose only signal source is a stub feed of Suez-canal and
Singapore port advisories: software written for a global freight forwarder, before this became a network
of shops, riders and buses. Nothing in the current cast had a use for it. The M7 backend stays (its
digital twin is fed by real parcel events and is the one half that is true here); the rest of it is
parked, not shipped.

`src/pudo-tower.html` is GONE. Every panel it had — the KPIs and coverage, the shops and hubs, the
standing alerts, the damage claims, the disposal queue, the shop applications, finance and the payout
run, the parcel lookup with its release reissue, and the illustration library — lives in the `tower` app
now, with tests and translations it never had.

Each app is its OWN Vite build with its own `base`, because Vite has one root and one base per build.
`vite.config.ts` is a factory over `APPS`; `npm run build` loops the seven public apps into `dist/`, laid out
exactly as it deploys, and the console into `dist-console/` beside it.

## Run locally

**The whole site — the only way cross-app links work.**

```bash
npm run build && npm run preview:site   # http://localhost:8080
```

The apps link to each other by absolute path (the home page's "Send or track a parcel" is `/send/`), so
they need to be served TOGETHER from one origin. `dist/` is that origin. Nothing else below serves more
than one app, and a cross-app link in any of them will appear to do nothing — in dev it re-renders the
page you are already on, because Vite's SPA fallback answers `/send/` with the current app's shell.

**One app, with hot reload.**

```bash
SBG_APP=home npm run dev      # or driver, agent, fleet, mdp, vendor, genesis, business, tower
```

Each app has its own dev port (see `APPS` in `vite.config.ts`). The service worker is off in dev on
purpose.

**The operator console.**

```bash
SBG_APP=tower npm run dev     # http://localhost:5181/
```

Sign in as network staff (the seed prints `ops1@sbg.test` / `seebuyget-staff`). In a sandbox two-step
sign-in is offered in Settings rather than forced, so the scripts still sign in with a password; set
`GLOS_STAFF_TWO_STEP=required` on the backend to behave like production. The setup key (the server's
`GLOS_CLIENT_SECRET`, any value on a sandbox) is a quiet link under the form. The session lives in
`sessionStorage` only: closing the tab signs the console out.

**No page is served statically any more.** `src/` is source plus the site files the build copies into
`dist/`; the `http-server` scripts that used to serve it on 4173 went with the last vanilla page, and
there is no `src/index.html`.

The backend must be running for any of it: `cd ../backend && npm run start:dev` (port 3000).

## The public site: what search engines and AI assistants read

The front page and one page per town (`/towns/<slug>/`) are **prerendered** — built to finished HTML with a
title, a description and structured data, then taken over by the app in the browser (`src/apps/home/prerender.tsx`).
A full build then writes `robots.txt`, `sitemap.xml` and `llms.txt` into `dist/` from the pages it actually made
(`scripts/seo-files.mjs`). Two settings at BUILD time:

- `SBG_PUBLIC_URL` — the site's own address (e.g. `https://seebuyget.com`). Without it there is no sitemap, no
  canonical address and no link-preview image.
- `VITE_SBG_API` — where the build fetches the town pages from. A build that cannot reach it still makes the front
  page, with no town pages (it says so).

Serve `dist/towns/<slug>/index.html` at `/towns/<slug>/` — any static host does. Rebuild when towns change (a
nightly build is plenty); the live figures on the page are fetched in the browser either way.

## The operator console's entrance

The user, 2026-10-03: the staff entrance must not be obvious, and must be professional. Four layers, each
useful without the others:

1. **Its own address.** The console builds to `dist-console/` (`AppSpec.standalone` in `vite.config.ts`), never
   into `dist/`. Deploy it to a host of its own — e.g. `ops.seebuyget.com` — and nothing on the public site
   links to it, lists it in the sitemap, or names it in `robots.txt`. Its page says `noindex` as well.
2. **A gate at the edge, before any page loads.** Put the console's host behind Cloudflare Access (an
   allow-list of staff email addresses, one-time PIN or the company's identity provider) or an office/VPN
   allow-list at the web server. A stranger who finds the address gets the gate, not a sign-in form.
3. **Two-step sign-in.** A password, then the code an authenticator app shows (any app; no Google account,
   no OAuth). Required outside a sandbox: a member of staff without it is shown a QR code at sign-in and
   the first code turns it on. A lost phone is reset by two OTHER members of staff (Network → Network
   staff → Reset two-step).
4. **A network fence on the API.** `GLOS_STAFF_NETWORKS` on the backend (comma-separated addresses and IPv4
   ranges) refuses staff sign-in, the setup key and every staff token from anywhere else. Unset = off.
   Behind a proxy, set `GLOS_TRUST_PROXY` (e.g. `1`) so the backend sees the caller's address, not the proxy's.

Backend settings that go with it: `SBG_CONSOLE_URL` (the console's address, for the buttons in staff
emails), `GLOS_STAFF_NETWORKS`, `GLOS_STAFF_TWO_STEP=required` (to force it in a sandbox), and
`GLOS_TRUST_PROXY`, and `GLOS_VAULT_KEY` (authenticator secrets are encrypted under it).

## The fleet's planning panel: two backend settings

Both are optional, and the plan is whole without either.

- **Road distances.** `GLOS_ROUTER_URL` is the address of an OSRM-compatible routing server (one you host, or
  anybody's that speaks the protocol — no Google). A day's plan then asks its `table` service once for every
  place of the day and is made on road distances; the board says "by road". Unset, unreachable, slow (4 s),
  or answering with anything that is not a table, the plan is made on the estimate it always was, and the board
  says which and why. `GLOS_ROUTER_MAX_POINTS` (default 100) is the most places one request carries — raise it
  only if the server's own `--max-table-size` was raised; `GLOS_ROUTER_PROFILE` (default `driving`) is the
  routing profile. Only coordinates are sent. Only DISTANCE is taken: a leg's time is still the office's own
  speed over it.
- **The adviser.** `ANTHROPIC_API_KEY` switches on "Ask about this plan". Without it the board says the adviser
  is not switched on. What is sent is said on the screen: the dispatcher's words and the plan.

Staff read where both stand in the operator console, under Setup → **Connections**: set up or not, what the last
plan (or the last office to ask the adviser) met since the server started, and a "Check it now" for the routing
server. The address is shown as its host only and the key never; nothing is changed from that screen.

## Conventions
- **Every slice names its screens.** A backend change with no surface is tracked ui-debt, not a shipped slice.
- **i18n per slice**: new English keys go in `src/shared/i18n/catalogs/`; the other locales get a central
  pass, not per-slice dribs. `t()` does no pluralising — plurals are a key PAIR (`…One` / `…Many`).
- **The contract is generated**: `cd ../backend && npm run spec` then `npm run types` here. `schema.d.ts`
  is gitignored and rebuilt.
- `npm test` (vitest) and `npm run typecheck` both have to be clean before a commit.
