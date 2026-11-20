import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { PartnerOwedList, type MyPartnerOwed } from './partnerOwed';
import { PartnerOwedBody, type PartnerLedgerView } from '../apps/tower/screens/PartnerOwedFold';
import { PartnerList } from '../apps/tower/screens/RatesScreen';
import { AMOUNT_LABEL, AMOUNT_ORDER } from '../apps/tower/money';

/*
 * 2026-11-20 — WHAT THE PARTNER OWES, SEEN (the payments plan, 3a; the owner: the hands see it "Yes, named"; "console for
 * staff"). What is held to here: a shop, a hub, a courier and a fleet's office each see what the partner owes them, the partner
 * named, its total first, every step said in words; nothing where nothing is owed; and our staff see a partner's whole record
 * on its own page — in all, per hand, every step.
 */
const tt = t as never;
const line = (over: Partial<MyPartnerOwed['lines'][number]> = {}) => ({ lineId: 'po_1', partnerName: 'Addis Courier PLC', payeeId: 'did:glos:shop-addis', payeeKind: 'shop' as const, amount: 40, currency: 'ETB', reference: 'PUD-1', step: 'labour' as const, at: '2026-11-20T10:00:00Z', ...over });

describe('what the partner owes you', () => {
  it('the partner named, its total first, every step in words', () => {
    const html = renderToString(<PartnerOwedList owed={{ lines: [line(), line({ lineId: 'po_2', step: 'haul', reference: 'did:glos:courier', amount: 300 })], totals: [{ partnerName: 'Addis Courier PLC', currency: 'ETB', amount: 340 }] }} t={tt} />);
    expect(html).toContain('What the partner owes you');
    expect(html).toContain('Addis Courier PLC owes you ');
    expect(html).toContain(' in all');
    expect(html).toContain('Work on a parcel · PUD-1');
    expect(html).toContain('On the road');
    expect(html.indexOf('owes you')).toBeLessThan(html.indexOf('Work on a parcel'));
  });

  it('4c — what the partner has paid already, and what it still owes; a step paid says so; and that it pays once a day', () => {
    const some = renderToString(<PartnerOwedList owed={{ lines: [line({ paid: true }), line({ lineId: 'po_2', reference: 'PUD-2' })], totals: [{ partnerName: 'Addis Courier PLC', currency: 'ETB', amount: 80, paid: 40 }] }} t={tt} />);
    expect(some).toMatch(/Addis Courier PLC has paid you [^<]*40[^<]*, and owes you [^<]*40[^<]* more/);
    expect(some.match(/ · paid/g)).toHaveLength(1);
    expect(some).toContain('It pays once a day, to the payout number you set in Settings.');
    const all = renderToString(<PartnerOwedList owed={{ lines: [line({ paid: true })], totals: [{ partnerName: 'Addis Courier PLC', currency: 'ETB', amount: 40, paid: 40 }] }} t={tt} />);
    expect(all).toMatch(/Addis Courier PLC has paid you all it owes: [^<]*40/);
  });

  it('nothing where nothing is owed', () => {
    expect(renderToString(<PartnerOwedList owed={{ lines: [] }} t={tt} />)).toBe('');
    expect(renderToString(<PartnerOwedList owed={null} t={tt} />)).toBe('');
  });

  it('a step undone says it was taken back, beside the step it undoes', () => {
    const html = renderToString(<PartnerOwedList owed={{ lines: [line({ lineId: 'po_2', amount: -40, takenBack: true }), line()], totals: [{ partnerName: 'Addis Courier PLC', currency: 'ETB', amount: 0 }] }} t={tt} />);
    expect(html).toContain('Work on a parcel · PUD-1 · taken back');
    expect(html.match(/taken back/g)).toHaveLength(1);
  });
});

describe('a partner’s record, for our staff', () => {
  const view = (over: Partial<PartnerLedgerView> = {}): PartnerLedgerView => ({ partnerEntityId: 'partner-et-addis-courier', partnerName: 'Addis Courier PLC', currency: 'ETB', owed: 340, byPayee: [{ payeeId: 'did:glos:courier', payeeKind: 'driver', amount: 300, steps: 1 }, { payeeId: 'did:glos:shop-addis', payeeKind: 'shop', amount: 40, steps: 2 }], lines: [line(), line({ lineId: 'po_2', step: 'sort', payeeKind: 'hub', payeeId: 'mdp_addis' })], ...over });

  it('what it owes in all, what it owes each hand, and every step', () => {
    const html = renderToString(<PartnerOwedBody view={view()} t={tt} />);
    expect(html).toContain(' owed in all');
    expect(html).toContain('Per hand');
    expect(html).toContain('Courier');
    expect(html).toContain('1 step');
    expect(html).toContain('2 steps');
    expect(html).toContain('Sorted at the hub');
  });

  it('nothing owed yet, said as that', () => {
    expect(renderToString(<PartnerOwedBody view={view({ owed: 0, byPayee: [], lines: [] })} t={tt} />)).toContain('Nothing owed yet.');
  });

  it('a step undone carries its own tag: taken back', () => {
    const html = renderToString(<PartnerOwedBody view={view({ owed: 0, byPayee: [], lines: [line({ lineId: 'po_9', amount: -40, takenBack: true }), line()] })} t={tt} />);
    expect(html.match(/>taken back</g)).toHaveLength(1);
  });
});

