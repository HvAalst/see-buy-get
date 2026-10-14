# Country activation — which countries exist, and who may switch one on

> Status: **DECIDED AND BUILT 2026-09-13 — CA1–CA9 all shipped** (`9c0fc48`, `7aebbe9`, `e9ae0a4`, and the CA9 commit).
> Builds on the presence ladder (`presence_ladder.md`).
> Scope: SBG. Governs how a country enters the network, how a company of ours is recorded there, and the
> evidence that stands behind every level above Matched.

## 1. Why

The presence ladder made a country's standing a record with a name on it. Three things around it are still
missing, and each one is a way for "we operate in X" to be untrue:

- **Any two letters are a country.** An operator can set `ZM` to matched with a note; nothing checks it against
  a real list, and nothing checks that the network can even price in its currency.
- **Our companies exist only in code.** Kenya and Ethiopia are seeds. The console cannot create a company, and
  the record it would create holds a name, a country, a currency, pricing and tax rules, insurance — and one
  free-text `taxRegistration` string. No legal form, no address, no representatives, no documents.
- **One person can raise a country.** Raising a level unlocks capabilities that decide whose promise goods move
  under and, at Established, whose money moves. That is not a one-person decision.

## 2. The decisions (user, 2026-09-13)

1. **Development keeps several countries**, seeded, so cross-border trade by truck or any vehicle can be
   exercised end to end.
2. **Production activates from a list.** Every country is in a catalogue; registering one selects it and
   activates it (available → matched). A code not in the catalogue cannot be recorded.
3. **A Matched country holds none of our company data.** Nothing of ours is incorporated there, so there is
   nothing of ours to record. Company data belongs to the step that creates a company.
4. **Company data is entered from the super-admin side, upon activation** of a company: address,
   representatives, legal structure, registration documents, tax registration numbers, and the rest of §5.
5. **Two people switch a country on.** One proposes, a different named person approves. The proposer can never
   approve their own proposal.
6. **Documents are fingerprinted** (sha256), exactly as dispute reports are: immutable, versioned, and the
   fingerprint is what a later reader verifies against.
7. **All of the further suggestions are kept** (§6–§9).

## 3. The country catalogue

One entry per ISO-3166 country, shipped as data and read by everybody:

- name, alpha-2 code
- currency (and whether an FX rate exists for it)
- dialling code, languages, address format
- driving side
- identity documents accepted for vetting

A country moves **available → matched → partnered → established** (the ladder), and the catalogue is the only
place a new code can come from. **No country may be switched on without its currency mapped and a rate on the
rate book** — we already refuse an unmapped currency at the quote (P4); this moves that refusal to the start,
where a person is deciding, instead of the first price.

## 4. Two people switch it on

A change that RAISES a country — a level up, or a capability lifted above its level — is a **proposal**:

- proposed by a named person, with the reason;
- approved by a **different** named person, or declined with a reason;
- it expires if nobody decides, and expiry is recorded, never silent;
- until approved, nothing behaves differently.

