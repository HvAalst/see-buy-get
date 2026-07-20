# GLOS Tasks

Active work is tracked in the Phase-1 sprint backlog (granular, point-sized tickets with
acceptance criteria as definition-of-done):

- **Phase 1 (M1 + M2):** [05_engineering/phase1_sprint_backlog.md](05_engineering/phase1_sprint_backlog.md)
- **Full work breakdown / phasing:** [05_engineering/implementation_plan.md](05_engineering/implementation_plan.md)
- **Epic definitions + acceptance criteria:** [02_epic_domains/](02_epic_domains/)

## Progress
- **Sprint 0 — Foundations:** ✅ done (data firewall, ledger, DID, auth shim, event bus, WS-UX kit).
- **Sprint 1 — M1 Identity Core:** ✅ done (multi-role registration, tiers T1–T4, KYC/KYB hub,
  liveness, sanctions; onboarding wizard UX).
- **Sprint 2 — M1 Wallet, Courier & Security:** ✅ done (wallet provisioning + settlement triggers
  + instant payout, background-check VC, synthetic-ID detection, corporate multi-sig; wallet +
  cash-out + bank-link UX). Added a foundation VC registry. 59 unit + 8 e2e green; full courier
  flow verified on a live server (verify → wallet + VC → credit → cash-out → bank-link).

## Backlogs
- **Phase 1 / M1:** [05_engineering/phase1_sprint_backlog.md](05_engineering/phase1_sprint_backlog.md) — ✅ done
- **M4 — Visibility & Tracking:** [05_engineering/m4_sprint_backlog.md](05_engineering/m4_sprint_backlog.md) — Sprint 0 ✅ + Sprint 1 ✅ + Sprint 2 ✅ (live multi-leg ETA, geofence auto-events, exception engine + IoT + lifecycle) + Sprint 3 backend ✅ (alert rules + HMAC webhook streaming, search, analytics). **Exceptions wired into M7 auto-response.** Pending: participant live-map UX (T4-307), courier PoD UX (T4-111), real email/SMS gateways
- **SSE — Smart Settlement:** [05_engineering/sse_sprint_backlog.md](05_engineering/sse_sprint_backlog.md) — ✅ all sprints (loop + fees/FX/penalty/staged + disputes/triple-entry/dashboard)
- **M3 — Matching & Pricing:** [05_engineering/m3_sprint_backlog.md](05_engineering/m3_sprint_backlog.md) — ✅ all sprints (marketplace + batch matching, predictive/pre-book, cold-start/fairness, explainability, governed overrides, service tiers)
- **M5 — Trust & Reputation:** [05_engineering/m5_sprint_backlog.md](05_engineering/m5_sprint_backlog.md) — ✅ all requirements (scoring, ratings, badges, fraud, disputes, transparency)
- **M7 — AI Orchestration & Control Tower:** [05_engineering/m7_sprint_backlog.md](05_engineering/m7_sprint_backlog.md) — ✅ Phase-3 core (Sprints 0–1: digital twin, ETA, disruption+blast-radius, recommender, autonomous policy w/ human gate + rollback, M3 rebook); Sprint 2 (Phase-4 sim) + control-tower UX pending
- **PUDO Light — emerging-market Tier 1/2 on-ramp:** [05_engineering/pudo_sprint_backlog.md](05_engineering/pudo_sprint_backlog.md) — ✅ backend domain (Sprint P1): agent 5-state onboarding + Golden-Record-in-vault, pre-paid "no money no scan" wallet gate + typed ledger + 5-min void, static corridors + bus-vs-truck heuristic, 3-screen parcel flow (accept→handover→arrive(OTP)→pickup) all anchored, time-window auto-flags + operator dashboard/finance + rating→shared-core graduation. **Reuses the GLOS backbone** (M1 wallet, DID, vault, ledger, events). **✅ UIs built** — 3-screen agent app (`agent.html`, professional WS-UX) + operator control tower (`pudo-tower.html`, dark control-room). **✅ Graduation onto M4 + M7** — PUDO parcels appear as `source:pudo` nodes in the M7 control tower twin + get a full anchored M4 timeline (one pane of glass), no SSE escrow (pre-paid). **✅ Inbound e-commerce (pickup-at-PUDO)** — vendor registry + signed status callbacks, inbound webhook `POST /pudo/inbound/orders` (phygital label + collection code), intake→bus→shelve(chaos bin)→collect/confirm/dispute(photo); agent app "Collect order" screen; **vendor integration guide** at `06_integration/pudo_ecommerce_integration_guide.md`. GLOS holds no fiat (pre-paid). Offline/SMS/IMEI deferred

