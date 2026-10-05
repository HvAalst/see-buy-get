/**
 * HELP — the articles every app shows behind its Help link, and `help.html` (beside progress.html) shows as one page.
 *
 * One list, two readers. `guide.test.ts` fails when the page and this list disagree, so change an article here AND
 * on help.html in the same commit. English only for now, like the other long-form text; the apps' short strings are
 * translated, articles are not yet.
 */

export type GuideApp = 'agent' | 'mdp' | 'fleet' | 'driver' | 'vendor' | 'send' | 'home' | 'console' | 'business';

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
  console: "Operator console",
  business: "Business app"
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
      "A business — a shipper, importer, expeditor, clearing agent or yard: the Business app, with your own phone number and PIN.",
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
      "Five wrong PINs lock the PIN until you verify your phone by code and choose a new one. Anybody who manages the fleet can see the code in the app."
    ]
  },
  {
    id: "fleet-code",
    apps: [
      "fleet",
      "console"
    ],
    title: "The fleet code, and issuing a new one",
    summary: "The code only names the fleet at sign-in. It never adds anyone to your fleet. Issue a new one if it has been shared with people who should no longer have it.",
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
    id: "fleet-roster",
    apps: [
      "fleet"
    ],
    title: "Taking a driver on, and taking one off",
    summary: "You add a new driver yourself. A driver who is already on SeeBuyGet joins only when you offer them a place and they say yes.",
    steps: [
      "New to SeeBuyGet: Drivers, then Add a driver. Type their details and the phone number they will sign in with.",
      "Already on SeeBuyGet: Drivers, then “Offer a place to a driver already on SeeBuyGet”. Type the phone number they sign in with and tap Offer a place.",
      "They see the offer in their driver app and say yes or no. Until they say yes, you see only the number you typed.",
      "To take a driver off: Drivers, then “Take off fleet” beside their name. Choose why; they are shown your reason."
    ],
    notes: [
      "An offer stays open for 7 days. You can take it back while it is open.",
      "A driver carrying one of your loads, or rostered on one of your runs, cannot be taken off until the load is delivered or handed back and somebody else is on the run.",
      "A driver you take off keeps their own trips, papers and rating. Every trip they did for you stays in your records.",
      "Only your own drivers can start a shift on your vehicles.",
      "You choose a driver’s vehicle under Shifts; it goes to the top of their list and they are told. The driver starts the shift themselves, with their PIN. Nobody starts a shift for somebody else."
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
      "First time, or forgot your PIN? Tap “First time here, or forgot your PIN?”. We send a code to your phone; type it, then choose a PIN. The first time, you also add a recovery email.",
      "The app says “This phone is not registered to a driver”? Your PIN is fine: ask your fleet manager which number they registered."
    ],
    notes: [
      "Five wrong PINs lock the PIN. Only a code sent to your phone opens it again, and you are told when it happens.",
      "Signing in on another phone signs this one out. If you are signed out and it was not you, choose a new PIN.",
      "Starting a shift asks for your PIN again, so nobody can start one on a phone you left signed in."
    ]
  },
  {
    id: "driver-fleet",
    apps: [
      "driver"
    ],
    title: "Your fleet: joining one, and being taken off",
    summary: "A fleet takes you on by offering you a place. You say yes or no in the app. No code is typed anywhere.",
    steps: [
      "Give the fleet office the phone number you sign in with.",
      "When they offer you a place, it shows on your home screen, and under your picture, then Your fleet.",
      "Tap “Drive for” and the fleet’s name to say yes, or “No thanks”. Only you can answer, from your own sign-in."
    ],
    notes: [
      "You cannot say yes while you are on a shift, carrying a load, or rostered on a run of your current fleet. The app says what to finish first.",
      "Your licence, trips and rating come with you. The fleet you leave keeps the trips you did for it.",
      "If a fleet takes you off, the app says who and why. You cannot start a shift until another fleet offers you a place."
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
      "Driver and Fleet app: tap your picture, then Settings, then Change your PIN.",
      "Send app: Account, then Settings, then Change your PIN.",
      "Forgot it? On the sign-in screen tap the forgot-PIN link. We send a code to your phone and you choose a new PIN."
    ],
    notes: [
      "Changing your PIN signs out every other phone that PIN had opened, in every app.",
      "A PIN that is easy to guess is refused: one digit four times, a run like 1234, or pairs like 1212."
    ]
  },
  {
    id: "account-recovery",
    apps: [
      "fleet",
      "driver",
      "send"
    ],
    title: "Your recovery email, a new phone number, and getting back in",
    summary: "Your account is your phone number. Settings is where you keep your recovery email and move the account to a new number. “Trouble signing in?” is the way back when the number is gone.",
    steps: [
      "Open Settings. Driver and Fleet app: tap your picture, then Settings. Send app: Account, then Settings.",
      "Recovery email: type the address and tap “Send a code to this address”. Type the code from the email, then your PIN.",
      "New phone number, and you know your PIN: Settings, then Phone number. Type the new number, type the code we text to it, then your PIN. You are signed out everywhere; sign in with the new number and the same PIN.",
      "Lost your number and forgot your PIN: on the sign-in screen tap “Trouble signing in?”, then “I no longer have my number”. A code goes to your recovery email. Type your new number and choose a new PIN.",
      "Somebody changed your number and it was not you: within 24 hours tap “Trouble signing in?”, then “Undo a number change”. Use the old number with the PIN as it was, or a code to your email."
    ],
    notes: [
      "Lost only the handset? Nothing is lost. Sign in from any phone with the same number and PIN.",
      "A first PIN cannot be chosen without a recovery email. We write to it when your PIN is locked and when your phone number changes.",
      "Drivers and shops are also asked for the national ID number they registered with when they get back in by email.",
      "After a number change the old number is kept for you for 24 hours. After that it is free for a new person.",
      "Undoing a number change locks the PIN. Use the forgot-PIN link on the sign-in screen to choose a new one."
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
      "Open the console at the address staff were given — it is not linked from the public site. Choose Network staff and type your email and password.",
      "Then the 6-digit code from your authenticator app. The first time, the console shows a QR code to scan with the app; the first code turns two-step sign-in on.",
      "Change the password you were given straight away: your name at the top, then Settings.",
      "Add a colleague: Overview, then Network staff, then Add a person. Their password is shown once — hand it over in person. Somebody leaving: Take away. Their open sessions end at once; their decisions keep their name."
    ],
    notes: [
      "Lost your phone? Two other members of staff reset your two-step sign-in: Overview, then Network staff, then Reset two-step. One asks, a second approves; you are signed out and set it up again at your next sign-in.",
      "The console may only open from the networks SeeBuyGet staff work on."
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
      "Change the password you were given: your name at the top, then Settings.",
      "The company’s administrators are listed on its rates screen, where they can be added or taken away."
    ],
    notes: [
      "Importers, clearing agents and other customers do not sign in here: they use the Business app."
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
    id: "business-sign-in",
    apps: [
      "business",
      "home"
    ],
    title: "The Business app: signing in and setting up",
    summary: "Everyone in a business signs in as themselves, with their own phone number and PIN — the same PIN as in any SeeBuyGet app.",
    steps: [
      "Open the Business app from the front page: Sign in, then A business.",
      "Type your phone number and PIN. New here, or forgot your PIN? We send a code to your phone first.",
      "The first time, set up your business: its registered name, country, registration number and what it does. You become its owner.",
      "In more than one business? Pick one. Switch business, in the menu under your name, takes you back to the list."
    ]
  },
  {
    id: "business-people",
    apps: [
      "business"
    ],
    title: "The people in a business",
    summary: "An owner adds people by the phone number they sign in with. Nothing opens for them until they sign in themselves and say yes.",
    steps: [
      "People, then Add someone: their phone number, their name, and what they may do.",
      "Owner: everything, including the people. Booker: the day-to-day work. Finance: the same, and the person your payments will be connected through. Viewer: sees everything, changes nothing.",
      "To take somebody out, press Remove on their row. It holds from their next click.",
      "Leave takes you out of a business yourself. The only owner cannot leave until somebody else is an owner."
    ]
  },
  {
    id: "business-check",
    apps: [
      "business",
      "console"
    ],
    title: "SeeBuyGet checking a business",
    summary: "A business works from the moment it is set up. It is shown to others — a public page, a place in the agent finder — once two members of SeeBuyGet staff have checked it.",
    steps: [
      "Business app, Overview: add the registration certificate and the ID of the person speaking for the business, then Ask SeeBuyGet to check us.",
      "Operator console, Businesses: open the business, open each paper and verify it, then approve. A second, different member of staff gives the second approval.",
      "Refused? The business reads the reason in its app and by email, puts it right, and asks again."
    ],
    notes: [
      "Changing the business’s name or registration number puts it back to not checked: those are what was checked."
    ]
  },
  {
    id: "business-loads",
    apps: [
      "business"
    ],
    title: "Posting a load as a business",
    summary: "Post a load for carriers on the open board, agree a price, and follow it to the door. You pay the carrier yourself.",
    steps: [
      "Loads, then Post a load. Choose where it is collected and where it goes from your saved places — Save a new place adds one.",
      "Say what it is, its weight, how it is packed and what kind of goods. Carriers read exactly this, and it goes on the consignment note.",
      "Choose how the price is set: carriers name their price and you accept one, or the first carrier at the board price takes it.",
      "Open the load to see the prices offered, who is carrying it, the tracking link to share, and the consignment note."
    ],
    notes: [
      "SeeBuyGet does not take, hold or send the money for your loads. You pay the carrier directly, or through your own payment system."
    ]
  },
  {
    id: "business-runs",
    apps: [
      "business"
    ],
    title: "Booking space on a carrier’s run",
    summary: "Trucks that are leaving anyway, with room for your goods. The price is the carrier’s own, and you pay them directly.",
    steps: [
      "Space on runs lists the runs with room: where they go, when they leave, the carrier’s rate, and how they want to be paid.",
      "Open one, say what you are sending and its weight, and ask what it would cost. Book it for that price.",
      "Your bookings are listed above the runs. Open one for its consignment note, its tracking link, or to give the space back.",
      "The tracking link opens a page anybody can read without an account: booked, on the road from the moment the carrier marks the run gone, then delivered and to whom. Send it to whoever is receiving the goods. It shows no price, and nobody else’s goods on the same truck."
    ]
  },
  {
    id: "business-contracts",
    apps: [
      "business"
    ],
    title: "Ordering with a carrier you have a contract with",
    summary: "If a fleet carries for you under a contract, your loads can go straight to that fleet instead of onto the open board.",
    steps: [
      "Your carrier records the contract in their fleet app and sends you a code. An owner opens Carriers, pastes it and taps Link it. The code works once.",
      "When you post a load, choose that carrier under Who carries it, and the day it must arrive. Tomorrow is filled in for you.",
      "The load shows as With your carrier until they put it on a truck. Its tracking link and consignment note work the same as any other load."
    ],
    notes: [
      "The price and how you pay are on your own contract with the carrier. SeeBuyGet keeps the order, the note and the tracking — never the money.",
      "An owner can end a contract under Carriers. Loads already ordered are still delivered."
    ]
  },
  {
    id: "business-clients",
    apps: [
      "business"
    ],
    title: "Sending for your clients, as their agent",
    summary: "An expeditor keeps a book of the businesses it sends for. A load or a booking made for one of them names the client as the sender, and you as their agent.",
    steps: [
      "Clients, then Add a client: their registered name, country, address and who to ask for.",
      "When you post a load or book space, choose the client under Sent for. They become the sender on the consignment note; you are named as the agent who booked it.",
      "Open a client to see everything sent for them — loads and space on runs alike — with each one’s tracking link to hand them. It needs no account.",
      "A client you no longer work for can be archived. What was sent for them keeps naming them."
    ],
    notes: [
      "Several clients’ goods on one run are several bookings on that run, one for each client — each with its own consignment note."
    ]
  },
  {
    id: "quotations",
    apps: [
      "business",
      "console"
    ],
    title: "Quotations, proforma invoices, and saying it is paid",
    summary: "Wherever a price lives — a clearing agent’s fee, a carrier’s price — SeeBuyGet keeps the quotation, the proforma invoice and whether it is paid, in one place. It never handles the money.",
    steps: [
      "A clearing agent quotes their fee on the import, with their own quotation number. The importer agrees it.",
      "For a load or a booking, press Keep track of paying the carrier: the agreed price is filled in, and you can change it to what the carrier invoiced.",
      "Either side can attach the proforma invoice. It is kept as it was handed over.",
      "When it is paid, press Confirm it is paid and add the payment’s reference if you have one. Set back to open undoes it."
    ],
    notes: [
      "Every change is kept with the name of whoever made it, so “who said this was paid” can always be answered."
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
      "Nobody signs on a screen: the driver records the name, and the photo is the proof. A delivered load cannot be withdrawn — a problem with the goods is a claim, not a cancellation.",
      "When a claim is upheld the carrier bears it, up to what they were paid for the haul and never more: the amount taken back shows on that load in the driver’s and the fleet’s earnings."
    ]
  },
  {
    id: "sender-instructions",
    apps: [
      "agent",
      "driver",
      "fleet"
    ],
    title: "Instructions for the driver: box 13 of the note",
    summary: "Every load has a box for what the sender wants the driver to know at the door — the consignment note calls it box 13. A free note, a contact the driver can call, and a delivery window. It goes on the note and to the driver who takes the load.",
    steps: [
      "Shop app, at the counter: when a load is booked as freight, take down the contact at delivery and their phone, when it should be delivered (“before 10:00”, “second trip”), and anything else the driver needs (“gate on the north side”). All optional.",
      "Shop app, Freight you posted: open the load to read or change the instructions. Until the goods are taken over you can rewrite them. Once the load is on the road you can only add an instruction; it is added with the time, and what the driver was already told stays on the note.",
      "Driver app, My loads: the instructions are on the load card and again at the gate. The phone is a button — tap to call.",
      "Fleet app, Dispatch: the delivery window shows on the load, so the office can choose who to put it on. The contact does not; only the driver holding the load sees a phone number."
    ],
    notes: [
      "Instructions are for the door, not for money — the price is agreed on the load itself. The tracking link never shows them, and never the contact’s phone."
    ]
  },
  {
    id: "freight-tracking",
    apps: [
      "agent",
      "send"
    ],
    title: "Where is my load: the tracking link, and rating the driver",
    summary: "Every load has a tracking link — the same code the consignment note carries as a QR. Whoever holds it sees where the load is, who is carrying it and who signed for it, and nothing else. After delivery the shop that posted the load rates the driver.",
    steps: [
      "Shop app, Freight you posted: open the load and tap “Tracking link”. Share it, or copy it into a message to whoever is waiting for the goods. They need no account.",
      "Send app, Track: type the code, or open the link. A load climbs its own ladder — waiting for a carrier, booked, on the road, delivered — with the carrier as they will be at the door, any door nobody answered, and who signed.",
      "Shop app, once delivered: tap “Rate the driver”. Stars out of five, and tags for what went wrong if anything. It counts toward the driver’s rating like a shop’s rating at the counter, one verdict per load, and you can change it within 30 days."
    ],
    notes: [
      "The link shows no phone number, no price and no reasons — a withdrawn load says when, never why. What is between the sender and the carrier stays there."
    ]
  },
  {
    id: "manager-dispatch",
    apps: [
      "fleet",
      "driver"
    ],
    title: "Dispatch: the office puts a load on a driver",
    summary: "A load used to reach a fleet’s driver in two ways only: the driver claimed it, or the network offered it. Now the fleet office can put one on a driver on shift. The office sees the market exactly as that driver would — priced against their vehicle, judged from where they are, every reason it cannot be taken marked — so it can never assign what the driver could not have claimed.",
    steps: [
      "Fleet app, Fleet → Dispatch, or “Find a load” beside a driver on the Shifts tab: choose the driver, choose how far from where they are to look, and read the market for them. What they would earn is their vehicle’s own rate.",
      "Tap “Put on <name>”. The price is locked at that moment, the load goes on the driver’s list, they are told, and the office’s name is recorded on the load. A load posted for negotiation cannot be assigned — the driver can send the shipper a price from their own board.",
      "Driver app, My loads: a load the office put on you says so, and by whom. It is collected, carried and delivered exactly like one you claimed, and you are paid the same way."
    ],
    notes: [
      "A driver has to be on a shift to be given a load, because a load goes on a vehicle and the price is that vehicle’s. What the driver could not take — too heavy, the wrong body, a road that will not carry it — the office cannot force either."
    ]
  },
  {
    id: "fleet-orders",
    apps: [
      "fleet"
    ],
    title: "Orders under a contract, and planning the day they must arrive",
    summary: "A shipper you have a contract with sends its orders straight to you. They are on no board and no other carrier sees them; your office puts each one on a truck.",
    steps: [
      "Orders, then Record a contract: who you carry for, and the contract number. No price — what you charge them stays on your own contract.",
      "If the shipper has a business on SeeBuyGet, tap Send them a link code and pass the code on. An owner of their business enters it once, and from then on they order with you directly. If they are not, upload their orders yourself as a sheet.",
      "Orders opens on tomorrow: how many orders, how heavy, and how many still have no truck. Choose another day at the top. Anything from an earlier day that has not been delivered stays in sight under Behind.",
      "Open an order to see where it is collected, where it goes and the day it must arrive. While a driver is on a shift you can put it on their truck there and then."
    ],
    notes: [
      "An order is Late when the day it had to arrive has gone by and it has not been delivered. That is read from the order itself, never estimated.",
      "Either side can end a contract. That stops new orders; the ones already placed are still yours to deliver."
    ]
  },
  {
    id: "fleet-order-sheet",
    apps: [
      "fleet"
    ],
    title: "Uploading a sheet of orders",
    summary: "When a shipper sends you its orders as a spreadsheet, upload the sheet under their contract. It is checked line by line before anything is added.",
    steps: [
      "Orders, then Upload orders beside the contract. Say where the goods are collected: type the place and find it on the map. It is remembered for next time.",
      "Choose the sheet saved as CSV, or copy the cells in the spreadsheet and paste them. The first line names the columns: an order number, the goods, the weight, where to deliver and the date. Download a template to send them shows the exact form.",
      "Tap Check the sheet. You see how many orders are ready, how many are already here, and each line with a problem, by its line number and in words.",
      "Tap Add orders. The lines that are right become orders; the others are left out. Put them right and upload the same sheet again — an order number that is already here is never added twice.",
      "An address the map does not know is added without a point and marked in the queue. Open it and place it on the map, or it cannot be planned."
    ],
    notes: [
      "Dates are read as 2026-10-06 or day first, 06/10/2026. Weights may be 4000, 4,000 kg or 1.5 t. An Excel file itself is not read: save it as CSV, or paste the cells.",
      "Your office can withdraw an order it uploaded, with a reason. An order the shipper placed themselves is theirs to withdraw."
    ]
  },
  {
    id: "fleet-plan",
    apps: [
      "fleet"
    ],
    title: "Planning a day: which truck takes which orders",
    summary: "The app works out a plan for a day’s orders on your own trucks, and tells you how many trucks short you are. Best read on a laptop.",
    steps: [
      "Orders, choose the day, then Plan this day. The first line is the answer: how many of the day’s orders are on a truck, and how many more trucks you would need for the rest.",
      "Under it, what does not fit, grouped by why: an address not on the map (pin it and plan again), no room left in the day, a free truck with no driver, goods no truck of yours can handle, or an order heavier than your largest truck.",
      "Then each truck’s day, trip after trip in the order it is driven. A truck that has unloaded goes on to its next collection from where it is, not from the depot.",
      "Change the day opens your settings: when trucks leave, the longest day, the speed on the road, the minutes to load and to hand over, and which vehicles go out. Change one and the plan is worked out again.",
      "Accept this plan when it is right. Each order then shows its truck, its trip and about when it arrives. Opening the plan later shows it as accepted; Plan the day again works out a new one, which replaces it only when you accept that.",
      "On the day itself the plan goes out by itself, a trip at a time: a truck gets its first trip when its driver starts a shift in it, and the next when the last order of that trip is delivered. Send the next trips out now does the same by hand, and says what each truck is doing."
    ],
    notes: [
      "Every time on the plan is an estimate: distance at one speed, plus fixed minutes at each stop. Distances are estimates too — there is no road routing yet.",
      "A truck is only ever given one trip at a time — what it can carry at once. Every order goes on with the same checks as any load (room, equipment, the driver’s hours). One that is refused stays in the queue with the reason on it.",
      "The plan never loads a truck past what it carries, never makes a day longer than you set (13 hours at most), and sends out no more vehicles than you have drivers."
    ]
  },
  {
    id: "fleet-partners",
    apps: [
      "fleet"
    ],
    title: "When you cannot carry it: partner fleets, then the open board",
    summary: "Orders your own trucks cannot take go to the fleets you work with first. What no partner takes can go on the open board.",
    steps: [
      "Orders, then Partners. Name a fleet you hand work to and you are shown a code once. Send it to their office; they enter it under their own Partners. From then on you can offer them orders. Either of you can end it.",
      "To offer one order, open it and tap Offer it to your partners. To offer everything a plan left out, tap Offer them to your partners on the plan. All your partners are asked at once; the first to take an order carries it.",
      "A partner sees what it needs to decide: what, from where to where, how heavy, for which day. It does not see whose customer it is until it takes the order.",
      "An order on offer is not in your own plan and cannot go on your own trucks. Take the offer back to carry it yourself.",
      "What no partner takes: open the order and tap Put it on the open board. Any checked carrier can take it at the board’s price, and you pay them yourself. Take it back off the board while nobody has it.",
      "Orders a partner offers YOU are at the top of Orders. Take one and it is yours to plan and carry; leave it and it goes to their other partners. If you took one and cannot carry it after all, give it back with a reason — until it is on one of your trucks."
    ],
    notes: [
      "You stay the carrier your shipper ordered from. The consignment note names whoever actually carried the goods.",
      "You are told when a partner takes an order, when no partner took it, and when one gives it back and why. A partner is told when you offer and when you take an offer back.",
      "The price between you and a partner, or a carrier from the board, is yours to agree and pay. SeeBuyGet does not handle it."
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
    summary: "A vehicle’s insurance and inspection certificate and a driver’s licence each carry an expiry date. The day after that date passes, the vehicle or driver is off the road until the renewal is recorded — by the fleet office, or for a courier without a fleet, by network staff from the card the courier sends. A paper with no date recorded switches nothing off — and nothing watches it for you either.",
    steps: [
      "Fleet app, Vehicles: record the policy number and the expiry date when you register a vehicle, or later with “Papers” under the vehicle. The same sheet is where you record a renewal — the new date is the whole of it.",
      "Fleet app, Drivers: “Licence” under a driver records the renewed licence and its new expiry. Only the fleet office can; the driver’s own word about their own licence is what the date is there to replace.",
      "Fleet app, Fleet: the Papers card lists what has lapsed and what runs out within 30 days, soonest first, and says how many papers are in date and how many have no date at all.",
      "Every six hours the network checks every fleet. A vehicle or driver already on a shift when a paper lapses has the shift ended and the driver told why, and the fleet’s contact address is emailed what is off the road and what is running out — once per paper, so a renewed paper starts a new clock and an ignored email is never repeated.",
      "Driver app: a licence running out is said on the start screen ahead of the day it stops you. A vehicle off the road is listed, marked, and refused at the scan with the paper named, so you know what to ask the office for.",
      "Driver app, riding without a fleet: the same screen asks for a photo of the renewed card and the date you read off it. Sending it changes nothing yet — network staff read the same photo and record the date, or tell you why they could not, and you are told either way.",
      "Operator console, Papers: couriers without a fleet are a list of people. A card somebody sent comes first; open it and the photo is shown at a readable size beside the date field. Record the date you read — a date that differs from theirs is pointed out before it is saved — or refuse the card with a reason the courier is shown. The same sheet gives their name and phone from the identity vault, one recorded look at a time. Vehicles no fleet owns are recorded here too, and the screen runs the six-hourly check by hand and shows when it last ran."
    ],
    notes: [
      "Nothing is written into a record as “grounded”: the date is the switch in both directions, so a renewal takes effect the moment it is recorded and there is nothing to unwind."
    ]
  },
  {
    id: "hand-back",
    apps: [
      "driver",
      "agent",
      "fleet"
    ],
    title: "Handing a load back before pickup",
    summary: "The office can put a load on a driver, so a driver must be able to say no — and a driver who claimed a load can change their mind. Until the goods are on the vehicle a load can be handed back: it goes back on the market as if untouched, the sender’s charge comes back, and the reason is on the record.",
    steps: [
      "Driver app, My loads: open the load as if to collect it and tap “I cannot take this load”. Say why — a breakdown, a road, a change of plan — and hand it back. It leaves your list.",
      "Shop app, Freight you posted: the load shows who handed it back, when and why, and is on the market again. Any charge for it has come back. Nothing has moved.",
      "Fleet app: the office that put the load on the driver is told too, with the reason, and can put it on somebody else from Dispatch.",
      "Once the goods are on the vehicle this is no longer the way out: a load that has been taken over is delivered, or the sender is asked to withdraw it."
    ],
    notes: [
      "Every hand-back stays on the load’s record with the driver’s reason — it is not a rating, and it is not hidden either."
    ]
  },
  {
    id: "hours-of-service",
    apps: [
      "driver",
      "fleet"
    ],
    title: "Hours: the shift limit, and the rest between shifts",
    summary: "A shift has a limit — 13 hours — after which no new load is offered, shown as takeable or put on a driver, though what is already aboard is delivered. After a real working day of four hours or more, the next shift waits for 9 hours of rest.",
    steps: [
      "Driver app, Home: the clock on the shift shows the hours on duty against the limit. Past it, the board marks every load, no offer comes, and the start screen says so plainly.",
      "Driver app, starting a shift too soon after a working day: the start is refused, and the refusal says how many hours since the last shift ended and how many are needed. A coupling of a few minutes — a wrong scan, a short move — owes no rest.",
      "Fleet app, Dashboard and Shifts: a driver over the limit is marked. Dispatch will not put a load on them; end the shift and let them rest."
    ],
    notes: [
      "The limits are the network’s, between the EU’s daily driving limit and its reduced daily rest, and they are not a claim about any country’s law. Where a jurisdiction sets its own, that becomes the limit."
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
