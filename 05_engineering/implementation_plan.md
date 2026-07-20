# GLOS Implementation Plan & Work Breakdown

> Source of truth: `GLOS_Build_Playbook_Compendium.docx` (FRD Compendium v2.0).
> This WBS turns that playbook into buildable work, sequenced by the module
> dependency graph (§2.4) and the 4-phase roadmap (§1.4).

## 0. Guiding constraints

1. **Trust-first, then orchestration.** M1 (Identity & Wallet) is the bedrock; nothing
   authenticates or settles without it. Build bottom-up through the dependency chain.
2. **API-first.** Every module ships its capability as a versioned API behind M6 from day one.
3. **Data firewall.** PII Identity Vault is physically/logically separated from the
   pseudonymous Operational Core (DIDs + events). No exceptions.
4. **Low-literacy-first UX (cross-cutting, non-negotiable).** Every participant-facing
   surface — especially the courier/driver mobile app — must be usable by someone who
   cannot comfortably read dense text. See §1, applied per-module throughout.

---

## 1. Cross-cutting workstream: Low-Literacy & Inclusive UX (WS-UX)

This is a first-class workstream, not a polish pass. GLOS onboards "a bicycle courier in
Jakarta" alongside a freight forwarder — the floor for usability is *non-readers and
second-language users on cheap Android phones over poor networks*. These principles are
**acceptance criteria** on every UI story below.

### Design principles (the WS-UX rulebook)
- **Icon + text + color, always together.** Never convey meaning by color alone (colorblind)
  or icon alone (ambiguous) or text alone (literacy). Status = pictogram **+** word **+** hue **+** shape.
  Build on the existing `📦🚚🏭📜` + badge pattern already in the frontend.
- **One task per screen.** Progressive disclosure. Onboarding/checkout is a wizard with a
  single decision per step and a big numbered progress bar (reuse the lifecycle stepper).
- **Plain language, grade 3–5 reading level.** No jargon on participant screens. Maintain a
  plain-word glossary in `01_system_governance/business_dictionary.md`:
  "e-waybill" → **"shipment label"**, "escrow" → **"money held safe"**, "VC" → **"badge"**,
  "DID" → **"your GLOS ID"**, "geofence" → **"arrival zone"**.
- **Show, don't type.** Prefer camera (photo-as-proof), map pin (vs. typed address),
  tap-to-select cards, and saved templates over free-text fields.
- **Read-aloud + voice.** Every key screen has a tap-to-listen (TTS) control and accepts
  voice input for search/notes. Audio cues on success/failure.
- **Big targets, generous spacing.** Min 48×48dp tap targets; primary action is one large,
  high-contrast button per screen.
- **Money & numbers shown large and concrete.** Real currency symbol, payout amount as the
  hero element on the courier task card. Avoid dense tables — use cards.
- **Forgiving + preventive.** Inline visual validation, undo over confirm-dialogs, never a
  dead-end error. Guided selfie/liveness with on-screen visual prompts, not written instructions.
- **Localization + RTL from day one.** Externalized strings, culturally-neutral pictograms,
  right-to-left layout support. Numerals localizable.
- **Accessibility baseline.** WCAG 2.2 AA contrast (the navy/azure tokens already pass),
  scalable text to 200% without breaking layout, screen-reader labels on every control.
- **Resilient.** Offline-first task screens; optimistic UI with clear sync state; works on
  low-end devices and 3G.

### WS-UX deliverables
- **UX-01** Low-literacy UX guideline doc + checklist (the rulebook above), in `01_system_governance/`.
- **UX-02** Pictogram/icon library + status system (state = icon+word+color+shape), as design tokens.
- **UX-03** Shared component kit: BigButton, StepProgress, StatusBadge, PhotoCapture,
  MapPinPicker, ReadAloud(TTS), AmountHero, CardList — all i18n + a11y baked in.
- **UX-04** i18n/RTL framework + plain-language string catalog wired to the glossary.
- **UX-05** Usability test protocol with low-literacy users; gate each phase on passing it.