Proposed, not decided: **lowering** takes one person, recorded. Refusing money is the safe direction, and an
emergency (a lapsed licence, a regulator's letter) must not wait for a second signature.

## 5. The company record — entered on activation

What a company of ours must carry before it may stand at Established:

- legal name, trading name, **legal form**, registration number and date
- **registered address** and operating address
- **representatives**: name, role, signing authority (alone / jointly / not at all)
- **beneficial owners**
- **tax registrations**: VAT, corporate income tax, withholding — one per kind, not one free-text field
- **named bank accounts** for payouts (the missing half of "owed, not paid")
- **licences**: courier or postal licence, transport operator licence, customs broker status — each with an
  expiry
- **insurance policies** — each with an expiry
- **registration documents** — §7

**Established stays derived, never typed** — and it now derives from more than a company existing: the record
must be complete, every required document verified by a second person, and the switch-on approved by two.

## 6. Expiring documents lower capabilities by themselves

A licence or policy has an expiry date. Ahead of it, the company's administrators are told. When it lapses,
the capability it supports drops automatically — transport licence → no dispatch under our promise, claims
insurance → cover zero — and the drop is recorded with the document that caused it. Nothing stays quietly on.

## 7. Documents

- Uploaded in the console; stored immutably; **sha256 fingerprint** kept with the record.
- A replacement is a new version; the old one is kept, never overwritten.
- Each document is **verified by a person other than the uploader** — the same two-person rule.

## 8. Partners, obligations, and crossing borders

- **Partner companies** get the same record shape: at Partnered a local carrier is the contracting party, so it
  must be as well known to us as our own company would be.
- **Local obligations** per country, as checklist items on activation: e-invoicing (e.g. Kenya's eTIMS), and
  registration with the data-protection regulator.
- **Cross-border rules between two countries** — the truck trade depends on them:
  - border crossings and their opening hours;
  - transit permits and regional vehicle insurance (e.g. COMESA Yellow Card);
  - vehicle size limits;
  - **cabotage**: a foreign truck often may not carry a load inside another country. Dispatch must never offer a
    domestic leg to a vehicle the law does not allow to carry it.
  These sit beside the crowd-sourced road constraints, and follow the same rule: absence of a rule is not
  permission.

## 9. Winding a country down

Lowering or closing a country needs an answer before anyone presses it — shown as the cost of the change, as the
presence screen already does:

- parcels on shelves there, and whose promise they were taken in under;
- open and claimed freight;
- money owed to shops, hubs, fleets and couriers there;
- stores and fleets registered there, and what they are told.

## 10. TODO — in the order it should be built

- **CA1. ~~The country catalogue~~ DONE (`9c0fc48`).** 243 countries as data (`foundation/countries`): currency,
  dialling code, driving side, languages, postal codes, identity documents. A standing is refused for a code not in
  it; switching a country on is refused until the rate book has its currency; a purchased stop refuses to price
  without that rate ("refuse until mapped" now means "until the rate book can convert it"). Development seeds TZ, UG,
  RW and DE; `GLOS_ENV=production` seeds nothing. The console picks a country from the list, never types it.
- **CA2. ~~Two people switch it on~~ DONE (`9c0fc48`).** A change that gives a country anything is a proposal; a
  different named person approves (case and spacing do not make a second person); one waiting change per country;
  expiry after 7 days, kept; a decline needs a reason. A lowering is applied at once by one person, recorded.
  Console: *Waiting for a second person* on *Where we operate*; the approver is named on the map.
- **CA3. ~~The company record~~ DONE (`7aebbe9`).** A company of ours or a partner is created from the console as a
  DRAFT that no money path finds (`forJurisdiction` and `canTransact` see active companies only). The record holds
  §5. Readiness is the server's checklist; Established/Partnered can only be proposed and approved once the company
  is ready, and the approval switches it on. Sister seeds are development-only.
- **CA4. ~~Documents~~ DONE (`7aebbe9`).** PDF/PNG/JPEG checked by signature, sha256 fingerprint kept (the field is
  `fingerprint`, never `hash`), versions never overwritten, verified only by somebody other than the uploader, the
  stored bytes re-checked against the fingerprint at verification. The upload route alone takes a 12 MB body.
- **CA5. ~~Expiry watch~~ DONE (`7aebbe9`).** A licence or policy records what it supports (defaults by kind: courier
  → charge customers, money handling → float and cash, goods in transit → claims). The day after it lapses that
  capability is off in its country and the standing names the paper (`lapses`). The Companies screen lists what
  lapses in the next 60 days. Push reminders to company administrators are NOT built — they have no inbox yet.
- **CA6. ~~Cross-border rules~~ DONE (`e9ae0a4`).** Rules per direction with crossings and hours, permits, regional
  insurance, a weight limit, and cabotage. No rule means no permission. Freight records the country at each end where
  it is known; dispatch asks at offer, claim, proposal and acceptance; the board marks it; a cross-border offer tells
  the driver where to cross and what to carry — or that nobody has recorded the crossing. Console: *Borders*. A
  vehicle's country is its fleet's, else the courier's own. Length/height limits are recorded but not enforced
  (vehicles carry no dimensions yet).
- **CA7. ~~Partner companies~~ DONE (`7aebbe9`).** The same record and readiness (no bank account required); never a
  party to our books; Partnered requires one.
- **CA8. ~~Local obligations~~ DONE (`7aebbe9`).** The catalogue carries each country's obligations (e-invoicing and
  data-protection registration for KE, TZ, UG, RW, ZM, ET, DE, GB; data protection everywhere else); readiness
  requires each with its paper.
- **CA9. ~~Wind-down~~ DONE.** `GET presence/:jurisdiction/impact` — parcels on shelves and whose promise, parcels on
  their way in, open and claimed freight, what our companies still owe suppliers there, who is registered there. The
  country editor shows it the moment a lowering is chosen, before anything is pressed.

## 11. Open

- **Who is the super admin?** Built on the operator role, with the two-person rule enforced by NAME. The operator
  key is still shared, so two names are two people only as far as people are honest — per-person operator accounts
  are what make it real, and remain a slice of their own.
- **Lowering by one person** was built as proposed (§4); say if it should need two as well.
- **Where documents live in production.** Development keeps the bytes in the persistent store beside the metadata.
- **Reminders ahead of a lapse** reach the console only; company administrators have no inbox to send them to.
- ~~**Telling participants** in a wound-down country~~ — built 2026-10-14 (`CountryNoticeService`): a change that takes
  something away tells every shop, hub, store, fleet and driver registered there what stops and what does not, in
  their app's inbox and by email where they gave an address. A change that only adds tells nobody here.

## 12. Related

- `presence_ladder.md` — the ladder this activates.
- `04_platform/backend/src/foundation/entity/` — the company record today.
- `backend/src/modules/pudo/conversation.service.ts` — the fingerprinting pattern documents reuse.
