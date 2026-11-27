import { appUrl, type MailTemplates } from './mail.kit';
import type { SayValue } from '../../modules/pudo/notice-words/say';

/*
 * 2026-11-27 — THE STAFF EMAILS. Our staff and the people who run a company of ours: their accounts, a payout run, the trail and its auditor. Each email's parameters, and its words.
 */

export interface StaffMailParams {
  'company-admin-added': { name: string; email: string; company: string; addedBy: string };
  'staff-account-added': { name: string; email: string; addedBy: string };
  /** A new member of staff chooses their own password by this link. Nobody on staff is ever shown one. */
  'staff-account-welcome': { name: string; email: string; addedBy: string; link: string; hours: number };
  'staff-two-step': { name: string; what: SayValue; next: SayValue; when: string };
  /** Who is on staff changed, or somebody asked for it to: said to members of staff. */
  'staff-account-news': { what: SayValue; next: SayValue; when: string };
  /** The system raised a company's payout run this morning: one member of staff with the money role checks it and approves sending (2026-10-27). */
  'payout-run-waiting': { company: string; day: string; count: number; total: SayValue; skipped: number };
  'access-removed': { email: string; what: SayValue; removedBy: string; when: string };
  /** Round 40 — the trail's head, once a day, to the auditor SeeBuyGet staff named. */
  'trail-head': { date: string; height: number; txId: string; whole: boolean; brokenAt?: number };
  /** Round 40 — this address now receives the daily head. */
  'trail-auditor-named': { to: string; proposedBy: string; approvedBy: string; at: string; nextAt: string };
  /** Round 40 — the daily head now goes to another address: told to the one it went to. */
  'trail-auditor-changed': { from: string; to: string; proposedBy: string; approvedBy: string; at: string; nextAt: string };
}

