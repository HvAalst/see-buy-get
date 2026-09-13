# Country activation — which countries exist, and who may switch one on

> Status: **DECIDED 2026-09-13, not built.** Builds on the presence ladder (`presence_ladder.md`).
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

- **CA1. The country catalogue.** Data file of every country (§3); the presence refuses a code not in it;
  switching on refuses a country with no mapped currency or rate; development seeds several countries.
- **CA2. Two people switch it on.** Proposals, approval by a different person, expiry; the console's
  *Where we operate* screen proposes and approves instead of setting.
- **CA3. The company record.** Create a company from the super-admin side with the §5 fields; seeds become
  development-only; Established derives from a complete, verified record.
- **CA4. Documents.** Upload, fingerprint, versions, second-person verification.
- **CA5. Expiry watch.** Reminders ahead; a lapse lowers the capability it supports, recorded.
- **CA6. Cross-border rules.** Crossings, hours, permits, regional insurance, size limits, cabotage enforced in
  dispatch.
- **CA7. Partner companies.** The same record for the Partnered level.
- **CA8. Local obligations.** E-invoicing and data-protection registration as activation checklist items.
- **CA9. Wind-down.** The cost of lowering or closing a country, shown before it is pressed.

## 11. Open

- **Who is the super admin?** Today the operator role sets presence for everyone. Group-level super admin
  over the companies is already on the console backlog; this epic likely needs it.
- Lowering by one person (§4) is proposed, not decided.
- Where documents are stored in production (the media store is local disk in development).

## 12. Related

- `presence_ladder.md` — the ladder this activates.
- `04_generated_sandbox/backend/src/foundation/entity/` — the company record today.
- `backend/src/modules/pudo/conversation.service.ts` — the fingerprinting pattern documents reuse.
