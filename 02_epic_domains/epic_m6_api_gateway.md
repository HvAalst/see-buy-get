# Epic M6 — Open API Gateway & Developer Ecosystem (APIG)

> Playbook: Compendium §10. Build order: **parallel from the start** (Phase 1 internal scaffolding →
> Phase 2 public sandbox/SDKs → Phase 3 monetization). Depends on: M1 + all modules as endpoints.

## Summary
Turns GLOS from a platform into a programmable operating system — the single unified entry point
through which identity, matching, tracking, settlement, and reputation are consumed and composed
by external developers, internal teams, and enterprises. Goal: build a working logistics app in an
afternoon; trusted as critical infrastructure.

## Scope
**In:** gateway runtime (routing/auth/rate-limiting/logging), developer portal + onboarding,
sandbox/simulation, SDKs + tooling, monetization/usage plans/billing, webhooks + event streaming,
app marketplace + certification, security + governance.
**Out:** the business logic of each module (M1–M7/SSE); M6 fronts and governs, it does not implement them.

## Features, Requirements & Acceptance Criteria

### F1 — API Gateway Core (Runtime)
- **APIG-010 Unified Entry Point** (Must) — AC: all services exposed under one DNS endpoint with consistent versioned paths (`/v1/shipments`, `/v1/wallet/escrow`).
- **APIG-011 DID/OAuth 2.1 & OIDC Auth** (Must) — AC: every request requires a cryptographically verifiable token; supports client-credentials (server-to-server) + DID-bound user-delegated tokens; introspected against M1 per request; unauthenticated requests rejected.
- **APIG-012 Fine-Grained VC-Based Authorization** (Must) — AC: beyond OAuth scopes, endpoints can require specific VCs (e.g. shipment creation requires "Verified Shipper - Tier 3").
- **APIG-013 Rate Limiting & Throttling** (Must) — AC: limits per key/endpoint/IP by tier; returns `429` + `Retry-After`; adjustable via plan upgrade.
- **APIG-014 Request/Response Transformation** (Should) — AC: content negotiation (JSON/XML/CSV) + field strip/mask by caller authorization, without backends implementing it.
- **APIG-015 API Versioning & Deprecation** (Must) — AC: major version in URL; multiple backend versions routable; `Sunset` header 90 days before retirement + portal/email alerts.
- **APIG-016 Immutable Request/Response Logging** (Must) — AC: every request/response (excl. sensitive bodies) logged immutably with timestamp, caller DID, key, endpoint, latency, status, propagated trace ID.

### F2 — Developer Portal & Onboarding
- **APIG-020 Self-Service Registration & DID Linking** (Must) — AC: developer registers; org verification via M1 KYB links the account to the org DID so calls carry identity + reputation.
- **APIG-021 Application & API Key Management** (Must) — AC: multiple apps per developer, each with scoped key/secret; instant revocation + rotation.
- **APIG-022 Interactive API Reference (OpenAPI 3.1)** (Must) — AC: every endpoint has an auto-generated spec rendered as a "Try It" console executing real sandbox requests.
- **APIG-023 Contextual Code Snippets** (Should) — AC: per-endpoint examples in cURL/Python/JS/Java/Go using the developer's key.
- **APIG-024 Change Log & Notifications** (Should) — AC: machine-readable changelog; subscribe (email/webhook) to version changes/breaking/deprecation.

### F3 — Sandbox & Simulation
- **APIG-030 Full API Parity Sandbox** (Must) — AC: a dedicated sandbox hosts all APIs with near-production behavior on isolated data.
- **APIG-031 Pre-Populated Test Identities & VCs** (Must) — AC: ready test personas (`Shipper_Tier3`, `Courier_DG_Certified`, `Warehouse_ColdChain`) authenticable immediately.
- **APIG-032 Simulation & State Injection** (Must) — AC: developers progress a test shipment through In Transit → Delivered via a simulation endpoint to test webhooks + settlement.
- **APIG-033 Reset & Sandbox Hygiene** (Should) — AC: sandbox data fully resettable to clean state via portal/API.

### F4 — SDKs & Developer Tooling
- **APIG-040 Official Multi-Language SDKs** (Must) — AC: Python/JS-Node/Java/Go SDKs wrap all public APIs, handle token refresh, idiomatic errors, smart retry/backoff.
- **APIG-041 Webhook Signature Verification Libraries** (Must) — AC: each SDK verifies HMAC-SHA256 webhook signatures.
- **APIG-042 GLOS CLI Tool** (Should) — AC: `glos-cli` manages accounts, tests APIs, scripts bulk ops (CSV shipment upload).
- **APIG-043 SDK Open-Source** (Should) — AC: SDKs in public Apache-2.0 repos with CI/CD + contribution guidelines.

