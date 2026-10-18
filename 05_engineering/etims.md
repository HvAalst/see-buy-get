# KRA eTIMS — the Kenyan company's tax invoices

**Written for: whoever switches this on once SeeBuyGet Kenya is registered with KRA's eTIMS.** Everything below is
built and tested against KRA's published interface (OSCU Specification v2.0 and the TIS Technical Specification v2.0,
April 2023). **None of it has spoken to KRA.** What is left is the registration, four settings, one item registered
with KRA, and a few questions only KRA's own sandbox can answer — listed at the end.

Decided 2026-10-18 (user): **KRA eTIMS invoices**; the Kenyan company is **not registered yet**, so build to KRA's
interface, test it, never send to KRA, and switch it on once registered (as M-Pesa was); and **eTIMS is Kenya's
only** — it applies to no other country.

Code: `backend/src/foundation/fiscal/fiscal-ways.ts` (which country uses what), `modules/pudo/etims.ts` (the request,
field by field), `etims-rail.adapter.ts` (KRA's device, the laptop stand-in), `fiscal-invoice.service.ts` (making,
numbering, sending, the page), `fiscal-invoice.controller.ts` (who reads what). Tests beside each, and
`test/fiscal-invoice.e2e-spec.ts`.

---

## Kenya only

The country of the **company that charges** decides — the sister that is Merchant of Record — never the buyer, the
parcel's route or the server. `fiscalWayOf('KE')` is `etims`; every other country is nothing at all: no invoice made,
no KRA field, nothing sent. Another country's e-invoicing (Tanzania's EFD/VFD, Uganda's EFRIS…) is its own system and
is not built. A test charges the Ethiopian company and proves no invoice exists and nothing reached eTIMS.

## What is invoiced

An invoice is made from the **books entry** of the sale, so no path that charges can forget one. The books tell the
invoice service of every entry (`BooksService.onPosted`); an entry whose invoice failed to be made is picked up on the
next round, a minute on.

| Books entry | Invoice | Buyer |
|---|---|---|
| `shipping`, a shop's float or credit line | sale | the shop (it buys carriage wholesale and sells it on) |
| `shipping`, a person's own send (Send app, paid cash at the counter) | sale | the person — "Cash customer", paid in cash |
| `shipping`, a store's float (parcels, a return's holding fee, a load it posted) | sale | the store |
| `top-up` with a fee | sale, for the fee only | the shop or store |
| `refund` (a void within the window) | credit note | as the sale |
| `rebate` (a flexible route's over-hold, a load released) | credit note | as the sale |

Not invoiced: a top-up with no fee (nothing was sold), a top-up that came back (the fee is not given back), claims,
labour, payouts, recharges between our companies. The price is what the entry earned plus the exchange buffer, the
risk cover and the tax — what the buyer paid.

## Numbered first, sent in order

Each invoice is numbered when it is made — **one unbroken series per company, sales and credit notes together** — and
sent to eTIMS on its own time. A counter never waits on KRA.

- **Recorded**: KRA answered with its receipt number, internal data and signature. Only now can it be printed.
- **Waiting**: not sent yet, or KRA did not answer. An answer lost on the way is sent again **with the very same
  request** (kept until KRA answers), so a sale KRA did receive is not recorded twice.
- **Refused**: KRA turned it down, with its words. **The ones after it wait behind it**, so KRA never receives a
  number before the one it follows. Fix what was refused (usually a setting), then **Send again** in the console.
- **Needs a check**: KRA says it already holds that number (921, 994): an earlier try reached it and the answer was
  lost. There is no way to read a receipt back from KRA: look it up on KRA's eTIMS portal. The next ones carry on.
- **Not sendable**: a tax rate eTIMS has no band for (bands: A exempt, B 16%, C zero-rated, D non-VAT, E 8%), or a
  credit note for a sale that has no invoice. **It takes no number**, so it leaves no gap.

## The invoice page

KRA's TIS rules, followed: **no invoice is printed before KRA has answered** (rule 10) — a waiting one has no page.
It prints the CU ID, the CU invoice number (`CU ID/receipt no.`), the internal data and the receipt signature with a
dash every fourth character, KRA's date and time, and a QR code that checks it on KRA's site. **One original** (rule
6.17): the first time the buyer opens it. Every later opening, and every opening by staff, is marked **COPY** with
"THIS IS NOT AN OFFICIAL RECEIPT" (rule 11). One answered by the laptop stand-in is marked **SANDBOX** the same way.

Who reads it: the company (network staff, or its own admin), and its buyer — the shop's owner (never a counter
assistant), the store, or the person who sent the parcel (read by the parcel's own rule: whoever its sender's account
is today). Nobody else learns that it exists. Sending again is the company's act.

