# Epic M2 — Universal Shipment Digitization & Standards (UDS)

> Playbook: Compendium §5. Build order: **second.** Depends on: M1. Depended on by: M3, M4, SSE, M7.

## Summary
The "Rosetta Stone" of GLOS. Transforms any physical shipment into a platform-agnostic,
interoperable, cryptographically verifiable digital twin — the universal e-waybill — that every
other module consumes. Decouples shipment identity from any carrier's tracking number.

## Scope
**In:** multi-channel shipment creation, universal e-waybill schema, constraint/requirement
normalization, smart label generation, blockchain anchoring (genesis + amendments), leg
decomposition + handover standards.
**Out:** matching/pricing (M3), event tracking (M4), settlement (SSE).

## Features, Requirements & Acceptance Criteria

### F1 — Shipment Ingestion & Creation
- **M2-010 Multi-Channel Creation** (Must) — AC: shipment can be created via REST/gRPC (DID-auth), web portal, batch CSV/JSON, and plugin (Shopify/Magento); all paths produce an identical canonical record.
- **M2-011 Minimal Viable Shipment Record** (Must) — AC: a shipment is creatable with only origin, destination, package count, total weight, delivery window; all other fields optional.
- **M2-012 Progressive Enrichment** (Must) — AC: detail can be added later (dimensions, HS codes, customs, handling); every change preserves prior versions.
- **M2-013 Template-Based Pre-Population** (Should) — AC: named templates ("Standard Export to EU") pre-fill repeated fields.
- **M2-014 Multi-Package Consolidation** (Must) — AC: one logical shipment holds multiple physical packages, each with own dimensions/contents, under a master ID.

### F2 — Universal E-Waybill Schema
- **M2-020 Standardized Core Schema** (Must) — AC: schema based on UN/CEFACT MMT / IATA e-AWB / FIATA FWB with mandatory blocks (Identifiers, Parties, Transport, Goods, Packaging, Handling, Customs, References); invalid records rejected with field-level errors.
- **M2-021 Extensible Attributes via Tags** (Must) — AC: open key-value tags with namespace management (e.g. EU EORI, FDA Prior Notice).
- **M2-022 Multi-Modal Data Support** (Must) — AC: road/rail/air/ocean/courier/multimodal each representable with mode-specific fields (vessel/voyage, flight/MAWB, plate).
- **M2-023 Party Roles & DID Linking** (Must) — AC: parties reference GLOS DIDs (M1) where available, enabling automated verification/reputation lookup.
- **M2-024 Commodity & HS Code Harmonization** (Should) — AC: free-text description suggests correct 6/8/10-digit HS code validated against latest WCO nomenclature.
- **M2-025 Incoterms & Commercial Value** (Must) — AC: applicable Incoterms rule + declared commercial value captured for customs/insurance.

### F3 — Constraint & Requirement Normalization
- **M2-030 Standardized Handling Code Library** (Must) — AC: library aligned to IATA/IMO covering temperature, orientation, stacking, shock, DG classes, seals.
- **M2-031 Auto Requirement Tagging from Commodity** (Should) — AC: declaring a commodity auto-suggests handling codes; shipper can override.
- **M2-032 Capability Matching Query Translation** (Must) — AC: constraints compile into a structured **Job Requirement Vector** (mandatory VCs, equipment, operational params) consumable by M3.
- **M2-033 Dangerous Goods Auto-Classification** (Should) — AC: guides UN number/packing group/shipping name; validates packaging+quantity against ADR/IMDG/IATA DGR before the shipment enters the matching pool.

### F4 — Smart Label Generation
- **M2-040 Universal GLOS Smart Label** (Must) — AC: label has globally unique GLOS Shipment ID (QR + human-readable), neutral description, handling pictograms, cryptographic signature.
- **M2-041 Carrier Label Overlay** (Must) — AC: a matched carrier's barcode can overlay; GLOS ID remains the permanent primary key.
- **M2-042 Digital Label API for Printers** (Must) — AC: label available as PDF and ZPL/EPL stream via API for thermal printers.
- **M2-043 Anti-Tamper Design** (Could) — AC: visual security feature tied to cryptographic hash makes alteration evident.

### F5 — Blockchain Anchoring & Immutable Birth Certificate
- **M2-050 Shipment Genesis Block** (Must) — AC: on creation the core payload is hashed and committed to the permissioned ledger as a Genesis tx; tx ID + block height recorded.
- **M2-051 Immutable Record of Amendments** (Must) — AC: every amendment is independently hashed and committed referencing the prior version → append-only chain of custody.
- **M2-052 Lightweight Client Verification** (Should) — AC: any party with the GLOS ID can verify integrity against the ledger without running a full node.
- **M2-053 Selective Disclosure for Compliance** (Should) — AC: on-chain data is hashes + minimal metadata only; sensitive details stay off-chain encrypted; ZK proofs attest compliance.