- **M2 (deep):** ✅ built. Multi-channel ingestion (REST + batch JSON/CSV + Shopify/Magento
  plugins) + reusable templates; full e-waybill schema (mode-specific transport, namespaced tags,
  Incoterms enum, HS-code suggest/validate, published JSON Schema); constraint normalization
  (expanded handling-code library, commodity→handling auto-tagging, dangerous-goods
  classification + DGR ceiling); genesis+amendment anchoring, leg decomposition, Job Requirement
  Vector. **§5.2.4 Smart labels** (QR + crypto signature + handling pictograms + anti-tamper
  watermark + ZPL/EPL/SVG printer formats + carrier overlay). **§5.2.5 Anchoring on Hyperledger
  Fabric** (genesis birth certificate + amendment chain + lightweight verification + selective
  disclosure). **§5.2.6 Legs** with **per-leg data isolation** (an actor on a leg sees only that
  leg, not others/commercial data), per-leg term negotiation, and reusable route templates.
  **NFR-M2-05** standards conformance (UN/CEFACT MMT R28+, WCO Data Model 4.0, IATA ONE Record):
  field-level crosswalk + per-shipment conformance report. **NFR-M2-06** open schema published as
  both JSON Schema and **Protocol Buffers**. **§5.5 integration deps** met incl. M1 VC-requirement
  verification against the identity vault at leg assignment. 114 unit + 17 e2e green. Pending M2:
  shipper "send something" UX (T-310/410). **✅ Now built** — `send.html`/`send.js`: 5-step
  pictogram wizard (category → route+mode → handling toggles → review → smart-label) on the WS-UX
  kit; calls existing M2 endpoints; smoke-tested (auto-tagging + Fabric anchor + label SVG work).
  Scope: `05_engineering/shipper-wizard-scope.md`.

- **M4 basic-tracking MVP:** ✅ built. Tracking context from M2 `leg_decomposed`, connector
  framework (rest-carrier + mobile-sdk), normalization + dedup/conflict resolution, state-machine
  ingest (illegal transitions → anomalies), anchored timeline, PoD (signature/photo/PIN), and the
  oracle events (`tracking.pickup_ok` / `.handover_ok` / `.delivered` / `.exception_raised`) for
  SSE/M5. Low-literacy timeline UI. 77 unit + 10 e2e green; full M2→M4 flow verified live.

- **SSE settlement loop:** ✅ built. Escrow create + pre-fund (M1 wallet) → milestone release
  driven by M4 oracle events (pickup/handover/delivered) → atomic compliance-screened payout to
  payee wallet → live smart invoice + reconciliation + recipient acceptance. 83 unit + 11 e2e;
  the full **M1→M2→M4→SSE→M1** loop is proven (a funded escrow pays the carrier on pickup).

## Running locally
- Backend (9 modules incl. PUDO Light): http://localhost:3000/v1/health  ·  Frontend: http://localhost:4173/
- Pages: /onboarding.html, /send.html (shipper wizard), /wallet.html?account=…,
  /tracking.html?shipment=…, /settlement.html?shipment=… (financial dashboard),
  /reputation.html?did=… (trust score), /pod.html?shipment=… (courier proof-of-delivery),
  /control-tower.html?region=… (M7 admin console — region-cloneable),
  /agent.html?agent=… (PUDO 3-screen agent app), /pudo-tower.html (PUDO operator control tower),
  /vendor.html (PUDO merchant console — e-commerce click-and-collect), /components-demo.html

- **M3 matching marketplace:** ✅ built. Availability feed, demand intake (pulls the M2 JRV),
  capability-VC + equipment + reputation filtering, multi-objective scoring, dynamic pricing +
  surge, offer/accept/fallback-cascade, match audit trail. `match.confirmed` now **auto-creates
  the SSE escrow** (replaced the stand-in). 87 unit + 12 e2e; the **grand loop M2→M3→SSE→M4→M1**
  is proven (match→accept→auto-escrow→fund→pickup→carrier paid).

- **M5 reputation:** ✅ built (all requirements). Multi-dimensional scoring (Bayesian composite +
  confidence interval, time-decay/volume-weight, root-cause exclusion), verification-anchored
  structured ratings (blinded, sentiment-filtered), auto trust-badge VCs + revocation + portable
  export, fraud/Sybil/collusion/milking + network-health, dispute-driven adjustment + graduated
  sanctions, dashboard/explainability/challenge/public API. **Writes the composite back to the
  Operational Core, so M3 now matches on real reputation** (prior stand-in retired). 96 unit + 13 e2e.

