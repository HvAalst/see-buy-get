# M4 Sprint Backlog — Real-Time Visibility & Tracking Tower (VTT)

> Source epic: `../02_epic_domains/epic_m4_visibility_tracking.md` (Compendium §7).
> Each ticket's **DoD** = the acceptance criteria from that epic. Points are Fibonacci
> (1/2/3/5/8). WS-UX = low-literacy UX criteria (a DoD gate). Ticket ids are `T4-###`.

## Dependencies & prerequisites
- **M1 (done)** — DIDs for event attribution + auth; the foundations (`LedgerService`,
  `EventBus`, auth guard) are reused directly.
- **M2 (minimal twin now built ✅)** — M4 needs the shipment **digital twin**: planned legs,
  handover points, geofences, and milestone definitions. M2 now emits `shipment.leg_decomposed`
  with exactly this payload, so **`T4-002` should subscribe to that event** to populate the
  tracking context (the direct registration endpoint stays as a test/back-fill path). Full M2
  (labels, shipper UX) is still pending but not required by M4.
- **Downstream (not built yet)** — M4 is the settlement & reputation **oracle**. Its events
  (`tracking.pickup_ok`, `tracking.handover_ok`, `tracking.delivered`, geofence enter/exit,
  `tracking.exception_raised`) are emitted on the event bus now; SSE/M5/M3/M7 consume them later.
  No downstream module is required for M4 to be complete.

## Build order within M4
`Sprint 0 (foundations + route context) → Sprint 1 (ingest → timeline → proof) → Sprint 2
(ETA + exceptions + geofences) → Sprint 3 (alerts + streaming + control tower)`.

**Phase-1 "basic tracking" MVP = Sprint 0 + Sprint 1 + basic ETA (`T4-201`).** Sprints 2–3 are
the Phase-3 "full orchestration" depth.

---

## Sprint 0 — Foundations & route context · 13 pt

- **T4-001 · M4 module skeleton** — `INF` · **2pt** · ✅ done
  - DoD: NestJS `m4` module with service/controller scaffold, wired into `AppModule`; `GET /v1/tracking/module-info` returns active; lint/test green.
  - Deps: M1 foundations.
- **T4-002 · Shipment tracking-context registry (M2 stand-in)** — `M2 dep`, `VTT-022` groundwork · **5pt** · ✅ done (subscribes to real `shipment.leg_decomposed`)
  - DoD: holds, per GLOS Shipment ID, the planned legs, handover points (GLOS Location IDs), geofences, and milestone definitions; populated by consuming `shipment.leg_decomposed` **and** by a direct `POST /v1/tracking/contexts` endpoint (Phase-1 stand-in until M2 ships).
  - DoD: an event for an unknown shipment is accepted but flagged "no context".
  - Deps: T4-001, `EventBus`.
- **T4-003 · GLOS Standard Tracking Event schema + state machine definition** — `VTT-011`/`VTT-021` groundwork · **3pt** · ✅ done
  - DoD: controlled event-type vocabulary (PICKUP, ARRIVED_AT_HUB, DEPARTED, HANDOVER, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION, GEOFENCE_ENTER/EXIT); the legal transition graph is declared and queryable.
  - Deps: T4-001.
- **T4-004 · Connector framework abstraction** — `VTT-010`/`VTT-012` groundwork · **3pt** · ✅ done
  - DoD: a pluggable `TrackingConnector` interface + registry; raw payloads route to the right connector; adding a connector needs no caller change.
  - Deps: T4-001.

---

## Sprint 1 — Ingestion, Timeline & Proof (F1, F2, F6) · 52 pt
> Large sprint — may split across two iterations (1a ingest/timeline, 1b proof/UX).

- **T4-101 · Multi-protocol ingestion gateway** — `VTT-010` · **8pt** · 🟡 REST + mobile-SDK done (MQTT/AIS/EDI via connector seams)
  - DoD: pluggable connectors for REST/gRPC + a mobile-SDK path now, with adapter seams for MQTT/AMQP (IoT), AIS (maritime), ACARS/SITA (air), EDI (X12 214/315, EDIFACT IFTSTA), SFTP.
  - Deps: T4-004.