### F6 — Leg Decomposition & Handover Standards
- **M2-060 Automated Leg Decomposition** (Must) — AC: system proposes atomic legs from origin/destination, hubs, mode changes, regulatory needs.
- **M2-061 Handover Point Standardization** (Must) — AC: each leg defines a GLOS Location ID handover with time window, physical point, responsible DID, and required verification method (signature/geofence/photo).
- **M2-062 Leg-Specific Constraint Inheritance** (Should) — AC: legs inherit master constraints and may add leg-specific ones (ocean=Reefer, last-mile=Temp-Controlled Van).
- **M2-063 Reusable Route Templates** (Should) — AC: multi-leg routes savable with handover points, typical carriers, customs procedures.

## Data & Privacy (§5.3)
- AC: physical attributes are operational; commercial attributes (value, consignee, invoice) are encrypted and decryptable only by authorized parties with consent.
- AC: blockchain stores only hashes + minimal status — no PII, values, or full addresses (GDPR-by-design).
- AC: shipper retains data ownership; carrier access is granted need-to-know per leg.

## Non-Functional Acceptance Gates (§5.4)
- Availability 99.99% for creation + label APIs (`NFR-M2-01`).
- Latency: minimal create < 200ms p95; full enrich+classify < 2s; label PDF < 1s (`NFR-M2-02`).
- Throughput 10,000 creations/s peak (`NFR-M2-03`).
- Anchoring confirmed < 5s; hash verification 100% accurate (`NFR-M2-04`).
- Conform to UN/CEFACT MMT R28+, WCO Data Model 4.0, IATA ONE Record (`NFR-M2-05`); schema published as open standard (`NFR-M2-06`).

## Hooks (integration)
**Consumes:** M1 DIDs + VC verification for parties; external HS/WCO tariff data; DG reference tables.
**Emits / triggers (events):**
- `ShipmentCreated` (genesis anchored) → unlocks M3 matching eligibility, M4 timeline root.
- `ShipmentEnriched` / `ShipmentAmended` → new ledger version; notifies subscribers.
- `LegDecomposed` → M3 leg-level matching; M4 planned legs + geofences + milestones; SSE baseline escrow terms.
- `JobRequirementVectorReady` → M3 capability-aware filtering.
- `LabelGenerated` → courier/warehouse scanning.
**Provides:** the GLOS Universal ID as the root identifier for all tracking (M4), settlement
(SSE), and AI monitoring (M7); the Job Requirement Vector query language (M3).

## Low-Literacy UX Acceptance Criteria (WS-UX)
- AC: "Send something" flow uses template cards to skip typing; one task per screen.
- AC: origin/destination chosen by map-pin, not typed address.
- AC: commodity chosen by picture/category; HS-code mapping happens invisibly.
- AC: handling needs are toggle pictograms (❄️ keep cold, ⬆️ this way up, 🥚 fragile).
- AC: smart-label step shows a large QR with plain "Print" / "Show on phone" buttons; read-aloud available.

## Implementation Status & Outstanding Items
**Backend complete (sandbox):** §5.2.1 ingestion (REST/batch/plugins/templates), §5.2.2 schema
(modes, namespaced tags, Incoterms, HS, published JSON Schema + Protobuf), §5.2.3 constraints
(handling library, commodity auto-tagging, DG classification), §5.2.4 smart labels (QR + signature
+ pictograms + watermark + ZPL/EPL/SVG + overlay), §5.2.5 anchoring on **Hyperledger Fabric**
(genesis + amendment chain + lightweight verify + selective disclosure), §5.2.6 legs (decomposition,
handover, **per-leg data isolation** + negotiation, route templates). NFR-M2-05/06 done; §5.5 met
incl. M1 VC verification at leg assignment.

**Outstanding (M2's own):**
- **Shipper "send something" UX** (M2-U1…U5 / backlog T-310, T-410) — not built. The only remaining
  M2 work item.
- **Smart label PDF** (M2-042): currently rendered as SVG/ZPL/EPL; a true PDF stream needs a PDF
  lib (SVG is the print stand-in).
- M2-052 lightweight verification verifies the **latest** anchored version; genesis-only verification
  after enrichment relies on the amendment chain (by design).

**Soft integration items (downstream module's responsibility, not an M2 gap):**
- **SSE** — auto-derive *baseline* escrow terms from the twin's `commercialValue` + `deliveryWindow`
  (SLA) + milestones. M2 exposes all three; SSE currently takes terms from the M3 match. See
  `epic_sse_smart_settlement.md`.
- **M7** — consume the digital twin (`GET /shipments/:id` + events) for monitoring/simulation. M7
  is not built; M2 already exposes everything it needs.