export const STAFF_MAILS: MailTemplates<keyof StaffMailParams> = {
  'company-admin-added': {
    title: 'Company administrator added',
    sentWhen: 'Somebody creates an administrator login for a company in the operator console.',
    wired: true,
    sendLater: 48,
    sample: { name: 'Wanjiru Kamau', email: 'wanjiru@sbg-ke.example', company: 'SeeBuyGet Kenya', addedBy: 'Amina Otieno' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.company-admin-added.subject', { company: p.company }),
      preheader: w.say('mail.company-admin-added.preheader', { addedBy: p.addedBy, company: p.company }),
      blocks: [
        { kind: 'heading', text: w.say('mail.company-admin-added.heading') },
        { kind: 'paragraph', text: w.say('mail.company-admin-added.lede', { addedBy: p.addedBy, name: p.name, company: p.company }) },
        { kind: 'facts', rows: [[w.say('mail.company-admin-added.factCompany'), p.company], [w.say('mail.company-admin-added.factSignIn'), p.email], [w.say('mail.company-admin-added.factScreen'), w.say('mail.company-admin-added.screenValue')]] },
        { kind: 'paragraph', text: w.say('mail.company-admin-added.passwordNote') },
        { kind: 'button', label: w.say('mail.company-admin-added.button'), href: appUrl('console') },
        { kind: 'warning', title: w.say('mail.company-admin-added.warnTitle'), text: w.say('mail.company-admin-added.warnText', { addedBy: p.addedBy, company: p.company }) },
      ],
      reason: w.say('mail.company-admin-added.reason'),
    }),
  },
  'staff-account-added': {
    title: 'Network staff account added',
    sentWhen: 'The setup key makes a staff account alone: the first on a new installation (to the new address).',
    wired: true,
    sendLater: 48,
    sample: { name: 'Chloe Wanjiru', email: 'chloe@seebuyget.example', addedBy: 'Amina Otieno' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.staff-account-added.subject'),
      preheader: w.say('mail.staff-account-added.preheader', { addedBy: p.addedBy }),
      blocks: [
        { kind: 'heading', text: w.say('mail.staff-account-added.heading') },
        { kind: 'paragraph', text: w.say('mail.staff-account-added.lede', { addedBy: p.addedBy, name: p.name }) },
        { kind: 'facts', rows: [[w.say('mail.staff-account-added.factSignIn'), p.email], [w.say('mail.staff-account-added.factScreen'), w.say('mail.staff-account-added.screenValue')]] },
        { kind: 'paragraph', text: w.say('mail.staff-account-added.passwordNote') },
        { kind: 'button', label: w.say('mail.staff-account-added.button'), href: appUrl('console') },
        { kind: 'warning', title: w.say('mail.staff-account-added.warnTitle'), text: w.say('mail.staff-account-added.warnText', { addedBy: p.addedBy }) },
      ],
      reason: w.say('mail.staff-account-added.reason'),
    }),
  },
  'staff-account-welcome': {
    title: 'Network staff account: choose your password',
    sentWhen: 'A second person approves a staff account that was asked for, or somebody on staff sends the link again (to the new address, and to nobody else).',
    wired: true,
    // The link in it works for two days: handed over a day late, it still has a day left.
    sendLater: 24,
    sample: { name: 'Chloe Wanjiru', email: 'chloe@seebuyget.example', addedBy: 'Amina Otieno and Brian Kamau', link: 'https://console.seebuyget.example/#welcome=3q2-7wAAAAAAAAAAAAAAAAAAAAAAAAAA', hours: 48 },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.staff-account-welcome.subject'),
      preheader: w.say('mail.staff-account-welcome.preheader', { addedBy: p.addedBy }),
      blocks: [
        { kind: 'heading', text: w.say('mail.staff-account-welcome.heading') },
        { kind: 'paragraph', text: w.say('mail.staff-account-welcome.lede', { addedBy: p.addedBy, name: p.name }) },
        { kind: 'facts', rows: [[w.say('mail.staff-account-welcome.factSignIn'), p.email], [w.say('mail.staff-account-welcome.factScreen'), w.say('mail.staff-account-welcome.screenValue')]] },
        { kind: 'paragraph', text: w.say('mail.staff-account-welcome.passwordNote', { hours: p.hours }) },
        { kind: 'button', label: w.say('mail.staff-account-welcome.button'), href: p.link },
        { kind: 'warning', title: w.say('mail.staff-account-welcome.warnTitle'), text: w.say('mail.staff-account-welcome.warnText', { addedBy: p.addedBy }) },
      ],
      reason: w.say('mail.staff-account-welcome.reason'),
    }),
  },
  'staff-two-step': {
    title: 'Staff two-step sign-in reset',
    sentWhen: 'Two other members of staff reset somebody’s two-step sign-in, because they lost their authenticator.',
    wired: true,
    // An alarm.
    sendLater: 48,
    sample: { name: 'Chloe Wanjiru', what: 'Your two-step sign-in was reset by Amina Otieno and Brian Kamau.', next: 'You were signed out. The next time you sign in, scan the new QR code with your authenticator app. If you did not ask for this, tell them at once.', when: '2026-10-03T09:12:00Z' },
    phrased: true,
    build: (p, w) => {
      const what = w.text(p.what);
      return {
        subject: w.say('mail.staff-two-step.subject'),
        preheader: what,
        blocks: [
          { kind: 'heading', text: w.say('mail.staff-two-step.heading') },
          // English makes the first letter of what happened small after the name; another language says it as it is.
          { kind: 'paragraph', text: w.lang === 'en' ? `${p.name}, ${what.charAt(0).toLowerCase()}${what.slice(1)}` : w.say('mail.staff-two-step.lede', { name: p.name, what: p.what }) },
          { kind: 'facts', rows: [[w.say('mail.staff-two-step.factWhen'), w.when(p.when)]] },
          { kind: 'warning', title: w.say('mail.staff-two-step.warnTitle'), text: w.text(p.next) },
          { kind: 'button', label: w.say('mail.staff-two-step.button'), href: appUrl('console') },
        ],
        reason: w.say('mail.staff-two-step.reason'),
      };
    },
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
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.staff-account-news.subject'),
      preheader: w.text(p.what),
      blocks: [
        { kind: 'heading', text: w.say('mail.staff-account-news.heading') },
        { kind: 'paragraph', text: w.text(p.what) },
        { kind: 'facts', rows: [[w.say('mail.staff-account-news.factWhen'), w.when(p.when)]] },
        { kind: 'warning', title: w.say('mail.staff-account-news.warnTitle'), text: w.text(p.next) },
        { kind: 'button', label: w.say('mail.staff-account-news.button'), href: appUrl('console') },
      ],
      reason: w.say('mail.staff-account-news.reason'),
    }),
  },
  'payout-run-waiting': {
    title: 'The morning payout run waits for approval',
    sentWhen: 'The system raised a company’s payout run at 06:00 on that company’s own clock, with at least one payout in it — to every member of staff who holds the money role.',
    wired: true,
    // A notice: a run nobody approved is still waiting a day later.
    sendLater: 24,
    sample: { company: 'SeeBuyGet Kenya', day: '2026-10-28', count: 7, total: 'KES 18,420.00', skipped: 1 },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.payout-run-waiting.subject', { count: p.count, company: p.company }),
      preheader: w.say('mail.payout-run-waiting.preheader', { day: p.day, total: p.total }),
      blocks: [
        { kind: 'heading', text: w.say('mail.payout-run-waiting.heading') },
        { kind: 'paragraph', text: w.say('mail.payout-run-waiting.lede', { count: p.count, company: p.company, day: p.day }) },
        {
          kind: 'facts',
          rows: [
            [w.say('mail.payout-run-waiting.factCompany'), p.company],
            [w.say('mail.payout-run-waiting.factFor'), p.day],
            [w.say('mail.payout-run-waiting.factPayouts'), String(p.count)],
            [w.say('mail.payout-run-waiting.factTotal'), w.text(p.total)],
            ...(p.skipped ? [[w.say('mail.payout-run-waiting.factSkipped'), w.say('mail.payout-run-waiting.skipped', { count: String(p.skipped) })] as [string, string]] : []),
          ],
        },
        { kind: 'button', label: w.say('mail.payout-run-waiting.button'), href: appUrl('console') },
      ],
      reason: w.say('mail.payout-run-waiting.reason'),
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
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.access-removed.subject'),
      preheader: w.say('mail.access-removed.preheader', { removedBy: p.removedBy, what: p.what }),
      blocks: [
        { kind: 'heading', text: w.say('mail.access-removed.heading') },
        { kind: 'paragraph', text: w.say('mail.access-removed.lede', { removedBy: p.removedBy, what: p.what, when: w.when(p.when), email: p.email }) },
        { kind: 'paragraph', text: w.say('mail.access-removed.record') },
        { kind: 'warning', title: w.say('mail.access-removed.warnTitle'), text: w.say('mail.access-removed.warnText', { removedBy: p.removedBy }) },
      ],
      reason: w.say('mail.access-removed.reason'),
    }),
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
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.trail-head.subject', { date: p.date, height: String(p.height) }),
      preheader: w.say('mail.trail-head.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.trail-head.heading', { date: p.date }) },
        { kind: 'paragraph', text: w.say('mail.trail-head.lede') },
        {
          kind: 'facts',
          rows: [
            [w.say('mail.trail-head.factDay'), p.date],
            [w.say('mail.trail-head.factLinks'), String(p.height)],
            [w.say('mail.trail-head.factNewest'), p.txId || w.say('mail.trail-head.noneYet')],
            [w.say('mail.trail-head.factWhole'), p.whole ? w.say('mail.trail-head.wholeYes') : w.say('mail.trail-head.wholeNo', { brokenAt: String(p.brokenAt) })],
          ],
        },
        { kind: 'note', text: w.say('mail.trail-head.note') },
      ],
      reason: w.say('mail.trail-head.reason'),
    }),
  },
  'trail-auditor-named': {
    title: 'An address is named the trail’s auditor',
    sentWhen: 'A second member of staff approves this address for the trail’s daily fingerprint.',
    wired: true,
    sendLater: 48,
    sample: { to: 'audit@example.com', proposedBy: 'Amina Otieno', approvedBy: 'Brian Kamau', at: '2026-10-22T15:40:00.000Z', nextAt: '2026-10-23T00:05:00.000Z' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.trail-auditor-named.subject'),
      preheader: w.say('mail.trail-auditor-named.preheader', { nextAt: w.when(p.nextAt) }),
      blocks: [
        { kind: 'heading', text: w.say('mail.trail-auditor-named.heading') },
        { kind: 'paragraph', text: w.say('mail.trail-auditor-named.lede', { nextAt: w.when(p.nextAt) }) },
        { kind: 'facts', rows: [[w.say('mail.trail-auditor-named.factAskedBy'), p.proposedBy], [w.say('mail.trail-auditor-named.factApprovedBy'), p.approvedBy], [w.say('mail.trail-auditor-named.factWhen'), w.when(p.at)]] },
        { kind: 'warning', title: w.say('mail.trail-auditor-named.warnTitle'), text: w.say('mail.trail-auditor-named.warnText') },
      ],
      reason: w.say('mail.trail-auditor-named.reason'),
    }),
  },
  'trail-auditor-changed': {
    title: 'The trail’s daily fingerprint goes elsewhere (to the address it went to)',
    sentWhen: 'A second member of staff approves another address for the trail’s daily fingerprint.',
    wired: true,
    sendLater: 48,
    sample: { from: 'audit@example.com', to: 'audit@another.example', proposedBy: 'Amina Otieno', approvedBy: 'Brian Kamau', at: '2026-10-22T15:40:00.000Z', nextAt: '2026-10-23T00:05:00.000Z' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.trail-auditor-changed.subject'),
      preheader: w.say('mail.trail-auditor-changed.preheader', { to: p.to, nextAt: w.when(p.nextAt) }),
      blocks: [
        { kind: 'heading', text: w.say('mail.trail-auditor-changed.heading') },
        { kind: 'paragraph', text: w.say('mail.trail-auditor-changed.lede', { nextAt: w.when(p.nextAt), to: p.to }) },
        { kind: 'facts', rows: [[w.say('mail.trail-auditor-changed.factNowTo'), p.to], [w.say('mail.trail-auditor-changed.factAskedBy'), p.proposedBy], [w.say('mail.trail-auditor-changed.factApprovedBy'), p.approvedBy], [w.say('mail.trail-auditor-changed.factWhen'), w.when(p.at)]] },
        { kind: 'warning', title: w.say('mail.trail-auditor-changed.warnTitle'), text: w.say('mail.trail-auditor-changed.warnText') },
      ],
      reason: w.say('mail.trail-auditor-changed.reason'),
    }),
  },
};
