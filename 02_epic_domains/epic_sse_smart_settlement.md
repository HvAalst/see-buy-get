# Epic SSE — Smart Settlement & Escrow Engine

> Playbook: Compendium §9. Cross-cutting. Build order: **sixth** (Phase 2 escrow + instant-payout pilot).
> Depends on: M1, M2, M3, M4. Feeds: M5 (dispute outcomes).

## Summary
The financial nerve center — a programmable, conditional, multi-currency settlement system that
replaces invoicing and manual payment with automated, conditional, immutable financial flows tied
directly to verified logistics events. Every shipment becomes a self-executing financial
instrument.

## Scope
**In:** escrow + pre-funding, smart invoices, conditional settlement triggers, multi-party/multi-leg
distribution, dispute management, instant payouts + liquidity services, multi-currency/FX/compliance,
audit/reconciliation.
**Out:** identity/wallet primitives (M1 provides wallets), event truth (M4 is the oracle),
pricing (M3 sets terms), reputation math (M5).

## Features, Requirements & Acceptance Criteria

### F1 — Escrow & Pre-Funding
- **SSE-010 Multi-Currency Escrow Creation** (Must) — AC: on match confirmation, a segregated multi-sig escrow smart contract is created on the permissioned ledger, bound to the e-waybill ID.
- **SSE-011 Automated Pre-Funding** (Must) — AC: shipper funds the all-in price (from M3) before first-mile dispatch; supports bank transfer, card, wallet balance, stablecoin.
- **SSE-012 Partial Funding for Staged Shipments** (Should) — AC: long-haul multi-leg can fund first leg(s) initially; later legs fund on triggers/manual confirm, minimizing capital lock-up.
- **SSE-013 Escrow Balance Transparency** (Must) — AC: shipper + carriers see escrow status (funded/partially/fully released) in real time with notifications.

### F2 — Smart Invoice Generation & Management
- **SSE-020 Event-Driven Invoice Creation** (Must) — AC: a draft invoice auto-creates on match confirmation (base rate + estimated taxes + dynamic price), linked to shipment ID + party DIDs.
- **SSE-021 Live Invoice Update Engine** (Must) — AC: verified M4 events auto-update line items (detention fee, temp-excursion penalty, on-time bonus); each line links to its triggering event.
- **SSE-022 Immutable Invoice Finalization** (Must) — AC: on delivery acceptance or dispute-deadline expiry, the invoice finalizes, is signed, and committed to the ledger.
- **SSE-023 Multi-Party Invoice Splitting** (Must) — AC: multi-leg shipments generate independent per-carrier invoices rolling up under a master invoice.
- **SSE-024 E-Invoice Compliance & Formats** (Should) — AC: invoices generate in PEPPOL/ZUGFeRD/national e-invoicing formats, downloadable/API-accessible.

### F3 — Conditional Settlement Triggers & Release Logic
- **SSE-030 Milestone-Based Release** (Must) — AC: configurable % release at milestones (e.g. 20% pickup, 50% cross-dock, 30% delivery), each verified by M4 (geofence/signature/IoT).
- **SSE-031 IoT Oracle-Triggered Release** (Should) — AC: releases conditioned on attested sensor data (e.g. temperature stayed 2–8°C with no gaps).
- **SSE-032 Recipient Acceptance (Human-in-Loop)** (Must) — AC: final delivery can require recipient digital signature; final-leg payment held until acceptance unless auto-acceptance configured.
- **SSE-033 Time-Bound Auto-Acceptance** (Must) — AC: if no dispute within a configurable window (e.g. 24h standard / 1h instant) after delivery proof, acceptance auto-triggers and remaining escrow releases; shipper warned beforehand.
- **SSE-034 Penalty & Incentive Automation** (Should) — AC: late penalties / early-delivery incentives auto-adjust the final payout per the match agreement without manual action.

### F4 — Multi-Party & Multi-Leg Distribution
- **SSE-040 Atomic Multi-Party Payouts** (Must) — AC: a milestone releasing to multiple carriers executes atomically — all sub-payouts succeed or the whole transaction rolls back.
- **SSE-041 Dynamic Fee Allocation** (Must) — AC: funds allocated per agreed role pricing including transparent auto-deduction of the GLOS commission.
- **SSE-042 Cross-Border Settlement Orchestration** (Must) — AC: settle each party in its currency (CNY/USD/EUR) with FX within escrow or at disbursement using real-time rates.
- **SSE-043 Sub-Contractor Passthrough** (Should) — AC: a forwarder's payment conditionally splits to verified sub-carriers' wallets on the same milestone proof.

