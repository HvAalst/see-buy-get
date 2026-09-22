# The M-Pesa rail — STK push, with a paybill as the fallback

**Written for: whoever switches this on against a real shortcode.** Everything below is built and tested;
none of it has spoken to Safaricom. What is left is credentials, a public URL, and the half-hour of
registration that Daraja requires — plus one decision this document asks you to make deliberately.

Decided 2026-09-22 (user): **STK push is the main path, a paybill is the fallback.** Code:
`backend/src/foundation/funding/mpesa-funding-rail.adapter.ts`, wire shapes in `mpesa.types.ts`, tests in
`mpesa-funding-rail.spec.ts`.

---

## Why the two paths are not interchangeable

**STK push.** We initiate: the shop says how much and which phone, Safaricom makes that handset ring, the
shopkeeper enters their M-Pesa PIN. Because *we* started it, we already know who is paying and how much —
there is no reference for anybody to mistype, and the unattributable pile nearly empties.

**The paybill.** The payer goes to a kiosk or uses their own phone's M-Pesa menu and types a shortcode and
an account number. It reaches everybody STK cannot: a payer with no data, somebody paying from a
relative's phone, an agent paying on a shop's behalf. It pays for that reach in the only currency
available — a reference typed by hand.

The fallback is automatic. No number given, a fractional amount, Safaricom refusing the push, Safaricom
unreachable: the payer gets the paybill words instead, and the request records why. A shopkeeper is never
told to watch a phone for a prompt that was not sent.

## What a deployment must do

1. **A Daraja app** (developer.safaricom.co.ke) → consumer key + secret.
2. **A shortcode**: a paybill (takes an account number) or a till (does not). This choice decides whether
   the fallback can carry a reference at all — a till cannot, so every paybill payment into a till lands
   unattributable. Set `GLOS_MPESA_SHORTCODE_KIND=till` only with that understood.
3. **The Lipa na M-Pesa passkey** for that shortcode.
4. **A public HTTPS callback base.** Daraja refuses plain http and will not call a private address.
   The rail gives Safaricom `<base>/v1/rails/funding/mpesa/callback` per request.
5. **Register the C2B URLs** for the fallback (`/mpesa/c2b/v1/registerurl`), confirmation pointing at the
   same path. **Not automated here** — it is a once-per-shortcode operation and doing it from application
   boot would re-register on every restart.
6. **`trust proxy`** if the app sits behind nginx or a load balancer. Without it every callback appears to
   come from 127.0.0.1, which the rail refuses outside a sandbox (see below).

```
GLOS_MPESA_CONSUMER_KEY=…
GLOS_MPESA_CONSUMER_SECRET=…
GLOS_MPESA_SHORTCODE=174379
GLOS_MPESA_PASSKEY=…
GLOS_MPESA_CALLBACK_BASE=https://api.seebuyget.com
GLOS_MPESA_ENV=production          # default sandbox
GLOS_MPESA_SHORTCODE_KIND=paybill  # or till
GLOS_MPESA_PARTY_B=               # a till's store number, if different
GLOS_MPESA_ALLOWED_IPS=           # overrides the published ranges
GLOS_MPESA_STRICT_QUERY=1         # refuse what we could not corroborate
GLOS_MPESA_HOST=                  # sandbox only — a stand-in Daraja
```

There is deliberately **no `GLOS_USE_MPESA=1`**. The rail is chosen when it has everything it needs and
not otherwise; a boolean beside an incomplete configuration is how a deployment ends up with a rail that
accepts top-up requests and can neither prompt anybody nor be called back. Both choices are announced at
boot — `[FundingRail] M-Pesa (production) on paybill 174379…` or `no payment provider is configured`.

## The security question, and it is the whole of it

**Daraja callbacks are not signed.** No HMAC, no bearer token, no shared secret. A POST from Safaricom and
a POST from somebody who guessed the URL are byte-identical. The sandbox rail beside this one verifies an
HMAC, which is right for a card acquirer and would be a check that passes on nothing here — worse than no
check, because it reads like one.

So provenance is established twice, doing different jobs:

- **The source address is the boundary.** Safaricom publish the ranges their callbacks come from; anything
  else is refused before the body is read. Source addresses on an established TCP connection are not
  practically forgeable, which is what makes this worth anything.
- **Asking Safaricom is corroboration.** For an STK payment the rail calls their query API over a
  connection *we* opened and authenticated. It can veto — a "paid" callback whose query says cancelled is
  refused — but it cannot admit. An unreachable query lets the callback stand on the allowlist, because
  Daraja routinely answers "being processed" to a query made in the same second as its own callback and
  refusing money on our own timing means a shop that paid being told nothing arrived. `STRICT_QUERY=1`
  reverses that trade.

**Loopback is a sandbox affordance only.** The first version allowed it everywhere so the path could be
walked on a laptop — and a script posting a made-up payment from the same host was credited. Two mouths to
that hole: any other process on the box (a compromised sidecar, an SSRF in our own code) can create money;
and behind nginx on the same machine *every* caller looks like 127.0.0.1, so the allowlist would have been
off for the entire internet while appearing to work. Outside a sandbox it is refused, and the refusal
names the likely cause.

## Two open gaps, named rather than discovered later

1. **A C2B confirmation is accepted on the allowlist alone.** There is no synchronous query for it:
   Safaricom's Transaction Status API answers to a *result URL* minutes later, so it cannot corroborate a
   callback we are answering now. Closing it means a result-URL endpoint and a pending-verification state
   — real work, worth doing before the paybill carries serious volume.
2. **Safaricom's fee is not in the callback.** It is invoiced separately, so `fee` is 0 and the shop is
   credited the gross — which is the rule anyway ("credit the GROSS at top-up, never net-credit"). But
   custody will read high against the bank by exactly the provider's cut until those invoices are posted.

## Things that will bite

- **`AccountReference` is 12 characters.** `SBG-QNTS-QP5D` is thirteen; Safaricom truncates silently and
  the reference matches nothing on the way back. The rail strips the separators (eleven) and the service's
  matching ignores separators and case on both sides, so the printed and carried forms are one reference.
- **The STK callback does not carry our reference.** Only the `CheckoutRequestID`. The rail remembers the
  mapping durably; a restart between the prompt and the PIN would otherwise make an ordinary payment
  unattributable.
- **Whole shillings only.** Daraja rejects decimals. A fractional amount gets no prompt rather than a
  rounded one — the books move by what the rail says arrived, so rounding would make the request and the
  payment disagree for ever by a few cents.
- **KES only.** A sister keeping books in another currency is told plainly that M-Pesa cannot take it; the
  operator's statement path stays open.
- **The timestamp is East Africa Time** and the password is derived from it. A pair that disagrees is
  rejected with a message naming neither.
