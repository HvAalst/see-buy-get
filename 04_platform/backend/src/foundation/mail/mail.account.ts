import { appUrl, helpUrl, type MailApp, type MailTemplates } from './mail.kit';
import type { SayValue } from '../../modules/pudo/notice-words/say';
import type { NoticeKey } from '../../modules/pudo/notice-words/catalog';

/*
 * 2026-11-27 — THE ACCOUNT EMAILS. An account and signing in: codes, passwords, a welcome, its safety, a disputed ID appointment, and what somebody wrote to us. Each email's parameters, and its words.
 */

export interface AccountMailParams {
  'password-reset': { email: string; code: string; minutes: number; app: MailApp };
  'password-changed': { email: string; when: string; app: MailApp; recovery: 'self-reset' | 'ask-admin' };
  /** Five wrong passwords at one account locked its sign-in. Sent to the holder by the try that locked it. */
  'password-locked': { email: string; app: MailApp; when: string; until: string; recovery: 'self-reset' | 'ask-admin' };
  welcome: { name: string; email: string; role: 'shop' | 'hub' | 'driver' | 'store' };
  /** A code to an address: to confirm it is theirs, to get back into the account, or to undo a number change. */
  'email-code': { code: string; minutes: number; why: 'confirm' | 'recover' | 'undo' };
  /** Something happened to the way somebody signs in. Always sent; cannot be turned off. */
  'account-safety': {
    /** 2026-11-27 — phrases (the bell's own, notice-words/), so the email is written in the reader's language too. */
    headline: SayValue;
    what: SayValue;
    next: SayValue;
    when: string;
    until?: string;
  };
  /** Four years without a sign-in: the account can be closed, if its owner wants (the user, 2026-10-22). */
  'account-may-close': { lastSignInAt: string };
  /** 2026-11-03 — a second kind of account under an address that has one: its owner's "Yes, it is me" links them (AccountService). */
  'yes-it-is-me': { email: string; name: string; kind: SayValue; other: SayValue; url: string };
  /**
   * The day before somebody is expected in person: when, where, and what to bring. `yours` — they made the
   * appointment; false, the other person did and this one may come too. `fits` false: the office has since changed
   * when it receives visitors, and the reminder says to choose again instead of what to bring.
   */
  'appointment-reminder': { yours: boolean; fits: boolean; day: SayValue; hour?: SayValue; where: SayValue; reference: string; bring: SayValue[] };
  /** Somebody wrote to us from the help (support.service.ts): thanked, with the reference to quote. */
  'support-received': { reference: string; category: string; message: string };
  /** A member of staff answered a message written from the help. */
  'support-answer': { reference: string; asked: string; answer: string; by: string };
}

const WELCOME_INTRO: Record<AccountMailParams['welcome']['role'], NoticeKey> = {
  shop: 'mail.welcome.intro.shop',
  hub: 'mail.welcome.intro.hub',
  store: 'mail.welcome.intro.store',
  driver: 'mail.welcome.intro.driver',
};
const WELCOME_APP: Record<AccountMailParams['welcome']['role'], MailApp> = { shop: 'agent', hub: 'mdp', driver: 'driver', store: 'vendor' };

/** What a message to us was about, by the help's own words (support.types.ts), as phrases. */
const SUPPORT_TOPIC_KEY: Record<string, NoticeKey> = {
  'sign-in': 'mail.support-received.topic.sign-in',
  parcel: 'mail.support-received.topic.parcel',
  damage: 'mail.support-received.topic.damage',
  money: 'mail.support-received.topic.money',
  joining: 'mail.support-received.topic.joining',
  business: 'mail.support-received.topic.business',
  safety: 'mail.support-received.topic.safety',
  privacy: 'mail.support-received.topic.privacy',
  other: 'mail.support-received.topic.other',
};

