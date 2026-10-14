import { describe, expect, it } from 'vitest';
import { t } from '../i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  FEW_OPENINGS,
  holderWords,
  readReportKey,
  reportFileName,
  reportLinkRowSays,
  reportLinkSays,
  reportSections,
  termsWords,
  type DamageReportView,
  type ReportLinkRow,
  type ReportLinkView,
} from './damageReport';

const KEY = 'k'.repeat(43);

const REPORT: DamageReportView = {
  parcelId: 'QR-1',
  madeAt: '2026-10-12T09:30:00.000Z',
  sha256: 'a'.repeat(64),
  body: {
    number: 'DCR-QR-1',
    statement: 'SeeBuyGet facilitates the logistics chain.',
    parcel: { parcelId: 'QR-1', shipmentId: 'did:glos:ship1', through: 'counter', madeAt: '2026-10-11T08:00:00.000Z', from: 'Mama Sarah Shop, Nairobi CBD', to: 'Riverside Corner, Westlands', size: 'M', fragile: true, currency: 'KES' },
    terms: { promise: 'ours', company: 'SeeBuyGet Kenya Ltd', coverLimit: 0, currency: 'KES' },
    problem: { origin: 'counter', reportedAt: '2026-10-12T09:30:00.000Z', reason: 'The lid is cracked', parcelWas: 'on the shelf of the collection shop, not yet handed over', heldBy: { kind: 'shop', name: 'Riverside Corner' }, shop: 'Riverside Corner' },
    custody: [
      { holder: { kind: 'shop', name: 'Mama Sarah Shop' }, from: '2026-10-11T08:00:00.000Z', to: '2026-10-11T10:00:00.000Z' },
      { holder: { kind: 'driver', name: 'Kilima Logistics' }, from: '2026-10-11T10:00:00.000Z', to: '2026-10-11T12:00:00.000Z' },
      { holder: { kind: 'shop', name: 'Riverside Corner' }, from: '2026-10-11T12:00:00.000Z' },
    ],
    events: [
      { at: '2026-10-11T08:00:00.000Z', status: 'At_PUDO', note: 'accepted', fingerprint: 'tx1' },
      { at: '2026-10-12T09:30:00.000Z', status: 'Disputed', note: 'dispute · The lid is cracked', fingerprint: 'tx2' },
    ],
    photographs: [
      { what: 'drop_off', reference: 'drop.jpg' },
      { what: 'problem', reference: 'med_1', mediaId: 'med_1', takenAt: '2026-10-12T09:29:00.000Z', sha256: 'b'.repeat(64) },
    ],
  },
};

describe('the key of a link to a damage claim report', () => {
  it('is read out of the part of an address no server is sent', () => {
    expect(readReportKey(`#report=${KEY}`)).toBe(KEY);
    expect(readReportKey(`#x=1&report=${KEY}`)).toBe(KEY);
    // Cut short by a mail program: still about a report, so somebody lands on a page that says so.
    expect(readReportKey('#report=abc')).toBe('abc');
    expect(readReportKey('#report=')).toBe('');
  });

  it('is not found in an address that is about something else', () => {
    expect(readReportKey(`#doc=${KEY}`)).toBeUndefined();
    expect(readReportKey('')).toBeUndefined();
    expect(readReportKey(undefined)).toBeUndefined();
    expect(readReportKey('#unreport=x')).toBeUndefined();
  });
});

describe('the terms a parcel travelled under, in a sentence', () => {
  it('says a company that has stated no cover pays nothing itself, and where a claim goes instead', () => {
    expect(termsWords(REPORT.body.terms, t)).toBe('SeeBuyGet Kenya Ltd has stated no cover: it pays nothing from its own books. A claim is for your own insurer, the store’s, or whoever answers by law.');
    expect(termsWords({ promise: 'ours', coverLimit: 0, currency: 'KES' }, t)).toMatch(/^The company that carried it has stated no cover/);
  });

  it('says what a company that has stated cover pays up to, and whose promise it is where it is not ours', () => {
    expect(termsWords({ promise: 'ours', company: 'SeeBuyGet Kenya Ltd', coverLimit: 300, currency: 'KES' }, t)).toBe('SeeBuyGet Kenya Ltd states that it pays up to 300.00 KES from its own books on a parcel like this one.');
    expect(termsWords({ promise: 'theirs', coverLimit: 0, currency: 'KES' }, t)).toBe('Carried under the carrier’s own promise. No company of the network answers for these goods.');
    expect(termsWords({ promise: 'none', coverLimit: 0, currency: 'KES' }, t)).toBe('No company of the network answers for these goods.');
  });
});