- **T4-102 · Carrier-agnostic event normalization** — `VTT-011` · **5pt** · ✅ done
  - DoD: raw events normalize to the GLOS schema (GLOS Shipment ID, UTC ts, geocoded lat/lon, controlled event type, source carrier DID, raw payload ref, unique event hash).
  - Deps: T4-003, T4-101.
- **T4-103 · Plug-and-play connector library (≥2 certified + SDK)** — `VTT-012` · **5pt** · ✅ done (rest-carrier + mobile-sdk)
  - DoD: ≥2 certified stub connectors (e.g. a generic REST carrier + mobile courier SDK) behind the SDK contract; partner connectors certifiable.
  - Deps: T4-004.
- **T4-104 · Manual event submission (confidence-weighted)** — `VTT-014` · **3pt** · ✅ done (manual source → lower confidence unless proof)
  - DoD: authorized DID submits a manual event; tagged lower default confidence unless backed by photo/proof.
  - Deps: T4-102.
- **T4-105 · Event dedup & conflict resolution** — `VTT-020` · **5pt** · ✅ done
  - DoD: identical events deduplicated; resolution prefers automated over manual and carrier-sourced over third-party; raw conflicts preserved for audit.
  - Deps: T4-102.
- **T4-106 · State-machine engine** — `VTT-021` · **5pt** · ✅ done
  - DoD: each shipment follows the declared state machine; an illegal transition (e.g. IN_TRANSIT→DELIVERED without OUT_FOR_DELIVERY) is flagged as an anomaly, not silently applied.
  - Deps: T4-003, T4-105.
- **T4-107 · Timeline aggregation + API** — `VTT-022` · **5pt** · ✅ done
  - DoD: a unified chronological timeline (status, timestamp, map location, carrier, proof) exposed via API per GLOS Shipment ID.
  - Deps: T4-105, T4-106.
- **T4-108 · Cryptographic event anchoring** — `VTT-060` · **3pt** · ✅ done
  - DoD: every validated, non-duplicate event is SHA-256 hashed and batch-anchored to the ledger within 5s; only the hash on-chain. (Reuses `LedgerService`.)
  - Deps: T4-105, `LedgerService`.
- **T4-109 · Proof-of-Delivery collection** — `VTT-061` · **5pt** · ✅ done (signature/photo/PIN, anchored)
  - DoD: supports recipient signature, GPS-tagged photo, and PIN; PoD attaches to the DELIVERED event and anchors on-chain; emits `tracking.delivered`.
  - Deps: T4-107, T4-108.
- **T4-110 · UX: tracking timeline** — `M4-U1` · **3pt** · ✅ done
  - DoD (WS-UX): reuses the numbered lifecycle stepper; each step = pictogram + plain status + ETA in words ("Tomorrow"); read-aloud.
  - Deps: WS-UX kit, T4-107.
- **T4-111 · UX: courier Proof-of-Delivery capture** — `M4-U3` · **5pt**
  - DoD (WS-UX): take photo, finger-sign, tap one big "Delivered"; fully offline-capable with later sync.
  - Deps: WS-UX kit, T4-109.

---

## Sprint 2 — Predictive ETA, Exceptions & Geofences (F3, F4) · 32 pt

- **T4-201 · Basic predictive ETA** — `VTT-030` · **5pt**
  - DoD: continuously updated ETA from current location, planned route, historical lane/carrier, and traffic/weather, with a 95% confidence interval. *(Part of the Phase-1 MVP.)*
  - Deps: T4-107, T4-002.
- **T4-202 · Multi-leg ETA aggregation** — `VTT-031` · **3pt**
  - DoD: leg ETAs aggregate into an overall delivery ETA with handover buffers; a delay in any leg propagates.
  - Deps: T4-201.
