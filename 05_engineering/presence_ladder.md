# Presence — running the OS where we are not established

> Status: **P1 + P2 SHIPPED 2026-09-11.** The presence ladder and the "say it out loud at
> the counter" rule are decided. The fleet-line work (F1–F4) is built against this, not beside it.
> Scope: SBG. This document governs every path that touches money, promises or take-in.

## 1. Why

GLOS only becomes an operating system if other people's logistics run **on** it. Today it is one
network with carriers inside it, and every path that matters asks the same question: *which sister
company contracts this?* `EntityService.requireForJurisdiction()` answers it honestly — it throws
"No daughter company operates in X yet" rather than quietly contracting a shop in Addis to Nairobi —
but it answers in only two ways, **yes or NOT_FOUND**, and it answers at the moment the first line
of code touches money. Which is to say: far too late, to the wrong person, in the wrong words.

A shopkeeper holding a box does not need to hear about daughter companies.

So presence becomes a **privilege level**, the way an operating system has them: the same kernel runs
everywhere, and privileged calls refuse by name. An unprivileged region still computes, matches,
records custody and measures — it simply cannot spend.

## 2. The ladder

Four levels, held **per jurisdiction, as data with an audit trail**. "We launched in Zambia" must be
a record with a person's name on it, not a deploy.

| level | what runs | what is locked |
|---|---|---|
| **Observed** | geography, road constraints, the map | everything that transacts |
| **Matched** | identity, vetting, routes, **matching, custody, proof, measurement**, indicative pricing | all money: no Merchant of Record, no float we hold, no COD we touch, no claims fund, **no redeemable quote** |
| **Partnered** | a local carrier or forwarder is the contracting party; we are their software | we hold nothing; our ledger records what is **owed**, never what is **held** |
| **Established** | a sister company exists: MoR, float, tax, claims, payouts | nothing |

**Established is derived, never declared.** A jurisdiction may only stand at Established where a
transacting entity actually exists for it. Asserting it without one is refused at the service, not
reviewed later — that assertion is precisely the lie the whole design exists to prevent.

**An unknown jurisdiction is Observed.** Never the home sister's capabilities, never a default that
happens to be generous. A country nobody has recorded is a country we are not in.

## 3. Presence is per capability, not one flag

Money, tax, claims and payouts arrive on different days. A country can be able to pay drivers long
before it can collect tax, and can collect tax long before anyone will underwrite a claim there. The
level sets the **defaults**; each capability can be raised or lowered on its own, and every change is
named and kept:

- `merchantOfRecord` — may we contract with, and charge, a consumer here?
- `holdFloat` — may a shop's prepaid float sit with us?
- `cashOnDelivery` — may cash we are responsible for pass through a counter?
- `claims` — is there a provision that can actually pay an award?
- `tax` — do we collect and remit?
- `payouts` — may money leave to a local supplier, in local currency?
- `takeIn` — may a shop here accept goods into our custody at all? (see §5)

## 4. What must never lock — and it is the reason to be there at all

**The custody record and the measurements.** Run Matched in a country for a year and the day we
establish we arrive with real leg times, earned reputations, and demand we measured rather than
forecast. Lock the ledger, keep the twin. That is the whole trade, and it is the only honest reason
to operate somewhere we cannot bill.

## 5. The five rules that stop "locked" from becoming a lie

1. **Refuse at the door, not at settlement.** Capability is asked at quote time and at take-in. A
   refusal that arrives when money moves is a refusal delivered to the wrong person, holding a box.
2. **The journey decides who is Merchant of Record, not the user.** Payer in an Established country
   → our sister is MoR for the whole shipment and the foreign leg is a **purchased service** (which
   is already how a fleet is paid: one invoice, one currency, their own drivers their own business).
   Payer in a Matched country → we cannot charge them at all; the local carrier does, and we are
   matching software with a custody record.
