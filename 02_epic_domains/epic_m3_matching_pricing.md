# Epic M3 — Dynamic Matchmaking & Pricing Engine (DME)

> Playbook: Compendium §6. Build order: **fourth** (Phase 2 MVP). Depends on: M1, M2.
> Feeds: M4, M5, SSE, M7.

## Summary
The transactional heart of GLOS — the real-time, AI-optimized marketplace that pairs any
logistics demand with best-fit available capacity at a fair, dynamic price, with sub-second
last-mile latency and fairness/transparency built into the logic. This is what makes GLOS
"Uber-like."

## Scope
**In:** demand ingestion + standardization, supply-side real-time awareness, the matching AI core
(multi-objective optimization), dynamic pricing, task assignment lifecycle, fairness/transparency
governance.
**Out:** identity/VC issuance (M1), shipment schema (M2), event tracking (M4), reputation math
(M5), money movement (SSE).

## Features, Requirements & Acceptance Criteria

### F1 — Demand Ingestion & Standardization
- **M3-010 Multi-Channel Demand Intake** (Must) — AC: accepts REST/gRPC/portal jobs from DID-authenticated shippers; supports single, batch, and recurring requests.
- **M3-011 Leg Decomposition Engine** (Must) — AC: multi-stop/cross-border jobs auto-decompose into atomic matchable legs (first-mile, line-haul, freight, customs, last-mile).
- **M3-012 Constraint Tagging & Normalization** (Must) — AC: constraints normalize into machine-readable filters (mandatory certs, equipment, temperature, max handling, clearances).
- **M3-013 SLO Definition** (Must) — AC: shipper sets per-leg SLOs (deadline, max cost, min reputation, eco preference) → translated into optimization weights.

### F2 — Supply-Side Integration & Real-Time Awareness
- **M3-020 Real-Time Availability Feed** (Must) — AC: carriers broadcast availability via heartbeat; mobile couriers send live GPS/status; fleets send location + backhaul; warehouses send dock availability.
- **M3-021 Capability-Aware Filtering** (Must) — AC: M3 queries M1 to include only providers whose VCs satisfy mandatory certs (e.g. DG Class 1 requires a valid unexpired VC).
- **M3-022 Predictive Availability for Pre-Booking** (Should) — AC: historical data predicts future capacity with probability; shippers can pre-book with dynamic price.
- **M3-023 Virtual Fleet Aggregation** (Could) — AC: independent couriers in a zone group into a virtual fleet for coverage guarantees.

### F3 — The Matching AI Core
- **M3-030 Multi-Objective Optimization** (Must) — AC: simultaneously optimizes weighted cost / transit time / reputation / carbon / utilization; weights derive from SLOs + network goals.
- **M3-031 Context-Aware Batch Matching** (Must) — AC: instant match (<1s) for time-sensitive last-mile; ~30s batch window for line-haul global optimization.
- **M3-032 Multi-Leg Orchestration Logic** (Must) — AC: guarantees end-to-end feasibility (realistic handover times, total cost within ceiling, inter-compatible provider chain).
- **M3-033 Reputation-Aware Matching** (Must) — AC: M5 score is a first-class signal; very-high-value shipments are not matched to low-reputation carriers; new carriers nudged to low-risk tasks.
- **M3-034 Cold Start Resolution** (Should) — AC: new providers get boosted initial opportunities with a max task-value cap until a success threshold is met.
- **M3-035 Diversity & Fairness Constraints** (Should) — AC: fairness-aware RL gives comparable service levels statistically similar offers; a dashboard reports offer distribution by segment.

### F4 — Dynamic Pricing Engine
- **M3-040 Real-Time Dynamic Pricing** (Must) — AC: per-job/leg price computed from base lane rate, surge, scarcity, equipment, distance, time pressure, quality tier; shown before commitment.
- **M3-041 Algorithmic Surge Pricing Rules** (Must) — AC: surge bounded by a configurable cap (e.g. 3x), triggered by objective criteria; shipper sees a clear surge breakdown.
- **M3-042 Binding vs Indicative Pricing** (Must) — AC: spot instant prices binding for 60s; batch/pre-booked prices indicative with confidence interval, binding on match confirmation.
- **M3-043 All-In Pricing with Compliance Checks** (Should) — AC: final price estimates duties/taxes/surcharges/handling into one all-in figure.
- **M3-044 Service Tier Pricing** (Could) — AC: Economy/Standard/Express/White-Glove tiers map to pricing + matching preferences (White-Glove may require ≥4.8 reputation + special VCs).