## Where it goes

Said in the log at start:

- **KRA's device**, where the four settings below are set.
- **The stand-in**, on a laptop (any `GLOS_ENV` other than `production`) with nothing set: it answers as KRA does, in
  order only, and every answer says SANDBOX.
- **Nowhere**, on a live server with nothing set: invoices are made and numbered and wait; the console says "not set
  up: nothing sent to KRA". The day it is set up, they go, oldest first, 200 a minute.

## What the company must do

1. **Register SeeBuyGet Kenya on eTIMS as an OSCU taxpayer** (online sales control unit: our own system, integrated)
   on KRA's eTIMS portal. KRA issues a **device serial number** for it. KRA tests an integration in its sandbox before
   it allows production.
2. **Put the company's KRA PIN** in its tax settings (the console's company page). Without it, nothing is sent and the
   invoice says so.
3. **Register the service as an item** with KRA (`/saveItem`): one item, carriage of parcels and loads. Its code follows
   KRA's pattern — `KE` + `3` (a service) + `NT` + `U` + a number, e.g. `KE3NTU0000001` — and its classification
   comes from KRA's list (`/selectItemClsList`). **Not automated**: it is done once.
4. **Set**:

```
GLOS_ETIMS_DEVICE_SERIAL=…        # from KRA
GLOS_ETIMS_ITEM_CODE=KE3NTU0000001
GLOS_ETIMS_ITEM_CLASS=…           # from /selectItemClsList
GLOS_ETIMS_ENV=sandbox            # KRA's test system (the default); production once KRA approves
GLOS_ETIMS_BRANCH=00              # the head office (the default)
GLOS_ETIMS_TAXABLE=gross          # see question 1
GLOS_ETIMS_CMC_KEY=               # only if KRA set the device up before: its key, CU ID and MRC no.
GLOS_ETIMS_SDC_ID=
GLOS_ETIMS_MRC_NO=
GLOS_ETIMS_HOST=                  # a laptop only: a stand-in KRA. Refused on a server.
```

The device is set up with KRA once (`/selectInitOsdcInfo`) and its key kept in the database. KRA does not send a key
twice (answer 902): if the database is ever lost, the three `GLOS_ETIMS_CMC_KEY`/`SDC_ID`/`MRC_NO` settings carry it.
A half set-up server (a serial without an item) says what is missing at start and sends nothing.

## To settle in KRA's sandbox before going live

1. **Is the taxable amount with or without the tax?** KRA's own sample puts the price WITH the tax in `taxblAmtB`
   (10,500, tax 10,500 × 18/118); some integrators send it without. Default: with (`GLOS_ETIMS_TAXABLE=gross`).
2. **Credit notes**: sent with positive amounts and `rcptTyCd R`, `orgInvcNo` the sale's number, reason `06` (refund).
   Confirm the sign, and that one series for sales and credit notes is what KRA expects.
3. **The item classification** for courier services — `7810220000` is assumed (UNSPSC 78102200, postal and small
   parcel and courier services), not confirmed.
4. **A backlog**: invoices made before the company is registered keep their own dates. Does KRA accept a sale dated
   before the device was set up?
5. **Sending order**: the stand-in refuses a number out of order. Confirm whether KRA does.

## For the user to decide

- **Buyers' KRA PINs are not collected** — not a shop's, not a store's. Their invoices carry none, so a VAT-registered
  shop or store cannot claim the VAT back from them.
- **The top-up fee carries no VAT** today, even where carriage does (it is posted without tax, so it goes as band D).
  If the company charges VAT, that fee is a VAT-able service too.
- **Everything goes under the head office (branch 00).** eTIMS knows branches; our shops are not our branches, so this
  is believed right.

## Not built

Cancelling a recorded invoice (`salesSttsCd` other than 02: a mistake is corrected by a credit note, which TIS also
allows); KRA's purchase, import and stock APIs (a service sells no stock); X and Z reports; reading a receipt back from
KRA (no such API).