### F5 — Monetization, Usage Plans & Billing
- **APIG-050 Tiered Usage Plans** (Must) — AC: Free (1,000 req/mo, sandbox), Pay-As-You-Go (per-endpoint usage pricing), Enterprise (negotiated, SLAs, dedicated support, on-prem option).
- **APIG-051 Real-Time Usage Metering & Quotas** (Must) — AC: meter every call by endpoint/plan; enforce hard quotas; dashboard hourly granularity <15 min latency; alerts at 80% + 100%.
- **APIG-052 Automated Billing Integration** (Must) — AC: usage feeds SSE to generate verifiable line-items on the monthly invoice, auto-settled from wallet/payment method.
- **APIG-053 Revenue Sharing for Marketplace Apps** (Could) — AC: paid app transactions split between developer + GLOS with transparent reporting.

### F6 — Webhooks & Event Streaming
- **APIG-060 Self-Service Webhook Configuration** (Must) — AC: subscribe to event types (`shipment.status.updated`, `delivery.proof.received`, `escrow.released`) via HTTPS callback validated by challenge-response.
- **APIG-061 At-Least-Once Delivery with Retries** (Must) — AC: non-2xx retried with exponential backoff up to 24h; subscription auto-paused + developer alerted on persistent failure.
- **APIG-062 Signed Payloads** (Must) — AC: every webhook POST includes `X-GLOS-Signature` (HMAC-SHA256); developer verifies before trusting.
- **APIG-063 Webhook Delivery Dashboard** (Should) — AC: recent deliveries log (payload/status/time) with manual redrive of failures.

### F7 — App Marketplace & Certification
- **APIG-070 App Submission & Listing** (Should) — AC: developers submit apps (description, scopes, privacy policy, pricing) linked to their verified DID.
- **APIG-071 GLOS Certification Program** (Should) — AC: production apps pass security pen test, privacy compliance, error handling, signature verification → "GLOS Certified" badge.
- **APIG-072 User Ratings & Reviews** (Could) — AC: ratings tied to DID + verified usage history, displayed app-store style.
- **APIG-073 Managed OAuth Consent for Apps** (Should) — AC: install triggers a consent screen listing exact data/capabilities; grant recorded against the DID + revocable from M1 dashboard.

### F8 — Security & Governance
- **APIG-080 OWASP & DDoS Protection** (Must) — AC: OWASP Top-10 mitigations + integrated WAF + DDoS scrubbing on all public endpoints.
- **APIG-081 API Abuse & Anomaly Detection** (Must) — AC: AI detects scraping/credential-stuffing/odd-hours per key; suspicious keys throttled/suspended pending review.
- **APIG-082 Data Redaction & Privacy Preservation** (Must) — AC: response fields redacted by caller authorization (a track-and-trace app never sees shipper full name/exact address if unauthorized).
- **APIG-083 API Security Audit Trail** (Must) — AC: all admin actions (key creation, plan changes, cert approvals) logged in a separate immutable admin trail.

## Data & Privacy (§10.3)
- AC: gateway stores **no PII** — proxies requests, logs DIDs + key IDs only; all identity data stays in M1.
- AC: gateway is the **Policy Enforcement Point** — every request checked against the M1 consent registry before routing; no cross-app data sharing without recorded consent.
- AC: regional endpoints (e.g. `eu.api.glos.network`) route to locally-compliant backends; EU data never leaves EU.

## Non-Functional Acceptance Gates (§10.4)
- 99.99% gateway runtime (`NFR-APIG-01`).
- Adds ≤ 15ms p95 overhead beyond network transit (`NFR-APIG-02`).
- Scales to 200,000+ req/s peak, linear auto-scaling (`NFR-APIG-03`).
- Rate-limit counters globally consistent within 1% (`NFR-APIG-04`).
- Sandbox schema identical to production (`NFR-APIG-05`).
- 100% of public endpoints have an OpenAPI spec + Try-It example, **enforced by CI/CD** (`NFR-APIG-06`).

## Hooks (integration)
**Consumes:** M1 auth tokens, VC verification, consent registry (enforced every call).
**Fronts / routes to:** M2 (shipment endpoints), M3 (matching/pricing, high-freq low-latency), M4
(status/events to apps + webhooks), M5 (rating APIs, pseudonymous), SSE (financial APIs, strictest
PCI-DSS). All backend services register with the gateway's service discovery (API-first discipline).
**Emits / triggers (events):** `ApiKeyCreated` / `ApiKeyRevoked`, `WebhookDelivered`,
`QuotaThresholdReached` (→ alerts), `AppCertified`; usage records → **SSE** billing.

## Low-Literacy UX Acceptance Criteria (WS-UX)
- Note: M6's primary users are developers, so the low-literacy mandate applies mainly to
  **end-user-facing surfaces routed through M6** (consent screens, marketplace install).
- AC: OAuth consent screen (APIG-073) lists requested data/capabilities as plain-language items with icons + a single clear Allow/Deny; read-aloud available.
- AC: marketplace listings show pictograms + plain one-line descriptions; ratings as stars + simple tags.
