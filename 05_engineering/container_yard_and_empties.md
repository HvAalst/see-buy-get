# The box as an asset: interchange, the clock, and the empty leg

> Status: **DESIGN ONLY — nothing built.** Written 2026-09-18, straight after CL7 (`2d54ae1`, `ba9a11e`)
> put real container types into the model, because the user's response was that this forces the question:
> *"this means we must elaborate about container yard management."*
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
- **THE EMPTY RETURN LEG DOES NOT EXIST.** A laden leg inland implies an empty leg back to a nominated
  depot. We model the first and not the second, so no driver is ever offered it, the importer arranges it
  out of band, and the freight board — whose whole subject is repositioning (FB3a) — is blind to what is a
  large share of real container haulage demand.
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
| ends at | delivery | return to a nominated depot |
| our record of it | the consignment, the papers, the road leg | nothing |
| what a delay costs | the importer's own time | a charge to the importer from somebody else |

They meet at **stripping** — the moment the goods come out — and part company immediately: the cargo is
done, and the box has a second journey to make with nothing in it.

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

**The entity must NOT belong to a consignment.** The same box comes back next month under a different
consignment, and a record owned by one of them loses the history at the second use.

### b) The clock — said in dates, never in money

The papers-that-expire pattern (FP4, CA5) applied to an asset:

- `outGatedAt` — when it left the terminal. We know this: it is the road leg's pickup.
- `freeDaysClaimed` — **the importer's own statement**, from their contract with the line. Carried,
  attributed, dated. Never asserted by us, in the manner of CL6's offer: nobody else could know it.
- `dueBackAt` — derived, never stored (a stored due-date goes stale silently the moment the free days are
  corrected).
- `returnedAt`, and who recorded it.

**TWO CLOCKS, AND CONFUSING THEM WOULD PRODUCE A NUMBER NOBODY CAN ACT ON.** Demurrage runs while the box
sits INSIDE the terminal unclaimed; detention runs while it is OUTSIDE and not yet returned. Different
parties can be at fault for each. Name both or neither — never a single "days" field.

The notification layer already exists, and this is exactly its shape: tell the importer before the date,
not after. "There should be no loose ends and info needs to be exchanged timely" was the user's rule when
a shop's onboarding went quiet, and an unwarned detention bill is the same failure.

### c) The empty return leg as a REAL LOAD on the board

The piece with the most value and the least new machinery. An `empty_return` freight: origin where it was
stripped, destination the nominated depot, no cargo, and **visible to the market** — which means a driver
can be offered it, and a haulier can triangulate it against a laden leg going the other way. That is the
repositioning question FB3a built the board's origin picker for, arriving with a real example.

It also makes the market series honest: empty repositioning is a large share of container haulage, and a
board that shows only laden legs is describing half the work.

### d) The interchange record — the EIR, with photographs

Condition at gate-out and at gate-in. The machinery exists three times over:

- a **media kind** and retention bin, as `hazard` and `securement` already are;
- the **account pattern** from the road map's disputes — attributed, both sides recorded, a dispute added
  beside rather than instead, never erased;
- the **claim** shape, for when the argument is about money.

A box handed over with a hole in it and no photograph is a dispute the importer loses by default, and
photographing it is the one thing a driver can do in thirty seconds at a gate.

### e) Where the empties are — a count, never a map

Derived from the boxes whose last recorded movement ended at a depot. That answers the haulier's morning
question without a single yard slot, and it stays inside §3's line.

## 5. THE TRAPS — four of them, and the first is already written down

**1. EMPTIES HAVE NO OWNER.** The load-carriers note recorded this exact trap for pallets and trolleys,
and a container is the same trap one tier up with a **third** case the note's fork does not cover:

> A bakery's crate is a SHIPPER module, round-tripping to them. A pallet at a hub is a HUB carrier,
> fungible, home wherever it is useful.

A line's container is neither. It is **a third party's asset**, home is a depot the LINE nominates, and
that nomination can change mid-trip. Get this wrong and empties drift with nobody owed them.

**2. A RETURN LEG WITH NO REVENUE MUST STILL PAY THE DRIVER.** Payout is denominated per unit and per km;
an empty leg is real work with no cargo to bill. Posting it with nothing attached repeats the bag-return
problem at container scale, and the driver who notices is the one who stops taking container work.

**3. THE FREE-DAYS FIGURE IS A CLAIM.** It comes from a contract we have not seen. Carried and attributed
like CL6's advertisement, never as something we checked — and the countdown must say whose number it is.

**4. THE BOX'S CLOCK MUST NEVER GATE THE CARGO.** The goods are the importer's and are delivered when they
are delivered. An overdue box is a separate, later obligation between two other parties. Holding somebody's
goods for a paperwork clock would be the parcel-trunk rule broken at container scale: *the sender owns the
shipment, the receiver owns the goods, the network only holds custody.*

## 6. The slices, in the order they should be built

- **Y0 — the check digit, and the box as a derived entity.** Small, and immediately useful: a mistyped
  container number is accepted today. Nothing downstream needs to change to benefit.
- **Y1 — the clock.** Out-gate, claimed free days, derived due-back, returned. A countdown where the
  importer and an operator can see it, and a notification before the date. **No money anywhere.**
- **Y2 — the empty return leg on the board**, and the triangulation view for a haulier. The slice with the
  most commercial value.
- **Y3 — the interchange record with photographs**, and the dispute shape when the two sides disagree.
- **Y4 — empties per depot, derived.**
- **Never — yard slots, stacking plans, gate queues.** §3.

Y0 and Y1 are small and independent. Y2 is the one worth doing properly.

## 7. Open — and these are the user's to answer, not a slice's

- **Who nominates the return depot, and what happens when the line changes it mid-trip?** The answer
  decides whether the empty leg is planned once or re-planned, and therefore whether Y2 is one load or a
  load that can be diverted.
- **Does the network ever want to HOLD empties?** A shop or hub with yard space could be an empty depot,
  which is a capability and a presence question rather than a feature — and it is the first time this
  network would store somebody else's asset at scale.
- **Is an empty repositioning leg billed through us, or settled between the parties** the way a
  cooperative's consolidated truckload already is? That is a money-model decision (`next-work-money-model`)
  and it gates Y2's shape, not its existence.
- **Do we carry the CSC plate date?** Cheap to hold and useful to a haulier; it edges towards fitness,
  which §3 refuses. Probably: carry the date, state nothing about it.
