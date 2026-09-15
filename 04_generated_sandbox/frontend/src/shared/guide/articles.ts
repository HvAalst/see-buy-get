/**
 * HELP — the articles every app shows behind its Help link, and `help.html` (beside progress.html) shows as one page.
 *
 * One list, two readers. `guide.test.ts` fails when the page and this list disagree, so change an article here AND
 * on help.html in the same commit. English only for now, like the other long-form text; the apps' short strings are
 * translated, articles are not yet.
 */

export type GuideApp = 'agent' | 'mdp' | 'fleet' | 'driver' | 'vendor' | 'send' | 'home' | 'console';

export interface GuideArticle {
  /** Stable: it is the anchor on help.html. */
  id: string;
  /** The apps that show it. */
  apps: GuideApp[];
  title: string;
  summary: string;
  steps?: string[];
  notes?: string[];
}

export const GUIDE_APPS: Record<GuideApp, string> = {
  agent: "Shop app",
  mdp: "Hub app",
  fleet: "Fleet app",
  driver: "Driver app",
  vendor: "Store app",
  send: "Send app",
  home: "Front door",
  console: "Operator console"
};

export const ARTICLES: GuideArticle[] = [
  {
    id: "which-sign-in",
    apps: [
      "home"
    ],
    title: "Which app, and what you sign in with",
    summary: "Every app has its own sign-in, because the people using them hold different things.",
    steps: [
      "A shop or a hub: the email and password you signed up with.",
      "A fleet: your company code, then your own phone number and PIN.",
      "A driver: the phone number your fleet registered, and your PIN.",
      "A store: your store ID and signing secret.",
      "Sending or collecting a parcel: your phone number and a PIN you choose.",
      "Network staff: the email and password a colleague set up for you."
    ]
  },
  {
    id: "shop-sign-in",
    apps: [
      "agent",
      "mdp"
    ],
    title: "Signing in to a shop or a hub",
    summary: "Sign in with the email and password you chose when you signed up.",
    steps: [
      "Type your email and password, and tap Sign in.",
      "Forgot it? Tap “I forgot my password”. A reset code is sent to your email; type it with a new password.",
      "A sign-in lasts a working day. After that the app asks for your password again."
    ]
  },
  {
    id: "change-password",
    apps: [
      "agent",
      "mdp"
    ],
    title: "Changing your password",
    summary: "Change it whenever it may have been seen — you need the current one to do it.",
    steps: [
      "Shop app: Home, then Shop settings, then Password.",
      "Hub app: Home, then Change password at the bottom.",
      "Type your current password, then the new one twice. It needs at least 8 characters."
    ],
    notes: [
      "Every other phone or computer still signed in with the old password is signed out at once. The one you used stays signed in."
    ]
  },
  {
    id: "fleet-sign-in",
    apps: [
      "fleet"
    ],
    title: "Signing in to a fleet",
    summary: "Two steps: the company code says which fleet, and your own phone and PIN say who you are.",
    steps: [
      "Type the company code (it looks like FM-1A2B3C). The app shows the company name, so you know it is the right one.",
      "Type your phone number and your 4-digit PIN.",
      "Forgot the code? Tap “Forgot the code? Sign in with your phone”, type your phone and PIN, and pick your fleet from the list."
    ],
    notes: [
      "Five wrong PINs lock the PIN for a while. Anybody who manages the fleet can see the code in the app."
    ]
  },
  {
    id: "fleet-code",
    apps: [
      "fleet",
      "console"
    ],
    title: "The fleet code, and issuing a new one",
    summary: "The code only names the fleet. Issue a new one if it has been shared with people who should no longer have it.",
    steps: [
      "Fleet app: Dashboard, then Fleet sign-in code. Tap Show to read it.",
      "Tap “Issue a new code” and confirm. The old code stops working at once.",
      "Tell the other managers of your fleet the new code. Nobody is signed out: their phone and PIN still work."
    ],
    notes: [
      "The card says when the code was last changed, and suggests a new one once it is over 90 days old.",
      "Network staff can issue a new code from the operator console: Overview, then The fleets, then New code."
    ]
  },
  {
    id: "driver-sign-in",
    apps: [
      "driver"
    ],
    title: "Signing in as a driver",
    summary: "Use the phone number your fleet registered you with, and your 4-digit PIN. Your driver ID alone does not sign you in.",
    steps: [
      "Type your phone number and PIN, and tap Sign in.",
      "First time, or forgot your PIN? Tap “First time here, or forgot your PIN?”. We send a code to your phone; type it, then choose a PIN.",
      "The app says “This phone is not registered to a driver”? Your PIN is fine: ask your fleet manager which number they registered."
    ]
  },
  {
    id: "change-pin",
    apps: [
      "fleet",
      "driver",
      "send"
    ],
    title: "Changing your PIN",
    summary: "Your PIN is 4 digits. Change it with the current one — or, if you have forgotten it, with a code sent to your phone.",
    steps: [
      "Fleet app: Dashboard, then Change my PIN.",
      "Send app: Account, then Change your PIN.",
      "Driver app: tap “Not you? Sign out”, then “First time here, or forgot your PIN?”."
    ],
    notes: [
      "Changing your PIN signs out every other phone that PIN had opened, in every app."
    ]
  },
  {
    id: "store-sign-in",
    apps: [
      "vendor"
    ],
    title: "Signing in to a store",
    summary: "Sign in with your store ID and your signing secret. Both were shown when the store was created.",
    steps: [
      "Type the store ID (it starts with ven_) and the signing secret (it starts with whsec_).",
      "Keep the secret in a password manager. It cannot be shown again, and a new one can only be made with the current one — so a lost secret cannot be recovered yet."
    ]
  },
  {
    id: "store-secret",
    apps: [
      "vendor"
    ],
    title: "Rotating the signing secret",
    summary: "The secret signs you in and signs every status update we send your shop system. Rotate it whenever it may have been seen.",
    steps: [
      "My store, then Signing secret, then Rotate the secret.",
      "Type the current secret to confirm.",
      "The new secret is shown once. Save it before you close the sheet.",
      "Update your shop system: updates we send from now on are signed with the new secret."
    ],
    notes: [
      "The card says when the secret was last changed, and suggests rotating it once it is over 90 days old."
    ]
  },
  {
    id: "api-keys",
    apps: [
      "vendor"
    ],
    title: "Shipping API keys",
    summary: "A publishable key can sit in your web page. A secret key belongs on your server only, and is shown once.",
    steps: [
      "My store, then Shipping API keys, then New key.",
      "Choose publishable or secret, and test or live.",
      "Lost a secret key, or not sure who has it? Make a new one, switch to it, then revoke the old one."
    ],
    notes: [
      "Secret keys show how old they are, and suggest replacing one that is over 90 days old."
    ]
  },
  {
    id: "send-sign-in",
    apps: [
      "send",
      "home"
    ],
    title: "Signing in to send or collect",
    summary: "You do not need to sign in to get a price or track a parcel. To send, sign in with your phone and a PIN you choose.",
    steps: [
      "New here: type your phone number, type the code we send you, then choose a 4-digit PIN.",
      "Coming back: tap “I already have an account” and type your phone and PIN.",
      "Forgot your PIN? Sign in with a code again, and choose a new PIN."
    ]
  },
  {
    id: "console-staff",
    apps: [
      "console"
    ],
    title: "Staff sign-in",
    summary: "Everybody who works for the network has their own sign-in, so every decision carries a real name.",
    steps: [
      "Choose Network staff, then type the email and password a colleague gave you.",
      "Change that password straight away: Change password, at the top.",
      "Add a colleague: Overview, then Network staff, then Add a person. Their password is shown once — hand it over in person.",
      "Somebody leaving: Take away. Their open sessions end at once; their decisions keep their name."
    ]
  },
  {
    id: "console-setup-key",
    apps: [
      "console"
    ],
    title: "The setup key",
    summary: "The one shared operator key, for creating the first staff accounts and for scripts.",
    notes: [
      "It has full operator rights but cannot say who is holding it, so the console marks your name “name not verified”.",
      "Outside a sandbox it cannot take a decision that needs two people."
    ]
  },
  {
    id: "console-company",
    apps: [
      "console"
    ],
    title: "Signing in for a company",
    summary: "A company’s administrators sign in with an email and password created by whoever administers that company.",
    steps: [
      "Choose A company, then type your email and password.",
      "Change the password you were given: Change password, at the top.",
      "The company’s administrators are listed on its rates screen, where they can be added or taken away."
    ]
  },
  {
    id: "two-person",
    apps: [
      "console"
    ],
    title: "Decisions that need two people",
    summary: "Switching a country on and verifying a company’s documents each need a second, different person.",
    notes: [
      "The console compares the names your sign-ins carry, so both people must sign in as themselves."
    ]
  },
  {
    id: "message-shop",
    apps: [
      "send",
      "agent"
    ],
    title: "A word between a customer and the shop",
    summary: "Somebody collecting a parcel and the shop holding it can message each other about it, inside SeeBuyGet.",
    steps: [
      "Send app: My parcels, open the parcel, then “Message the shop”. Say when you are coming, or ask when they are open.",
      "Shop app: Hand over a parcel, then “Waiting to be collected”, then Message beside the parcel.",
      "The shop can only reach a customer who has signed in to the Send app with the phone number they gave the store. If there is nobody to reach, the app says so."
    ],
    notes: [
      "Only the two of you can read it, and nothing in it can be edited or deleted. The collection code is never sent in a message — it stays on the parcel in the Send app."
    ]
  },
  {
    id: "no-signal",
    apps: [
      "agent",
      "mdp",
      "fleet",
      "driver",
      "vendor",
      "send"
    ],
    title: "When there is no signal",
    summary: "The app keeps working on what it last knew, and records the parcels you move. Some things wait for a connection.",
    steps: [
      "Taking a parcel in, handing it to the bus, shelving it, moving a bag: recorded on the phone at once and sent when the signal returns. A line at the top counts what is still to send.",
      "What you see is what the app last loaded, and the line at the top says so, with the time.",
      "Your collection code stays on your phone once the parcel has appeared in My parcels — open the app once while you have signal.",
      "Signing in, paying, handing a parcel over at the counter and sending a message need a connection. The app says so plainly when it cannot do them.",
      "Drivers: ending your shift is recorded on the phone too. Starting one and taking an offer need a connection; an offer you could not see lapses after ten minutes and is not held against you. The fleet app shows when each vehicle was last heard from."
    ],
    notes: [
      "Do not clear the app’s data while something is still to send: the record of what you moved is on the phone until it has gone."
    ]
  },
  {
    id: "consignment-note",
    apps: [
      "agent",
      "driver",
      "fleet"
    ],
    title: "The consignment note (CMR)",
    summary: "Every load carries one document from posting to delivery, in the CMR layout: sender, consignee, carrier and vehicle, the goods, taking over and delivery. Across a border it is the CMR itself.",
    steps: [
      "Shop app: Freight, open the load, then “Consignment note”. Print or save it for your books.",
      "Driver app: Loads, then “Consignment note” under the load — show it at a weighbridge, a border or the receiver’s gate.",
      "Fleet app: Earnings, then “Consignment note” on any haul."
    ],
    notes: [
      "Every box is filled from a recorded act — posting, the load-safety check at pickup, the unload report at delivery. A box that says “not recorded” is not recorded; nothing is typed in by hand. The buyer of a store order is named as the buyer, never by phone number."
    ]
  },
  {
    id: "freight-delivery",
    apps: [
      "agent",
      "driver"
    ],
    title: "Delivering a load: who received it, and the photo",
    summary: "A load is delivered when somebody took it in. The driver records their name and a photo of the goods as put down; both go on the consignment note. Until the goods are on a truck, the shop can still withdraw the load.",
    steps: [
      "Driver app, at the gate: tick the unload list, type the name of the person who received the goods, take a photo of them where you put them down, and note anything the receiver said. That is box 24 of the consignment note.",
      "Driver app, at pickup: if something is already wrong with the goods as handed over — a torn sack, a short count, a wet pallet — write it in the reservations box. The note then shows the goods were like that before you took them over.",
      "Shop app: a delivered load shows who received it and when. Until pickup you can withdraw a load — open it, tap “Withdraw this load” and say why. A driver who had claimed it is told, and a charge you paid comes back. Once it is on a truck, talk to the driver instead.",
      "Driver app, when nobody is there: tap “I could not deliver”, say what happened at the door and record the attempt. The goods stay on your van, and the sender is told so they can ring the receiver or tell you where to take them.",
      "Shop app, when something is wrong with what arrived: open the load and tap “Report a problem with the goods” within seven days — damaged, short, or not received — with a photo if you have one. A network operator decides it and you are shown their reason. Money can only be awarded where the network billed the load; otherwise the decision says who was right and the carriage is yours and the carrier’s to settle."
    ],
    notes: [
      "Nobody signs on a screen: the driver records the name, and the photo is the proof. A delivered load cannot be withdrawn — a problem with the goods is a claim, not a cancellation."
    ]
  },
  {
    id: "papers-that-expire",
    apps: [
      "fleet",
      "driver",
      "console"
    ],
    title: "Papers that run out: insurance, inspection, licence",
    summary: "A vehicle’s insurance and inspection certificate and a driver’s licence each carry an expiry date. The day after that date passes, the vehicle or driver is off the road until the fleet office records the renewal. A paper with no date recorded switches nothing off — and nothing watches it for you either.",
    steps: [
      "Fleet app, Vehicles: record the policy number and the expiry date when you register a vehicle, or later with “Papers” under the vehicle. The same sheet is where you record a renewal — the new date is the whole of it.",
      "Fleet app, Drivers: “Licence” under a driver records the renewed licence and its new expiry. Only the fleet office can; the driver’s own word about their own licence is what the date is there to replace.",
      "Fleet app, Fleet: the Papers card lists what has lapsed and what runs out within 30 days, soonest first, and says how many papers are in date and how many have no date at all.",
      "Every six hours the network checks every fleet. A vehicle or driver already on a shift when a paper lapses has the shift ended and the driver told why, and the fleet’s contact address is emailed what is off the road and what is running out — once per paper, so a renewed paper starts a new clock and an ignored email is never repeated.",
      "Driver app: a licence running out is said on the start screen ahead of the day it stops you. A vehicle off the road is listed, marked, and refused at the scan with the paper named, so you know what to ask the office for.",
      "Operator console, Papers: a courier who rides without a fleet, and a vehicle no fleet owns, have no office to record a renewal — network staff record it there, and the same screen runs the six-hourly check by hand and shows when it last ran."
    ],
    notes: [
      "Nothing is written into a record as “grounded”: the date is the switch in both directions, so a renewal takes effect the moment it is recorded and there is nothing to unwind."
    ]
  },
  {
    id: "when-to-change",
    apps: [
      "agent",
      "mdp",
      "fleet",
      "driver",
      "vendor",
      "send",
      "home",
      "console"
    ],
    title: "When to change a password, PIN or key",
    summary: "We never make you change a password or PIN on a schedule — that only makes people pick weaker ones. Change one when it matters.",
    steps: [
      "Change it if somebody may have seen it, if you shared it, or if you lost a phone that was signed in.",
      "Secrets that machines use — a store’s signing secret, a fleet code, a secret API key — are worth changing every 90 days. The app reminds you."
    ],
    notes: [
      "Changing any of them signs out the other devices it had opened."
    ]
  }
];

/** The articles one app shows, in the order written. */
export function articlesFor(app: GuideApp): GuideArticle[] {
  return ARTICLES.filter((a) => a.apps.includes(app));
}
