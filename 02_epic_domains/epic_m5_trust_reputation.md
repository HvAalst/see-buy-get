# Epic M5 — Trust & Reputation Layer (TRL)

> Playbook: Compendium §8. Build order: **seventh** (Phase 2 core ratings). Depends on: M1, M4.
> Feeds: M3 (matching signal), SSE (dispute-driven adjustments).

## Summary
Transforms anonymous open-network transactions into high-trust, self-regulating commercial
interactions via multi-dimensional reputation, verifiable trust badges, fraud detection, and
portable trust credentials.

## Scope
**In:** multi-dimensional scoring, structured mutual ratings, verifiable badges, fraud/Sybil
resistance, dispute-driven adjustments, transparency + participant controls.
**Out:** identity issuance (M1, M5 uses it as the VC registry), event capture (M4), matching (M3),
money/dispute mechanics (SSE — M5 only consumes outcomes).

## Features, Requirements & Acceptance Criteria

### F1 — Multi-Dimensional Reputation Scoring
- **M5-010 Granular Dimension Scores** (Must) — AC: carriers scored on On-Time, Cargo Care, Communication, Documentation, Equipment Compliance; shippers on Payment Promptness, Load Readiness, Information Accuracy, Facility Accessibility; each an independent 0–100.
- **M5-011 Weighted Composite Trust Score** (Must) — AC: single normalized 0.0–5.0 score; default weight profile publicly documented and shipper-configurable for matching filters.
- **M5-012 Time-Decayed & Volume-Weighted Model** (Must) — AC: recent + higher-value transactions weighted more (configurable half-life, default 90 days) with anti-abuse guardrails.
- **M5-013 Bayesian Average + Confidence Interval** (Must) — AC: new carriers start at a neutral prior (e.g. 3.0/5.0, high uncertainty); score converges + interval narrows with verified transactions; M3 considers the interval.
- **M5-014 Root-Cause Adjusted Scoring** (Should) — AC: oracle-verified force majeure (port closure, extreme weather) is excluded/down-weighted from on-time scoring.

### F2 — Structured Mutual Rating & Review
- **M5-020 Structured Feedback Schema** (Must) — AC: both parties submit structured forms (on-time yes/no/late+reason, condition pristine/damaged, professionalism tag) + optional free text.
- **M5-021 Verification-Anchored Rating** (Must) — AC: ratings accepted only from verified DID participants in the transaction; cryptographically bound to the M4 event log; no unauthorized/double ratings.
- **M5-022 Blinded & Private Rating** (Should) — AC: private ratings affect aggregate immediately but aren't shown individually until a cool-down or anonymization threshold.
- **M5-023 Review-First Incentive** (Should) — AC: final escrow held until rating submitted, or a small bonus for prompt rating.
- **M5-024 Automated Sentiment & Anomaly Analysis** (Should) — AC: AI hides toxic/harassment text pending review; cross-references claims against shipment data (e.g. "terrible delay" vs GPS early arrival).

### F3 — Verifiable Trust Badges & Credentials
- **M5-030 Automated Trust Badge Issuance** (Must) — AC: sustained threshold (e.g. On-Time >95% over 500+ shipments/6 mo) auto-issues a tamper-proof W3C VC ("Elite On-Time", "Zero Damage").
- **M5-031 Badge Revocation & Expiry** (Must) — AC: badges have validity; dropping below threshold auto-revokes via M1 registry with grace-period warning; revoked badges not displayed.
- **M5-032 Selective Badge Disclosure** (Should) — AC: present "Elite On-Time" VC without revealing the underlying score (ZK "score > 95%").
- **M5-033 Portable Reputation Export** (Should) — AC: full profile (score/dimensions/badges) exportable as a signed VC with expiry + revocation-check URL.

