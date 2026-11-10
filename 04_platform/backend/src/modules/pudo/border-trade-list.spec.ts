import { BORDER_TRADE_DIRECTIVE, COMMON_LIST, commonListItemFor } from './border-trade-list';

/** 2026-11-10 — the Common List of Goods of Directive 1144/2026, as printed (border-trade-list.ts). */
describe('the Common List of Goods, Kenya–Ethiopia (Directive 1144/2026)', () => {
  it('holds the annex as printed: fifty goods, numbered 1 to 50, every code digits only', () => {
    expect(COMMON_LIST.map((i) => i.no)).toEqual(Array.from({ length: 50 }, (_, n) => n + 1));
    for (const item of COMMON_LIST) {
      expect(item.name.trim()).toBe(item.name);
      expect(item.hs.length).toBeGreaterThan(0);
      for (const code of item.hs) expect(code).toMatch(/^\d{2,8}$/);
    }
  });

  it('keeps the Directive’s limits and caps', () => {
    expect(BORDER_TRADE_DIRECTIVE).toMatchObject({ number: '1144/2026', monthlyLimitUsd: 1000, tripsPerMonth: 4, borderAreaKm: { ET: 50, KE: 100 } });
    const caps = COMMON_LIST.filter((i) => i.cap).map((i) => [i.name, i.cap]);
    expect(caps).toEqual([
      ['Camel', { count: 2, unit: 'camels' }],
      ['Ox', { count: 2, unit: 'oxen' }],
      ['Goat', { count: 5, unit: 'goats' }],
      ['Sheep', { count: 5, unit: 'sheep' }],
      ['Maize (corn)', { kg: 100, unit: 'quintal' }],
    ]);
  });

  it('finds a declared code under the longest printed code it starts with — and nothing it does not', () => {
    expect(commonListItemFor('0104.20.00')?.name).toBe('Goat');
    expect(commonListItemFor('0703.10.10')?.name).toBe('Edible Vegetables'); // onions
    expect(commonListItemFor('3401.11')?.name).toBe('Soap'); // the longer 340100 (Detergent) does not take a 3401.11
    expect(commonListItemFor('340100')?.name).toBe('Detergent');
    expect(commonListItemFor('0708.20')).toBeUndefined(); // beans: not on the list
    expect(commonListItemFor('0406.10')).toBeUndefined(); // cheese at its own heading: the list printed 0405.90 (L47)
    expect(commonListItemFor('4107')?.name).toBe('Hide and skin'); // a chapter as printed
  });

  it('says beside a printed code where it does not fit its goods, and never corrects it', () => {
    const noted = COMMON_LIST.filter((i) => i.noted).map((i) => i.no);
    expect(noted).toEqual(expect.arrayContaining([5, 10, 23, 35, 41, 42, 43, 47]));
    expect(COMMON_LIST.find((i) => i.no === 41)).toMatchObject({ hs: ['6203', '6205', '6207'], noted: expect.stringMatching(/MEN’s/) });
  });
});
