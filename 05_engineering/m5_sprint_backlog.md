# M5 Sprint Backlog — Trust & Reputation Layer (TRL)

> Source epic: `../02_epic_domains/epic_m5_trust_reputation.md` (Compendium §8).
> Scope note: this build covers **all** M5 requirements (Must + Should + Could), leaner where
> marked. DoD = epic acceptance criteria. Ticket ids `R-###`.

## Dependencies & prerequisites
- **M1 (done)** — DIDs; `CredentialService` is the VC registry for badges; `OperationalStore`
  holds the pseudonymous reputation score M5 writes back (and M3 reads).
- **M4 (done)** — `tracking.delivered` marks a transaction complete (rating eligibility).
- **M3 (done)** — `match.confirmed` records the transaction participants; M3 consumes M5's
  composite (replaces M3's reputation prior stand-in).
- **SSE (done; disputes pending)** — `settlement.dispute_resolved` drives dispute adjustments;
  SSE's dispute filing is Sprint-3 there, so M5 ships the listener now and lights up when disputes do.

## Build = one comprehensive pass (all requirements)
- **F1 — Scoring (R-1xx):** granular dimension scores `M5-010`; weighted composite `M5-011`;
  time-decay + volume-weight `M5-012`; Bayesian average + confidence interval `M5-013`;
  root-cause (force-majeure) exclusion `M5-014`.
- **F2 — Ratings (R-2xx):** structured mutual feedback `M5-020`; verification-anchored (verified
  DID + completed M4 transaction + no double) `M5-021`; blinded/private `M5-022`; review-first
  incentive `M5-023`; sentiment/anomaly analysis `M5-024`.
- **F3 — Badges (R-3xx):** automated issuance `M5-030`; revocation/expiry `M5-031`; selective
  disclosure `M5-032`; portable export `M5-033`.
- **F4 — Fraud (R-4xx):** Sybil cluster `M5-040`; collusion ring `M5-041`; re-identification
  prevention `M5-042`; reputation-milking `M5-043`; network-health dashboard `M5-044`.
- **F5 — Disputes (R-5xx):** dispute outcome integration `M5-050`; granular tagging → dimension
  `M5-051`; dispute record display `M5-052`; graduated sanctioning `M5-053`.
- **F6 — Transparency (R-6xx):** personalized dashboard `M5-060`; explainability `M5-061`;
  right-to-challenge `M5-062`; public reputation API `M5-063`.

## Hooks
**Consumes:** `match.confirmed` (participants), `tracking.delivered` (completion),
`settlement.dispute_resolved` (adjustments); M1 CredentialService (badges).
**Writes:** the composite score → `OperationalStore` (M3 reputation-aware matching).
**Emits:** `reputation.rating_submitted`, `reputation.score_updated`, `reputation.badge_issued`.

## NFR gates (§8.4)
Score query < 50ms p95 (`NFR-M5-02`); submitted ratings immutable, adjustments only via
dispute/challenge with append-only audit (`NFR-M5-04`); explainable, no black-box (`NFR-M5-06`).

## Summary
| Area | Requirements | Status |
|------|-------------|--------|
| Scoring engine | M5-010…014 | ✅ done |
| Ratings | M5-020…024 | ✅ done |
| Badges | M5-030…033 | ✅ done |
| Fraud/Sybil | M5-040…044 | ✅ done |
| Disputes | M5-050…053 | ✅ done (listener ready for SSE disputes; ops endpoint meanwhile) |
| Transparency | M5-060…063 | ✅ done |

**Built and verified — 96 unit + 13 e2e green.** Composite writes back to the Operational Core,
so M3's reputation-aware matching now uses real scores.

**Integration test:** a delivered transaction is rated by the verified counterparty → dimension
scores + Bayesian composite update → composite written to the Operational Core → a subsequent M3
match ranks by the **real** reputation (not the prior); a high score auto-issues a trust badge VC.
