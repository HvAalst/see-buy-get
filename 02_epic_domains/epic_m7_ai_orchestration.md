# Epic M7 — AI-Powered Orchestration & Control Tower (AIOCT)

> Playbook: Compendium §11. Build order: **last / apex** (Phase 3 core → Phase 4 autonomous).
> Depends on: M2, M3, M4, M5 (and M1 identity). Served via M6.

## Summary
The predictive, self-healing brain that elevates GLOS from passive tracking to proactive,
autonomous supply-chain command. Continuously asks: what is going to happen, and what should we do
about it?

## Scope
**In:** real-time network digital twin, predictive ETA + disruption forecasting, prescriptive
orchestration + autonomous decisioning, what-if simulation + network design, autonomous-action
safety/rollback.
**Out:** the execution rails it commands (M3 matching, SSE settlement, M4 tracking) — M7 decides,
they act.

## Features, Requirements & Acceptance Criteria

### F1 — Real-Time Network Digital Twin
- **M7-010 Unified Graph Model** (Must) — AC: a live property graph holds all entities as nodes (shipments, vehicles, warehouses, ports, carriers, shippers) and relationships as edges, updated in real time from M4 events + M1 identity.
- **M7-011 Geospatial & Temporal Indexing** (Must) — AC: nodes/edges indexed by location + time, supporting queries like "refrigerated containers within 50km of Shanghai predicted >2h late."
- **M7-012 Heatmap & Density Visualization** (Must) — AC: control tower renders real-time heatmaps of density, delay clusters, capacity hotspots, disruptions; zoom global→single package.
- **M7-013 Digital Twin State Synchronization** (Should) — AC: eventual-consistency latency <5s from event to graph; critical events <1s.

### F2 — Predictive ETA & Disruption Forecasting
- **M7-020 AI-Powered Predictive ETA** (Must) — AC: ML ETA from GPS, historical traffic, congestion, weather, port wait, customs averages, driver HoS, with 95% confidence interval; replaces static carrier ETAs.
- **M7-021 Proactive Disruption Alerting** (Must) — AC: monitors OSINT (news, social, weather, port authority, gazettes) + internal data; detects + classifies disruptions; alert pushed within 10 min of detection.
- **M7-022 Impact Propagation Analysis** (Must) — AC: on disruption, computes blast radius (all affected shipments/containers/vessels), models cascading downstream impact, presents a ranked "most critical impacted" list.
- **M7-023 Customs Delay Prediction** (Should) — AC: predicts hold probability + duration per port/commodity/carrier at departure, flagging high-risk shipments for pre-emptive doc review.
- **M7-024 Demand Forecasting & Capacity Prediction** (Should) — AC: forecasts volume per lane/city/port at 7/14/30 days (MAPE <15%) and predicts carrier capacity crunches.

### F3 — Prescriptive Orchestration & Autonomous Decisioning
- **M7-030 Disruption Response Recommender** (Must) — AC: generates ranked prescriptive actions with cost/time/risk trade-offs (e.g. reroute vs wait vs split + air-freight).
- **M7-031 Autonomous Orchestration Policy Engine** (Must) — AC: shippers define if-then rules ("IF VIP ETA >6h beyond SLA AND extra cost <$1,000 THEN rebook to fastest alternative"); system executes autonomously, logging + notifying.
- **M7-032 Dynamic Inventory Re-Positioning** (Should) — AC: recommends/triggers pre-positioning for bonded warehouses based on predicted demand, within shipper limits.
- **M7-033 Capacity Pre-Booking & Nudging** (Should) — AC: on forecasted shortage, auto-books capacity via M3 at pre-negotiated rates or nudges carriers to reposition with incentives.
- **M7-034 Multi-Shipment Consolidation Advisor** (Could) — AC: identifies LCL→FCL/shared-truck consolidation opportunities with automated tendering.

### F4 — What-If Simulation & Supply Chain Design
- **M7-040 Supply Chain Scenario Simulator** (Must) — AC: clones the live twin into a sandbox; injects hypotheticals ("close primary port 2 weeks", "demand +300%"); simulates cost/time/risk per scenario.
- **M7-041 Optimal Network Design Recommendations** (Could) — AC: recommends structural changes with quantified payback ("Dubai bonded warehouse → −2.3 days to EMEA, payback 14 mo").
- **M7-042 Sustainability & Carbon Simulator** (Should) — AC: every simulation/recommendation includes a carbon projection; can optimize for minimum carbon within a cost tolerance.

### F5 — Autonomous Action & Rollback Safety
- **M7-050 Human-in-the-Loop Override Gates** (Must) — AC: actions above a configurable cost/risk threshold require explicit human approval; request shows recommendation + justification + one-click Approve/Reject with timeout that auto-rejects.
- **M7-051 Autonomous Action Audit Trail** (Must) — AC: every autonomous action logged immutably with triggering policy, informing data, time, result; visible to shipper + governance board.
- **M7-052 Time-Bound Rollback** (Should) — AC: a configurable window (e.g. 30 min) supports one-click undo reverting to the original plan, where contractually permitted.
- **M7-053 Anomaly Detection on AI Decisions** (Should) — AC: a secondary AI monitor freezes autonomous execution on anomalous patterns (e.g. 10x normal air-freight booking) and alerts humans.

## Data & Privacy (§11.3)
- AC: models trained on globally aggregated, anonymized data — no individual proprietary shipment identifiable in global models; federated learning may keep sensitive data in-region.
- AC: each shipper's digital twin is a secure isolated partition; simulations run only against that shipper's data + global non-competitive data (weather, port stats).
- AC: every prediction cites top influencing factors in plain language.

## Non-Functional Acceptance Gates (§11.4)
- Twin reflects real-world events <5s p95 (critical); external disruption ingested/analyzed <10 min (`NFR-M7-01`).
- Single-shipment ETA recalc <200ms; impact propagation across 10,000 shipments <30s (`NFR-M7-02`).
- Graph scales to 500M nodes / 2B edges; 1,000 concurrent simulation sessions (`NFR-M7-03`).
- 99.9% dashboard/prescriptive engine; ETA degrades gracefully to static rules if model unreachable (`NFR-M7-04`).
- Predictive ETA MAE <2h for 5-day journeys; disruption detection recall >95% (`NFR-M7-05`).
- Every recommendation has a human-readable justification + confidence score (`NFR-M7-06`).

## Hooks (integration)
**Consumes:** M1 identity/capability (trusted nodes); M2 shipment details/routes (baseline plan);
M3 real-time capacity + pricing signals; M4 real-time event stream (twin + ETA); M5 carrier
performance (reliability weighting).
**Emits / triggers (events):**
- `DisruptionDetected` / `ImpactAssessed` → ranked impacted shipments.
- `RecommendationGenerated` → shipper UI / autonomous policy evaluation.
- `ApprovalRequested` → human-in-the-loop gate (M7-050).
- `AutonomousActionExecuted` → **M3** rebooking/pre-booking; **SSE** financial impact reconciled; immutable audit.
- `ActionRolledBack` → revert M3 booking. Dashboards/sims/policies served via **M6**.

## Low-Literacy UX Acceptance Criteria (WS-UX)
- AC: disruption notice to a shipper is one plain sentence + icon ("A port strike may delay your shipment. New arrival: Friday."), with read-aloud.
- AC: prescriptive options shown as max 2–3 large comparison cards (icon + plain trade-off + price), not a dense table.
- AC: autonomous-action approval is a single screen: what happened, what we'll do, big Approve / Reject, visible countdown.
- AC: post-action notice offers a clear "Undo" button during the rollback window (M7-052).
