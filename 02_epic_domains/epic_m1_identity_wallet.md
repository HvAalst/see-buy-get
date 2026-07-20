# Epic M1 — Unified Digital Identity & Wallet (UDIW)

> Playbook: Compendium §3 (M1) + §4 (M1-ONB). Build order: **foundational — build first.**
> Depends on: nothing. Depended on by: every other module.

## Summary
The foundational trust layer. Onboards every participant, issues Decentralized Identifiers
(DIDs) and Verifiable Credentials (VCs), and provisions an embedded multi-currency wallet that
powers all settlement. "Trust-first, then orchestration" — nothing authenticates or settles
without M1.

## Scope
**In:** progressive identity verification (Tier 1–4), capability/asset registry, DID management,
embedded multi-currency wallet + settlement triggers, security/fraud detection, self-sovereign
consent, strict PII↔operational data firewall.
**Out:** matching (M3), tracking (M4), reputation scoring math (M5 — M1 only stores the VC
registry), dispute resolution (SSE).

## Features, Requirements & Acceptance Criteria

### F1 — Onboarding & Progressive Identity Verification
- **UDIW-010 Multi-Role Registration** (Must)
  - AC: one master account can hold multiple roles (Shipper, Carrier, Warehouse, Customs Broker) with independent, role-specific verification paths.
  - AC: adding a second role does not re-verify already-proven attributes; each role shows its own tier/status.
- **UDIW-011 Progressive Identity Assurance (Tiers)** (Must)
  - AC: T1 (email/phone) enables tracking + small-parcel; T2 (gov ID + liveness) enables last-mile; T3 (KYB + UBO) enables freight forwarding + API; T4 (T3 + on-site audit/insurance/DG cert) enables certified operations.
  - AC: each tier visibly lists the capabilities it unlocks; a participant cannot perform an action above their current tier.
- **UDIW-012 KYC/KYB Integration Hub** (Must)
  - AC: at least two pluggable KYC/KYB providers integrate behind one abstraction; routing is rule-based by jurisdiction; a provider can be swapped without code change to callers.
- **UDIW-013 Biometric Liveness Detection** (Must)
  - AC: any gov-ID flow enforces a liveness check (selfie video + random challenge); a proof-of-liveness certificate is generated and stored; spoof attempts (photo/replay) are rejected.
- **UDIW-014 Automated Sanctions & PEP Screening** (Must)
  - AC: every identity is screened at onboarding and continuously against sanctions/PEP/adverse-media; a positive match auto-suspends the account and creates a manual-review case.
- **UDIW-023 Background Check VC** (Must)
  - AC: courier onboarding triggers a bureau background check; on pass a `Background-Check-Passed` VC is issued with an expiry; expiry triggers renewal prompt and capability limitation.

### F2 — Capability & Asset Registry
- **UDIW-020 Verifiable Credential Wallet** (Should) — AC: certifications issued as W3C VCs; a carrier can prove "DG Certified" via ZK proof without revealing the certificate image.
- **UDIW-021 Digital Fleet & Asset Linking** (Should) — AC: assets register as digital twins linked to telemetry, maintenance, insurance, compliance status.
- **UDIW-022 Skill Endorsement & Badges** (Could) — AC: reputation-derived badges are machine-readable and surfaced to M3 at match time.

### F3 — Decentralized Identity & Control
- **UDIW-030 DID Generation** (Should) — AC: on verification a persistent DID is registered on the permissioned ledger; the participant is the controller of the DID document.
- **UDIW-031 Self-Sovereign Data Consent** (Should) — AC: participant grants granular, per-tender consent (e.g. share only "On-Time Rating" + "Cargo Type"); each grant produces a cryptographic consent receipt.
- **UDIW-032 Portable Reputation Import** (Could) — AC: T2+ can import external reputation via signed VCs; a credibility score is attached based on issuer trust.

