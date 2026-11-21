import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { PartnerOwedList } from './partnerOwed';
import { PartnerChecksBody, flagWhy, reviewWords, type PartnerChecksView, type PartnerFlagRow } from '../apps/tower/screens/PartnerChecksFold';

/*
 * 2026-11-20 — CHECKS ON THE PARTNER'S FIGURES, SEEN (the payments plan, 3b; the owner: "We also need AI anti fraud scrutiny on
 * the figures"). What is held to here: every finding says why in the reader's words and the figures — a step owed twice, a
 * parcel never held or not on record, a shop's own parcels, an amount off the list, an unusual day — and the AI review's own
 * words as it gave them; where the AI review stands is always said (not set up, not yet, run, or not finished and why); a
 * finding is closed by "Looked at", with what was found; and the hand's own card says which work each line was.
 */
const tt = t as never;
const flag = (over: Partial<PartnerFlagRow> = {}): PartnerFlagRow => ({ flagId: 'pf_1', rule: 'twice', payeeId: 'did:glos:shop-bole', payeeKind: 'shop', lineIds: ['po_1', 'po_2'], facts: { work: 'take_in', reference: 'PUD-1', times: 2 }, severity: 'urgent', foundAt: '2026-11-20T11:00:00Z', ...over });

describe('why a finding was raised', () => {
  it('4e — the money checks in words, with their figures', () => {
    expect(flagWhy(flag({ rule: 'money_no_parcel', payeeId: 'did:glos:shop-bole', facts: { reference: 'PUD-9', amount: 250, currency: 'ETB', day: '2026-11-21' } }), tt)).toMatch(/250\.00 was paid in for PUD-9 on 2026-11-21, and no parcel was taken in for it\.$/);
    expect(flagWhy(flag({ rule: 'payout_new_number', facts: { amount: 40, currency: 'ETB', day: '2026-11-21', changedOn: '2026-11-19' } }), tt)).toMatch(/^Paid .*40\.00 on 2026-11-21 to a payout number changed on 2026-11-19\.$/);
    expect(flagWhy(flag({ rule: 'paid_beyond_owed', facts: { amount: 65, owed: 40, currency: 'ETB' } }), tt)).toMatch(/^Paid .*65\.00 in all, where the steps owed come to .*40\.00\.$/);
    const html = renderToString(<PartnerChecksBody view={{ open: [flag({ rule: 'paid_beyond_owed', facts: { amount: 65, owed: 40, currency: 'ETB' } })], looked: [], aiReady: false }} t={tt} />);
    expect(html).toContain('Paid more than owed');
  });

  it('each rule in words, with its figures', () => {
    expect(flagWhy(flag(), tt)).toBe('Taken in for PUD-1, owed 2 times.');
    expect(flagWhy(flag({ rule: 'never_held', facts: { reference: 'PUD-1' } }), tt)).toBe('Paid for PUD-1, which this hand never held.');
    expect(flagWhy(flag({ rule: 'never_held', facts: { reference: 'PUD-9', missing: true } }), tt)).toBe('Paid for PUD-9, which is not on record.');
    expect(flagWhy(flag({ rule: 'own_parcels', facts: { day: '2026-11-20', count: 2, parcels: ['PUD-1', 'PUD-2'] } }), tt)).toBe('2 parcels on 2026-11-20 sent or received on the shop’s own number, or sent to the number it came from: PUD-1, PUD-2.');
    expect(flagWhy(flag({ rule: 'off_list', facts: { work: 'sort', reference: 'PUD-1', amount: 81, listed: 40, currency: 'ETB' } }), tt)).toMatch(/^Paid .*81.* for Sorted at the hub on PUD-1, where the partner’s list says .*40/);
    expect(flagWhy(flag({ rule: 'volume', facts: { day: '2026-11-20', count: 15, usual: 5 } }), tt)).toBe('15 steps on 2026-11-20, against about 5 a day before.');
    expect(flagWhy(flag({ rule: 'volume', facts: { day: '2026-11-20', count: 30 } }), tt)).toBe('30 steps on 2026-11-20, with none in the fortnight before.');
    expect(flagWhy(flag({ rule: 'ai', facts: { day: '2026-11-20' }, reason: 'did:glos:shop-bole took in PUD-1 and PUD-2 at 02:00.' }), tt)).toBe('did:glos:shop-bole took in PUD-1 and PUD-2 at 02:00.');
  });

  it('where the AI review stands, always said', () => {
    expect(reviewWords({ aiReady: false }, tt)).toBe('The AI review is not set up: the server has no key for it.');
    expect(reviewWords({ aiReady: true }, tt)).toBe('No AI review yet: it runs once a day.');
    expect(reviewWords({ aiReady: true, review: { day: '2026-11-20', at: '2026-11-20T11:00:00Z', state: 'done', flags: 0 } }, tt)).toBe('AI review, 2026-11-20 11:00: nothing stood out.');
    expect(reviewWords({ aiReady: true, review: { day: '2026-11-20', at: '2026-11-20T11:00:00Z', state: 'done', flags: 2 } }, tt)).toBe('AI review, 2026-11-20 11:00: 2 findings.');
    expect(reviewWords({ aiReady: true, review: { day: '2026-11-20', at: '2026-11-20T11:00:00Z', state: 'failed', flags: 0, why: 'unreachable' } }, tt)).toBe('The AI review on 2026-11-20 11:00 did not finish: the model could not be reached.');
  });
});

