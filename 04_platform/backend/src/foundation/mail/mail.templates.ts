import { MailBlock, MailDocument, RenderedMail, renderDocument } from './mail.blocks';
import { fontsBase } from './mail.brand';

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

/** The help (the front door's /help/, an article at /help/<id>/). `SBG_HELP_URL`, else on the public site. */
export function helpUrl(article?: string): string {
  const base = (process.env.SBG_HELP_URL?.trim() || (process.env.SBG_PUBLIC_URL ? `${process.env.SBG_PUBLIC_URL.trim().replace(/\/+$/, '')}/help/` : 'http://localhost:5180/help/')).replace(/\/*$/, '/');
  return article ? `${base}${article}/` : base;
}

/** What a message to us was about, in the words the help offered (support.types.ts). */
const SUPPORT_TOPIC: Record<string, string> = {
  'sign-in': 'Signing in, a PIN, a password or a code',
  parcel: 'A parcel: sending, collecting or tracking it',
  damage: 'Something broken, opened or missing',
  money: 'Money: a fee, a payout or a top-up',
  joining: 'Signing up, or getting approved',
  business: 'A business account, freight or the API',
  safety: 'Safety, or something that looks wrong',
  privacy: 'My data, or closing my account',
  other: 'Something else',
};

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
  /** Five wrong passwords at one account locked its sign-in. Sent to the holder by the try that locked it. */
  'password-locked': { email: string; app: MailApp; when: string; until: string; recovery: 'self-reset' | 'ask-admin' };
  welcome: { name: string; email: string; role: 'shop' | 'hub' | 'driver' | 'store' };
  'company-admin-added': { name: string; email: string; company: string; addedBy: string };
  'staff-account-added': { name: string; email: string; addedBy: string };
  /** A new member of staff chooses their own password by this link. Nobody on staff is ever shown one. */
  'staff-account-welcome': { name: string; email: string; addedBy: string; link: string; hours: number };
  'staff-two-step': { name: string; what: string; next: string; when: string };
  /** Who is on staff changed, or somebody asked for it to: said to members of staff. */
  'staff-account-news': { what: string; next: string; when: string };
  /** The system raised a company's payout run this morning: one member of staff with the money role checks it and approves sending (2026-10-27). */
  'payout-run-waiting': { company: string; day: string; count: number; total: string; skipped: number };
  'access-removed': { email: string; what: string; removedBy: string; when: string };
  'fleet-code-issued': { company: string; when: string; byStaff: boolean };
  /** A fleet that signed itself up on the front page: its papers were received, approved, sent back with the reason, or it is active. */
  'fleet-signup': { company: string; stage: 'received' | 'approved' | 'refused' | 'active'; reason?: string; when: string };
  'fleet-code-due': { company: string; days: number };
  'papers-due': { company: string; lapsed: string[]; due: string[] };
  /** Round 40 — the trail's head, once a day, to the auditor SeeBuyGet staff named. */
  'trail-head': { date: string; height: number; txId: string; whole: boolean; brokenAt?: number };
  /** Round 40 — this address now receives the daily head. */
  'trail-auditor-named': { to: string; proposedBy: string; approvedBy: string; at: string; nextAt: string };
  /** Round 40 — the daily head now goes to another address: told to the one it went to. */
  'trail-auditor-changed': { from: string; to: string; proposedBy: string; approvedBy: string; at: string; nextAt: string };
  /** Somebody wrote to us from the help (support.service.ts): thanked, with the reference to quote. */
  'support-received': { reference: string; category: string; message: string };
  /** A member of staff answered a message written from the help. */
  'support-answer': { reference: string; asked: string; answer: string; by: string };
  /** A country was lowered: what stops there for this participant, what does not, and which app they use. */
  'country-changed': { country: string; lost: string[]; kept: string[]; app: MailApp };
  /**
   * A licence or an insurance policy of one of OUR companies is running out, or has lapsed — to that company's own
   * administrators. `stops`: what switches off the day after, in words; empty when nothing does by itself.
   * `daysLeft` 0 is the expiry date itself.
   */
  'company-paper-lapsing': { company: string; country?: string; paper: string; reference: string; expiresOn: string; daysLeft: number; lapsed: boolean; stops: string[]; where: 'licence' | 'insurance'; /** The company keeps its own record (it is switched on): it enters the new date itself, with the paper. */ own: boolean };
  /** A company's own administrator changed a part of its record that switches something. Sent to the OTHER administrators, and those of the company above it. */
  'company-record-changed': { company: string; by: string; part: string; change: 'added' | 'changed' | 'removed'; was: string; now: string; paper: boolean };
  /** A paper on a company's record was reported as not right. To its administrators and those of the company above it: what was said, never by whom. */
  'company-paper-reported': { company: string; paper: string; said: string; note: string; answerBy: string };
  /** The report was decided: dismissed by one member of staff, or the paper struck by two. `effect`: what a strike put back, in words. */
  'company-paper-decided': { company: string; paper: string; outcome: 'dismissed' | 'struck'; reason: string; effect: string };
  'order-on-its-way': { store: string; orderRef?: string; shop: string; trackingUrl: string };
  'ready-for-collection': { shop: string; address?: string; collectBy: string; openUrl?: string };
  'freight-delivered': { code: string; description: string; destination: string; deliveredAt: string; carrier: string; driver?: string; receiverName?: string; /** D9 — what the receiver found not as the note says, in words. */ reservations?: string; amount?: number; currency?: string; noteNumber: string; /** A link that opens the note with nobody signed in, and when it stops. */ noteUrl?: string; noteUntil?: string; /** It goes to one of a BUSINESS's people: its name, and whether they posted the load or are an owner told in the poster's place. */ business?: { name: string; as: 'poster' | 'owner' } };
  /** A code to an address: to confirm it is theirs, to get back into the account, or to undo a number change. */
  'email-code': { code: string; minutes: number; why: 'confirm' | 'recover' | 'undo' };
  /** Something happened to the way somebody signs in. Always sent; cannot be turned off. */
  'account-safety': { headline: string; what: string; next: string; when: string; until?: string };
  /** Four years without a sign-in: the account can be closed, if its owner wants (the user, 2026-10-22). */
  'account-may-close': { lastSignInAt: string };
  /**
   * The day before somebody is expected in person: when, where, and what to bring. `yours` — they made the
   * appointment; false, the other person did and this one may come too. `fits` false: the office has since changed
   * when it receives visitors, and the reminder says to choose again instead of what to bring.
   */
  'appointment-reminder': { yours: boolean; fits: boolean; day: string; hour?: string; where: string; reference: string; bring: string[] };
  /** Somebody asked to be told when the network reaches their country. Sent the moment they ask. */
  'interest-received': { country: string; kind: string };
  /** Two members of staff switched that country on. Sent by the approval itself, not by anybody remembering. */
  'country-open': { country: string; settles: boolean; company?: string; joinUrl: string };
  /** 2026-10-25 — a country somebody asked about takes sign-ups before it opens: they can sign up now, and start the day it opens. */
  'country-coming': { country: string; joinUrl: string };
  /** 2026-10-25 — a country people signed up in while it was coming is open: each told whether they can start today. */
  'country-opened': { country: string; ready: boolean; company?: string; app: MailApp };
  /** 2026-10-25 — a company of ours switched on in a country people already worked in: who they work with from today. */
  'country-established': { country: string; company: string; asked: boolean; app: MailApp };
  /** 2026-10-25 — the same day, to the people who asked about that country and were told no company of ours was there yet. */
  'country-settles': { country: string; company: string; joinUrl: string };
  /** B1 — SeeBuyGet checked a business, or refused to, with the reason. Sent to its owners by the decision itself. */
  'business-checked': { business: string; outcome: 'verified' | 'refused'; reason?: string; when: string };
  /** Round 10 — a business's own system has not taken our messages about its loads. To its owners, at most once a day. */
  'business-system-down': { business: string; count: number; since: string };
  /** Messages to a fleet's own system were given up after two days of tries (round 11). At most once a day, to its contact email. */
  'fleet-system-down': { fleet: string; count: number; since: string };
  /** A version of the API a company's key calls stops, announced a year ahead and said again a month before (round 12). */
  'api-version-retiring': { company: string; version: string; retiresAt: string; stage: 'announced' | 'month'; app: 'business' | 'fleet' };
  /**
   * A problem was reported on one of a store's shipments, and the store names an insurer on its shipping policy: the
   * damage claim report, by a link. Sent the moment the report is made. `by`: who reported the problem.
   */
  'damage-report': { number: string; parcelId: string; orderNumber?: string; store: string; insurer: string; reportedAt: string; by: 'receiver' | 'shop'; problem: string; from: string; to: string; url: string; until: string };
}

export type MailTemplateId = keyof MailParams;

export interface MailTemplate<P> {
  /** What it is, for the preview page. */
  title: string;
  /** The event that sends it. */
  sentWhen: string;
  /** False while nothing sends it yet: designed, waiting for its event to be plumbed. */
  wired: boolean;
  /**
   * HOW LONG IT STAYS WORTH SENDING, in hours, once it could not be handed over — or `false`: never sent late.
   * Every email answers this for itself; there is no default, because the two wrong answers are both bad: a notice
   * sent once and lost, or a code arriving after the one that replaced it.
   */
  sendLater: number | false;
  /**
   * SOMEBODY AT A SCREEN ASKED FOR IT, to an address they typed: a code. It goes even to an address email has come
   * back from — it is the one way such an address proves it works again — and it is never sent late.
   */
  asked?: true;
  /**
   * STILL GOES TO AN ACCOUNT AT REST (muted by its owner): it is about that account's own safety, or an answer to
   * something its owner wrote. Everything else waits for them to unmute — a code (`asked`) goes regardless.
   */
  stillToRest?: true;
  /** Believable data, for the preview page and the tests. */
  sample: P;
  /** The same email as somebody else gets it, where who it goes to changes what it says. For the preview page. */
  also?: Array<{ key: string; label: string; sample: P }>;
  build(params: P): MailDocument;
}

const WELCOME_INTRO: Record<MailParams['welcome']['role'], string> = {
  shop: 'Your shop is signed up. Before it can take parcels in, we check the papers you sent, and you will see the answer in the Shop app.',
  hub: 'Your hub is signed up. You can sign in to the Hub app now and start receiving bags.',
  store: 'Your store has an account. Sign in to the Store app with this email address and the password you chose. Your signing secret is for your own systems: it no longer signs anybody in, and you can replace it from the Store app with your password.',
  driver: 'Your driver account is ready. Open the Driver app and sign in with your phone number and the PIN you chose when you signed up.',
};
const WELCOME_APP: Record<MailParams['welcome']['role'], MailApp> = { shop: 'agent', hub: 'mdp', driver: 'driver', store: 'vendor' };

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
    // A thank-you is still one two days on.
    sendLater: 48,
    sample: { country: 'the Netherlands', kind: 'carrier' },
    build: (p) => ({
      subject: `Thanks — we have your note about ${p.country}`,
      preheader: `We will write again the day you can sign up in ${p.country}, and the day it opens.`,
      blocks: [
        { kind: 'heading', text: 'Thank you' },
        { kind: 'paragraph', text: `You told us you would ${WOULD_BE[p.kind] ?? WOULD_BE.other} in ${p.country}, and why. That is the thing we could not work out on our own, and it is what the decision gets made on.` },
        { kind: 'paragraph', text: 'Countries are switched on one at a time, deliberately, by two members of SeeBuyGet staff. It means a company, a tax registration and a way to pay people — so it is not quick, and we will not pretend a date we do not have.' },
        {
          kind: 'paragraph',
          // COMING (2026-10-25): sign-ups may open before the country does — then that is said first, and the opening after.
          text: `What we will do is write to you the day you can sign up in ${p.country}. If sign-ups open before the country does, we write again the day it opens. Either way we tell you which of two things it became: a country where a SeeBuyGet company contracts and pays you, or one where we match you with loads and you settle the money yourself with whoever you carry for.`,
        },
        { kind: 'paragraph', text: 'You do not need to do anything else, and we write to you about nothing else.' },
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
    // They asked to be told; late is still told.
    sendLater: 72,
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

  /*
   * COMING (the user, 2026-10-25: "can preregister before a country goes live"). Not "we are here": the country is not
   * open, and the mail says so before it says anything else — what it offers is the sign-up and the check of papers
   * ahead of the day, so they can start on it.
   */
  'country-coming': {
    title: 'Your country takes sign-ups (opening soon)',
    sentWhen: 'Two members of staff mark a country somebody had asked about as coming: it takes sign-ups before it opens.',
    wired: true,
    // They asked to be told; late is still told.
    sendLater: 72,
    sample: { country: 'Uganda', joinUrl: 'https://seebuyget.com/' },
    build: (p) => ({
      subject: `SeeBuyGet is coming to ${p.country}: sign up now`,
      preheader: 'It is not open yet. Sign up now and your papers are checked before the day it opens.',
      blocks: [
        { kind: 'heading', text: `SeeBuyGet is coming to ${p.country}` },
        { kind: 'paragraph', text: 'You asked to be told. It is not open yet, but you can sign up now: your account is made and your papers are checked before the day it opens, so you can start on that day.' },
        { kind: 'paragraph', text: 'We write again the day it opens.' },
        { kind: 'button', label: 'Sign up now', href: p.joinUrl },
      ],
      reason: 'You are getting this email because you asked to be told when SeeBuyGet reaches your country.',
    }),
  },

  /*
   * THE DAY IT OPENS, to everybody who signed up while it was coming — whether they can start today, and who they
   * work with there (or that nobody of ours handles the money yet, said as plainly as the waiting list is told).
   */
  'country-opened': {
    title: 'Your country is open (signed up before it opened)',
    sentWhen: 'A country people signed up in while it was coming is switched on — to everybody registered there who gave an email address. The apps say it in their inbox as well.',
    wired: true,
    sendLater: 72,
    sample: { country: 'Uganda', ready: true, company: 'SeeBuyGet Uganda Ltd', app: 'agent' },
    build: (p) => ({
      subject: `SeeBuyGet is open in ${p.country} from today`,
      preheader: p.ready ? 'You signed up before it opened: you can start today.' : 'Your sign-up is not finished yet: you start the day it is.',
      blocks: [
        { kind: 'heading', text: `SeeBuyGet is open in ${p.country}` },
        {
          kind: 'paragraph',
          text: p.ready
            ? 'You signed up before it opened, and your papers are checked: you can start today.'
            : 'You signed up before it opened, and your sign-up is not finished yet: you start the day it is. What is left is said where you signed up.',
        },
        p.company
          ? { kind: 'paragraph' as const, text: `${p.company} is the company you work with there.` }
          : {
              kind: 'warning' as const,
              title: 'Work yes, money no — not yet',
              text: `No SeeBuyGet company handles money in ${p.country} yet. What you earn is agreed and settled with whoever you work for. When a company is established there, that changes.`,
            },
        { kind: 'button', label: 'Open the app', href: appUrl(p.app) },
      ],
      reason: `You are getting this email because you are registered with SeeBuyGet in ${p.country}. It is about the service you use there, so it cannot be turned off.`,
    }),
  },

  /*
   * A COMPANY OF OURS SWITCHED ON where people already worked with nobody of ours behind them (the user, 2026-10-25):
   * the promise the opening made — "when a company is established there, that changes" — kept, by the approval itself.
   */
  'country-established': {
    title: 'A company of ours now runs SeeBuyGet in your country',
    sentWhen: 'Two members of staff switch on a company of ours in a country that was already open — to everybody registered there who gave an email address, with the country’s terms naming it. The apps say it in their inbox as well.',
    wired: true,
    sendLater: 72,
    sample: { country: 'Uganda', company: 'SeeBuyGet Uganda Limited', asked: true, app: 'agent' },
    build: (p) => ({
      subject: `${p.company} runs SeeBuyGet in ${p.country} from today`,
      preheader: `It is the company you work with in ${p.country} from today.`,
      blocks: [
        { kind: 'heading', text: `${p.company} runs SeeBuyGet in ${p.country}` },
        { kind: 'paragraph', text: `From today, ${p.company} is the company you work with in ${p.country}. Until now no company of ours handled money there.` },
        {
          kind: 'paragraph',
          text: p.asked
            ? `Its terms of use for ${p.country} are in your app. You are asked to read them and agree the next time you open it.`
            : `Its terms of use for ${p.country} are in your app, to read.`,
        },
        { kind: 'button', label: 'Open the app', href: appUrl(p.app) },
      ],
      reason: `You are getting this email because you are registered with SeeBuyGet in ${p.country}. It is about the service you use there, so it cannot be turned off.`,
    }),
  },

  /*
   * THE OTHER HALF OF THAT PROMISE: the waiting list was told, the day the country opened with nobody of ours behind the
   * money, "when a company is established there, that changes and we will write again" (country-open). This is that.
   */
  'country-settles': {
    title: 'A company of ours now runs SeeBuyGet in the country you asked about',
    sentWhen: 'Two members of staff switch on a company of ours in a country that opened without one — to the people who asked to be told about it and were told no company of ours was there yet, unless they have signed up there since.',
    wired: true,
    sendLater: 72,
    sample: { country: 'Uganda', company: 'SeeBuyGet Uganda Limited', joinUrl: 'https://seebuyget.com/' },
    build: (p) => ({
      subject: `${p.company} runs SeeBuyGet in ${p.country} from today`,
      preheader: 'We said we would write again when a company of ours handled the money there. One does now.',
      blocks: [
        { kind: 'heading', text: `${p.company} runs SeeBuyGet in ${p.country}` },
        {
          kind: 'paragraph',
          text: `When SeeBuyGet opened in ${p.country}, we wrote that no company of ours handled the money there yet, and that we would write again when one did. From today, ${p.company} does: it contracts with the shops, sort hubs, drivers, fleets and stores that work with SeeBuyGet there, and pays them.`,
        },
        { kind: 'paragraph', text: 'If you have not signed up yet, you can now.' },
        { kind: 'button', label: 'Sign up', href: p.joinUrl },
      ],
      reason: 'You are getting this email because you asked to be told when SeeBuyGet reaches your country.',
    }),
  },

  'email-code': {
    title: 'A code for your email address',
    sentWhen: 'Somebody confirms a recovery email, recovers an account whose number is gone, or undoes a number change.',
    wired: true,
    // A code is asked for by somebody waiting at a screen. Late, it has run out or been replaced by the one they asked for next.
    sendLater: false,
    asked: true,
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
    // The decision stands; the app shows it either way.
    sendLater: 72,
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

  'business-system-down': {
    title: 'Your system is not taking our messages',
    sentWhen: 'Messages to a business’s own system about its loads were given up after two days of tries. At most once a day, to its owners.',
    wired: true,
    // A day late it is still true, and still the only way an owner hears it without opening the app.
    sendLater: 24,
    sample: { business: 'Abebe Import & Export PLC', count: 3, since: '2026-10-18T06:40:00Z' },
    build: (p) => ({
      subject: `${p.business}: your system is not taking our messages`,
      preheader: `${p.count === 1 ? 'A message' : `${p.count} messages`} about your loads could not be delivered.`,
      blocks: [
        { kind: 'heading', text: 'Your system is not taking our messages' },
        { kind: 'paragraph', text: `Since ${formatWhen(p.since)}, ${p.count === 1 ? 'a message' : `${p.count} messages`} about your loads could not be delivered to your system, and we stopped trying after two days. Your loads are not affected: they are in the ${APP_NAMES.business} as always.` },
        { kind: 'paragraph', text: `Put your system right, then open Your system in the ${APP_NAMES.business}: it says what went wrong with each, and sends ${p.count === 1 ? 'it' : 'them'} again.` },
        { kind: 'facts', rows: [['Business', p.business], ['Messages given up', String(p.count)], ['Since', formatWhen(p.since)]] },
        { kind: 'button', label: `Open the ${APP_NAMES.business}`, href: appUrl('business') },
      ],
      reason: 'You are getting this email because you are an owner of this business on SeeBuyGet. It is sent at most once a day.',
    }),
  },

  'fleet-system-down': {
    title: 'Your system is not taking our messages',
    sentWhen: 'Messages to a fleet’s own system about its work were given up after two days of tries. At most once a day, to the fleet’s contact email.',
    wired: true,
    // A day late it is still true, and still the only way an office hears it without opening the app.
    sendLater: 24,
    sample: { fleet: 'Pwani Hauliers Ltd', count: 3, since: '2026-10-18T06:40:00Z' },
    build: (p) => ({
      subject: `${p.fleet}: your system is not taking our messages`,
      preheader: `${p.count === 1 ? 'A message' : `${p.count} messages`} about your work could not be delivered.`,
      blocks: [
        { kind: 'heading', text: 'Your system is not taking our messages' },
        { kind: 'paragraph', text: `Since ${formatWhen(p.since)}, ${p.count === 1 ? 'a message' : `${p.count} messages`} about your orders, loads, vehicles or runs could not be delivered to your system, and we stopped trying after two days. Your work is not affected: it is in the ${APP_NAMES.fleet} as always.` },
        { kind: 'paragraph', text: `Put your system right, then open Your system in the ${APP_NAMES.fleet}: it says what went wrong with each, and any manager sends ${p.count === 1 ? 'it' : 'them'} again.` },
        { kind: 'facts', rows: [['Fleet', p.fleet], ['Messages given up', String(p.count)], ['Since', formatWhen(p.since)]] },
        { kind: 'button', label: `Open the ${APP_NAMES.fleet}`, href: appUrl('fleet') },
      ],
      reason: 'You are getting this email because it is the contact email of this fleet on SeeBuyGet. It is sent at most once a day.',
    }),
  },

  'api-version-retiring': {
    title: 'A version of the API your system uses is stopping',
    sentWhen: 'A version of the API is announced as stopping (at least a year ahead), and again a month before it stops. To every company holding a live key: a business’s owners, a fleet’s contact email.',
    wired: true,
    // Late it is still true, and a year's notice has room for a day's delay.
    sendLater: 72,
    sample: { company: 'Pwani Hauliers Ltd', version: '1', retiresAt: '2027-11-01T00:00:00Z', stage: 'announced', app: 'fleet' },
    build: (p) => ({
      subject: p.stage === 'month' ? `${p.company}: version ${p.version} of the API stops in a month` : `${p.company}: version ${p.version} of the API will stop on ${formatWhen(p.retiresAt)}`,
      preheader: `Your system's key calls version ${p.version}. It keeps working until ${formatWhen(p.retiresAt)}.`,
      blocks: [
        { kind: 'heading', text: p.stage === 'month' ? `Version ${p.version} of the API stops in a month` : `Version ${p.version} of the API will stop` },
        { kind: 'paragraph', text: `Your company holds a live key for its own system, and the API it calls is version ${p.version}. It keeps working until ${formatWhen(p.retiresAt)}; after that, a call to it is refused. A newer version is out, and the developer guide says what changed.` },
        { kind: 'paragraph', text: p.stage === 'month' ? 'This is the second and last notice: please move your system to the newer version in the coming weeks.' : 'Nothing needs doing today. We will write once more, a month before it stops.' },
        { kind: 'facts', rows: [['Company', p.company], ['Version', p.version], ['Stops on', formatWhen(p.retiresAt)]] },
        { kind: 'button', label: `Open the ${APP_NAMES[p.app]}`, href: appUrl(p.app) },
      ],
      reason: `You are getting this email because your company holds a live key for the SeeBuyGet API. Every company holding one is told a year ahead and a month ahead.`,
    }),
  },

  'account-safety': {
    stillToRest: true,
    title: 'Something changed about how you sign in',
    sentWhen: 'A PIN is locked by wrong guesses, a phone number is changed or put back, an account is recovered, or the recovery email is replaced.',
    wired: true,
    // An alarm is worth having late: it is how somebody learns their sign-in was changed.
    sendLater: 48,
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

  /*
   * SENT BY THE CLOCK, the day before — not by anybody remembering. The person was told all of this when the
   * appointment was made, possibly weeks ago; this is the copy they will have open on the way there, so it leads
   * with when and where and lists what to bring one thing to a line.
   */
  'appointment-reminder': {
    title: 'Your appointment is tomorrow',
    sentWhen: 'The day before somebody is expected in person about a disputed national ID — to each of the two people who has an account.',
    wired: true,
    // Worth having a few hours late, on the day before. Not a day late: by then it says "tomorrow" of today.
    sendLater: 12,
    sample: { yours: true, fits: true, day: '9 Oct 2026', hour: '10:00 to 11:00', where: 'SeeBuyGet Kenya, Mombasa Road, gate 4, Nairobi', reference: 'ID-ABCD-2345', bring: ['Your ID card itself — not a copy or a photograph', 'The phone you use with SeeBuyGet', 'Your reference: ID-ABCD-2345', 'A second document in your name, if you have one: your driving licence'] },
    also: [
      { key: 'theirs', label: 'To the other person, who may come too', sample: { yours: false, fits: true, day: '9 Oct 2026', hour: '10:00 to 11:00', where: 'SeeBuyGet Kenya, Mombasa Road, gate 4, Nairobi', reference: 'ID-WXYZ-6789', bring: ['Your ID card itself — not a copy or a photograph', 'The phone you use with SeeBuyGet', 'Your reference: ID-WXYZ-6789', 'A second document in your name, if you have one: your driving licence'] } },
      { key: 'no-longer-fits', label: 'When the office has changed its days or hours since', sample: { yours: true, fits: false, day: '9 Oct 2026', hour: '10:00 to 11:00', where: 'SeeBuyGet Kenya, Mombasa Road, gate 4, Nairobi', reference: 'ID-ABCD-2345', bring: [] } },
    ],
    build: (p) => {
      const when = p.hour ? `${p.day}, ${p.hour}` : p.day;
      if (!p.fits) {
        return {
          subject: 'SeeBuyGet: your appointment tomorrow no longer fits',
          preheader: 'The office has changed when it receives visitors.',
          blocks: [
            { kind: 'heading', text: 'Your appointment tomorrow no longer fits' },
            { kind: 'paragraph', text: `The office has changed when it receives visitors, and ${when} is no longer one of its times.` },
            { kind: 'facts', rows: [['It was for', when], ['Where', p.where], ['Your reference', p.reference]] },
            { kind: 'warning', title: 'What to do', text: p.yours ? 'Open any SeeBuyGet app with your reference and choose another day, today. Do not travel tomorrow.' : 'The other person has been asked to choose another day. Look at your ticket in the app before you travel.' },
            { kind: 'button', label: 'Help with a disputed ID', href: helpUrl('account-recovery') },
          ],
          reason: 'You are getting this email because it is the recovery address on a SeeBuyGet account with an appointment tomorrow.',
        };
      }
      return {
        subject: 'SeeBuyGet: your appointment is tomorrow',
        preheader: `${when} — and what to bring.`,
        blocks: [
          { kind: 'heading', text: p.yours ? 'Your appointment is tomorrow' : 'The appointment is tomorrow' },
          {
            kind: 'paragraph',
            text: p.yours
              ? 'You asked for the decision about the national ID to be looked at again, in person. Two members of staff decide on what they see, and that decision is final.'
              : 'The other person does not accept the decision about the national ID and is coming in. You may come too, with your card, so that yours is looked at as well.',
          },
          { kind: 'facts', rows: [['When', when], ['Where', p.where], ['Your reference', p.reference], ...p.bring.map((item, i) => [i === 0 ? 'Bring' : '', item] as [string, string])] },
          { kind: 'warning', title: p.yours ? 'If you cannot come' : 'If you do not come', text: p.yours ? 'Change the day today, in the app, with your reference. Tomorrow it can no longer be changed, and if you do not come the decision stands.' : 'You do not have to. Staff then decide on what the other person shows them.' },
          { kind: 'button', label: 'Help with a disputed ID', href: helpUrl('account-recovery') },
        ],
        reason: 'You are getting this email because it is the recovery address on a SeeBuyGet account with an appointment tomorrow.',
      };
    },
  },

  'password-reset': {
    title: 'Password reset code',
    sentWhen: 'Somebody taps “I forgot my password” in the Shop or Hub app.',
    wired: true,
    // A code for somebody waiting at a screen: they ask again.
    sendLater: false,
    asked: true,
    sample: { email: 'amina@example.com', code: 'RST-4F9A2C1B7K3M', minutes: 30, app: 'agent' },
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
    stillToRest: true,
    title: 'Password changed',
    sentWhen: 'A password is changed or reset — Shop and Hub accounts, company administrators, network staff.',
    wired: true,
    // An alarm, like the one above.
    sendLater: 48,
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

  /*
   * FIVE WRONG PASSWORDS AT ONE ACCOUNT. Either it was the holder, who now knows why they cannot get in and what
   * opens it; or it was somebody else, and the holder would want to know. It says what did NOT happen first.
   */
  'password-locked': {
    stillToRest: true,
    title: 'Sign-in locked after wrong passwords',
    sentWhen: 'The wrong password is typed five times in a quarter of an hour for one account — a shop, a hub, a store, a driver, a company administrator or network staff.',
    wired: true,
    // An alarm: worth having late.
    sendLater: 48,
    sample: { email: 'amina@example.com', app: 'agent', when: '2026-10-11T08:42:00Z', until: '2026-10-11T08:57:00Z', recovery: 'self-reset' },
    also: [{ key: 'ask-admin', label: 'To staff or a company administrator, who cannot reset it themselves', sample: { email: 'amina@sbg.example', app: 'console', when: '2026-10-11T08:42:00Z', until: '2026-10-11T08:57:00Z', recovery: 'ask-admin' } }],
    build: (p) => ({
      subject: 'SeeBuyGet: your sign-in is locked after wrong passwords',
      preheader: `Nothing was opened. The sign-in for ${p.email} is locked until ${formatWhen(p.until)}.`,
      blocks: [
        { kind: 'heading', text: 'Your sign-in is locked for now' },
        { kind: 'paragraph', text: `Somebody typed the wrong password for ${p.email} five times in the ${APP_NAMES[p.app]}. Nothing was opened: your password was not guessed.` },
        { kind: 'facts', rows: [['Account', p.email], ['When', formatWhen(p.when)], ['Locked until', formatWhen(p.until)]] },
        {
          kind: 'warning',
          title: 'What to do',
          text:
            p.recovery === 'self-reset'
              ? 'If it was you: wait until then, or tap “I forgot my password” in the app. The code comes to this email address and opens your account at once. If it was not you: you need do nothing. Until the lock ends, nobody can sign in — not even with the right password.'
              : 'If it was you: wait until then. If it was not you: you need do nothing — until the lock ends, nobody can sign in, not even with the right password. Tell a colleague who administers sign-ins if it keeps happening.',
        },
        { kind: 'paragraph', text: 'Each lock in a row lasts longer: a quarter of an hour, an hour, six hours, then a day.' },
        ...(p.recovery === 'self-reset' ? [{ kind: 'button' as const, label: `Open the ${APP_NAMES[p.app]}`, href: appUrl(p.app) }] : []),
      ],
      reason: 'You are getting this email because wrong passwords were typed for your SeeBuyGet account. We always tell you — this email cannot be turned off.',
    }),
  },

  welcome: {
    title: 'Welcome',
    sentWhen: 'A shop, hub or courier signs up with an email address; a store is registered with one, or sets its account up.',
    wired: true,
    sendLater: 48,
    sample: { name: 'Mama Sarah Shop', email: 'amina@example.com', role: 'shop' },
    also: [{ key: 'store', label: 'A store', sample: { name: 'Duka Bora', email: 'orders@dukabora.example', role: 'store' } }],
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
    sendLater: 48,
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
    sentWhen: 'The setup key makes a staff account alone: the first on a new installation (to the new address).',
    wired: true,
    sendLater: 48,
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

  'staff-account-welcome': {
    title: 'Network staff account: choose your password',
    sentWhen: 'A second person approves a staff account that was asked for, or somebody on staff sends the link again (to the new address, and to nobody else).',
    wired: true,
    // The link in it works for two days: handed over a day late, it still has a day left.
    sendLater: 24,
    sample: { name: 'Chloe Wanjiru', email: 'chloe@seebuyget.example', addedBy: 'Amina Otieno and Brian Kamau', link: 'https://console.seebuyget.example/#welcome=3q2-7wAAAAAAAAAAAAAAAAAAAAAAAAAA', hours: 48 },
    build: (p) => ({
      subject: 'Choose your password for the SeeBuyGet operator console',
      preheader: `${p.addedBy} made a network staff account for you.`,
      blocks: [
        { kind: 'heading', text: 'You have a staff sign-in' },
        { kind: 'paragraph', text: `${p.addedBy} made a network staff account for you, ${p.name}. Every decision you take in the operator console is recorded against this name — including the ones that need a second person.` },
        { kind: 'facts', rows: [['Sign in with', p.email], ['On the sign-in screen', 'Choose “Network staff”']] },
        { kind: 'paragraph', text: `Nobody was shown a password for you, and nobody can give you one. Choose your own with the button below. The link works once, for ${p.hours} hours; after that, ask a colleague on staff to send you a new one.` },
        { kind: 'button', label: 'Choose your password', href: p.link },
        { kind: 'warning', title: 'Not expecting this?', text: `Do not use the link, and do not pass it on: whoever opens it becomes this member of staff. Tell ${p.addedBy}.` },
      ],
      reason: 'You are getting this email because a SeeBuyGet staff account was made for this address.',
    }),
  },

  'staff-two-step': {
    title: 'Staff two-step sign-in reset',
    sentWhen: 'Two other members of staff reset somebody’s two-step sign-in, because they lost their authenticator.',
    wired: true,
    // An alarm.
    sendLater: 48,
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

  'staff-account-news': {
    title: 'Staff account asked for, approved or declined',
    sentWhen: 'A member of staff asks for a new staff account (to every other member of staff); a second approves or declines it (to the one who asked); or the setup key makes one alone (to everybody already on staff).',
    wired: true,
    // An alarm.
    sendLater: 48,
    sample: {
      what: 'Amina Otieno asked for a network staff account for Chloe Wanjiru (chloe@seebuyget.example).',
      next: 'Nothing was made, and nobody can sign in with it until a second member of staff approves it: Overview, then Network staff. Approve it only if you know this person and this is their address. If Amina Otieno did not ask for it, decline it and take their sign-in away: it may be in somebody else’s hands.',
      when: '2026-10-11T09:12:00Z',
    },
    build: (p) => ({
      subject: 'SeeBuyGet: a network staff account',
      preheader: p.what,
      blocks: [
        { kind: 'heading', text: 'A network staff account' },
        { kind: 'paragraph', text: p.what },
        { kind: 'facts', rows: [['When', formatWhen(p.when)]] },
        { kind: 'warning', title: 'What happens now', text: p.next },
        { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
      ],
      reason: 'You are getting this email because you have a SeeBuyGet staff account, and who is on staff decides who can approve what. We always tell you — this email cannot be turned off.',
    }),
  },

  'payout-run-waiting': {
    title: 'The morning payout run waits for approval',
    sentWhen: 'The system raised a company’s payout run at 06:00 on that company’s own clock, with at least one payout in it — to every member of staff who holds the money role.',
    wired: true,
    // A notice: a run nobody approved is still waiting a day later.
    sendLater: 24,
    sample: { company: 'SeeBuyGet Kenya', day: '2026-10-28', count: 7, total: 'KES 18,420.00', skipped: 1 },
    build: (p) => ({
      subject: `SeeBuyGet: ${p.count} ${p.count === 1 ? 'payout' : 'payouts'} for ${p.company} wait for approval`,
      preheader: `Raised by the morning run for ${p.day}: ${p.total} in all. Nothing is sent until somebody approves it.`,
      blocks: [
        { kind: 'heading', text: 'The morning payout run waits for you' },
        { kind: 'paragraph', text: `The morning run raised ${p.count} ${p.count === 1 ? 'payout' : 'payouts'} for ${p.company}, for ${p.day}: what providers earned, and what people are owed back. Nothing is sent until one member of staff with the money role checks them and approves sending.` },
        { kind: 'facts', rows: [['Company', p.company], ['For', p.day], ['Payouts', String(p.count)], ['In all', p.total], ...(p.skipped ? [['Skipped', `${p.skipped} — the console says who, and why`] as [string, string]] : [])] },
        { kind: 'button', label: 'Open Money in the operator console', href: appUrl('console') },
      ],
      reason: 'You are getting this email because you hold the money role on SeeBuyGet staff: a payout raised and never approved is somebody not paid.',
    }),
  },

  'access-removed': {
    stillToRest: true,
    title: 'Sign-in removed',
    sentWhen: 'A company administrator or a staff account is taken away.',
    wired: true,
    // An alarm.
    sendLater: 48,
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

  /*
   * A FLEET THAT SIGNED ITSELF UP IS TOLD EACH STEP, on the one channel it has: until it is active it has no app to open,
   * so an email is the only place a refusal's reason can reach it. Every step says what happens next, and whose it is.
   */
  'fleet-signup': {
    title: 'Your fleet sign-up',
    sentWhen: 'A fleet signs itself up on the front page; then when staff approve its papers, send them back with the reason, or record its bond (to the contact email it gave).',
    wired: true,
    sendLater: 72,
    sample: { company: 'Kilima Logistics', stage: 'received', when: '2026-10-23T09:12:00Z' },
    also: [
      { key: 'approved', label: 'Papers approved', sample: { company: 'Kilima Logistics', stage: 'approved', when: '2026-10-24T11:30:00Z' } },
      { key: 'refused', label: 'Papers sent back', sample: { company: 'Kilima Logistics', stage: 'refused', reason: 'The operator’s licence in the photo ran out in March. Send this year’s.', when: '2026-10-24T11:30:00Z' } },
      { key: 'active', label: 'Fleet active', sample: { company: 'Kilima Logistics', stage: 'active', when: '2026-10-25T08:05:00Z' } },
    ],
    build: (p) => {
      const reason = 'You are getting this email because this address was given when a fleet was signed up on SeeBuyGet.';
      if (p.stage === 'received') {
        return {
          subject: `We have the papers for ${p.company}`,
          preheader: 'SeeBuyGet staff check them. We write here when they have.',
          blocks: [
            { kind: 'heading', text: 'Your fleet is signed up' },
            { kind: 'paragraph', text: `SeeBuyGet staff now check the papers and numbers you sent for ${p.company}. We write to this address when they have: approved, or what to put right.` },
            { kind: 'facts', rows: [['Fleet', p.company], ['Sent', formatWhen(p.when)]] },
            { kind: 'paragraph', text: 'After the papers, the refundable operating bond is recorded, and then the Fleet app opens for your fleet. You sign in to it with the phone number and PIN you signed up with.' },
          ],
          reason,
        };
      }
      if (p.stage === 'approved') {
        return {
          subject: `The papers for ${p.company} are approved`,
          preheader: 'Next: the operating bond. Then the Fleet app opens.',
          blocks: [
            { kind: 'heading', text: 'Your papers are approved' },
            { kind: 'paragraph', text: `SeeBuyGet staff checked the papers for ${p.company}. One step is left: the refundable operating bond. SeeBuyGet contacts you about it, and when it is recorded your fleet is active.` },
            { kind: 'facts', rows: [['Fleet', p.company], ['Approved', formatWhen(p.when)]] },
          ],
          reason,
        };
      }
      if (p.stage === 'refused') {
        return {
          subject: `Something to put right for ${p.company}`,
          preheader: p.reason ?? 'Your papers came back. Send them again from the front page.',
          blocks: [
            { kind: 'heading', text: 'Your papers came back' },
            { kind: 'paragraph', text: `SeeBuyGet staff looked at the papers for ${p.company} and could not approve them. This is what they said:` },
            { kind: 'warning', title: 'What needs putting right', text: p.reason ?? 'Open the sign-up to see the reason.' },
            { kind: 'paragraph', text: 'Open the sign-up, sign in with your phone number and PIN, and send the papers again. Nothing else has to be typed again.' },
            { kind: 'button', label: 'Send the papers again', href: `${appUrl('home')}?join=fleet` },
          ],
          reason,
        };
      }
      return {
        subject: `${p.company} is active on SeeBuyGet`,
        preheader: 'Open the Fleet app with your phone number and PIN.',
        blocks: [
          { kind: 'heading', text: 'Your fleet is active' },
          { kind: 'paragraph', text: `The bond is recorded and ${p.company} is active. Open the Fleet app and sign in with the phone number and PIN you signed up with: add your vehicles and your drivers, and you can take loads.` },
          { kind: 'facts', rows: [['Fleet', p.company], ['Active since', formatWhen(p.when)]] },
          { kind: 'button', label: 'Open the Fleet app', href: appUrl('fleet') },
        ],
        reason,
      };
    },
  },

  'fleet-code-issued': {
    title: 'New fleet code issued',
    sentWhen: 'A fleet manager or network staff issue a new fleet sign-in code (to the fleet’s contact email).',
    wired: true,
    sendLater: 48,
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
    // Sent once per code: nothing else would send it again.
    sendLater: 48,
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

  /*
   * SENT BY THE CLOCK to the people who can renew it. A licence or a policy of one of our own companies has an expiry
   * date, and the day after it the capability it supports is off in that country. Until this existed only network
   * staff saw a list; the company's own administrators heard nothing. It says WHICH paper, WHEN, WHAT STOPS — in the
   * console's own words — and what to do, which is not "type the new date": a company's record is changed by network
   * staff, so the company puts the renewed paper on record and staff enter the date.
   */
  'company-paper-lapsing': {
    title: 'A licence or policy of one of our companies is running out',
    sentWhen: 'The six-hourly check finds a licence or an insurance policy of one of our companies 60, 30, 14, 7 or 1 days from its expiry date, or lapsed — once per mark per expiry date, to every administrator of the company, and of its parent from a week out.',
    wired: true,
    // The next mark sends its own; this one is still worth reading two days late.
    sendLater: 48,
    sample: { company: 'SeeBuyGet Kenya', country: 'KE', paper: 'Courier licence', reference: 'CA/CL/0042', expiresOn: '2026-11-12', daysLeft: 14, lapsed: false, stops: ['charge customers'], where: 'licence', own: true },
    also: [
      { key: 'tomorrow', label: 'The day before', sample: { company: 'SeeBuyGet Kenya', country: 'KE', paper: 'Courier licence', reference: 'CA/CL/0042', expiresOn: '2026-11-12', daysLeft: 1, lapsed: false, stops: ['charge customers'], where: 'licence', own: true } },
      { key: 'lapsed', label: 'It has lapsed', sample: { company: 'SeeBuyGet Kenya', country: 'KE', paper: 'Goods-in-transit insurance', reference: 'GIT-88-2025', expiresOn: '2026-10-07', daysLeft: 0, lapsed: true, stops: ['pay claims'], where: 'insurance', own: true } },
      { key: 'nothing-stops', label: 'A paper nothing depends on', sample: { company: 'SeeBuyGet Kenya', country: 'KE', paper: 'Public liability insurance', reference: 'PL-2025-17', expiresOn: '2026-11-12', daysLeft: 30, lapsed: false, stops: [], where: 'insurance', own: true } },
      { key: 'not-switched-on', label: 'A company not switched on yet', sample: { company: 'SeeBuyGet Uganda', country: 'UG', paper: 'Courier licence', reference: 'UCC/CL/0007', expiresOn: '2026-11-12', daysLeft: 14, lapsed: false, stops: [], where: 'licence', own: false } },
    ],
    build: (p) => {
      const when = p.lapsed ? 'has lapsed' : p.daysLeft <= 0 ? 'runs out today' : p.daysLeft === 1 ? 'runs out tomorrow' : `runs out in ${p.daysLeft} days`;
      const list = p.stops.length > 1 ? `${p.stops.slice(0, -1).join(', ')} or ${p.stops[p.stops.length - 1]}` : (p.stops[0] ?? '');
      const consequence = p.lapsed
        ? p.stops.length
          ? `${p.company} can no longer ${list} until a new one is on its record.`
          : 'Nothing switched off by itself, and the company’s record now shows it as lapsed.'
        : p.stops.length
          ? `From the day after, ${p.company} can no longer ${list}.`
          : 'Nothing switches off by itself when it does, but the company’s record will show it as lapsed.';
      return {
        subject: `${p.paper} ${when} — ${p.company}`,
        preheader: consequence,
        blocks: [
          { kind: 'heading', text: `${p.paper} ${when}` },
          { kind: 'paragraph', text: `${p.company}’s ${p.paper.charAt(0).toLowerCase()}${p.paper.slice(1)} ${p.lapsed ? 'was' : 'is'} good until ${formatDate(p.expiresOn)}. ${consequence}` },
          {
            kind: 'facts',
            rows: [['Company', p.company], ['Paper', `${p.paper} · ${p.reference}`], ['Good until', formatDate(p.expiresOn)], ...(p.stops.length ? ([[p.lapsed ? 'Switched off' : 'Then switches off', p.stops.join(', ')]] as Array<[string, string]>) : [])],
          },
          {
            kind: 'warning',
            title: 'What to do',
            // Whose hands the new date is in: the company's own once it is switched on; until then staff enter it.
            text: p.own
              ? `Renew it with whoever issued it. Then sign in to the console, open Company record, and under ${p.where === 'licence' ? 'Licences' : 'Insurance'} press “Change, with its paper”: enter the new expiry date and attach the renewed ${p.where === 'licence' ? 'licence' : 'policy'}. It counts from that moment, and nobody at SeeBuyGet has to enter anything.${p.lapsed && p.stops.length ? ' What is switched off comes back the moment the new date is on record.' : ''}`
              : `Renew it with whoever issued it. Then sign in to the console, open Company record, and under Papers put the renewed ${p.where === 'licence' ? 'licence' : 'policy'} on record with its new expiry date. The company is not switched on yet, so SeeBuyGet staff check it and enter the new date on its record.`,
          },
          { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
          { kind: 'note', text: 'You will hear again as the date comes closer, and on the day it has lapsed. Other administrators of the company get this too.' },
        ],
        reason: `You are getting this email because you administer ${p.company} on SeeBuyGet. It is about a paper your company trades on, so it cannot be turned off.`,
      };
    },
  },

  'company-record-changed': {
    title: 'A company’s own record was changed by one of its administrators',
    sentWhen: 'An administrator of a company that is switched on changes a licence, an insurance policy, a bank account or who may sign — each with its paper — or takes one off the record. Sent to every OTHER administrator of the company and of the company above it, never to the person who did it.',
    wired: true,
    // The change stands whether or not this arrives; it is still worth reading two days late.
    sendLater: 48,
    sample: { company: 'SeeBuyGet Kenya', by: 'Wanjiru Kamau', part: 'licence', change: 'changed', was: 'courier licence CA/CL/0042, good until 2026-11-12', now: 'courier licence CA/CL/0042, good until 2027-11-12', paper: true },
    also: [
      { key: 'added', label: 'Something added', sample: { company: 'SeeBuyGet Kenya', by: 'Wanjiru Kamau', part: 'bank account', change: 'added', was: '—', now: 'KCB account 1100223344 (KES, SeeBuyGet Kenya Ltd)', paper: true } },
      { key: 'removed', label: 'Something taken off', sample: { company: 'SeeBuyGet Kenya', by: 'Wanjiru Kamau', part: 'person who may sign', change: 'removed', was: 'Otieno Odhiambo, Director — signs alone', now: 'taken off the record', paper: false } },
    ],
    build: (p) => {
      const did = p.change === 'added' ? 'added a' : p.change === 'removed' ? 'took a' : 'changed a';
      const tail = p.change === 'removed' ? ' off' : ' on';
      return {
        subject: `${p.by} ${did} ${p.part}${tail} ${p.company}’s record`,
        preheader: p.change === 'removed' ? `Was: ${p.was}` : `Now: ${p.now}`,
        blocks: [
          { kind: 'heading', text: `A change to ${p.company}’s record` },
          {
            kind: 'paragraph',
            text: `${p.by} ${did} ${p.part}${tail} ${p.company}’s record.${p.paper ? ' The paper behind it was put on record in the same act, and the change counts from now: nobody at SeeBuyGet checks it first.' : ''}`,
          },
          { kind: 'facts', rows: [['Company', p.company], ['By', p.by], ['Was', p.was], ['Now', p.now]] },
          { kind: 'note', text: `You are told because a company that is switched on keeps its own record, and the people who would know whether a change is right are its own. If this one is not right: open Company record in the console, find the paper under Papers and press “Report this paper” — say what is wrong and attach what shows it.` },
          { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
        ],
        reason: `You are getting this email because you administer ${p.company}, or the company above it, on SeeBuyGet. It is about what that company trades on, so it cannot be turned off.`,
      };
    },
  },

  'company-paper-reported': {
    title: 'A paper on a company’s record was reported as not right',
    sentWhen: 'Somebody signed in and connected to a company reports one of its papers — the first time that paper is questioned. Sent to every administrator of the company and of the company above it. It says what was said, never by whom.',
    wired: true,
    // The time to answer runs from the report, not from this email: still worth reading two days late.
    sendLater: 48,
    sample: { company: 'SeeBuyGet Kenya', paper: 'courier licence CA/CL/0042, good until 2027-11-12', said: 'it has run out, or been withdrawn', note: 'The Communications Authority’s public register shows this licence as expired on 12 Nov 2026.', answerBy: '2026-10-16' },
    build: (p) => ({
      subject: `A paper on ${p.company}’s record was reported — answer by ${formatDate(p.answerBy)}`,
      preheader: 'It keeps counting while this is looked at.',
      blocks: [
        { kind: 'heading', text: 'A paper on your record was reported' },
        { kind: 'paragraph', text: `Somebody who can see ${p.company}’s papers has told SeeBuyGet that one of them is not right: ${p.said}. The paper keeps counting while this is looked at: a report changes nothing by itself.` },
        { kind: 'facts', rows: [['Company', p.company], ['Paper', p.paper], ['What was said', p.note], ['Answer by', formatDate(p.answerBy)]] },
        {
          kind: 'warning',
          title: 'What to do',
          text: `Sign in to the console, open Company record, and under Papers find this paper and press “Answer”: say what is right, and attach what shows it. If the report is right, put the right paper on record instead, with “Change, with its paper”. Once you have answered, or after ${formatDate(p.answerBy)}, SeeBuyGet staff decide: one of them may dismiss the report; striking the paper takes two.`,
        },
        { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
        { kind: 'note', text: 'We do not say who reported it.' },
      ],
      reason: `You are getting this email because you administer ${p.company}, or the company above it, on SeeBuyGet. It is about a paper that company trades on, so it cannot be turned off.`,
    }),
  },

  'company-paper-decided': {
    title: 'A report on a company’s paper was decided',
    sentWhen: 'A member of staff dismisses a report on a company’s paper, or two of them strike the paper. Sent to every administrator of the company and of the company above it.',
    wired: true,
    // Whatever was decided has already happened; the reason is still worth reading two days late.
    sendLater: 48,
    sample: { company: 'SeeBuyGet Kenya', paper: 'courier licence CA/CL/0042, good until 2027-11-12', outcome: 'struck', reason: 'The regulator’s register shows the licence expired on 12 Nov 2026, and the paper on record is dated before that.', effect: 'The record is back as it was: courier licence CA/CL/0042, good until 2026-11-12.' },
    also: [{ key: 'dismissed', label: 'Dismissed', sample: { company: 'SeeBuyGet Kenya', paper: 'courier licence CA/CL/0042, good until 2027-11-12', outcome: 'dismissed', reason: 'The register was checked on 10 Oct 2026 and shows the licence renewed until 12 Nov 2027.', effect: '' } }],
    build: (p) => {
      const struck = p.outcome === 'struck';
      return {
        subject: struck ? `A paper was struck from ${p.company}’s record` : `The report on ${p.company}’s paper was dismissed`,
        preheader: struck ? p.effect : 'Nothing on the record changed.',
        blocks: [
          { kind: 'heading', text: struck ? 'A paper was struck from your record' : 'The report was dismissed' },
          {
            kind: 'paragraph',
            text: struck
              ? `Two members of SeeBuyGet staff looked at the report on this paper, and at what ${p.company} answered, and decided that the paper does not count. ${p.effect}`
              : `A member of SeeBuyGet staff looked at the report on this paper and dismissed it. Nothing on ${p.company}’s record changed, and the paper counts as before.`,
          },
          { kind: 'facts', rows: [['Company', p.company], ['Paper', p.paper], ['Reason', p.reason]] },
          ...(struck
            ? [{ kind: 'warning', title: 'What to do', text: 'Put the right paper on record: in the console, open Company record and press “Change, with its paper”, or “Add one, with its paper”. It counts from that moment.' } as const]
            : []),
          { kind: 'button', label: 'Open the operator console', href: appUrl('console') },
        ],
        reason: `You are getting this email because you administer ${p.company}, or the company above it, on SeeBuyGet. It is about a paper that company trades on, so it cannot be turned off.`,
      };
    },
  },

  /*
   * Round 40 — THE TRAIL'S HEAD, TO AN AUDITOR (the user: "Daily to an auditor"). The one thing this email is for is being
   * kept somewhere SeeBuyGet cannot reach: the height and the id, exactly as the chain had them that day. Plain text, no
   * link to follow and nothing to do — the auditor's copy is read out later and checked against the chain.
   */
  'trail-head': {
    title: 'The trail’s daily fingerprint (to the auditor)',
    sentWhen: 'Once a day, a few minutes after midnight UTC, to the auditor’s address two members of staff named.',
    wired: true,
    // A day's fingerprint is still the day's fingerprint two days on; a later one does not replace it.
    sendLater: 48,
    sample: { date: '2026-10-22', height: 18342, txId: '4b8e0f6c2d1a9e7b3c5f8a0d6e2b4c9f1a7d3e5b8c0f2a4d6e8b1c3f5a7d9e0b', whole: true },
    build: (p) => ({
      subject: `SeeBuyGet trail, ${p.date}: link ${p.height}`,
      preheader: 'Keep this email. It is checked against our records later; nothing needs doing now.',
      blocks: [
        { kind: 'heading', text: `The trail on ${p.date}` },
        { kind: 'paragraph', text: 'Every pickup, delivery, seal, scan and damage report on SeeBuyGet is fingerprinted into one chain, each link taken over the one before. This is the chain’s newest link today. Keep this email where SeeBuyGet cannot change it.' },
        { kind: 'facts', rows: [['Day (UTC)', p.date], ['Links in the chain', String(p.height)], ['Newest link', p.txId || 'none yet'], ['Chain whole when read', p.whole ? 'yes' : `no — it breaks at link ${p.brokenAt}`]] },
        { kind: 'note', text: 'To check SeeBuyGet’s records later, read the link number and the fingerprint out to their staff: if anything up to that link was changed since today, the chain no longer gives this fingerprint.' },
      ],
      reason: 'You are getting this email because two members of SeeBuyGet staff named this address as the trail’s auditor.',
    }),
  },

  'trail-auditor-named': {
    title: 'An address is named the trail’s auditor',
    sentWhen: 'A second member of staff approves this address for the trail’s daily fingerprint.',
    wired: true,
    sendLater: 48,
    sample: { to: 'audit@example.com', proposedBy: 'Amina Otieno', approvedBy: 'Brian Kamau', at: '2026-10-22T15:40:00.000Z', nextAt: '2026-10-23T00:05:00.000Z' },
    build: (p) => ({
      subject: 'You will receive the SeeBuyGet trail’s daily fingerprint',
      preheader: `From ${formatWhen(p.nextAt)}, once a day.`,
      blocks: [
        { kind: 'heading', text: 'You are the trail’s auditor' },
        { kind: 'paragraph', text: `Once a day, from ${formatWhen(p.nextAt)}, this address receives the newest link of SeeBuyGet’s trail: the chain every pickup, delivery, seal, scan and damage report is fingerprinted into. Keep those emails: they are what SeeBuyGet’s records are checked against later.` },
        { kind: 'facts', rows: [['Asked for by', p.proposedBy], ['Approved by', p.approvedBy], ['When', formatWhen(p.at)]] },
        { kind: 'warning', title: 'Not expecting this?', text: 'Tell SeeBuyGet: an address is named the auditor only by two members of its staff.' },
      ],
      reason: 'You are getting this email because two members of SeeBuyGet staff named this address as the trail’s auditor.',
    }),
  },

  'trail-auditor-changed': {
    title: 'The trail’s daily fingerprint goes elsewhere (to the address it went to)',
    sentWhen: 'A second member of staff approves another address for the trail’s daily fingerprint.',
    wired: true,
    sendLater: 48,
    sample: { from: 'audit@example.com', to: 'audit@another.example', proposedBy: 'Amina Otieno', approvedBy: 'Brian Kamau', at: '2026-10-22T15:40:00.000Z', nextAt: '2026-10-23T00:05:00.000Z' },
    build: (p) => ({
      subject: 'The SeeBuyGet trail’s daily fingerprint no longer comes here',
      preheader: `It goes to ${p.to} from ${formatWhen(p.nextAt)}.`,
      blocks: [
        { kind: 'heading', text: 'The auditor’s address was changed' },
        { kind: 'paragraph', text: `From ${formatWhen(p.nextAt)}, the trail’s daily fingerprint goes to ${p.to} instead of this address. The emails you already have still count: keep them.` },
        { kind: 'facts', rows: [['Now goes to', p.to], ['Asked for by', p.proposedBy], ['Approved by', p.approvedBy], ['When', formatWhen(p.at)]] },
        { kind: 'warning', title: 'Not expected?', text: 'Tell SeeBuyGet straight away: the auditor’s address is the one thing somebody hiding a change to its records would want to move.' },
      ],
      reason: 'You are getting this email because this address received the SeeBuyGet trail’s daily fingerprint until now.',
    }),
  },

  'support-received': {
    stillToRest: true,
    title: 'We have your message (written from the help)',
    sentWhen: 'Somebody writes to SeeBuyGet from “Write to us” in the help.',
    wired: true,
    sendLater: 24,
    sample: { reference: 'SBG-7KQ2MX', category: 'parcel', message: 'My parcel has said “on its way” for three days. The tracking code is ABC123.' },
    build: (p) => ({
      subject: `We have your message — ${p.reference}`,
      preheader: 'A member of SeeBuyGet staff answers it by email.',
      blocks: [
        { kind: 'heading', text: 'We have your message' },
        { kind: 'paragraph', text: 'A member of SeeBuyGet staff reads it and answers you at this address. If you write again about the same thing, give this reference.' },
        { kind: 'facts', rows: [['Reference', p.reference], ['About', SUPPORT_TOPIC[p.category] ?? 'Something else']] },
        { kind: 'paragraph', text: `You wrote: “${p.message.length > 400 ? `${p.message.slice(0, 400)}…` : p.message}”` },
        { kind: 'warning', title: 'Never share a code or a PIN', text: 'SeeBuyGet staff never ask for your PIN, a code sent to your phone, or your password — in an email, a message or on the phone.' },
      ],
      reason: 'You are getting this email because this address was given with a message to SeeBuyGet.',
    }),
  },

  'account-may-close': {
    stillToRest: true,
    title: 'Your account can be closed',
    sentWhen: 'An account has gone four years without a sign-in. Once for each four years; nothing closes by itself.',
    wired: true,
    // Late is still worth knowing: it changes nothing until the owner acts.
    sendLater: 72,
    sample: { lastSignInAt: '2026-10-22T08:15:00Z' },
    build: (p) => ({
      subject: 'SeeBuyGet: your account can be closed',
      preheader: 'It has not been signed in to for four years. Nothing happens unless you close it.',
      blocks: [
        { kind: 'heading', text: 'Your SeeBuyGet account can be closed' },
        { kind: 'paragraph', text: 'Your SeeBuyGet account has not been signed in to for four years. If you no longer need it, you can close it.' },
        { kind: 'facts', rows: [['Last signed in', formatWhen(p.lastSignInAt)]] },
        { kind: 'paragraph', text: 'Closing removes your name, ID number, phone number, email and ID photos. Parcels, hand-overs and consignment notes stay, showing “closed account” where you were: they are other people’s records too.' },
        { kind: 'paragraph', text: 'To close it, open any SeeBuyGet app, tap your picture, then “Settings › Close my account”. It can be closed once nothing is open: no parcel or load on its way, no claim or dispute, and no money owed either way.' },
        { kind: 'warning', title: 'Nothing happens unless you do it', text: 'If you want to keep your account, do nothing. It stays as it is.' },
        { kind: 'button', label: 'How closing works', href: helpUrl('close-account') },
      ],
      reason: 'You are getting this email because it is the recovery address on a SeeBuyGet account that has not been signed in to for four years.',
    }),
  },
  'support-answer': {
    stillToRest: true,
    title: 'An answer to a message written from the help',
    sentWhen: 'A member of SeeBuyGet staff answers a message on the console’s Messages.',
    wired: true,
    sendLater: 48,
    sample: { reference: 'SBG-7KQ2MX', asked: 'My parcel has said “on its way” for three days.', answer: 'It reached the shop this morning: you can collect it with your code.', by: 'Amina Otieno' },
    build: (p) => ({
      subject: `An answer to your message — ${p.reference}`,
      preheader: p.answer.length > 90 ? `${p.answer.slice(0, 90)}…` : p.answer,
      blocks: [
        { kind: 'heading', text: 'An answer from SeeBuyGet' },
        { kind: 'paragraph', text: p.answer },
        { kind: 'facts', rows: [['From', `${p.by}, SeeBuyGet`], ['Reference', p.reference]] },
        { kind: 'paragraph', text: `You wrote: “${p.asked.length > 300 ? `${p.asked.slice(0, 300)}…` : p.asked}”` },
        { kind: 'warning', title: 'Never share a code or a PIN', text: 'SeeBuyGet staff never ask for your PIN, a code sent to your phone, or your password.' },
      ],
      reason: 'You are getting this email because you wrote to SeeBuyGet from this address.',
    }),
  },

  'papers-due': {
    title: 'Papers running out, and vehicles off the road (fleet)',
    sentWhen: 'The six-hourly papers check finds a vehicle or driver paper lapsed or due within 30 days — once per paper per expiry date.',
    wired: true,
    // Sent once per paper per expiry date: nothing else would send it again.
    sendLater: 48,
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
  'country-changed': {
    title: 'What changes in your country (shop, hub, store, fleet)',
    sentWhen: 'A change to a country takes something away — to everybody registered there who gave an email address. The apps say it in their inbox as well.',
    wired: true,
    // Sent once, when the change is made, and nothing sends it again: still worth having three days on.
    sendLater: 72,
    sample: {
      country: 'Uganda',
      lost: ['we no longer charge customers here — a local carrier prices and bills', 'a shop here can no longer keep a float with us', 'we cannot pay out here for now, so what is owed waits'],
      kept: ['Parcels already on a shelf stay there to be collected', 'What is owed to you stays owed'],
      app: 'agent',
    },
    build: (p) => ({
      subject: `What changes for you in ${p.country} from today`,
      preheader: `${p.lost.length === 1 ? 'One thing stops' : `${p.lost.length} things stop`} from today. Parcels on a shelf can still be collected.`,
      blocks: [
        { kind: 'heading', text: `What changes in ${p.country}` },
        { kind: 'paragraph', text: 'From today:' },
        { kind: 'facts', rows: p.lost.map((l, i) => [String(i + 1), l.replace(/^./, (c) => c.toUpperCase())] as [string, string]) },
        { kind: 'paragraph', text: 'What does not change:' },
        { kind: 'facts', rows: p.kept.map((k, i) => [String(i + 1), k] as [string, string]) },
        { kind: 'button', label: 'Open the app', href: appUrl(p.app) },
      ],
      reason: `You are getting this email because you are registered with SeeBuyGet in ${p.country}. It is about the service you use there, so it cannot be turned off.`,
    }),
  },
  'order-on-its-way': {
    title: 'Order on its way (buyer)',
    sentWhen: 'A store hands an order to the network, to the email the buyer gave the store.',
    wired: true,
    // After a day the parcel is likely there, and the next email says so.
    sendLater: 24,
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
    sentWhen: 'A driver delivers a load: to the email of the shop that posted it; for a business, to the person who posted it, or to its owners when that person cannot be emailed.',
    wired: true,
    // A receipt is for the books; its link works for a month.
    sendLater: 72,
    sample: { code: 'FRT-010', description: 'Maize, 20 sacks', destination: 'Riverside Corner', deliveredAt: '2026-09-14T12:04:00Z', carrier: 'Kilima Logistics', driver: 'Amos K.', receiverName: 'Wanjiru (Riverside Corner)', amount: 350, currency: 'KES', noteNumber: 'CMR-FRT-010', noteUrl: `${appUrl('home')}#doc=a-sample-key-that-opens-nothing-at-all-0000`, noteUntil: '2026-10-14T12:04:00Z' },
    also: [
      {
        key: 'business',
        label: 'as a business gets it',
        sample: { code: 'FRT-204', description: 'Cement, 12 pallets', destination: 'Thika Road Depot', deliveredAt: '2026-10-07T12:04:00Z', carrier: 'Kilima Logistics', driver: 'Amos K.', receiverName: 'Njeri (Thika Road Depot)', amount: 18500, currency: 'KES', noteNumber: 'CMR-FRT-204', noteUrl: `${appUrl('home')}#doc=a-sample-key-that-opens-nothing-at-all-0000`, noteUntil: '2026-11-06T12:04:00Z', business: { name: 'Abebe Import & Export PLC', as: 'poster' } },
      },
    ],
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
            ...(p.reservations ? [['The receiver found', p.reservations] as [string, string]] : []),
            ['Carrier', p.carrier],
            ...(p.amount != null ? [[p.business ? 'Price agreed' : 'Carriage charges', `${p.amount.toFixed(2)} ${p.currency ?? ''}`.trim()] as [string, string]] : []),
            ['Consignment note', p.noteNumber],
          ],
        },
        ...(p.noteUrl
          ? ([
              { kind: 'paragraph', text: 'The consignment note — sender, carrier, vehicle, goods, taking over and delivery, with its photographs — is one file to keep for your books.' },
              { kind: 'button', label: 'Get the consignment note', href: p.noteUrl },
              {
                kind: 'warning',
                title: 'This button works without signing in',
                text: `${p.noteUntil ? `Until ${formatWhen(p.noteUntil)}, it` : 'It'} opens the note for whoever has this email — so forward it only to somebody who should have the note. You can see how often it was opened, and cancel it, ${p.business ? `on the load itself: in the ${APP_NAMES.business}, under Loads` : 'on the note itself: in the Shop app, Records, then Notes'}. The note stays there after the button stops.`,
              },
            ] as MailBlock[])
          : p.business
            ? ([
                { kind: 'paragraph', text: `The consignment note — sender, carrier, vehicle, goods, taking over and delivery — is on the load in the ${APP_NAMES.business} under Loads. Open it there to print or save it for your books.` },
                { kind: 'button', label: `Open the ${APP_NAMES.business}`, href: appUrl('business') },
              ] as MailBlock[])
            : ([
                { kind: 'paragraph', text: 'The consignment note — sender, carrier, vehicle, goods, taking over and delivery — is on the load in the Shop app under Freight. Open it there to print or save it for your books.' },
                { kind: 'button', label: 'Open the Shop app', href: appUrl('agent') },
              ] as MailBlock[])),
        // We never handle a business's payments (the user, 2026-10-04): a figure in a receipt must not read as our bill.
        ...(p.business && p.amount != null
          ? ([{ kind: 'note', text: `The price is what ${p.business.name} and the carrier agreed, and it is settled between the two of you. SeeBuyGet holds no money for this load, and this email is not an invoice.` }] as MailBlock[])
          : []),
        { kind: 'note', text: 'Something wrong with the delivery? Say so from the load in the app; a note that says “not recorded” is one the receiver has not yet confirmed.' },
      ],
      reason: !p.business
        ? 'You are getting this email because your shop posted this load on SeeBuyGet.'
        : p.business.as === 'poster'
          ? `You are getting this email because you posted this load for ${p.business.name} on SeeBuyGet.`
          : `You are getting this email because you are an owner of ${p.business.name}, which posted this load on SeeBuyGet, and the person who posted it cannot be emailed.`,
    }),
  },

  /*
   * TO AN INSURER, who may never have heard of SeeBuyGet. The user, 2026-10-12: the report goes "to an insurer of the
   * claimants choice, to the claimant themselves or one set by the vendor according to their shipping policy" — and
   * 2026-10-13, that sending it is "only emailing a link". So the email says what SeeBuyGet is and is not, what the
   * report holds, and that the claim itself is the store's and theirs: nothing here decides anything or offers to pay.
   */
  'damage-report': {
    title: 'Damage claim report (a store’s insurer)',
    sentWhen: 'A problem is reported on one of a store’s shipments and the store names an insurer on its shipping policy: to that insurer, the moment the report is made.',
    wired: true,
    // The link works for a month; a report three days late is still the report.
    sendLater: 72,
    sample: { number: 'DCR-PUD-40257F1F7F', parcelId: 'PUD-40257F1F7F', orderNumber: 'ORD-20481', store: 'Nairobi Threads', insurer: 'Jubilee Allianz Claims', reportedAt: '2026-10-12T09:30:00Z', by: 'receiver', problem: 'The screen is cracked from corner to corner', from: 'Mama Sarah Shop, Nairobi CBD', to: 'Riverside Corner, Westlands', url: 'https://seebuyget.com/#report=k3ZbQp8vR1tYw0xLm2nHc4dJf6sAe9uGiB7oVzXyT5q', until: '2026-11-11T09:30:00Z' },
    build: (p) => ({
      subject: `Damage claim report ${p.number} — ${p.store}${p.orderNumber ? `, order ${p.orderNumber}` : ''}`,
      preheader: `${p.store} names you as its insurer. A problem was reported on a shipment it sent through SeeBuyGet.`,
      reason: `You are getting this email because ${p.store} names ${p.insurer} as its insurer for the shipments it sends through SeeBuyGet.`,
      blocks: [
        { kind: 'heading', text: `A damage claim report from ${p.store}` },
        { kind: 'paragraph', text: `${p.store} names ${p.insurer} as its insurer for the shipments it sends through SeeBuyGet. A problem was reported on one of them, and this is the record of it.` },
        {
          kind: 'facts',
          rows: [
            ['Report', p.number],
            ['Store', p.store],
            ...(p.orderNumber ? [['The store’s order', p.orderNumber] as [string, string]] : []),
            ['Parcel', p.parcelId],
            ['From', p.from],
            ['To', p.to],
            ['Reported', formatWhen(p.reportedAt)],
            ['Reported by', p.by === 'shop' ? 'The collection shop, at its counter' : 'The receiver, from their own app'],
            ['In their words', p.problem],
          ],
        },
        { kind: 'paragraph', text: 'The report is one file: the parcel as it was made, every hand it passed through and when, each recorded step with its fingerprint, the photographs, and the terms it travelled under — as the record stood the moment the problem was reported. It carries a fingerprint of its own, so two copies can be compared.' },
        { kind: 'button', label: 'Get the damage claim report', href: p.url },
        { kind: 'warning', title: 'This button works without signing in', text: `Until ${formatWhen(p.until)}, it opens the report for whoever has this email — so forward it only to somebody who should have it. The store sees this link on the report and can stop it.` },
        { kind: 'note', text: `SeeBuyGet carries parcels and keeps the record of every hand each one passes through. It does not judge a claim for damage or loss and it offers no payment: the claim is between ${p.store}, its customer and you. Questions about the claim go to ${p.store}.` },
      ],
    }),
  },

  'ready-for-collection': {
    title: 'Ready to collect (buyer)',
    sentWhen: 'A parcel is shelved at the collection shop, to the email the buyer gave the store.',
    wired: true,
    // The parcel waits for days.
    sendLater: 48,
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
export function renderMail<K extends MailTemplateId>(template: K, params: MailParams[K], look?: { fontsUrl?: string }): RenderedMail {
  const def = MAIL_TEMPLATES[template] as MailTemplate<MailParams[K]>;
  // `MAIL_FONT_URL` — where the typeface files are served (this server serves them at /v1/mail/font). A look that is
  // passed in is the preview's, which points a browser at this server's own copy.
  const fontsUrl = look?.fontsUrl ?? fontsBase(process.env.MAIL_FONT_URL);
  return renderDocument(def.build(params), { helpUrl: helpUrl(), logoUrl: process.env.MAIL_LOGO_URL, ...(fontsUrl ? { fontsUrl } : {}) });
}
