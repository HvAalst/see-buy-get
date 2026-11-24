import { dayIn, expiresAtOf, fiscalCardOf, fiscalCodesDue, fiscalCodesFor, fiscalComplianceOf, fiscalCountriesOf, fiscalIndemnityFor, fiscalKey, fiscalNoteLines, fiscalPickupRefusal, fiscalStatusOf, lastDayOf } from './fiscal-codes';

/*
 * 2026-11-23 — THE CODES ROMANIA AND BULGARIA FOLLOW GOODS BY (the owner: "dedicated fields for both Romanian UIT and Bulgarian UTN
 * codes"): asked where a load is taken over or delivered there, a code or the sender's word with its reason, its last day kept.
 */
const NOW = Date.parse('2026-11-23T10:00:00Z');
const said = { now: NOW, by: 'Anna' };
const toRO = { pickupCountry: 'NL', destCountry: 'RO', weightKg: 800 };
const toBG = { pickupCountry: 'NL', destCountry: 'BG', weightKg: 120 };

describe('the codes Romania and Bulgaria follow goods by', () => {
  it('asked where a load is taken over or delivered in either, never where it only passes', () => {
    expect(fiscalCountriesOf('NL', 'BG')).toEqual(['BG']);
    expect(fiscalCountriesOf('RO', 'BG')).toEqual(['RO', 'BG']);
    expect(fiscalCountriesOf('bg', 'NL')).toEqual(['BG']);
    expect(fiscalCountriesOf('NL', 'DE')).toEqual([]);
    expect(fiscalCodesFor(undefined, { pickupCountry: 'NL', destCountry: 'DE', weightKg: 900 }, said)).toEqual([]);
  });

  it('refuses a load without them, naming each country missing', () => {
    expect(() => fiscalCodesFor(undefined, { ...toRO, destCountry: 'BG', pickupCountry: 'RO' }, said)).toThrow(/Romania or Bulgaria carries Romania the UIT code \(RO e-Transport\) and Bulgaria the UTN code/);
    try {
      fiscalCodesFor({ ro: { exempt: 'thresholds' } }, { pickupCountry: 'RO', destCountry: 'BG', weightKg: 100 }, said);
      throw new Error('not refused');
    } catch (e) {
      expect((e as { params?: Record<string, unknown> }).params).toMatchObject({ field: 'fiscalCodes', countries: 'BG' });
    }
  });

  it('a company’s system before the rule refuses: what it gave is kept, what it did not is not asked', () => {
    expect(fiscalCodesFor(undefined, toRO, said, false)).toEqual([]);
  });

  it('a UIT code with the day the transport starts: 15 days for goods a Romanian buyer acquires from another EU country, 5 otherwise', () => {
    expect(fiscalCodesFor({ ro: { code: '9a1b 2c3d-4e5f', from: '2026-11-24' } }, toRO, said)).toEqual([
      { country: 'RO', kind: 'UIT', code: '9A1B2C3D4E5F', from: '2026-11-24', validThrough: '2026-12-08', saidAt: '2026-11-23T10:00:00.000Z', saidBy: 'Anna' },
    ]);
    expect(fiscalCodesFor({ ro: { code: '9A1B2C3D4E5F', from: '2026-11-24' } }, { pickupCountry: 'RO', destCountry: 'NL', weightKg: 800 }, said)[0].validThrough).toBe('2026-11-28');
    expect(lastDayOf('2026-11-24', 5)).toBe('2026-11-28');
  });

  it('a UTN with the day it was issued: 14 days, in Cyrillic letters too', () => {
    expect(fiscalCodesFor({ bg: { code: 'УНП123456', from: '2026-11-20' } }, toBG, said)[0]).toMatchObject({ kind: 'UTN', code: 'УНП123456', validThrough: '2026-12-03' });
  });

  it('the sender’s word that none is needed, with its reason and when it was said', () => {
    expect(fiscalCodesFor({ bg: { exempt: 'not-listed' } }, toBG, said)).toEqual([{ country: 'BG', kind: 'UTN', exempt: 'not-listed', saidAt: '2026-11-23T10:00:00.000Z', saidBy: 'Anna' }]);
    expect(fiscalCodesFor({ ro: { exempt: 'excise' } }, toRO, said)[0].exempt).toBe('excise');
  });

  it('refuses “below Romania’s thresholds” for a load over 500 kg', () => {
    expect(() => fiscalCodesFor({ ro: { exempt: 'thresholds' } }, toRO, said)).toThrow(/This load weighs 800 kg: over 500 kg, Romania asks a UIT code for it/);
    expect(fiscalCodesFor({ ro: { exempt: 'thresholds' } }, { ...toRO, weightKg: 500 }, said)[0].exempt).toBe('thresholds');
  });

  it('refuses a code and a “none needed” together, a reason of the other country, a code that is not letters and digits, one with no day, and one run out', () => {
    expect(() => fiscalCodesFor({ ro: { code: '9A1B2C3D', from: '2026-11-24', exempt: 'excise' } }, toRO, said)).toThrow(/not both/);
    expect(() => fiscalCodesFor({ bg: { exempt: 'thresholds' } }, toBG, said)).toThrow(/one of not-listed/);
    expect(() => fiscalCodesFor({ ro: { code: '12#45!78', from: '2026-11-24' } }, toRO, said)).toThrow(/6 to 40 letters and digits/);
    expect(() => fiscalCodesFor({ ro: { code: '9A1B2C3D' } }, toRO, said)).toThrow(/declared to start in RO e-Transport/);
    expect(() => fiscalCodesFor({ bg: { code: 'BG12345678', from: '2026-11-31' } }, toBG, said)).toThrow(/the UTN was issued/);
    expect(() => fiscalCodesFor({ ro: { code: '9A1B2C3D', from: '2026-11-01' } }, { ...toRO, pickupCountry: 'RO', destCountry: 'NL' }, said)).toThrow(/ran out on 2026-11-05/);
  });

  it('a code run out stops the taking over; its last day, in the country’s own time, still lets it', () => {
    const codes = fiscalCodesFor({ ro: { code: '9A1B2C3D', from: '2026-11-23' } }, { pickupCountry: 'RO', destCountry: 'NL', weightKg: 800 }, said);
    expect(fiscalPickupRefusal(codes, Date.parse('2026-11-27T21:30:00Z'))).toBeUndefined(); // 23:30 in Bucharest, 27 November
    expect(fiscalPickupRefusal(codes, Date.parse('2026-11-27T22:30:00Z'))).toMatch(/The UIT code 9A1B2C3D for Romania \(RO e-Transport\) ran out on 2026-11-27: the sender gives a new one/);
    expect(dayIn('Europe/Bucharest', Date.parse('2026-11-27T22:30:00Z'))).toBe('2026-11-28');
    expect(fiscalPickupRefusal(fiscalCodesFor({ bg: { exempt: 'not-listed' } }, toBG, said), Date.parse('2027-06-01T00:00:00Z'))).toBeUndefined();
  });

  it('box 13 says each, and the driver’s card says when one runs out', () => {
    const codes = [
      ...fiscalCodesFor({ ro: { code: '9A1B2C3D', from: '2026-11-23' } }, { pickupCountry: 'RO', destCountry: 'BG', weightKg: 100 }, said, false),
      ...fiscalCodesFor({ bg: { exempt: 'not-listed' } }, toBG, said),
    ];
    expect(fiscalNoteLines(codes, (iso) => iso.slice(0, 10))).toEqual([
      'Romania, RO e-Transport: UIT 9A1B2C3D, valid through 2026-11-27',
      'Bulgaria, goods with high fiscal risk: no UTN code; the sender says none of the goods is on the Minister of Finance’s list of goods with high fiscal risk (2026-11-23)',
    ]);
    // The card: when it stops, and its state now (2026-11-24).
    expect(fiscalCardOf(codes, NOW)[0]).toEqual({ country: 'RO', kind: 'UIT', code: '9A1B2C3D', validThrough: '2026-11-27', expiresAt: '2026-11-27T21:59:59.999Z', status: 'valid' });
    expect(fiscalCardOf(codes, Date.parse('2026-11-27T00:00:00Z'))[0].status).toBe('expiring_soon');
    expect(fiscalCardOf(codes, Date.parse('2026-11-28T10:00:00Z'))[0].status).toBe('expired');
    expect(fiscalCardOf(codes, NOW)[1]).toEqual({ country: 'BG', kind: 'UTN', exempt: 'not-listed' });
  });

  // 2026-11-24 — the owner's brief: a value threshold, a certification, the status, and the moment a code stops.
  it('refuses “below the thresholds” for a load worth over RON 10,000, whatever it weighs', () => {
    expect(() => fiscalCodesFor({ ro: { exempt: 'thresholds' } }, { ...toRO, weightKg: 100, valueRon: 12_000 }, said)).toThrow(/worth about RON 12,000: over RON 10,000, Romania asks a UIT code/);
    expect(fiscalCodesFor({ ro: { exempt: 'thresholds' } }, { ...toRO, weightKg: 100, valueRon: 10_000 }, said)[0].exempt).toBe('thresholds');
    expect(fiscalCodesFor({ ro: { exempt: 'thresholds' } }, { ...toRO, weightKg: 100 }, said)[0].exempt).toBe('thresholds');
  });

  it('asks the sender’s certification wherever a code or a reason is given, and keeps when and who', () => {
    const codes = fiscalCodesFor({ bg: { exempt: 'not-listed' } }, toBG, said);
    expect(() => fiscalIndemnityFor({ bg: { exempt: 'not-listed' } }, codes, said)).toThrow(/Certify that the codes, or your reasons for none, are accurate/);
    try {
      fiscalIndemnityFor({}, codes, said);
    } catch (e) {
      expect((e as { params?: Record<string, unknown> }).params).toMatchObject({ field: 'fiscalCodes.indemnity' });
    }
    expect(fiscalIndemnityFor({ indemnity: true }, codes, said)).toEqual({ at: '2026-11-23T10:00:00.000Z', by: 'Anna' });
    expect(fiscalIndemnityFor({}, codes, said, false)).toBeUndefined();
    expect(fiscalIndemnityFor({}, [], said)).toBeUndefined();
    expect(fiscalNoteLines(codes, (iso) => iso.slice(0, 10), { at: '2026-11-23T10:00:00.000Z', by: 'Anna' }).pop()).toBe('The sender certifies that these codes, or its reasons for none, are accurate, and answers for them (CMR articles 7 and 11): Anna, 2026-11-23');
  });

  it('says whether a load went with codes only, or with a reason for none', () => {
    const ro = fiscalCodesFor({ ro: { code: '9A1B2C3D', from: '2026-11-23' } }, toRO, said);
    const bg = fiscalCodesFor({ bg: { exempt: 'not-listed' } }, toBG, said);
    expect(fiscalComplianceOf(ro)).toBe('declared_with_codes');
    expect(fiscalComplianceOf([...ro, ...bg])).toBe('exempt_declared_by_sender');
    expect(fiscalComplianceOf([])).toBeUndefined();
  });

  it('a code stops at the end of its last day in its country’s time, across a change of clocks too', () => {
    expect(expiresAtOf({ country: 'RO', validThrough: '2026-11-27' })).toBe('2026-11-27T21:59:59.999Z'); // winter: UTC+2
    expect(expiresAtOf({ country: 'BG', validThrough: '2026-07-01' })).toBe('2026-07-01T20:59:59.999Z'); // summer: UTC+3
    expect(expiresAtOf({ country: 'RO', validThrough: '2027-03-28' })).toBe('2027-03-28T20:59:59.999Z'); // the night clocks go forward
    expect(expiresAtOf({ country: 'RO' })).toBeUndefined();
    expect(fiscalStatusOf({ country: 'RO', validThrough: '2026-11-27' }, Date.parse('2026-11-26T22:00:00Z'))).toBe('expiring_soon');
    expect(fiscalStatusOf({ country: 'RO', validThrough: '2026-11-27' }, Date.parse('2026-11-26T21:59:00Z'))).toBe('valid');
  });

  it('the codes due to be told: within a day of their end or past it, each once', () => {
    const codes = fiscalCodesFor({ ro: { code: '9A1B2C3D', from: '2026-11-23' } }, { pickupCountry: 'RO', destCountry: 'NL', weightKg: 800 }, said);
    expect(fiscalCodesDue(codes, [], NOW)).toEqual([]);
    expect(fiscalCodesDue(codes, [], Date.parse('2026-11-27T00:00:00Z')).map(fiscalKey)).toEqual(['RO:9A1B2C3D']);
    expect(fiscalCodesDue(codes, ['RO:9A1B2C3D'], Date.parse('2026-11-27T00:00:00Z'))).toEqual([]);
    expect(fiscalCodesDue(fiscalCodesFor({ bg: { exempt: 'not-listed' } }, toBG, said), [], Date.parse('2027-01-01T00:00:00Z'))).toEqual([]);
  });
});
