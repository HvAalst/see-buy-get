# SBG Identity & the Authenticated Receiver — Architecture Proposal

> Status: **SIGNED OFF (2026-07-23), ready to build from S20.** Nothing here is built yet.
> The four open decisions are resolved — see §12.
> Scope: the SBG (SeeBuyGet logistics) product only. BondBridge is a **sibling product** under
> the "See Buy and Get" umbrella; it is referenced here **only as a pattern to copy** (its invite
> mechanism). There is **no BondBridge↔SBG integration** in this plan.

## 1. Why

Two problems, one root cause.

- **The "Get" side is anonymous — a real security hole.** The receiver is only a
  `receiverMobile` string on the parcel. Track-and-trace is a public `GET /track/:key`, and the
  collection code is "SMS'd." Anyone with the key watches the parcel; the receiver has no identity,
  can't be trusted as the collector, and a delivery dispute *goes nowhere* because there is no
  buyer to route it from.
- **Accounts are fragmented and duplicated per role.** `AccountService.Account` is keyed by email
  and holds **one** `role ∈ {pudo, driver, mdp}` and **one** `did`. On top of that sit three more
  login mechanisms: `vendors/login` (id + secret), `fleet/managers/login` (a code), and the sandbox
  `POST /v1/auth/token` DID-mint the driver app uses. **A driver who wants to send a parcel today
  would need a second account.** That is exactly what we must never do.

The unifying insight: **every role's record already carries a phone** (agent & driver mobile in the
Identity Vault, mdp `contactPhone`, parcel sender/receiver mobile). Phone is the one key every human
in this network already has. It becomes the spine.

## 2. Principles (from the product direction)

1. **One person, one account, many roles.** A human is a single identity that *carries* roles
   (consumer/sender/receiver, driver, agent, hub worker, fleet manager, vendor operator). Roles
   attach to the person; they are never separate accounts.
2. **Phone is the identity key.** Verified once by OTP; a **4-digit PIN** reopens the app
   thereafter (the BondBridge credential shape, chosen for consistency and a low-literacy,
   phone-first consumer).
3. **The consumer is authenticated for both send and receive** — one signed-in identity for the
   whole "Send / Buy / Get" consumer surface (the current anonymous Send/Track PWA gains accounts).
4. **Forward-compatible with a future central account service.** A later "one login across all our
   products" service will own personal settings (avatar, name, address, phone). We design SBG's
   identity so it *migrates onto* that service without repeating settings — we do **not** build
   cross-product SSO now.
5. **Copy BondBridge's invite, don't couple to it.** We replicate the invite *pattern* (token +
   phone + channels + a link that onboards a new user) inside SBG, for **app exposure / growth** —
   not for circles, not as a shared service.
6. **The data firewall holds.** PII (name, national ID, phone) stays in the Identity Vault; the
   Operational Core stays pseudonymous (DIDs + events). Phone is matched via a **hash**, never
   stored in the clear in the core, never leaked on the public track surface.

## 3. Target identity model

```
Identity (Person)                 ← the account; unique by verified phone
  personDid          : did:glos:person:…   stable pseudonymous id
  phoneHash          : sha256(e164)         the unique key + parcel join key
  pinHash            : scrypt                4-digit PIN (after OTP verification)
  vaultRef           : →Identity Vault      name, phone, (later avatar/address)
  roles              : RoleLink[]           what this person may act as
  createdAt

RoleLink
  role      : 'consumer' | 'driver' | 'agent' | 'mdp' | 'fleet_manager' | 'vendor'
  entityDid : the domain entity's own DID (existing agent/driver/mdp/vendor records keep theirs)
  tenant?   : e.g. a fleet driver's owning manager DID (scope boundary, unchanged from S2)
  status    : 'active' | 'pending' | 'suspended'
```

- **The person owns a set of role-entities.** GLOS already mints a DID per domain entity
  (`agent.did`, `driver.did`, `mdp.did`, `vendor.did`). Those are unchanged; the person identity
  becomes the umbrella that *links* them. The **consumer** role's entity is the person itself
  (its `entityDid = personDid`).
- **Auth mints an actor token per acting role** — reusing the S2/S3 machinery exactly. The app has a
  **role switcher** ("Act as: Me · Driver · Shop"); selecting a role mints a token carrying that
  role + entityDid + its scopes (`scopesForRole`) + tenant + tier. No new authz model — a person is
  just allowed to mint tokens for any role they hold.
- **The consumer role** is new: scopes `shipment:create` (send), `parcel:read:own` (their sent +
  received parcels, matched by phoneHash), `dispute:file`, `pod:submit`.

## 4. Auth flow

1. **First run:** enter phone → `POST /auth/phone/request` → OTP (echoed in sandbox, SMS in prod) →
   `POST /auth/phone/verify`. If no identity exists for that phoneHash, create one; set a 4-digit PIN.
2. **Reopen:** PIN unlocks the stored session locally; a long-lived session token (per S2) keeps the
   device signed in. A new device re-verifies by OTP.
3. **Acting:** the app mints an actor token for the selected role via the person's identity. The
   consumer role is the default for a phone-first newcomer.

This *coexists* with today's role logins (a shop's shared tablet still signs in with the agent's
email+password; a fleet office with its code) — **all resolving to the same person** when the phone
matches (see §6). The future central service collapses the credentials; until then, coexistence
avoids forcing a shared shop tablet onto someone's personal PIN. **(Open decision O1.)**

