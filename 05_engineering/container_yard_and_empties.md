# The box as an asset: interchange, the clock, and the return leg

> Status: **Y0 AND Y1 ARE BUILT AND DRIVEN. Y2–Y5 are design only.** Written 2026-09-18, straight after CL7 (`2d54ae1`, `ba9a11e`)
> put real container types into the model, because the user's response was that this forces the question:
> *"this means we must elaborate about container yard management."*
>
> **Four questions this note opened with were answered by the user on 2026-09-18, and two of those answers
> changed the design rather than confirming it — see §7.**
>
> Scope: what happens to the CONTAINER, as distinct from what happens to the cargo inside it.
> Related: `clearance_and_field_knowledge.md` §CL7 (the box's type), the load-carriers note (the same trap
> one tier down), `parcel_trunk_model.md` (custody events), `presence_ladder.md` (what a country can settle).

## 1. Why this follows from CL7, and is not a new appetite

CL7 taught the system what kind of box a consignment is in: an ISO 6346 code, resolved to a height, a
roof, the bodies that can carry it and the gear that lifts it. That was about **carriage** — can this
truck take this box under that bridge.

It also, unavoidably, introduced an asset the system does not own and has never tracked. A container is
**a shipping line's property, on loan, with a clock running on it.** And the thing that starts the clock
is the leg we mint: the moment `mintRoadLeg` sends a box out of the terminal gate, somebody's free days
begin burning.

Today the system does this and then forgets the box entirely:

- **The clock is invisible.** A consignment records `containerNo` as free text and nothing else. An
  importer discovers detention on an invoice, which is the two-weeks-at-customs story wearing different
  clothes: the cost was knowable in advance and nobody said it.
- **THE RETURN LEG DOES NOT EXIST — AND IT IS USUALLY NOT EMPTY.** A laden leg inland implies a leg back
  to a nominated depot, and that leg carries cargo whenever there is cargo going portward, because a box
  is a dry, lockable, weatherproof body (§4c). We model the first leg and not the second, so no driver is
  ever offered it, the agent arranges it out of band, and the freight board — whose whole subject is
  repositioning (FB3a) — is blind to what is a large share of real container haulage demand.
- **Nobody can say where the empties are**, which is the question a haulier asks first in the morning.
- **Condition at handover is unrecorded.** "You damaged my box" against "it was like that when we took
  it" is a dispute with no evidence, and this codebase already built exactly the machinery for that
  argument twice (securement photos at pickup; the road-hazard accounts).

None of that is a new ambition. It is the bill for a modelling decision already taken.

## 2. The distinction that makes it tractable: THE BOX IS NOT THE CARGO

Two lifecycles ride one journey, and they are **not** the same shape:

| | the cargo | the box |
|---|---|---|
| owner | the importer (the goods are theirs) | a third party — the line, or a lessor |
| ends at | delivery | a return to a nominated depot — or a sale, because boxes are traded (§4b) |
| our record of it | the consignment, the papers, the road leg | nothing |
| what a delay costs | the importer's own time | a charge to the importer from somebody else |

They meet at **stripping** — the moment the goods come out — and part company immediately: the cargo is
done, and the box has a second journey to make — often not an empty one (§4c).

**Everything below is about the second journey.** The parcel trunk model already says custody is primary
and that fees follow custody EVENTS; this is that model applied to an asset rather than to goods, which is
why it needs no new architecture — only a second subject.

## 3. WHAT IS NOT OURS, and must not become ours

The same line this project keeps drawing, in the same place:

- **Terminal and yard operations.** Stacking plans, yard slots, crane sequencing, gate queue management.
  That is a Terminal Operating System's job. We run no ports — the design note for CL2a says `destPort` is
  a label a person types, and that stays true. **"Container yard management" in the industry sense is
  somebody else's software, and we should not build a worse copy of it.**
- **The line's fleet strategy.** Which boxes go where, global repositioning, leasing. Not ours, not
  observable to us, and not useful to the people we serve.
