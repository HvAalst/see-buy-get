import { appUrl, type MailTemplates } from './mail.kit';
import type { SayValue } from '../../modules/pudo/notice-words/say';

/*
 * 2026-11-27 — THE COMPANY EMAILS. Companies on the network — fleets, businesses, stores: signing up, their papers, their systems and the API. Each email's parameters, and its words.
 */

export interface CompanyMailParams {
  /** A fleet that signed itself up on the front page: its papers were received, approved, sent back with the reason, or it is active. */
  'fleet-signup': { company: string; stage: 'received' | 'approved' | 'refused' | 'active'; reason?: string; when: string };
  'fleet-code-issued': { company: string; when: string; byStaff: boolean };
  'fleet-code-due': { company: string; days: number };
  /**
   * A licence or an insurance policy of one of OUR companies is running out, or has lapsed — to that company's own
   * administrators. `stops`: what switches off the day after, in words; empty when nothing does by itself.
   * `daysLeft` 0 is the expiry date itself.
   */
  'company-paper-lapsing': { company: string; country?: string; paper: SayValue; reference: string; expiresOn: string; daysLeft: number; lapsed: boolean; stops: SayValue[]; where: 'licence' | 'insurance'; /** The company keeps its own record (it is switched on): it enters the new date itself, with the paper. */ own: boolean };
  /** A company's own administrator changed a part of its record that switches something. Sent to the OTHER administrators, and those of the company above it. */
  'company-record-changed': { company: string; by: string; part: SayValue; change: 'added' | 'changed' | 'removed'; was: SayValue; now: SayValue; paper: boolean };
  /** A paper on a company's record was reported as not right. To its administrators and those of the company above it: what was said, never by whom. */
  'company-paper-reported': { company: string; paper: string; said: SayValue; note: string; answerBy: string };
  /** The report was decided: dismissed by one member of staff, or the paper struck by two. `effect`: what a strike put back, in words. */
  'company-paper-decided': { company: string; paper: string; outcome: 'dismissed' | 'struck'; reason: string; effect: SayValue };
  'papers-due': { company: string; lapsed: SayValue[]; due: SayValue[] };
  /** B1 — SeeBuyGet checked a business, or refused to, with the reason. Sent to its owners by the decision itself. */
  'business-checked': { business: string; outcome: 'verified' | 'refused'; reason?: string; when: string };
  /** Round 10 — a business's own system has not taken our messages about its loads. To its owners, at most once a day. */
  'business-system-down': { business: string; count: number; since: string };
  /** Messages to a fleet's own system were given up after two days of tries (round 11). At most once a day, to its contact email. */
  'fleet-system-down': { fleet: string; count: number; since: string };
  /** A version of the API a company's key calls stops, announced a year ahead and said again a month before (round 12). */
  'api-version-retiring': { company: string; version: string; retiresAt: string; stage: 'announced' | 'month'; app: 'business' | 'fleet' };
  /** 2026-11-03 — a new rule inside a version of the API, with the day it starts refusing a system's call (api-rules.ts). */
  'api-rule-change': { company: string; rule: string; summary: SayValue; version: string; enforcedFrom: string; stage: 'announced' | 'soon'; app: 'business' | 'fleet' };
  'store-developer-link': { store: string; name: string; link: string; until: string; invited: boolean };
  /** 2026-11-16 — a store's developer made a live secret key: the owner told by email, as code hosts do for a new token. */
  'store-live-key': { store: string; developer: string; key: SayValue; at: string; link: string };
}