describe('the report on a screen', () => {
  const sections = reportSections(REPORT, t);
  const section = (title: string) => sections.find((s) => s.title === title)!;

  it('is read in the order somebody with a claim reads it', () => {
    expect(sections.map((s) => s.title)).toEqual(['The problem that was reported', 'The parcel, as it was made', 'The terms it travelled under', 'Who held it, and when', 'Every recorded step', 'Photographs', 'The fingerprint of this report']);
  });

  it('says who reported it, in their words, and in whose hands the parcel was', () => {
    const rows = Object.fromEntries(section('The problem that was reported').rows.map((r) => [r.label, r.value]));
    expect(rows['Reported by']).toBe('Riverside Corner, at its counter');
    expect(rows['In their words']).toBe('The lid is cracked');
    expect(rows['The parcel was']).toBe('on the shelf of the collection shop, not yet handed over');
    expect(rows['In whose hands']).toBe('Shop: Riverside Corner');
    expect(holderWords({ kind: 'driver', name: 'Kilima Logistics' }, t)).toBe('Carrier: Kilima Logistics');
  });

  it('says a parcel already handed over was in nobody’s hands that the network answers for, and that the receiver reported it', () => {
    const delivered: DamageReportView = { ...REPORT, body: { ...REPORT.body, problem: { origin: 'buyer', reportedAt: REPORT.madeAt, reason: 'Cracked', parcelWas: 'handed over to the receiver' } } };
    const rows = Object.fromEntries(reportSections(delivered, t)[0].rows.map((r) => [r.label, r.value]));
    expect(rows['Reported by']).toBe('The receiver, from their own app');
    expect(rows['In whose hands']).toBe('Nobody’s within the network: it had been handed over');
  });

  it('lists every hand, and marks the one it was still in', () => {
    const rows = section('Who held it, and when').rows;
    expect(rows.map((r) => r.label)).toEqual(['Shop: Mama Sarah Shop', 'Carrier: Kilima Logistics', 'Shop: Riverside Corner']);
    expect(rows[0].value).toMatch(/ until /);
    expect(rows[2].value).toMatch(/and still when the problem was reported$/);
  });

  it('leaves out what was never stated, and says fragile with the size', () => {
    const labels = section('The parcel, as it was made').rows.map((r) => r.label);
    expect(labels).toEqual(['Parcel', 'How it came in', 'Made', 'From', 'To', 'Size']);
    expect(section('The parcel, as it was made').rows.find((r) => r.label === 'Size')!.value).toBe('M, marked fragile');
    expect(section('The parcel, as it was made').rows.find((r) => r.label === 'How it came in')!.value).toBe('Handed in at a shop’s counter');
    const store: DamageReportView = { ...REPORT, body: { ...REPORT.body, parcel: { ...REPORT.body.parcel, through: 'store', store: 'Nairobi Threads', orderNumber: 'ORD-9', contents: ['2 × Kettle', 'Lid'], declaredValue: 4200, fragile: false } } };
    const rows = Object.fromEntries(reportSections(store, t)[1].rows.map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ 'How it came in': 'A store’s order', Store: 'Nairobi Threads', 'The store’s order number': 'ORD-9', 'Contents, as stated': '2 × Kettle; Lid', 'Value stated': '4200.00 KES', Size: 'M' });
  });

  it('tells a photograph that is in the file from one that was only ever a reference, and says when there is none', () => {
    expect(section('Photographs').rows).toEqual([
      { label: 'At the counter, when it was handed in', value: 'Recorded by reference only: drop.jpg' },
      { label: 'The problem, as it was reported', value: 'In the file' },
    ]);
    const bare: DamageReportView = { ...REPORT, body: { ...REPORT.body, photographs: [] } };
    expect(reportSections(bare, t)[5].rows).toEqual([{ value: 'No photograph belongs to this parcel.' }]);
  });

  it('ends with the fingerprint, whole, and what it is for', () => {
    expect(section('The fingerprint of this report').rows[0]).toEqual({ value: 'a'.repeat(64) });
    expect(section('The fingerprint of this report').rows[1].value).toMatch(/Two copies with the same fingerprint say the same thing/);
    expect(section('The terms it travelled under').rows).toEqual([{ value: termsWords(REPORT.body.terms, t) }]);
    // The record calls the last step "Disputed"; nobody disputes anything here, so it is said as what happened.
    expect(section('Every recorded step').rows[1].value).toBe('Problem reported — dispute · The lid is cracked');
    expect(section('Every recorded step').rows[0].value).toBe('At PUDO — accepted');
  });

  it('says of the receiver’s hands when the parcel was handed over, not a stretch of time', () => {
    const delivered: DamageReportView = { ...REPORT, body: { ...REPORT.body, custody: [...REPORT.body.custody.slice(0, 2), { holder: { kind: 'shop', name: 'Riverside Corner' }, from: '2026-10-11T12:00:00.000Z', to: '2026-10-12T09:00:00.000Z' }, { holder: { kind: 'receiver', name: 'The receiver' }, from: '2026-10-12T09:00:00.000Z', to: '2026-10-12T09:00:00.000Z' }] } };
    const rows = reportSections(delivered, t)[3].rows;
    expect(rows[3].label).toBe('Receiver: The receiver');
    expect(rows[3].value).toMatch(/^Handed over to them on /);
    expect(rows[3].value).not.toMatch(/until/);
  });
});

