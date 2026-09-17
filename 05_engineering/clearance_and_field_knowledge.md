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

### Which terms may be offered, and who decides — DECIDED 2026-09-16

**Term availability is not a product setting and not a shop's choice.** It is held **per jurisdiction as two
sets, permitted-as-origin and permitted-as-destination, both default off**, and switched on by the **super
admin**.

**Two sets rather than one, decided 2026-09-16.** The terms are not symmetric about a border. EXW burdens the
buyer with export clearance at the **origin**; DDP burdens the seller with import clearance at the
**destination**. A single list per country would have to be true of both directions at once, which means it
would be wrong in one of them. The shape is the one countries already use: a country
is *selected from a catalogue rather than created*, and the eleven terms are likewise a catalogue from which
a jurisdiction carries the subset that has been activated for it. Nobody can invent a term; they can only
switch on one of the eleven.

Mechanically this rides on the presence record and **not** inside `PRESENCE_CAPABILITIES`. That list is seven
booleans about money and custody, each with its own refusal sentence, and eleven trade terms do not belong in
it. The activated set is its own list on the country's presence record, empty until somebody selects into it.

Two rules carry straight over from switching a country on:

- **Refuse when the person decides, not at the first shipment.** CA1 already refuses to switch a country on
  before its currency is on the rate book, and it asks the person deciding rather than discovering it at the
  first price. A term whose obligations the jurisdiction cannot support is refused the same way, by name, at
  the moment of activation.
- **Two people to switch one on, one person to switch it off.** Reuses `samePerson`, as country activation
  does. Raising a promise needs a second person; withdrawing one must never be slowed down.

**Presence floors the menu; activation selects within it and cannot escape it.** A term that obliges the
network to clear and bill duty cannot be activated where `tax` or `payouts` is off, for exactly the reason
cover is zero by construction where `claims` is off. The super admin chooses among the terms a country's
standing already permits.

**What exists, corrected 2026-09-16.** An earlier draft of this section claimed the super admin does not
exist. That was wrong, and it was repeating a stale open item in `country_activation.md` §11.
`OperatorAccountService` already gives network staff **one named account each**: email-keyed, scrypt-hashed,
with the person's name carried in the token, so a two-person rule is finally a statement about people rather
than about two typed names. The shared setup key survives for exactly two jobs, creating the first account
and running scripts, and outside a sandbox it cannot take a two-person decision.

**What genuinely does not exist is a privilege TIER.** `OperatorAccount` carries no role or level, and
`@Roles('operator')` is binary, so every staff account has identical rights.

**Decided 2026-09-16: no tier, for now.** Term activation is guarded by the same two-person rule that raises
a country, and by nothing further. The user's reason is sequencing rather than principle: a tier is not the
priority yet. So this is **deferred, not rejected**, and it is recorded here rather than left in §11 because
it blocks nothing.

Revisit it when there is an actual need, which would look like one of these: term activation turning out to
want a narrower set of people than every staff member, an account that should read the console without being
able to change a country's standing, or the first jurisdiction where a regulator asks who specifically holds
the power to switch a term on. Until one of those arrives, adding a tier would be changing the permission
model on speculation, and the comparable decision is already running without one.

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

## 10. The order of work, and the line we do not cross

Five slices, in the order they will be built. The order is not preference: **CL1 is first because §3 is a
defect that is moving money today**, and CL5 is last because it is the only slice that asks a person to do
something they were not already doing.

Every slice names its screens. A slice that cannot name them is backend-only and becomes tracked ui-debt,
which is a standing rule of this project, not a preference of this document.

**The only safe reordering is pulling CL3 forward.** It has no dependency on the other four and it reads data
we already hold, so it can fill a gap at any point. Nothing else may be resequenced: CL2 needs to know who
bears clearance, CL4 needs an agent to attach a measure to, and CL5 needs an answer we do not yet have.