3. **Flexibility is earned by carrying no money — and proof goes UP, not down.** Where we hold
   nothing we can permit what we would otherwise refuse: an unbonded carrier, a cash handover we
   never touch, a looser identity tier. But the record is then our *only* product, so the evidence
   tightens: both-sides confirmation, photographs, and no optimistic offline release.
4. **No region inherits another's guarantees.** The free cover limit, the claims provision, the
   holding meter and the payout clock are all funded by a sister. In a Matched country the cover
   limit is **zero by construction** — not "unset", not "to be decided" — and it is said before the
   parcel is taken in, never after it is broken.
5. **Capability is data, with a name on the change.** Same rule the rate knobs already follow.

## 6. THE DECISION: say it out loud, at the counter

May a shop in a Matched country take goods into custody at all? We would be making a promise to a
shopkeeper and a receiver we cannot pay a claim to.

**Yes — in exactly two shapes, and the counter says which one it is, out loud, before the goods are
accepted:**

- **Ours.** The payer sits in an Established country, so our sister is already on the hook and the
  foreign leg is a service we purchased. The shopkeeper is our agent, the cover is our cover.
- **Theirs.** A carrier-priced bilateral job. The shop is acting as **that carrier's** agent, not
  ours; the carrier prices it, the carrier is paid, the carrier answers for it. We record custody and
  prove it, and we say so.

What is refused is the third shape, the one that is easy to build by accident: our brand on a counter,
our screens, our release codes, and nobody behind the promise. A shopkeeper cannot consent to a risk
the screen never named.

The wording is a product decision, not a legend: the take-in screen states who answers for these goods
and what the cover is, in the same breath as the price.

## 7. Where it lands in the code

- `foundation/presence/` — the `Presence` record (jurisdiction, level, capability overrides, who set
  it and when), `capabilityFor(jurisdiction)`, and the derivation from the level. It must be able to
  exist for a jurisdiction with **no entity at all**, which is why it does not live inside
  `foundation/entity`.
- `EntityService.requireForJurisdiction()` stays exactly as it is, and becomes the **money** gate
  only: the last line of defence, not the first question.
- The door: quoting, take-in, the mint, and the freight post ask `capabilityFor()` first.
- The console: presence sits in **Setup**, beside the rates and the corridors — the same shape of
  thing (what the network has decided, read by everybody, editable by nobody else).

## 8. TODO — in the order it should be built

- **P1. ~~The presence record and the gate~~ DONE.** `Presence` per jurisdiction, level → default capabilities,
  per-capability overrides, every change named. Established requires an entity. Unknown is Observed.
  Operator routes + the console screen under Setup. *(Nothing behaves differently yet — this is the
  fact everything else asks.)*
- **P2. ~~Refuse at the door~~ DONE.** Registration and take-in ask the capability first and refuse in the
  words of the person at the screen; a shop may now stand where we cannot bill, with no sister attached;
  a take-in is stamped  or  and NOTHING of ours moves on . Left for P2b: the quote,
  the mint and the freight post ask the same question (they still refuse late, through ).
- **P2b. ~~The quote, the mint and the freight post~~ DONE.** Every quote (`quoteShipment`, `quoteWithPlan`,
  `quoteShipmentFrom`) asks `merchantOfRecord` of both ends before the route is planned and of every hop
  before a fee resolves, so a buyer hears "we cannot charge customers in this country" instead of a refusal
  about a float. Both mints ask again (`requireSellable`) because a held quote is redeemed without being
  priced again; the counter's freight booking and the vendor's dedicated path ask of both ends. The map's
  quote options already refuse per pin, so one matched shop never blanks the list. Not asked yet: bulletin
  freight posted with no shop at either end, and the cooperative lot — both carry locations, not sites.
  *Indicative* pricing in a Matched country is not built: it needs a rate source that is not a sister's.
