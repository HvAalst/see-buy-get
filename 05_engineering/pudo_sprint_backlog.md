# PUDO Light — Sprint Backlog (Emerging-Market Tier 1/2 On-Ramp)

> Source: `GLOS_PUDO_Unified_Compendium.docx` Ch 12–19 + `PUDO_Control_Tower_Playbook.docx`.
> PUDO Light = GLOS Phase 1 constrained ("resilience > efficiency"). **Reuses the GLOS backbone**
> (M1 wallet, EventBus, LedgerService, IdentityVault, OperationalStore, M5). **Backend domain first**
> (`/v1/pudo/*`, no UI yet). **Full online spine** (DID-auth + ledger anchoring; offline/SMS/IMEI-lock
> deferred). Ticket ids `P-###`.

## Actors
- **Tier 1** — end customer (phone only; sender/receiver mobile on the parcel).
- **Tier 2** — PUDO **Agent** (shopkeeper): Golden Record (name + national ID + mobile + device),
  pre-paid wallet, 5-state lifecycle, runs one PUDO node (shop + chaos-shelf storage).
- **Driver** — runs a scheduled bus/truck on a static **Corridor** (zone pair) via the MDP hub.
- **Operator** — monitors the network through the Control Tower (data via these APIs; UI later).

## Reuse map (backbone → PUDO)
| PUDO need | Reused GLOS piece |
|---|---|
| Agent identity + DID | foundation `DidService` + `IdentityVault` (Golden Record PII) + `OperationalStore` |
| Pre-paid wallet | M1 `WalletService` (provision/credit/debit/balance) |
| Immutable scans/anchoring | `LedgerService` |
| Event cascade | `EventBus` (`GlosEvent.Pudo.*`) |
| Rating prompt on delivery | M5 (reuse later) |

## Sprint P1 — Backend domain
- **P-001 · Types + `GlosEvent.Pudo` group** — parcel/agent/wallet events.
- **P-002 · AgentService** — onboarding state machine `DRAFT → KYC_PENDING → APPROVED_UNFUNDED →
  ACTIVE → LOCKED`; Golden Record in the vault; DID minted; M1 wallet provisioned on activation;
  device (IMEI) recorded; `ping()`; auto-LOCK when wallet < lock threshold.
- **P-002a · Onboarding requirements (Ch 18) ✅** — the franchise **eligibility filter** (18.1) is
  enforced at registration: ≥4 m² lockable storage, ≥10 h/day, Android 10+, reliable power, valid
  trading licence, clean criminal record (COD-float = preferred, non-blocking) — ineligible
  applications rejected with the precise unmet reason. **Dedup** (18.5 DRAFT): one national ID / mobile
  / device IMEI across the network, via privacy-preserving SHA-256 fingerprints (no PII in the index).
  **KYC documents** required to reach KYC_PENDING (ID copy + trading licence + ≥1 shop photo).
  **Vetting** re-checks requirements + docs at approval. **Equipment deposit** ($50 refundable, 18.3)
  tracked. Operator **KYC review queue** (`GET /pudo/agents/kyc-queue` + a panel in the control tower:
  pending agents, their requirements + docs, one-tap Approve/Reject). Endpoints: `submit-kyc` (docs),
  `kyc-decision` (+`by`), `deposit`. 4 new unit specs; verified live.
- **P-002b · Location + coverage heatmap ✅** — registration captures a **map pin AND/OR a physical
  address** (at least one; the address is deterministically geocoded to a pin so address-only agents
  still place on the map — stub, swap for a real geocoder). New agent-controlled **open / temporarily-
  closed** state (`POST /pudo/agents/:did/availability`, Risk #30 store-closure mitigation; toggle on
  the agent app home). Admin **coverage heatmap** (`GET /pudo/heatmap`): PUDO points + density cells +
  counts by operational state (registered / open / closed / inactive) — rendered as a density layer +
  state-coloured markers in the operator control tower. This spatial picture is what feeds
  journey-**leg** planning (which PUDOs to route a parcel through). Verified live.