---

## 2. Build order (dependency-correct)

```
M1 ──┬── M2 ──┬── M3 ──┬── SSE ── M7
     │        │        │
     └─ M6    └─ M4 ── M5
(M6 built in parallel from the start; M8 = future)
```

`M1 → M2 (+M6 parallel) → M3 → M4 → SSE → M5 → M7`. Each module unlocks only when its
§2.4 dependencies exist. The §1.5 end-to-end shipment is the integration acceptance test.

---

## 3. Phase 1 — Foundation (0–12 mo): "Digitize the trust & shipment backbone"

Deliver M1 (Tiers 1–3 MVP), M2 (e-waybill + tagging), M4 (basic tracking), M6 (internal scaffolding).
Backlog = the **Must-Have** req IDs from the playbook.

### Epic M1 — Unified Digital Identity & Wallet (UDIW) — *foundational*
**Backend / platform**
- M1-E1 Multi-role registration under one master account — `UDIW-010`
- M1-E2 Progressive tiered identity (T1 email/phone → T4 certified) — `UDIW-011`
- M1-E3 Pluggable KYC/KYB hub with jurisdiction routing — `UDIW-012`
- M1-E4 Biometric liveness + proof-of-liveness cert — `UDIW-013`
- M1-E5 Continuous sanctions/PEP screening + auto-suspend — `UDIW-014`
- M1-E6 Background-check VC for couriers — `UDIW-023`
- M1-E7 Auto wallet provisioning per verified entity — `UDIW-040`
- M1-E8 Configurable settlement triggers (instant/time-locked/condition-locked) — `UDIW-043`
- M1-E9 Instant payout rails for couriers — `UDIW-044`
- M1-E10 Synthetic-identity detection — `UDIW-051`
- M1-E11 Multi-party (multi-sig) approval for corporate wallets — `UDIW-052`
- M1-E12 Data firewall: Identity Vault ↔ Operational Core separation — §3.4
**UI/UX (apply all WS-UX rules)**
- M1-U1 **Wizard onboarding** — one field per screen, numbered progress, build on UDIW-010 prototype.
- M1-U2 **Guided selfie/liveness** — animated visual prompts, no written instructions; works one-handed.
- M1-U3 **Role picker** — big tap cards with pictograms (Shipper/Carrier/Warehouse/Customs), not a dropdown.
- M1-U4 **Tier status as a visual ladder** — show what each badge unlocks with icons + plain words.
- M1-U5 **Wallet home** — balance + last payout shown large; "Cash out" is one big button.
- M1-U6 **Bank-link via micro-deposit** with photo/auto-read of amounts; read-aloud support.

### Epic M2 — Universal Shipment Digitization (UDS)
**Backend**
- M2-E1 Multi-channel creation (API/portal/CSV/plugins) — `M2-010`
- M2-E2 Minimal viable shipment record (origin/dest/count/weight/window) — `M2-011`
- M2-E3 Progressive enrichment + version history — `M2-012`
- M2-E4 Multi-package consolidation under master ID — `M2-014`
- M2-E5 Standardized core e-waybill schema (UN/CEFACT/IATA/FIATA) — `M2-020`
- M2-E6 Extensible tag attributes w/ namespaces — `M2-021`
- M2-E7 Multi-modal data support — `M2-022`
- M2-E8 Party↔DID linking — `M2-023`
- M2-E9 Incoterms + commercial value capture — `M2-025`
- M2-E10 Standardized handling-code library — `M2-030`
- M2-E11 Job Requirement Vector generator (M3 query language) — `M2-032`
- M2-E12 Universal GLOS smart label (QR + signature) — `M2-040`
- M2-E13 Carrier label overlay (GLOS ID stays primary key) — `M2-041`
- M2-E14 ZPL/EPL/PDF label API for thermal printers — `M2-042`
- M2-E15 Blockchain genesis block + immutable amendment chain — `M2-050`, `M2-051`
- M2-E16 Automated leg decomposition + handover standardization — `M2-060`, `M2-061`
**UI/UX**
- M2-U1 **"Send something" flow** — plain title, template cards ("Standard EU export") to skip typing — `M2-013`.
- M2-U2 **Map-pin origin/destination** instead of typed addresses.
- M2-U3 **Commodity picker by picture/category** with HS-code auto-suggest hidden behind the scenes.
- M2-U4 **Handling needs as toggle pictograms** (❄️ keep cold, ⬆️ this way up, 🥚 fragile).
- M2-U5 **Smart label preview** — big QR, plain "Print" / "Show on phone" buttons.

