/**
 * 2026-11-26 — the bell's own notices (its welcome in every app, the test push), a partner's money and its counters' Mollie
 * account, and a payout bank account changed. English, as each is sent; the other languages beside it (../<lang>/bell.ts).
 */
export const EN_BELL = {
  'bell.twoParts': '{what} {next}',
  'bell.test.title': 'Notifications are on',
  'bell.test.body': 'This is a test from SeeBuyGet — this is where we will tell you when something needs you.',
  'bell.button.take': 'Take it',
  'bell.button.notNow': 'Not now',

  'welcome.tap': 'Tap one and it opens where you act on it.',
  'welcome.business.title': 'Your business’s notices arrive here',
  'welcome.business.body': 'A carrier taking a load, a problem on the road, a delivery, a claim answered, papers checked: each is told here. {tap}',
  'welcome.driver.title': 'Your notices arrive here',
  'welcome.driver.body': 'Loads put on you, offers near you, messages, your shift and your vehicle: each is told here. {tap}',
  'welcome.shop.title': 'Your shop’s notices arrive here',
  'welcome.shop.body': 'Parcels to take in or hand out, bags to close, money in: each is told here. {tap}',
  'welcome.hub.title': 'Your hub’s notices arrive here',
  'welcome.hub.body': 'Bags coming in and arrivals at your door: each is told here. {tap}',
  'welcome.store.title': 'Your store’s notices arrive here',
  'welcome.store.body': 'Your shipments, and what reaches your dock: each is told here. {tap}',
  'welcome.fleet.title': 'Your fleet’s notices arrive here',
  'welcome.fleet.body': 'Your drivers, runs, orders and vehicles: each is told here. {tap}',
  'welcome.partner.title': 'Your company’s notices arrive here',
  'welcome.partner.body': 'What SeeBuyGet owes you each week and when it is paid, payouts waiting for your account, and changes to your counters’ Mollie account: each is told here. {tap}',
  'welcome.send.title': 'Your notices arrive here',
  'welcome.send.body': 'Your parcels — on their way, ready to collect, or needing you: each is told here. {tap}',

  'partner.weekOwed.title': '{seller} owes you {amount} for the week of {from} to {to}',
  'partner.weekOwed.body': 'For {steps, plural, one {# step} other {# steps}} your people did on parcels it sold. It is paid by bank transfer, and you are told here when.',
  'partner.weekPaid.title': '{seller} paid you {amount} for the week of {from} to {to}',
  'partner.weekPaid.body': 'By bank transfer, reference {reference}.',
  'partner.payoutsShort.title': 'Payouts wait: your payout account is short',
  'partner.payoutsShort.body':
    '{count, plural, one {# payout to your people, {amount}, waits until your payout account holds enough. It is tried again every hour.} other {# payouts to your people, {amount} in all, wait until your payout account holds enough. They are tried again every hour.}}',
  'partner.mollie.connected.title': '{partner}: the counters\' Mollie account was connected',
  'partner.mollie.disconnected.title': '{partner}: the counters\' Mollie account was disconnected',
  'partner.mollie.connected.what': '{by} connected {account}. From now on the money your counters take goes into it.',
  'partner.mollie.disconnected.what': '{by} disconnected {account}. Your counters take test money until an account is connected again.',
  'partner.mollie.connected.next': 'If that is not your company’s own account, disconnect it in the Partner app, under Money, and tell SeeBuyGet straight away.',
  'partner.mollie.disconnected.next': 'If that was not meant, connect your company’s own account again in the Partner app, under Money.',
  'partner.mollie.account.registered': '{name}, registration {registration}',
  'partner.mollie.account.unnamed': 'a Mollie account',

  'payout.bankChanged.title': 'Your payout bank account was changed',
  'payout.bankChanged.what': 'Payouts now go to the account {account}. Nothing is paid to it before {until}.',
  'payout.bankChanged.nextPin': 'If it was not you, change your PIN straight away, then set your own account again in Settings.',
  'payout.bankChanged.nextPassword': 'If it was not you, change the password straight away, then set your own account again in Settings.',
} as const;