### F4 — Fraud, Sybil Resistance & Network Health
- **M5-040 Sybil Cluster Detection** (Must) — AC: graph models flag clusters via shared payment instruments, overlapping geo, coordinated timing, similar writing style; clusters frozen + investigated.
- **M5-041 Collusion Ring Identification** (Must) — AC: reciprocal closed-loop perfect-rating patterns get a "collusion discount factor" reducing their weight.
- **M5-042 Re-Identification Prevention** (Must) — AC: a banned participant's identity fingerprints (hashed credentials, device, wallet patterns) added to a global blocklist preventing re-registration.
- **M5-043 Reputation Milking Detection** (Should) — AC: accounts building rep via many low-value tasks then accepting a high-value job trigger a risk flag / extra escrow / insurance requirement.
- **M5-044 Network Health Dashboard** (Must) — AC: operator dashboard: reputation distribution, anomaly alerts, suspension rate, rating density by geo/type.

### F5 — Dispute-Driven Reputation Adjustment
- **M5-050 Dispute Outcome Integration** (Must) — AC: SSE dispute resolutions auto-trigger reputation adjustments (at-fault damage → Cargo Care deduction + public dispute note).
- **M5-051 Granular Dispute Tagging** (Must) — AC: disputes tagged by type feed the correct dimension (payment dispute → Payment Promptness only).
- **M5-052 Dispute Record Display** (Should) — AC: profile shows summary stats ("2 disputes resolved, 1 at fault") without counterparty PII.
- **M5-053 Graduated Sanctioning** (Should) — AC: repeated negative outcomes escalate (training → suspension from high-value → increased escrow → de-platforming).

### F6 — Transparency, Auditability & Participant Controls
- **M5-060 Personalized Reputation Dashboard** (Must) — AC: private dashboard with current scores, clickable change history, and a What-If simulator.
- **M5-061 Explainability for Every Score** (Must) — AC: no black-box; weightings public; per-composite explanation ("4.2 = 87% on-time(50%) + 95% cargo care(30%) + 80% docs(20%); 65th percentile this lane").
- **M5-062 Right to Challenge & Correction** (Should) — AC: a Reputation Challenge reviews the M4 event log + SSE record; errors corrected retroactively, auditable.
- **M5-063 Public Reputation API (Access-Controlled)** (Must) — AC: read-only scores/badges/dispute summaries (no raw review text/PII) consumable by matching/insurers/verifiers with consent.

## Data & Privacy (§8.3)
- AC: engine computes only on DIDs + pseudonymous transaction hashes; real-identity mapping stays in M1 vault.
- AC: written reviews encrypted at rest; decrypt only for the two participants + authorized moderators.
- AC: differential privacy on aggregate/lane statistics; deletion erases PII but retains a hashed anonymized reputation commitment on-ledger to block re-entry.

## Non-Functional Acceptance Gates (§8.4)
- 99.95% reputation query API; updates within minutes (`NFR-M5-01`).
- Score query (matching) < 50ms p95; full profile < 500ms (`NFR-M5-02`).
- 20,000 queries/s + 100,000 submissions/hr peak (`NFR-M5-03`).
- Submitted ratings immutable; adjustments only via dispute/challenge, append-only (`NFR-M5-04`).
- Sybil/collusion detection >95% precision (`NFR-M5-05`); algorithm open-source/annually audited (`NFR-M5-06`).

## Hooks (integration)
**Consumes:** M1 DIDs + VC registry (badge issuance/revocation) + consent for export; M4
tamper-proof event log (anchors ratings, verifies claims); SSE dispute outcomes + settlement
completion.
**Emits / triggers (events):**
- `RatingSubmitted` / `ScoreUpdated` → **M3** matching/ranking signal + fairness data.
- `BadgeIssued` / `BadgeRevoked` → **M1** VC registry; surfaced in M3 matching + M6 reputation API.
- `FraudClusterFlagged` → **M1** account freeze; **M3** exclusion.
- Initial Bayesian prior set at M1 onboarding; rating prompts triggered by **SSE** settlement completion.
- Reputation influences **SSE** factoring/EWA limits.

## Low-Literacy UX Acceptance Criteria (WS-UX)
- AC: rating is by pictogram (👍/👎) + a few plain tappable tags ("On time", "Careful", "Late"), free text optional.
- AC: a participant's own reputation shows as a simple star/score + 3 plain reasons, with read-aloud.
- AC: badges shown as large icons with one-line plain meaning ("Always on time").
- AC: dispute/challenge entry is plain-language with photo evidence upload, not a legal form.
