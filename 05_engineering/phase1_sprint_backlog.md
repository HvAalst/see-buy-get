# Phase 1 Sprint Backlog — Foundation (M1 + M2)

> Scope: the two zero-dependency modules that everything else builds on — **M1 (Identity &
> Wallet)** and **M2 (Shipment Digitization)** — plus the Sprint-0 enablers they share.
> Source epics: `../02_epic_domains/epic_m1_identity_wallet.md`, `epic_m2_shipment_digitization.md`.
> Each ticket's **DoD** = the acceptance criteria from those epics. Points are Fibonacci
> (1/2/3/5/8/13); anything that would be 13 is split. WS-UX = low-literacy UX criteria (a DoD gate).

**Legend:** `pt` = story points · `Deps` = blocking tickets · BE = backend · UX = front-of-house · INF = platform.

---

## Sprint 0 — Foundations (enablers shared by M1, M2 and beyond) · 39 pt

> Nothing in Sprint 1+ is "done" until these exist. Built once, reused everywhere.

- **T-001 · NestJS backend bootstrap + module skeletons** — `INF-3` · **3pt** · ✅ done
  - DoD: replace `04_generated_sandbox/backend/src/main.ts` placeholder with a NestJS app; empty `m1`, `m2`, `m6` modules wired; health endpoint; lint/test/CI green.
  - Deps: —
- **T-002 · Event-driven async backbone** — `INF-1` · **5pt** · ✅ done
  - DoD: a publish/subscribe event bus exists; modules emit/consume typed domain events (the cascade spine for SSE/M5/M7); at-least-once delivery; trace IDs propagate.
  - Deps: T-001
- **T-003 · Data firewall: Identity Vault ↔ Operational Core** — `UDIW · §3.4`, `M1-E12` · **8pt** · ✅ done
  - DoD: PII/sensitive data in a logically separated encrypted vault; operational layer uses only DIDs + pseudonymous attributes; no code path reads PII from the operational core; separation is independently testable.
  - Deps: T-001
- **T-004 · Permissioned ledger anchoring service** — `INF-2` · **5pt** · ✅ done
  - DoD: shared service hashes a payload (SHA-256) and commits to the permissioned ledger; returns tx ID + block height; anchor confirmed < 5s; lightweight verify endpoint (no full node). Reused by M2-050/051 and later M4.
  - Deps: T-001
- **T-005 · DID generation & registry primitive** — `UDIW-030` · **5pt** · ✅ done
  - DoD: on verification a persistent DID registers on the ledger; participant is controller of the DID document; DID resolvable by other modules. (Foundational even though UDIW-030 is Should — wallet + party linking need it.)
  - Deps: T-004
- **T-006 · M6 minimal auth shim (OAuth 2.1 / OIDC + DID token introspection)** — `APIG-011` (subset) · **5pt** · ✅ done
  - DoD: every API request requires a verifiable token; supports client-credentials + DID-bound tokens; introspected against M1; unauthenticated requests rejected. (Full gateway is the M6 epic; this is the Phase-1 internal slice.)
  - Deps: T-001, T-005
- **T-007 · WS-UX shared component kit + design tokens** — `UX-02`, `UX-03` · **5pt** · ✅ done
  - DoD: BigButton, StepProgress, StatusBadge (icon+word+color+shape), PhotoCapture, MapPinPicker, ReadAloud(TTS), AmountHero, CardList — all keyboard/screen-reader accessible (WCAG 2.2 AA), built on the existing navy/azure tokens in `styles.css`.
  - Deps: —
- **T-008 · i18n + RTL framework + plain-language string catalog** — `UX-04` · **3pt**
  - DoD: all UI strings externalized; RTL layout supported; string catalog wired to the plain-word glossary ("e-waybill"→"shipment label", "escrow"→"money held safe"); locale-switchable.
  - Deps: T-007

---

## Sprint 1 — M1 Identity Core (onboarding T1 → T2) · 37 pt

> Goal: a person can register, pick role(s), and reach a verified Tier-2 identity with a DID.

