import { articles, type GuideArticle } from './articles';

/**
 * THE STAFF'S OWN HELP — imported by the operator console and by nothing else, so no other app's code carries it (the
 * user, 2026-10-22: the help was public, and with it how the setup key, staff roles and two-person decisions work; the
 * console's entrance is not advertised, 2026-10-03, and its procedures are not either). English only for now, like the
 * articles it extends.
 *
 * `STAFF_ARTICLES` are the console's alone. `STAFF_LINES` are the steps and notes, written for staff, of articles partners
 * read too: the console shows them in place, every other app and the public help without them.
 */
export const STAFF_ARTICLES: GuideArticle[] = [
  {
    id: "staff-roles",
    apps: [
      "console"
    ],
    title: "Staff roles: what each member of staff can open",
    summary: "Every member of staff holds one or more of four roles, and the console shows each person only the screens of theirs: support for parcels, loads and cases; vetting for joining and papers; money for payouts and books; administration for staff and settings.",
    steps: [
      "To see who holds what: At a glance, then Network staff. The Roles column lists what each person holds. Only staff who hold administration see this panel.",
      "To ask for a new account: press Add a person, type their name and email, and tick the roles they will hold, at least one. A second member of staff approves the account and its roles together.",
      "To change somebody’s roles: press Change roles beside them, tick the roles they should hold, and press Ask for this change. Nothing changes until a second member of staff approves it in the list of what waits for a second member of staff.",
      "Once it is approved, that person is signed out. When they sign in again, the console shows the screens of their new roles."
    ],
    notes: [
      "A change of your own roles is decided by others: whoever asked for it, and a second member of staff. You see it waiting, and you can neither approve nor decline it.",
      "A screen that is not for your roles is not in your menu, and the server refuses what it would read. The first account the setup key makes holds every role, because that person sets the network up."
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
      "New here? You were emailed a link: open it and choose your password. Nobody on staff was shown one for you. Then sign in as above. (Only the very first account on a new installation is given a password; change that one straight away: your name at the top, then Settings.)",
      "Add a colleague: Overview, then Network staff, then Add a person, and ask for the account. Nothing is made yet. A second member of staff approves it in the same place. Your colleague is then emailed a link to choose their own password; nobody on staff is shown one.",
      "Somebody leaving: Take away. Their open sessions end at once; their decisions keep their name. An account they asked for that nobody approved yet is dropped with it."
    ],
    notes: [
      "Lost your phone? Two other members of staff reset your two-step sign-in: Overview, then Network staff, then Reset two-step. One asks, a second approves; you are signed out and set it up again at your next sign-in.",
      "The console may only open from the networks SeeBuyGet staff work on.",
      "Five wrong passwords lock your sign-in for 15 minutes, and for longer each time it happens again: an hour, six hours, then a day. While it is locked nobody gets in, not even with the right password. You get an email saying so. A new password you choose cannot be one that is easy to guess: a common word with a number on the end, your own name or email address, only digits, or a run like 12345678.",
      "Why a new sign-in takes two of you: if one sign-in could make another alone, whoever held it could become a second person and approve their own decisions. Approve an account only if you know the person and the address is theirs. Everybody else on staff gets an email when one is asked for. If the colleague named in it did not ask, decline it and take their sign-in away. A request waits 7 days; you can take back your own, and decline somebody else’s with a reason they are told.",
      "The link to choose a password works once, for 48 hours, and only the newest one works. If it did not arrive or has lapsed, anybody on staff sends a new one: Overview, then Network staff, then Send a new link. It always goes to the colleague’s own address.",
      "If you are the only one who can sign in, there is no colleague to approve what you ask for: the setup key approves it. Whoever holds the key signs in with it and finds your request under Network staff."
    ]
  },
  {
    id: "console-setup-key",
    apps: [
      "console"
    ],
    title: "The setup key",
    summary: "The one shared operator key, for the first staff account on a new installation. On a laptop it also runs the seeder and the tests.",
    notes: [
      "In a sandbox it has full operator rights but cannot say who is holding it, so the console marks your name “name not verified”.",
      "Outside a sandbox it sets network staff up and does nothing else. The console shows that one screen; the key opens no other, decides nothing and acts for nobody. Nothing signs in as a shop, a driver or a company but they themselves.",
      "Outside a sandbox it makes a staff account alone only while nobody can sign in. When one person can sign in, that person asks for the next account and the setup key approves it. With two or more, a second member of staff approves, and the setup key adds nobody.",
      "Outside a sandbox it takes no sign-in away at once. Asking with the setup key tells everybody on staff by email and waits 24 hours, and any member of staff can stop it: Overview, then Network staff, then Stop it. That is the way back for somebody alone on staff who lost their phone, and it is no quiet way in for whoever finds the key."
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
    id: "console-fleet-setup",
    apps: [
      "console"
    ],
    title: "Setting up a fleet",
    summary: "A fleet does not sign itself up. Network staff register it, put its four papers on record, a second member of staff approves them, and its bond is recorded. Then its office has a code to sign in with.",
    steps: [
      "Waiting on you, then Joining the network, then Fleets. Open “Register a fleet” and fill in the company, its country, its depot, its owner, its three numbers (business registration, transport operator’s licence, tax) and the phone number of its first manager. Press Register the fleet.",
      "On the fleet’s row, choose a photograph or scan of each of the four papers: the certificate of registration, the transport operator’s licence, the owner’s ID and a proof of address. Press Put on record.",
      "A different member of staff opens the same screen, looks at the four pictures and presses Approve its papers. Whoever put them on record sees no such button.",
      "When the fleet’s operating bond has been received, press Record the bond. The fleet is now active.",
      "The row now shows the fleet’s code. Give it to the fleet’s office. In the Fleet app they type it and tap “First time here, or forgot your PIN?”: a code is texted to the first manager’s phone, they add a recovery email and choose their own PIN."
    ],
    notes: [
      "Papers that are not right are sent back with the reason, by either of you. The row then asks for the four pictures again, and shows who sent them back and why.",
      "Why it takes two: one person entering a company’s papers and approving them is one person letting a carrier onto the network alone. The number beside Joining the network counts a fleet whose papers are waiting for you, and not one that is waiting for a colleague.",
      "A fleet can be registered only in a country that is switched on. Once it is active, the fleet keeps its own papers and people in the Fleet app; staff issue a new code under Overview, then The fleets, then New code."
    ]
  },
  {
    id: "console-stores",
    apps: [
      "console"
    ],
    title: "Finding a store, and what opening one shows",
    summary: "Operator console, Stores: every store that ships through the network, found by the name it gives on the phone. Opening one shows what its call is usually about — whether it has float, whether a payment arrived, whether its systems are answering. Staff read there and change nothing.",
    steps: [
      "Operator console, Stores, in the first group beside At a glance. Type any of: the store’s name, its store number, its street, its country, or the company of ours it pays. Every word typed has to be found, in any order.",
      "A row gives the country, the company that settles the store and its float. A tag is shown only where something differs from the ordinary: “Float empty”; “No float held here”, where no company of ours runs a till in that country; or “Signs in by its secret”, where it has not set up an email and password yet.",
      "Open a store. The top says what is likely wrong, a sentence each, with where it is put right: labels waiting on float, a payment started and not arrived, messages to its systems given up on, returns it has not answered. “Nothing stands out” means none of those.",
      "Its money: the float, any payment it has started that has not arrived, with the reference to confirm it by under Money in, and its last five entries.",
      "Its shipments: how many in all, how many on the way and how many not paid for, and its newest five by parcel number. To see where one is, look it up by that number under Find a parcel.",
      "Its systems: the address they are told at, how many messages arrived, are still owed or were given up on, and why the last ones failed, in our words. A store with no address set has no software of its own to tell, which is ordinary and not a fault. Under that, the keys it has made: in use, never used, or revoked."
    ],
    notes: [
      "Staff are shown no buyer, no collection code, no signing secret and no key. The number on file for a store is shown by its last three digits only. Nor can a staff sign-in read them anywhere else: a store’s orders, its checkouts and the messages to its systems are read by the store, signed in as itself.",
      "Nothing is changed from this screen, and a staff sign-in cannot change a store anywhere else either: its address, its keys, its dock, its orders and the payments it starts are the store’s own to make, signed in as itself in the Store app. What staff do about a store they do under their own names: a payment is confirmed under Money in."
    ]
  },
  {
    id: "console-amounts",
    apps: [
      "console"
    ],
    title: "What a parcel costs and what each step pays",
    summary: "Each country’s company keeps its own list of amounts, in its own money: what a parcel costs a shop’s float, and what a shop, a hub or a driver is paid for each step. Network staff and that company’s own administrators set it.",
    steps: [
      "Setup, then Rates & tax. Choose the company. Below the table of rates: “What a parcel costs and what each step pays”.",
      "Type a figure in the box of the amount you want to set, in that company’s currency. An empty box stands at the figure shown greyed in it, which is what every company starts from. Type 0 for a step the company pays nothing for.",
      "Read the line under the boxes before you save: what one parcel taken in at a counter brings in, and what sorting, shelving and handing it over pay out. It turns red when the second is more than the first, which nearly always means a figure is in the wrong box.",
      "Press Save. The change is listed under “What changed, and who changed it”, with your name and what the figure was before."
    ],
    notes: [
      "A change counts for every step done from then on. It does not re-price what has happened: a parcel that is cancelled is refunded what its shop was charged, and a parcel already past its free collection time keeps the daily holding rate it started at.",
      "The price of a parcel is also the float a shop needs to take the next one in, and a shop’s credit line is twenty parcels at that price. Change the price and both follow; there is no second figure to keep in step.",
      "Whose list counts is the company of whoever does the step. A parcel shelved in another country is paid for at that country’s figure, in that country’s money."
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
      "Kept, not sent is how a sandbox is meant to run. On a server that real people rely on it is said in red for email and texts: reset codes, invitations and notices are written and reach nobody. Push is never kept there: it is sent.",
      "Email is sent only when the server was started with both the provider’s token and its sending address, each copied from the provider account’s API page. A token on its own sends nothing, and the screen says what is missing or wrong with the address.",
      "A notification is always written to the person’s bell in their app, whatever becomes of the push. Push is only what lights a phone whose app is closed.",
      "Push is signed with one key of the server’s own, set where the server runs; the half a phone enrols against is worked out from it, so there are not two to keep in step. A sandbox uses the key written in its source code and sends nothing. Anywhere else the server does not start without a key of its own, and sends: straight to the push service of whoever made the person’s browser (Google, Mozilla, Apple or Microsoft), sealed so that only that phone can read it, with no account at any of them. Changing the key ends every enrolment: each phone has to turn notifications on again.",
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
      "Countries a code is texted to shows the countries that are switched on: a code is texted to a number in one of those and to no other, and there is no separate list to keep. When you switch a country on, also switch it on under SMS Geo Permissions in the Twilio console. Twilio does not let that be done for you, and refuses texts to a country that is off there.",
      "A push that a phone’s push service no longer knows (the browser was wiped, or notifications were turned off there) is not tried again: that phone is forgotten, and the count of phones on the screen falls by one. A push is only ever sent to a browser maker’s own push service; an address that is not one is refused when a phone enrols."
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
    id: "trail",
    apps: [
      "console"
    ],
    title: "The trail: each step anchored, and whether it still matches",
    summary: "A load taken over and delivered, its seals written, read, broken or replaced, every copy of its consignment note, tampering reported, a bag closed, taken and received, a parcel’s scans and its damage claim report: each is anchored in the network’s chain as it is kept, and staff can check that the record still says what was anchored.",
    steps: [
      "Operator console, Find a parcel: type a load’s code or a parcel’s number. Under the load’s consignment note, or the parcel’s scans, “The trail” lists each step with when it was kept. A parcel’s trail starts after it was made: its making is its creation receipt.",
      "The case of a held load, bag or parcel shows its trail too.",
      "“Intact”: the record as it stands is what was anchored. “Changed since it was anchored”: somebody changed it afterwards — say so to the person responsible for the systems at once. “Made before the trail”: kept before steps were anchored, so there is nothing to check it against.",
      "Beside the title, the chain as a whole: how many anchors it holds and whether it is whole, or the block where it breaks."
    ],
    notes: [
      "Only fingerprints go into the chain — never a name, a phone number or an amount. Parcel scans have been anchored all along."
    ]
  },
  {
    id: "staff-reads",
    apps: [
      "console"
    ],
    title: "What staff opened",
    summary: "Every record a member of staff opens by its name or number is noted: who, which, when, and how many times in a row — and looking at the list is noted too.",
    steps: [
      "Operator console, Setup, “What staff opened”: newest first. Show the lines of one member of staff by their name, or of one record by its number, code or id.",
      "Each line is one record opened by one person: its number or code, who — a member of staff by their own account, or “the shared key”, which is nobody — when, and, opened again within ten minutes, how many times.",
      "Lists are not noted, only a record opened by its name or number. What staff change is on the record of the thing they changed."
    ],
    notes: [
      "Sign in with your own staff account: what the shared key opens is noted as nobody’s."
    ]
  }
];

export const STAFF_LINES: Record<string, { steps?: string[]; notes?: string[] }> = {
  "new-partner-limit": {
    steps: [
      "Operator console: Joining the network, Riders’ ID photos."
    ]
  },
  "parcel-problem": {
    steps: [
      "Operator console, Damage claims, lists every report made, and staff can download one; they decide nothing there."
    ]
  },
  "risk-register": {
    steps: [
      "Operator console: Waiting on you, “Risk register”. What incidents proposed comes first — tampering found at a hub proposes a raise for pilferage there, and for the corridor of whoever carried it. Raise it, or keep it as it is with a reason."
    ]
  },
  "security-declaration": {
    steps: [
      "Operator console: Papers, “Security declarations” — who has none in force, then who is due within the month. Staff read it; nobody signs for anybody else."
    ]
  },
  "fleet-code": {
    notes: [
      "Network staff can issue a new code from the operator console: Overview, then The fleets, then New code."
    ]
  },
  "business-check": {
    steps: [
      "Operator console, Businesses: open the business, open each paper and verify it, then approve. A second, different member of staff gives the second approval."
    ]
  },
  "held-on-the-road": {
    steps: [
      "Operator console, Cases: “Held by police or customs”, critical. Call the driver. It clears itself when they say they were let go.",
      "Operator console, signed in for a country’s company: Settings, “How to reach you”, Operations desk. Its number is shown to every driver held in your country, and is never published."
    ]
  },
  "papers-that-expire": {
    steps: [
      "Operator console, Papers: couriers without a fleet are a list of people. A card somebody sent comes first; open it and the photo is shown at a readable size beside the date field. Record the date you read — a date that differs from theirs is pointed out before it is saved — or refuse the card with a reason the courier is shown. The same sheet gives their name and phone from the identity vault, one recorded look at a time. Vehicles no fleet owns are recorded here too, and the screen runs the six-hourly check by hand and shows when it last ran."
    ]
  }
};

/** The console's help: every article it shows, the staff's lines back in their place, then the staff's own. */
export function consoleArticles(): GuideArticle[] {
  const shared = articles().filter((a) => a.apps.includes('console')).map((a) => {
    const more = STAFF_LINES[a.id];
    if (!more) return a;
    return { ...a, ...(more.steps ? { steps: [...(a.steps ?? []), ...more.steps] } : {}), ...(more.notes ? { notes: [...(a.notes ?? []), ...more.notes] } : {}) };
  });
  return [...shared, ...STAFF_ARTICLES];
}
