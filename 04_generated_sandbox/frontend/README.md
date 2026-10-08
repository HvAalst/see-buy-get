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
  must be on a domain the provider has verified. A failed email is tried once more at once only where nothing
  says the first was taken. **Then it is tried again later** (`MailService.tryWaiting`) when three things hold:
  nothing says the provider took it (`MailSendError.later` — it was unreachable, a gateway said it was not there,
  or it refused the ACCOUNT, which somebody can put right), the email is one still worth having late (every
  template states `sendLater`: hours, or `false` — a code is never sent late), and it has not waited past that.
  After a minute, five, fifteen, then hourly; at most 500 wait; one "no" to the account ends that look, so a
  provider's bad minute is not answered with a flood. WHAT WAITS, WAITS IN MEMORY — an address is vault-kept
  and a link's key is kept nowhere, so neither is written to disk to wait — and a restart forgets it: the
  screen says how many are waiting, went late, or were given up on, and whose a failure is to put right.
  **Email that comes back** is heard of when `ZEPTOMAIL_WEBHOOK_KEY` is set: add a webhook at the provider
  for hard and soft bounces, pointed at `https://<the API>/v1/mail/provider/events`, and set its
  "authentication key" as that variable. Without the key the address answers 404. A notice is taken only when
  its `producer-signature` (HMAC-SHA256) matches the body — read as RAW BYTES, which `main.ts` arranges with
  `readProviderEventsRaw(app)` before any parser (a module cannot; left out, every notice is refused and the
  screen says "not_raw"). The receiver is built from the provider's documentation, which leaves open how the
  body is wrapped, so it accepts the forms that documentation implies (`foundation/mail/mail-bounces.ts`) and
  has NEVER received a real one. A hard bounce stops an address being written to until its owner reads a code
  sent there and types it in (`MailService.addressWorks`); a code always goes (`MailTemplate.asked`); a soft
  bounce pauses an address for a day. Only the address's key is kept (`hashEmail`), never the address, and a
  person whose recovery email came back is told in Settings in their own app (`PersonView.emailBounced`). An
  address on a domain reserved for examples (`example.com`, `.example`, `.test`) is never handed
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
  Links they made for the business to pass on are the business's, and keep working. The same when somebody
  REPLACES their recovery email: every link sent to the old address stops (`PersonService.onEmailChanged`,
  fired where the address is set; `cancelledWhy: address`) — a mailbox no longer vouched for is not a place
  to leave a way into anybody's papers. In the Business app the
  file and the links are on the load itself (`apps/business/screens/LoadNote.tsx`), driven by the same hook as
  the archive in the other apps (`shared/archive/useNoteLinks.ts`); `GET dispatch/posted` says where a load's
  note is (`noteId`) once a copy is kept. See the business's variant of the email at
  `/v1/mail/preview/freight-delivered?as=business`.
- **Push** is still kept by `OutboxPushSender`: no push leaves the server. The keys (`GLOS_VAPID_PUBLIC`,
  `GLOS_VAPID_PRIVATE`) are judged from the pair: the server's own, the pair written in the source, or two that
  do not belong together.

"Kept, not sent" is the normal state of a sandbox; with `GLOS_ENV=production` the same state is said as a fault,
because there it is people who are never told.

## Getting back into an account: what a person can do, and what takes two of us
The account is the phone number. Three ways back, in the order a person meets them (all in the shared sheets,
so every app has them — `shared/account/SettingsSheet.tsx`, `TroubleSheet.tsx`):
- **Still knows the PIN**: moves the number themselves, signed in (Settings → Phone number).
- **Number gone, PIN forgotten**: the recovery email is the way back (Trouble signing in → the number is gone),
  with the national ID where the account has one.
- **No number, no PIN, no inbox**: two members of staff move it (decided 2026-10-01: "2 seebuyget staff can
  move an account"). `modules/pudo/account-move.service.ts`. The person ASKS, signed out (Trouble signing in →
  Ask SeeBuyGet staff): the new number is proved by a code, a reference `MV-XXXX-XXXX` is handed back, and the
  answer is the same whether or not the old number has an account. One member of staff CHECKS who is asking
  and writes down what was checked; a SECOND, different one approves (console → Account moves; `staffOf` tells
  two people apart by their sign-in, so outside a sandbox the shared operator key is refused). The move is the
  ordinary one (`AccountRecoveryService.moveByStaff`): the holder is told, every session ends, and it can be
  undone for 24 hours with the old number and the PIN as it was.
- **What stops it** — because it is also what somebody after another person's account would ask for: the
  holder is told the moment it is asked (app + email); signed in, Settings shows it with "It was not me: stop
  it" (`POST account/move-requests/stop`, keyed to the token); and if the account's PIN is used after the
  request was made — `Person.pinUsedAt`, written by the one check every PIN goes through — the request is
  stopped at the next staff step instead of moving anything. A request lapses after 14 days.
- **What is never kept or shown**: a whole phone number (keys and last three digits; the new number sits in
  the vault until the request ends, then is blanked) and the national ID the asker typed (only whether it
  matched). The asker reads the outcome with the reference (`POST identity/move-requests/status`) — nothing we
  send can reach somebody with no number, PIN or inbox.

## A national ID two people say is theirs
A driver and a shop each register with a national ID number and the network keeps one of each, so somebody whose
number another registration holds cannot register at all. The user decided how it is settled (2026-10-08): staff
see "a selfie with the holder showing it's ID back and front"; "staff decide from the photos, if that is still
disputed they can make an appointment in person. our system will generate a ticket with instructions and what
they need to bring for the appointment date." `modules/pudo/id-dispute.service.ts`.
- **Two people, a reference each** (`ID-XXXX-XXXX`), and everything either of them does is by their own
  reference (`POST identity/id-disputes/…`): the one refused may have no account at all. They OPEN it with a
  phone confirmed by a code; the holder is shown theirs in Settings. One sheet for both:
  `shared/account/IdDisputeCase.tsx`, reached from Trouble signing in, from Settings, and from the refusal
  itself where somebody registers (`apps/home` JoinScreen).