## 5. The receiver ↔ parcel-twin linkage

- A parcel's `receiverMobile` is hashed to `receiverPhoneHash` at creation.
- A signed-in consumer sees, under `parcel:read:own`, every parcel where `receiverPhoneHash` or
  `senderPhoneHash` matches their verified phone — **retroactively** (a parcel created before they
  had an account appears the moment they verify the matching number).
- This makes the receiver a real party to the **digital twin**: their app shows the live parcel,
  its status timeline, the collection token, and (post-delivery) the dispute + PoD controls.

## 6. Unifying the existing role accounts (no duplicates)

- Existing `account.service` accounts already store the person's `phone` at signup. Migration:
  derive `phoneHash`, create/attach a **person identity**, and convert the account's single
  `(role, did)` into a `RoleLink` on that person.
- When a person later verifies the **same phone** for the consumer role, the system finds the
  existing person by phoneHash and **attaches** the consumer role — never a second account. A
  driver who signs in and taps "send a parcel" acts under the same identity.
- Vendor (id+secret) and fleet (code) links attach the same way, keyed by the operator's phone.

## 7. In-app collection token (QR primary, 4-digit fallback)

- The OTP is **demoted to a PUDO convenience**, not the identity. Handover confirmation:
  the receiver's app shows a **collection QR** (`sbg:collect:<code>`, reusing the S18 QR engine);
  the PUDO **scans it** (the S19 camera scanner). The **4-digit** remains a typed fallback for a
  dead camera. The token is delivered **in-app** (the authenticated twin), never by SMS.
- Backend `pickup` already accepts the code; we add the twin surface + keep the 4-digit path.

## 8. Track-and-trace

- The receiver gets the **authenticated** timeline as a first-class view in their app.
- `GET /track/:key` **stays public** as a shareable **quick-lookup** link — but it **must stay
  strictly PII-free** (no name, phone, collection code, exact address; status + coarse location
  only). A dedicated audit of the track payload is part of S22 to guarantee this.

## 9. Buyer dispute + delivered-state proof

- **Buyer PoD:** at collection, the receiver photographs the delivered parcel in their app — their
  own proof-of-state, stored alongside the agent's handover photo (both kept).
- **Dispute:** the receiver files from the app → routes by parcel origin:
  - **vendor order** → notify the **vendor** via the existing S15 HMAC callback outbox (the channel
    exists; nothing buyer-side triggers it today) + surface in the vendor app.
  - **peer send** (no vendor) → notify the **sender** (now an authenticated consumer) + the control
    tower. **(Open decision O3: is a peer-send dispute in scope for v1, or vendor-order only?)**
  - A dispute carries the buyer's reason + PoD photo; adjudication is control-tower/ops (existing).

## 10. Invite for exposure (copied pattern)

- Replicate BondBridge's invite shape in SBG: `Invite{ inviterDid, phone, token(unique), channels,
  status, linkedPersonId }`. A consumer invites a contact → a tokenized link → on join, the new
  person is created and (optionally) the inviter is credited. **Growth only** — no circles, no BB
  dependency.

## 11. Sequencing (reviewed slices)

Each slice is contract-first, tested, adversarially reviewed, committed, as with S1–S19.

- **S20 — Identity core.** The person model (phoneHash key, PIN, roles), OTP+PIN auth, the
  role-switch token mint, and the migration that folds existing accounts onto person identities by
  phone. No UI change to existing role apps (they keep their logins, now resolving to a person).
- **S21 — The consumer app.** The Send PWA gains accounts (phone+PIN), the role switcher, and the
  receiver home: "my parcels" (sent + received via phoneHash), the authenticated twin/timeline.
- **S22 — In-app token + QR handover.** The collection QR in the receiver app; PUDO scan confirms;
  4-digit fallback; retire the SMS-token assumption.
- **S23 — Buyer dispute + PoD.** Delivered-state photo, dispute filing, vendor/sender notification
  routing, vendor-app surfacing.
- **S24 — Invite for exposure.**
- **Interleaved compendium gaps** (from the S18 audit) land where they fit: per-parcel handover
  scan with the 100%-gate, SMS→in-app notification shift, stagnant/ghost-bus auto-flags, thermal
  ZPL/EPL label output. (Camera scanning, real QR, and void/reverse-logistics are already done in
  S18–S19.)

## 12. Decisions (resolved, signed off 2026-07-23)

- **O1 — Credentials: KEEP.** Agent/hub/fleet/vendor keep their current credentials
  (email+password / code / secret); all resolve to the **same person** by phone. No forced move to
  phone+PIN. The future central account service unifies credentials later.
- **O2 — Public track link: KEEP, strictly PII-free.** `GET /track/:key` stays public as a
  quick-lookup link, but must carry **no PII** — status + coarse progress only, no name, phone,
  collection code, or exact address. S22 includes an explicit audit of the track payload.
- **O3 — Peer-send disputes: IN v1.** Both vendor-order and walk-up peer-send disputes ship in v1.
  Vendor orders notify the vendor (S15 callback channel); peer sends notify the **sender** (now an
  authenticated consumer) + the control tower. Both carry the buyer's reason + delivered-state PoD
  photo.
- **O4 — Retroactive sender linking: YES.** Backfill `senderPhoneHash` (and `receiverPhoneHash`) on
  pre-S21 parcels from the captured mobile, so past sends/receipts surface for that person the
  moment they verify the matching number — the same retroactive rule for both sides.