describe('a partner’s own list, on the Rates screen', () => {
  const pricing = (kind: 'partner' | 'sister') =>
    ({ entityId: 'partner-ug-kampala', name: 'Kampala Courier Ltd', kind, jurisdiction: 'UG', currency: 'UGX', transacting: kind === 'sister', amounts: AMOUNT_ORDER.map((key) => ({ key, amount: 100, own: false, startsAt: 100 })), recentChanges: [], lanes: [], editable: true }) as never;
  const screen = (kind: 'partner' | 'sister') => renderToString(<PartnerList pricing={pricing(kind)} state={{} as never} actions={{} as never} />);

  it('says what a partner is, and shows what a parcel costs and what each step pays — nothing of ours', () => {
    const html = screen('partner');
    expect(html).toContain('Kampala Courier Ltd is a partner company.');
    expect(html).toContain('SeeBuyGet only keeps the record of what it owes them');
    expect(html).toContain(t(AMOUNT_LABEL.labourFee) as string);
    expect(html).not.toContain(t(AMOUNT_LABEL.freightPerKm) as string);
    expect(html).not.toContain(t(AMOUNT_LABEL.directPayFee) as string);
  });

  it('the screen picks it for a partner company, and never the holding company’s words', () => {
    const rates = readFileSync(join('src', 'apps', 'tower', 'screens', 'RatesScreen.tsx'), 'utf8');
    expect(rates).toMatch(/\) : pricing\.kind === 'partner' \? \(\s*<PartnerList pricing=\{pricing\} state=\{state\} actions=\{actions\} \/>\s*\) : \(/);
    expect(rates.indexOf("pricing.kind === 'partner'")).toBeLessThan(rates.indexOf('!pricing.transacting ?'));
  });
});

describe('wired', () => {
  const read = (...p: string[]) => readFileSync(join('src', ...p), 'utf8');

  it('a shop, a hub, a courier and a fleet’s office each see it where they read their earnings', () => {
    expect(read('apps', 'agent', 'screens', 'RecordsScreen.tsx')).toMatch(/<PartnerOwedCard fetchOwed=\{actions\.partnerOwed\} \/>/);
    expect(read('apps', 'driver', 'screens', 'EarningsScreen.tsx')).toMatch(/<PartnerOwedCard fetchOwed=\{actions\.partnerOwed\} \/>/);
    expect(read('apps', 'fleet', 'screens', 'EarningsScreen.tsx')).toMatch(/<PartnerOwedCard fetchOwed=\{actions\.partnerOwed\} \/>/);
    expect(read('apps', 'mdp', 'screens', 'HomeScreen.tsx')).toMatch(/<PartnerOwedCard fetchOwed=\{\(\) => sbg\.request\(\(raw\) => raw\.GET\(PARTNER_OWED_PATH/);
    for (const p of ['agent', 'driver', 'fleet']) expect(read('lib', 'sbg', 'personas', `${p}.ts`)).toMatch(/partnerOwed: \(\) => sbg\.request\(\(c\) => c\.GET\('\/v1\/sbg\/partner-owed\/mine'\)\)/);
  });

  it('our staff see a partner’s record on its own page', () => {
    expect(read('apps', 'tower', 'screens', 'CompanyRecordScreen.tsx')).toMatch(/\{view\.entity\.kind === 'partner' && client && entityId \? <PartnerOwedFold entityId=\{entityId\} load=\{\(id\) => client\.api\.partnerOwed\(id\)\} \/> : null\}/);
    expect(read('lib', 'sbg', 'personas', 'operator.ts')).toMatch(/partnerOwed: \(entityId: string\) => sbg\.request\(\(c\) => c\.GET\('\/v1\/sbg\/entities\/\{entityId\}\/partner-owed'/);
  });

  it('said the right way round: the partner owes the hand, never the hand the partner', () => {
    const said = (locale: string, key: string) => read('shared', 'i18n', 'words', locale, 'base.ts').match(new RegExp(`"${key.replace(/\./g, '\\.')}": "([^"]*)"`))?.[1] ?? '';
    // Kiswahili: the partner's debt TO you ("deni la … kwako") — "anakudai" would be the partner claiming from you.
    expect(said('sw', 'partner.owed.title')).toBe('Deni la mshirika kwako');
    expect(said('sw', 'partner.owed.total')).toMatch(/^Deni la \{partner\} kwako ni \{amount\}/);
    expect(said('sw', 'partner.owed.title') + said('sw', 'partner.owed.total')).not.toMatch(/anakudai/);
    // Amharic: the debt the partner has toward you ("ለእርስዎ ያለበት") — "ያለብዎት" would be a debt you owe.
    expect(said('am', 'partner.owed.title')).toBe('አጋሩ ለእርስዎ ያለበት ዕዳ');
    expect(said('am', 'partner.owed.total')).toMatch(/ለእርስዎ .*ዕዳ አለበት$/);
    expect(said('nl', 'partner.owed.title')).toBe('Wat de partner je schuldig is');
  });

  it('every word in Kiswahili, Dutch and Amharic too', () => {
    const want: Array<[string, string, RegExp]> = [
      ['base.ts', 'en.ts', /'(partner\.owed\.[a-zA-Z_.]+)'/g],
      ['tower.ts', 'en.tower.ts', /'(tower\.partner\.[a-zA-Z_.]+)'/g],
    ];
    for (const [words, catalog, re] of want) {
      const keys = [...read('shared', 'i18n', 'catalogs', catalog).matchAll(re)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(5);
      for (const locale of ['sw', 'nl', 'am']) {
        const said = read('shared', 'i18n', 'words', locale, words);
        expect(keys.filter((k) => !said.includes(`"${k}":`))).toEqual([]);
      }
    }
  });
});
