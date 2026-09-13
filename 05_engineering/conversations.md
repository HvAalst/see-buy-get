# Conversations — matching the people behind the freight

> Status: **DECIDED 2026-09-13, building.** Scope: SBG. Governs every message two network participants
> exchange about work. Read with `presence_ladder.md`: in a Matched country this is where the deal is made.

## 1. Why

The network matches shipments, but a shipment is two people agreeing: when, how it is loaded, and — where
we hold no money — how and when one pays the other. In a country we only MATCH, nothing of ours settles the
job, so the conversation is not a convenience beside the product: it is the product. The user, 2026-09-13:
*"We don't just match the shipments, also the people behind it."*

The design follows the colleague's critique the user already agreed with: **we move value through people we
have no recourse against.** So the network stays out of the money and keeps the RECORD — what was agreed,
when, between whom — in a form that can be shown to somebody later.

## 2. Decisions (user, 2026-09-13)

1. **Who sees a thread: the two parties, by default.** Nobody else — not an operator, not a fleet manager.
2. **A driver may SHARE a conversation, by toggle.** Interpreted as: with their own fleet manager, the only
   other person with standing in a driver's work. On/off at any time, per conversation; it widens reading,
   never writing. *(Interpretation — correct it here if it was meant differently.)*
3. **On a dispute, the parties decide what is shown.** A party selects messages and shares a REPORT of them:
   an immutable snapshot, hashed, that an operator can read. The thread itself stays private.
4. **Chat comes BEFORE a match.** A driver or fleet may ask about a posted load before claiming it. This is
   messaging a stranger, so the abuse controls in §4 are part of the first slice, not a later hardening.
5. **Build what is enough to start.** Web push + catch-up on open, no live socket.
6. **The shaping below is the recommendation, taken.**

## 3. The shape

1. **A conversation belongs to a JOB, not a friendship.** It is opened ABOUT a posted load, between the load's
   poster and one counterparty (a driver or a fleet). One thread per (load, counterparty). No load, no thread.
2. **Numbers stay behind the thread.** No phone or email is ever sent to the other party by the chat. Two
   people may swap numbers in a message if they choose; the network never does it for them.
3. **Two kinds of message.** Free text (and, next, voice notes and quick replies) for talking; STRUCTURED cards
   for the deal — a price proposal and its acceptance — which ARE the existing freight negotiation
   (`dispatch.propose` / `acceptProposal`), so a price agreed in the thread is the price the load is claimed at.
   A settlement card records *"settle off-platform: amount, method, when"* — a record, never a posting.
4. **Append-only.** No edit, no delete. A correction is a new message. Hard delete is what makes a chat
   useless as evidence, and evidence is the reason to keep it.
5. **Server sequence numbers.** Every message gets the thread's next `seq`; a client catches up with
   `?after=seq`. Never the client's clock.
6. **Abuse controls from day one:** a party may block the other (the thread closes for new messages both ways);
   report a message; a per-sender limit on messages and on NEW threads per day; only vetted, active
   participants may open a thread.
7. **Honest privacy claims.** Messages are stored by the network and readable by the two parties (and a
   shared manager, and a shared report). No "end-to-end encrypted" wording anywhere — it would be false.
8. **Low literacy:** voice first and quick replies ("Loaded", "On my way", "Paid") in the second slice.

## 4. What it must never do

- **Hold or move money.** A settlement card changes no books, in any country.
- **Leak a number.** No projection of a conversation carries a phone, email or vault reference.
- **Let a third party read a thread** without one of the two parties having shared it.
- **Let a report change after it is shared.** It is a snapshot with a hash of its messages.

## 5. TODO — in the order it should be built

- **CV1. ~~The thread~~ DONE, driven in the browser.** `sbg/conversations` (ConversationService, durable):
  open about a load (active drivers only, one thread per load + asker, only while the load is looking for a
  driver), text + quick replies, server `seq` catch-up, read markers, block/unblock, report with a snapshot,
  20 new threads a day and 60 messages an hour per sender, discreet push (`message` kind). Screens: the driver
  app's Market (Ask about this load + a Conversations card) and the shop's Freight screen; a shared
  `ConversationSheet` / `ConversationList`. **Gap, tracked on progress.html:** the vendor app has no thread
  screen for a store's own diverted freight. Found while driving it: every message was stamped with a date
  and no time.
- **CV2. The deal in the thread.** Proposal / accept / decline as structured cards over the existing
  negotiation; the off-platform settlement card.
- **CV3. Sharing.** The driver's toggle to their fleet manager (+ the fleet app's read-only view), and the
  dispute report (select messages → hashed snapshot → the operator console).
- **CV4. Voice notes** over the media store.