- **P-003 · WalletGateService (Light SSE)** — "no money, no scan" gate (`canTransact`); typed ledger
  (`TOP_UP / FEE / LABOR_PAYOUT / DRIVER_PAYOUT / REFUND / OVERDRAFT`); wholesale/retail cash spread;
  5-minute void window; reuses the M1 wallet. (Implements UDIW-040/043/044 + NFR-SSE-01 at light scale.)
- **P-004 · CorridorService** — static corridors (zone pair, scheduled vehicle, status) + drivers/buses
  + bus-vs-truck heuristic (total weight < 500 kg ⇒ Bus). (M3 light.)
- **P-005 · ParcelService** — the 3-screen flow on the backend: **Accept** (QR sticker + size +
  destination + mandatory drop-off photo → wallet charge → anchor) → **Handover** (scan driver badge →
  manifest, scan each parcel) → **Arrive + Pickup** (OTP to receiver) → **Void**; scan ledger
  `At_PUDO → On_Bus → Ready_For_Pickup → Delivered`; emits `Pudo.*`. (M2/M4 light.)
- **P-006 · MonitorService** — time-window auto-flags (Stagnant Inventory > 48 h, Ghost Bus > 6 h,
  Connectivity Loss > 2 h, Blocked Corridor) + Control-Tower **Dashboard** KPIs (parcels in transit,
  agents online, system float, critical alerts, daily volume, status mix, activity feed) + **Finance**
  health + **User/Support** parcel lookup/timeline. (M7 + M4 + SSE Finance, light.)
- **P-007 · Controller + module wiring** — `/v1/pudo/*`; import M1Module; register in AppModule + health.

## Deferred (later passes / on graduation)
Agent App UI (3 screens, WS-UX) + Operator Control Tower UI (dark control-room) ; offline-first +
sync queue ; SMS/WhatsApp gateway + OTP-over-SMS ; IMEI hard device-lock ; landmark-only addressing ;
graduation onto full M2 e-waybill / M3 dynamic matching / M5 Bayesian / SSE escrow.

## Status — Sprint P1 backend ✅ built (2026-06-28)
All P-001…P-007 done. `src/modules/pudo/`: `pudo.types.ts`, `pudo.config.ts`, `agent.service.ts`,
`wallet-gate.service.ts`, `corridor.service.ts`, `parcel.service.ts`, `monitor.service.ts`,
`pudo.controller.ts` (`/v1/pudo/*`), `pudo.module.ts` (imports M1Module). `GlosEvent.Pudo.*` added;
registered in AppModule; health lists `pudo`.

- **Reuse proven:** agent DID via `DidService`, Golden Record PII in `IdentityVault` (test asserts no
  PII in the operational core), tier-2 entry in `OperationalStore` (graduation path), pre-paid balance
  on the M1 `WalletService`, scans anchored via `LedgerService`, events on the shared bus.
- **Verified live:** 2 agents onboarded through `DRAFT→KYC_PENDING→APPROVED_UNFUNDED→ACTIVE` (activate
  on top-up); corridor + driver (heuristic → bus); 3-screen flow accept→handover→arrive(OTP)→pickup →
  Delivered with 4 anchored scans; 'no money, no scan' lockout + 5-min void refund; operator dashboard
  (float $98.90, 2/2 online) + finance roll-up.
- **Tests:** 9 PUDO unit specs + a PUDO e2e flow. Full suite **157 unit + 21 e2e green**.

## Sprint P2 — UIs + graduation ✅ built (2026-06-28)
- **P-008 · RatingService + graduation** — star rating per delivered parcel + agent-retention metric;
  writes the agent composite back to the shared `OperationalStore` (`updateReputation`) — the same
  pseudonymous core M3/M5 read, so PUDO ratings graduate onto GLOS-grade reputation with no schema
  migration. `POST /pudo/parcels/:id/rate`, `GET /pudo/agents/:did/rating`. Driver weekly payout
  endpoint added. Verified live (composite 5 → core).
