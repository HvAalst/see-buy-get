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

## Before it leaves a laptop: the secrets
On a laptop nothing needs setting: every secret has a value printed in the source. Printed means known, so
with `GLOS_ENV=production` the server **does not start** unless each of these comes from the deployment, is not
a printed value (the ones in `../.env.example` are printed values), is 32 characters or more, and is not shared
with another. The refusal names the ones it needs (`src/foundation/runtime/secrets.ts`).

| Variable | What it protects |
|---|---|
| `GLOS_AUTH_SECRET` | signs every sign-in token: whoever has it signs in as anybody, staff included |
| `GLOS_VAULT_KEY` | seals the identity vault (national ID numbers) |
| `GLOS_PHONE_PEPPER` | keys the hash each phone number is stored as |
| `GLOS_IDENTITY_PEPPER` | keys the prints that find a second registration of one national ID |
| `GLOS_FUNDING_SECRET` | signs payment confirmations on the stand-in rail |
| `GLOS_LABEL_KEY` | signs parcel labels |
| `GLOS_DISCLOSURE_KEY` | keys single-field waybill proofs |

Make each with `openssl rand -hex 32`. The peppers and the vault key must then never change: changing one
re-keys what is already stored. Also set `GLOS_TRUST_PROXY` when the server is behind a proxy or a load
balancer: the per-caller sign-in limits count by address, and behind a proxy there is one address.

## Sign-in limits
Every door that takes a password counts its tries twice: **per account** (five wrong in a quarter of an hour
lock it, the right password included; each lock in a row is longer — `src/foundation/auth/password-tries.ts`)
and **per caller** (`@RateLimit` with `@UseGuards(RateLimitGuard)`). A new route that needs no sign-in and
changes something must carry a limit or a reason: `src/modules/pudo/sign-in-doors.spec.ts` fails until it does.
Both counts are kept in this server's memory.

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
