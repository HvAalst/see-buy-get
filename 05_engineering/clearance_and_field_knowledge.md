# Clearance — the commercial layer, and the knowledge that crosses a border

> Status: **DESIGN ONLY — nothing built.** Reasoned with the user 2026-09-16; the reasoning is agreed.
> Scope: every path that touches a freight claim, a border, a clearing agent, or a price at the counter.
> **One defect described here is live in the code today — see §3.** It is the reason this cannot ship as a
> display-only field.

## 1. Why

The network models **custody**: who is holding the goods, where, and since when. Custody is a fact about the
carriage contract, and the parcel trunk model makes it primary on purpose.

Trade does not run on custody. It runs on the **sale** contract between a buyer and a seller, and the sale
contract is where cost, risk and obligation are actually allocated — by Incoterms, negotiated long before a
truck exists. The two layers transfer at different moments, and the space between them is where trade
disputes live.

Today we record none of it. The system therefore adjudicates claims as though it knew who bore the risk, and
it does not.

Two things follow, and this document covers both:

- **The commercial layer** (§2–§6): what the agreed term allocates, who must clear each side of a border, and
  how a clearing agent earns trust without us rewarding the wrong behaviour.
- **The knowledge layer** (§7–§9): in emerging markets the binding constraint is not the truck, it is that
  nobody publishes the rules. The knowledge exists, but only in the hands of people who were standing there.

## 2. What the terms allocate

Incoterms 2020: eleven terms in two families. Each fixes cost, risk and obligation at a **named place**. They
are incorporated by reference into the sale contract. They are **not** a contract of carriage and they do
**not** transfer title.

| family | terms | export clearance | import clearance | risk passes |
|---|---|---|---|---|
| any mode | EXW | **buyer** | buyer | at seller's premises |
| any mode | FCA, CPT, CIP | seller | buyer | at origin, on handing to the carrier |
| any mode | DAP, DPU, DDP | seller | buyer, except **DDP: seller** | at destination |
| sea / inland waterway | FAS, FOB | seller | buyer | at origin port |
| sea / inland waterway | CFR, CIF | seller | buyer | at origin port, **on loading** |

Three things in that table do the work.

- **The two extremes are traps.** EXW puts export clearance on a buyer who usually has no legal standing to
  file it in the seller's country; FCA is the honest replacement. DDP puts import clearance, duty and import
  tax on a seller who usually cannot be importer of record and cannot recover the VAT; DAP or DPU is the
  honest replacement. A counter that offers EXW and DDP as ordinary choices is offering two ways to get stuck.
- **Cost and risk split under the C terms.** Under CIF the seller pays freight all the way to the destination
  port, but risk passed to the buyer at origin on loading. Goods damaged in transit are then the **buyer's**
  loss, claimed against insurance the seller was obliged to buy. This is the single most misread fact in the
  whole set, and it is the one that reaches our code.
- **Only CIF and CIP oblige the seller to insure.** CIP was raised to Institute Cargo Clauses (A) in 2020;
  CIF remains at (C). Under every other term, insurance is somebody's commercial decision and nobody's
  obligation. DPU replaced DAT in 2020.

## 3. The live defect: who may open a claim

`openFreightClaim` is guarded by `assertFreightSender`. Only the party that posted the load may raise a claim
against it.

That guard silently encodes an assumption: **that the sender still bears the risk at the moment the goods were
damaged.** Under a C term it is false. Risk passed at origin, the goods are the receiver's, and the party with
standing to claim is the one the system currently refuses.

Consequences, in order of severity:

1. A receiver who owns the loss cannot open a case at all.
2. A sender who no longer owns the loss can open one, and be awarded money for goods that were not theirs.
3. The clawback shipped in FP8 then recovers that award from the carrier, so a wrong answer moves real money
   out of a driver's pay.

**Therefore the term cannot be added as a display-only field.** Showing "CIF Mombasa" on a screen while the
claim route still assumes the sender bears the risk is worse than showing nothing: it advertises a rule the
system does not obey. Standing must change in the same slice that records the term.

## 4. The consignment note: what belongs on it, and what does not

The note is a **carriage** document; the term is a **sale** term. They must not be confused, and
`consignment_note.md` governs the boxes — this section only says what the term may and may not touch.

- **The term itself is not a box of the CMR.** If it is printed at all it belongs under special agreements,
  as a statement of what the parties agreed, never presented as a field the note defines.
- **Carriage payment is legitimately ours.** Whether carriage is prepaid or collect is the carriage-level
  shadow of the term, and the note already carries charges. That is the honest place for the consequence.