### F5 — Dispute Management & Resolution
- **SSE-050 Structured Dispute Filing** (Must) — AC: any party can file against a milestone/line within the auto-acceptance window, attaching audit-trail evidence + desired resolution.
- **SSE-051 Dispute-Triggered Escrow Freeze** (Must) — AC: undisputed portions settle; only the disputed amount (+ buffer) is frozen into a dispute sub-contract.
- **SSE-052 Automated Evidence Pack** (Must) — AC: a resolution pack (event log, invoice version history, tracking data, contracts) auto-compiles for both parties + mediator.
- **SSE-053 Tiered Resolution Workflow** (Should) — AC: L1 auto-negotiation (rule-based split) → L2 AI mediation → L3 human on-chain arbitration; ruling executes automatically.
- **SSE-054 Immutable Resolution Recording** (Should) — AC: outcome + adjusted settlement written immutably; reputation updated (feeds M5).

### F6 — Instant Payouts & Liquidity
- **SSE-060 Real-Time Push-to-Debit/Card** (Must) — AC: on delivery confirmation net payout pushes to debit/bank/wallet via Visa Direct/Mastercard Send/RTP; funds available target < 30s.
- **SSE-061 Earned Wage Access for Couriers** (Could) — AC: couriers can advance up to a % of accrued-but-unsettled earnings based on reputation/history.
- **SSE-062 Invoice Factoring for SMEs** (Could) — AC: small carriers can sell verified future-dated smart invoices to partners for immediate cash; offer appears in-wallet once a milestone verifies.

### F7 — Multi-Currency, FX & Compliance
- **SSE-070 Multi-Currency Wallet Interoperability** (Must) — AC: interoperates with M1 wallets to hold/convert/settle fiat (USD/EUR/SGD) + stablecoin (USDC); participant always receives nominated currency.
- **SSE-071 Competitive Real-Time FX Engine** (Must) — AC: guaranteed 60s FX rate at funding + each payout, sourced from a liquidity-provider network; spread transparent + fixed at transaction time.
- **SSE-072 Compliance Rule Engine (KYC/AML/Sanctions)** (Must) — AC: before any payout, real-time screen against sanctions + re-check sender/receiver DIDs for active holds; failed screens frozen + queued.
- **SSE-073 Tax Withholding & Reporting** (Should) — AC: where required, auto-withhold taxes (VAT/GST/withholding), generate receipts, feed regulatory reporting, configurable by jurisdiction.

### F8 — Audit, Reconciliation & Reporting
- **SSE-080 Continuous Automated Reconciliation** (Must) — AC: real-time reconciliation across escrow balances, internal ledger, and final invoices; discrepancies alert + halt related transactions until resolved.
- **SSE-081 Participant Financial Dashboard** (Must) — AC: real-time escrow balances, pending settlements, line-item history linked to shipment IDs, downloadable statements.
- **SSE-082 Immutable Triple-Entry Ledger** (Should) — AC: every financial event recorded as cryptographically linked entries; both counterparties + platform get a signed receipt.

## Non-Functional Acceptance Gates (§9.3)
- 99.999% uptime; no lost/double-spent funds under any failure (`NFR-SSE-01`).
- Instant payout notification < 5s; escrow funding confirm < 10s; dispute freeze < 1s (`NFR-SSE-02`).
- 500,000 active escrows; 10,000 settlement events/s peak (`NFR-SSE-03`).
- PCI DSS L1, SOC 2 Type II, FIPS 140-2 HSMs, formal verification of escrow contract code (`NFR-SSE-04`).
- 100% of financial state changes replayable from the immutable log (`NFR-SSE-05`).

## Hooks (integration)
**Consumes:** M1 wallets (hold/fund/receive) + DID + compliance VCs; M2 e-waybill ID as financial
root; M3 agreed pricing/tiers/penalty-bonus rules (escrow terms); M4 verified events as settlement
oracles (`PICKUP_OK`, `HANDOVER_OK`, `DELIVERED`, temp-breach holds).
**Emits / triggers (events):**
- `EscrowCreated` (on M3 `MatchConfirmed`) / `EscrowFunded`.
- `MilestoneReleased` / `PayoutCompleted` → M1 wallet credit; couriers' instant payout.
- `InvoiceFinalized` / `FeeDeducted`.
- `DisputeFiled` / `DisputeResolved` → **M5** reputation adjustment (M5-050).
- Settlement completion → **M5** rating prompts (M5-023). Reputation (M5) gates EWA/factoring.

> **Outstanding:** auto-derive *baseline* escrow terms from the M2 twin — `commercialValue` (total),
> `deliveryWindow` (SLA → penalty deadline), and `milestones` (release split) — per §5.5. M2 exposes
> all three today; SSE currently takes terms from the M3 match or explicit create input. (Built so far:
> Sprints 0–3 — fees/FX/penalty/staged + disputes + triple-entry + dashboard.)

## Low-Literacy UX Acceptance Criteria (WS-UX)
- AC: payout shown as a single large amount with currency symbol; "Money is on the way" plain status with icon.
- AC: escrow state shown as a simple 3-step visual (Held → Partly paid → Paid), not financial jargon ("escrow"→"money held safe").
- AC: dispute filing is plain-language with photo upload + tappable reason chips; read-aloud available.
- AC: instant cash-out is one big confirm button with a plain summary; success has an audio + visual cue.