- **Agent App UI** — `frontend/src/agent.html` + `agent.js`: the 3 screens (Accept / Hand to bus /
  Release to customer) with wallet + status pinned, the 'no money, no scan' lock surfaced, photo
  proof, OTP pad, star rating, read-aloud. **Professional/refined** (not a toy) per the low-literacy
  rule [[glos_low_literacy_ux]] — restrained line icons, brand palette, big targets. `?agent=<did>`.
- **Operator Control Tower UI** — `frontend/src/pudo-tower.html` + `pudo-tower.js`: dark control-room
  theme (matches the GLOS tower) with the 5 modules — Dashboard KPIs (+ critical-alert pulse), Agents
  table (status/wallet/rating), Finance (float/revenue/ledger), Network map (agent dots), User/Support
  parcel lookup + audit timeline.

## Sprint P3 — Graduation onto M4 + M7 ✅ built (2026-06-28)
**One pane of glass.** `graduation.service.ts` (GraduationService) subscribes to `pudo.*` and promotes
every parcel onto the GLOS visibility + orchestration spine, reusing all existing machinery:
- **M7 twin / control tower** — `DigitalTwinService.upsertExternal()` adds the parcel as a located,
  `source:'pudo'`-tagged shipment node, so PUDO last-mile shows on the control tower map/watchlist
  next to enterprise freight.
- **M4 timeline** — registers a one-leg context + ingests the scan lifecycle (accept→PICKUP,
  hand-to-bus→HANDOVER, ready→OUT_FOR_DELIVERY, pickup→DELIVERED with PoD), giving an anchored M4
  timeline + search/analytics; M4's oracle events drive the twin state.
- **Pre-paid by design:** the bridge deliberately does NOT emit `match.confirmed`, so **no SSE escrow**
  is created. Verified safe: SSE milestone-release no-ops on `no_escrow`; PoD avoids the M4
  delivery-without-acceptance flag.
- M4Module now exports `TrackingService` + `TrackingContextService`; PudoModule imports M4Module + M7Module.
- Tests: graduation unit spec (parcel in twin + M4 timeline) + e2e. Suite **158 unit + 21 e2e green**;
  verified live (PUDO parcel `picked_up→delivered` in the M7 tower + full M4 timeline).

## Sprint P4 — Inbound e-commerce (pickup-at-PUDO) ✅ built (2026-06-28)
Tier-1 inbound: a buyer orders online for **collection at a PUDO**. GLOS orchestrates logistics only —
**never touches fiat** (pre-paid; agents earn labour fees from the float).
- **VendorService** — register an e-commerce store (`vendorId` + signing secret + callback URL);
  HMAC-SHA256-signed **status callbacks** (ready_for_pickup / collected / disputed) via an outbox.
- **Inbound webhook** `POST /pudo/inbound/orders` — vendor selects origin PUDO, buyer's chosen
  destination PUDO; GLOS creates the parcel (`direction:inbound`, status `Created`) + a **phygital
  label** (QR + SVG) + a buyer **collection code**.
- **Lifecycle** — intake (origin PUDO) → handover (bus, reused) → **shelve** (chaos-shelf bin) →
  Ready_For_Pickup → **collect** (buyer presents the collection QR → resolves parcel + bin) →
  collect-confirm (**Delivered**) or **dispute** (mandatory photo proof). Statuses `Created` + `Disputed`
  added; `Parcel` gains `direction/vendorId/externalOrderId/collectionCode/binSlot/items/dispute*`.
- **VendorCallbackService** — relays milestone events to the parcel's vendor (the buyer's
  "ready for pickup" notification mirrors yukel.com click-and-collect).
- **Graduation** — inbound parcels ride the same bridge onto M4/M7; a dispute flags the twin node.
- **Agent App** — a 4th screen "Collect order": scan collection code → shelf bin + item list →
  hand over OR file a dispute with photo.
