/**
 * 2026-11-27 — an account's safety, told in the reader's language (the owner: "fix as recommended"): what is said in the bell
 * and the email when a PIN is locked or replaced, a new phone may use it, the recovery email is replaced, the account is closed,
 * or somebody asks for it to be moved; and the words of the email those go in (account-safety), around them. English, word for
 * word what was sent before; the other languages beside it (../<lang>/safety.ts).
 */
export const EN_SAFETY = {
  'accountSafety.pinLocked.title': 'Your PIN was locked',
  'accountSafety.pinLocked.what': 'Somebody typed a wrong PIN five times for your phone number, so nobody can sign in with it now.',
  'accountSafety.pinLocked.next': 'To sign in again, verify your phone by code and choose a new PIN. If it was not you, somebody knows your number: choose a PIN they cannot guess.',

  'accountSafety.pinReplaced.title': 'Your PIN was replaced',
  'accountSafety.pinReplaced.what.newDevice': 'The PIN on your SeeBuyGet account was replaced on a phone or browser that had not signed in to it before, with a code sent to your phone number and a code sent to this email address. Your PIN now works only there.',
  'accountSafety.pinReplaced.what.known': 'The PIN on your SeeBuyGet account was replaced, with a code sent to your phone number, on a phone or browser you had signed in on before. Your PIN now works only there.',
  'accountSafety.pinReplaced.next': 'If it was you, there is nothing to do. If it was not: replace your PIN again straight away (“forgot your PIN” on the sign-in screen) — that shuts out every other phone and browser — and ask your mobile network whether your number was moved to another SIM.',

  'accountSafety.newDevice.title': 'A new phone or browser can use your PIN',
  'accountSafety.newDevice.what': 'A code sent to your phone number was typed on a phone or browser that had not signed in to your SeeBuyGet account before. Your PIN now works there too.',
  'accountSafety.newDevice.next': 'If it was you, there is nothing to do. If it was not: replace your PIN straight away (“forgot your PIN” on the sign-in screen). That shuts out every other phone and browser. Nobody is in without your PIN — but somebody can read the messages sent to your number.',

  'accountSafety.emailChanged.title': 'Your recovery email was changed',
  'accountSafety.emailChanged.what': 'The email address on your SeeBuyGet account is now {email}. This address no longer receives its notices.',
  'accountSafety.emailChanged.next': 'If it was not you, sign in and change your PIN straight away, then set the recovery email again.',

  'accountSafety.closed.title': 'Your account was closed',
  'accountSafety.closed.what': 'Your SeeBuyGet account was closed. Your name, ID number, phone number, email and ID photos have been removed.',
  'accountSafety.closed.next': 'If it was not you, write to us at once from the SeeBuyGet help, under “My data, or closing my account”.',

  'accountSafety.moveAsked.title': 'Somebody asked for your account to be moved',
  'accountSafety.moveAsked.what': 'Somebody told SeeBuyGet that they have lost this account’s phone number and its PIN, and asked for the account to be moved to a number ending {ends}. Two members of staff check who is asking before anything changes.',
  'accountSafety.moveAsked.next': 'If that is you, there is nothing to do here. If it is NOT you: sign in to any SeeBuyGet app with your number and PIN — that alone stops it — then open Settings, where you can stop it yourself, and choose a new PIN.',

  'accountSafety.moveRefused.title': 'The request to move your account was refused',
  'accountSafety.moveRefused.what': 'SeeBuyGet staff looked at the request to move your account to another phone number, and refused it. Nothing about your account has changed.',
  'accountSafety.moveRefused.next': 'If you did not ask for it, choose a new PIN: somebody knows your phone number and tried to take the account.',

  'mail.safety.subject': 'SeeBuyGet: {headline}',
  'mail.safety.when': 'When',
  'mail.safety.until': 'Can be undone until',
  'mail.safety.whatToDo': 'What to do',
  'mail.safety.help': 'Help with signing in',
  'mail.safety.reason': 'You are getting this email because it is the recovery address on a SeeBuyGet account. We always tell you — this email cannot be turned off.',
  'mail.footer.noReply': 'Please do not reply — this address is not read.',
  'mail.footer.helpLead': 'Help with signing in and your account:',
  'mail.footer.helpLink': 'SeeBuyGet help',
} as const;
