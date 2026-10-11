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
A lock is kept in the durable store (`data/password-locks-*.json`), so a restart does not lift it; the wrong
tries before a lock and the per-caller counts are kept in memory.

## The code to a phone: Twilio
A phone is proved by a six-digit code. On a laptop the code is handed back to the app that asked and shown on its
screen; no text is sent, whatever is set. With `GLOS_ENV=production` the code is in no answer: it is texted, through
Twilio's Messages API, and a text is the only way it reaches anybody (`src/foundation/sms/`).

| Variable | What it is |
|---|---|
| `TWILIO_ACCOUNT_SID` | the account; part of the address a text is posted to |
| `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` | what signs each request — a key can be revoked without touching the account. Or `TWILIO_AUTH_TOKEN`, the account's own |
| `TWILIO_MESSAGING_SERVICE_SID` | who a text is from. Or `TWILIO_FROM`: one number, or a sender name |
| `GLOS_SMS_COUNTRIES` | optional: the dial codes a code may be texted to, `+254, +255` |

- **Half a set-up sends nothing.** Without all three of account, credential and sender no text leaves, the door
  answers `SMS_NOT_SENT` (it never says "sent" when nothing was), and the start-up log and the console's
  Connections screen say which part is missing.
- **Fence the countries, in both places.** "Send me a code" texts any number in the world at our cost, and codes
  asked for to numbers that earn their owner money per text is an old fraud. Set `GLOS_SMS_COUNTRIES`, and switch on
  the same countries — and no others — under SMS Geo Permissions in the Twilio console.
- **A text is sent once.** No answer in time may still mean it went, so there is no second try: the person is told
  it could not be sent, the try is not counted against their number, and they ask again.
- **Handed to Twilio is not delivered.** A `201` means Twilio took it. Whether it reached the phone is not heard
  of here (no status callback is listened for).
- **Never yet sent through the real provider.** It is tested against a server standing where Twilio stands
  (`src/foundation/sms/sms.spec.ts`). `TWILIO_URL` exists only for that — a stand-in on the same machine as a
  sandbox — and anything else in it stops all sending. Watch the first real text on the Connections screen.

## Other websites, and the docs page
On a laptop any website may call the API from a browser (each app is a dev server on its own port) and
`/v1/docs` serves the contract. With `GLOS_ENV=production`: only our own sites are answered — the origins of
`SBG_PUBLIC_URL` and `SBG_CONSOLE_URL`, plus `GLOS_CORS_ORIGINS` (comma-separated) — except the shipping API
(`/v1/sbg/shipping/*`), which a store's own page calls and which answers every site; and the docs page is not
served (`src/foundation/http/cors.ts`, `src/main.ts`).

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