### PRE — fix the refuter defect on the road map — SHIPPED 2026-09-17, commit `8df85ba`, driven
Not part of this epic, and it blocked CL5. A refuter's words were **appended to the reporter's note**, so the
operator queue could not tell a dispute from the report it disputes. CL5 builds a second, larger observation
store on that same pattern, where the cost of confusing the two is a seizure rather than a detour. Fix the
shape once, on the smaller surface, before repeating it.

**CLOSED, and it went further than the note required** — because a driver using the app asked the obvious
next question: there was a claim and no proof, and the console offered a coordinate to open in a map, which
cannot tell anybody whether a bridge is still standing.

- **`ConstraintAccount`** — every report, agreement and refutation is its own dated account, taking a side
  (`there` / `gone`), with its own words and its own photograph. One per person, so nobody becomes two
  witnesses; changing your mind replaces what you said. Identities still never cross the wire.
- **The photograph is OPTIONAL**, and that is the shape CL5 should copy: a driver who cannot safely stop
  must still be able to warn, so evidence STRENGTHENS a report and never gates it. One report warns
  identically either way — the picture is what a reviewer later decides on.
- **The asymmetry reached the interface:** agreeing costs a tap, claiming a hazard is gone now asks for a
  photograph and a caption. The dangerous direction is the one that has to prove itself.
- **Retention:** a hazard photo is linked to its constraint or the sweep reclaims it as an abandoned
  upload, and its clock starts only when an operator clears the hazard. A new bin (`road-report`), because
  borrowing one that meant something else is how a retention rule stops being true.

**FOR CL5, the pattern to reuse verbatim:** accounts kept apart and attributed, evidence optional but
recorded, and the reviewer shown both sides beside each other rather than a merged narrative. The second
CL5 blocker — a lawyer's answer on holding photographs of official documents — is untouched and is not
ours to resolve.

### CL1 — The term, and who may claim — SHIPPED 2026-09-16, commit `fa1a407`
The largest slice, and the one that closed a live defect. Driven end to end; the two guards a service spec
cannot reach were proven in the browser. Two further holes surfaced while building and were closed with it:
the posting route had no field for a buyer at all, so under a term giving the receiver standing there was
nobody the system could recognise; and the claims queue carried no term, so an operator would have decided an
award without knowing which party owned the loss.

- **Build:** the eleven Incoterms 2020 as a catalogue, never inferred; `incoterm` and `namedPlace` on the
  shipment; the derived expectations of §2; and **claim standing derived from the term** instead of hard-coded
  to the sender.
- **Also build the activation surface**, which the §5 decision forces into this slice. Terms default off
  everywhere, so without the means to switch one on the field is inert and the slice cannot be exercised at
  all. It is small: a selection on the country's presence record, guarded by two names. **Two sets per
  country, origin and destination** (decided 2026-09-16), and a load is judged against the origin set of
  where it starts and the destination set of where it ends.
- **Fallback, stated once:** a shipment with **no term recorded keeps today's behaviour** and the sender has
  standing. Every existing load is in that state, so this is what stops the slice rewriting history.
- **Answer first:** what happens when the party with standing is a walk-in receiver with no account. Decision
  for this slice: **refuse by name, with the reason**, never silently. Identity for that receiver is §11's
  problem, not this slice's.
- **Screens:** the counter, when a load is booked; the shop's freight detail, saying the term and what it
  means in words a clerk can act on; the note's carriage-payment indication; the console's freight claims,
  showing who has standing and why.
- **Gate:** on a C term a receiver opens and wins a claim, and the sender is refused with a sentence that
  names the term; on a D term the existing sender path is untouched; no money is billed differently.

### CL2 — The importer's papers, and the agent who clears them — CL2a + CL2b SHIPPED 2026-09-16, driven

**Rewritten 2026-09-16 from two real imports the user ran.** The first draft of this slice had a clearing
agent as a record with licences that expire. That is not the job. The job is the importer's, and it is worth
setting down what actually happened, because the whole design falls out of it.

