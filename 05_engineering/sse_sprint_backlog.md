# SSE Sprint Backlog — Smart Settlement & Escrow Engine

> Source epic: `../02_epic_domains/epic_sse_smart_settlement.md` (Compendium §9).
> DoD = the epic's acceptance criteria. Points Fibonacci. Ticket ids `S-###`.

## Dependencies & prerequisites
- **M1 (done)** — wallets are the source/destination of all funds; escrow funds from a payer
  wallet and releases to payee wallets. The credential/compliance pieces are reused.
- **M2 (twin done)** — the Universal E-Waybill ID is the financial transaction root.
- **M4 (oracle done)** — `tracking.pickup_ok` / `.handover_ok` / `.delivered` are the settlement
  triggers. This is the key integration: **M4 event → SSE milestone release → M1 wallet payout.**
- **M3 (NOT built)** — would set pricing, service tiers, and penalty/bonus rules (the escrow
  terms). Until M3 ships, **escrow terms are supplied directly on escrow creation** (a stand-in);
  when M3 lands, SSE consumes its agreed-terms payload instead.
- **M5 (NOT built)** — dispute outcomes feed reputation; the dispute hook emits an event M5 will
  later consume.

## Build order
`Sprint 0 (escrow domain + wallet integration) → Sprint 1 (escrow lifecycle + milestone
settlement loop) → Sprint 2 (FX/cross-border/fees/penalties) → Sprint 3 (disputes + triple-entry
+ dashboard)`.

**Minimal settlement loop (the high-value slice) = Sprint 0 + Sprint 1.**

---

## Sprint 0 — Escrow domain & wallet integration · 11 pt
- **S-001 · SSE module skeleton + escrow domain types** — `INF` · **3pt**
  - DoD: NestJS `sse` module wired; `GET /v1/settlement/module-info` active; escrow/invoice types defined.
- **S-002 · WalletService transfer primitive (debit) + M1 export** — `INF`, `SSE-070` · **3pt**
  - DoD: `WalletService.debit(did, amount, ccy)` (throws on insufficient funds); M1Module exports WalletService so SSE can move funds between wallets.
- **S-003 · Escrow terms model (M3 stand-in)** — `M3 dep`, `SSE-030` groundwork · **5pt**
  - DoD: escrow terms = total + currency + milestone schedule `[{name, percent, payeeDid}]`, validated (percents sum to 100); accepted directly on creation now, from M3 later.

## Sprint 1 — Escrow lifecycle & milestone settlement loop · 41 pt
- **S-101 · Escrow creation** — `SSE-010` · **5pt**
  - DoD: on shipper confirmation, a segregated escrow is created bound to the e-waybill ID; emits `settlement.escrow_created`.
- **S-102 · Automated pre-funding from the payer wallet** — `SSE-011` · **5pt**
  - DoD: shipper funds the all-in price before first-mile; debits the payer M1 wallet; emits `settlement.escrow_funded`. Insufficient balance rejected.
- **S-103 · Escrow balance transparency** — `SSE-013` · **3pt**
  - DoD: payer + payees see escrow status (funded / partially-released / fully-released) with held/released amounts.
- **S-104 · Milestone-based release driven by M4 oracle events** — `SSE-030` · **8pt**
  - DoD: subscribe to `tracking.pickup_ok` → release PICKUP %, `tracking.handover_ok` → HANDOVER %, `tracking.delivered` → DELIVERY %; each release verified by the M4 event; emits `settlement.milestone_released`.
- **S-105 · Atomic payout to payee wallet + instant payout** — `SSE-040`/`SSE-060` · **5pt**
  - DoD: a milestone release credits the payee M1 wallet atomically (all-or-nothing for multi-payee) and triggers instant payout; emits `wallet.payout_completed`.
- **S-106 · Compliance screen before payout** — `SSE-072` · **3pt**
  - DoD: before any release, screen payer/payee DIDs for active holds; a failed screen freezes that release.
- **S-107 · Smart invoice (draft → live-update → finalize, multi-party)** — `SSE-020/021/022/023` · **8pt**
  - DoD: draft invoice on escrow creation; line items added/updated as milestones release; finalizes + anchors on completion; per-payee sub-invoices roll up under a master.
- **S-108 · Recipient acceptance + time-bound auto-acceptance** — `SSE-032/033` · **5pt**
  - DoD: final-leg release optionally held until recipient acceptance; if no dispute within the window, auto-accept and release the remainder.
- **S-109 · Continuous reconciliation** — `SSE-080` · **3pt**
  - DoD: after each release, assert `funded == released + held`; a discrepancy halts further releases and alerts.

## Sprint 2 — FX, cross-border, fees & penalties · 21 pt
- **S-201 · Dynamic fee allocation (GLOS commission)** — `SSE-041` · **5pt**
- **S-202 · Cross-border settlement + real-time FX** — `SSE-042`/`SSE-071` · **8pt**
- **S-203 · Penalty & incentive automation (late/early)** — `SSE-034` · **5pt**
- **S-204 · Partial / staged funding** — `SSE-012` · **3pt**

## Sprint 3 — Disputes, audit & dashboard · 24 pt
- **S-301 · Structured dispute filing + escrow freeze** — `SSE-050`/`SSE-051` · **5pt**
- **S-302 · Automated evidence pack** — `SSE-052` · **5pt**
- **S-303 · Tiered resolution + immutable recording (→ M5 reputation)** — `SSE-053`/`SSE-054` · **5pt**
- **S-304 · Immutable triple-entry ledger** — `SSE-082` · **3pt**
- **S-305 · UX: participant financial dashboard (escrow status, payouts, plain money words)** — `SSE-081` · **6pt**

## Hooks
**Consumes:** M1 wallets (debit payer / credit payee) + DID; M2 e-waybill ID (financial root);
M3 pricing → escrow terms (stand-in for now); **M4 oracle events as settlement triggers**.
**Emits:** `settlement.escrow_created` / `.escrow_funded` / `.milestone_released` / `.dispute_resolved`;
`wallet.payout_completed`. Settlement completion → M5 rating prompts; dispute outcomes → M5.

## NFR gates (§9.3)
99.999% uptime, no lost/double-spent funds (`NFR-SSE-01`); instant payout notify < 5s
(`NFR-SSE-02`); formal verification of escrow contract code (`NFR-SSE-04`); 100% of financial
state changes replayable from the immutable log (`NFR-SSE-05`).

## Summary
| Sprint | Theme | Points | Exit criterion |
|--------|-------|--------|----------------|
| 0 ✅ | Escrow domain + wallet integration | 11 | **Done** — escrow terms model + WalletService.debit + M1 export |
| 1 ✅ | Escrow lifecycle + milestone settlement | 41 | **Done** — M4 event → milestone release → payee payout, invoice + reconciliation + acceptance |
| 2 ✅ | FX, cross-border, fees, penalties | 21 | **Done** — commission, real-time FX, late penalty/early bonus, staged funding |
| 3 ✅ | Disputes, audit, dashboard | 24 | **Done** — file/freeze/evidence/tiered-resolve→M5, triple-entry ledger, financial dashboard UX |

**Sprints 2–3 built & verified — 99 unit + 14 e2e.** Highlight: SSE dispute resolution now fires
`settlement.dispute_resolved` → M5 lowers the at-fault party's reputation (proven e2e).

**SSE total: 97 pt.** Minimal loop = Sprints 0–1 (~52 pt). **Integration test:** a funded escrow
on a real shipment releases its pickup milestone the moment M4 emits `tracking.pickup_ok`, paying
the carrier's wallet — closing the M1→M2→M4→SSE→M1 loop.