- **T-101 · Multi-role registration under one master account** — `UDIW-010` · **5pt** · ✅ done
  - DoD: one master account holds multiple roles with independent verification paths; adding a second role does not re-verify proven attributes; each role shows its own tier/status.
  - Deps: T-003, T-005
- **T-102 · Progressive tiered identity model (T1–T4)** — `UDIW-011` · **5pt** · ✅ done
  - DoD: T1 email/phone, T2 gov-ID+liveness, T3 KYB+UBO, T4 +audit/insurance/DG; each tier lists capabilities it unlocks; actions above current tier are blocked.
  - Deps: T-101
- **T-103 · KYC/KYB integration hub (abstraction + ≥2 providers)** — `UDIW-012` · **8pt** · ✅ done
  - DoD: ≥2 pluggable KYC/KYB providers behind one abstraction; rule-based routing by jurisdiction; a provider swappable without caller changes.
  - Deps: T-102
- **T-104 · Biometric liveness detection + proof cert** — `UDIW-013` · **5pt** · ✅ done
  - DoD: gov-ID flows enforce a liveness check (selfie video + random challenge); proof-of-liveness cert generated/stored; photo/replay spoofs rejected.
  - Deps: T-103
- **T-105 · Automated sanctions & PEP screening + auto-suspend** — `UDIW-014` · **5pt** · ✅ done
  - DoD: screen at onboarding + continuously against sanctions/PEP/adverse-media; positive match auto-suspends + opens a manual-review case; emits `AccountSuspended`.
  - Deps: T-103
- **T-106 · UX: wizard onboarding (one task/screen) + role picker** — `M1-U1`, `M1-U3` · **5pt** · ✅ done
  - DoD (WS-UX): one task per screen, numbered progress bar, no dense legal text (plain summaries + read-aloud); role picker = large pictogram tap-cards (📦🚚🏭📜), not a dropdown. Builds on the UDIW-010 prototype.
  - Deps: T-007, T-008, T-101
- **T-107 · UX: guided selfie/liveness flow** — `M1-U2` · **3pt** · ✅ done
  - DoD (WS-UX): animated visual prompts, completable one-handed, no written instructions required; wraps T-104.
  - Deps: T-007, T-104
- **T-108 · UX: tier-status ladder** — `M1-U4` · **1pt** · ✅ done
  - DoD (WS-UX): tier renders as a visual ladder showing what each badge unlocks (icon + plain words).
  - Deps: T-007, T-102

---

## Sprint 2 — M1 Wallet, Courier Path & Security · 36 pt

> Goal: a verified courier gets a wallet, a background-check badge, and can be paid instantly;
> corporate accounts are protected.

- **T-201 · Automated multi-currency wallet provisioning** — `UDIW-040` · **5pt** · ✅ done
  - DoD: a wallet auto-provisions for every verified entity, linked to its DID + settlement engine; emits `WalletProvisioned`.
  - Deps: T-105 (verified), T-005
- **T-202 · Configurable settlement triggers (instant / time-locked / condition-locked)** — `UDIW-043` · **5pt** · ✅ done
  - DoD: wallet supports all three escrow condition types; configuration is validated; consumed later by SSE.
  - Deps: T-201, T-002
- **T-203 · Instant payout rails for couriers** — `UDIW-044` · **5pt** · ✅ done
  - DoD: completed last-mile task pays out 24/7 in real time to bank/debit; target funds-available < 30s; emits `PayoutCompleted`.
  - Deps: T-201
- **T-204 · Background-check VC for couriers** — `UDIW-023` · **3pt** · ✅ done
  - DoD: courier onboarding triggers a bureau check; on pass a `Background-Check-Passed` VC issues with expiry; expiry prompts renewal + limits capability.
  - Deps: T-102, T-005
- **T-205 · Synthetic identity detection** — `UDIW-051` · **5pt** · ✅ done
  - DoD: identity-graph models flag synthetic identities; flagged accounts freeze pending investigation.
  - Deps: T-101, T-003
