/**
 * YOUR DATA, AND COOKIES (the user, 2026-10-22: "add a use of cookies link in the footer and how we deal with privacy as
 * how the system does it") — /privacy/ and /cookies/. Every sentence is what the SeeBuyGet system does today, read from
 * its code: what it keeps, how, who sees it, which other companies handle it, how long, and what a person can do. Not
 * what it ought to do. So these pages do NOT say that signing out clears a phone, that every number is hashed, or that
 * everything is encrypted — the system does none of those — and they say an account can be closed only as the system
 * closes it: by its owner, once told, after four years without a sign-in (2026-10-22). When the system changes, these
 * words change with it.
 *
 * A section's items are numbered (pages.privacy.keeps.1 …); how many each has is in pages.ts (NOTICES).
 */
export const enPrivacy = {
  'pages.notice.asOf': 'Written from the SeeBuyGet system as it works on 22 October 2026.',
  'pages.notice.write': 'Write to us about your data',

  // Your data at SeeBuyGet (/privacy/).
  'pages.privacy.metaTitle': 'Your data at SeeBuyGet — what is kept, who sees it, for how long',
  'pages.privacy.metaDescription': 'What SeeBuyGet keeps to carry a parcel, how it is protected, who can see it, which other companies handle it, how long it is kept and what you can do.',
  'pages.privacy.title': 'Your data at SeeBuyGet',
  'pages.privacy.lede': 'SeeBuyGet keeps what it needs to carry a parcel and to show who handled it at each step. This page says what that is, who can see it, who else handles it, how long it is kept and what you can do.',
  'pages.privacy.other': 'Cookies, and what is kept on your phone',

  'pages.privacy.keeps.title': 'What SeeBuyGet keeps',
  'pages.privacy.keeps.1': 'For a parcel, SeeBuyGet keeps the sender’s and the receiver’s phone numbers, the two shops, every step with its time, and the photos taken at each hand-over.',
  'pages.privacy.keeps.2': 'For a shop, driver, sort hub or fleet that works with SeeBuyGet, SeeBuyGet keeps the name, national ID number and phone number of the person responsible, and the papers checked before the first parcel.',
  'pages.privacy.keeps.3': 'For an account, SeeBuyGet keeps the phone number or email address it signs in with, the phones and browsers it was confirmed on, and the day it last signed in.',
  'pages.privacy.keeps.4': 'During a shift, SeeBuyGet keeps a driver’s latest position, each new one replacing the last.',
  'pages.privacy.keeps.5': 'For freight, SeeBuyGet keeps the consignment note: the sender, the consignee, the goods, the seals and who received them.',
  'pages.privacy.keeps.6': 'When you write to SeeBuyGet, it keeps your email address and your message, to answer you.',
  'pages.privacy.keeps.7': 'A conversation between two parties in a SeeBuyGet app is kept as it was written: nothing in it is edited or deleted.',

  'pages.privacy.never.title': 'What SeeBuyGet does not do',
  'pages.privacy.never.1': 'SeeBuyGet shows no advertising, and no analytics or tracking script runs on its pages or in its apps.',
  'pages.privacy.never.2': 'SeeBuyGet’s emails carry no open or click tracking.',
  'pages.privacy.never.3': 'SeeBuyGet sends no text about a parcel. A text from SeeBuyGet only ever carries a sign-in code, or tells an old payout number that it was replaced.',
  'pages.privacy.never.4': 'A photo taken in a SeeBuyGet app has its location and phone details removed on the phone, before it is sent.',

  'pages.privacy.protect.title': 'How it is protected',
  'pages.privacy.protect.1': 'The names, national ID numbers and phone numbers of the people who work with SeeBuyGet are encrypted in its database (AES-256), and each time one is opened, a record of the opening is written first.',
  'pages.privacy.protect.2': 'PINs and passwords are kept only as a one-way hash: nobody at SeeBuyGet can read them.',
  'pages.privacy.protect.3': 'A SeeBuyGet PIN works only on a phone or browser that first signed in with a code sent to your number.',
  'pages.privacy.protect.4': 'Too many wrong tries lock a SeeBuyGet sign-in, for longer each time: 15 minutes, then an hour, 6 hours and 24 hours.',
  'pages.privacy.protect.5': 'Every SeeBuyGet page and app is served only over HTTPS.',
  'pages.privacy.protect.6': 'Every hand-over of a SeeBuyGet parcel is chained to the one before it by a fingerprint, so a record changed afterwards shows.',
  'pages.privacy.protect.7': 'The rest — parcels with their phone numbers, photos, messages — is kept on the SeeBuyGet server without that extra encryption, reachable only through the sign-ins and staff roles on this page.',

  'pages.privacy.see.title': 'Who can see it',
  'pages.privacy.see.1': 'You see your own account, and your own parcels, in your SeeBuyGet app.',
  'pages.privacy.see.2': 'The shop that takes in or hands out a SeeBuyGet parcel receives that parcel’s record, with the phone numbers on it.',
  'pages.privacy.see.3': 'A SeeBuyGet driver sees the loads they carry, and the consignment notes that go with them.',
  'pages.privacy.see.4': 'SeeBuyGet staff see what their role needs — support, checking papers, money — and every record a staff member opens by name or number is noted with who opened it.',
  'pages.privacy.see.5': 'Some SeeBuyGet staff actions take two people, one asking and a different one approving: creating a staff account, and moving an account to another number, among them.',
  'pages.privacy.see.6': 'A conversation in a SeeBuyGet app can be read by its two parties and nobody else, SeeBuyGet staff included, unless one of them reports or shares a message.',
  'pages.privacy.see.7': 'A fleet, a business or an online store sees its own drivers, loads or orders in SeeBuyGet, and can have them sent on to systems of its own.',

  'pages.privacy.others.title': 'Other companies that handle it',
  'pages.privacy.others.1': 'Cloudflare carries every SeeBuyGet page and app between your phone and the SeeBuyGet server, and protects the site from attacks; what you send, photos included, passes through it.',
  'pages.privacy.others.2': 'DigitalOcean rents SeeBuyGet the server its database and photos are kept on, and holds its backups.',
  'pages.privacy.others.3': 'When SeeBuyGet sends an email — a sign-in code, a password reset, a notice about your account, an answer to your message, or word that an order is on its way — it goes through ZeptoMail, by Zoho.',
  'pages.privacy.others.4': 'When SeeBuyGet texts a sign-in code, it goes through Twilio, and only to a number in a country where SeeBuyGet runs.',
  'pages.privacy.others.5': 'A SeeBuyGet notification goes through your phone’s own push service — Google, Apple or Microsoft — encrypted, so that the service cannot read it.',
  'pages.privacy.others.6': 'The maps in SeeBuyGet apps are drawn from OpenStreetMap, which sees your internet address and the area on the screen.',
  'pages.privacy.others.7': 'When a payment to SeeBuyGet is made by M-Pesa, Safaricom receives the phone number and the amount.',
  'pages.privacy.others.8': 'When a dispatcher asks the SeeBuyGet fleet planning adviser something, the question and the loads it is about — plates, shipper names, places, weights and times, never a phone number — go to Claude, by Anthropic.',
  'pages.privacy.others.9': 'An address typed to find the nearest SeeBuyGet shops — yours, a receiver’s, or one a store or a shop types for its customer — is looked up on the SeeBuyGet server and by OpenStreetMap’s address service, which sees the address and the SeeBuyGet server’s internet address, not yours; it is kept with no account. A place tapped on the map, or your phone’s own position, stays on your phone.',
  'pages.privacy.others.10': 'Cloudflare tells the SeeBuyGet server which country your internet address is in. It only chooses the first country code shown beside a phone number box, which you can change, and nothing keeps it.',

  'pages.privacy.howLong.title': 'How long it is kept',
  'pages.privacy.howLong.1': 'Photos of a hand-over are deleted 90 days after the parcel’s journey ends.',
  'pages.privacy.howLong.2': 'Photos added to a dispute are deleted 180 days after the dispute is settled.',
  'pages.privacy.howLong.3': 'Photos from a face-and-ID check are deleted 30 days after the decision.',
  'pages.privacy.howLong.4': 'An ID document is kept as long as the account; one that was replaced is deleted 30 days later.',
  'pages.privacy.howLong.5': 'When a photo is deleted, a note that it existed stays with the record — not the photo.',
  'pages.privacy.howLong.6': 'A SeeBuyGet consignment note is deleted 365 days after its load is finished, with a warning 30 days before; its fingerprint stays, so a copy can still be checked.',
  'pages.privacy.howLong.7': 'A message to SeeBuyGet is deleted, with its email address, 180 days after it is closed.',
  'pages.privacy.howLong.8': 'A SeeBuyGet sign-in code lasts 10 minutes by text and 15 minutes by email; a password-reset link lasts 30 minutes.',
  'pages.privacy.howLong.9': 'A phone or browser not used for 90 days stops being one your SeeBuyGet PIN works on.',
  'pages.privacy.howLong.10': 'Parcels and conversations have no deletion date: SeeBuyGet keeps them, as other people’s records too. An account is kept until its owner closes it, which they can once it has gone four years without a sign-in; its personal details are then removed, and parcels and hand-overs keep “closed account” where the person was.',
  'pages.privacy.howLong.11': 'A deleted record can remain in a backup of the SeeBuyGet database until that backup is replaced by a newer one.',

  'pages.privacy.you.title': 'What you can do',
  'pages.privacy.you.1': 'In your SeeBuyGet app, under “Settings”, you can change your PIN or password, your recovery email and your phone number.',
  'pages.privacy.you.2': 'Under “Settings › Phones and browsers” you can see where your SeeBuyGet PIN works, and forget this phone or all the others.',
  'pages.privacy.you.3': 'A change of phone number can be undone for 24 hours, and a change of recovery email is told to the old address.',
  'pages.privacy.you.4': 'SeeBuyGet notifications can be turned off on each phone.',
  'pages.privacy.you.5': 'A shop, online store or business can download its own SeeBuyGet records, and have a copy sent to storage of its own.',
  'pages.privacy.you.6': 'Under “Settings › Mute my account” you can rest your SeeBuyGet account: nothing new reaches it — no notification on your phone, no email beyond codes and your account’s safety, no new work — until you unmute it. Nothing is deleted.',
  'pages.privacy.you.7': 'A SeeBuyGet account that has gone four years without a sign-in can be closed by its owner, under “Settings › Close my account”, once nothing is open: SeeBuyGet tells them when it can be. Closing removes their name, ID number, phone number, email and ID photos. To ask what SeeBuyGet holds about you, or to have it corrected, write to us and choose “My data, or closing my account”.',

  // Cookies (/cookies/).
  'pages.cookies.metaTitle': 'Cookies at SeeBuyGet — none set, and what is kept on your phone',
  'pages.cookies.metaDescription': 'SeeBuyGet sets no cookies and runs no tracking. What its apps keep in your browser instead, why, what stays after signing out, and how to remove it.',
  'pages.cookies.title': 'Cookies',
  'pages.cookies.lede': 'SeeBuyGet sets no cookies, runs no analytics and shows no advertising. What its apps keep in your browser instead stays on your phone, and is listed here.',
  'pages.cookies.other': 'Your data at SeeBuyGet',

  'pages.cookies.none.title': 'No cookies, no tracking',
  'pages.cookies.none.1': 'SeeBuyGet’s pages and apps set no cookies, and load no script from another website; the fonts are SeeBuyGet’s own copies.',
  'pages.cookies.none.2': 'Cloudflare, which carries the SeeBuyGet site, can set a cookie of its own when it checks that a visitor is not an automated attack; an ordinary visit gets none.',
  'pages.cookies.none.3': 'Signing in to a SeeBuyGet app uses no cookie: the app holds your sign-in itself, so another website cannot act as you.',

  'pages.cookies.kept.title': 'What SeeBuyGet keeps in your browser',
  'pages.cookies.kept.1': 'Your sign-in, until you sign out or close the tab.',
  'pages.cookies.kept.2': 'Which SeeBuyGet accounts signed in on this phone, and the phone number or email address used, to fill in the next sign-in.',
  'pages.cookies.kept.3': 'This phone’s key for your SeeBuyGet PIN: without it, the PIN does not work here.',
  'pages.cookies.kept.4': 'A copy of what the app last showed you, so it opens without signal.',
  'pages.cookies.kept.5': 'Work waiting for signal — a hand-over or a photo taken offline — until it is sent.',
  'pages.cookies.kept.6': 'For a SeeBuyGet driver: the consignment notes of the loads on board, and the route of the shift.',
  'pages.cookies.kept.7': 'In the SeeBuyGet Send app: your last five tracking keys, and the contacts you invited.',
  'pages.cookies.kept.8': 'Your choices: language, map or plan, light or dark help, the tips you closed, and whether you were asked about notifications.',
  'pages.cookies.kept.9': 'A random number for this browser, sent when a shop signs up, so SeeBuyGet knows the shop’s own phone.',
  'pages.cookies.kept.10': 'The SeeBuyGet app itself — its pages, styles, fonts and pictures — so it opens fast and without signal. None of your data is in it.',

  'pages.cookies.out.title': 'Signing out, and removing it all',
  'pages.cookies.out.1': 'Signing out of a SeeBuyGet app ends your sign-in, and forgets a driver’s consignment notes on that phone.',
  'pages.cookies.out.2': 'Some things stay after signing out: the number or email to fill in next time, this phone’s PIN key, the copy of what the app last showed, a driver’s route, the Send app’s contacts, and anything still waiting for signal.',
  'pages.cookies.out.3': 'On a phone that is not yours, choose “Settings › Phones and browsers › Sign out, and forget this one”: your SeeBuyGet PIN no longer works there.',
  'pages.cookies.out.4': 'To remove everything SeeBuyGet keeps in your browser, clear the site data for seebuyget.com in your browser’s settings — once nothing is waiting for signal, or that work is lost.',

  'pages.cookies.maps.title': 'Maps',
  'pages.cookies.maps.1': 'The map pictures in SeeBuyGet apps come from OpenStreetMap: loading them tells OpenStreetMap your internet address and the area on the screen. Without signal, the app draws its own plan instead.',
};