export const ACCOUNT_MAILS: MailTemplates<keyof AccountMailParams> = {
  'password-reset': {
    title: 'Password reset code',
    sentWhen: 'Somebody taps “I forgot my password” in the Shop or Hub app.',
    wired: true,
    // A code for somebody waiting at a screen: they ask again.
    sendLater: false,
    asked: true,
    sample: { email: 'amina@example.com', code: 'RST-4F9A2C1B7K3M', minutes: 30, app: 'agent' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.password-reset.subject'),
      preheader: w.say('mail.password-reset.preheader', { code: p.code, minutes: p.minutes }),
      blocks: [
        { kind: 'heading', text: w.say('mail.password-reset.heading') },
        { kind: 'paragraph', text: w.say('mail.password-reset.lede', { email: p.email, app: w.app(p.app) }) },
        { kind: 'code', label: w.say('mail.password-reset.codeLabel'), value: p.code, note: w.say('mail.password-reset.codeNote', { minutes: p.minutes }) },
        { kind: 'paragraph', text: w.say('mail.password-reset.steps') },
        { kind: 'button', label: w.say('mail.password-reset.open', { app: w.app(p.app) }), href: appUrl(p.app) },
        {
          kind: 'warning',
          title: w.say('mail.password-reset.warnTitle'),
          text: w.say('mail.password-reset.warnText', { minutes: p.minutes }),
        },
      ],
      reason: w.say('mail.password-reset.reason'),
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
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.password-changed.subject'),
      preheader: w.say('mail.password-changed.preheader', { email: p.email, when: w.when(p.when) }),
      blocks: [
        { kind: 'heading', text: w.say('mail.password-changed.heading') },
        { kind: 'paragraph', text: w.say('mail.password-changed.lede', { app: w.app(p.app) }) },
        { kind: 'facts', rows: [[w.say('mail.password-changed.account'), p.email], [w.say('mail.password-changed.when'), w.when(p.when)]] },
        { kind: 'paragraph', text: w.say('mail.password-changed.signedOut') },
        {
          kind: 'warning',
          title: w.say('mail.password-changed.warnTitle'),
          text: p.recovery === 'self-reset' ? w.say('mail.password-changed.warnSelfReset') : w.say('mail.password-changed.warnAskAdmin'),
        },
        ...(p.recovery === 'self-reset' ? [{ kind: 'button' as const, label: w.say('mail.password-changed.open', { app: w.app(p.app) }), href: appUrl(p.app) }] : []),
      ],
      reason: w.say('mail.password-changed.reason'),
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
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.password-locked.subject'),
      preheader: w.say('mail.password-locked.preheader', { email: p.email, until: w.when(p.until) }),
      blocks: [
        { kind: 'heading', text: w.say('mail.password-locked.heading') },
        { kind: 'paragraph', text: w.say('mail.password-locked.lede', { email: p.email, app: w.app(p.app) }) },
        { kind: 'facts', rows: [[w.say('mail.password-locked.account'), p.email], [w.say('mail.password-locked.when'), w.when(p.when)], [w.say('mail.password-locked.lockedUntil'), w.when(p.until)]] },
        {
          kind: 'warning',
          title: w.say('mail.password-locked.warnTitle'),
          text: p.recovery === 'self-reset' ? w.say('mail.password-locked.warnSelfReset') : w.say('mail.password-locked.warnAskAdmin'),
        },
        { kind: 'paragraph', text: w.say('mail.password-locked.longer') },
        ...(p.recovery === 'self-reset' ? [{ kind: 'button' as const, label: w.say('mail.password-locked.open', { app: w.app(p.app) }), href: appUrl(p.app) }] : []),
      ],
      reason: w.say('mail.password-locked.reason'),
    }),
  },
  welcome: {
    title: 'Welcome',
    sentWhen: 'A shop, hub or courier signs up with an email address; a store is registered with one, or sets its account up.',
    wired: true,
    sendLater: 48,
    sample: { name: 'Mama Sarah Shop', email: 'amina@example.com', role: 'shop' },
    also: [{ key: 'store', label: 'A store', sample: { name: 'Duka Bora', email: 'orders@dukabora.example', role: 'store' } }],
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.welcome.subject', { name: p.name }),
      preheader: w.say(WELCOME_INTRO[p.role]),
      blocks: [
        { kind: 'heading', text: w.say('mail.welcome.heading', { name: p.name }) },
        { kind: 'paragraph', text: w.say(WELCOME_INTRO[p.role]) },
        { kind: 'facts', rows: [[w.say('mail.welcome.signInWith'), p.role === 'driver' ? w.say('mail.welcome.phoneAndPin') : p.email]] },
        { kind: 'button', label: w.say('mail.welcome.open', { app: w.app(WELCOME_APP[p.role]) }), href: appUrl(WELCOME_APP[p.role]) },
        { kind: 'note', text: p.role === 'driver' ? w.say('mail.welcome.notePin') : w.say('mail.welcome.notePassword') },
      ],
      reason: w.say('mail.welcome.reason'),
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
    phrased: true,
    build: (p, w) => {
      const WHY: Record<AccountMailParams['email-code']['why'], { heading: NoticeKey; lead: NoticeKey }> = {
        confirm: { heading: 'mail.email-code.why.confirm.heading', lead: 'mail.email-code.why.confirm.lead' },
        recover: { heading: 'mail.email-code.why.recover.heading', lead: 'mail.email-code.why.recover.lead' },
        undo: { heading: 'mail.email-code.why.undo.heading', lead: 'mail.email-code.why.undo.lead' },
      };
      const why = WHY[p.why];
      return {
        subject: w.say('mail.email-code.subject', { code: p.code }),
        preheader: w.say('mail.email-code.preheader', { code: p.code, minutes: p.minutes }),
        blocks: [
          { kind: 'heading', text: w.say(why.heading) },
          { kind: 'paragraph', text: w.say(why.lead) },
          { kind: 'code', label: w.say('mail.email-code.codeLabel'), value: p.code, note: w.say('mail.email-code.codeNote', { minutes: p.minutes }) },
          { kind: 'warning', title: w.say('mail.email-code.warnTitle'), text: w.say('mail.email-code.warnText') },
        ],
        reason: w.say('mail.email-code.reason'),
      };
    },
  },
  'account-safety': {
    stillToRest: true,
    title: 'Something changed about how you sign in',
    sentWhen: 'A PIN is locked by wrong guesses, a phone number is changed or put back, an account is recovered, or the recovery email is replaced.',
    wired: true,
    // An alarm is worth having late: it is how somebody learns their sign-in was changed.
    sendLater: 48,
    sample: { headline: 'Your phone number was changed', what: 'Your SeeBuyGet account now signs in with a different phone number.', next: 'If it was not you: within 24 hours, open any SeeBuyGet app, choose “Trouble signing in?” and then “Undo a number change”.', when: '2026-10-01T17:42:00Z', until: '2026-10-02T17:42:00Z' },
    // 2026-11-27 — every word a phrase (notice-words/<lang>/safety.ts), what happened as the bell's own phrases.
    phrased: true,
    build: (p, w) => {
      const headline = w.text(p.headline);
      return {
        // English keeps its subject as it was: the headline, its first letter made small.
        subject: w.lang === 'en' ? `SeeBuyGet: ${headline.charAt(0).toLowerCase()}${headline.slice(1)}` : w.say('mail.safety.subject', { headline: p.headline }),
        preheader: w.text(p.what),
        blocks: [
          { kind: 'heading', text: headline },
          { kind: 'paragraph', text: w.text(p.what) },
          { kind: 'facts', rows: [[w.say('mail.safety.when'), w.when(p.when)], ...(p.until ? ([[w.say('mail.safety.until'), w.when(p.until)]] as Array<[string, string]>) : [])] },
          { kind: 'warning', title: w.say('mail.safety.whatToDo'), text: w.text(p.next) },
          { kind: 'button', label: w.say('mail.safety.help'), href: helpUrl('account-recovery') },
        ],
        reason: w.say('mail.safety.reason'),
      };
    },
  },
  'account-may-close': {
    stillToRest: true,
    title: 'Your account can be closed',
    sentWhen: 'An account has gone four years without a sign-in. Once for each four years; nothing closes by itself.',
    wired: true,
    // Late is still worth knowing: it changes nothing until the owner acts.
    sendLater: 72,
    sample: { lastSignInAt: '2026-10-22T08:15:00Z' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.account-may-close.subject'),
      preheader: w.say('mail.account-may-close.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.account-may-close.heading') },
        { kind: 'paragraph', text: w.say('mail.account-may-close.lede') },
        { kind: 'facts', rows: [[w.say('mail.account-may-close.lastSignedIn'), w.when(p.lastSignInAt)]] },
        { kind: 'paragraph', text: w.say('mail.account-may-close.removes') },
        { kind: 'paragraph', text: w.say('mail.account-may-close.how') },
        { kind: 'warning', title: w.say('mail.account-may-close.warnTitle'), text: w.say('mail.account-may-close.warnText') },
        { kind: 'button', label: w.say('mail.account-may-close.help'), href: helpUrl('close-account') },
      ],
      reason: w.say('mail.account-may-close.reason'),
    }),
  },
  'yes-it-is-me': {
    title: 'Is this you? One email for your SeeBuyGet accounts',
    sentWhen: 'A shop, hub or store signs up with an email that already signs in to another kind of SeeBuyGet account. Its button links the two; until it is clicked, the new one does not sign in.',
    wired: true,
    // A week to click it: worth having late, as long as it is inside the week.
    sendLater: 72,
    sample: { email: 'amani@example.com', name: 'Mama Amani Shop', kind: 'shop', other: 'store', url: 'https://seebuyget.com/#link=a-sample-token-that-links-nothing-00000' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.yes-it-is-me.subject', { name: p.name }),
      preheader: w.say('mail.yes-it-is-me.preheader', { kind: p.kind, email: p.email, other: p.other }),
      blocks: [
        { kind: 'heading', text: w.say('mail.yes-it-is-me.heading') },
        { kind: 'paragraph', text: w.say('mail.yes-it-is-me.lede', { kind: p.kind, name: p.name, email: p.email, other: p.other }) },
        { kind: 'button', label: w.say('mail.yes-it-is-me.button'), href: p.url },
        { kind: 'paragraph', text: w.say('mail.yes-it-is-me.ifNot', { kind: p.kind }) },
      ],
      reason: w.say('mail.yes-it-is-me.reason', { email: p.email, other: p.other, kind: p.kind }),
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
    phrased: true,
    build: (p, w) => {
      const when = p.hour ? w.say('mail.appointment-reminder.whenComma', { day: p.day, hour: p.hour }) : w.text(p.day);
      const where = w.text(p.where);
      if (!p.fits) {
        return {
          subject: w.say('mail.appointment-reminder.nofit.subject'),
          preheader: w.say('mail.appointment-reminder.nofit.preheader'),
          blocks: [
            { kind: 'heading', text: w.say('mail.appointment-reminder.nofit.heading') },
            { kind: 'paragraph', text: w.say('mail.appointment-reminder.nofit.lede', { when }) },
            { kind: 'facts', rows: [[w.say('mail.appointment-reminder.nofit.wasFor'), when], [w.say('mail.appointment-reminder.where'), where], [w.say('mail.appointment-reminder.reference'), p.reference]] },
            { kind: 'warning', title: w.say('mail.appointment-reminder.nofit.warnTitle'), text: p.yours ? w.say('mail.appointment-reminder.nofit.warnMine') : w.say('mail.appointment-reminder.nofit.warnOther') },
            { kind: 'button', label: w.say('mail.appointment-reminder.help'), href: helpUrl('account-recovery') },
          ],
          reason: w.say('mail.appointment-reminder.reason'),
        };
      }
      return {
        subject: w.say('mail.appointment-reminder.subject'),
        preheader: w.say('mail.appointment-reminder.preheader', { when }),
        blocks: [
          { kind: 'heading', text: p.yours ? w.say('mail.appointment-reminder.headingMine') : w.say('mail.appointment-reminder.headingOther') },
          {
            kind: 'paragraph',
            text: p.yours ? w.say('mail.appointment-reminder.ledeMine') : w.say('mail.appointment-reminder.ledeOther'),
          },
          {
            kind: 'facts',
            rows: [
              [w.say('mail.appointment-reminder.when'), when],
              [w.say('mail.appointment-reminder.where'), where],
              [w.say('mail.appointment-reminder.reference'), p.reference],
              ...p.bring.map((item, i) => [i === 0 ? w.say('mail.appointment-reminder.bring') : '', w.text(item)] as [string, string]),
            ],
          },
          {
            kind: 'warning',
            title: p.yours ? w.say('mail.appointment-reminder.warnTitleMine') : w.say('mail.appointment-reminder.warnTitleOther'),
            text: p.yours ? w.say('mail.appointment-reminder.warnTextMine') : w.say('mail.appointment-reminder.warnTextOther'),
          },
          { kind: 'button', label: w.say('mail.appointment-reminder.help'), href: helpUrl('account-recovery') },
        ],
        reason: w.say('mail.appointment-reminder.reason'),
      };
    },
  },
  'support-received': {
    stillToRest: true,
    title: 'We have your message (written from the help)',
    sentWhen: 'Somebody writes to SeeBuyGet from “Write to us” in the help.',
    wired: true,
    sendLater: 24,
    sample: { reference: 'SBG-7KQ2MX', category: 'parcel', message: 'My parcel has said “on its way” for three days. The tracking code is ABC123.' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.support-received.subject', { reference: p.reference }),
      preheader: w.say('mail.support-received.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.support-received.heading') },
        { kind: 'paragraph', text: w.say('mail.support-received.lede') },
        { kind: 'facts', rows: [[w.say('mail.support-received.reference'), p.reference], [w.say('mail.support-received.about'), w.say(SUPPORT_TOPIC_KEY[p.category] ?? SUPPORT_TOPIC_KEY.other)]] },
        { kind: 'paragraph', text: w.say('mail.support-received.wrote', { message: p.message.length > 400 ? `${p.message.slice(0, 400)}…` : p.message }) },
        { kind: 'warning', title: w.say('mail.support-received.warnTitle'), text: w.say('mail.support-received.warnText') },
      ],
      reason: w.say('mail.support-received.reason'),
    }),
  },
  'support-answer': {
    stillToRest: true,
    title: 'An answer to a message written from the help',
    sentWhen: 'A member of SeeBuyGet staff answers a message on the console’s Messages.',
    wired: true,
    sendLater: 48,
    sample: { reference: 'SBG-7KQ2MX', asked: 'My parcel has said “on its way” for three days.', answer: 'It reached the shop this morning: you can collect it with your code.', by: 'Amina Otieno' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.support-answer.subject', { reference: p.reference }),
      preheader: p.answer.length > 90 ? `${p.answer.slice(0, 90)}…` : p.answer,
      blocks: [
        { kind: 'heading', text: w.say('mail.support-answer.heading') },
        { kind: 'paragraph', text: p.answer },
        { kind: 'facts', rows: [[w.say('mail.support-answer.from'), w.say('mail.support-answer.by', { by: p.by })], [w.say('mail.support-answer.reference'), p.reference]] },
        { kind: 'paragraph', text: w.say('mail.support-answer.wrote', { asked: p.asked.length > 300 ? `${p.asked.slice(0, 300)}…` : p.asked }) },
        { kind: 'warning', title: w.say('mail.support-answer.warnTitle'), text: w.say('mail.support-answer.warnText') },
      ],
      reason: w.say('mail.support-answer.reason'),
    }),
  },
};
