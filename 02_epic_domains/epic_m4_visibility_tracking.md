# Epic M4 — Real-Time Visibility & Tracking Tower (VTT)

> Playbook: Compendium §7. Build order: **fifth** (Phase 1 basic tracking). Depends on: M2, M1.
> Acts as the trusted event oracle for SSE and M5; feeds M7.

## Summary
The single source of truth for where any shipment is and what has happened to it. Abstracts
multi-carrier chaos into one unified, standardized, immutable timeline and acts as an active
exception-management engine.

## Scope
**In:** multi-protocol ingestion + normalization, event processing + timeline construction,
predictive ETA, exception detection/management, alerting + event streaming, immutable audit +
proof-of-delivery, control-tower dashboard/APIs.
**Out:** identity (M1), shipment schema (M2), matching (M3), settlement (SSE), AI orchestration (M7).

## Features, Requirements & Acceptance Criteria

### F1 — Data Ingestion & Connector Framework
- **VTT-010 Multi-Protocol Ingestion Gateway** (Must) — AC: pluggable connectors for REST/gRPC, MQTT/AMQP (IoT), AIS (maritime), ACARS/SITA (air), EDI (X12 214/315, EDIFACT IFTSTA), SFTP, and a mobile SDK.
- **VTT-011 Carrier-Agnostic Normalization** (Must) — AC: raw events normalize to the GLOS Standard Tracking Event Schema (GLOS ID, UTC ts, geocoded location, controlled-vocabulary event type, source DID, raw payload ref, unique event hash).
- **VTT-012 Plug-and-Play Connector Library** (Must) — AC: certified connectors exist for major carriers (FedEx/DHL/UPS/Maersk/CMA CGM/SF Express); a connector SDK enables partner-built certified connectors.
- **VTT-013 IoT Sensor Direct Ingestion** (Should) — AC: temperature/humidity/shock/light readings bind to a GLOS ID; threshold breach auto-raises an EXCEPTION event.
- **VTT-014 Manual Event Submission** (Must) — AC: authorized participants submit manual events; manual events get lower default confidence unless verified by photo/proof.

### F2 — Event Processing & Timeline Construction
- **VTT-020 Event Dedup & Conflict Resolution** (Must) — AC: identical events deduplicated; resolution prefers automated over manual and carrier-sourced over third-party; raw conflicts preserved.
- **VTT-021 State Machine Engine** (Must) — AC: each shipment follows a state machine; illegal transitions (e.g. IN_TRANSIT→DELIVERED without OUT_FOR_DELIVERY) are flagged as anomalies.
- **VTT-022 Timeline Aggregation & Display** (Must) — AC: a unified chronological timeline shows status, timestamp, map location, carrier, and proof; exposed via API + UI.
- **VTT-023 Milestone & Completion %** (Should) — AC: planned route yields milestones + a percentage-of-journey indicator across carriers.
- **VTT-024 Data Provenance & Quality Score** (Should) — AC: every event carries provenance + confidence (0–100); composite timeline shows overall data quality.

### F3 — Predictive ETA Engine
- **VTT-030 Basic Predictive ETA** (Must) — AC: continuously updated ETA from location, route, historical lane/carrier, traffic/weather, with 95% confidence interval.
- **VTT-031 Multi-Leg ETA Aggregation** (Must) — AC: leg ETAs aggregate into overall delivery ETA with handover buffers; a delay in any leg propagates.
- **VTT-032 ETA Accuracy Feedback Loop** (Should) — AC: actuals vs predictions self-calibrate per lane/carrier; accuracy reported in dashboards.

### F4 — Exception Detection & Management
- **VTT-040 Rule-Based Exception Engine** (Must) — AC: real-time evaluation for Missed Window, Route Deviation (>X km), Prolonged Stationary, Temp/Shock Breach, Handover Delay, Delivery Without Acceptance.
- **VTT-041 Exception Severity Classification** (Must) — AC: auto-classify Critical/High/Medium/Low by deviation, commodity, SLA; Critical triggers immediate alert + escalation.
- **VTT-042 Exception Case Lifecycle** (Must) — AC: each exception is a persistent case (detection time, type, severity, affected milestones, status, action audit log).
- **VTT-043 Automated Resolution Actions** (Should) — AC: e.g. "Missed Handover → request re-dispatch from M3"; "Temperature Breach → hold settlement + notify quality team."
- **VTT-044 Manual Exception Override** (Must) — AC: ops/authorized shippers can mark False Alarm or override severity; overrides require a mandatory reason and are logged immutably.
- **VTT-045 Geofence Management** (Should) — AC: global geofence library (ports/airports/hubs/customers); entry/exit auto-generated on GPS intersection; custom geofences definable.