> **One 20ft container, Netherlands to Ethiopia.** At customs he needed an investment licence, a tax number,
> a packing list, invoices, some in ten copies. A bag of fertilizer needed the Ministry of Agriculture. A fax
> machine needed the telecommunications corporation. Some chairs came in free and a manager's chair did not.
> The container sat for two weeks. **The agent was not unreliable — they were pleasant, and they simply did
> not know.**
>
> **An entire factory from India, five containers.** He never went to customs. Cleared in a morning. A
> different agent, their own trucker agreements, a different clearing port, and **they knew every document
> they needed before the clearance started.**

**So the lever is foreknowledge, not diligence.** A document wallet that still lets an agent discover a
manager's chair at the counter has changed nothing. And the user's own statement of the requirement is the
scope: *share the documents digitally, grant access, pay the agent, get the containers.*

#### Where this starts and stops

- **The journey starts when the container is onboarded and the shipping documents are created.** At that
  moment arrival is certain and the papers can be assembled during the voyage, which is the whole point:
  two weeks of hassle at the far end was two weeks nobody used while the ship was moving.
- **Ocean carriage and vessel schedules are not our business.** We do not model vessels, schedules or ports
  of loading. **Leave the seam only:** the consignment carries externally-sourced arrival fields that nothing
  fills yet, and the API is shaped so a global carrier (Maersk and the like) could push them by webhook
  later. Documented as NOT WIRED, in the manner of the callbacks section of the shipping API, because an
  endpoint that never fires should be learned about in the documentation and not in production.
- **The road shipment is minted from the port of destination**, by a person, using the freight machinery that
  already exists. That is the leg this network is actually good at.

#### The consignment, and the grant

- **A consignment is the new unit** and it is a container, not a load: a reference, the goods, the importer,
  the destination port, a document set, and later an appointed agent. It exists BEFORE it arrives. Nothing in
  the system models a container today — the only container in the code is a truck body that can carry one.
- **The document register already exists and is close to right.** `CompanyDocument` carries kind, what licence
  or obligation it is the paper for, a version, a sha256 fingerprint (never named `hash`, the response mask
  strips that), content type, size, uploader, expiry, a verification trail and a rejection reason. Company
  papers (investment licence, tax number) carry no `relatesTo`; a packing list for one container does. **Ten
  paper copies become one file with a fingerprint**, which is also how a copy is provably the same document.
- **THE MISSING PRIMITIVE IS A READER.** Every field on a document is about the company that owns it; nothing
  can be shared. Copy the shape conversations already use: shared with exactly one named counterparty,
  explicit, revocable, on the record, both sides seeing what was shared and when. **Two grants, because the
  papers are of two kinds:** a standing grant over company papers, and a per-consignment grant over that
  container's own.
- **Never a shared login.** The administrator record already refuses one person administering two companies,
  in writing, because a credential reaching two companies is one neither controls. An appointment is the
  answer; borrowing the client's sign-in is not.

#### The required list — and the line we keep

- **The agent publishes what they will need for this consignment.** We do not assert it. The importer
  fulfils, the agent ticks off what has arrived, and the importer sees what is still missing. That is the
  difference between the two stories, made into a screen.
- **What was actually asked for at that border accumulates as dated observations** — the fertilizer permit,
  the telecoms permit — which is §7's provenance model arriving earlier than planned because this demands it.
  First-hand or evidenced, never rumour.
- **The line from §10 holds: no tariff classification and no duty calculation.** "You will need a permit from
  the Ministry of Agriculture" is a list of papers. "This chair attracts duty at X%" is regulated advice whose
  penalty lands on the importer. We do the first and never the second.

#### Cut into two pieces

- **CL2a — SHIPPED 2026-09-16, driven.** The consignment, the documents, the two grants, and the agent's
  required list. No money and no road leg. This is the piece that answers the two weeks.
