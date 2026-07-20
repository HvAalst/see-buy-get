# M3 Sprint Backlog — Dynamic Matchmaking & Pricing Engine (DME)

> Source epic: `../02_epic_domains/epic_m3_matching_pricing.md` (Compendium §6).
> DoD = epic acceptance criteria. Points Fibonacci. Ticket ids `M-###`.

## Dependencies & prerequisites
- **M1 (done)** — capability VCs (`CredentialService`), pseudonymous reputation + capabilities
  (`OperationalStore`). Reputation defaults to the Bayesian prior (3.0/5.0) until **M5** sets it.
- **M2 (done)** — the **Job Requirement Vector** (mandatory VCs, equipment, mode, weight per leg)
  is the demand spec M3 matches against.
- **M4 (done)** — post-match tracking is initiated by the `match.confirmed` event.
- **SSE (done)** — `match.confirmed` now **auto-creates the escrow** from the agreed price +
  carrier, replacing SSE's manual escrow-terms stand-in.
- **M5 (NOT built)** — real reputation scores + fairness data; M3 uses the prior + a stand-in now.

## Build order
`Sprint 0 (skeleton + supply) → Sprint 1 (filter → score → price → offer/accept loop) →
Sprint 2 (batch/predictive/fairness) → Sprint 3 (governance, explainability, service tiers)`.

**Minimal marketplace = Sprint 0 + Sprint 1.**

---

## Sprint 0 — Skeleton & supply · 10 pt
- **M-001 · M3 module skeleton + types + M2 exports** — `INF` · **2pt**
  - DoD: `m3` module wired; `GET /v1/matching/module-info` active; M2 exports ShipmentService + LegDecompositionService so M3 can pull the JRV.
- **M-002 · Real-time availability feed** — `M3-020` · **5pt**
  - DoD: carriers broadcast availability (DID, zone, equipment, status) via a lightweight heartbeat; M3 holds the live supply pool.
- **M-003 · Demand intake (pull JRV) + SLOs** — `M3-010/013` · **3pt**
  - DoD: a shipper submits a demand for a decomposed shipment; M3 pulls its JRV; shipper SLOs (max cost, min reputation, deadline) captured as optimization weights.

## Sprint 1 — Filter → score → price → assign · 34 pt
- **M-101 · Capability-aware filtering** — `M3-021` · **5pt**
  - DoD: include only available carriers whose VCs satisfy the JRV's mandatory certs (via M1 CredentialService) AND whose equipment covers the JRV equipment.
- **M-102 · Reputation-aware filtering** — `M3-033` · **3pt**
  - DoD: exclude carriers below the SLO's min reputation; use the prior for unrated carriers; keep very-high-value shipments off low-reputation carriers.
- **M-103 · Multi-objective scoring** — `M3-030` · **8pt**
  - DoD: rank eligible carriers by a weighted combination of cost, reputation, and proximity/ETA; weights derived from the shipper SLOs.
- **M-104 · Dynamic pricing + surge** — `M3-040/041` · **5pt**
  - DoD: price from base lane rate × demand/scarcity surge (bounded by a configurable cap, e.g. 3×); transparent breakdown; shown before commitment.
- **M-105 · Offer / accept + fallback cascade** — `M3-050/051` · **8pt**
  - DoD: offer to the top-ranked carrier; on accept → confirmed; on reject/timeout → cascade to the next without re-submission.
- **M-106 · Match audit trail + `match.confirmed`** — `M3-054` · **5pt**
  - DoD: every decision (candidate scores, price formula, accept/reject) immutably logged + replayable; on confirmation emits `match.confirmed` → SSE escrow + M4 tracking.

## Sprint 2 — Batch, predictive & fairness · 19 pt — ✅ done
- **M-201 · Context-aware batch matching** — `M3-031` · **8pt** — ✅ `BatchMatchingService`: quotes all
  demands then global distinct-carrier assignment (greedy on sorted score edges). `POST /matching/batch`.
- **M-202 · Predictive availability / pre-booking** — `M3-022` · **5pt** — ✅ `PredictionService`:
  per-zone supply history (sampled on each heartbeat) → `forecast(zone)` (expected + probability +
  confidence) → `preBook` at an indicative price + confidence band. `GET /matching/forecast/:zone`,
  `POST /matching/prebook`.
- **M-203 · Cold-start boost + fairness constraints** — `M3-034/035` · **6pt** — ✅ `CarrierProfileService`
  (completions from `match.confirmed`/`tracking.delivered`): cold-start scoring boost + value cap
  (only diverts new carriers off high-value jobs when an established alt exists). `FairnessService`
  records offer/accept distribution by zone/tier + cold-start share.

## Sprint 3 — Governance, transparency, tiers · 16 pt — ✅ done
- **M-301 · Explainable match transparency** — `M3-060` · **5pt** — ✅ plain-language `explanation` on
  every quote/offer (winner reputation, eligible count, next-best, cold-start note). Side-effect-free
  `quote()` preview (deterministic ranking, NFR-M3-06).
- **M-302 · Override & manual intervention** — `M3-062` · **3pt** — ✅ `forceAssign` + `block` (mandatory
  reason, `reviewFlag`, audited). `POST /matching/matches/:id/force-assign|block`.
- **M-303 · Algorithmic bias dashboard** — `M3-061` · **5pt** — ✅ `GET /matching/fairness` (offers/accepts
  + acceptance rate by zone & tier + cold-start offer share).
- **M-304 · Service-tier pricing (Economy…White-Glove)** — `M3-044` · **3pt** — ✅ tier multipliers
  (0.85/1/1.4/2.2) in `PricingService`; White-Glove enforces a ≥4.8 reputation floor in matching.
  Binding (spot, 60s) vs indicative (batch/pre-book, ±12% band) pricing (M3-042).

## Hooks
**Consumes:** M2 Job Requirement Vector; M1 capability VCs + reputation + DIDs; M3 availability feed.
**Emits:** `match.proposed`, `match.offer_sent`, `match.offer_accepted`, `match.fallback_cascaded`,
`match.confirmed` → **SSE** (escrow create) + **M4** (tracking init).

## NFR gates (§6.4)
Instant match p95 < 500ms (`NFR-M3-01`); deterministic replay — same snapshot + job → identical
ranked list (`NFR-M3-06`); pseudonymous matching (DIDs/VCs/geohashes only, `§6.3`).

## Summary
| Sprint | Theme | Points | Exit criterion |
|--------|-------|--------|----------------|
| 0 ✅ | Skeleton + supply | 10 | **Done** — availability feed + demand pulls the M2 JRV |
| 1 ✅ | Filter → score → price → assign | 34 | **Done** — capability+reputation filter → scored rank → dynamic price → offer/accept/cascade → `match.confirmed` → SSE escrow |
| 2 ✅ | Batch, predictive, fairness | 19 | **Done** — batch optimization + predictive/pre-book + cold-start/fairness |
| 3 ✅ | Governance & tiers | 16 | **Done** — explainability, override, bias dashboard, service tiers |

**M3 total: 79 pt.** Minimal marketplace = Sprints 0–1 (~44 pt). **Integration test:** a decomposed
shipment is matched to a capability-verified, available carrier; accepting the offer fires
`match.confirmed`, which auto-creates the SSE escrow — extending the loop to
**M2 → M3 → SSE → M4 → M1**.