- **📄 Vendor integration guide** — `06_integration/pudo_ecommerce_integration_guide.md` (auth, the
  webhook contract, label, lifecycle, collection, callbacks + HMAC verification, errors, quick-ref).
- **Merchant Console UI** — `frontend/src/vendor.html` + `vendor.js`: a professional light SaaS
  dashboard (admin-grade, NOT low-literacy) — connect store (vendorId + reveal secret), origin/dest
  **PUDO pickers**, create shipment → renders the **printable phygital label** + collection code,
  orders list with live status, and the **HMAC status-callback feed**. Distinct from the low-literacy
  agent app + the dark ops tower.
- Tests: 2 inbound unit specs + an inbound e2e. Suite **160 unit + 22 e2e green**; verified live
  (webhook→label→intake→bus→shelve(bin O2)→collect→Delivered + signed callbacks + on the M7 twin).

## Sprint P6 — Opening hours, shelf grid, slots + leg computation ✅ built (2026-06-28)
- **Opening hours** — per-day weekly schedule on each agent (`hours.ts`: `averageOpenHours`,
  `isOpenAt`, `nextOpenAt`). Drives the eligibility "≥10 h/day on average" check (replaces the
  `requirements.hoursPerDay` number), the customer pickup window, and the **ETA-vs-opening-hours**
  rule. `POST /pudo/agents/:did/hours`.
- **Shelf grid (replaces the 4 m² cap)** — agents pick **rows × cols**; `ShelfService` labels columns
  by **colour** and rows by **number** (`Green-3`), computes **free-slot availability**, **assigns a
  parcel to a free slot** (persisted for pickup), and **frees it on collection**. Eligibility now =
  shelf ≥ `MIN_SLOTS`. `POST /pudo/agents/:did/shelf`, `GET /pudo/agents/:did/shelf`. Slot assigned at
  `arrive`/`shelve`, freed at `pickup`/`collect-confirm`.
- **First-mile node + leg computation** — `RoutingService`: `assignFirstMileNode` (nearest **open**
  PUDO with **free capacity**), `planJourney` (commits the node, computes the corridor **leg(s)** and
  the arrival time **corrected to the destination's opening hours** so a parcel is never "ready" while
  closed). `POST /pudo/routing/assign-node`, `POST /pudo/routing/plan-journey`. Parcels carry
  `committedNodeDid`.
- **UI** — operator tower Agents table shows **free slots**; agent app keeps the open/closed toggle.
- 6 new unit specs; suite **168 unit + 22 e2e green**; verified live (shelf `Red-1…`, slot assign/free,
  arrival 20:49 → pickup-ready next 08:00).

## Sprint P7 — MDP hubs + tote-bag sorting (multi-hop) ✅ built (2026-06-28)
- **MDP hubs** (`MdpService`, `mdp.types.ts`) — a regional sort centre distinct from a PUDO shop:
  covers a set of **zones**, sits in the middle of every multi-hop journey. `POST /pudo/mdps`,
  `GET /pudo/mdps`.
- **Tote bags** (`ToteService`) — a reusable **laminated QR (`toteId`) + human-readable code
  (`BAG-007`)** so the worker eyeballs the right bag without rescanning. Lifecycle
  `free → assign(destination) → filling → load(bus) → in_transit → empty() → free`. The bag is the
  **unit of handover**: a driver **scans ONE bag QR**, not each parcel. `POST /pudo/mdps/:id/totes`,
  `/totes/:code/{assign,fill,load}`, `GET /totes`, `GET /totes/:code`.
- **Capacity** (`BAG_CAPACITY_UNITS=10`, `SIZE_UNITS{S:0.18,M:1,L:2,HEAVY:10}`) — encodes the field
  rules exactly: **50 letters + 1 medium**, OR **10 mediums**, OR **1 parcel >20 kg fills a bag alone**
  (heavy = 10 units ⇒ nothing shares with it). **Bulk goods never enter a tote** (truck-direct).