- **CL2b — SHIPPED 2026-09-16, driven.** Paying the agent, and minting the road leg from the port.
  **Payment is gated by presence** — where we only match we cannot be the one who bills, and the screen says
  so at the start rather than failing at the end.

- **Screens:** both the importer and the agent are companies, so both work in the console's company half,
  which exists today and holds only the company record, the password panel and the rate card. The importer
  gets their papers, their consignments, the appointment, and what is still missing. The agent gets the
  consignments shared with them, the list they publish, and the ticking off. Nothing reaches the driver, who
  is not a party to any of it.
- **Gate:** an importer uploads once and appoints an agent, who sees exactly that consignment's papers and
  nothing else; revoking is immediate and visible to both; a document that expires says so before it is
  relied on; and what the agent was asked for at the border is recorded against that border, dated.

#### What CL2a shipped, and what building it turned up

- **The new unit is `ImportConsignment` (`IMP-nnn`), NOT `Consignment`.** That name was already taken by
  F3's consolidation lot (`LOT-nnn`), and the only other container in the code is a truck body that can carry
  one. Three different things; kept apart by name rather than by hoping nobody reads them together.
- **The reader primitive is `DocumentGrant`:** one named counterparty, explicit, revocable, and KEPT after
  revocation, so "who could read our invoices in March" stays answerable. A container's own papers are filed
  under its CODE as `relatesTo`, and that is precisely what confines a per-consignment grant to one box.
- **A DEFECT THE UNIT TESTS DID NOT FIND AND THE DRIVE DID.** A standing grant is shared with the AGENT, not
  with the container, so revoking one appointment silently withdrew that agent's access to every other
  container they were still clearing. Fixed two ways: the company-scope grant is taken back only by the LAST
  appointment, and appointing the same agent again no longer mints a second one. Pinned by its own test.
- **The importer could not put their own papers on record.** `POST entities/:id/documents` was operator-only,
  which made "share your documents digitally" impossible without posting them to network staff first — the
  exact paper shuffle this slice exists to end. Widened to a company administrator over their own company,
  with `requireReach` unchanged. **Verifying stays operator-only:** a second pair of eyes on a paper is a
  different act from owning it.
- **Five document kinds added** to the catalogue, because the import papers had nowhere honest to live:
  packing list, commercial invoice, bill of lading, certificate of origin, import permit.
- **§7's observations arrived early, as that section predicted.** `GET imports/known-papers` answers what
  agents clearing at a port have ACTUALLY asked for — how many asked, how many containers, and when — and
  never as a requirement. It is first-hand by construction: there is no route that accepts a claim about a
  border from somebody who was not clearing anything, which is how rumour is refused at intake. The console
  shows an agent only what is NOT already on their own list, which is the two-week container as a function.
- **Driven as THREE separate companies with three separate sign-ins**, because an operator reads everything
  by construction and could not have proven the confinement. Agent A gets NOT FOUND on the other container
  and on its packing list; a permit that lapsed in 2020 is refused by date at the moment of acceptance; the
  published list survives revocation; another port shows nothing.
- **Left undone, deliberately:** there is no directory of clearing agents, so appointing one means typing
  their company id. A directory is a larger question than this slice — who may appear in it, and on whose say.
- **Noticed while driving and NOT ours:** the console asks `GET /v1/sbg/finance` on a company sign-in and
  takes a 403, because that route is operator-only by design. Pre-existing, untouched here, worth fixing.

#### What CL2b shipped, and what driving it taught

- **The money is a PASS-THROUGH, and the books prove it rather than promise it.** Receiving the agent's fee
  posts exactly two lines on the sister in the PAYER's jurisdiction — cash in, and the same amount owed to
  the agent. There is no revenue line and nowhere for one to go, which makes §10's condition ("the network
  earns nothing from an appointment") structural instead of a rule somebody has to remember.