- **T4-203 · Geofence management library** — `VTT-045` · **5pt**
  - DoD: global geofence library (ports/airports/hubs/customers) + custom geofences; entry/exit auto-generate `GEOFENCE_ENTER`/`EXIT` events when GPS intersects. (Feeds SSE milestone release.)
  - Deps: T4-102, T4-002.
- **T4-204 · Rule-based exception engine** — `VTT-040` · **8pt**
  - DoD: real-time evaluation for Missed Pickup/Delivery Window, Route Deviation (>X km), Prolonged Stationary, Temp/Shock Breach, Handover Delay, Delivery Without Acceptance.
  - Deps: T4-107, T4-203.
- **T4-205 · Exception severity classification** — `VTT-041` · **3pt**
  - DoD: auto-classify Critical/High/Medium/Low by deviation, commodity, SLA; Critical triggers immediate alert + escalation.
  - Deps: T4-204.
- **T4-206 · Exception case lifecycle** — `VTT-042` · **5pt**
  - DoD: each exception is a persistent case (detection time, type, severity, affected milestones, status Open/Acknowledged/Resolving/Resolved/False-Alarm, action audit log); emits `tracking.exception_raised`.
  - Deps: T4-204.
- **T4-207 · Manual exception override** — `VTT-044` · **3pt**
  - DoD: ops/authorized shippers mark False Alarm or override severity; every override needs a mandatory reason and is logged immutably.
  - Deps: T4-206.

---

## Sprint 3 — Alerting, Streaming & Control Tower (F5, F7) · 26 pt

- **T4-301 · Configurable alert rules** — `VTT-050` · **5pt**
  - DoD: visual/API rule builder ("notify if >30 min late", "alert if >8°C for >10 min"), filterable by lane/commodity/tier.
  - Deps: T4-204.
- **T4-302 · Multi-channel notifications** — `VTT-051` · **5pt**
  - DoD: in-app/email/SMS/webhook delivery, selectable per rule.
  - Deps: T4-301.
- **T4-303 · Webhook streaming** — `VTT-053` · **5pt**
  - DoD: every validated event/exception pushed with at-least-once delivery, exponential backoff, HMAC-SHA256 signed payloads. (Reuses the event-bus at-least-once pattern.)
  - Deps: T4-107.
- **T4-304 · Unified shipment map view** — `VTT-070` · **5pt**
  - DoD: real-time global map, colour-coded status markers; click a shipment to expand its timeline.
  - Deps: T4-107.
- **T4-305 · Shipment search & filtering** — `VTT-071` · **3pt**
  - DoD: search by GLOS ID/reference/carrier/status/route/date; complex filters savable as views.
  - Deps: T4-107.
- **T4-306 · API-first tracking (REST + streaming)** — `VTT-072` · **3pt**
  - DoD: all VTT data via REST + streaming APIs, DID-authenticated, embeddable in shipper portals/ERPs.
  - Deps: T4-107, M1 auth.
- **T4-307 · UX: live map + % journey + plain alerts** — `M4-U2`, `M4-U4` · **5pt**
  - DoD (WS-UX): one moving icon + plain progress sentence + "% of journey" bar; alerts in plain language with icon + read-aloud ("Your package is running late. New time: 4 PM.").
  - Deps: WS-UX kit, T4-304, T4-301.

---

## Hooks (events M4 emits — consumers arrive later)
- `tracking.pickup_ok`, `tracking.handover_ok`, `tracking.delivered` (+PoD), `GEOFENCE_ENTER/EXIT`
  → **SSE** milestone releases.
- on-time / delay / exception outcomes → **M5** reputation.
- `tracking.exception_raised` (Missed Handover) → **M3** re-dispatch; (Temp Breach) → **SSE** hold.
- real-time state + exceptions → **M7** digital-twin feed.
- validated events → **M6** webhook subscribers.

