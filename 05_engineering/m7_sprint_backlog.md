# M7 Sprint Backlog — AI Orchestration & Control Tower (AIOCT)

> Source epic: `../02_epic_domains/epic_m7_ai_orchestration.md` (Compendium §11). The apex module.
> DoD = epic acceptance criteria. Ticket ids `A-###`.

## Dependencies (all built)
- **M4** — real-time event stream (`tracking.*`) feeds the digital twin + ETA.
- **M2** — `shipment.created` / `shipment.leg_decomposed` add shipment/leg/location nodes + the baseline plan.
- **M3** — `match.confirmed` adds assigned-to edges; M3 `MatchingService` is the engine through which prescriptive **rebooking** executes.
- **M1/M5** — carrier nodes + reputation weight the reliability of alternatives.
- **SSE** — financial impact of autonomous actions reconciled (later).

## Build order
`Sprint 0 (digital twin) → Sprint 1 (Phase-3 core: ETA + disruption + recommender + autonomous
policy/safety) → Sprint 2 (Phase-4: what-if simulation + network design + sustainability)`.

**Phase-3 core = Sprints 0 + 1.**

---

## Sprint 0 — Real-Time Network Digital Twin · 16 pt
- **A-001 · M7 module skeleton + event subscriptions** — `INF` · **2pt**
- **A-002 · Unified graph model** — `M7-010` · **8pt**
  - DoD: live property graph — nodes (shipment, carrier, location, leg), edges (has-leg, assigned-to, at-location, handover) — updated in real time from M4 events + M2/M3 + M1 identity.
- **A-003 · Geospatial + temporal indexing** — `M7-011` · **3pt**
  - DoD: query nodes by location radius + predicted-late, e.g. "refrigerated shipments within 50km of X predicted >2h late".
- **A-004 · Heatmap / density data** — `M7-012` · **3pt**
  - DoD: aggregate density / delay clusters by region for the control-tower view.

## Sprint 1 — Predictive ETA, Disruption, Prescriptive & Autonomy · 39 pt
- **A-101 · Predictive ETA** — `M7-020` · **5pt**
  - DoD: continuously-updated ETA from twin state + planned route + traffic/disruption factor, with a 95% confidence interval; recomputed on tracking events.
- **A-102 · Proactive disruption detection + classification** — `M7-021` · **5pt**
  - DoD: ingest a disruption signal (port strike / weather / unrest), classify it, emit `orchestration.disruption_detected`.
- **A-103 · Impact propagation (blast radius)** — `M7-022` · **5pt**
  - DoD: on a disruption, compute all affected shipments in the zone/route and return a ranked "most critical impacted" list.
- **A-104 · Disruption response recommender** — `M7-030` · **8pt**
  - DoD: ranked prescriptive actions with cost/time/reliability trade-offs (reroute / wait / split-and-air-freight).
- **A-105 · Autonomous orchestration policy engine** — `M7-031` · **5pt**
  - DoD: shipper if-then rules ("IF delay > 6h AND extra cost < $1000 THEN rebook fastest"); evaluated on disruption; executes autonomously, logging + notifying.
- **A-106 · Human-in-the-loop override gates** — `M7-050` · **5pt**
  - DoD: actions above a cost/risk threshold require explicit approve/reject; auto-reject on timeout.
- **A-107 · Autonomous action audit trail + time-bound rollback** — `M7-051/052` · **3pt**
  - DoD: every autonomous action immutably logged (anchored); a configurable window supports one-click undo; secondary anomaly check (M7-053) freezes wild actions.
- **A-108 · Execute rebooking via M3** — `M7-031` (integration) · **3pt**
  - DoD: an executed reroute/rebook calls M3 `MatchingService` to re-match the affected shipment.

## Sprint 2 — Phase-4: Simulation & Design · 19 pt
- **A-201 · Supply-chain scenario simulator** — `M7-040` · **8pt** — ✅ built
- **A-203 · Sustainability / carbon simulator** — `M7-042` · **6pt** — ✅ built
- **A-202 · Optimal network design recommendations** — `M7-041` · **5pt** — ✅ built

## Hooks
**Consumes:** M4 `tracking.*` (twin + ETA), M2 `shipment.*` (baseline), M3 `match.confirmed`
(assignment) + capacity/pricing, M5 reputation (reliability weighting).
**Emits:** `orchestration.disruption_detected`, `.impact_assessed`, `.recommendation_generated`,
`.approval_requested`, `.action_executed`, `.action_rolled_back`. Executes rebooking → **M3**.

## NFR gates (§11.4)
Twin reflects events < 5s p95 (`NFR-M7-01`); single-shipment ETA recalc < 200ms (`NFR-M7-02`);
every recommendation carries a human-readable justification + confidence (`NFR-M7-06`).

## Summary
| Sprint | Theme | Points | Exit criterion |
|--------|-------|--------|----------------|
| 0 | Digital twin | 16 | Live graph from M2/M3/M4 events; geo/temporal query + heatmap |
| 1 | ETA + disruption + prescriptive + autonomy | 39 | **Disruption → blast radius → ranked options → policy auto-rebook via M3 with human gate** |
| 2 | Phase-4 simulation | 19 | What-if scenarios, network design, carbon |