### Epic M4 — Visibility & Tracking Tower (VTT) — *basic tracking*
**Backend**
- M4-E1 Multi-protocol ingestion gateway (REST/gRPC/MQTT/AIS/EDI/mobile SDK) — `VTT-010`
- M4-E2 Carrier-agnostic event normalization to GLOS schema — `VTT-011`
- M4-E3 Plug-and-play connector library (FedEx/DHL/Maersk/…) — `VTT-012`
- M4-E4 Manual event submission (confidence-weighted) — `VTT-014`
- M4-E5 Event dedup + conflict resolution — `VTT-020`
- M4-E6 State-machine engine (illegal transitions flagged) — `VTT-021`
- M4-E7 Unified timeline aggregation — `VTT-022`
- M4-E8 Basic predictive ETA + multi-leg aggregation — `VTT-030`, `VTT-031`
- M4-E9 Rule-based exception engine + severity classification — `VTT-040`, `VTT-041`
- M4-E10 Exception case lifecycle + manual override — `VTT-042`, `VTT-044`
- M4-E11 Multi-channel notifications + webhook streaming (HMAC-signed) — `VTT-051`, `VTT-053`
- M4-E12 Cryptographic event anchoring + PoD collection — `VTT-060`, `VTT-061`
- M4-E13 Unified shipment map + search/filter + API — `VTT-070`–`VTT-072`
**UI/UX**
- M4-U1 **Tracking timeline** — reuse the existing numbered lifecycle stepper; each step = pictogram + plain status + ETA in words ("Tomorrow").
- M4-U2 **Live map** with one moving icon and a plain progress sentence; "% of journey" bar.
- M4-U3 **Proof-of-delivery capture (courier)** — take photo, draw/sign, tap big "Delivered" — fully offline-capable.
- M4-U4 **Alerts in plain language** with icon + read-aloud ("Your package is running late. New time: 4 PM.").

### Epic M6 — API Gateway & Developer Ecosystem (APIG) — *internal scaffolding*
**Backend**
- M6-E1 Unified entry point + versioned routing (`/v1/...`) — `APIG-010`
- M6-E2 DID/OAuth 2.1 + OIDC auth, token introspection vs M1 — `APIG-011`
- M6-E3 VC-based fine-grained authorization — `APIG-012`
- M6-E4 Rate limiting/throttling — `APIG-013`
- M6-E5 API versioning + deprecation (Sunset headers) — `APIG-015`
- M6-E6 Immutable request/response audit logging w/ trace IDs — `APIG-016`
- M6-E7 Internal service-mesh registration (API-first discipline) — §10.5
- M6-E8 OWASP/WAF/DDoS protection — `APIG-080`
- M6-E9 PII zero-knowledge gateway + consent enforcement point — §10.3
- *(Public sandbox/SDKs/marketplace deferred to Phase 2)*

### Phase-1 platform foundations (shared)
- INF-1 Event-sourced, async backbone (the cascade spine for SSE/M5/M7) — §2.2
- INF-2 Permissioned ledger anchoring service (shared by M2/M4) — §2.2
- INF-3 NestJS backend bootstrap (replace `main.ts` placeholder) + module skeletons
- INF-4 Mobile app shell (the empty `Mobile/` dir) — courier app, offline-first, WS-UX kit baked in
- INF-5 CI/CD + OpenAPI-in-CI gate (`APIG` doc completeness) — `NFR-APIG-06`