- **T-206 · Multi-party (multi-sig) approval for corporate wallets** — `UDIW-052` · **5pt** · ✅ done
  - DoD: corporate withdrawals/critical changes above a configurable threshold require cryptographic approval from multiple admins.
  - Deps: T-201
- **T-207 · UX: wallet home + one-tap cash-out** — `M1-U5` · **5pt** · ✅ done
  - DoD (WS-UX): balance + last payout shown large (AmountHero); "Cash out" is one big primary button with a plain summary + success audio/visual cue.
  - Deps: T-007, T-203
- **T-208 · UX: bank-link via micro-deposit** — `M1-U6` · **3pt** · ✅ done
  - DoD (WS-UX): link bank with photo/auto-read of micro-deposit amounts; read-aloud support; forgiving inline validation.
  - Deps: T-007, T-201

---

## Sprint 3 — M2 Shipment Creation & Universal E-Waybill · 39 pt

> Goal: a shipment can be created from minimal input, enriched with version history, and expressed
> in the universal multimodal schema linked to party DIDs.

- **T-301 · Multi-channel shipment creation** — `M2-010` · **5pt** · ✅ done (REST + batch JSON/CSV + Shopify/Magento plugins)
  - DoD: create via REST/gRPC (DID-auth), portal, batch CSV/JSON, plugin; all paths produce an identical canonical record.
  - Deps: T-006
- **T-302 · Minimal viable shipment record** — `M2-011` · **2pt** · ✅ done
  - DoD: creatable with only origin, destination, package count, total weight, delivery window; all else optional.
  - Deps: T-301
- **T-303 · Progressive enrichment + version history** — `M2-012` · **5pt** · ✅ done
  - DoD: detail addable later; every change preserves prior versions; version history queryable.
  - Deps: T-302
- **T-304 · Multi-package consolidation under master ID** — `M2-014` · **3pt** · ✅ done
  - DoD: one logical shipment holds multiple physical packages (own dimensions/contents) under a master ID.
  - Deps: T-302
- **T-305 · Standardized core e-waybill schema** — `M2-020` · **8pt** · ✅ done
  - DoD: schema per UN/CEFACT MMT / IATA e-AWB / FIATA FWB with mandatory blocks (Identifiers, Parties, Transport, Goods, Packaging, Handling, Customs, References); invalid records rejected with field-level errors.
  - Deps: T-302
- **T-306 · Extensible tag attributes + namespaces** — `M2-021` · **3pt** · ✅ done
  - DoD: open key-value tags with namespace management (EU EORI, FDA Prior Notice).
  - Deps: T-305
- **T-307 · Multi-modal data support** — `M2-022` · **5pt** · ✅ done
  - DoD: road/rail/air/ocean/courier/multimodal each representable with mode-specific fields (vessel/voyage, flight/MAWB, plate).
  - Deps: T-305
- **T-308 · Party roles & DID linking** — `M2-023` · **3pt** · ✅ done
  - DoD: parties reference GLOS DIDs (M1) where available, enabling automated verification + reputation lookup.
  - Deps: T-305, T-005
- **T-309 · Incoterms & commercial value capture** — `M2-025` · **2pt** · ✅ done
  - DoD: applicable Incoterms rule + declared commercial value captured for customs/insurance.
  - Deps: T-305
- **T-310 · UX: "Send something" flow + map-pin + commodity picker** — `M2-U1/U2/U3` · **3pt**
  - DoD (WS-UX): template cards skip typing; one task/screen; origin/destination by map-pin not typed address; commodity by picture/category with HS-code mapping hidden.
  - Deps: T-007, T-008, T-302

---

## Sprint 4 — M2 Constraints, Labels, Anchoring & Legs · 39 pt

> Goal: a shipment carries normalized constraints, gets a verifiable smart label, is anchored
> immutably, and decomposes into standardized legs ready for M3.

- **T-401 · Standardized handling-code library** — `M2-030` · **5pt** · ✅ done
  - DoD: library aligned to IATA/IMO covering temperature, orientation, stacking, shock, DG classes, seals.
  - Deps: T-305