- **Money is created only by an observed external event.** The importer cannot record their own payment: the
  receipt is operator-only and requires the reference the money arrived under. Somebody pressing "I have
  paid" is not an event, and a button that mints cash on a claim is the exact shape the books rewrite exists
  to remove.
- **Quoting and agreeing are not paying**, and each belongs to one party. The agent quotes, the importer
  agrees, and a re-quote DROPS the earlier agreement — nobody is held to a price they never saw.
- **"We cannot be the one who bills here" is said at the START.** `money.canBill` and `money.canPayOut` ride
  on every read of a consignment, so a person is told before they assemble a fee rather than after they have
  agreed one. Quoting and agreeing still work where we cannot bill: what two companies agree between them is
  theirs to agree, and the sentence says so.
- **THE PAYOUT GATE HAD A HOLE, AND THIS SLICE CLOSED IT.** `PayeeStandingRegistrar` recognised only PUDO
  shops; for any other DID it answered null, which means "pay them". A clearing agent is a company, so we
  would have raised a payout into a country we cannot pay into. It now resolves a company from its DID —
  which needed a `byDid` lookup on `EntityService`, because nothing in the system had ever mapped one back —
  and the run names the agent and the reason instead of paying.
- **The road leg rides the machinery that already exists.** Minted by a person from the port, posted with the
  importer as poster and NO `shipperDid`, so settlement stays off-platform exactly as the consolidation lot
  does. A second mint is refused, because it would send two trucks for one container.
- **A DRIVE THAT ASSUMES THE STATE OF THE WORLD TESTS THE ASSUMPTION.** The first run of the CL2b drive
  hard-coded Malawi as "somewhere we cannot bill" and printed two green-looking passes that were simply
  false — the sandbox has a Malawian sister at full presence, so neither refusal could ever have fired. The
  drive now ASKS the network which jurisdiction has no sister of ours and uses that. Both refusals then
  fired, and the payout run named the agent it could not pay.
- **Declaration order bit once, and not where a typecheck would catch it.** `ImportConsignment` carries an
  `ImportFee`, and the swagger plugin evaluates that reference when the consignment class is defined — so
  declaring the fee class later in the same file typechecked cleanly and then killed the contract emit with
  a temporal dead zone. A type annotation would have been erased; a metadata factory is not.

### CL3 — Scarcity, derived — SHIPPED 2026-09-17, driven
No dependencies. Cheap, and it is the slice that pays for the epic early.

**The gate was met as written:** eight loads posted on a lane the seed never used, nobody claiming them, and
the series showed it the same day — the lane appeared out of the loads themselves, the day's row carried the
posting, and demand nobody met rose by exactly eight. Nobody reported anything at any point.

**Everything is derived from timestamps the loads already carry**, so no new endpoint exists: `market/series`
grew a response and the operation count did not move. Thresholds live in `pudo.config` (`THIN_MARKET_LOADS`,
`QUIET_LANE_RATIO`, `CLAIM_STRETCH_RATIO`) — the first was a rule that had lived only in review comments.

**Rule 4, added to the three the series already had:** a claim about a TREND needs something to compare
against, so "stretching" and "quiet" are each measured against the window of equal length immediately before
and refused outright on a thin sample rather than stated softly. A lane that never had traffic is empty, not
quiet.

**THREE DEFECTS THE DRIVE FOUND AND THE UNIT TESTS DID NOT**, all of them about a console contradicting
itself rather than about a wrong computation:

1. **The totals did not partition, and said so in one glance:** 33 asked for, 10 moved, 14 unmet, 11
   withdrawn — which add to 35. `offered` is keyed on POSTING and `moved` on CLAIMING (deliberately, and
   documented), so moved was never the third number in that column, and a load claimed and then withdrawn
   appeared in two rows at once. `takeUp` divided across the same two populations, reading 30% where the
   truth was 24%; on a thinner market it exceeds 100%. Closed by **`metLoads`** — posted in the window,
   still standing, ever claimed — so `offeredLoads = metLoads + unmetLoads + cancelledLoads` exactly, always.
   Moved keeps its place below the partition, labelled as the other question.
