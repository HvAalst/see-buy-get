# Messages in the car — the driver's chats on Android Auto

> Status: **DECIDED 2026-11-02, building.** Scope: the Driver app. The owner, asked what a thin driver version on
> Android Auto would take: *"we start with 2"* — the driver's messages read aloud in the car and answered by voice,
> before any car screen of our own.

## 1. Why

A driver reads the phone on the road. Every message from a load's poster ("gate 3, not gate 1"), every "where are
you?", is a glance away from the road today. The owner, 2026-11-02: *"just to keep drivers' safety in mind, we must
reduce the tapping."* Android Auto can read a message aloud and take a spoken reply with the phone left in its holder
— but only from a native Android app: a web app (what the Driver app is) cannot appear on the car's screen at all.

## 2. What the car can do for us, and what it cannot

Android Auto's **messaging notifications** ("Communication — messaging notifications", Google's category since May
2025): an app posts a `MessagingStyle` notification with two background actions — **Reply** (one `RemoteInput`,
`SEMANTIC_ACTION_REPLY`, shows no screen) and **Mark as read** (`SEMANTIC_ACTION_MARK_AS_READ`, may be invisible on the
phone) — and declares `<uses name="notification"/>` in `automotive_app_desc.xml`. The car then:

- announces "New message from Mama Njeri Stores", reads it aloud on request, and offers **Reply** (spoken, read back
  before it is sent) and **Mark as read**;
- adds its own Play and Mute; draws no other button of ours. **We cannot put "Accept the load" on the car.**

So: **conversations only.** Anything that is a decision — taking an offer, a price, a settlement — stays on the phone,
for when the driver has stopped. That is also the safety line we would draw ourselves.

## 3. The shape

**One app on Play: "SeeBuyGet Driver".** The Driver web app, wrapped as a Trusted Web Activity (the same app the driver
installs today, opened full screen by Chrome, verified by Digital Asset Links), plus a small native part in Kotlin
that does only the car's work. A driver who never installs it from Play loses nothing: the web app stays as it is.

**Turning it on — Settings › "Messages in the car"** (in the Driver app, shown only inside the Play app):
1. The driver turns it on. The server makes a **car key**: bound to the driver AND that phone, able to do three things
   only — read that driver's unread chat messages, reply as text into that driver's own chats, mark them read.
   Revoked when turned off, when the phone is forgotten, when the PIN is reset, the number moved, the account closed —
   the same paths a passkey goes by (house rule: a key belongs to a device).
2. The web page hands the key to the native part through the app's own link (`sbgdriver://car-link?…`, an intent only
   this app answers); the native part keeps it in encrypted storage, registers its Firebase token with the server
   using the key, and says "On for this phone".

**A message arrives:**
1. The server sends the phone a **content-free wake-up** through Firebase Cloud Messaging: "chat X has news". The words
   themselves never pass through Google's push service (privacy: files and words go by link, never by attachment).
2. The native part fetches the unread messages of that chat from our server with the car key, and posts the
   `MessagingStyle` notification: the conversation titled by the load ("FRT-7781 · Roses"), the sender by the name the
   chat already shows, a quick reply ("On my way") said in the driver's own language as the chat renders it.
3. **Reply**, spoken: the native part sends the dictated words as an ordinary text message into that chat — the same
   append-only record as a typed one, refused the same way (closed, blocked, reported, too long), and marked "sent from
   the car" so the poster knows why it is brief. A refusal is posted back as a notification the car reads ("Not sent:
   this conversation is closed").
4. **Mark as read**: the chat is marked read on the server, as opening it would.

**What the driver hears, and nothing else:** messages from the people in their chats about loads. Not offers, not
system notices — Google's category is for conversations, and a decision does not belong at the wheel. (Whether a
fleet manager's "I offer you a run" may be read aloud as a message from that person, with "open the app when you
stop", is a question for Google's review: not in the first slice.)

