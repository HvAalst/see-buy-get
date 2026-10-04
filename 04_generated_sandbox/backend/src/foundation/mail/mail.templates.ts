import { MailDocument, RenderedMail, renderDocument } from './mail.blocks';

/**
 * EVERY EMAIL THE NETWORK SENDS — its words, what it needs to be written, and when it goes.
 *
 * Two rules the words keep:
 *  1. **No email carries a credential that works on its own, except the reset code**, which is the one thing email
 *     exists to deliver here. A temporary password is handed over in person; a fleet code is read in the app; a
 *     parcel's collection code lives in the Send app (S22) — an inbox is forwarded, shared and read over shoulders.
 *  2. **Every change to how somebody signs in is told to them**, with what to do if it was not them. That notice
 *     cannot be turned off.
 */

/** The apps an email can send somebody to. */
export type MailApp = 'agent' | 'mdp' | 'fleet' | 'driver' | 'vendor' | 'send' | 'console' | 'home' | 'business';

export const APP_NAMES: Record<MailApp, string> = {
  agent: 'Shop app',
  mdp: 'Hub app',
  fleet: 'Fleet app',
  driver: 'Driver app',
  vendor: 'Store app',
  send: 'Send app',
  console: 'operator console',
  home: 'SeeBuyGet',
  business: 'Business app',
};

const PATHS: Record<MailApp, [number, string]> = {
  driver: [5173, '/driver/'],
  agent: [5175, '/agent/'],
  send: [5176, '/send/'],
  fleet: [5177, '/fleet/'],
  mdp: [5178, '/mdp/'],
  vendor: [5179, '/vendor/'],
  home: [5180, '/'],
  console: [5181, '/'],
  business: [5182, '/business/'],
};

/** Where a button goes. `SBG_PUBLIC_URL` in a deployment (e.g. https://app.seebuyget.com); the dev servers otherwise. */
export function appUrl(app: MailApp): string {
  // The operator console lives on its own address (e.g. https://ops.seebuyget.com), never under the public site.
  if (app === 'console' && process.env.SBG_CONSOLE_URL?.trim()) return `${process.env.SBG_CONSOLE_URL.trim().replace(/\/+$/, '')}/`;
  const base = process.env.SBG_PUBLIC_URL?.trim().replace(/\/+$/, '');
  const [port, path] = PATHS[app];
  return base ? `${base}${path}` : `http://localhost:${port}${path}`;
}