- **P3. ~~Say it out loud~~ DONE.** `GET agents/:did/take-in-terms` and the intake preview return one
  answer — promise, the sister that answers (by name), the cover and its basis (declared / free-limit /
  no-stated-limit / none), whether cash may cross the counter. The agent's take-in screen shows it directly
  above the button, reads it aloud, and **blocks acceptance while the terms are loading, failed, `none`, or
  `theirs` without a tick that the customer was told**. What was said is what is kept: a walk-up is stamped
  with the stated cover, both booked intakes now ask the door and stamp the promise (P2 only asked the
  walk-up), and a claim on goods taken in under the carrier's promise cannot be awarded — only rejected
  with a reason.
- **P4. ~~The journey decides~~ DONE (decisions: user, 2026-09-13).** The ORIGIN's sister sells and must be
  able to charge; every other shop only has to be allowed to take goods in, and a hub must stand where a
  sister does. A shop with no sister becomes a **purchased stop** (`QuoteNode.purchased`): the seller owes it
  its own price in its own money (EXPENSE_PROVIDER_FEES / PAYABLE_PROVIDER on the seller, counterparty the
  shop — the same shape as a hub or a fleet), and `payLabour` books nothing at all where no seller is named
  (the carrier's promise). **Owed, not paid:** `PayoutService` asks a registered payee gate first, and a shop
  in a country without `payouts` is skipped by name while its debt stays on the books; the counter's take-in
  terms carry `paidOut` and say so before acceptance. **Refuse until mapped:** a purchased stop in a country
  missing from the currency table refuses by name (`requireCurrencyFor`) instead of silently becoming USD.
  Found on the way: `floats()` asked for a sister before skipping a shop with no float, so one such shop
  would have taken the console's money screen down. Still true and not changed: the quote's `nativeFee` is
  not what shops are paid (they are paid the network's fixed fees), so a purchased stop's payable is the
  fixed fee in the seller's money.
- **F1 + F2. ~~A fleet-owned line, propose → publish~~ DONE.** A corridor now has an owner (absent = the
  network) and a `proposed` status. A fleet proposes a line from the fleet app's new **Lines** tab
  (`POST fleet/lines`, fleet_manager only, pinned to the token's fleet); nothing routes on it until an
  operator presses **Publish** on the console's Corridors screen (`POST corridors/:id/publish`), where
  proposals sort first. The close/reopen switch refuses a proposal, so publishing is always a named
  decision. Once published, only that fleet's drivers may be coupled or assigned to it, and another fleet
  never sees a competitor's proposal on the open list. Found on the way: corridors were an in-memory Map
  (an operator-drawn route vanished on restart — now durable), and the couple / uncouple / assign-corridor
  routes had no owner check (any valid token could move anybody's shift — now a fleet moves only its own).
- **F3–F4 prerequisite: ~~a fleet can register where we only match~~ DONE.** `FleetManagerService.register`
  demanded a sister, which made "in a Matched country the fleet IS the local operator" false. It now asks the
  presence (the network operates there, `takeIn`), stands with no `entityId` where no sister exists, and
  `entityIdOf` stays the money gate (refusing by name: cannot pay out). The two money paths reached from custody
  and reads answer instead of refusing: a driver's earnings screen names the payee without asking for a sister,
  and `driverPayout` books nothing (returns null) for a fleet no sister pays — a delivery must never fail on a
  money question. Driven: a Berlin fleet registered in DE (matched), activated, signed in, onboarded a vehicle.
  Not changed: an INDEPENDENT courier still needs a sister in their country of residence.
- **F3–F4. Sold capacity, then their own customers' loads on their own line** — both move money, and wait
  on the same decision as P4 (below).
- **F1–F4. The fleet's own routes** (see the corridors work): a fleet-owned line, propose → publish,
  sold capacity, and finally their own customers' loads on their own line. In a Matched country the
  fleet *is* the local operator, which is what makes this the entry mechanism for every market where
  we cannot open a bank account.

## 9. Related

- `04_generated_sandbox/backend/src/foundation/entity/` — sisters, the group, and the isolation gate.
- The corridors work (`b821e2b`) — who may draw a route, and the screen that does it.
- The money model: compare across sisters, never total across them.