- **DEMURRAGE AND DETENTION TARIFFS.** This is the duty line exactly: we do not compute somebody else's
  charge. The penalty for being wrong lands on the importer, the rate is in a contract we have never seen,
  and a number we invent would be relied on. **We carry the free days the importer tells us they have, and
  count down. The charge is between them and the line.**
- **Certifying a box fit for a cargo.** CL7 already refused this for tanks and the same holds here: a CSC
  safety-approval plate has a date on it and we can carry the date, but fitness is not our verdict.

## 4. WHAT IS OURS, and is forced by what we built

### a) The box as an entity — DERIVED, never registered

Keyed by its container number, which is globally unique by design (owner code, serial, check digit) and
already on the consignment as free text. **Created lazily the first time somebody names one**, exactly as
a clearing agent is a company that has been appointed and a handle falls out of a verified name. No
registration form, no onboarding, nothing to keep in step.

And with it, the cheapest honest win available: **the ISO 6346 CHECK DIGIT.** `MSCU1234567` carries a
mod-11 check digit precisely so a mistyped number is detectable, and today we accept anything. A wrong
number is a box nobody can trace, a clock nobody can stop and a dispute nobody can settle. This is the
same argument as validating a UN number's shape and never its choice: we check the arithmetic, not the
box's existence.

**The entity must NOT belong to a consignment**, and that is now a requirement rather than hygiene. The
user's second answer settles it: *"if it becomes an object of new minted freight, even domestic, we take
it."* A box can therefore appear on a domestic load with **no import behind it at all** — somebody moving
a box they bought, or hauling inside one because it is dry and lockable — and a record owned by a
consignment could not hold that case, never mind the same box coming back next month under another one.

**The CSC plate date is carried — decided by the user 2026-09-18.** A safety-approval plate has a date on
it, the date is cheap to hold, and it is useful to a haulier who is about to be refused at a gate. We
carry it and **state nothing about it**: the plate's date is not our verdict on whether the box is fit,
which §3 refuses.

### b) Who owes the return — and the three ways a box stops being ours to watch

**The booking agent owes the return.** The user's first answer, from their own experience, and we can know
it without asking anybody: the appointment is already recorded, so the party who booked the box is
derivable rather than typed. The importer still sees the clock, because the charge lands on them, but the
obligation has a named holder — and a clock with no named holder is a number that annoys everybody and
moves nobody.

Then the part that overturns this document's first draft, which quietly assumed every box goes home:

> **CONTAINERS ARE TRADED GOODS.** *"In the real world containers are demanded objects and are very often
> sold in the market and are never returned."*

So a return is one ending out of three, and the model has to hold all three or it will be wrong about an
ordinary case rather than an edge one:

| ending | what it means | what the clock does |
|---|---|---|
| **returned** | handed back at a depot, interchange recorded | stops, with a date |
| **bought** | sold on, or bought out of the line's fleet | never starts, or stops on the fact |
| **out** | still out, and somebody owes a return | runs |

### c) The return leg as a REAL LOAD — and it is very often NOT empty

The piece with the most value and the least new machinery, and the user's first answer sharpened what it
is. A box travelling back toward the port is **a dry, lockable, weatherproof body**, so it gets used:

> *"They are also used to carry freight to the direction of the port to keep cargo secured — theft, rain
> or whatever."*

Which is why this is a freight slice and not a logistics-admin one. The leg back is a load: origin where
the box was stripped, destination the depot or the quay, and **cargo whenever the market has something
going that way.** A driver can be offered it, a haulier can triangulate it against a laden leg coming the
other way, and the board — whose whole subject is repositioning (FB3a) — stops describing half the work.

**It also answers trap 2 in the best possible way.** A repositioning leg with no revenue is a leg no
driver wants, and the answer is not a subsidy but a market, which is the thing we already run. The empty
case remains, because sometimes there is nothing to carry, so the leg carries cargo *or it does not* — and
only the honest version of that is publishable: an empty leg must say it is empty rather than be dressed
up as freight.