### F4 — Embedded Multi-Currency Wallet & Settlement
- **UDIW-040 Automated Wallet Creation** (Must) — AC: a multi-currency wallet auto-provisions for every verified entity, linked to its DID and the settlement engine.
- **UDIW-041 Fiat & Stablecoin Support** (Should) — AC: hold/transact multiple fiat + regulated stablecoins; participant sets preferred settlement currency; FX applied at transaction time.
- **UDIW-042 Programmable Smart Invoices** (Should) — AC: invoices auto-calculate from verified events (on-time bonus, detention fee), each line linked to an immutable event.
- **UDIW-043 Configurable Settlement Triggers** (Must) — AC: supports Instant, Time-Locked (e.g. 50/50), and Condition-Locked (IoT oracle) escrow conditions.
- **UDIW-044 Instant Payout for Couriers** (Must) — AC: completed last-mile task pays out 24/7 in real time to bank/debit; target funds-available < 30s (see SSE-060).
- **UDIW-045 Embedded Lending / EWA** (Could) — AC: pre-qualified loan/factoring offers surface based on reputation + earnings via partners.

### F5 — Security, Auth & Anomaly Detection
- **UDIW-050 Continuous Adaptive Authentication** (Should) — AC: session risk signals monitored; step-up auth enforced for high-value actions (e.g. adding a withdrawal address).
- **UDIW-051 Synthetic Identity Detection** (Must) — AC: identity-graph models flag synthetic identities; flagged accounts freeze pending investigation.
- **UDIW-052 Multi-Party (multi-sig) Approval** (Must) — AC: corporate wallet withdrawals/critical changes above a configurable threshold require cryptographic approval from multiple admins.
- **UDIW-053 Account Recovery Protocol** (Should) — AC: social/delegate recovery requires a quorum of pre-designated contacts; no backdoor exists.

## Data & Privacy (§3.4)
- AC: PII/sensitive business data sit in a logically segregated encrypted vault; matching/business logic operate only on DIDs, pseudonymous scores, and capability VCs.
- AC: VCs use selective disclosure / ZK proofs (prove a fact without revealing underlying data).
- AC: data residency rules enforce per-jurisdiction storage (e.g. EU driver PII stays in EU).

## Non-Functional Acceptance Gates (§3.5)
- Availability 99.99% for auth + wallet APIs (`NFR-01`).
- Latency: auth/balance < 200ms p95; multi-party escrow confirm < 3s (`NFR-02`).
- Security: SOC2 Type II, ISO 27001, PCI DSS L1, FAPI 2.0 (`NFR-03`).
- Scale: 10M identities, 50k wallet tx/s peak (`NFR-04`).
- Interop: OAuth 2.1/OIDC; DID/VC per W3C (`NFR-05`).

## Hooks (integration)
**Consumes (external):** government ID verification, biometric/liveness providers, sanctions/PEP
databases, background-check bureaus, business-registry data sources, FX/banking rails.
**Emits / triggers (events):**
- `IdentityVerified`, `TierUpgraded`, `DIDGenerated`, `WalletProvisioned` → unblocks M2 anchoring, M3 availability publication.
- `VCIssued` / `VCRevoked` → M5 badge registry, M3 capability filtering, M6 authorization.
- `AccountSuspended` (sanctions/fraud hit) → halts M3 matching + SSE payouts for that DID.
- `ConsentReceiptLogged` → M6 consent-enforcement point.
- `PayoutCompleted` → SSE reconciliation.
**Provides (APIs):** identity resolution + VC query (M3), wallet source/destination of funds
(SSE), OAuth/DID auth + VC authorization introspection (M6), VC registry for badge
issuance/revocation (M5). M5 sets the initial Bayesian prior reputation at onboarding (§4.3).

## Low-Literacy UX Acceptance Criteria (WS-UX)
- AC: onboarding is a wizard — one task per screen, numbered progress bar, no dense legal text on-screen (plain summaries + read-aloud).
- AC: role picker uses large pictogram tap-cards (📦 🚚 🏭 📜), not a dropdown.
- AC: liveness uses animated visual prompts, completable one-handed, no written instructions required.
- AC: wallet home shows balance + last payout large; "Cash out" is a single big primary button.
- AC: tier status renders as a visual ladder showing what each badge unlocks (icon + plain words).
- AC: all status = pictogram + word + color + shape; passes WCAG 2.2 AA; works offline on low-end Android.
