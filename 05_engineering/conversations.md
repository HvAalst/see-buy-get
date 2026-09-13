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
  `ConversationSheet` / `ConversationList`. Found while driving it: every message was stamped with a date
  and no time.
  **Follow-up, both gaps closed:** the vendor app's Orders screen carries the store's conversations, and the
  console has **Reported messages** under Waiting on you (moved forward from CV3; the dispute report stays
  there). Closing the vendor gap found an older defect: a store's diverted freight records its STORE ID as
  shipper while the store signs in as its DID, so no store could be addressed in a thread, answer a price, or
  see its own loads in the posted list — resolved to the DID in all three, billing untouched.
- **CV2. ~~The deal in the thread~~ DONE, driven in the browser.** New message kinds `proposal`, `decision`,
  `settlement`, `settlement_agreed`. A price is made through `dispatch.propose` (one fact with the price screen);
  the poster accepts (second tap, claims the load) or declines on the card, and the card reads its status live.
  A settlement (amount · cash / mobile money / bank / other · at pickup / on delivery / after delivery) may be
  written down only where the load has no paying shipper, is agreed once by the OTHER side, and always says
  the network does not hold or move that money. Found driving it: the negotiation let a driver offer on a load
  their vehicle could never carry, and failed only at Accept — `propose` now makes acceptance's capacity and
  capability checks first. Also: the thread list previewed a written settlement by the form's name.
- **CV3. ~~Sharing~~ DONE, driven in the browser.** The asker (a driver in a fleet) ticks "share with my fleet
  manager" → `sharedWithManagerDid`; the manager reads it under **Drivers** in the fleet app (`GET
  conversations/shared`, fleet_manager only), never writes, and loses it if the driver leaves the fleet (the
  reader is re-checked against the driver's CURRENT manager on every read). Either party ticks messages →
  `POST :id/dispute-reports` → a fixed copy, roles instead of identities, sha256 **fingerprint**, a
  `report_shared` line so the other side is told; allowed in a blocked thread. The console lists them under
  Reported messages. Found driving it: the kit `Checkbox` has no visible label (a bare square), a shared
  reader saw every message signed "the poster" (views now carry `from: poster|driver`), and **a key named
  `hash` is stripped from every response by ResponseMaskInterceptor** — the report arrived without its
  fingerprint and crashed the console screen.
- **CV4. ~~Voice notes~~ DONE, driven in the browser** (Chromium's fake microphone: record → send → the shop
  plays it, the shared manager plays it, the operator plays it from a report). NOT over the media store, which is
  images-only by design: `foundation/media/decode-audio.ts` checks WebM / Ogg / MP4 / MP3 by their bytes and
  accepts a codec-parameterised type (`audio/webm;codecs=opus`); recordings live in their own store
  (`pudo-conversation-voice`, 900 KB / 120 s server-side, 60 s in the app), apart from the messages so a thread
  list never carries audio. `POST :id/voice`; `GET :id/voice/:voiceId` for the thread's readers;
  `GET dispute-reports/:reportId/voice/:voiceId` for the operator, only for a voice id that report holds. Played
  from an object URL — an `<audio src>` cannot carry the token.
  **Listen before sending (user, 2026-09-13, as BondBridge does):** stopping a recording no longer sends it. The
  recording stays on the phone with a player — Send, Record again, or Discard — because a message that can never
  be deleted deserves a listen first; the one-minute stop lands in the same review. Driven: nothing is uploaded
  until Send, record-again and discard upload nothing.
  **Decided (user, 2026-09-13): no transcription. Voice stays voice.** Speech-to-text good enough for Swahili and
  Amharic would mean a GPU or an outside service hearing messages the thread promises only two people can read.

- **CV5. ~~A parcel waiting at a shop~~ DONE (2026-09-13).** The user: buyer and shop should be able to "inform and
  remind in a non-automated way". A thread's SUBJECT is now a load OR a parcel (`Conversation.parcelId`,
  `ConversationView.subject`). Poster = the parcel's collection shop; asker = the RECEIVER, as a person (the receiver
  phone hash resolved to a person). Either side opens it (`POST sbg/conversations { parcelId }`), landing in the one
  thread; a stranger on either side is told the parcel does not exist; the shop is told, in words, when the customer
  has no account yet. No deal and no settlement in a parcel thread — there is nothing to agree but a time; quick
  replies are the customer's ("coming tomorrow") and the shop's ("we close soon"). Reports work as before and name
  the subject. `from`/`sharedBy` say `asker`, not `driver`, because the asker is not always one. Screens: Send
  app parcel detail "Message the shop"; Shop app counter "Waiting to be collected" with Message beside each parcel.
  Beside it, not in it: the two buyer EMAILS ("on its way", "ready to collect") now go to the email the buyer gave
  the store, invite the sign-in, and never carry the code; the track screen invites the sign-in too; a store may
  switch the code out of its `ready_for_pickup` callback (`Vendor.callbackCarriesCode`, default on for now).
  **Not built:** a shop starting a thread with a customer who has no account (there is nobody to write to — the
  email and the invitation are the answer); SMS.