- **Sort flow** (the scenario) — `loadBag` (one scan → whole tote + parcels On_Bus) → `dropBag`
  (`POST /pudo/mdps/:id/drop-bag`: empties the bag, parcels → **At_MDP**, tote freed for reuse) →
  `sortParcel` (`POST /pudo/mdps/:id/sort`: computes the parcel's **next destination** — the dest PUDO
  if this hub serves its zone, else the onward MDP — finds/opens the **destination bag** with room,
  drops it in, returns `{nextDestination, toteCode}`). Worker reads the screen, places the package.
- **Routing** — `planJourney` now builds the route through hubs: **origin PUDO → MDP(s) → dest PUDO**
  (hubs collapse when one covers both zones), multi-leg with `legType` `to_mdp|last_mile|direct`;
  ETA still corrected to the dest opening hours. Falls back to the direct corridor when no hub applies.
- **Graduation** — new events `BagLoaded` / `BagArrivedAtMdp` / `ParcelSorted`; `ParcelSorted` updates
  the **M7 twin** to `in_transit @ hub` (multi-hop visible — one pane of glass). New status `At_MDP`.
- 3 new unit specs + 1 e2e. Suite **171 unit + 23 e2e green**, lint clean; verified live (12 mediums →
  bag caps at 10 + 2 overflow; 1-scan handover of 10; drop→empty→reuse; sort→re-bag BAG-002; twin
  shows the hub leg).

## Sprint P8 — MDP worker app + fleet onboarding (drivers & vehicles) ✅ built (2026-06-28)
**UI — MDP worker app** (`frontend/src/mdp.html` + `mdp.js`, opens `?mdp=<hubId>`): professional WS-UX
sort-floor surface — **Drop a bag** (scan code → empty), **Sort** (scan parcel → big colour-coded
"place in BAG-### → destination" card + running queue), **Load a bag** (pick a full bag + driver
badge → onward bus), **New tote** (register a laminated QR). Plus an **MDP hubs + tote pool** panel on
the operator control tower (`pudo-tower.js`) — open bags per hub, fill %, bags on the road.

**Backend — drivers & fleet (Compendium Ch 19).** Drivers and vehicles are **separate entities, each
with its own ID**, joined by a **flexible, re-assignable coupling** (`Assignment`).
- **VehicleService** — registry; classes `bike · motorcycle · tuktuk · car · van · bus · truck`
  (+ truck sub-types `flatbed_open/box/refrigerated/crane/container_selfloader`). The system
  **computes capacity** (light classes fixed; heavy classes declare a load within class bounds) and
  derives handling rules (fragile / cold-chain / bulk). No hard roadworthiness gate (insurance is
  government-regulated) — a vehicle with **full registration + doc photo + factory/VIN** is flagged
  **`verified`** for dispatch priority. `POST /pudo/vehicles`(+`/:id/{documents,ground,retire}`).
- **DriverService** — onboarding **staged by the cleared vehicle class**: **light** (bike/motorcycle)
  → register → ACTIVE + badge immediately (so micro-businesses join the MDP→PUDO feeder); **heavy**
  (everything else) → DRAFT → KYC (ID + licence copy) → vetting (clean record + licence not expired) →
  ACTIVE + badge. DID + vaulted Golden Record + dedup (nationalId/mobile/licence). `POST
  /pudo/drivers/onboard`, `/pudo/fleet/drivers/:did/{submit-kyc,kyc-decision,suspend,ping}`.
- **FleetService** — `couple`/`uncouple`/`assign-corridor` (a driver may only couple to a class their
  licence covers; one active coupling per driver + per vehicle; re-assignable). `resolveBadge` powers
  handover. `POST /pudo/fleet/drivers/:did/{couple,uncouple,assign-corridor}`, `GET
  /pudo/fleet/assignments`.
- **Integration** — `parcel.handover` resolves the badge to a **fleet driver + coupled vehicle** (legacy
  corridor-driver fallback kept) and **enforces vehicle limits** (per-parcel max kg, no fragile on a
  two-wheeler, total capacity); `MdpService.loadBag` applies the same check on the feeder leg. New
  `Parcel.fragile`. Bulk cargo (sugar/cement) → trucks, never via MDP/totes.
