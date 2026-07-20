# GLOS Epic Domains

Per-module epic definitions derived from `GLOS_Build_Playbook_Compendium.docx`. Each epic file
contains: summary, scope, features traced to requirement IDs, **testable acceptance criteria**,
non-functional gates, integration **hooks** (events consumed/emitted/triggered), and low-literacy
UX acceptance criteria (workstream WS-UX). The build sequence and phase mapping live in
`../05_engineering/implementation_plan.md`.

## Build order
`M1 → M2 (+M6 in parallel) → M3 → M4 → SSE → M5 → M7` ; M8 is a future (Phase 4) phase.

| Epic | Module | File | Build order | Phase |
|------|--------|------|-------------|-------|
| M1 | Unified Digital Identity & Wallet (UDIW) | [epic_m1_identity_wallet.md](epic_m1_identity_wallet.md) | 1 (foundational) | 1 |
| M2 | Universal Shipment Digitization (UDS) | [epic_m2_shipment_digitization.md](epic_m2_shipment_digitization.md) | 2 | 1 |
| M6 | Open API Gateway & Developer Ecosystem (APIG) | [epic_m6_api_gateway.md](epic_m6_api_gateway.md) | parallel | 1→3 |
| M3 | Dynamic Matchmaking & Pricing (DME) | [epic_m3_matching_pricing.md](epic_m3_matching_pricing.md) | 4 | 2 |
| M4 | Real-Time Visibility & Tracking (VTT) | [epic_m4_visibility_tracking.md](epic_m4_visibility_tracking.md) | 5 | 1 (basic) → 3 |
| SSE | Smart Settlement & Escrow Engine | [epic_sse_smart_settlement.md](epic_sse_smart_settlement.md) | 6 | 2 |
| M5 | Trust & Reputation Layer (TRL) | [epic_m5_trust_reputation.md](epic_m5_trust_reputation.md) | 7 | 2 |
| M7 | AI Orchestration & Control Tower (AIOCT) | [epic_m7_ai_orchestration.md](epic_m7_ai_orchestration.md) | 8 (apex) | 3→4 |
| M8 | Global Trade Compliance & Customs | [epic_m8_compliance_customs.md](epic_m8_compliance_customs.md) | future | 4 |

## Event hook map (high level)
- **M2** `LegDecomposed` → M3 matching, M4 planned legs, SSE escrow terms.
- **M3** `MatchConfirmed` → SSE `EscrowCreated`, M4 tracking init.
- **M4** `PICKUP_OK`/`HANDOVER_OK`/`DELIVERED` → SSE milestone releases; outcomes → M5.
- **SSE** `DisputeResolved` → M5 reputation adjustment; settlement complete → M5 rating prompt.
- **M5** `ScoreUpdated`/`BadgeIssued` → M3 ranking signal (via M1 VC registry).
- **M7** `AutonomousActionExecuted` → M3 rebooking + SSE reconciliation.
- **M6** fronts every module; enforces M1 auth + consent on every call.
