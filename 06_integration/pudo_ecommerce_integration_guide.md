# PUDO Click-and-Collect — E-commerce Integration Guide

**Audience:** developers wiring an online store / marketplace into the GLOS PUDO network so buyers can
**collect orders at a local pick-up/drop-off point (PUDO)**.
**Version:** v1.0 · **Base URL:** `https://api.glos.network/v1` (sandbox: `http://localhost:3000/v1`)

> **Prefer a UI?** The **Merchant Console** (`/vendor.html`) does everything in this guide without
> code: connect your store, pick the origin/destination PUDO, create a shipment, print the label, and
> watch order status + callbacks. The guide below is for wiring it into your own checkout/back-office.

> **Money:** GLOS never touches your customers' funds. You collect payment in your own checkout
> (pre-paid). GLOS orchestrates the **logistics only** — labelling, transport across the PUDO network,
> shelving, collection, and status callbacks. This is deliberate: the network does not hold volatile
> fiat. There is no COD.

---

## 1. Concepts

| Term | Meaning |
|------|---------|
| **PUDO** | A local partner shop acting as a pick-up/drop-off node. Identified by its agent **DID**. |
| **Origin PUDO** | The PUDO **you (the vendor) select** — where you send the parcel to enter the network. |
| **Destination PUDO** | The PUDO **the buyer selects** at your checkout — where they will collect. |
| **Phygital label** | The physical+digital label GLOS returns for you to print and affix. Encodes the GLOS parcel id. |
| **Collection code** | A `COL-…` token issued to the buyer. They present it (as a QR) at the destination PUDO to collect. |
| **Chaos shelf / bin** | The random storage slot (e.g. `C7`) the destination agent puts the parcel in. Surfaced to the agent at collection. |

The buyer is **Tier-1 (parcel-attached)** — identified only by their collection code + mobile, matched to
the parcel at every leg. No account is required.

---

## 2. Authentication

Every request is authenticated with a short-lived bearer token (OAuth 2.1 client-credentials style).

```bash
curl -X POST $BASE/auth/token \
  -H 'content-type: application/json' \
  -d '{"sub":"acme-store","type":"client_credentials"}'
# → { "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600 }
```

Send `Authorization: Bearer <access_token>` on every call below. (In production you are provisioned
client credentials during vendor onboarding; the sandbox issues tokens to any `sub`.)

---

## 3. One-time setup — register your store

Register once to obtain a `vendorId` and a **callback signing secret**. Supply the `callbackUrl`
GLOS should call as parcels change status.

```bash
curl -X POST $BASE/pudo/vendors -H "$AUTH" -H 'content-type: application/json' -d '{
  "name": "ACME Store",
  "callbackUrl": "https://acme.example/glos/webhook"
}'
```
```json
{ "vendorId": "ven_3f9c…", "name": "ACME Store",
  "callbackUrl": "https://acme.example/glos/webhook",
  "secret": "whsec_8a1b…", "createdAt": "2026-06-28T…" }
```

Store `vendorId` and `secret` securely. The `secret` verifies the HMAC signature on every callback
(§6). Treat it like a password; it is not returned again by `GET /pudo/vendors`.

---

## 4. Create an order — the shipment webhook