describe('what the page says to whoever was handed a link', () => {
  const ready: ReportLinkView = { state: 'ready', expiresAt: '2026-11-11T10:00:00.000Z', number: 'DCR-QR-1', parcelId: 'QR-1', from: 'Mama Sarah Shop, Nairobi CBD', to: 'Riverside Corner, Westlands', reportedAt: '2026-10-12T09:30:00.000Z', sha256: 'a'.repeat(64), opensLeft: 25 };

  it('a link that opens says what it opens and that the file is the copy to keep', () => {
    const says = reportLinkSays({ view: ready }, t);
    expect(says).toMatchObject({ tone: 'info', title: 'A damage claim report', canTake: true, canRetry: false });
    expect(says.lines[0]).toMatch(/^Report DCR-QR-1, on a parcel from Mama Sarah Shop, Nairobi CBD to Riverside Corner, Westlands\. The problem was reported on /);
    expect(says.lines[1]).toBe('It holds who held the parcel and when, the photographs, and the terms it travelled under.');
    expect(says.lines[2]).toMatch(/^This link works until .*\. The file is the copy to keep\.$/);
    expect(says.lines).toHaveLength(3);
  });

  it('says so when few openings are left, and not before', () => {
    expect(reportLinkSays({ view: { ...ready, opensLeft: FEW_OPENINGS } }, t).lines[3]).toBe(`It can be opened ${FEW_OPENINGS} more times.`);
    expect(reportLinkSays({ view: { ...ready, opensLeft: FEW_OPENINGS + 1 } }, t).lines).toHaveLength(3);
  });

  it('a link that has stopped says which way, and to ask whoever gave it — never us', () => {
    const stopped = (state: ReportLinkView['state']) => reportLinkSays({ view: { state, expiresAt: '2026-11-11T10:00:00.000Z' } }, t);
    expect(stopped('expired')).toMatchObject({ title: 'This link has stopped working', canTake: false });
    expect(stopped('cancelled')).toMatchObject({ title: 'This link was stopped', canTake: false });
    expect(stopped('used_up')).toMatchObject({ title: 'This link has been opened as often as one link can be', canTake: false });
    for (const state of ['expired', 'cancelled', 'used_up'] as const) expect(stopped(state).lines.slice(-1)).toEqual(['Ask whoever gave you the link for a new one.']);
  });

  it('tells a link that is not ours from a server that is busy or cannot be reached, and offers to try again only where that helps', () => {
    expect(reportLinkSays({ failed: 'not_ours' }, t)).toMatchObject({ tone: 'danger', title: 'This is not a link we made', canTake: false, canRetry: false });
    expect(reportLinkSays({ failed: 'busy' }, t)).toMatchObject({ title: 'Too many tries from here just now', canRetry: true });
    expect(reportLinkSays({ failed: 'unreachable' }, t)).toMatchObject({ icon: 'offline', title: 'We could not be reached', canRetry: true, canTake: false });
  });
});

describe('a link on the report, as whoever made it reads it', () => {
  const row: ReportLinkRow = { linkId: 'drl_1', state: 'ready', createdAt: '2026-10-12T10:00:00.000Z', expiresAt: '2026-11-11T10:00:00.000Z', opened: 0 };

  it('one that works says until when, and whether anybody has used it', () => {
    expect(reportLinkRowSays(row, t)).toMatchObject({ working: true, detail: 'Not opened yet' });
    expect(reportLinkRowSays(row, t).title).toMatch(/^Works until /);
    expect(reportLinkRowSays({ ...row, opened: 3, lastOpenedAt: '2026-10-13T08:00:00.000Z' }, t).detail).toMatch(/^The file was taken 3 times, last on /);
  });

  it('one that has stopped says how, and cannot be stopped again', () => {
    expect(reportLinkRowSays({ ...row, state: 'cancelled', cancelledAt: '2026-10-12T11:00:00.000Z' }, t)).toMatchObject({ working: false });
    expect(reportLinkRowSays({ ...row, state: 'cancelled', cancelledAt: '2026-10-12T11:00:00.000Z' }, t).title).toMatch(/^Stopped on /);
    expect(reportLinkRowSays({ ...row, state: 'expired' }, t).title).toMatch(/^Its time was up on /);
    expect(reportLinkRowSays({ ...row, state: 'used_up', opened: 25 }, t)).toMatchObject({ title: 'Opened as often as one link can be', working: false });
  });
});

describe('the file’s name on somebody’s phone', () => {
  it('is the report’s own number, made safe for a file system', () => {
    expect(reportFileName('DCR-QR-1')).toBe('damage-claim-report-DCR-QR-1.zip');
    expect(reportFileName('DCR QR/1')).toBe('damage-claim-report-DCR-QR-1.zip');
    expect(reportFileName(undefined)).toBe('damage-claim-report.zip');
  });
});