describe('the fold, for our staff', () => {
  const view = (over: Partial<PartnerChecksView> = {}): PartnerChecksView => ({ open: [flag()], looked: [flag({ flagId: 'pf_2', rule: 'off_list', severity: 'look', facts: { work: 'take_in', reference: 'PUD-3', amount: 90, listed: 40, currency: 'ETB' }, looked: { by: 'Amina Otieno', at: '2026-11-20T12:00:00Z', note: 'The shop’s own fee.' } })], aiReady: true, ...over });

  it('each finding to look at: the rule, the hand, urgent where it is, why — and "Looked at" with a note', () => {
    const html = renderToString(<PartnerChecksBody view={view()} t={tt} onLooked={() => undefined} onReview={() => undefined} />);
    expect(html).toContain('Owed twice');
    expect(html).toContain('Urgent');
    expect(html).toContain('Taken in for PUD-1, owed 2 times.');
    expect(html).toContain('did:glos:shop-bole · 2026-11-20 11:00');
    expect(html).toContain('What you found (optional)');
    expect(html).toContain('>Looked at<');
    expect(html).toContain('Review now');
    // Looked at: by name, with what was found.
    expect(html).toContain('Looked at by Amina Otieno, 2026-11-20 12:00 · The shop’s own fee.');
  });

  it('nothing to look at said as that; no "Review now" where the AI review is not set up', () => {
    const html = renderToString(<PartnerChecksBody view={view({ open: [], looked: [], aiReady: false })} t={tt} onLooked={() => undefined} onReview={() => undefined} />);
    expect(html).toContain('Nothing to look at.');
    expect(html).toContain('The AI review is not set up');
    expect(html).not.toContain('Review now');
  });
});

describe('the hand’s own card', () => {
  it('says which work each line was', () => {
    const line = { lineId: 'po_1', partnerName: 'Addis Courier PLC', payeeId: 'did:glos:courier', payeeKind: 'driver' as const, amount: 300, currency: 'ETB', reference: 'BAG-7', step: 'haul' as const, work: 'road' as const, at: '2026-11-20T10:00:00Z' };
    const html = renderToString(<PartnerOwedList owed={{ lines: [line, { ...line, lineId: 'po_2', work: 'bag_load', amount: 5 }] }} t={tt} />);
    expect(html).toContain('On the road · BAG-7');
    expect(html).toContain('A bag loaded · BAG-7');
  });
});

describe('wired', () => {
  const read = (...p: string[]) => readFileSync(join('src', ...p), 'utf8');

  it('on the partner’s own page, beside what it owes; read and closed through the staff client', () => {
    expect(read('apps', 'tower', 'screens', 'CompanyRecordScreen.tsx')).toMatch(/\{view\.entity\.kind === 'partner' && client && entityId \? <PartnerChecksFold entityId=\{entityId\} load=\{\(id\) => client\.api\.partnerChecks\(id\)\} looked=\{\(id, flagId, note\) => client\.api\.partnerCheckLooked\(id, flagId, note\)\} review=\{\(id\) => client\.api\.partnerReview\(id\)\} \/> : null\}/);
    const api = read('lib', 'sbg', 'personas', 'operator.ts');
    expect(api).toMatch(/partnerChecks: \(entityId: string\) => sbg\.request\(\(c\) => c\.GET\('\/v1\/sbg\/entities\/\{entityId\}\/partner-checks'/);
    expect(api).toMatch(/partnerCheckLooked: \(entityId: string, flagId: string, note\?: string\) =>\s*sbg\.request\(\(c\) => c\.POST\('\/v1\/sbg\/entities\/\{entityId\}\/partner-checks\/\{flagId\}\/looked'/);
    expect(api).toMatch(/partnerReview: \(entityId: string\) => sbg\.request\(\(c\) => c\.POST\('\/v1\/sbg\/entities\/\{entityId\}\/partner-checks\/review'/);
  });
});