2. **A ratio is the claim, not a fact with a claim beside it.** One seeded load negotiated at 350 against a
   stack of 1.17 gave a 299× median that would have published as "+29,815% above the rate card" beside a tag
   reading "thin". Nobody reads the tag instead of the number. The server still publishes the ratio (the
   endpoint is public and a consumer with their own judgement is entitled to it); `priceClaim` is the console
   declining to say it, keeping only the count of loads. **This is the one exception to "state the figure,
   withhold the verdict"** — for a count or a duration the two separate, for a ratio they do not.
3. **`THIN_MARKET_LOADS` was declared twice in the frontend**, at the same 5, in the home app and in the new
   shared module whose own docstring warns that a rule copied into two apps eventually disagrees with itself.
   The home app now imports it. The backend copy is unavoidable; a second frontend copy was not.

**The habit worth keeping:** the arithmetic was right in every unit test because each test asserted one
figure at a time. The defect only exists when four correct numbers are stacked in one column, which is a
property of the SCREEN and not of the function. Read a console the way a reader does — add up what is in
front of them — before calling a view finished.

- **Build:** extend the market series with loads posted against loads claimed, time-to-claim stretching, price
  against the rate stack, and corridors going quiet.
- **Hold the line:** parcels do not surge. This signal informs dispatch and the freight side only.
- **Screens:** the console's market view; a context line on fleet dispatch, so an office reading a thin board
  knows whether the market is thin or only their board is.
- **Gate:** withdraw capacity in the sandbox and the series shows it within a day, with nobody reporting
  anything.

### CL4 — Mobilisation, measured

**Audience and honesty decided 2026-09-16.** Two questions were open here. Both are answered, and the second
answer overturned a proposal made in this document's first draft.

**Who sees it: both, and not the same view.** The shipper sees it because the shipper is the one choosing. An
operator-only signal does not remove our influence over who gets appointed, it conceals it: work still gets
steered by suggestion, and nobody outside can audit a nudge. Operators additionally see the state-controlled
portion of §6, because they are the ones who handle a complaint about it.

**What is published: what happened, including the bad.** The user's reasoning, and it replaces the
publish-only-positives rule this document originally proposed:

> Ever positive publishing is not the real world of business. Like survival of the fittest, the lessons
> learned from bad experiences are necessary for the hardening. It also does not mean that it will benefit
> the fittest only, newcomers have always been a reality and truth is more important than a polish of good
> news only.

The earlier proposal was to surface only demonstrated capability and let silence mean "nothing measured". Its
defect was named in the same breath as the proposal and never answered: it protects nobody from an agent who
is genuinely unreliable, because the only thing a shipper could ever see was good news. A record that can
only flatter is not a record.

- **Build:** posted-to-claimed **net of hand-backs**, fill rate while a corridor is tight, delivery under
  scarcity, per lane and per commodity class.
- **Hand-backs net off, and this is not a detail.** Mobilisation counted as loads claimed is gamed by
  claiming quickly and handing back later, which FP8 made possible and, to its credit, recorded with reasons.
  A measure that ignores them rewards precisely the behaviour it exists to detect.
- **Truth applies to a thin record too.** An agent with three loads shows **three loads**, and no average.
  Not hidden, because hiding is the polish just refused. Not averaged, because five stars from three loads is
  the same untruth wearing the opposite sign. Newcomers are visible as newcomers, which is what they are.
- **Say what was measured, beside the figure and not in a footnote.** We measured whether they find and move
  trucks. We did not measure filing accuracy, and §6 explains why integrity can never be measured by elapsed
  time at a border. A strong mobilisation record read as a general endorsement is this slice's failure mode.
