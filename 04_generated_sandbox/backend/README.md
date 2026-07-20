# GLOS Backend

NestJS service for GLOS. Phase-1 scaffold (ticket **T-001**) hosting the foundational module
skeletons: **M1** (Identity & Wallet), **M2** (Shipment Digitization), and the **M6** gateway slice.

## Structure
```
src/
  main.ts              # bootstrap — global validation, /v1 prefix
  app.module.ts        # wires the modules
  health/              # GET /v1/health
  modules/
    m1/                # Identity & Wallet  (epic_m1_identity_wallet.md)
    m2/                # Shipment Digitization (epic_m2_shipment_digitization.md)
    m6/                # API Gateway slice  (epic_m6_api_gateway.md)
  foundation/
    events/            # T-002 event bus (at-least-once, dead-letter, trace propagation)
    data-firewall/     # T-003 Identity Vault (encrypted PII) ↔ Operational Core (no-PII guard)
    ledger/            # T-004 anchoring primitive (hash + anchor + verify, pluggable adapter)
    did/               # T-005 DID generate/resolve, anchored, controller-owned
    auth/              # T-006 token shim + global auth guard (@Public to opt out)
test/                  # e2e tests
```
Later phases add `m3`, `m4`, `m5`, `sse`, `m7` modules (see `../../02_epic_domains/README.md`).

## Auth
Every endpoint requires a `Bearer` token unless marked `@Public()`. Obtain one from
`POST /v1/auth/token`. Two grant types: `client_credentials` (server-to-server) and `did`
(bound to a DID that must resolve in the registry). The global `AuthGuard` introspects the token
on every request.

## Develop
```bash
cd 04_generated_sandbox/backend
npm install
npm run start:dev     # http://localhost:3000/v1
npm test              # unit
npm run test:e2e      # end-to-end
npm run lint
```

## Endpoints
Public:
- `GET /v1/health` — liveness + module list
- `POST /v1/auth/token` — issue a token `{ sub, type: 'client_credentials' | 'did' }`
- `POST /v1/auth/introspect` — `{ token }` → `{ active, ... }`
- `POST /v1/did` — generate a DID `{ controller }` (sandbox bootstrap; internal to M1 in prod)
- `GET /v1/did/:id` — resolve a DID document

Protected (require `Authorization: Bearer <token>`):
- `GET /v1/identity` — M1 module info
- `GET /v1/shipments/module-info` — M2 module info
- `GET /v1/gateway/module-info` — M6 module info

> The `m1`/`m2`/`m6` module endpoints return scaffold metadata only. Real endpoints arrive with the
> Sprint-1+ tickets tracked in `../../05_engineering/phase1_sprint_backlog.md`. The `foundation/`
> services (ledger, DID, auth) are functional.

## Example
```bash
TOKEN=$(curl -s -X POST localhost:3000/v1/auth/token -H 'content-type: application/json' \
  -d '{"sub":"client-1","type":"client_credentials"}' | jq -r .access_token)
curl localhost:3000/v1/identity -H "Authorization: Bearer $TOKEN"
```