- **T-402 · Job Requirement Vector generator** — `M2-032` · **5pt** · ✅ done
  - DoD: constraints compile into a structured Job Requirement Vector (mandatory VCs, equipment, operational params) consumable by M3; emits `JobRequirementVectorReady`.
  - Deps: T-401
- **T-403 · Universal GLOS smart label** — `M2-040` · **5pt** · ✅ done (QR + signature + pictograms + watermark)
  - DoD: label has globally unique GLOS Shipment ID (QR + human-readable), neutral description, handling pictograms, cryptographic signature.
  - Deps: T-305
- **T-404 · Carrier label overlay** — `M2-041` · **2pt** · ✅ done
  - DoD: a matched carrier's barcode can overlay; GLOS ID stays the permanent primary key.
  - Deps: T-403
- **T-405 · Digital label API for printers (PDF + ZPL/EPL)** — `M2-042` · **3pt** · ✅ done (SVG/ZPL/EPL; PDF via SVG)
  - DoD: label available as PDF and ZPL/EPL stream via API for thermal printers.
  - Deps: T-403
- **T-406 · Shipment genesis block (anchor)** — `M2-050` · **5pt** · ✅ done
  - DoD: on creation, core payload hashed + committed as a Genesis tx; tx ID + block height recorded; emits `ShipmentCreated`.
  - Deps: T-004, T-305
- **T-407 · Immutable amendment chain** — `M2-051` · **3pt** · ✅ done
  - DoD: every amendment independently hashed + committed referencing prior version → append-only chain of custody.
  - Deps: T-406, T-303
- **T-408 · Automated leg decomposition** — `M2-060` · **5pt** · ✅ done
  - DoD: system proposes atomic legs from origin/destination, hubs, mode changes, regulatory needs.
  - Deps: T-307
- **T-409 · Handover point standardization** — `M2-061` · **3pt** · ✅ done
  - DoD: each leg defines a GLOS Location ID handover with time window, physical point, responsible DID, required verification method (signature/geofence/photo); emits `LegDecomposed`.
  - Deps: T-408
- **T-410 · UX: handling-needs toggles + smart-label preview** — `M2-U4/U5` · **3pt**
  - DoD (WS-UX): handling needs as toggle pictograms (❄️⬆️🥚); label step shows a large QR with plain "Print" / "Show on phone" buttons + read-aloud.
  - Deps: T-007, T-401, T-403

---

## Summary

| Sprint | Theme | Points | Exit criterion |
|--------|-------|--------|----------------|
| 0 ✅ | Foundations (firewall, ledger, DID, auth shim, UX kit) | 39 | **Done** — all 8 tickets, build/lint/test green |
| 1 ✅ | M1 identity core (T1→T2 + DID) | 37 | **Done** — register→liveness→verify reaches T2 + DID; 43 unit + 7 e2e green |
| 2 ✅ | M1 wallet, courier path, security | 36 | **Done** — courier gets wallet + bg-check VC + instant payout; 59 unit + 8 e2e green |
| 3 ✅ | M2 shipment creation + e-waybill | 39 | **Backend done** — multi-channel ingestion (REST/batch/plugins) + templates + full schema (modes/tags/Incoterms/HS); UX (T-310) pending |
| 4 ✅ | M2 constraints, labels, anchoring, legs | 39 | **Backend done** — handling/commodity-tagging/DG; smart labels+printer formats; **Hyperledger Fabric** anchoring + verify + selective disclosure; legs + **per-leg data isolation** + negotiation + route templates. UX (T-410) pending |

**Phase-1 (M1+M2) total: 190 pt.** Remaining Phase-1 modules (M4 basic tracking, M6 full
gateway) are separate backlogs. **Phase-1 integration acceptance test:** a Tier-3 shipper creates
+ labels + leg-decomposes a shipment (M2) authored by a verified Tier-2 identity with a wallet
(M1), all behind the auth shim (M6) — and a non-reader completes courier onboarding in a moderated
usability test (`UX-05`).