- **Reciprocal visibility is the condition that makes a published negative fair.** The agent sees exactly what
  a shipper sees about them, at the same moment, with no version they cannot read and nothing they can
  suppress. Without it a record handed down is a verdict; with it, it is an account both parties hold.
- **Shown per agent, never as a league table. Decided 2026-09-16.** The apparent tension with "in African
  business there are two winners" is not a tension at all, and the resolution is the user's: **an unreliable
  agent means two losers.** The shipper loses cargo, time and money; the agent loses the work that would have
  followed. So reporting a bad outcome does not violate the principle, it records that a two-loser outcome
  happened. A table does something categorically different: it imposes an ordering on people whether or not
  anything went wrong, manufacturing a loser out of relative position alone. Two winners describes a good
  deal and two losers a bad one. Neither is a ranking, and the account states what happened on real loads.
- **Screens:** the shipper's view where an agent is chosen; the console's fuller view for operators; and the
  agent's own copy of both.
- **Gate:** an agent with three loads shows three loads and no score; a hand-back after a claim reduces the
  count; an agent who delivered while a corridor was tight is distinguishable from one who only worked easy
  weeks; and what the agent sees about themselves matches what the shipper sees, field for field.
- **Before it reaches shippers:** confirm the network earns nothing from an appointment (§5, CL2). If it ever
  does, the view discloses it or it does not ship.

### CL5 — Field knowledge, first-hand only
Last, and blocked twice over.

- **Blocked by:** PRE above, and by a lawyer's answer on holding photographs of official documents, which
  §11 records as open.
- **Build:** an observation carrying its tier, jurisdiction, subject, date and optional photograph; rumour
  refused at intake; ageing derived from the date the way papers are; **positive observations enforced by the
  shape of the form**, so that "they asked me for X" is expressible and "X is no longer required" is not.
- **Screens:** capture on the driver's and the shop's phone at the moment it happens, because a form that
  waits until the evening collects nothing; review in the console; and for readers, the date and the tier
  shown before the content.
- **Gate:** an observation cannot be recorded without saying who was standing there; an entry from last year
  reads as last year's without anyone marking it stale; a disputed entry is distinguishable from the entry it
  disputes.

**We will not build duty calculation or HS classification.** A tariff code determines the duty rate, it is
jurisdiction-specific and it is regulated advice. A wrong code is expensive for the trader and the liability
lands on the importer of record, not on us. Record the entry reference the broker filed, and let the broker
own the classification. This is the same line the project already holds on disposal: a legal shape per
jurisdiction is not a product decision.

## 11. Open

- **Who is billed duty under DDP** when no sister is the importer of record? The term says the seller pays.
  The seller is a store, not us, so this only reaches our books where the network performs the clearance and
  recharges it. That is the case §5's presence floor is meant to catch, and it needs confirming against the
  money model rather than assumed.
- **A receiver with standing may not be an identified party.** Under a C term the claimant is the receiver,
  but a counter booking can have a walk-in receiver with no account and no verified phone. Standing without
  identity is unsolved.
- **Photographs of official documents** may themselves be controlled in some jurisdictions. Retention,
  and who may read them back, needs a lawyer's answer before the evidenced tier ships.
- **A disputed observation has no adjudication.** The road map's refuter defect is still open — a refuter's
  words are appended to the reporter's note, so the queue cannot tell a dispute from a report. The same shape
  would repeat here, and here it matters more.
- **Language.** Observations will arrive in Swahili, Amharic and French. The real translation pass is still
  deferred, and a dated note nobody can read is not knowledge.

## 12. Related

- `05_engineering/consignment_note.md` — the note and its boxes; governs §4.
- `05_engineering/presence_ladder.md` — capabilities per jurisdiction; governs §5.
- `05_engineering/country_activation.md` — the catalogue precedent and papers verified by a second person.
- `05_engineering/conversations.md` — where a sender and a carrier already talk, and where a disputed
  observation would surface.