### d) The interchange record — the EIR, with photographs

Condition at gate-out and at gate-in. The machinery exists three times over:

- a **media kind** and retention bin, as `hazard` and `securement` already are;
- the **account pattern** from the road map's disputes — attributed, both sides recorded, a dispute added
  beside rather than instead, never erased;
- the **claim** shape, for when the argument is about money.

A box handed over with a hole in it and no photograph is a dispute the importer loses by default, and
photographing it is the one thing a driver can do in thirty seconds at a gate.

### e) Where the empties are — A REGISTER A YARD OPTS INTO, and we hold nothing

The user's third answer, and it is a better shape than the derived count this document first proposed:

> *"We don't hold empties, but what's up if we keep a register of where they hang around, if a yard wants
> a network where they can actually be registered."*

**We take no custody and no responsibility** — that part of §3 does not move. What we offer is the one
thing a yard cannot build for itself: being **findable**. A yard opts in, says which boxes are hanging
around, and a haulier's first question of the morning has an answer.

Two sources, and **they must never be added together into one number**:

- what the yard **says** is there — a claim, attributed and dated, exactly as an agent's advertisement and
  an importer's free days are claims;
- what we **derived** — boxes whose last recorded movement ended at that yard.

The first can be stale and the second can be incomplete, and a reader who cannot tell which is which has
been handed a false inventory. `basis`, as on the agent record, already says this in the codebase's own
words. The presence ladder's shape then applies unchanged: a yard is **observed** before it is
**registered**, and registered long before anything settles with it.

Still never: a yard map, a stacking plan, a slot.

### f) The water leg — a binnenvaartschip is not a truck

The user's second answer carries a second thing with it, and it is a leg type this system does not have:

> *"In the Netherlands containers also travel in what we call binnenvaartschepen — a unique leg. If it
> travels via us, it could be settled via us."*

Rotterdam and Antwerp move a large share of their boxes inland by barge, and that leg is not a road leg
wearing a boat:

- **the carrier is a vessel operator**, and the leg is **scheduled rather than offered** — no spot-claim
  moment, no driver-hours regime for us to invent, no detour geometry;
- **the stops are quays**, which the model already tolerates: `destPort` is a label a person types;
- **the constraint is an air draft** — and this is the reusable part. A barge's problem is the height of a
  stack of boxes under a fixed bridge, which is **deck height plus load height against a clearance**: the
  exact arithmetic `checkRoute` already does for a road, where the stack plays the part of the load. That
  makes this slice smaller than it looks.

**Settlement follows the presence ladder and needs no new rule.** Where a country is established, a barge
leg settles like any other leg; where a country is only matched, we settle nothing anyway — which is what
the user's parenthesis says: *"matched countries are exception anyway."*

## 5. THE TRAPS — five of them, and the first was already written down

**1. EMPTIES HAVE NO OWNER.** The load-carriers note recorded this exact trap for pallets and trolleys,
and a container is the same trap one tier up with a **third** case the note's fork does not cover:

> A bakery's crate is a SHIPPER module, round-tripping to them. A pallet at a hub is a HUB carrier,
> fungible, home wherever it is useful.

A line's container is neither. It is **a third party's asset**, home is a depot the LINE nominates, and
that nomination can change mid-trip. Get this wrong and empties drift with nobody owed them.

**2. A RETURN LEG WITH NO REVENUE MUST STILL PAY THE DRIVER** — answered by §4c rather than by a subsidy.
The portward leg is a load like any other, and the genuinely empty case must be **published as empty**
instead of being dressed up as freight.

**3. THE FREE-DAYS FIGURE IS A CLAIM.** It comes from a contract we have not seen. Carried and attributed
like CL6's advertisement, never as something we checked — and the countdown must say whose number it is.