- **Box 13 already carries customs instructions,** and that is its proper use: what the sender tells the
  driver at the door, including formalities. FP7 built it. The term may *inform* what a sender writes there.
  It must not be silently generated into it.
- **The public tracking page carries none of this.** It is a commercial arrangement between two parties and
  no business of whoever holds a link.

## 5. Clearance as a capability

A clearing agent is not a new kind of thing. It is the shape we already have twice.

- **Papers that expire.** A broker licence, a bond, a customs agency registration — each is a document with a
  date, and the date does the work. This is FP4 exactly: nothing is stored as "verified", status derives from
  the date at the moment of asking, and a lapse switches the capability off without anyone deciding to.
- **A capability per jurisdiction.** Clearing in Kenya says nothing about clearing in Zambia. The presence
  ladder already holds capabilities per jurisdiction with an audit trail, and clearance belongs in that set.
  Where presence is too low to promise anything, we promise nothing — cover is zero by construction.
- **Appointed by the party the term names.** The Incoterm says who bears export clearance and who bears
  import clearance. That party appoints the agent. The network never appoints one on a party's behalf,
  because appointing one is accepting a liability that lands on the importer of record.

## 6. Trust in a clearing agent: two competencies, one of them unmeasurable

A practitioner's judgement, from the user, is that the best agent is the one who knows the most **and** has
the widest network of drivers. That splits into two competencies, and they are not equally honest to measure.

**Clearance competence** — filing accuracy, classification, documents complete. Real, and contaminated.

> **THE TRAP: if we score clearing agents on elapsed time at the border, we systematically advertise whoever
> pays bribes.** An agent who is fast because they grease the queue beats a clean agent on any dashboard we
> could build, and we would be publishing that as competence.

The road map already states the general form of this: *absence of a report is not clearance.* The customs
form is: **absence of a seizure is not evidence of compliance.** A clean record is an unfalsifiable positive,
and unfalsifiable positives must never be scored.

If clearance is ever measured, it is measured split:

- **What the agent controls** — documents complete on first submission, entries accepted without amendment,
  time from receiving papers to filing, responsiveness.
- **What the state controls** — inspection selection, physical examination, queue position. Recorded, shown,
  and **labelled as not the agent's doing**.
- **Never one blended score.** Blending is precisely what makes bribery look like competence.

**Mobilisation competence** — can they find a truck when trucks are scarce? This is the half the platform
already observes natively: time from posted to claimed, fill rate while a corridor is tight, whether they
deliver when nobody else can. It is hard to fake, it costs nobody their integrity, and it is measured rather
than asserted.

**Lean on mobilisation.** It is the honest half, and it happens to be the half that matches what a shipper
actually needs on the day a government requisitions the national truck fleet.

Two constraints carry over from the reputation work: rate per lane and per commodity class, since an agent on
dry goods is not comparable to one on perishables or regulated cargo; and if the network ever appoints or
earns from an agent, publishing a ranking of them is self-dealing.

## 7. First-hand, evidenced, or not at all

> The user's framing, and the governing principle of §8–§9: *right information can only be shared by those who
> have it at their fingertips, or even as photo evidence, not by those who rumour.*

Regulations in these markets change without announcement. A circular lands somewhere nobody watches, a
requirement is added verbally at a gate, an office changes its hours. The rule exists; the publication does
not. So the only people who know are the ones who were there this week.

That makes **provenance the whole design**, not a quality flag bolted on afterwards.

| tier | what it is | how it is held |
|---|---|---|
| **derived** | the system measured it; nobody typed it | strongest, and free — see §8 |
| **evidenced** | a first-hand observation with a photograph of the notice, the stamped document, the gate | strongest typed tier |
| **witnessed** | first-hand, no photograph: *this is what was asked of me* | held, dated, never promoted |
| **rumour** | what somebody heard | **refused at intake** |

**Rumour is refused, not stored at low confidence.** This is the important line. A low-confidence tier looks
humble and is not: repetition launders it upward until three people repeating one rumour reads as
corroboration. The road map learned this as *no number of reports can promote a road to "surveyed"*. Here it
is cheaper to enforce at the door: if the contributor was not there, there is nothing to record.

Photographs are already a first-class rail. Proof of delivery, securement and dispute photos all exist, with
retention and locking. A photograph of the actual notice is the same rail pointed at a different subject, and
it is what makes an observation checkable by the next person instead of merely believed.

## 8. The triage — most of it needs no contributor at all

Before building any form, ask which bucket a piece of knowledge falls in. Most of the valuable material is in
the first bucket, where nobody has to do anything.

**Derived** — already latent in what we hold:

- border dwell time and lane transit time, from custody events already stamped;
- scarcity, as loads posted against loads claimed and time-to-claim stretching;
- price pressure, measured against the rate stack;
- corridors going quiet, which is simply absence, and absence is measurable.

**When a government requisitions trucks, nobody needs to report it.** The market says so within a day, in
numbers rather than rumour, and the market series built in FB4 is the right home for the signal. The three
analytics honesty rules apply unchanged.

*Boundary:* parcels do not surge — decided, and guarded witness-first. A scarcity signal may inform dispatch
and the freight side. It must not leak into parcel pricing.

**Told** — the genuinely typed layer, and it is small: a new document requirement, changed office hours, a
closed gate, *they want the original and not a copy*, who to ask for at a particular yard.

**Refused** — allegations about named individuals, and anything that reads as guidance on facilitation
payments. Hosting it creates exposure in-country and endangers the contributor. This is not a moderation
policy applied later; it is a thing the intake does not accept.

## 9. The rules that keep the told layer honest

1. **Date it; never verify it.** A bridge height holds until the bridge changes. A customs requirement is only
   ever *what somebody was told, on a day*. Nothing is stamped verified. Entries age visibly on screen, so a
   reader sees "this is what we heard in March" rather than "this is the rule". Same instinct as papers that
   expire: the date does the work in both directions.
2. **Positive observations only.** A contributor may record *they asked me for X*. A contributor may **not**
   record *X is no longer required*. Absence of a demand is not proof of exemption. The cost gap is why this
   binds harder than it does on the road map: **a wrong road report costs a detour; a wrong customs claim
   costs a seizure.**
3. **Protect the contributor.** Reporting a broken bridge makes no enemies. Reporting what happens at a
   particular border makes enemies, in a country where that person must keep working tomorrow. Never publish
   that free text, never attribute it, aggregate only above a minimum number of contributors, and refuse
   outright the categories in §8.
4. **Nobody does homework.** The people who know most profit from others not knowing, so a blank page gets
   nothing from them. Contribution must fall out of work already being done — a photograph taken at a gate the
   driver was standing at anyway. **Never pay for information**: paying for the unverifiable manufactures it.
   Reciprocity, where access is earned by contributing, is the fallback for the typed layer.

## 10. The staged plan, and the line we do not cross

1. **Record the term and the named place, and fix claim standing in the same slice.** The term comes from a
   catalogue, never inferred — the countries precedent. Derive only statements of expectation: who clears
   which side, who pays carriage, where risk passes. Carriage prepaid or collect reaches the note. Nothing is
   billed differently yet. §3 ships here or the slice does not ship.
2. **Clearance as a capability with papers and a jurisdiction** (§5). Appointment by the party the term names.
   Nothing promised where the presence ladder says we have no standing.
3. **Mobilisation as a measure** (§6), which is mostly reading data we already have.
4. **The told layer** (§7–§9), last, because it is the only part that asks a person for anything.

**We will not build duty calculation or HS classification.** A tariff code determines the duty rate, it is
jurisdiction-specific and it is regulated advice. A wrong code is expensive for the trader and the liability
lands on the importer of record, not on us. Record the entry reference the broker filed, and let the broker
own the classification. This is the same line the project already holds on disposal: a legal shape per
jurisdiction is not a product decision.

## 11. Open

- **Who is billed duty under DDP** when no sister is the importer of record? The term says the seller pays;
  our money model says a sister contracts. Those can disagree, and the answer probably restricts which terms
  may be offered where — see the presence ladder.
- **A receiver with standing may not be an identified party.** Under a C term the claimant is the receiver,
  but a counter booking can have a walk-in receiver with no account and no verified phone. Standing without
  identity is unsolved.
- **Photographs of official documents** may themselves be controlled in some jurisdictions. Retention,
  and who may read them back, needs a lawyer's answer before the evidenced tier ships.
- **A disputed observation has no adjudication.** The road map's refuter defect is still open — a refuter's
  words are appended to the reporter's note, so the queue cannot tell a dispute from a report. The same shape
  would repeat here, and here it matters more.
- **Who sees mobilisation ratings** — shippers, or operators only? Publishing them shapes who gets appointed,
  which is influence over a liability we do not carry.
- **Language.** Observations will arrive in Swahili, Amharic and French. The real translation pass is still
  deferred, and a dated note nobody can read is not knowledge.

## 12. Related

- `05_engineering/consignment_note.md` — the note and its boxes; governs §4.
- `05_engineering/presence_ladder.md` — capabilities per jurisdiction; governs §5.
- `05_engineering/country_activation.md` — the catalogue precedent and papers verified by a second person.
- `05_engineering/conversations.md` — where a sender and a carrier already talk, and where a disputed
  observation would surface.