- 6 new unit specs + 1 e2e. Suite **177 unit + 24 e2e green**, lint clean; verified live (bike →
  light/ACTIVE; trucker → heavy/DRAFT→vetted→ACTIVE; reefer truck cap 12 t cold+bulk+verified;
  coupling guards; bike handover hands only the small non-fragile parcel).

## Sprint P9 — dispatch marketplace (PUDO totes + opportunistic claim) ✅ built (2026-06-28)
The tote logic now runs **at PUDO origins too**, plus a driver-claim marketplace (Ch 19).
- **PUDO outbound totes** — `POST /pudo/agents/:did/totes` registers a tote at the shop; the agent
  assigns it to a destination MDP + bags accepted parcels (reusing `/totes/:code/{assign,fill}`).
- **Publish for claim** — a tote goes on the platform when **full** OR after a **24 h max wait**
  (`TOTE_MAX_WAIT_H`); `DispatchService.publishReady` sweeps full/aged totes, `POST
  /pudo/totes/:code/release` lets the agent publish early. New tote states `available → claimed`,
  with accumulated `weightKg` + `filledAt`/`availableAt`/`claimedBy`.
- **Route-matched offers** — `POST /pudo/fleet/drivers/:did/suggest-work` (route A→B) finds available
  totes/freight **near the route** (`detourKm` ≤ 8, ≤ 30 min away) **within remaining vehicle
  capacity**, and returns offers: *"≈5 min from <place>: a 15 kg shipment to <dest> is ready. Claim
  it?"* Driver **Claim** (`/dispatch/offers/:id/claim`) / **Ignore** (`/ignore`) / **auto-ignore**
  when the offer lapses (`OFFER_TTL_MIN` = 10). Competing offers for a claimed load are retired.
- **Capacity** — each claim **reserves weight against the vehicle's total load (set by the fleet
  manager** at registration); `remainingCapacity` = total − claimed/in-transit loads; over-capacity
  loads are never offered. `GET /pudo/fleet/drivers/:did/{offers,claims}`.
- **Claimer-only load** — `loadBag` (one scan) only accepts the bag from the driver who claimed it;
  the bag goes `claimed → in_transit`. **Bulk freight** (sugar/cement) registers into the same
  marketplace (`/dispatch/freight`, trucks only — never via MDP).
- 4 new unit specs + 1 e2e. Suite **181 unit + 25 e2e green**, lint clean; verified live (15 kg bag →
  "≈1 min from Feeder PUDO … Claim it?"; claim 1200→1185 kg; one-scan load of 3 parcels; claimer guard).

## Sprint P10 — driver app + fleet console (UIs) ✅ built (2026-06-29)
- **Driver app** (`frontend/src/driver.html` + `driver.js`, opens `?driver=<did>`): professional WS-UX
  courier surface — coupled-vehicle card with a **remaining-capacity bar**, **Find work on my route**
  (pick From/To from network nodes → suggestions), an **offer card** ("≈5 min from X … Claim it?")
  with **Claim / Ignore**, and **My loads** (claimed shipments → one-tap **Load on** via the driver's
  badge).
- **Fleet console** (`frontend/src/fleet.html` + `fleet.js`): light SaaS back office for the fleet
  manager — **register vehicles** (class + truck sub-type + computed/declared capacity + docs→verified),
  **onboard drivers** (cleared-class chips auto-switch light vs heavy KYC fields), a **driver list**
  with KYC actions (submit / approve / reject / suspend), and **couple/uncouple** driver↔vehicle
  (+ optional corridor) with a live assignments table.
- Backend fix: `claimsFor` now shows an on-board (in-transit) tote instead of dropping it (the
  `bus:<badge>` location falls back to "on board"). Verified live: register moto → onboard Sam (light,
  ACTIVE) → couple → release a 3 kg bag → suggest "≈1 min from Corner Shop … Claim it?" → claim
  (50→47 kg) → load (3 on board, still listed).