### The contract between the web side and the native part (S1 ↔ S2, built 2026-11-02)

Agreed here so both halves build to the same thing; the server's side is `backend/src/modules/pudo/car.controller.ts`
and the types it answers in are `car.types.ts` (also in `backend/contracts/openapi.json`, operations `Car.*`).

**The marker.** The Trusted Web Activity's start URL is `https://<site>/driver/?app=android`. The page keeps that it saw
it (sessionStorage + localStorage `sbg-play-app` = `android`); on a first load `document.referrer` of
`android-app://com.seebuyget.driver/` counts too. Only then does Settings show "Messages in the car"
(`frontend/src/shared/playApp.ts`).

**Handing over the key.** After the PIN, the server answers with the key once (`car_` + 64 lowercase hex). The page opens
`intent://car-link?key=<key>#Intent;scheme=sbgdriver;package=com.seebuyget.driver;end` — at once, and again from the
"Open it on this phone" button — and NOTHING ELSE: no plain `sbgdriver://` link, which any app claiming the scheme could
answer and so be handed the key (the integrator, 2026-11-02). An intent naming the package is launched by Chrome into
our app alone, or not at all. The native part accepts the key only as `^car_[0-9a-f]{64}$`.

The native part then registers its Firebase token and hands the screen back to the TWA; Settings shows "Waiting for
the phone" (it asks the server again every 3 s for 2 min, and whenever the page is shown again) until the server has a
token for that key, then "On for this phone".

**Turning it off.** Settings deletes the key on the server first — every car door answers 401 from then on — and then
opens `intent://car-unlink#Intent;scheme=sbgdriver;package=com.seebuyget.driver;end`, so the phone forgets the key and
stops at once. (A key gone by any other path — the phone forgotten, the PIN changed — the phone finds out at its next
call: 401, forget the key, stop posting.)

**Old phones.** The car part runs on Android 9 or newer. Where the phone says Android 8 or older — the user agent, or
Chrome's real `platformVersion` client hint where it gives one (a reduced user agent says "Android 10" everywhere) —
the Settings row says "Needs Android 9 or newer." and offers nothing to turn on.

**Not told twice.** For a driver whose car key has a registered token, a chat message is NOT also sent as a web-push
notice (the Play app shows the web app's push notices as its own): it is kept in the bell's inbox, and the car's
notification is the one the phone shows. Every other notice is pushed as before; a driver whose phone has not answered
yet ("Waiting for the phone") is pushed as before.

**The car's doors.** Every call carries `Authorization: Car <key>` and nothing else (a `Bearer` sign-in, a device key or
a company key is refused there with 401 `UNAUTHORIZED`; the car key is refused on every other door). Errors are
RFC 9457 problem+json: `{ status, code, detail, … }` — `detail` is a sentence fit to read aloud ("Not sent: <detail>").

| Call | Body | Answer | Limit per key |
| --- | --- | --- | --- |
| `POST /v1/sbg/car/token` | `{ token }` — the FCM registration token | `{ registered: true }` | 20 / 15 min |
| `GET /v1/sbg/car/chats/{conversationId}` | — | `CarChatView` (below) | 60 / min |
| `POST /v1/sbg/car/chats/{conversationId}/reply` | `{ text }` — the dictated words | `{ sent: true, seq, at, via: 'car' }` | 20 / min |
| `POST /v1/sbg/car/chats/{conversationId}/read` | `{ seq }` — the newest `seq` the notification showed | `{ read: true, unread }` | 60 / min |

`CarChatView`: `{ conversationId, title: "FRT-7781 · Roses · Nairobi → Nakuru", code, label, from: "The poster",
lang, unread, lastSeq, canReply, closed?, messages: [{ seq, from, text, kind, at }] }` — the newest 10 unread, oldest
first. `text` is what to read aloud: the words; a quick reply already in the driver's language; for a voice message, a
photo, a price or a settlement a sentence ending "open the app when you stop" (never audio). `canReply: false` with
`closed` ("This conversation is closed.") when a reply would be refused. A chat that is not the driver's is 404.

