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
      "A store: the email and password you created the store with.",
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
      "Five wrong passwords lock your sign-in for 15 minutes, and for longer each time it happens again: an hour, six hours, then a day. While it is locked nobody gets in, not even with the right password. You get an email saying so. “I forgot my password” opens it at once: the code comes to your email, so only you can use it.",
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
      "Type your current password, then the new one twice. It needs at least 8 characters, and cannot be one that is easy to guess: a common word with a number on the end, your own name or email address, only digits, or a run like 12345678."
    ],
    notes: [
      "Every other phone or computer still signed in with the old password is signed out at once. The one you used stays signed in.",
      "A wrong current password here counts like a wrong one at sign-in: five lock the account for a while."
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
      "Type your phone number and your 5-digit PIN.",
      "A phone or browser you have not signed in on before asks for a code first: we send it to your number, you type it once, and from then on your PIN works there. Your PIN is not changed by it.",
      "Forgot the code? Tap “Forgot the code? Sign in with your phone”, type your phone and PIN, and pick your fleet from the list."
    ],
    notes: [
      "Five wrong PINs lock the PIN until you verify your phone by code and choose a new one. Anybody who manages the fleet can see the code in the app.",
      "Your PIN opens your account only on a phone or browser that has shown it holds your number. Nobody can try your PIN from anywhere else."
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
    summary: "Use the phone number your fleet registered you with, and your 5-digit PIN. Your driver ID alone does not sign you in.",
    steps: [
      "Type your phone number and PIN, and tap Sign in.",
      "A phone or browser you have not signed in on before asks for a code first: we send it to your number, you type it once, and from then on your PIN works there. Your PIN is not changed by it.",
      "First time, or forgot your PIN? Tap “First time here, or forgot your PIN?”. We send a code to your phone; type it, then choose a PIN. The first time, you also add a recovery email.",
      "The app says “This phone is not registered to a driver”? Your PIN is fine: ask your fleet manager which number they registered."
    ],
    notes: [
      "Five wrong PINs lock the PIN. Only a code sent to your phone opens it again, and you are told when it happens.",
      "Signing in on another phone signs this one out. If you are signed out and it was not you, choose a new PIN.",
      "Starting a shift asks for your PIN again, so nobody can start one on a phone you left signed in.",
      "Your PIN opens your account only on a phone or browser that has shown it holds your number. Nobody can try your PIN from anywhere else.",
      "Replacing a forgotten PIN on a phone or browser you have not signed in on before asks for two codes: the one to your number, and one to the recovery email on your account. Type that email address and we send it a code. On a phone you have signed in on before, the code to your number is enough.",
      "If the app says it could not send the code, nothing is wrong with your number and nothing was counted against you. Wait a little and ask for the code again."
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
    summary: "Your PIN is 5 digits. Change it with the current one — or, if you have forgotten it, with a code sent to your phone.",
    steps: [
      "Driver and Fleet app: tap your picture, then Settings, then Change your PIN.",
      "Send app: Account, then Settings, then Change your PIN.",
      "Forgot it? On the sign-in screen tap the forgot-PIN link. We send a code to your phone and you choose a new PIN."
    ],
    notes: [
      "Changing your PIN signs out every other phone that PIN had opened, in every app.",
      "A PIN that is easy to guess is refused: mostly one digit, a run like 12345 or 13579, or a pattern like 12312.",
      "A PIN is five digits, not four, so that it is not the same PIN as the one for your mobile money or your bank card. Do not use that one with a digit added.",
      "A PIN replaced with a code — forgotten, or locked — works on the phone or browser you did it on. Every other one asks for a code again.",
      "Replacing a forgotten PIN on a phone or browser you have not signed in on before asks for two codes: the one to your number, and one to the recovery email on your account. Type that email address and we send it a code. On a phone you have signed in on before, the code to your number is enough.",
      "We write to your recovery email, and tell you in the app, whenever your PIN is replaced or starts working on a new phone or browser. If it was not you, replace your PIN straight away: that shuts out every other phone and browser."
    ]
  },
  {
    id: "who-you-contract-with",
    apps: [
      "agent",
      "mdp",
      "fleet",
      "driver",
      "vendor",
      "business"
    ],
    title: "Who you contract with, and its licences",
    summary: "Settings shows the SeeBuyGet company you contract with and the licences and insurance it trades on, each with its number. If one is not right, you can say so.",
    steps: [
      "Open Settings, then “Who you contract with”. Shop, Hub, Driver, Fleet and Store app: tap your picture, then Settings. Business app: Settings.",
      "Each licence and insurance policy shows what it is, its number, who issued it and until when it is good. Check the number with whoever issued it.",
      "If one is not right, tap “This is not right”. Choose what is wrong, say it in your own words, and attach what shows it: a screenshot of the issuer’s register, or a photo.",
      "Tap “Send the report”. Under the paper you will see that you reported it, and later what was decided and why."
    ],
    notes: [
      "Nothing changes by reporting. The paper keeps counting. The company is told what you said, never who said it, and has seven days to answer. Then SeeBuyGet staff decide: one of them can dismiss a report, and striking a paper takes two.",
      "You see licences and insurance only. A company’s bank account, the people who may sign for it and the papers themselves are not shown.",
      "The row is not there where no SeeBuyGet company contracts with you in your country."
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
      "Lost only the handset? Nothing is lost. Put your number in the new phone and sign in with the same number and PIN: the new phone asks for a code to your number once, and then your PIN works on it.",
      "A first PIN cannot be chosen without a recovery email. We write to it when your PIN is locked and when your phone number changes.",
      "Drivers and shops are also asked for the national ID number they registered with when they get back in by email.",
      "After a number change the old number is kept for you for 24 hours. After that it is free for a new person.",
      "Undoing a number change locks the PIN. Use the forgot-PIN link on the sign-in screen to choose a new one.",
      "If email to your recovery address comes back undelivered, Settings says so under Recovery email, and we stop writing to that address. To keep the same address, open Recovery email, enter it, send the code and type in the code you receive: that proves it works again. Or enter another address.",
      "No number, no PIN and no recovery email you can read? Two members of SeeBuyGet staff can move your account. On the sign-in screen choose Trouble signing in, then Ask SeeBuyGet staff to move my account. Enter the number your account is on, confirm your new number with the code sent to it, and write down the reference you are given. Then speak to staff and give them the reference: they check who you are.",
      "To see what became of it, choose Trouble signing in, then I already asked staff, and enter your reference. When it says your account was moved, sign in with the new number: choose First time here, or forgot your PIN, enter the code, and choose a new PIN. A request waits two weeks, then lapses.",
      "If somebody asks staff to move YOUR account, you are told at once, in the app and by email, and Settings shows it with a button: It was not me: stop it. Signing in with your PIN stops it too. Then change your PIN. If an account is moved all the same, it can be undone for 24 hours with the old number and the PIN as it was.",
      "Could not register as a driver or a shop because your national ID is already registered? Check the number first: one wrong digit is the usual reason. If it is right, somebody else is using your number. On any sign-in screen choose Trouble signing in, then Somebody else registered with my national ID. Confirm your phone number, and you are given a reference.",
      "Write the reference on paper. Take three photographs: yourself holding your ID card under your chin with the paper beside it, then the front of the card close up, then the back. Somebody else may take them for you. Look at each one before you send it: if you cannot read the number, staff cannot either. Only the two members of staff who decide see them, and they are deleted 30 days after the decision.",
      "If somebody says the ID on YOUR registration is theirs, you are told in the app and by email, and Settings shows it. You have a week. Either send the same three photographs with your own reference, or, if the number on your record was simply mistyped, put the right one there: that ends it at once and nothing else changes for you.",
      "Two members of staff decide from the photographs. If the ID goes to the other person, your account is not removed: your driver or shop registration is held. You finish what you have in hand and start nothing new until you put the number of your own ID card on record, in Settings. If you do not accept the decision, you have two weeks to choose a day to come in, from the days the office for your country receives visitors. Where the office gives each visitor an hour, you choose the hour too; an hour that is full is not offered. You are given a ticket that says where, when and what to bring.",
      "The day before an appointment you are reminded, in the app and by email: when, where, and what to bring. Bring your ID card itself, not a copy; the phone you use with SeeBuyGet; your reference; and a second document in your name if you have one. If you have no SeeBuyGet account, no reminder can reach you: write the day down.",
      "Your parcels belong to your account, not to your phone number. When your account moves to a new number, every parcel sent to or from the old number so far comes with it, with its collection code. For seven days after the move a parcel sent to the old number still reaches you, and nobody else can open an account on that number.",
      "Somebody who signs up with a number another account used to have sees none of that account’s parcels, orders or invitations: only what is sent to the number from then on.",
      "In those seven days, give your new number to the people and the stores that send to you. When they have it, open Settings and choose “Block my old number”, with your PIN: from then a parcel sent to it is no longer yours. We remind you once a day. If you do nothing, the old number is let go after seven days. It cannot be blocked in the first 24 hours, while the change can still be undone.",
      "If your account was moved without your PIN, by a code to your email or by SeeBuyGet staff, the collection codes of your parcels are changed and are hidden for 24 hours after the move. The parcel screen says from when the code shows. The free collection time of a waiting parcel does not run out in those hours.",
      "For 24 hours after any number change you cannot give a parcel up or name somebody else to collect it: those two cannot be taken back. When a number change is undone, the collection codes of your parcels are changed, so whoever had the account in between holds codes that open nothing.",
      "After your number changes, your PIN works on the phone or browser you changed it on. Every other one asks for a code to the new number first.",
      "We write to your recovery email, and tell you in the app, whenever your PIN is replaced or starts working on a new phone or browser. If it was not you, replace your PIN straight away: that shuts out every other phone and browser.",
      "If the app says it could not send the code, nothing is wrong with your number and nothing was counted against you. Wait a little and ask for the code again."
    ]
  },
  {
    id: "store-sign-in",
    apps: [
      "vendor"
    ],
    title: "Signing in to a store",
    summary: "Sign in with your store’s email and password. You chose them when you created the store.",
    steps: [
      "Type the email and the password. Nothing that opens your store is kept on the device: when the sign-in ends, you type them again.",
      "Forgot the password? Choose “I forgot my password”. A code goes to your store’s email address and works for 30 minutes; type it with a new password.",
      "Five wrong passwords lock your sign-in for 15 minutes, and for longer each time it happens again: an hour, six hours, then a day. While it is locked nobody gets in, not even with the right password. You get an email saying so. “I forgot my password” opens it at once.",
      "To change the password: Settings, then Change password. Every device signed in to your store is signed out, except the one you changed it on.",
      "A password is 8 characters or more, and cannot be one that is easy to guess: a common word with a number on the end, your own name or email address, only digits, or a run like 12345678.",
      "A store created before stores had an email and password: choose “My store has no email and password yet”, and sign in with the store ID and signing secret one last time. The app then asks you to set them up, on every screen until you have.",
      "Once your store has an email and password, the signing secret no longer signs anybody in. It is only for your shop system."
    ]
  },
  {
    id: "store-secret",
    apps: [
      "vendor"
    ],
    title: "Rotating the signing secret",
    summary: "The secret signs every status update we send your shop system. It does not sign anybody in. Replace it whenever it may have been seen, or when you have lost it.",
    steps: [
      "My store, then Signing secret, then Rotate the secret.",
      "Type your password to confirm. A store with no email and password yet types the current secret instead.",
      "The new secret is shown once. Save it before you close the sheet.",
      "Update your shop system: updates we send from now on are signed with the new secret."
    ],
    notes: [
      "The card says when the secret was last changed, and suggests rotating it once it is over 90 days old.",
      "A mistyped password here does not sign you out: the app says it was wrong and you try again.",
      "Replacing the secret signs your store out on every other device."
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
      "New here: type your phone number, type the code we send you, then choose a 5-digit PIN.",
      "Coming back: tap “I already have an account” and type your phone and PIN.",
      "A phone or browser you have not signed in on before asks for a code first: we send it to your number, you type it once, and from then on your PIN works there. Your PIN is not changed by it.",
      "Forgot your PIN? Sign in with a code again, and choose a new PIN. On a phone or browser that is new to your account we also ask for your recovery email, and send it a code.",
      "If the app says it could not send the code, nothing is wrong with your number and nothing was counted against you. Wait a little and ask for the code again."
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
      "The console may only open from the networks SeeBuyGet staff work on.",
      "Five wrong passwords lock your sign-in for 15 minutes, and for longer each time it happens again: an hour, six hours, then a day. While it is locked nobody gets in, not even with the right password. You get an email saying so. A new password you choose cannot be one that is easy to guess: a common word with a number on the end, your own name or email address, only digits, or a run like 12345678."
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
      "Importers, clearing agents and other customers do not sign in here: they use the Business app.",
      "A licence or an insurance policy on a company’s record has an expiry date, and the day after it what the paper permits is switched off in that country: a courier licence, charging customers; a goods-in-transit policy, paying claims. The company’s own administrators are emailed 60, 30, 14, 7 and 1 days ahead, and on the day it has lapsed; from a week out the administrators of the company above it are emailed too. A company with no administrator login cannot be told: the Companies screen says so on that row.",
      "As a company’s administrator you see your own papers that are running out at the top of your Company record, with a number beside it in the menu once one has lapsed or is in its last two weeks. To renew one: get the new paper from whoever issues it, then under Licences or Insurance press “Change, with its paper”, enter the new date and attach the paper. It counts from that moment; nobody at SeeBuyGet enters anything.",
      "Once a company is switched on, it keeps its own record: its administrators change it, and SeeBuyGet staff no longer do. A licence, an insurance policy, a bank account and who may sign each change one at a time, together with the paper behind it; the company’s other administrators, and those of the company above it, are emailed each such change. What a licence or policy permits cannot be changed by the company, and one that permits something cannot be taken off the record: it is renewed, or it runs out on its date. Until a company is switched on, staff enter its record and a second person verifies each paper, as before.",
      "Anybody who can read a switched-on company’s record can say one of its papers is not right: under Papers press “Report this paper”, say what is wrong and attach what shows it, such as a screenshot of the issuer’s register. Nothing changes by reporting. The paper keeps counting; the company is told what was said, never who said it, and has seven days to answer under the same paper with “Answer”. Then SeeBuyGet staff decide under Reported papers: one of them may dismiss the report with the reason; striking the paper takes two, one proposing and another approving. A strike puts back what the paper changed: a struck renewal, and the previous date counts again.",
      "Five wrong passwords lock your sign-in for 15 minutes, and for longer each time it happens again: an hour, six hours, then a day. While it is locked nobody gets in, not even with the right password. You get an email saying so. A new password you choose cannot be one that is easy to guess: a common word with a number on the end, your own name or email address, only digits, or a run like 12345678."
    ]
  },
  {
    id: "console-account-moves",
    apps: [
      "console"
    ],
    title: "Account moves: two of us move an account for somebody locked out",
    summary: "Somebody who has lost their phone number, forgotten their PIN and cannot read their recovery email asks for their account to be moved to a new number. One member of staff checks who is asking, and a second approves.",
    steps: [
      "Open Account moves, under Waiting on you. The person gives you a reference, such as MV-ABCD-2345: open the request with that reference.",
      "Ask them for both phone numbers and compare the last three digits with the screen. No whole phone number is ever shown.",
      "Read The account it names: who is on it, whether a national ID is on record, and anything shown in red or orange. Check who is asking. Where the account has an ID on record, ask to see it.",
      "Write what you checked and how, then press I checked who is asking. Nothing moves yet.",
      "A second member of staff opens the same request, reads what you wrote, and presses Approve: move the account. The account moves at once.",
      "To refuse instead, write why and press Refuse. The person reads your reason when they enter their reference, so say what they can do next."
    ],
    notes: [
      "The same member of staff can never check and approve. Either one can refuse, at either step.",
      "The account’s holder is told as soon as somebody asks, in their app and by email. They can stop it from Settings, or simply by signing in with their PIN. A stopped request says which of the two happened.",
      "If the screen says the account’s PIN was used after the request was made, do not approve: the person asking said they had lost it. Pressing Check or Approve stops the request instead.",
      "If the number they gave names no account, there is nothing to move. Refuse it, and do not tell them whether that number has an account: the person asking may not be its owner.",
      "An account that only sends and collects parcels has no ID on record and no name we can see. There is little to check against, so ask what they sent or collected lately, and from where.",
      "After a move the holder can undo it for 24 hours with the old number and the PIN as it was, or with a code to their email. The old number is kept for them until then.",
      "A request nobody decides lapses after two weeks. The person can ask again.",
      "Outside a sandbox this needs a named sign-in for each member of staff. The shared operator key cannot say who is at the keyboard, so it is refused."
    ]
  },
  {
    id: "console-id-disputes",
    apps: [
      "console"
    ],
    title: "ID disputes: two of us say whose national ID it is",
    summary: "Two people say one national ID number is theirs. One holds it on a driver or shop registration; the other was refused. Each sends three photographs. One member of staff says whose it is, and a second approves.",
    steps: [
      "Open ID disputes, under Waiting on you, and open the dispute. The two people are side by side: the one who was refused, and the one who holds the number.",
      "Look at each first picture. It should show the person’s face, their ID card, and their own reference handwritten on paper. The reference to look for is shown beside each person. A picture without it was not taken for this.",
      "Open the close-ups and read the number on each card. Type it under that person and press Check this number. You are told whether it is the disputed number. The number is not kept.",
      "If a picture is blurred, has glare on the card, or has no reference in it, write what is wrong and press Ask them to take the photographs again. They read your words and have another week.",
      "Read What to weigh. Then choose whose ID it is, write what you checked and how, write the reason the other person will read, and press Propose this. Nothing changes yet.",
      "A second member of staff opens the same dispute, reads what you wrote, and presses Approve. Both people are told. To disagree instead, write why and press Send it back."
    ],
    notes: [
      "The same member of staff can never propose and approve.",
      "The ID can only go to somebody whose card you read as carrying the number. If the claimant’s own card carries a different number, they typed somebody else’s: the ID stays where it is.",
      "If the holder’s own card carries a different number, theirs was mistyped. When the ID goes to the claimant, the holder’s record takes the number you read, and nobody is held.",
      "If the holder sends nothing in their week, the dispute can be decided without them.",
      "If both cards carry the number, one is not genuine, and a photograph cannot always say which. Compare each face with its card, and with what the holder sent when they registered. If you cannot tell, leave it with the holder and say so in the reason: the other person can come in with the card itself.",
      "A registration that loses its ID is held, not removed. A driver cannot start a shift, a run or a load. A shop cannot be chosen for a new parcel, as the place to hand it in or to collect it, and cannot take in a walk-up; parcels booked to it before the hold are still handed in, and everything on its shelf is still collected. The hold ends when they put the number of their own ID card on record, in Settings.",
      "Whoever does not get the ID has two weeks to choose a day to come in. Both people are given a ticket. From that day, say who came, read the card in the hand, and propose again; a second member of staff approves, and that is final. The decision can change only for somebody who came.",
      "Where people are sent, and on which days, is each country’s own company’s to set: signed in to the console as that company, under Settings, How to reach you. It writes its address, ticks the days and hours it receives visitors, lists the dates it is closed, and says how many visitors it sees in an hour. A day is then offered only if it is one of its days and not a closed date; with a number of visitors an hour, each person chooses an hour, and an hour that is full is not offered. We do not type either for them. Until it has, the ticket says to ask staff, and the dispute tells you what is missing.",
      "The ID number and whole phone numbers are never shown. The photographs are deleted 30 days after the decision, or 30 days after an appointment.",
      "Outside a sandbox this needs a named sign-in for each member of staff.",
      "If the company changes its days, its hours or its closed dates after an appointment was made, both tickets say that it no longer fits, and the person who made the appointment can choose again.",
      "A country’s company cannot be switched on until it has written its address and set its visiting days and hours. Both are on its Company record, in the list of what is still missing.",
      "The day before an appointment, whoever of the two has an account is reminded in the app and by email, with what to bring. The dispute shows when the reminder went. Somebody with no account cannot be reminded, and their ticket tells them so."
    ]
  },
  {
    id: "console-connections",
    apps: [
      "console"
    ],
    title: "Connections: routing, the adviser, email, push and texts",
    summary: "The Connections screen says whether the services this server leans on are set up and answering: the routing server and the adviser behind the fleets’ planning, and email, push and the text that carries a code for everybody.",
    steps: [
      "Open Connections, under Setup. Only SeeBuyGet staff see it.",
      "Read the word beside each service: Not set up, Set up and not asked yet, Answering, or Not answering. The line under it says what the last plan, or the last office to ask, met.",
      "For the routing server, tap Check it now. It asks for the road distance between a fleet’s depot and a place a little way off it, and says what came back.",
      "For Email and for Push to a phone, read whether anything leaves this server at all. Kept, not sent means each one is written and kept on the server, and reaches nobody.",
      "For Text messages, read the same. On a sandbox, Kept, not sent is as it should be: a code is shown on the screen that asked for it. Anywhere else the word is No code can be sent, in red: a text is the only way a code reaches a phone, so nobody can sign up, confirm a new phone or replace a PIN until Twilio is set up."
    ],
    notes: [
      "A routing server that is not set up, or not answering, stops nothing. Each day’s plan is made on estimated distances instead, and says so to the office that made it.",
      "If a check answers with a distance that cannot be right for two places that close together, the routing server may hold another country’s map.",
      "The adviser is not checked from here, because every question to it is paid for. What the last office’s question met says whether it is answering.",
      "All five are set where the server runs, not on this screen. The routing server’s address is shown without anything secret in it. The adviser’s key, the mail provider’s token, the private push key and everything of Twilio’s are never shown. Nobody’s email address is shown either: the last email is named by what it was, not by who it was for.",
      "What each service last met, and the counts of emails and pushes, are kept only since the server started. After a restart, check the routing server again.",
      "Kept, not sent is how a sandbox is meant to run. On a server that real people rely on it is said in red: reset codes, invitations and notices are written and reach nobody, and no phone is woken.",
      "Email is sent only when the server was started with both the provider’s token and its sending address, each copied from the provider account’s API page. A token on its own sends nothing, and the screen says what is missing or wrong with the address.",
      "A notification is always written to the person’s bell in their app, whatever becomes of the push. Push is only what lights a phone whose app is closed.",
      "Push is signed with a pair of keys. The screen says whether the server has a pair of its own, is using the pair written in its source code, which anybody who can read the code can sign with, or has two keys that do not belong together, which every push service refuses. Changing the keys ends every enrolment: each phone has to turn notifications on again.",
      "When an email cannot be handed over, the screen says whose it is to put right. Refused by the provider and Sending limit reached are about the account: the token, the domain email is sent from, or the provider’s credit. They stop every email and are shown in red. One email turned down is about that email only. Not getting through means the provider could not be reached, or answered with a fault.",
      "The screen shows the provider’s own code for a failure, to look up with the provider. It never shows the token, the full sending address, or who an email was for.",
      "A notice that could not be handed over is kept and tried again: after a minute, then five minutes, then fifteen, then every hour, for one to three days depending on the notice. A code is never sent late: a reset code that did not go has to be asked for again.",
      "An email to an address that cannot exist is never handed to the provider, because it could only bounce: example.com, or an address ending .example or .test. The screen counts them. A sandbox given a real token therefore does not email its made-up people.",
      "Waiting to be tried again says how many notices are kept, and since when the oldest. They are kept in the server’s memory and nowhere else, so restarting the server loses them. If some are waiting, put right what the provider refused before you restart, or wait until the count is back to none.",
      "Given up on counts the emails that will not be sent: the provider turned that one email down, it may already have gone, or it waited too long to be worth sending. The person it was for was not told. Under the line about the last email, the screen says whether that email is kept or will not be sent again.",
      "Bounce notices says whether this server hears of email that comes back. It listens only when ZEPTOMAIL_WEBHOOK_KEY is set to the authentication key of a webhook you add at the provider, for hard and soft bounces, pointed at /v1/mail/provider/events on this server’s public address. A notice is taken only when it is signed with that key.",
      "An address email came back from for good is not written to again, and its owner is told in Settings in their own app. It is written to again once they confirm it with a code, and a code is always sent. After a soft bounce, such as a full mailbox, the address is left alone for a day. The screen counts the addresses not being written to. It never shows an address.",
      "If signed bounce notices are being refused, the screen says how many and why, until one is taken again. Refused because the signature does not match means the key set here is not the one on the provider’s webhook. Requests with no signature are only counted: the address is public, and anything can find it. If the provider’s own notices are counted there, its webhook has no authentication key. No notice has yet come from the real provider, so watch the first one here.",
      "A text that carries a code is sent once. When Twilio does not take it, the person is told it could not be sent and asks again; that try is not counted against their number. The screen says whose the failure was: Refused by the provider is the account’s to put right, One number turned down is a number that cannot receive a text. Handed to Twilio is not delivered: whether a text reached the phone is not heard of here.",
      "Countries a code is texted to shows the dial codes set on the server. With none set, a code is texted to a number in any country, and every text is paid for. Set the countries you serve on the server, and switch on the same ones, and no others, under SMS Geo Permissions in Twilio."
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
      "Type your phone number and your 5-digit PIN. New here, or forgot your PIN? We send a code to your phone first.",
      "A phone or browser you have not signed in on before asks for a code first: we send it to your number, you type it once, and from then on your PIN works there. Your PIN is not changed by it.",
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
      "To take somebody out, press Remove on their row. It holds from their next click. Links to consignment notes that were emailed to them stop at the same moment.",
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
    id: "business-bell",
    apps: [
      "business"
    ],
    title: "The bell: what your business was told",
    summary: "What a carrier or SeeBuyGet tells your business is kept under the bell at the top of the Business app.",
    steps: [
      "Tap the bell. The number on it is how many notices nobody in the business has read yet.",
      "Tap a notice to read all of it. That marks it read for everybody in the business, and it then says who read it.",
      "Mark all read clears the number in one go."
    ],
    notes: [
      "The inbox belongs to the business, not to you alone: everybody in the business reads the same one.",
      "Somebody who can only view the business can read every notice but cannot mark one read. It stays unread until somebody who can act on it has read it.",
      "Notices are not sent to a phone or a computer. Open the Business app to read them. Somebody taken out of the business stops seeing them straight away."
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
      "Open the load to see the prices offered, who is carrying it, the tracking link to share, and the consignment note with the links to it."
    ],
    notes: [
      "SeeBuyGet does not take, hold or send the money for your loads. You pay the carrier directly, or through your own payment system.",
      "You are told under the bell when a load is delivered, with who received it.",
      "The person who posted the load is also emailed a receipt when it is delivered, with a link to the consignment note."
    ]
  },
  {
    id: "business-note",
    apps: [
      "business"
    ],
    title: "A load’s consignment note: the file, the receipt, and links to it",
    summary: "Once the carrier has taken the goods over, the note is kept. Download it as one file, or make a link for somebody who has no account. When the load is delivered, a receipt is emailed with such a link in it.",
    steps: [
      "Loads, then open the load. Consignment note opens the note to read or print.",
      "Once the carrier has taken the goods over, press Download this note and its photographs. You get one file: the note, every copy of it as it was signed, and its photographs. On a phone the button says Share, and opens your phone’s own share sheet.",
      "To give the note to somebody with no account, look under Links to this note and press Make a link to pass on. Then press Send it or Copy it, and send the link in a chat, a text or your own mail. The link is shown only once, because we keep no copy of it.",
      "To stop a link, press Cancel it on its row, then Yes, cancel it. A cancelled link cannot be switched back on. The row then says who cancelled it."
    ],
    notes: [
      "When a load is delivered, the person who posted it is emailed a receipt at their own recovery email, with a button: Get the consignment note. If that person has left the business, or has given no email address, the owners are emailed instead.",
      "The button in the email is a link like the others. It is listed under Links to this note, with the address it went to, how often the file was taken, and until when it works.",
      "When somebody is taken out of the business, or leaves it, the links that were emailed to them stop at once. The same happens when somebody changes their own recovery email: the links sent to the old address stop. Links made for the business to pass on keep working until you cancel them.",
      "A link opens the note without signing in, for whoever has it. It works for 30 days and hands the file over 25 times at most. A note can have five links that work at the same time. Cancel one to make another.",
      "The price in the receipt is the price you and the carrier agreed. SeeBuyGet holds no money for your loads, and the receipt is not an invoice.",
      "A viewer sees the links and can download the file, but cannot make or cancel a link.",
      "If your own link stopped because you changed your email address, open the load and make a new one. The note itself is still there."
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
      "The load shows as With your carrier until they put it on a truck. Once your carrier has accepted its plan for that day, the load also says about when it is planned to arrive. Its tracking link and consignment note work the same as any other load."
    ],
    notes: [
      "The price and how you pay are on your own contract with the carrier. SeeBuyGet keeps the order, the note and the tracking — never the money.",
      "An owner can end a contract under Carriers. Loads already ordered are still delivered.",
      "An order that is more than one vehicle carries may be brought in several loads by your carrier. You are told under the bell, each load says Load 1 of 2 in your list, and either tracking link shows them all.",
      "If your carrier’s plan for the day has a load arriving outside the delivery window you asked for, you are told under the bell, and the load says Outside your window with about when it is planned and by how much. A plan’s time is an estimate and your carrier can still plan the day again. If it cannot work, speak to your carrier.",
      "If your carrier’s plan for the day leaves a load on no vehicle, you are told under the bell, and the load says Not on a vehicle with the reason: no room that day, no vehicle that can carry it, heavier than their largest vehicle, or a place that could not be found on the map. Speak to your carrier, because the day can still be planned again. You are told again when the load is on a vehicle.",
      "The time a load is planned for is your carrier’s estimate. You see it in the Business app as soon as your carrier accepts its plan. Whoever holds the tracking link sees the day from the start, and about when only once the load is on the road.",
      "When a load is delivered, the notice and the load say what time it was handed over and whether that was inside the window you asked for: inside it, how long after it, or how long before. The time is on your carrier’s own clock.",
      "If a load has not arrived half an hour after the time your carrier planned, you are told under the bell that it is running late, and the load says Running late. You are told once more if its whole day passes. A plan’s time is an estimate, so this is a reason to ring your carrier, not proof that something is wrong.",
      "If a load is for today and your carrier has it on no vehicle once the day’s work has begun — seven in the morning on your carrier’s clock — you are told under the bell, and the load says Not on a vehicle. That is a day your carrier has not planned, a load ordered after the plan was made, or a load that missed its trip. A load ordered for the same day is given an hour first. You are told again when it is on a vehicle, whether your carrier planned the day again or put it on a driver by hand."
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
      "Every box is filled from a recorded act — posting, the load-safety check at pickup, the unload report at delivery. A box that says “not recorded” is not recorded; nothing is typed in by hand. The buyer of a store order is named as the buyer, never by phone number.",
      "When a load is delivered, the shop that posted it is emailed a receipt with a button: Get the consignment note. The button opens the note, every copy of it and its photographs as one file, without signing in, for 30 days. Anybody the email is forwarded to can open it too, so forward it only to somebody who should have the note.",
      "The shop sees that link on the note itself. Shop app: Records, then Notes, then open the note, and look under Links to this note. It shows the address the email went to, how often the file was taken, and until when the link works. Tap Cancel it to stop the link at once. A cancelled link cannot be switched back on.",
      "A link hands the file over 25 times at most, and opens nothing once the note itself is no longer kept. The file is the copy to keep: the link stops, the file does not.",
      "You can also make a link yourself, for somebody who should have the note and has no account: a bookkeeper, an insurer, the other side. Open the note in your records and, under Links to this note, tap Make a link to pass on. Then tap Send it or Copy it, and send the link in a chat, a text or your own mail. The link is shown only once, because we keep no copy of it. If it goes astray, cancel it and make another.",
      "A note can have five links that work at the same time. Cancel one to make another. Links that no longer work are folded away under Show the ones that no longer work, with who made each, how often it was opened, and who cancelled it.",
      "A business has no archive: it finds the same file and the same links on the load itself, in the Business app under Loads."
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
    summary: "Every load has a tracking link — the same code the consignment note carries as a QR. Whoever holds it sees where the load is, who is carrying it, the day it is expected where it was ordered for one, and who signed for it — and nothing else. After delivery the shop that posted the load rates the driver.",
    steps: [
      "Shop app, Freight you posted: open the load and tap “Tracking link”. Share it, or copy it into a message to whoever is waiting for the goods. They need no account.",
      "Send app, Track: type the code, or open the link. A load climbs its own ladder — waiting for a carrier, booked, on the road, delivered — with the carrier as they will be at the door, any door nobody answered, and who signed.",
      "Shop app, once delivered: tap “Rate the driver”. Stars out of five, and tags for what went wrong if anything. It counts toward the driver’s rating like a shop’s rating at the counter, one verdict per load, and you can change it within 30 days."
    ],
    notes: [
      "The link shows no phone number, no price and no reasons — a withdrawn load says when, never why. What is between the sender and the carrier stays there.",
      "Whoever sent the load is told when it is delivered, with who received it: look under the bell.",
      "A load ordered from a carrier for a day shows that day from the start. Once it is on the road it also shows about when the carrier planned to be at the door. That hour is the carrier’s estimate; it is not shown before the load is on the road, because until then the carrier can still plan the day again. If the hour passes while the load is on the road, or its whole day passes, the page says it is running late instead of going on saying expected."
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
      "Choose the sheet — the Excel workbook itself (.xlsx) or a CSV file — or copy the cells in the spreadsheet and paste them. The first line names the columns: an order number, the goods, the weight, where to deliver and the date. Download a template to send them shows the exact form.",
      "Tap Check the sheet. You see how many orders are ready, how many are already here, and each line with a problem, by its line number and in words.",
      "Tap Add orders. The lines that are right become orders; the others are left out. Put them right and upload the same sheet again — an order number that is already here is never added twice.",
      "An address the map does not know is added without a point and marked in the queue. Open it and place it on the map, or it cannot be planned."
    ],
    notes: [
      "Dates are read as 2026-10-06 or day first, 06/10/2026. Weights may be 4000, 4,000 kg or 1.5 t. A date typed as a date in Excel is read whatever format the cell shows it in.",
      "Your office can withdraw an order it uploaded, with a reason. An order the shipper placed themselves is theirs to withdraw.",
      "Of an Excel workbook the first sheet is read, and you are told its name and which sheets were not read. Problems are reported by the line numbers Excel shows. An old .xls file, a workbook with a password, and a file over 1 MB are not read: save it as .xlsx or as CSV."
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
      "Under it, what does not fit, grouped by why: an address not on the map (pin it and plan again), no room left in the day, a free truck with no driver, goods no truck of yours can handle, or an order heavier than your largest truck (split it into loads).",
      "An order heavier than your largest truck has Split it into loads. The plan says how many loads of your largest vehicle it makes; you can choose more. Each load then is an order of its own — planned, put on a truck, signed for and tracked separately — and the shipper is told its order comes in parts. Open any load and tap Put the order back together to undo it, while no load is on a truck or handed on.",
      "Then each truck’s day, trip after trip in the order it is driven. A truck that has unloaded goes on to its next collection from where it is, not from the depot.",
      "Where a shipper asked for a delivery window, the plan goes for it: a vehicle that is early waits for the window to open, and the door that closes soonest is visited first. An order that cannot make its window is planned all the same and marked with how late it will be — or how early, when the day has no room to wait. The first lines of the plan say how many.",
      "Change the day opens your settings: when trucks leave, the longest day, the speed on the road, the minutes to load and to hand over, and which vehicles go out. Change one and the plan is worked out again.",
      "Accept this plan when it is right. Each order then shows its truck, its trip and about when it arrives. Opening the plan later shows it as accepted; Plan the day again works out a new one, which replaces it only when you accept that.",
      "On the day itself the plan goes out by itself, a trip at a time: a truck gets its first trip when its driver starts a shift in it, and the next when the last order of that trip is delivered. Send the next trips out now does the same by hand, and says what each truck is doing."
    ],
    notes: [
      "Every time on the plan is an estimate: distance at one speed, plus fixed minutes at each stop — so is “late” and “early”. Distances are by road where the service has a routing server, and an estimate — straight lines with an allowance for the road — where it has not, or when it cannot be reached. The plan says which, under its first lines.",
      "A truck is only ever given one trip at a time — what it can carry at once. Every order goes on with the same checks as any load (room, equipment, the driver’s hours). One that is refused stays in the queue with the reason on it.",
      "The plan never loads a truck past what it carries, never makes a day longer than you set (13 hours at most), and sends out no more vehicles than you have drivers.",
      "The plan will leave one order out when that lets it deliver more of the others: a far, heavy load can hold a truck that three nearer orders would fill. It never gives one order up for one. What is left out is listed with its reason and counted in the trucks you are short.",
      "A window is read when it is written as hours: 8-12, 08:00-12:00, before 14:00, after 9, 2pm-5pm. Words such as morning, or hours that could be either half of the day (1-5), are not read: the order is planned to its day only and says so. Nothing is ever left out because of a window.",
      "Accepting a plan tells shippers two things, and the plan says so above the Accept button when either applies. The shipper of an order the plan leaves out is told it is on no vehicle and why: no room that day, no vehicle that can carry it, heavier than your largest vehicle, or no point on the map. They are never told anything about your drivers. The shipper of an order planned outside its window is told about when, and by how much.",
      "Accepting the same day again repeats nothing. A shipper hears again only when something changed: another reason for being left out, a time that moved by half an hour or more, or an order that is on a vehicle after all. A shipper also sees, in its own app, about when each of its planned orders arrives. Whoever holds an order’s tracking link sees its day, and about when once the load is on the road. An order your own office typed in or uploaded has nobody to tell.",
      "Every time on a plan is on your office’s own clock, and the plan says which under its first lines. You do not set it: a fleet keeps the time zone of its country. Only where a country keeps more than one does the board ask you to choose, once. “Today” is today on that clock, so a shift that starts just after midnight gets that day’s trips.",
      "With a clock, shippers can be told two more things, and are. When a load is handed over, its shipper is told the time and whether that was inside the window they asked for. When a load has not arrived half an hour after the time your plan gave, its shipper is told it is running late, and told once more if the whole day passes.",
      "A shipper is also told when an order for today is on no vehicle at seven in the morning on your clock, or an hour after it was ordered if that is later. That is a day with no accepted plan, an order placed after the plan, or an order that missed its trip. Nobody is told during the night. They are told again when it is on a vehicle: when you accept a plan with it in, or put it on a driver by hand."
    ]
  },
  {
    id: "fleet-plan-adviser",
    apps: [
      "fleet"
    ],
    title: "Asking about a plan, and saying what to change",
    summary: "On a plan you have not accepted yet you can ask an AI adviser why the plan is the way it is, or tell it in your own words what should be different. It explains, and it asks the planner again. The planner still does the planning.",
    steps: [
      "Orders, choose the day, then Plan this day. Under the answer is Ask about this plan. Type a question — why is this order left out, why is that truck not going out — and tap Ask.",
      "Or say what to change: keep FRT-142 off KLM 808T, start at six, the small truck is in the workshop, allow eleven hours. The adviser changes what the planner is asked, the plan is worked out again, and the board shows the new one.",
      "Under each answer the app says what was changed, or that nothing was. That line comes from the planner, not from the adviser: if the two ever disagree, believe that line and the plan on the board.",
      "A rule you asked for stays on the board under Rules on this plan: an order kept off a vehicle, or an order put on one vehicle and no other. It holds every time the day is planned again. Tap Remove to take it off.",
      "Without the adviser: open Change the day. Under each stop, Not on this vehicle keeps that order off that vehicle and Move to puts it on another. An order the plan left out has Put on.",
      "Nothing is accepted by asking. When the plan is right, Accept this plan is still yours to tap. The rules a plan was accepted under are kept with it."
    ],
    notes: [
      "The adviser can change when vehicles leave, the longest day, the speed on the road, the minutes to load and to hand over, which vehicles go out, and rules about one order and one vehicle. It cannot change a delivery window or the order of stops, or split an order; it says so when asked. It can tell you which orders are planned late for their window and why.",
      "It cannot break the plan’s own limits: no vehicle loaded past what it carries, no day over 13 hours, no more vehicles out than you have drivers. An order put on a vehicle too small for it is left out, and the board says a rule is why.",
      "What goes to the AI service to answer you: your words, and the plan — order codes, shippers’ names, delivery addresses, weights and plates. No phone numbers and no contact names.",
      "If the adviser is not switched on, is busy or cannot be reached, the plan is unaffected. Change the day still does the settings and the vehicles by hand.",
      "It is an AI and can misread a question. It never writes the plan itself, so a wrong answer cannot put an order on a truck."
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
      "Orders a partner offers YOU are at the top of Orders. Take one and it is yours to plan and carry; leave it and it goes to their other partners. If you took one and cannot carry it after all, give it back with a reason — until it is on one of your trucks.",
      "Passing on. Under Partners, tick They may pass my orders on beside a partner you trust to. That partner can then offer an order it took from you to its own partners; the first to take it carries it, and the order shows you who. Untick it and their open offers are taken back. An order somebody is already carrying stays with them.",
      "If a fleet has ticked that for you, an order you took from it has Pass it on to your partners. It can be passed on once: the fleet that takes it carries it or gives it back to you, and you can still give it back to the fleet it came from."
    ],
    notes: [
      "You stay the carrier your shipper ordered from. The consignment note names whoever actually carried the goods.",
      "You are told when a partner takes an order, when no partner took it, and when one gives it back and why. A partner is told when you offer and when you take an offer back.",
      "The price between you and a partner, or a carrier from the board, is yours to agree and pay. SeeBuyGet does not handle it.",
      "A fleet being offered an order that is passed on sees which fleet is offering it — not the fleet it was first ordered from, nor whose customer it is, until it takes it. The consignment note names whoever carried."
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
      "The driver is told without asking: a notice less than an hour before the limit, and another at the limit, saying what is still theirs to do (deliver what is aboard), what is not (anything new), and that the next shift can start 9 hours after this one ends. The clock on the shift says “less than an hour left” in that last hour.",
      "Driver app, starting a shift too soon after a working day: the start is refused, and the refusal says how many hours since the last shift ended and how many are needed. A coupling of a few minutes — a wrong scan, a short move — owes no rest.",
      "Driver app, Home, after a working day: the start screen says from when the next shift can start, before anything is tried. Press “Tell me when I can start” to get a notice at that moment. Somebody who tries to start too early is told at that moment as well. Nobody else is: for most working days it falls in the night.",
      "Fleet app, Dashboard and Shifts: a driver over the limit is marked. Dispatch will not put a load on them; end the shift and let them rest.",
      "Fleet app, the bell: the office is told when one of its drivers passes the limit, with the vehicle, so that no new load is planned for them."
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
