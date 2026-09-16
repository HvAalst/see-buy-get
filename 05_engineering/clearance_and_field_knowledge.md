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

### PRE — fix the refuter defect on the road map
Not part of this epic, and it blocks CL5. Today a refuter's words are **appended to the reporter's note**, so
the operator queue cannot tell a dispute from the report it disputes. CL5 builds a second, larger observation
store on that same pattern, where the cost of confusing the two is a seizure rather than a detour. Fix the
shape once, on the smaller surface, before repeating it.

### CL1 — The term, and who may claim
The largest slice, and the one that closes a live defect.

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

### CL2 — Clearance as a capability
- **Build:** a clearing agent as a party whose licence, bond and registration are **papers with dates**,
  reusing the FP4 pattern exactly; the capability held per jurisdiction on the presence ladder; appointment by
  the party the term names, never by us.
- **Decided, see §5:** which terms may be offered where is the super admin's, held per jurisdiction, default
  off, selected from the catalogue of eleven, two names to switch one on and one to switch it off. The
  mechanism ships in CL1; what remains here is the agent who performs the clearance the term allocated.
- **Screens:** the console's papers screen, extended to agents; the appointing party's own screen. Nothing
  reaches the driver, who is not a party to it.
- **Gate:** a lapsed licence removes the capability with nobody deciding to, and the refusal names the paper
  and the date it lapsed.

### CL3 — Scarcity, derived
No dependencies. Cheap, and it is the slice that pays for the epic early.

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