When an order is paid and ready to ship, call the **inbound webhook**. You choose the **origin** PUDO
(where you'll drop the parcel); the buyer's chosen **destination** PUDO comes from your checkout.

`POST /pudo/inbound/orders`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `vendorId` | string | ✔ | From §3. |
| `externalOrderId` | string | – | Your order reference; echoed on every callback. |
| `originPudoDid` | string | ✔ | The PUDO agent DID you ship to. |
| `destPudoDid` | string | ✔ | The PUDO agent DID the buyer chose. |
| `buyerMobile` | string | ✔ | For the "ready for pickup" notification. |
| `size` | `S` \| `M` \| `L` \| `HEAVY` | ✔ | `HEAVY` = over 20 kg. |
| `items` | `[{name, qty}]` | – | Shown to the buyer at inspection. |

```bash
curl -X POST $BASE/pudo/inbound/orders -H "$AUTH" -H 'content-type: application/json' -d '{
  "vendorId": "ven_3f9c…", "externalOrderId": "ORD-10231",
  "originPudoDid": "did:glos:originPudo", "destPudoDid": "did:glos:destPudo",
  "buyerMobile": "+254700123456", "size": "M",
  "items": [{ "name": "Rice 5kg", "qty": 2 }, { "name": "Exercise books", "qty": 6 }]
}'
```
```json
{
  "parcel": { "parcelId": "PUD-9A1C…", "direction": "inbound", "status": "Created",
              "collectionCode": "COL-7F2A", "destZone": "SouthTown", … },
  "label": { "parcelId": "PUD-9A1C…", "qrPayload": "glos-pudo:PUD-9A1C…",
             "svg": "<svg …>…</svg>" }
}
```

**Print `label.svg`** and affix it to the parcel, then drop the parcel at your **origin PUDO**. The QR
encodes `label.qrPayload`. Keep `parcelId`; you can fetch status any time via
`GET /pudo/parcels/{parcelId}`.

---

## 5. The parcel lifecycle

GLOS orchestrates everything between intake and collection. You do not call these — they happen in the
field and surface to you as callbacks (§6).

```
Created ──(origin PUDO scans in)──► At_PUDO ──(handover to bus)──► On_Bus
   │                                                                  │
   │                                              (arrives, dest PUDO shelves)
   ▼                                                                  ▼
  you ship to origin PUDO                                     Ready_For_Pickup
                                                                      │
                                            ┌─────────────────────────┴───────────────┐
                              buyer confirms │                                         │ buyer disputes
                                             ▼                                         ▼
                                          Delivered                                 Disputed
                                       (order closed)                        (photo proof; ops review)
```

**Collection (in person, at the destination PUDO):**
1. The buyer receives a **`ready_for_pickup`** callback/notification with the **collection code**.
2. They present the code (as a QR). The agent resolves it → the parcel + its **shelf bin**.
3. The agent retrieves the parcel and scans it; GLOS confirms the match and opens a **handover screen**
   showing your `items`.
4. The buyer inspects:
   - **All good →** `Delivered`, the order is closed, you get a **`collected`** callback.
   - **Discrepancy →** the agent files a **dispute** with a mandatory **photo proof**; you get a
     **`disputed`** callback.

> The mandatory drop-off/inspection **photo proof** is the network's fraud defence — it settles
> "it arrived broken" claims in seconds.

---

## 6. Status callbacks (GLOS → your store)

GLOS POSTs JSON to your `callbackUrl` as the parcel progresses. **Verify the signature** before
trusting a callback.

Headers + body:
```
POST https://acme.example/glos/webhook
Content-Type: application/json
{ "event": "ready_for_pickup",
  "data": { "parcelId": "PUD-9A1C…", "externalOrderId": "ORD-10231",
            "status": "Ready_For_Pickup", "collectionCode": "COL-7F2A", "binSlot": "C7" },
  "at": "2026-06-28T…" }
```

| `event` | When | Use it to… |
|---------|------|-----------|
| `ready_for_pickup` | Parcel shelved at the destination PUDO | Notify the buyer (SMS/email) with the collection code |
| `collected` | Buyer collected + confirmed | Close the order, leave feedback |
| `disputed` | Buyer raised a discrepancy | Open a support case; `data.disputeReason` is included |

**Signature verification** — the signature is HMAC-SHA256 of the **raw body** with your `secret`:
```js
const expected = crypto.createHmac('sha256', VENDOR_SECRET).update(rawBody).digest('hex');
// compare to the signature delivered alongside the callback; reject on mismatch
```
The sandbox records every callback (signature + body) at `GET /pudo/vendors/{vendorId}/callbacks`
so you can test verification without a public URL.

---

## 7. Errors

Standard HTTP status codes with a JSON `{ "message": "…" }` body.

| Code | Meaning |
|------|---------|
| `400` | Bad request — missing/invalid field, or an illegal state transition. |
| `401` | Missing/expired bearer token. |
| `403` | Wrong PUDO (e.g. intake attempted at a PUDO that isn't the selected origin). |
| `404` | Unknown vendor, parcel, or collection code. |

---

## 8. Endpoint quick-reference

| Method · Path | Purpose |
|---------------|---------|
| `POST /pudo/vendors` | Register your store (once) → `vendorId` + `secret`. |
| `POST /pudo/inbound/orders` | **Webhook**: create a parcel + phygital label + collection code. |
| `GET  /pudo/parcels/{id}` | Parcel status + audit timeline (status, scans, photos). |
| `GET  /pudo/vendors/{id}/callbacks` | (Sandbox) inspect delivered status callbacks. |

Field/PUDO-operator endpoints (`/pudo/parcels/{id}/intake|shelve`, `/pudo/parcels/collect`,
`…/collect-confirm`, `…/dispute`) are used by the PUDO agent app, not by your store.

---

## 9. Graduation onto GLOS

Every inbound parcel is also a first-class GLOS shipment: it appears in the **M7 control tower** and
the **M4 tracking timeline** (tagged `source: pudo`) alongside enterprise freight — so the same
ETA, exception and visibility tooling covers your click-and-collect orders. No extra work on your side.

*GLOS PUDO Light — "Resilience over efficiency." Logistics orchestration; you keep the money and the
customer relationship.*