export const COMPANIES_MAILS: MailTemplates<keyof CompanyMailParams> = {
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
    phrased: true,
    build: (p, w) => {
      const reason = w.say('mail.fleet-signup.why');
      const company = p.company;
      if (p.stage === 'received') {
        return {
          subject: w.say('mail.fleet-signup.received.subject', { company }),
          preheader: w.say('mail.fleet-signup.received.preheader'),
          blocks: [
            { kind: 'heading', text: w.say('mail.fleet-signup.received.heading') },
            { kind: 'paragraph', text: w.say('mail.fleet-signup.received.lede', { company }) },
            { kind: 'facts', rows: [[w.say('mail.fleet-signup.label.fleet'), company], [w.say('mail.fleet-signup.label.sent'), w.when(p.when)]] },
            { kind: 'paragraph', text: w.say('mail.fleet-signup.received.next') },
          ],
          reason,
        };
      }
      if (p.stage === 'approved') {
        return {
          subject: w.say('mail.fleet-signup.approved.subject', { company }),
          preheader: w.say('mail.fleet-signup.approved.preheader'),
          blocks: [
            { kind: 'heading', text: w.say('mail.fleet-signup.approved.heading') },
            { kind: 'paragraph', text: w.say('mail.fleet-signup.approved.lede', { company }) },
            { kind: 'facts', rows: [[w.say('mail.fleet-signup.label.fleet'), company], [w.say('mail.fleet-signup.label.approved'), w.when(p.when)]] },
          ],
          reason,
        };
      }
      if (p.stage === 'refused') {
        return {
          subject: w.say('mail.fleet-signup.refused.subject', { company }),
          preheader: p.reason ?? w.say('mail.fleet-signup.refused.preheaderNone'),
          blocks: [
            { kind: 'heading', text: w.say('mail.fleet-signup.refused.heading') },
            { kind: 'paragraph', text: w.say('mail.fleet-signup.refused.lede', { company }) },
            { kind: 'warning', title: w.say('mail.fleet-signup.refused.warningTitle'), text: p.reason ?? w.say('mail.fleet-signup.refused.reasonNone') },
            { kind: 'paragraph', text: w.say('mail.fleet-signup.refused.next') },
            { kind: 'button', label: w.say('mail.fleet-signup.refused.button'), href: `${appUrl('home')}?join=fleet` },
          ],
          reason,
        };
      }
      return {
        subject: w.say('mail.fleet-signup.active.subject', { company }),
        preheader: w.say('mail.fleet-signup.active.preheader'),
        blocks: [
          { kind: 'heading', text: w.say('mail.fleet-signup.active.heading') },
          { kind: 'paragraph', text: w.say('mail.fleet-signup.active.lede', { company }) },
          { kind: 'facts', rows: [[w.say('mail.fleet-signup.label.fleet'), company], [w.say('mail.fleet-signup.label.activeSince'), w.when(p.when)]] },
          { kind: 'button', label: w.say('mail.fleet-signup.active.button', { app: w.app('fleet') }), href: appUrl('fleet') },
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
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.fleet-code-issued.subject', { company: p.company }),
      preheader: w.say('mail.fleet-code-issued.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.fleet-code-issued.heading') },
        { kind: 'paragraph', text: w.say(p.byStaff ? 'mail.fleet-code-issued.ledeStaff' : 'mail.fleet-code-issued.ledeManager', { company: p.company, when: w.when(p.when) }) },
        { kind: 'paragraph', text: w.say('mail.fleet-code-issued.notHere') },
        { kind: 'paragraph', text: w.say('mail.fleet-code-issued.nobodyOut') },
        { kind: 'button', label: w.say('mail.fleet-code-issued.button', { app: w.app('fleet') }), href: appUrl('fleet') },
        { kind: 'warning', title: w.say('mail.fleet-code-issued.warningTitle'), text: w.say('mail.fleet-code-issued.warningText') },
      ],
      reason: w.say('mail.fleet-code-issued.reason'),
    }),
  },
  'fleet-code-due': {
    title: 'Fleet code over 90 days old',
    sentWhen: 'A daily check finds a fleet code over 90 days old — once per code.',
    wired: true,
    // Sent once per code: nothing else would send it again.
    sendLater: 48,
    sample: { company: 'Kilima Logistics', days: 104 },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.fleet-code-due.subject', { company: p.company }),
      preheader: w.say('mail.fleet-code-due.preheader', { days: p.days }),
      blocks: [
        { kind: 'heading', text: w.say('mail.fleet-code-due.heading') },
        { kind: 'paragraph', text: w.say('mail.fleet-code-due.lede', { company: p.company, days: p.days }) },
        { kind: 'paragraph', text: w.say('mail.fleet-code-due.how') },
        { kind: 'button', label: w.say('mail.fleet-code-due.button', { app: w.app('fleet') }), href: appUrl('fleet') },
        { kind: 'note', text: w.say('mail.fleet-code-due.note') },
      ],
      reason: w.say('mail.fleet-code-due.reason'),
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
    phrased: true,
    build: (p, w) => {
      const paper = w.text(p.paper);
      const paperLow = `${paper.charAt(0).toLowerCase()}${paper.slice(1)}`;
      const when = p.lapsed
        ? w.say('mail.company-paper-lapsing.when.lapsed')
        : p.daysLeft <= 0
          ? w.say('mail.company-paper-lapsing.when.today')
          : p.daysLeft === 1
            ? w.say('mail.company-paper-lapsing.when.tomorrow')
            : w.say('mail.company-paper-lapsing.when.days', { n: p.daysLeft });
      const stops = p.stops.map((s) => w.text(s));
      const joined = (xs: string[]) => xs.reduce((a, b) => w.say('mail.company-paper-lapsing.list.join', { a, b }));
      const list = stops.length > 1 ? w.say('mail.company-paper-lapsing.list.or', { start: joined(stops.slice(0, -1)), last: stops[stops.length - 1] }) : (stops[0] ?? '');
      const consequence = p.lapsed
        ? stops.length
          ? w.say('mail.company-paper-lapsing.consequence.lapsedStops', { company: p.company, list })
          : w.say('mail.company-paper-lapsing.consequence.lapsedNone')
        : stops.length
          ? w.say('mail.company-paper-lapsing.consequence.soonStops', { company: p.company, list })
          : w.say('mail.company-paper-lapsing.consequence.soonNone');
      const licence = p.where === 'licence';
      const back = p.lapsed && stops.length ? 'Back' : '';
      return {
        subject: w.say('mail.company-paper-lapsing.subject', { paper, when, company: p.company }),
        preheader: consequence,
        blocks: [
          { kind: 'heading', text: w.say('mail.company-paper-lapsing.heading', { paper, when }) },
          { kind: 'paragraph', text: w.say(p.lapsed ? 'mail.company-paper-lapsing.body.lapsed' : 'mail.company-paper-lapsing.body.current', { company: p.company, paper: paperLow, date: w.date(p.expiresOn), consequence }) },
          {
            kind: 'facts',
            rows: [
              [w.say('mail.company-paper-lapsing.label.company'), p.company],
              [w.say('mail.company-paper-lapsing.label.paper'), w.say('mail.company-paper-lapsing.paperRow', { paper, reference: p.reference })],
              [w.say('mail.company-paper-lapsing.label.goodUntil'), w.date(p.expiresOn)],
              ...(stops.length ? ([[w.say(p.lapsed ? 'mail.company-paper-lapsing.label.switchedOff' : 'mail.company-paper-lapsing.label.thenSwitchesOff'), joined(stops)]] as Array<[string, string]>) : []),
            ],
          },
          {
            kind: 'warning',
            title: w.say('mail.company-paper-lapsing.warningTitle'),
            // Whose hands the new date is in: the company's own once it is switched on; until then staff enter it.
            text: p.own
              ? w.say(`mail.company-paper-lapsing.todo.own${licence ? 'Licence' : 'Insurance'}${back}` as 'mail.company-paper-lapsing.todo.ownLicence')
              : w.say(licence ? 'mail.company-paper-lapsing.todo.staffLicence' : 'mail.company-paper-lapsing.todo.staffInsurance'),
          },
          { kind: 'button', label: w.say('mail.company-paper-lapsing.button', { app: w.app('console') }), href: appUrl('console') },
          { kind: 'note', text: w.say('mail.company-paper-lapsing.note') },
        ],
        reason: w.say('mail.company-paper-lapsing.reason', { company: p.company }),
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
    phrased: true,
    build: (p, w) => {
      const part = w.text(p.part);
      const was = w.text(p.was);
      const now = w.text(p.now);
      return {
        subject: w.say(`mail.company-record-changed.subject.${p.change}` as 'mail.company-record-changed.subject.added', { by: p.by, part, company: p.company }),
        preheader: p.change === 'removed' ? w.say('mail.company-record-changed.preheader.was', { was }) : w.say('mail.company-record-changed.preheader.now', { now }),
        blocks: [
          { kind: 'heading', text: w.say('mail.company-record-changed.heading', { company: p.company }) },
          {
            kind: 'paragraph',
            text: w.say(`mail.company-record-changed.sentence.${p.change}${p.paper ? 'Paper' : ''}` as 'mail.company-record-changed.sentence.added', {
              by: p.by,
              part,
              company: p.company,
            }),
          },
          {
            kind: 'facts',
            rows: [
              [w.say('mail.company-record-changed.label.company'), p.company],
              [w.say('mail.company-record-changed.label.by'), p.by],
              [w.say('mail.company-record-changed.label.was'), was],
              [w.say('mail.company-record-changed.label.now'), now],
            ],
          },
          { kind: 'note', text: w.say('mail.company-record-changed.note') },
          { kind: 'button', label: w.say('mail.company-record-changed.button', { app: w.app('console') }), href: appUrl('console') },
        ],
        reason: w.say('mail.company-record-changed.reason', { company: p.company }),
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
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.company-paper-reported.subject', { company: p.company, date: w.date(p.answerBy) }),
      preheader: w.say('mail.company-paper-reported.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.company-paper-reported.heading') },
        { kind: 'paragraph', text: w.say('mail.company-paper-reported.lede', { company: p.company, said: p.said }) },
        {
          kind: 'facts',
          rows: [
            [w.say('mail.company-paper-reported.label.company'), p.company],
            [w.say('mail.company-paper-reported.label.paper'), p.paper],
            [w.say('mail.company-paper-reported.label.said'), p.note],
            [w.say('mail.company-paper-reported.label.answerBy'), w.date(p.answerBy)],
          ],
        },
        {
          kind: 'warning',
          title: w.say('mail.company-paper-reported.warningTitle'),
          text: w.say('mail.company-paper-reported.warningText', { date: w.date(p.answerBy) }),
        },
        { kind: 'button', label: w.say('mail.company-paper-reported.button', { app: w.app('console') }), href: appUrl('console') },
        { kind: 'note', text: w.say('mail.company-paper-reported.note') },
      ],
      reason: w.say('mail.company-paper-reported.reason', { company: p.company }),
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
    phrased: true,
    build: (p, w) => {
      const struck = p.outcome === 'struck';
      const effect = w.text(p.effect);
      return {
        subject: struck ? w.say('mail.company-paper-decided.subject.struck', { company: p.company }) : w.say('mail.company-paper-decided.subject.dismissed', { company: p.company }),
        preheader: struck ? effect : w.say('mail.company-paper-decided.preheader.dismissed'),
        blocks: [
          { kind: 'heading', text: struck ? w.say('mail.company-paper-decided.heading.struck') : w.say('mail.company-paper-decided.heading.dismissed') },
          {
            kind: 'paragraph',
            text: struck ? w.say('mail.company-paper-decided.lede.struck', { company: p.company, effect }) : w.say('mail.company-paper-decided.lede.dismissed', { company: p.company }),
          },
          {
            kind: 'facts',
            rows: [
              [w.say('mail.company-paper-decided.label.company'), p.company],
              [w.say('mail.company-paper-decided.label.paper'), p.paper],
              [w.say('mail.company-paper-decided.label.reason'), p.reason],
            ],
          },
          ...(struck ? [{ kind: 'warning', title: w.say('mail.company-paper-decided.warningTitle'), text: w.say('mail.company-paper-decided.warningText') } as const] : []),
          { kind: 'button', label: w.say('mail.company-paper-decided.button', { app: w.app('console') }), href: appUrl('console') },
        ],
        reason: w.say('mail.company-paper-decided.reason', { company: p.company }),
      };
    },
  },
  'papers-due': {
    title: 'Papers running out, and vehicles off the road (fleet)',
    sentWhen: 'The six-hourly papers check finds a vehicle or driver paper lapsed or due within 30 days — once per paper per expiry date.',
    wired: true,
    // Sent once per paper per expiry date: nothing else would send it again.
    sendLater: 48,
    sample: { company: 'Kilima Logistics', lapsed: ['Vehicle KLM 002B — Insurance lapsed 3 Sep 2026'], due: ['Vehicle KLM 001V — Inspection certificate runs out 12 Oct 2026 (28 days)', 'Driver Amos K. — Driving licence runs out 20 Oct 2026 (36 days)'] },
    phrased: true,
    build: (p, w) => ({
      subject: p.lapsed.length ? w.say('mail.papers-due.subject.lapsed', { n: p.lapsed.length, company: p.company }) : w.say('mail.papers-due.subject.due', { company: p.company }),
      preheader: p.lapsed.length ? w.say('mail.papers-due.preheader.lapsed', { n: p.lapsed.length }) : w.say('mail.papers-due.preheader.due', { n: p.due.length }),
      blocks: [
        { kind: 'heading', text: p.lapsed.length ? w.say('mail.papers-due.heading.lapsed') : w.say('mail.papers-due.heading.due') },
        ...(p.lapsed.length
          ? [
              { kind: 'paragraph', text: w.say('mail.papers-due.lapsedLede') } as const,
              { kind: 'facts', rows: p.lapsed.map((l, i) => [String(i + 1), w.text(l)] as [string, string]) } as const,
            ]
          : []),
        ...(p.due.length
          ? [
              { kind: 'paragraph', text: w.say('mail.papers-due.dueLede') } as const,
              { kind: 'facts', rows: p.due.map((l, i) => [String(i + 1), w.text(l)] as [string, string]) } as const,
            ]
          : []),
        { kind: 'button', label: w.say('mail.papers-due.button', { app: w.app('fleet') }), href: appUrl('fleet') },
        { kind: 'note', text: w.say('mail.papers-due.note') },
      ],
      reason: w.say('mail.papers-due.reason'),
    }),
  },
  'business-checked': {
    title: 'Your business was checked',
    sentWhen: 'A second member of staff verifies a business, or a member of staff refuses to, with the reason.',
    wired: true,
    // The decision stands; the app shows it either way.
    sendLater: 72,
    sample: { business: 'Abebe Import & Export PLC', outcome: 'verified', when: '2026-10-04T10:12:00Z' },
    phrased: true,
    build: (p, w) =>
      p.outcome === 'verified'
        ? {
            subject: w.say('mail.business-checked.verified.subject', { business: p.business }),
            preheader: w.say('mail.business-checked.verified.preheader'),
            blocks: [
              { kind: 'heading', text: w.say('mail.business-checked.verified.heading', { business: p.business }) },
              { kind: 'paragraph', text: w.say('mail.business-checked.verified.lede') },
              { kind: 'facts', rows: [[w.say('mail.business-checked.verified.label.business'), p.business], [w.say('mail.business-checked.verified.label.when'), w.when(p.when)]] },
              { kind: 'button', label: w.say('mail.business-checked.verified.button', { app: w.app('business') }), href: appUrl('business') },
            ],
            reason: w.say('mail.business-checked.reason'),
          }
        : {
            subject: w.say('mail.business-checked.refused.subject', { business: p.business }),
            preheader: p.reason ?? w.say('mail.business-checked.refused.preheaderNone'),
            blocks: [
              { kind: 'heading', text: w.say('mail.business-checked.refused.heading') },
              { kind: 'paragraph', text: w.say('mail.business-checked.refused.lede', { business: p.business }) },
              { kind: 'warning', title: w.say('mail.business-checked.refused.warningTitle'), text: p.reason ?? w.say('mail.business-checked.refused.reasonNone') },
              { kind: 'paragraph', text: w.say('mail.business-checked.refused.next') },
              { kind: 'button', label: w.say('mail.business-checked.refused.button', { app: w.app('business') }), href: appUrl('business') },
            ],
            reason: w.say('mail.business-checked.reason'),
          },
  },
  'business-system-down': {
    title: 'Your system is not taking our messages',
    sentWhen: 'Messages to a business’s own system about its loads were given up after two days of tries. At most once a day, to its owners.',
    wired: true,
    // A day late it is still true, and still the only way an owner hears it without opening the app.
    sendLater: 24,
    sample: { business: 'Abebe Import & Export PLC', count: 3, since: '2026-10-18T06:40:00Z' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.business-system-down.subject', { business: p.business }),
      preheader: w.say('mail.business-system-down.preheader', { count: p.count }),
      blocks: [
        { kind: 'heading', text: w.say('mail.business-system-down.heading') },
        { kind: 'paragraph', text: w.say('mail.business-system-down.lede', { since: w.when(p.since), count: p.count, app: w.app('business') }) },
        { kind: 'paragraph', text: w.say('mail.business-system-down.next', { app: w.app('business'), count: p.count }) },
        {
          kind: 'facts',
          rows: [
            [w.say('mail.business-system-down.label.business'), p.business],
            [w.say('mail.business-system-down.label.given'), String(p.count)],
            [w.say('mail.business-system-down.label.since'), w.when(p.since)],
          ],
        },
        { kind: 'button', label: w.say('mail.business-system-down.button', { app: w.app('business') }), href: appUrl('business') },
      ],
      reason: w.say('mail.business-system-down.reason'),
    }),
  },
  'fleet-system-down': {
    title: 'Your system is not taking our messages',
    sentWhen: 'Messages to a fleet’s own system about its work were given up after two days of tries. At most once a day, to the fleet’s contact email.',
    wired: true,
    // A day late it is still true, and still the only way an office hears it without opening the app.
    sendLater: 24,
    sample: { fleet: 'Pwani Hauliers Ltd', count: 3, since: '2026-10-18T06:40:00Z' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.fleet-system-down.subject', { fleet: p.fleet }),
      preheader: w.say('mail.fleet-system-down.preheader', { count: p.count }),
      blocks: [
        { kind: 'heading', text: w.say('mail.fleet-system-down.heading') },
        { kind: 'paragraph', text: w.say('mail.fleet-system-down.lede', { since: w.when(p.since), count: p.count, app: w.app('fleet') }) },
        { kind: 'paragraph', text: w.say('mail.fleet-system-down.next', { app: w.app('fleet'), count: p.count }) },
        {
          kind: 'facts',
          rows: [
            [w.say('mail.fleet-system-down.label.fleet'), p.fleet],
            [w.say('mail.fleet-system-down.label.given'), String(p.count)],
            [w.say('mail.fleet-system-down.label.since'), w.when(p.since)],
          ],
        },
        { kind: 'button', label: w.say('mail.fleet-system-down.button', { app: w.app('fleet') }), href: appUrl('fleet') },
      ],
      reason: w.say('mail.fleet-system-down.reason'),
    }),
  },
  'api-version-retiring': {
    title: 'A version of the API your system uses is stopping',
    sentWhen: 'A version of the API is announced as stopping (at least a year ahead), and again a month before it stops. To every company holding a live key: a business’s owners, a fleet’s contact email.',
    wired: true,
    // Late it is still true, and a year's notice has room for a day's delay.
    sendLater: 72,
    sample: { company: 'Pwani Hauliers Ltd', version: '1', retiresAt: '2027-11-01T00:00:00Z', stage: 'announced', app: 'fleet' },
    phrased: true,
    build: (p, w) => {
      const month = p.stage === 'month';
      return {
        subject: month
          ? w.say('mail.api-version-retiring.subject.month', { company: p.company, version: p.version })
          : w.say('mail.api-version-retiring.subject.announced', { company: p.company, version: p.version, when: w.when(p.retiresAt) }),
        preheader: w.say('mail.api-version-retiring.preheader', { version: p.version, when: w.when(p.retiresAt) }),
        blocks: [
          { kind: 'heading', text: month ? w.say('mail.api-version-retiring.heading.month', { version: p.version }) : w.say('mail.api-version-retiring.heading.announced', { version: p.version }) },
          { kind: 'paragraph', text: w.say('mail.api-version-retiring.lede', { version: p.version, when: w.when(p.retiresAt) }) },
          { kind: 'paragraph', text: month ? w.say('mail.api-version-retiring.next.month') : w.say('mail.api-version-retiring.next.announced') },
          {
            kind: 'facts',
            rows: [
              [w.say('mail.api-version-retiring.label.company'), p.company],
              [w.say('mail.api-version-retiring.label.version'), p.version],
              [w.say('mail.api-version-retiring.label.stopsOn'), w.when(p.retiresAt)],
            ],
          },
          { kind: 'button', label: w.say('mail.api-version-retiring.button', { app: w.app(p.app) }), href: appUrl(p.app) },
        ],
        reason: w.say('mail.api-version-retiring.reason'),
      };
    },
  },
  'api-rule-change': {
    title: 'A rule of the API your system uses changes',
    sentWhen: 'A new rule inside a version of the API is announced (90 days ahead, 30 for a safety rule), and again a month — or for a safety rule a week — before it starts refusing. To every company holding a live key: a business’s owners, a fleet’s contact email.',
    wired: true,
    // Late it is still ahead of the day: the notice has room for it.
    sendLater: 48,
    sample: { company: 'Pwani Hauliers Ltd', rule: 'example-rule', summary: 'A load is refused without the number of its packages.', version: '1', enforcedFrom: '2027-02-01T00:00:00Z', stage: 'announced', app: 'fleet' },
    phrased: true,
    build: (p, w) => {
      const soon = p.stage === 'soon';
      const from = w.when(p.enforcedFrom);
      return {
        subject: soon ? w.say('mail.api-rule-change.subject.soon', { company: p.company, when: from }) : w.say('mail.api-rule-change.subject.announced', { company: p.company, when: from }),
        preheader: w.say('mail.api-rule-change.preheader', { summary: p.summary, when: from }),
        blocks: [
          { kind: 'heading', text: soon ? w.say('mail.api-rule-change.heading.soon') : w.say('mail.api-rule-change.heading.announced') },
          { kind: 'paragraph', text: w.say('mail.api-rule-change.lede', { version: p.version, when: from, summary: p.summary }) },
          { kind: 'paragraph', text: w.say('mail.api-rule-change.header', { rule: p.rule, day: p.enforcedFrom.slice(0, 10) }) },
          { kind: 'paragraph', text: soon ? w.say('mail.api-rule-change.next.soon') : w.say('mail.api-rule-change.next.announced') },
          {
            kind: 'facts',
            rows: [
              [w.say('mail.api-rule-change.label.company'), p.company],
              [w.say('mail.api-rule-change.label.version'), p.version],
              [w.say('mail.api-rule-change.label.refusesFrom'), from],
            ],
          },
          { kind: 'button', label: w.say('mail.api-rule-change.button', { app: w.app(p.app) }), href: appUrl(p.app) },
        ],
        reason: w.say('mail.api-rule-change.reason'),
      };
    },
  },
  'store-developer-link': {
    title: 'A store’s developer: the link to sign in (developer)',
    sentWhen: 'A store invites its developer, or the developer asks for a new link from the Store app’s sign-in (2026-11-15).',
    wired: true,
    // The link works a day (a week for the invitation); later than that it would not open.
    sendLater: 24,
    sample: { store: 'Duka Bora', name: 'Brian', link: 'https://seebuyget.com/vendor/?dev=example', until: '2026-11-22T18:00:00Z', invited: true },
    phrased: true,
    build: (p, w) => ({
      subject: p.invited ? w.say('mail.store-developer-link.subject.invited', { store: p.store }) : w.say('mail.store-developer-link.subject.direct', { store: p.store }),
      preheader: w.say('mail.store-developer-link.preheader', { store: p.store, date: w.date(p.until) }),
      blocks: [
        { kind: 'heading', text: p.invited ? w.say('mail.store-developer-link.heading.invited', { store: p.store }) : w.say('mail.store-developer-link.heading.direct', { store: p.store }) },
        { kind: 'paragraph', text: w.say('mail.store-developer-link.lede', { name: p.name, store: p.store }) },
        { kind: 'button', label: w.say('mail.store-developer-link.button'), href: p.link },
        { kind: 'facts', rows: [[w.say('mail.store-developer-link.label.worksUntil'), w.date(p.until)], [w.say('mail.store-developer-link.label.works'), w.say('mail.store-developer-link.once')]] },
        { kind: 'warning', title: w.say('mail.store-developer-link.warningTitle'), text: w.say('mail.store-developer-link.warningText') },
      ],
      reason: w.say('mail.store-developer-link.reason', { store: p.store }),
    }),
  },
  'store-live-key': {
    title: 'A store’s developer made a live secret key (store owner)',
    sentWhen: 'A store’s developer, signed in by their own link, makes a live secret key on “Connect your shop system” — only that: a test key, a publishable key, the update address and the owner’s own changes are in the History and, some, the bell (2026-11-16).',
    wired: true,
    // A security notice is still worth reading the next day.
    sendLater: 24,
    sample: { store: 'Duka Bora', developer: 'Brian Studio', key: 'secret key …x9z8 “Checkout”', at: '2026-11-16T09:30:00Z', link: 'https://seebuyget.com/vendor/?go=connect' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.store-live-key.subject', { developer: p.developer, store: p.store }),
      preheader: w.say('mail.store-live-key.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.store-live-key.heading') },
        { kind: 'paragraph', text: w.say('mail.store-live-key.lede', { developer: p.developer, store: p.store }) },
        { kind: 'facts', rows: [[w.say('mail.store-live-key.label.key'), w.text(p.key)], [w.say('mail.store-live-key.label.madeBy'), p.developer], [w.say('mail.store-live-key.label.when'), w.when(p.at)]] },
        { kind: 'paragraph', text: w.say('mail.store-live-key.next') },
        { kind: 'button', label: w.say('mail.store-live-key.button'), href: p.link },
      ],
      reason: w.say('mail.store-live-key.reason', { store: p.store }),
    }),
  },
};
