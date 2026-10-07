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

The same screen says where **email and push** go, and reads "does anything leave" off the sender the server was
started with, never off a variable that happens to be set.

- **Email** is sent through ZeptoMail (renamed Zoho CPaaS in 2026) when the server starts with BOTH
  `ZEPTOMAIL_TOKEN` (the account's Send Mail token, with or without its `Zoho-enczapikey ` prefix) and
  `ZEPTOMAIL_URL` (the sending address exactly as the account's own API page shows it — a host, or the whole
  `…/v1.1/email`). There is no default address: the host differs by data centre, and a token sent to the wrong
  one is refused in words that blame the token. It must be https. Without both, `OutboxMailSender` KEEPS every
  email (readable on a sandbox at `/v1/mail/outbox`) and the screen says what is missing. `MAIL_FROM_ADDRESS`
  must be on a domain the provider has verified. A failed email is tried once more only where nothing says the
  first was taken; there is no queue behind that, and the screen counts what failed and says whose it is to
  put right. An address on a domain reserved for examples (`example.com`, `.example`, `.test`) is never handed
  to the provider — so a sandbox given a real token does not mail its seeded people.
  NOT YET SENT THROUGH THE REAL PROVIDER: it is tested against a stand-in that answers in the provider's
  documented shapes (`foundation/mail/zeptomail.sender.spec.ts`). Watch the first real send on Connections.
- **The emails' house style** (`foundation/mail/mail.brand.ts`, rules in `brand/README.md`). Every email is one
  layout in the identity's colours. The LOGO is the identity's `logo-horizontal-on-dark`, carried INSIDE each
  email as an inline picture — it needs no hosting, shows where remote pictures are blocked, and tells nobody
  the email was opened; `MAIL_LOGO_URL` (https) hosts it instead and makes each email 11 KB smaller. The
  TYPEFACES are the identity's two, named first in every email with the reader's own behind them: Bricolage
  Grotesque for the heading, Inter for everything read. A mail client that fetches typefaces (Apple Mail does;
  Gmail and Outlook never do) is told where they are only when `MAIL_FONT_URL` is set — this server serves
  them itself at `/v1/mail/font`, so that is usually `https://<the API's public address>/v1/mail/font`.
  See all of them on a sandbox at `/v1/mail/preview`, each also "as Gmail and Outlook show it".
- **A file goes by LINK, never in the email** (decided 2026-10-07: "keep the files on our own server, and put a
  link in the email … attachments only as an occasional extra"). A file in a mailbox cannot follow the
  twelve-month keeping rule, cannot be taken back and cannot be seen to have been opened. So the receipt for a
  delivered load carries a button to its consignment-note bundle (`modules/pudo/document-link.service.ts`): a
  256-bit key the server never keeps (only its SHA-256), carried after the `#` of the front door's address
  (`/#doc=…`) so that no server or log sees it, and sent back in a request BODY. It opens one document as the
  party it was made for reads it; it stops after 30 days, after 25 openings, when it is cancelled, or when the
  document passes its keeping; it is NOT used up by being looked at (mail scanners follow links). The party sees
  each link on the note (address masked, times opened) and can cancel it. Public routes:
  `POST /v1/sbg/document-links/look|fetch`, rate-limited. A party also MAKES a link itself to pass on
  (`POST consignment-notes/:docId/links`): the address comes back once and is never kept; at most five links
  per party per note work at a time; staff cannot make one; and a business's view-only member can neither make
  nor cancel one (`BusinessMemberGuard` on the controller). A cancelled link says who cancelled it.
- **A business's receipt goes to a person**, because a business has no mailbox of its own
  (`BusinessService.receiptPeople`): whoever posted the load, at their own recovery email; its owners when that
  person has left or has given no address. Which person posted is kept by the business (`notePosted`), never on
  the load — a load is read by every carrier on the board. Each person gets their own link, the receipt's links
  count against the five, and **when somebody is taken out of a business or leaves it, the links emailed to
  them stop at once** (`onMemberGone` → `DocumentLinkService.cancelSentTo`; the row says `cancelledWhy: left`).
  Links they made for the business to pass on are the business's, and keep working. In the Business app the
  file and the links are on the load itself (`apps/business/screens/LoadNote.tsx`), driven by the same hook as
  the archive in the other apps (`shared/archive/useNoteLinks.ts`); `GET dispatch/posted` says where a load's
  note is (`noteId`) once a copy is kept. See the business's variant of the email at
  `/v1/mail/preview/freight-delivered?as=business`.
- **Push** is still kept by `OutboxPushSender`: no push leaves the server. The keys (`GLOS_VAPID_PUBLIC`,
  `GLOS_VAPID_PRIVATE`) are judged from the pair: the server's own, the pair written in the source, or two that
  do not belong together.

"Kept, not sent" is the normal state of a sandbox; with `GLOS_ENV=production` the same state is said as a fault,
because there it is people who are never told.

## Conventions
- **Every slice names its screens.** A backend change with no surface is tracked ui-debt, not a shipped slice.
- **i18n per slice**: new English keys go in `src/shared/i18n/catalogs/`; the other locales get a central
  pass, not per-slice dribs. `t()` does no pluralising — plurals are a key PAIR (`…One` / `…Many`).
- **The contract is generated**: `cd ../backend && npm run spec` then `npm run types` here. `schema.d.ts`
  is gitignored and rebuilt.
- `npm test` (vitest) and `npm run typecheck` both have to be clean before a commit.