- **M7 AI Control Tower:** ✅ Phase-3 core built. A live **digital twin** property-graph
  (shipment/carrier/location/leg nodes + edges) fed in real time from M2 `shipment.*`, M3
  `match.confirmed`, M4 `tracking.*`, with geospatial/temporal query + density heatmap. **Predictive
  ETA** (95% confidence interval, disruption factor, human-readable basis). **Proactive disruption
  detection** (keyword classifier → port-strike/weather/unrest/…, emits `disruption_detected`) +
  **blast-radius** impact propagation (ranked most-critical impacted, `impact_assessed`).
  **Prescriptive recommender** (ranked reroute/wait/rebook/split-air with cost/time/reliability +
  justification). **Autonomous policy engine** (shipper if-then rules) behind a **human-in-the-loop
  gate** (>$1000 needs approve/reject), **anomaly freeze** (>$50k), **ledger-anchored audit trail**
  + **1h rollback** — and an executed reroute/rebook **re-matches through M3**. `/v1/control-tower/*`.
  8 unit + a §11.5 e2e flow; full suite **130 unit + 18 e2e green**; the
  **M2→M3→M4→M7→M3** orchestration loop is proven (disruption → policy → autonomous rebook).
  **✅ Control-tower UX built** — `control-tower.html`/`control-tower.js`: an **admin-grade**
  console (info-dense, exempt from the low-literacy rule; admins are highly literate/culture-aware)
  that is **region-cloneable** — one codebase driven by a `REGIONS` config + `?region=` (global/EMEA/
  APAC/Americas), each with its own locale, time zone, currency (Intl-formatted) and geo bounds.
  KPIs, live network map, shipment watchlist (ETA + blast-radius criticality), disruption desk
  (detect→assess), prescriptive options with execute + human-gate approve/reject + one-click undo,
  autonomous-policy editor, and the anchored action audit trail. Verified live against all M7 endpoints.
  **✅ Real-signal feeds wired** — a signal-ingestion pipeline (`SignalSource` connector framework +
  example partner-feed adapter; **push/webhook** `POST /signals` and **poll** `POST /signals/poll`,
  with dedup + classification) and an **AutoResponseService**: any detected disruption (feed, webhook,
  or operator) auto-computes the blast radius and **auto-evaluates shipper policies**, executing
  behind the human gate — no operator click. Verified live: polling the feed ingested a Singapore
  port-strike advisory that autonomously fired a shipper's rebook policy (anchored + re-matched via
  M3); dedup held on re-poll. Tower has a Signal-feeds panel (sources · poll-now · webhook push ·
  recent advisories). 125 unit + 18 e2e green.
  **✅ Phase-4 what-if simulator (A-201/M7-040)** — `POST /control-tower/simulate` replays
  hypothetical disruption(s) against the live twin and projects blast radius, baseline-vs-projected
  ETA, best prescriptive option, and each shipper policy's disposition (auto/approval/frozen) +
  aggregate totals (added delay, autonomous spend, unprotected count). **Strictly read-only** (a
  unit test proves nothing is stored/executed); tower has a "What-if simulator" rehearsal panel.
  127 unit + 18 e2e green.
  **✅ Phase-4 carbon simulator (A-203/M7-042)** — `GET /control-tower/carbon/network` + `/carbon/:id`:
  per-leg CO2e (mode emission factors × tonne-km), a greener modal-shift alternative (air→ocean,
  road→rail) with the saving, and a network roll-up (total/saveable/by-mode/top emitters). Tower
  "Sustainability" panel. 129 unit green; verified live (air shipment ≈3.5t CO2e, −69% greener).
  Emission model is real; leg distances use M2's stub geocoder (swap for real geocoding later).
  **✅ Phase-4 network design (A-202/M7-041)** — `GET /control-tower/network-design`: aggregates lane
  volumes + hub throughput + mode mix and recommends structural changes (expand_hub, direct_lane,
  mode_shift, consolidate_hub) ranked by priority. Tower "Network design" panel. 130 unit green;
  verified live. **M7 is now fully built (Phase-3 core + all of Phase-4).**

## Current focus
**All eight modules are built** (M1, M2, M3, M4, M5, M7 + SSE + M6 auth). The full event cascade is
wired: identity → digitize → match → settle-on-tracking → pay → rate → reputation → back into
matching, and now an **AI control tower** (M7) sits on top — a live digital twin that predicts ETAs,
detects disruptions, and autonomously rebooks through M3 behind a human gate. Remaining work is
depth + UX, not new backbones:
- Deepen modules: SSE Sprint 2–3 (FX/fees/penalties, disputes + financial dashboard) is the main
  remaining backend depth. **M4 ✅ Sprints 2–3 backend complete** (live multi-leg ETA, geofence
  auto-events, exception engine + IoT + case lifecycle, alert rules + HMAC webhook streaming,
  search/analytics; exceptions feed M7 auto-response). **M3 ✅ complete** (Sprints 2–3: batch
  matching, predictive/pre-book, cold-start/fairness, explainability, governed overrides, service
  tiers — `/v1/matching/{quote,batch,forecast,prebook,fairness,matches/:id/force-assign|block}`).
  **M7 ✅ complete.**
- Participant UX: ✅ shipper "send something" (send.html), reputation dashboard (reputation.html),
  courier PoD-capture (pod.html) all built + smoke-tested. The participant journey is now clickable
  end-to-end: join → send → match/track → deliver(PoD) → settle → rate → reputation.
- M8 (Compliance & Customs) remains future-phase.