## Non-functional gates (§7.3)
- 99.99% ingestion + timeline APIs (`NFR-VTT-01`); ingest→timeline < 500ms p95, geofence eval
  < 100ms (`NFR-VTT-02`); sustain 500k events/s (`NFR-VTT-03`); auto-scale 10× < 2 min
  (`NFR-VTT-04`); 100% anchored events verifiable, at-least-once + idempotent, zero event loss
  (`NFR-VTT-05`/`06`).

## Summary

| Sprint | Theme | Points | Exit criterion |
|--------|-------|--------|----------------|
| 0 ✅ | Foundations + route context | 13 | **Done** — M4 up; context arrives via real `shipment.leg_decomposed` |
| 1 🟡 | Ingest → timeline → proof | 52 | **Backend + timeline UX done** (normalize/dedup/state-machine/anchor/PoD/oracle events); courier PoD-capture UX (T4-111) pending |
| 2 ✅ | ETA, exceptions, geofences | 32 | **Done** — live multi-leg ETA + geofence auto-events + classified exception cases (incl. IoT) |
| 3 🟡 | Alerts, streaming, control tower | 26 | **Backend done** — alert rules → notifications + HMAC webhook streaming; search/list + analytics API. Participant live-map UX (T4-307) + real email/SMS gateways (T4-302) + digests (T4-052) pending |

## Status — Sprints 2–3 backend ✅ built (2026-06-28)
- **Sprint 2:** `EtaService` (VTT-030/031 — per-leg distance/mode-speed + handover buffers → aggregated
  ETA with 95% CI; recomputed from live events). `GeofenceService` (VTT-045 — global library + route
  geofences + custom; a position update auto-generates `GEOFENCE_ENTER/EXIT`). `ExceptionService`
  (VTT-040/041/042/044 + VTT-013 — rules: route-deviation, prolonged-stationary, temp/shock breach,
  delivery-without-acceptance, missed-window; severity classification; persistent cases with
  open→ack→resolve/false-alarm lifecycle + reason-logged override; ledger-anchored; emits
  `tracking.exception_raised`).
- **Sprint 3:** `AlertService` (VTT-050/051/053 — configurable rules → in-app/email/sms/webhook
  notifications + an HMAC-SHA256-signed webhook streaming outbox). `AnalyticsService` (VTT-073) +
  `TrackingService.list` search (VTT-071) + API-first endpoints (VTT-072).
- **M4 → M7 telemetry loop:** a high/critical exception now drives M7's autonomous response —
  `OrchestrationService.evaluateException` + `ExceptionResponseService` subscribe to
  `tracking.exception_raised` and fire shipper policies behind the human gate. Proven live (temp
  breach → autonomous rebook via M3) + e2e.
- **Tests:** 8 M4-advanced unit specs + the M7 telemetry-loop unit spec + an M4→M7 e2e flow. Full
  suite **148 unit + 20 e2e green**.
- **Endpoints:** `/v1/tracking/{:id/eta, :id/position, :id/sensor, :id/check-deadline, :id/exceptions,
  exceptions/:caseId/(acknowledge|resolve|false-alarm|override), geofences, alerts/rules, alerts,
  webhooks, webhooks/outbox, analytics}` + `GET /v1/tracking?state=&carrier=`.
- **Remaining:** participant low-literacy live-map UX (T4-307), courier PoD-capture UX (T4-111),
  real email/SMS gateways + digests/escalation (T4-302/052), unified map UI (the M7 control tower
  already provides an ops map). ETA accuracy feedback loop (VTT-032) not built.

**M4 total: 123 pt.** Phase-1 "basic tracking" MVP = Sprints 0–1 + `T4-201` (~70 pt). **Phase-1
integration test:** a shipment with a registered route receives multi-carrier events
(truck → ocean → last-mile) that normalize into one anchored timeline, a geofenced pickup emits
`tracking.pickup_ok`, and a final PoD emits `tracking.delivered` — all visible on the
low-literacy timeline UI.
