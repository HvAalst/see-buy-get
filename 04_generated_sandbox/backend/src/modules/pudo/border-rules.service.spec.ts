import { BorderRuleService } from './border-rules.service';

/**
 * CA6 — the rules of crossing a border. One idea above all: the absence of a rule is not permission.
 */
describe('the rules of crossing a border', () => {
  let borders: BorderRuleService;

  beforeEach(() => {
    borders = new BorderRuleService();
  });

  it('never lets a foreign vehicle carry inside another country unless a rule says it may', () => {
    expect(borders.cabotageAllowed('KE', 'KE')).toBe(true);
    expect(borders.cabotageAllowed('KE', 'TZ')).toBe(false); // nothing recorded
    expect(borders.refusalsFor({ pickupCountry: 'TZ', destCountry: 'TZ', weightKg: 500 }, 'KE')).toEqual([
      { code: 'CABOTAGE_NOT_PERMITTED', message: 'A vehicle registered in Kenya may not carry a load inside Tanzania — no rule allows it' },
    ]);
    borders.set({ from: 'KE', to: 'TZ', cabotage: 'forbidden' }, 'Amina');
    expect(borders.refusalsFor({ pickupCountry: 'TZ', destCountry: 'TZ', weightKg: 500 }, 'KE')[0].message).toMatch(/cabotage is not permitted/);
    borders.set({ from: 'KE', to: 'TZ', cabotage: 'allowed' }, 'Amina');
    expect(borders.refusalsFor({ pickupCountry: 'TZ', destCountry: 'TZ', weightKg: 500 }, 'KE')).toEqual([]);
    // Direction matters: Kenya letting Tanzanian trucks in is a different rule.
    expect(borders.cabotageAllowed('TZ', 'KE')).toBe(false);
  });

  it('refuses nothing on a guess — a load with no known countries is not judged', () => {
    expect(borders.refusalsFor({ weightKg: 40_000 }, 'KE')).toEqual([]);
    expect(borders.refusalsFor({ pickupCountry: 'TZ', destCountry: 'TZ', weightKg: 1 })).toEqual([]);
  });

  it('holds a crossing to its weight limit, and tells a driver what to carry', () => {
    borders.set(
      { from: 'KE', to: 'TZ', crossings: [{ name: 'Namanga', hours: '06:00–22:00' }], permits: ['EAC transit permit'], regionalInsurance: ['COMESA Yellow Card', 'COMESA Yellow Card'], maxWeightKg: 30_000 },
      'Amina',
    );
    expect(borders.refusalsFor({ pickupCountry: 'KE', destCountry: 'TZ', weightKg: 32_000 })[0]).toMatchObject({ code: 'OVER_BORDER_WEIGHT_LIMIT' });
    expect(borders.adviceFor('KE', 'TZ')).toMatchObject({ recorded: true, crossings: [{ name: 'Namanga', hours: '06:00–22:00' }], permits: ['EAC transit permit'], regionalInsurance: ['COMESA Yellow Card'], maxWeightKg: 30_000 });
    expect(borders.adviceFor('TZ', 'KE')).toMatchObject({ recorded: false, crossings: [] });
  });

  it('refuses a rule that is not between two real countries, or that nobody names', () => {
    expect(() => borders.set({ from: 'KE', to: 'KE' }, 'Amina')).toThrow(/two different countries/);
    expect(() => borders.set({ from: 'KE', to: 'ZZ' }, 'Amina')).toThrow(/not a country/);
    expect(() => borders.set({ from: 'KE', to: 'TZ' })).toThrow(/Say who/);
    expect(() => borders.set({ from: 'KE', to: 'TZ', crossings: [{ hours: '24h' }] }, 'Amina')).toThrow(/needs its name/);
    expect(() => borders.set({ from: 'KE', to: 'TZ', maxWeightKg: -1 }, 'Amina')).toThrow(/above zero/);
  });
});