/** The help page (help.html). `SBG_HELP_URL`, else beside the public site. */
export function helpUrl(anchor?: string): string {
  const base = process.env.SBG_HELP_URL?.trim() || (process.env.SBG_PUBLIC_URL ? `${process.env.SBG_PUBLIC_URL.trim().replace(/\/+$/, '')}/help.html` : 'http://localhost:5180/help.html');
  return anchor ? `${base}#${anchor}` : base;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "13 Sep 2026, 17:42 UTC" — one unambiguous form for every reader, whatever their locale or time zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface MailParams {
  'password-reset': { email: string; code: string; minutes: number; app: MailApp };
  'password-changed': { email: string; when: string; app: MailApp; recovery: 'self-reset' | 'ask-admin' };
  welcome: { name: string; email: string; role: 'shop' | 'hub' | 'driver' };
  'company-admin-added': { name: string; email: string; company: string; addedBy: string };
  'staff-account-added': { name: string; email: string; addedBy: string };
  'staff-two-step': { name: string; what: string; next: string; when: string };
  'access-removed': { email: string; what: string; removedBy: string; when: string };
  'fleet-code-issued': { company: string; when: string; byStaff: boolean };
  'fleet-code-due': { company: string; days: number };
  'papers-due': { company: string; lapsed: string[]; due: string[] };
  'order-on-its-way': { store: string; orderRef?: string; shop: string; trackingUrl: string };
  'ready-for-collection': { shop: string; address?: string; collectBy: string; openUrl?: string };
  'freight-delivered': { code: string; description: string; destination: string; deliveredAt: string; carrier: string; driver?: string; receiverName?: string; amount?: number; currency?: string; noteNumber: string };
  /** A code to an address: to confirm it is theirs, to get back into the account, or to undo a number change. */
  'email-code': { code: string; minutes: number; why: 'confirm' | 'recover' | 'undo' };
  /** Something happened to the way somebody signs in. Always sent; cannot be turned off. */
  'account-safety': { headline: string; what: string; next: string; when: string; until?: string };
  /** Somebody asked to be told when the network reaches their country. Sent the moment they ask. */
  'interest-received': { country: string; kind: string };
  /** Two members of staff switched that country on. Sent by the approval itself, not by anybody remembering. */
  'country-open': { country: string; settles: boolean; company?: string; joinUrl: string };
  /** B1 — SeeBuyGet checked a business, or refused to, with the reason. Sent to its owners by the decision itself. */
  'business-checked': { business: string; outcome: 'verified' | 'refused'; reason?: string; when: string };
}

export type MailTemplateId = keyof MailParams;

export interface MailTemplate<P> {
  /** What it is, for the preview page. */
  title: string;
  /** The event that sends it. */
  sentWhen: string;
  /** False while nothing sends it yet: designed, waiting for its event to be plumbed. */
  wired: boolean;
  /** Believable data, for the preview page and the tests. */
  sample: P;
  build(params: P): MailDocument;
}

const WELCOME_INTRO: Record<MailParams['welcome']['role'], string> = {
  shop: 'Your shop is signed up. Before it can take parcels in, we check the papers you sent, and you will see the answer in the Shop app.',
  hub: 'Your hub is signed up. You can sign in to the Hub app now and start receiving bags.',
  driver: 'Your driver account is ready. The first time you open the Driver app, we send a code to your phone and you choose a PIN.',
};
const WELCOME_APP: Record<MailParams['welcome']['role'], MailApp> = { shop: 'agent', hub: 'mdp', driver: 'driver' };

const WOULD_BE: Record<string, string> = {
  carrier: 'carry freight',
  shop: 'take parcels in at your counter',
  hub: 'sort parcels between routes',
  store: 'ship your orders through us',
  other: 'work with us',
};

export const MAIL_TEMPLATES: { [K in MailTemplateId]: MailTemplate<MailParams[K]> } = {
  /*
   * THE ONLY THING THIS PROMISES IS THE ONE THE SYSTEM CAN KEEP.
   *
   * "We will get back to you" is a promise a person has to keep, and the first country with three
   * interested people and no plan is where it breaks — leaving a broken promise where an honest "not yet"
   * used to be. So it promises the switch-on itself, which is automatic, and says plainly that it may be
   * a long wait. Nobody is told a decision is coming.
   */
  'interest-received': {
    title: 'Thanks for asking about your country',
    sentWhen: 'Somebody leaves a message from a country the network does not reach yet.',
    wired: true,
    sample: { country: 'the Netherlands', kind: 'carrier' },
    build: (p) => ({
      subject: `Thanks — we have your note about ${p.country}`,
      preheader: `We will write again the day SeeBuyGet is switched on in ${p.country}.`,
      blocks: [
        { kind: 'heading', text: 'Thank you' },
        { kind: 'paragraph', text: `You told us you would ${WOULD_BE[p.kind] ?? WOULD_BE.other} in ${p.country}, and why. That is the thing we could not work out on our own, and it is what the decision gets made on.` },
        { kind: 'paragraph', text: 'Countries are switched on one at a time, deliberately, by two members of SeeBuyGet staff. It means a company, a tax registration and a way to pay people — so it is not quick, and we will not pretend a date we do not have.' },
        {
          kind: 'paragraph',
          text: `What we will do is write to you the day ${p.country} is switched on, and tell you which of two things it became: a country where a SeeBuyGet company contracts and pays you, or one where we match you with loads and you settle the money yourself with whoever you carry for.`,
        },
        { kind: 'paragraph', text: 'You do not need to do anything else, and you will not hear from us in between.' },
      ],
      reason: 'You are getting this email because you asked to be told when SeeBuyGet reaches your country.',
    }),
  },

  /*
   * THE PROMISE BEING KEPT — and it names WHICH of the two, because the difference is who handles the
   * money and who carries responsibility for it. Telling somebody "we are live" and letting them find out
   * afterwards that nobody there pays them would be the same false note the join form was just fixed for.
   */
  'country-open': {
    title: 'Your country is switched on',
    sentWhen: 'Two members of staff switch on a country somebody had asked about.',
    wired: true,
    sample: { country: 'the Netherlands', settles: false, joinUrl: 'https://seebuyget.com/' },
    build: (p) => ({
      subject: `SeeBuyGet is now in ${p.country}`,
      preheader: p.settles ? `${p.company ?? 'A SeeBuyGet company'} contracts and pays you there.` : `We match loads there; the money stays between you and whoever you carry for.`,
      blocks: [
        { kind: 'heading', text: `We have reached ${p.country}` },
        { kind: 'paragraph', text: 'You asked to be told, so here it is. You can register now.' },
        p.settles
          ? {
              kind: 'paragraph' as const,
              text: `${p.company ?? 'A SeeBuyGet company'} is the company you would be contracted by and paid by. Prices, invoices and payouts all run through it.`,
            }
          : {
              kind: 'warning' as const,
              title: 'Loads yes, money no — not yet',
              text: `We can match you with loads in ${p.country}, and you can register today. What we cannot do there is handle the money: there is no SeeBuyGet company in ${p.country}, so nobody of ours invoices, pays you, or carries any responsibility for what you are owed. You agree the price with whoever you carry for and settle it with them. When a company is established there, that changes and we will write again.`,
            },
        { kind: 'button', label: 'Register now', href: p.joinUrl },
      ],
      reason: 'You are getting this email because you asked to be told when SeeBuyGet reaches your country.',
    }),
  },

  'email-code': {
    title: 'A code for your email address',
    sentWhen: 'Somebody confirms a recovery email, recovers an account whose number is gone, or undoes a number change.',
    wired: true,
    sample: { code: '482915', minutes: 15, why: 'confirm' },
    build: (p) => {
      const WHY = {
        confirm: { heading: 'Confirm your email address', lead: 'Somebody is setting this address as the recovery email on a SeeBuyGet account. If that is you, here is your code.' },
        recover: { heading: 'Get back into your account', lead: 'Somebody asked to recover the SeeBuyGet account that uses this address, because its phone number is gone. If that is you, here is your code.' },
        undo: { heading: 'Undo a number change', lead: 'Somebody asked to undo the phone number change on your SeeBuyGet account. If that is you, here is your code.' },
      }[p.why];
      return {
        subject: `${p.code} is your SeeBuyGet code`,
        preheader: `Your code is ${p.code}. It works once, for ${p.minutes} minutes.`,
        blocks: [
          { kind: 'heading', text: WHY.heading },
          { kind: 'paragraph', text: WHY.lead },
          { kind: 'code', label: 'Your code', value: p.code, note: `It works once, for ${p.minutes} minutes.` },
          { kind: 'warning', title: 'Did not ask for this?', text: 'Ignore this email: nothing changes unless somebody types this code. Never pass it on — nobody from SeeBuyGet will ever ask you for it.' },
        ],
        reason: 'You are getting this email because this address was typed into a SeeBuyGet app.',
      };
    },
  },

  'business-checked': {
    title: 'Your business was checked',
    sentWhen: 'A second member of staff verifies a business, or a member of staff refuses to, with the reason.',
    wired: true,
    sample: { business: 'Abebe Import & Export PLC', outcome: 'verified', when: '2026-10-04T10:12:00Z' },
    build: (p) =>
      p.outcome === 'verified'
        ? {
            subject: `SeeBuyGet checked ${p.business}`,
            preheader: 'Your business is verified: carriers and clearing agents now see it as checked.',
            blocks: [
              { kind: 'heading', text: `${p.business} is verified` },
              { kind: 'paragraph', text: 'Two members of SeeBuyGet staff checked your registration certificate and the ID of the person speaking for the business. Carriers and clearing agents now see the business as checked, and it has its own public page.' },
              { kind: 'facts', rows: [['Business', p.business], ['When', formatWhen(p.when)]] },
              { kind: 'button', label: `Open the ${APP_NAMES.business}`, href: appUrl('business') },
            ],
            reason: 'You are getting this email because you are an owner of this business on SeeBuyGet.',
          }
        : {
            subject: `SeeBuyGet could not check ${p.business} yet`,
            preheader: p.reason ?? 'Something in the papers needs putting right.',
            blocks: [
              { kind: 'heading', text: 'We could not check your business yet' },
              { kind: 'paragraph', text: `SeeBuyGet staff looked at the papers for ${p.business} and could not verify it. This is what they said:` },
              { kind: 'warning', title: 'What needs putting right', text: p.reason ?? 'Open the Business app to see the reason.' },
              { kind: 'paragraph', text: 'Put it right in the Business app, then ask for the check again. Your business keeps working in the meantime.' },
              { kind: 'button', label: `Open the ${APP_NAMES.business}`, href: appUrl('business') },
            ],
            reason: 'You are getting this email because you are an owner of this business on SeeBuyGet.',
          },
  },

  'account-safety': {
    title: 'Something changed about how you sign in',
    sentWhen: 'A PIN is locked by wrong guesses, a phone number is changed or put back, an account is recovered, or the recovery email is replaced.',
    wired: true,
    sample: { headline: 'Your phone number was changed', what: 'Your SeeBuyGet account now signs in with a different phone number.', next: 'If it was not you: within 24 hours, open any SeeBuyGet app, choose “Trouble signing in?” and then “Undo a number change”.', when: '2026-10-01T17:42:00Z', until: '2026-10-02T17:42:00Z' },
    build: (p) => ({
      subject: `SeeBuyGet: ${p.headline.charAt(0).toLowerCase()}${p.headline.slice(1)}`,
      preheader: p.what,
      blocks: [
        { kind: 'heading', text: p.headline },
        { kind: 'paragraph', text: p.what },
        { kind: 'facts', rows: [['When', formatWhen(p.when)], ...(p.until ? ([['Can be undone until', formatWhen(p.until)]] as Array<[string, string]>) : [])] },
        { kind: 'warning', title: 'What to do', text: p.next },
        { kind: 'button', label: 'Help with signing in', href: helpUrl('account-recovery') },
      ],
      reason: 'You are getting this email because it is the recovery address on a SeeBuyGet account. We always tell you — this email cannot be turned off.',
    }),
  },

  'password-reset': {
    title: 'Password reset code',
    sentWhen: 'Somebody taps “I forgot my password” in the Shop or Hub app.',
    wired: true,
    sample: { email: 'amina@example.com', code: 'RST-4F9A2C1B', minutes: 30, app: 'agent' },
    build: (p) => ({
      subject: 'Your SeeBuyGet password reset code',
      preheader: `Your code is ${p.code}. It works once, for ${p.minutes} minutes.`,
      blocks: [
        { kind: 'heading', text: 'Reset your password' },
        { kind: 'paragraph', text: `Somebody asked to reset the password for ${p.email} in the ${APP_NAMES[p.app]}. If that was you, here is your code.` },
        { kind: 'code', label: 'Reset code', value: p.code, note: `It works once, for ${p.minutes} minutes.` },
        { kind: 'paragraph', text: 'Type it on the “Reset your password” screen in the app and choose a new password. Every other device signed in to your account is then signed out.' },
        { kind: 'button', label: `Open the ${APP_NAMES[p.app]}`, href: appUrl(p.app) },
        {
          kind: 'warning',
          title: 'Did not ask for this?',
          text: `You can ignore this email: your password only changes if somebody types this code in the next ${p.minutes} minutes. Never pass the code on — nobody from SeeBuyGet will ever ask you for it.`,
        },
      ],
      reason: 'You are getting this email because a password reset was requested for your SeeBuyGet account.',
    }),
  },

  'password-changed': {
    title: 'Password changed',
    sentWhen: 'A password is changed or reset — Shop and Hub accounts, company administrators, network staff.',
    wired: true,
    sample: { email: 'amina@example.com', when: '2026-09-13T17:42:00Z', app: 'agent', recovery: 'self-reset' },
    build: (p) => ({
      subject: 'Your SeeBuyGet password was changed',
      preheader: `The password for ${p.email} was changed on ${formatWhen(p.when)}.`,
      blocks: [
        { kind: 'heading', text: 'Your password was changed' },
        { kind: 'paragraph', text: `The password you use to sign in to the ${APP_NAMES[p.app]} has just been changed.` },
        { kind: 'facts', rows: [['Account', p.email], ['When', formatWhen(p.when)]] },
        { kind: 'paragraph', text: 'Every other phone or computer that was signed in has been signed out. If you made this change, there is nothing else to do.' },
        {
          kind: 'warning',
          title: 'Was this not you?',
          text:
            p.recovery === 'self-reset'
              ? 'Reset your password straight away: tap “I forgot my password” in the app. The code comes to this email address, so whoever changed your password cannot use it.'
              : 'Tell whoever administers your sign-in straight away, so they can take the login away and make you a new one.',
        },
        ...(p.recovery === 'self-reset' ? [{ kind: 'button' as const, label: `Open the ${APP_NAMES[p.app]}`, href: appUrl(p.app) }] : []),
      ],
      reason: 'You are getting this email because the password on your SeeBuyGet account changed. We always tell you — this email cannot be turned off.',
    }),
  },

  welcome: {
    title: 'Welcome',
    sentWhen: 'A shop, hub or courier signs up with an email address.',
    wired: true,
    sample: { name: 'Mama Sarah Shop', email: 'amina@example.com', role: 'shop' },
    build: (p) => ({
      subject: `Welcome to SeeBuyGet, ${p.name}`,
      preheader: WELCOME_INTRO[p.role],
      blocks: [
        { kind: 'heading', text: `Welcome, ${p.name}` },
        { kind: 'paragraph', text: WELCOME_INTRO[p.role] },
        { kind: 'facts', rows: [['Sign in with', p.role === 'driver' ? 'your phone number and PIN' : p.email]] },
        { kind: 'button', label: `Open the ${APP_NAMES[WELCOME_APP[p.role]]}`, href: appUrl(WELCOME_APP[p.role]) },
        { kind: 'note', text: `Keep your ${p.role === 'driver' ? 'PIN' : 'password'} to yourself. Nobody from SeeBuyGet will ever ask you for it — not by email, phone or message.` },
      ],
      reason: 'You are getting this email because this address was used to sign up to SeeBuyGet.',
    }),
  },

  'company-admin-added': {
    title: 'Company administrator added',
    sentWhen: 'Somebody creates an administrator login for a company in the operator console.',
    wired: true,
    sample: { name: 'Wanjiru Kamau', email: 'wanjiru@sbg-ke.example', company: 'SeeBuyGet Kenya', addedBy: 'Amina Otieno' },
    build: (p) => ({
      subject: `You now administer ${p.company} on SeeBuyGet`,
      preheader: `${p.addedBy} made you an administrator of ${p.company}.`,
      blocks: [
        { kind: 'heading', text: 'You are now an administrator' },
        { kind: 'paragraph', text: `${p.addedBy} added you, ${p.name}, as an administrator of ${p.company}. You can see what the company charges and change it, and every change you make is recorded against your name.` },
        { kind: 'facts', rows: [['Company', p.company], ['Sign in with', p.email], ['On the sign-in screen', 'Choose “A company”']] },
        { kind: 'paragraph', text: 'Your first password is handed to you in person. It is never sent by email. Change it after your first sign-in, with “Change password” at the top of the console.' },
        { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
        { kind: 'warning', title: 'Not expecting this?', text: `Tell ${p.addedBy} or another administrator of ${p.company}. Nothing happens until somebody signs in.` },
      ],
      reason: 'You are getting this email because an administrator login was created for this address.',
    }),
  },

  'staff-account-added': {
    title: 'Network staff account added',
    sentWhen: 'A member of staff (or the setup key) creates a staff account.',
    wired: true,
    sample: { name: 'Chloe Wanjiru', email: 'chloe@seebuyget.example', addedBy: 'Amina Otieno' },
    build: (p) => ({
      subject: 'Your SeeBuyGet staff sign-in',
      preheader: `${p.addedBy} made a network staff account for you.`,
      blocks: [
        { kind: 'heading', text: 'You have a staff sign-in' },
        { kind: 'paragraph', text: `${p.addedBy} made a network staff account for you, ${p.name}. Every decision you take in the operator console is recorded against this name — including the ones that need a second person.` },
        { kind: 'facts', rows: [['Sign in with', p.email], ['On the sign-in screen', 'Choose “Network staff”']] },
        { kind: 'paragraph', text: 'Your first password is handed to you in person and never sent by email. Change it after your first sign-in.' },
        { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
        { kind: 'warning', title: 'Not expecting this?', text: `Tell ${p.addedBy}. Nothing happens until somebody signs in.` },
      ],
      reason: 'You are getting this email because a SeeBuyGet staff account was created for this address.',
    }),
  },

  'staff-two-step': {
    title: 'Staff two-step sign-in reset',
    sentWhen: 'Two other members of staff reset somebody’s two-step sign-in, because they lost their authenticator.',
    wired: true,
    sample: { name: 'Chloe Wanjiru', what: 'Your two-step sign-in was reset by Amina Otieno and Brian Kamau.', next: 'You were signed out. The next time you sign in, scan the new QR code with your authenticator app. If you did not ask for this, tell them at once.', when: '2026-10-03T09:12:00Z' },
    build: (p) => ({
      subject: 'SeeBuyGet: your staff two-step sign-in was reset',
      preheader: p.what,
      blocks: [
        { kind: 'heading', text: 'Your two-step sign-in was reset' },
        { kind: 'paragraph', text: `${p.name}, ${p.what.charAt(0).toLowerCase()}${p.what.slice(1)}` },
        { kind: 'facts', rows: [['When', formatWhen(p.when)]] },
        { kind: 'warning', title: 'What happens now', text: p.next },
        { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
      ],
      reason: 'You are getting this email because it is the sign-in of a SeeBuyGet staff account. We always tell you — this email cannot be turned off.',
    }),
  },

  'access-removed': {
    title: 'Sign-in removed',
    sentWhen: 'A company administrator or a staff account is taken away.',
    wired: true,
    sample: { email: 'wanjiru@sbg-ke.example', what: 'administrator login for SeeBuyGet Kenya', removedBy: 'Amina Otieno', when: '2026-09-13T17:42:00Z' },
    build: (p) => ({
      subject: 'Your SeeBuyGet sign-in was removed',
      preheader: `${p.removedBy} removed your ${p.what}.`,
      blocks: [
        { kind: 'heading', text: 'Your sign-in was removed' },
        { kind: 'paragraph', text: `${p.removedBy} removed your ${p.what} on ${formatWhen(p.when)}. You can no longer sign in with ${p.email}, and any session that was still open has ended.` },
        { kind: 'paragraph', text: 'What you did while you had access stays on record under your name.' },
        { kind: 'warning', title: 'Think this is a mistake?', text: `Talk to ${p.removedBy}. Only somebody who still has access can give it back.` },
      ],
      reason: 'You are getting this email because a SeeBuyGet sign-in for this address was removed.',
    }),
  },

  'fleet-code-issued': {
    title: 'New fleet code issued',
    sentWhen: 'A fleet manager or network staff issue a new fleet sign-in code (to the fleet’s contact email).',
    wired: true,
    sample: { company: 'Kilima Logistics', when: '2026-09-13T17:42:00Z', byStaff: false },
    build: (p) => ({
      subject: `A new fleet code for ${p.company}`,
      preheader: 'The old code no longer works. Phone and PIN sign-ins are unchanged.',
      blocks: [
        { kind: 'heading', text: 'Your fleet has a new sign-in code' },
        { kind: 'paragraph', text: `${p.byStaff ? 'SeeBuyGet staff' : 'One of your fleet managers'} issued a new sign-in code for ${p.company} on ${formatWhen(p.when)}. The old code stopped working at that moment.` },
        { kind: 'paragraph', text: 'The code is not in this email. Anyone who manages the fleet can read it in the Fleet app: Dashboard, then Fleet sign-in code.' },
        { kind: 'paragraph', text: 'Nobody was signed out: managers keep signing in with their own phone number and PIN.' },
        { kind: 'button', label: 'Open the Fleet app', href: appUrl('fleet') },
        { kind: 'warning', title: 'Not expecting this?', text: 'Ask your other managers who issued it. If nobody did, issue another code yourself and change your PIN.' },
      ],
      reason: 'You are getting this email because it is the contact address of a fleet on SeeBuyGet.',
    }),
  },

  'fleet-code-due': {
    title: 'Fleet code over 90 days old',
    sentWhen: 'A daily check finds a fleet code over 90 days old — once per code.',
    wired: true,
    sample: { company: 'Kilima Logistics', days: 104 },
    build: (p) => ({
      subject: `Time for a new ${p.company} fleet code`,
      preheader: `Your fleet sign-in code is ${p.days} days old.`,
      blocks: [
        { kind: 'heading', text: 'Time for a new fleet code' },
        { kind: 'paragraph', text: `The sign-in code for ${p.company} is ${p.days} days old. Codes get written down, passed on and remembered by people who have since left, so we suggest a new one every 90 days.` },
        { kind: 'paragraph', text: 'It takes a minute: Fleet app, Dashboard, then “Issue a new code”. Tell your managers the new code — nobody is signed out.' },
        { kind: 'button', label: 'Open the Fleet app', href: appUrl('fleet') },
        { kind: 'note', text: 'We send this once for each code. Nothing changes if you ignore it.' },
      ],
      reason: 'You are getting this email because it is the contact address of a fleet on SeeBuyGet.',
    }),
  },

  'papers-due': {
    title: 'Papers running out, and vehicles off the road (fleet)',
    sentWhen: 'The six-hourly papers check finds a vehicle or driver paper lapsed or due within 30 days — once per paper per expiry date.',
    wired: true,
    sample: { company: 'Kilima Logistics', lapsed: ['Vehicle KLM 002B — Insurance lapsed 3 Sep 2026'], due: ['Vehicle KLM 001V — Inspection certificate runs out 12 Oct 2026 (28 days)', 'Driver Amos K. — Driving licence runs out 20 Oct 2026 (36 days)'] },
    build: (p) => ({
      subject: p.lapsed.length ? `${p.lapsed.length} off the road at ${p.company} — papers lapsed` : `Papers running out at ${p.company}`,
      preheader: p.lapsed.length
        ? `${p.lapsed.length === 1 ? 'A vehicle or driver' : `${p.lapsed.length} vehicles or drivers`} cannot start a shift until their papers are renewed.`
        : `${p.due.length === 1 ? 'A paper runs' : `${p.due.length} papers run`} out within 30 days.`,
      blocks: [
        { kind: 'heading', text: p.lapsed.length ? 'Papers lapsed — off the road' : 'Papers running out' },
        ...(p.lapsed.length
          ? [
              { kind: 'paragraph', text: 'These cannot start a shift, and any shift they were on has been ended, until the renewed paper and its new date are recorded in the Fleet app:' } as const,
              { kind: 'facts', rows: p.lapsed.map((l, i) => [String(i + 1), l] as [string, string]) } as const,
            ]
          : []),
        ...(p.due.length
          ? [
              { kind: 'paragraph', text: 'Running out within 30 days — renew in time and record the new date, or shifts stop on that day:' } as const,
              { kind: 'facts', rows: p.due.map((l, i) => [String(i + 1), l] as [string, string]) } as const,
            ]
          : []),
        { kind: 'button', label: 'Open the Fleet app', href: appUrl('fleet') },
        { kind: 'note', text: 'A paper with no date recorded switches nothing off — but nothing protects you either. Record the dates and the network watches them for you.' },
      ],
      reason: 'You are getting this email because it is the contact address of a fleet on SeeBuyGet.',
    }),
  },
  'order-on-its-way': {
    title: 'Order on its way (buyer)',
    sentWhen: 'A store hands an order to the network, to the email the buyer gave the store.',
    wired: true,
    sample: { store: 'Nairobi Threads', orderRef: '#10482', shop: 'Mama Sarah Shop', trackingUrl: 'http://localhost:5176/send/' },
    build: (p) => ({
      subject: `Your ${p.store} order is on its way`,
      preheader: `It is going to ${p.shop}. We will tell you when it is ready to collect.`,
      blocks: [
        { kind: 'heading', text: 'Your order is on its way' },
        { kind: 'paragraph', text: `${p.store} has sent your order${p.orderRef ? ` ${p.orderRef}` : ''} to ${p.shop}, the shop you chose. We will email you again when it is ready to collect.` },
        { kind: 'button', label: 'Track your parcel', href: p.trackingUrl },
        {
          kind: 'paragraph',
          text: 'Sign in to the Send app with the phone number you gave the store, and this parcel is already there: you are told the moment it arrives, your collection code is kept safe in the app, and you can message the shop directly — to ask when they are open, or to say when you are coming.',
        },
        { kind: 'note', text: 'For your safety the code is never sent by email, and nobody from SeeBuyGet or the shop will ask you for it before you are at the counter.' },
      ],
      reason: `You are getting this email because you ordered from ${p.store} and chose to collect at a SeeBuyGet shop.`,
    }),
  },

  'freight-delivered': {
    title: 'Load delivered — receipt (shipper)',
    sentWhen: 'A driver delivers a load, to the email of the shop that posted it.',
    wired: true,
    sample: { code: 'FRT-010', description: 'Maize, 20 sacks', destination: 'Riverside Corner', deliveredAt: '2026-09-14T12:04:00Z', carrier: 'Kilima Logistics', driver: 'Amos K.', receiverName: 'Wanjiru (Riverside Corner)', amount: 350, currency: 'KES', noteNumber: 'CMR-FRT-010' },
    build: (p) => ({
      subject: `Delivered: ${p.code} — ${p.description}`,
      preheader: `Your load reached ${p.destination} on ${formatWhen(p.deliveredAt)}.`,
      blocks: [
        { kind: 'heading', text: 'Your load was delivered' },
        { kind: 'paragraph', text: `${p.carrier}${p.driver ? ` (driver ${p.driver})` : ''} delivered ${p.code}, ${p.description}, to ${p.destination}.` },
        {
          kind: 'facts',
          rows: [
            ['Load', p.code],
            ['Delivered', formatWhen(p.deliveredAt)],
            ...(p.receiverName ? [['Received by', p.receiverName] as [string, string]] : []),
            ['Carrier', p.carrier],
            ...(p.amount != null ? [['Carriage charges', `${p.amount.toFixed(2)} ${p.currency ?? ''}`.trim()] as [string, string]] : []),
            ['Consignment note', p.noteNumber],
          ],
        },
        { kind: 'paragraph', text: 'The consignment note — sender, carrier, vehicle, goods, taking over and delivery — is on the load in the Shop app under Freight. Open it there to print or save it for your books.' },
        { kind: 'button', label: 'Open the Shop app', href: appUrl('agent') },
        { kind: 'note', text: 'Something wrong with the delivery? Say so from the load in the app; a note that says “not recorded” is one the receiver has not yet confirmed.' },
      ],
      reason: 'You are getting this email because your shop posted this load on SeeBuyGet.',
    }),
  },

  'ready-for-collection': {
    title: 'Ready to collect (buyer)',
    sentWhen: 'A parcel is shelved at the collection shop, to the email the buyer gave the store.',
    wired: true,
    sample: { shop: 'Mama Sarah Shop', address: 'Biashara St 12, Nairobi', collectBy: '2026-09-20T18:00:00Z' },
    build: (p) => ({
      subject: `Your parcel is ready at ${p.shop}`,
      preheader: `Collect it by ${formatDate(p.collectBy)}.`,
      blocks: [
        { kind: 'heading', text: 'Your parcel is ready to collect' },
        { kind: 'facts', rows: [['Where', p.address ? `${p.shop}, ${p.address}` : p.shop], ['Collect by', formatDate(p.collectBy)]] },
        { kind: 'paragraph', text: 'Open the Send app with the phone number you gave the store, show your collection code at the counter, and the shopkeeper hands your parcel over.' },
        { kind: 'button', label: 'Open the Send app', href: p.openUrl ?? appUrl('send') },
        { kind: 'note', text: 'The code is only in the app, never in an email. Cannot make it in time, or not sure when the shop is open? Message the shop from the parcel in the app.' },
      ],
      reason: 'You are getting this email because a parcel for you is waiting at a SeeBuyGet shop.',
    }),
  },
};

/** Write one email: the words for these parameters, rendered to HTML and text inside the shared layout. */
export function renderMail<K extends MailTemplateId>(template: K, params: MailParams[K]): RenderedMail {
  const def = MAIL_TEMPLATES[template] as MailTemplate<MailParams[K]>;
  return renderDocument(def.build(params), { helpUrl: helpUrl(), logoUrl: process.env.MAIL_LOGO_URL });
}