Replies are refused as a typed message is: `400 FIELD_REQUIRED` (nothing said), `400 INVALID_INPUT` (over 1,000
characters), `403 FORBIDDEN` (closed or blocked; or 60 messages in the hour), `404 NOT_FOUND`, `429 RATE_LIMITED`.
There is no "reported" refusal in the chat: a reported message does not stop either side writing.

**The wake-up** (FCM HTTP v1, data only, `android.priority: HIGH`): `data = { kind: "chat", conversationId }` and
nothing else. The native part answers it with `GET /v1/sbg/car/chats/{conversationId}`.

**The server's settings (the owner's `.env`, never git):** `GLOS_FCM_SERVICE_ACCOUNT` — the service account key JSON
from Firebase (Project settings › Service accounts › Generate new private key), on one line, or base64 of it, or the
path of the file inside the server; `GLOS_FCM_PROJECT_ID` — optional, the service account names its project. Not set:
off, and a wake-up is only kept in the server's outbox. A sandbox (no `GLOS_ENV=production`) wakes no phone through
Firebase, as it texts nobody through Twilio; `GLOS_FCM_URL` is for a stand-in on that machine only.

## 4. What the owner sets up (accounts and keys only the owner holds)

1. **A Google Play developer account** — play.google.com/console, a one-time US$25, identity verified (an
   organisation needs a D-U-N-S number; a personal account works to start).
2. **A Firebase project** (free) with Cloud Messaging on; a service-account key for it put in the **server's .env**
   (never sent to Claude, never in git), plus the project's public Android settings (project id, app id, API key —
   these are not secret; they go in the build).
3. **The package name** — permanent once published. Proposed: `com.seebuyget.driver`.
4. **Play App Signing** — Play keeps the signing key; an upload key is made once and stored as GitHub secrets for the
   build. Play shows the signing key's SHA-256 fingerprint: it goes in `/.well-known/assetlinks.json`, which the site
   serves (Caddy) so Chrome opens the app full screen instead of with an address bar.
5. **Testing** — Play's internal testing track, and Android Auto's developer mode on the owner's phone (Android Auto
   settings → tap the version ten times → "Unknown sources").

## 5. The build, in slices

- **S1 — the server and the web side** (no account needed; Firebase is off until its key is in .env, as mail and texts
  are): car keys and their revocation paths; the wake-up sender (Firebase HTTP v1) behind configuration; the car
  routes (fetch unread, reply, read) for a car key only, with their limits; Settings › "Messages in the car" in the
  Driver app (shown only inside the Play app — the native part says so in the user agent or a launch parameter);
  privacy and help words. Tests over the wire.
- **S2 — the Android project** in `04_platform/android-driver/`: the Trusted Web Activity (androidbrowserhelper), the
  Firebase service, the notification and its two actions, the link activity, encrypted key storage; JVM unit tests.
  **Built only on GitHub** (a workflow on changes to that folder) — a Gradle build on the owner's machine is exactly the
  load that shuts it down.
- **S3 — on a phone and a car**: assetlinks served; an internal-testing release; the owner tries it in the car.
- **S4 — Google's review**: the car-quality checklist, the store listing, the privacy declaration (what goes through
  Firebase: a wake-up and a device token, no message words).

## 6. Risks, said plainly

- **Google's review decides.** A logistics app using the messaging category for chats between drivers and the people
  who post loads is what the category is for; anything that looks like notices dressed as messages risks rejection.
- **A second codebase.** Kotlin to keep up with Android's yearly changes; Google reviews every release.
- **Only Android.** iPhones have CarPlay, with its own entitlement Apple grants to few categories — not planned.
- **Spoken replies are rough.** Dictation in a noisy cab, in Swahili or Amharic, will mishear; the reply is read back
  before it is sent, and marked "sent from the car" so the other side reads it kindly.