**Phase-1 exit:** a verified Tier-2 courier and Tier-3 shipper can register (M1), a shipment
can be created + labeled + leg-decomposed (M2), tracked across one handover with PoD (M4),
all behind the gateway (M6) — and a non-reader can complete courier onboarding + a delivery
in a moderated usability test (UX-05).

---

## 4. Phase 2 — Pilot Network (6–18 mo): "Activate crowdsourced capacity"

- **M3 (last-mile matching MVP):** demand intake `M3-010`, leg decomposition `M3-011`,
  constraint tagging `M3-012`, capability-aware filtering `M3-021`, multi-objective match
  `M3-030`, instant <1s match `M3-031`, reputation-aware match `M3-033`, dynamic + surge
  pricing `M3-040`/`M3-041`, offer/accept + fallback cascade `M3-050`/`M3-051`, audit trail `M3-054`.
- **M5 (core ratings):** dimension scores `M5-010`, composite trust `M5-011`, time-decay
  `M5-012`, Bayesian prior `M5-013`, structured mutual rating `M5-020`/`M5-021`, Sybil/collusion
  `M5-040`/`M5-041`, re-ID prevention `M5-042`, explainability `M5-061`.
- **SSE (escrow + instant payout pilot):** escrow creation `SSE-010`, pre-funding `SSE-011`,
  milestone release `SSE-030`, recipient acceptance + auto-accept `SSE-032`/`SSE-033`,
  atomic multi-party payout `SSE-040`, instant push-to-card `SSE-060`, compliance screen `SSE-072`.
- **M6 (public sandbox + SDKs):** `APIG-020`–`APIG-032`, `APIG-040`–`APIG-042`, webhooks `APIG-060`–`APIG-062`.
- **WS-UX:** courier **task card** (payout as hero, accept/reject big buttons, masked pickup zone)
  `M3-050`; **earnings/cash-out** screens; **rate-by-pictogram** (👍/👎 + plain tags) `M5-020`;
  **plain-language dispute filing** `SSE-050`.

## 5. Phase 3 — Full Orchestration (12–36 mo)

Full multimodal M3 (`M3-032`, `M3-035`, `M3-060`–`M3-062`), advanced M5 + automated disputes
(`M5-030`/`M5-031`, `M5-050`/`M5-051`, `SSE-052`/`SSE-053`), M7 control-tower core (digital twin
`M7-010`/`M7-011`, predictive ETA `M7-020`, disruption alerting `M7-021`, impact propagation
`M7-022`, recommender `M7-030`, autonomous policy + human-in-loop `M7-031`/`M7-050`), monetized
M6 tiers (`APIG-050`–`APIG-052`). **WS-UX:** human-readable match explanations `M3-060`,
plain-language disruption notices + one-tap approve/undo `M7-050`/`M7-052`.

## 6. Phase 4 — Global Brain (Yr 3+)

M7 autonomous policies + what-if simulation (`M7-040`), M8 compliance engine, full SSI portability
(`UDIW-030`–`UDIW-032`, `M5-033`).

---

## 7. NFR gates (carry across all phases)
- M1 auth/wallet 99.99%, <200ms p95 (`NFR-01`/`NFR-02`); SOC2/ISO27001/PCI-L1/FAPI (`NFR-03`).
- M2 create <200ms p95, anchor <5s (`NFR-M2-02`/`NFR-M2-04`).
- M3 instant match p95 <500ms (`NFR-M3-01`); replayable matches (`NFR-M3-06`).
- M4 ingest→timeline <500ms p95, no event loss (`NFR-VTT-02`/`NFR-VTT-05`).
- SSE 99.999%, no double-spend, formal verification of escrow contracts (`NFR-SSE-01`/`NFR-SSE-04`).
- M6 gateway adds ≤15ms p95 (`NFR-APIG-02`); 100% endpoints documented (`NFR-APIG-06`).
- **WS-UX gate:** each phase passes a moderated low-literacy usability test before launch (UX-05).
