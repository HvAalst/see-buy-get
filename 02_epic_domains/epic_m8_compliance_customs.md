# Epic M8 — Global Trade Compliance & Customs (Future Phase)

> Playbook: Compendium §1.3 (epic domain), §2.4 (dependencies), Phase 4 roadmap.
> Build order: **future (Phase 4).** Depends on: M1 (entity screening), M2 (shipment details).

## Summary
Embed regulatory intelligence so the network navigates cross-border complexity seamlessly. M8 is a
**pluggable compliance engine** — a mitigation for the "Cross-Border Regulatory Mismatch" risk
(§2.3) — that lets GLOS operate across jurisdictions without being blocked in key markets.

> **Status: future phase.** The playbook intentionally defers M8 to Phase 4 ("autonomous compliance
> engine"). This epic captures intent + acceptance direction; detailed FRDs are produced when M1–M7
> + SSE are in full orchestration. Treat the criteria below as provisional, to be ratified against
> the eventual M8 FRD.

## Scope (provisional)
**In:** automated customs documentation, duty/tax determination, restricted-party + entity
screening, jurisdictional rule routing, sanctioned-goods/embargo checks, data-sovereignty
guardrails, autonomous compliance decisioning.
**Out:** core identity (M1), shipment digitization (M2), settlement tax withholding (lives in
SSE-073, consumed here).

## Provisional Acceptance Criteria (to ratify against M8 FRD)
- **M8-A Pluggable Compliance Engine** — AC: jurisdiction-specific rule modules load/unload without core changes; a new country's rules are added as a plugin.
- **M8-B Entity / Restricted-Party Screening** — AC: every party DID screened against denied/restricted-party + embargo lists at shipment creation (consumes M1 screening); a hit blocks the shipment + opens a review case.
- **M8-C Automated Customs Documentation** — AC: from the M2 e-waybill (HS codes, Incoterms, value), generate required customs declarations per route; flag missing mandatory fields before dispatch.
- **M8-D Duty & Tax Determination** — AC: compute estimated duties/taxes per lane + commodity, feeding M3 all-in pricing (M3-043) and SSE invoices (SSE-021).
- **M8-E Data-Sovereignty Guardrails** — AC: enforce per-jurisdiction data residency for customs data (aligns with M1 §3.4 and M6 regional endpoints).
- **M8-F Autonomous Compliance (Phase 4)** — AC: low-risk clearances auto-proceed; high-risk holds escalate to human review with an evidence pack; all decisions immutably logged.

## Non-Functional direction
- Conform to WCO Data Model + regional e-customs standards (align with M2 `NFR-M2-05`).
- Regional data centers with sovereignty guardrails (§2.3 mitigation).
- Active participation in trade-standard bodies (program-level).

## Hooks (integration)
**Consumes:** M1 entity/sanctions screening; M2 shipment details (HS codes, value, parties, route);
M7 customs-delay predictions (M7-023).
**Emits / triggers (events) (provisional):** `ComplianceCleared` / `ComplianceHold` →
**M3** matching gate + **SSE** payout gate; `CustomsDocsGenerated` → M2 attachment + M4 milestone;
duty/tax estimates → **M3** pricing + **SSE** invoices.

## Low-Literacy UX Acceptance Criteria (WS-UX, provisional)
- AC: customs status shown as a simple traffic-light (✅ cleared / ⏳ checking / ⛔ on hold) with a plain one-line reason + read-aloud.
- AC: any document the participant must provide is requested as a photo-capture step with a visual example, not a form.
