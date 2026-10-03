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
SBG_APP=home npm run dev      # or driver, agent, fleet, mdp, vendor, genesis, tower
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

## Conventions
- **Every slice names its screens.** A backend change with no surface is tracked ui-debt, not a shipped slice.
- **i18n per slice**: new English keys go in `src/shared/i18n/catalogs/`; the other locales get a central
  pass, not per-slice dribs. `t()` does no pluralising — plurals are a key PAIR (`…One` / `…Many`).
- **The contract is generated**: `cd ../backend && npm run spec` then `npm run types` here. `schema.d.ts`
  is gitignored and rebuilt.
- `npm test` (vitest) and `npm run typecheck` both have to be clean before a commit.