## Sprint P11 — driver shift sessions (scan-to-start) ✅ built (2026-06-29)
The driver↔vehicle coupling is now a **driver-run shift session**, not a manager action.
- **Vehicle dashboard QR** — every vehicle gets a scannable `qr` (`VEH-XXXXXX`) on registration;
  `VehicleService.byQr` resolves the QR (or plate / id typed as a fallback).
- **Start a shift** — the driver **scans the dashboard QR** in their app → `FleetService.startSession`
  couples them (both must be active: driver ACTIVE + licence valid, vehicle ACTIVE, class-cleared).
  `POST /pudo/fleet/drivers/:did/start-session {vehicleQr}`.
- **Close the shift** — `end-session` decouples driver + vehicle (end of day). `GET …/session` returns
  `{active, vehicle}` (or `{active:false}`). The manual fleet-console couple remains as an admin path.
- **Driver app** is now session-centric: off-duty home = "Scan vehicle — start shift"; on-shift home =
  vehicle + remaining-capacity, **Find work**, **Repeat my route** (last route saved in localStorage),
  **My loads**, **End shift**. **Fleet console** shows the dashboard QR per vehicle (print + stick) and
  reframes the coupling panel as **Active sessions** (End session).
- 1 new unit spec + 1 e2e. Suite **182 unit + 26 e2e green**, lint clean; verified live (scan
  VEH-73FB29DD → session active, vehicle coupled → close → decoupled; bad scan rejected).

## Sprint P12 — fleet-manager dashboard + rich truck taxonomy ✅ built (2026-06-29)
- **Extensive truck sub-types** (`TRUCK_SUBTYPE_CATALOG`, 24 bodies): flatbed / drop-side / box /
  curtain-side / refrigerated / insulated / tipper / cement-mixer / grain-hopper / bulk-tanker /
  tanker / food-tanker / fuel-tanker / water-bowser / hazmat / car-carrier / livestock / skeletal /
  container-self-loader / crane / lowboy / logging / tow-recovery / refuse. Each carries a default
  capacity + **handling capabilities** (cold-chain / dry-bulk / liquid / hazmat / oversized) the system
  applies to the vehicle. **Registration is flexible** — any class may declare a real load (clamped to
  the body/class ceiling); else the sub-type/class default applies. `GET /pudo/vehicles/truck-subtypes`.
- **Vehicle GPS** — `Assignment.location` + `FleetService.reportLocation`; `suggest-work` records the
  driver's start point, and `POST /pudo/fleet/drivers/:did/locate` is an explicit heartbeat.
- **Dashboard rollup** — `GET /pudo/fleet/dashboard` = `FleetService.overview()` (vehicle/driver/session
  counts, **working hours** from active/today sessions, **live GPS positions**) + `DispatchService
  .activeCargo()` (claimed/in-transit totes + freight, enriched with driver names).
- **Fleet console redesigned into a dashboard** (`fleet.html`/`fleet.js`) with a nav router:
  **Dashboard** (KPI tiles, live **GPS map**, working-hours table, active-cargo table, shortcut cards) →
  **Fleet data** (vehicle register with the rich truck-body dropdown + capability hints + QR + handling
  badges) → **Drivers pool** (onboard + KYC) → **Sessions** (couplings).
- 2 new unit specs + e2e additions. Suite **184 unit + 26 e2e green**, lint clean. Also fixed a latent
  `nextOpenAt` bug (minute-truncation could put pickup-ready a few seconds before arrival → now returns
  the exact instant when already open). Verified live (24 bodies; reefer auto-cap 9000 kg + cold +
  verified; dashboard shows on-shift driver, GPS dot, 5 kg cargo by name).