- **Three photographs each**: the person holding the card with the reference handwritten beside it, the card's
  front, the card's back. The reference in the picture is what makes it one taken for THIS. They are an
  `id_check` in the media store: owned by the dispute (no token signs in as it), seen by staff only, and gone 30
  days after the decision — or after an appointment, the one reason to keep them longer.
- **The holder is told when the claimant's photographs are sent**, not before, and has a week. They answer the
  same way — or say the number on their record was mistyped and put their own there
  (`POST account/id-disputes/own-id`, signed in), which ends it at once.
- **Two members of staff** (console → ID disputes): they type the number they read on each card and are told
  only whether it is the disputed one; one proposes whose it is, a second, different one approves (`staffOf`).
  The ID can go only to somebody whose card was read as carrying it.
- **Whoever loses keeps their account.** A registration that loses its ID is HELD (`idHold` on the driver or the
  shop): a driver fails `canOperate` — the question every way behind a wheel already asks. For a shop THE PAUSE
  IS AT MINT (the user, 2026-10-08: "the pause should be at mint indeed"): no new parcel can name it, as the
  place to hand in or to collect (`AgentService.assertNamedAtMint`, asked by `ParcelService.requireSellable`
  for every quoted mint and by the public quote routes), a walk-up cannot be taken in (`assertMayTakeIn`), and
  nothing that offers a shop for a new parcel offers it (`AgentService.takesNew`: the checkout API, first-mile
  routing, and `takesNew` on `GET network/points` for the apps' pickers). What was booked to it BEFORE the hold
  is still handed in, and everything on its shelf is still collected — so it stays on the public map. A sender
  is told which shop and to choose another, never why. Both finish what they have in hand; a hold ends when an
  ID of their own is on record. Where the holder's own card carried a different number, their record takes
  that instead and nobody is held.
- **The ID is kept for whoever won** until they register: `RegistrationPrints.keepFor` lets only a registration
  made with the phone they opened the dispute with past it.
- **Still disputed**: whoever did not get it names a day within two weeks (`…/appointment`), and both are given
  a ticket — where, when, what to bring. From that day two members of staff decide again, the decision changes
  only for somebody who came, and that is final.
- **Where and on which days is the country's own to say** (the user, 2026-10-08: "it's up to the countries to
  set visiting days and visiting hours"; "the country needs to set its address info in their admin from there
  we fetch"). Its admin is the console signed in as that company: Settings → How to reach you
  (`apps/tower/screens/ContactCardPanel.tsx`, `POST entities/:entityId/contact`): the address, the visiting days
  (`visitDays`, mon…sun) and hours (`visitFrom`/`visitTo`). An appointment is taken only on one of those days
  (`weekdayOf` — a date is a weekday wherever it is read), the app offers them as buttons rather than a
  calendar, and the ticket carries the address and the hours. Staff are shown what the company wrote and type
  none of it. Until it has written an address or ticked a day, any day may be chosen and the ticket says to ask
  first — and the dispute tells staff what is missing.
- **Its closed dates and its count are its own too** (the user, 2026-10-08: "the country should set it's own
  public holidays and/or one off closure"; "the limitation is set by the country as an actual number of
  visitors per hour. They themselves can decide how many desk workers they will dedicate for these visitation
  hours"). On the same entry: `closedDates` (a date and what the day is; the list replaces the list) and
  `visitorsPerHour`. No appointment is offered or taken on a closed date. With a number an hour, an appointment
  is for an HOUR (`visitingHours`: whole hours from when it opens to visitors), a full hour is refused, and a
  day with no hour left is not offered. One appointment counts as one visitor, whoever comes with it.
- **The days to choose from are the server's answer** (`DisputeStatus.choices`), never worked out in the app:
  only the server knows the company's days, its closed dates and what others have taken, together. The app
  shows them as buttons — days, then hours.
- **If the company changes any of it after an appointment was made** — its days, hours or closed dates, or
  starts counting by the hour — both tickets and the console say it no longer fits (`offDay`), and whoever
  made the appointment can choose again.
- **Part of the turn-on process** (the user: "it's part of the turn on process"): a company of ours is not
  ready to be switched on until its own entry has an address and visiting days with hours. `ContactCardService`
  says so to `CompanyReadinessService.also(…)`, so both are on the Company record's list of what is missing and
  the switch-on is refused by name without them.
- **Never kept or shown**: the ID number outside the vault (a keyed print finds it; "matches / differs" is all
  staff see), a whole phone number, the other person's reference.
- A shared sheet styles itself: `.chips` and the photo button are styled in a few apps' own stylesheets, so
  the sheets every app opens use `.tapset` and `.idshot` from `shared/ui/ui.css`.
- Not built: different hours on different days (one span of hours for every visiting day), and half-days.

## Conventions
- **Every slice names its screens.** A backend change with no surface is tracked ui-debt, not a shipped slice.
- **i18n per slice**: new English keys go in `src/shared/i18n/catalogs/`; the other locales get a central
  pass, not per-slice dribs. `t()` does no pluralising — plurals are a key PAIR (`…One` / `…Many`).
- **The contract is generated**: `cd ../backend && npm run spec` then `npm run types` here. `schema.d.ts`
  is gitignored and rebuilt.
- `npm test` (vitest) and `npm run typecheck` both have to be clean before a commit.