**4. THE BOX'S CLOCK MUST NEVER GATE THE CARGO.** The goods are the importer's and are delivered when they
are delivered. An overdue box is a separate, later obligation between two other parties. Holding somebody's
goods for a paperwork clock would be the parcel-trunk rule broken at container scale: *the sender owns the
shipment, the receiver owns the goods, the network only holds custody.*

**5. A BOX THAT WAS SOLD IS NOT OVERDUE.** The new one, and it falls straight out of §4b. Boxes are bought
and sold, and a single "not returned" state would raise an alarm against somebody who owes nothing at all.
The ending is recorded as **a fact** — returned, or bought — and the clock stops on the fact, **never on a
dismissal**: an alarm a person can wave away teaches them to wave away the next one, and the next one is
the detention bill this was built to prevent.

## 6. The slices, in the order they should be built

- **Y0 — SHIPPED 2026-09-18, driven.** The check digit, the box as an entity derived from its number, and
  the CSC plate date carried with nothing said about it. `container-box.ts` holds the arithmetic and
  `container-box.service.ts` the lazily-created entity, owned by no consignment. A number whose digit does
  not add up is refused with the digit it should have been; the shape, the fourth letter and the check
  digit are three different sentences.
- **Y1 — SHIPPED 2026-09-18, driven.** The two clocks, the three endings, the booking agent as the holder
  of the obligation, free days as an attributed claim, a due date derived and never stored, and a warning
  to BOTH parties three days before it. **No money anywhere, asserted by a test.** The out-gate is the
  road leg's own pickup, which the drive proved end to end: a minted leg is not a gate, and the box left
  the terminal when a driver actually took it. **What building it turned up:** a claim recorded against
  the clock that is not yet running rendered as "nobody has said how many free days" to the person who
  had just said it — the console showing a state it did hold, again. Every claim is now on the screen,
  with a line saying which clock it belongs to.
- **Y2 — the return leg on the board, laden or empty**, with the portward case first because that is the
  one that pays. The slice with the most commercial value.
- **Y3 — the interchange record with photographs**, and the dispute shape when the two sides disagree.
- **Y4 — the empties register a yard opts into**, with the yard's claim and our derivation kept apart.
- **Y5 — the water leg.** Independent of Y0–Y4 and the largest of the six: a leg whose carrier is a
  vessel, whose stops are quays, and whose height check is the road one over again.
- **Never — yard slots, stacking plans, gate queues** (§3), and never a demurrage tariff.

Y0 and Y1 are done. **Y2 is the one worth doing properly**, and it is next.

## 7. Decided by the user, 2026-09-18

All four questions this document opened with are answered, and two of the answers changed the design
rather than confirming it.

1. **Who owes the return:** the **agent who booked the box** — §4b. And the correction that matters more
   than the answer itself: **containers are traded, sold, and often never returned**, so "returned" is one
   ending of three and a sold box is not overdue (§4b, trap 5).
2. **Is a repositioning leg ours:** yes, and wider than the question asked — *"we must follow real world
   hardiness"*. A box that becomes the object of newly minted freight is freight, **including a domestic
   load with no import behind it** (§4a); the portward leg is usually **laden**, because a box is a secure
   body (§4c); and the **binnenvaartschip is a leg of its own**, settled through us where presence allows
   (§4f).
3. **Do we hold empties:** no — **a register a yard opts into**, so a yard can be findable without us
   taking custody of anything (§4e).
4. **The CSC plate date:** carried, with nothing stated about it (§4a).

## 8. Still open

- **What a yard is, in the entity model.** A depot that registers empties is not a shop, a hub or a store,
  and Y4 should not invent a fifth participant type casually. Likely: a site with a capability, the way a
  border post and a dock already are.
- **Who may correct a register entry** a yard got wrong — the yard alone, or a haulier who drove there and
  found nothing? The road map's answer (both, attributed, nothing adjudicated) probably transfers.
- **Whether a barge leg needs a schedule concept** at all for a first version, or whether a sailing is
  simply a load with a fixed departure that the market cannot bid on.