## Sprint P13 — fleet-manager onboarding + multi-tenant scoping + field-app typography ✅ (2026-06-29)
- **Fleet manager** is now a first-class onboarded actor (`FleetManagerService`, `FleetManager*` types)
  with **its own eligibility filter**: business registration no. + transport-operator licence + tax ID +
  a depot location (pin/address). Lifecycle **DRAFT → KYC_PENDING → APPROVED → ACTIVE → SUSPENDED** —
  KYC docs (reg cert, operator licence, owner ID, proof of address) → vetting → a refundable **operating
  bond** activates them. Dedup on reg-no/tax-id/licence; Golden Record vaulted (tier-2 `fleet-manager`).
  `POST /pudo/fleet/managers` (+ `/kyc-queue`, `/:did`, `/:did/{submit-kyc,kyc-decision,bond,suspend}`).
- **Multi-tenant scoping** — vehicles + drivers carry an optional `managerDid`; **only an ACTIVE manager
  may register** them (register validates `requireActive`). `overview(managerDid?)` + `activeCargo`
  filter to one fleet; `GET /pudo/fleet/dashboard?manager=<did>` scopes the whole dashboard. (No
  manager = network-wide view; legacy unmanaged vehicles/drivers still work.)
- **Fleet console** gains a **Managers** tab (onboard + KYC queue + approve/reject + record-bond +
  suspend) and a **fleet picker** in the header that scopes the dashboard + lists and stamps `managerDid`
  on new vehicles/drivers.
- **Tier-1/2 field apps restyled** — the agent, MDP-worker and driver apps now use the **GLOS
  control-tower typography** (`'Segoe UI', Roboto, 'Open Sans'…`, tabular figures, weight/case-driven
  hierarchy, tracked-uppercase labels) while keeping their green/light palette + large low-literacy
  targets. Per [[glos_low_literacy_ux]] the sizing stays generous; only the type system aligns.
- 4 new unit specs + 1 e2e. Suite **186 unit + 27 e2e green**, lint clean; verified live (DRAFT→build
  blocked→KYC→vet→bond→ACTIVE→scoped reefer 9000 kg; dashboard scoped to the fleet).

## Sprint P14 — per-manager login + PUDO launcher hub ✅ built (2026-06-29)
- **Per-manager sign-in** — a `loginCode` (`FM-XXXX`) is issued when a fleet manager is activated
  (bond posted); `POST /pudo/fleet/managers/login {code}` resolves an ACTIVE manager (401 otherwise).
  The **fleet console now has a sign-in gate**: a manager signs in with their code → **manager mode**
  (scoped to their fleet, no Managers tab / no fleet picker, "Signed in as <company>" + Sign out); or
  "Continue as GLOS operator" → **operator mode** (full console + Managers tab + all-fleets picker).
  Session persists in localStorage; `?manager=<did>` / `?ops` deep-links pick the mode. The operator's
  Managers list shows each fleet's sign-in code to share.
- **PUDO Launcher** (`frontend/src/hub.html` + `hub.js`) — one landing page linking every surface by
  audience: **Field apps** (Agent / Driver / MDP-worker — each opens with a real entity picked from a
  live dropdown), **Businesses** (Merchant console, Fleet console → open a specific fleet), **Operators**
  (operator Fleet console, PUDO control tower, GLOS control tower). GLOS-dashboard typography, green palette.
- 1 unit assertion-set + e2e additions. Suite **186 unit + 27 e2e green**, lint clean; verified live
  (activate → code FM-485AFC → login resolves the fleet → bad code 401; hub serves + data sources resolve).

## Remaining (next passes)
Deferred: SMS/WhatsApp + OTP-over-SMS; offline-first + sync queue; IMEI hard device-lock; real geocoder;
a UI to edit hours/shelf; freight pickup/deliver lifecycle; driver payout splits by vehicle ownership;
a real QR-image on the vehicle sticker (code shown today); real continuous GPS streaming; hardened
per-manager API auth (the manager login scopes the console UI; the API still uses the shared
DID-authenticated ops token). PUDO → SSE escrow intentionally out of scope (pre-paid; GLOS holds no fiat).