**M7 total: 74 pt.** Phase-3 core = Sprints 0–1. **Integration test:** a tracked shipment's ETA
updates from M4 events; a port-strike signal computes the blast radius, the recommender ranks
options, and an autonomous policy rebooks via M3 behind a human-in-the-loop gate — the §11.5 flow.

---

## Status — Phase-3 core ✅ built (Sprints 0–1)
- **Sprint 0 (digital twin):** `DigitalTwinService` — live property graph (shipment/carrier/
  location/leg nodes; has-leg/at-location/assigned-to edges) populated from M2 `shipment.created`/
  `leg_decomposed`, M3 `match.confirmed`, M4 `tracking.*`; geospatial+temporal `query()` and
  `heatmap()`.
- **Sprint 1 (Phase-3):** `EtaService` (95% CI ETA from remaining legs × disruption factor, basis
  string — NFR-M7-06); `DisruptionService` (keyword classifier → typed disruption,
  `disruption_detected`; blast-radius `impact()` ranked by criticality, `impact_assessed`);
  `OrchestrationService` (ranked prescriptive options + justification → `recommendation_generated`;
  shipper if-then policy engine `evaluate()`; human-in-the-loop gate above $1000; anomaly freeze
  above $50k; ledger-anchored audit trail + 1h rollback window; **executes reroute/rebook via M3
  `MatchingService`** → `action_executed`/`action_rolled_back`).
- **Surface:** `M7Controller` @ `/v1/control-tower/*` (twin/shipments, twin/heatmap, eta, disruptions
  + impact, recommend, policies, evaluate, actions approve/reject/rollback/audit). Wired into
  `AppModule`; M3Module now exports `MatchingService`. Health lists `m7`.
- **Tests:** 8 M7 unit specs + a §11.5 e2e flow (digitize → match → disruption → blast radius →
  policy auto-rebook via M3, anchored + reversible). Full suite **130 unit + 18 e2e green**;
  backend boots clean with M7 live.

- **Control-tower UX ✅ built** — `frontend/src/control-tower.html` + `control-tower.js`. NOT a
  low-literacy view: an **admin-grade**, **region-cloneable** console (one codebase, `REGIONS`
  config + `?region=`; per-region locale/time-zone/currency via `Intl` + geo-bounded shipment
  scope). KPIs · live map · watchlist (ETA + criticality) · disruption desk · prescriptive options
  with execute/human-gate/undo · policy editor · anchored audit. Verified live against M7 endpoints.

- **Real-signal feeds + auto-response ✅ built** — `signal-ingest.service.ts` (`SignalSource`
  connector framework + `sources/partner-feed.source.ts`; **push/webhook** `POST /signals` + **poll**
  `POST /signals/poll`, dedup by upstream id, classify) and `auto-response.service.ts`: on
  `disruption_detected` (from any source) it auto-computes blast radius and auto-evaluates shipper
  policies, executing behind the human gate (`auto_response_completed`). The feed→policy loop is
  closed: a polled advisory autonomously rebooks via M3 with no operator action. Tower Signal-feeds
  panel added. Events: `signal_received`, `auto_response_completed`.

- **What-if simulator (A-201/M7-040) ✅ built** — `simulation.service.ts` + `simulation.types.ts`.
  Replays one or more hypothetical disruptions against the live twin and projects blast radius,
  baseline-vs-projected ETA, the best prescriptive option, and each shipper policy's disposition
  (auto / approval / frozen) + aggregate totals. **Strictly read-only** — built on pure refactors
  (`EtaService.projectHours`, `DisruptionService.draft`/`assess`, `OrchestrationService.buildOptions`/
  `recommendForDelay`/`simulateDisposition`); a unit test proves no disruption is stored and no action
  executed. `POST /control-tower/simulate`. Tower has a "What-if simulator" panel. Verified live.

- **Carbon simulator (A-203/M7-042) ✅ built** — `carbon.service.ts` + `carbon.types.ts`. Per-leg
  CO2e from mode emission factors × tonne-km (distance from the deterministic leg geocode, weight
  from M2), a greener modal-shift alternative (air→ocean, road/multimodal→rail) with the saving, and
  a network roll-up (total, saveable, by-mode, top emitters). `GET /control-tower/carbon/network` +
  `/carbon/:id`; tower "Sustainability" panel. Verified live (air shipment 3.5t-CO2e, −69% greener).
  Note: emission model is real but leg **distances use M2's stub geocoder** (synthetic) — swap in
  real geocoding for production accuracy.

- **Network design (A-202/M7-041) ✅ built** — `network-design.service.ts` + `network-design.types.ts`.
  Aggregates accumulated flow (lane volumes, hub throughput, mode mix) and recommends structural
  changes: `expand_hub` (choke points), `direct_lane` (repeated multi-leg corridors → handovers
  removed), `mode_shift` (high-carbon lanes → greener mode, saving from CarbonService),
  `consolidate_hub` (under-used nodes) — ranked by priority. `GET /control-tower/network-design`;
  tower "Network design" panel. Verified live.

**🎉 M7 COMPLETE** — Phase-3 core + Phase-4 (simulation, carbon, network design) all built.
Optional follow-ups: replace the example feed adapter's buffer with real provider clients
(weather/AIS/port/news); replace M2's stub geocoder with real geocoding for accurate carbon distances.