### F5 — Alerting, Notification & Event Streaming
- **VTT-050 Configurable Alert Rules** (Must) — AC: visual/API rule builder ("notify if >30 min late", "alert if >8°C for >10 min"); filterable by lane/commodity/tier.
- **VTT-051 Multi-Channel Notifications** (Must) — AC: in-app/email/SMS/webhook, selectable per rule.
- **VTT-052 Digest & Escalation Schedules** (Should) — AC: periodic digests + escalation (e.g. Critical unacknowledged 30 min → manager SMS).
- **VTT-053 Webhook Streaming** (Must) — AC: every validated event/exception pushed with at-least-once delivery, exponential backoff, HMAC-SHA256 signed payloads.

### F6 — Immutable Audit Trail & Proof-of-Delivery
- **VTT-060 Cryptographic Event Anchoring** (Must) — AC: every validated non-duplicate event is SHA-256 hashed and batch-anchored to the ledger within 5s; only the hash on-chain.
- **VTT-061 Proof-of-Delivery Collection** (Must) — AC: supports recipient signature, GPS-tagged photo, and PIN; PoD attaches to DELIVERED and anchors on-chain.
- **VTT-062 Tamper-Proof Audit Export** (Should) — AC: a verifiable audit report (timeline + PoD + on-chain tx IDs) is independently verifiable.

### F7 — Control Tower Dashboard & APIs
- **VTT-070 Unified Shipment Map View** (Must) — AC: real-time global map, color-coded status markers; click expands timeline.
- **VTT-071 Shipment Search & Filtering** (Must) — AC: search by GLOS ID/reference/carrier/status/route/date; filters savable as views.
- **VTT-072 API-First Architecture** (Must) — AC: all data via REST + streaming APIs, DID-authenticated, embeddable in shipper portals/ERPs.
- **VTT-073 Performance Analytics Dashboard** (Should) — AC: on-time %, avg delay, exception counts by type/carrier/lane, trend over periods.

## Non-Functional Acceptance Gates (§7.3)
- 99.99% for ingestion + timeline APIs (`NFR-VTT-01`).
- Ingest→timeline < 500ms p95; ETA recalc < 1s; geofence eval < 100ms (`NFR-VTT-02`).
- 500,000 events/s peak; 1B+ active timelines (`NFR-VTT-03`).
- Auto-scale to 10x surge < 2 min; isolated connector pipelines (`NFR-VTT-04`).
- 100% anchored events verifiable; at-least-once with idempotency; zero event loss (`NFR-VTT-05`/`NFR-VTT-06`).

## Hooks (integration)
**Consumes:** M1 DIDs for attribution + auth; M2 digital twin (planned legs, geofences, milestone
definitions); M3 initial task assignment post-match; carrier/IoT/mobile raw event feeds.
**Emits / triggers (events) — M4 is the settlement & reputation oracle:**
- `PICKUP_OK`, `ARRIVED_AT_HUB`, `DEPARTED`, `HANDOVER_OK`, `OUT_FOR_DELIVERY`, `DELIVERED` (+PoD), `GEOFENCE_ENTER`/`EXIT` → **SSE** milestone releases.
- `DELIVERED` / on-time / delay / exception outcomes → **M5** reputation adjustments + rating prompts.
- `EXCEPTION_RAISED` (e.g. Missed Handover) → **M3** re-dispatch request; (Temp Breach) → **SSE** settlement hold.
- Real-time state + exceptions → **M7** digital twin feed.
- Validated events → **M6** webhook subscribers.

## Low-Literacy UX Acceptance Criteria (WS-UX)
- AC: tracking timeline reuses the numbered lifecycle stepper; each step = pictogram + plain status + ETA in words ("Tomorrow").
- AC: live map shows one moving icon + a plain progress sentence + a "% of journey" bar.
- AC: courier PoD capture = take photo, sign with finger, tap one big "Delivered" button; fully offline-capable with later sync.
- AC: alerts are plain-language with icon + read-aloud ("Your package is running late. New time: 4 PM.").