### F5 — Task Assignment & Lifecycle
- **M3-050 Provider Offer & Acceptance Flow** (Must) — AC: offer pushed with DID-masked details (zones, required VCs, dimensions, payout); provider accepts/rejects within a configurable window (e.g. 30s).
- **M3-051 Intelligent Fallback Cascade** (Must) — AC: on reject/timeout, instantly cascade to the next best provider from a pre-computed, position-updated list; shipper does not re-submit.
- **M3-052 Auto-Assignment Mode** (Should) — AC: high-volume/fire-and-forget shippers can dispatch without manual acceptance (with provider consent).
- **M3-053 Counter-Offer Handling** (Could) — AC: providers may submit structured counter-offers for non-instant jobs.
- **M3-054 Match Lifecycle Audit Trail** (Must) — AC: every decision (why selected, per-dimension score, price formula, accept/reject timestamps) is immutably logged; replayable for audit/disputes/retraining.

### F6 — Fairness, Transparency & Governance
- **M3-060 Explainable Match Transparency** (Should) — AC: a human-readable explanation accompanies each match (e.g. "highest-rated 4.9 with reefer at $X, 10% cheaper than next best").
- **M3-061 Algorithmic Bias Dashboard** (Should) — AC: monitors offer rate / earnings-per-active-hour / acceptance rate by segment/geo/contractor status; visible to an independent fairness auditor.
- **M3-062 Override & Manual Intervention** (Must) — AC: authorized ops can force-assign or block a match (VIP/humanitarian); every override logged with mandatory reason + review flag.

## Data & Privacy (§6.3)
- AC: matching operates on DIDs, capability VCs, anonymized geohashes, reputation scores — never provider names, license numbers, or exact addresses.
- AC: exact courier GPS revealed only to the matching service; shipper sees location only after acceptance within a proximity fence.
- AC: matching executes in data centers compliant with the most restrictive jurisdiction.

## Non-Functional Acceptance Gates (§6.4)
- Instant match p95 < 500ms; line-haul batch solution < 2 min for 10,000 jobs (`NFR-M3-01`).
- 50,000 match queries/s peak with graceful degradation (`NFR-M3-02`).
- Horizontal scale; add GPU/TPU inference nodes without interruption (`NFR-M3-03`).
- 99.99% for accept/confirm endpoints (`NFR-M3-04`).
- Dynamic-pricing MAPE < 5% vs actual rates in stable conditions (`NFR-M3-05`).
- Deterministic replay: same state snapshot + same job → identical ranked list (`NFR-M3-06`).

## Hooks (integration)
**Consumes:** M1 identity resolution, VC queries, reputation endpoint (M5 via M1 registry),
wallet settlement triggers; M2 neutral job descriptions, leg hints, Job Requirement Vector;
real-time supply heartbeats/GPS.
**Emits / triggers (events):**
- `MatchProposed` / `PriceQuoted` → shipper confirmation UI.
- `MatchConfirmed` → **SSE** creates the escrow contract; **M4** initiates tracking for each leg.
- `OfferSent` / `OfferAccepted` / `OfferRejected` / `FallbackCascaded` → lifecycle + audit trail.
- On missed handover, **M4** requests re-dispatch back into M3.
- Post-task → **M5** rating triggers; match data → **M7** capacity/pricing signals & prescriptive execution.

## Low-Literacy UX Acceptance Criteria (WS-UX)
- AC: courier task card shows payout amount as the hero element; Accept / Reject are two large buttons; pickup shown as a masked zone on a map.
- AC: surge/price breakdown shown with simple icons + plain words, never a dense table.
- AC: match explanation (M3-060) rendered as one plain sentence with an icon; read-aloud available.
- AC: countdown to accept is a visible shrinking bar, not just text.
