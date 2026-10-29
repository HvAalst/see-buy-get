import { airClaims, airlineOfPrefix, airLimits, airRegimeOf, awbProblem, checkAirWaybill, formatAwb, isAirParty, mc99LimitOn } from './air';

/**
 * CARRIAGE BY AIR AS DATA (research 2026-10-29). The convention of a route from the ICAO lists, by the waybill's places and
 * day; the limit in its own unit, on its dates; the waybill number's check digit; and what a held waybill is missing or
 * disagrees with — never that a flight will go.
 */
describe('carriage by air, as data', () => {
  it('reads the convention of a route from both ends, on the day — the newest instrument both share', () => {
    expect(airRegimeOf('KE', 'NL', '2026-10-29')).toBe('mc99');
    expect(airRegimeOf('KE', 'ET', '2026-10-29')).toBe('mc99');
    // Zambia signed MC99 and never ratified it: Warsaw as amended at The Hague, shared with Kenya.
    expect(airRegimeOf('KE', 'ZM', '2026-10-29')).toBe('warsaw_hague');
    expect(airRegimeOf('KE', 'IR', '2026-10-29')).toBe('warsaw_hague_map4');
    expect(airRegimeOf('UG', 'ZM', '2026-10-29')).toBe('warsaw_1929');
    // Burundi, South Sudan, Somalia, Djibouti, Eritrea: in no air convention.
    for (const c of ['BI', 'SS', 'SO', 'DJ', 'ER']) expect(airRegimeOf('KE', c, '2026-10-29')).toBe('none');
    expect(airRegimeOf('KE', 'KE', '2026-10-29')).toBe('domestic');
    // A round trip with a stop abroad is international, if the one state is a party.
    expect(airRegimeOf('KE', 'KE', '2026-10-29', ['UG'])).toBe('mc99');
    // A country we have not read is unknown — never guessed.
    expect(airRegimeOf('KE', 'XX', '2026-10-29')).toBe('unknown');
    expect(airRegimeOf(undefined, 'NL', '2026-10-29')).toBe('unknown');
  });

  it('reads it on the day the waybill was made out: Uganda joined MC99 on 27 January 2018', () => {
    expect(isAirParty('mc99', 'UG', '2018-01-26')).toBe(false);
    expect(isAirParty('mc99', 'UG', '2018-01-27')).toBe(true);
    expect(airRegimeOf('UG', 'NL', '2017-06-01')).toBe('warsaw_1929');
    expect(airRegimeOf('UG', 'NL', '2018-06-01')).toBe('mc99');
  });

  it('keeps MC99’s limit with its dates, and says each regime’s limit in its own unit', () => {
    expect(mc99LimitOn('2015-01-01')).toBe(19);
    expect(mc99LimitOn('2024-12-27')).toBe(22);
    expect(mc99LimitOn('2024-12-28')).toBe(26);
    expect(airLimits('mc99', '2026-10-29')[0]).toMatch(/^At most 26 SDR a kilogram/);
    expect(airLimits('warsaw_hague', '2026-10-29')[0]).toMatch(/250 gold francs/);
    expect(airLimits('none', '2026-10-29')[0]).toMatch(/airline’s own conditions/);
    expect(airClaims('mc99')[0]).toMatch(/14 days of receipt/);
    expect(airClaims('warsaw_1929')[0]).toMatch(/7 days of receipt; delay within 14 days/);
  });

  it('checks a waybill number’s digit: the first seven of the serial divided by 7, the remainder last', () => {
    // 1234567 = 7 × 176366 + 5
    expect(awbProblem('706-12345675')).toBeUndefined();
    expect(awbProblem('706 1234 5675')).toBeUndefined();
    expect(awbProblem('706-12345674')).toBe('check_digit');
    // 7, 8 and 9 can never be a remainder of 7.
    for (const d of ['7', '8', '9']) expect(awbProblem(`706-1234567${d}`)).toBe('check_digit');
    expect(awbProblem('706-1234567')).toBe('format');
    expect(awbProblem('ABC-12345675')).toBe('format');
    expect(formatAwb('70612345675')).toBe('706-12345675');
    expect(airlineOfPrefix('706')).toEqual({ name: 'Kenya Airways', code: 'KQ' });
    // 006 is Delta's, not Air France's: a prefix we do not hold is not guessed.
    expect(airlineOfPrefix('006')).toBeUndefined();
  });

  it('checks a held waybill: what the law asks and it lacks, where our papers disagree, and what follows', () => {
    const ok = checkAirWaybill({ number: '706-12345675', kind: 'master', from: 'KE', to: 'NL', pieces: 40, weightKg: 600 }, { pieces: 40, weightKg: 604 }, '2026-10-29');
    expect(ok).toMatchObject({ number: '706-12345675', regime: 'mc99', missing: [], mismatches: [], electronicPossible: true, airline: { name: 'Kenya Airways' } });
    expect(ok.problem).toBeUndefined();
    // Pieces exactly; weight beyond 1% (or 1 kg).
    const off = checkAirWaybill({ number: '706-12345675', kind: 'master', from: 'KE', to: 'NL', pieces: 38, weightKg: 600 }, { pieces: 40, weightKg: 640 }, '2026-10-29');
    expect(off.mismatches).toEqual(['Pieces: the waybill says 38, our papers 40.', 'Weight: the waybill says 600 kg, our papers 640 kg.']);
    // A wrong number is wrong; no weight on an MC99 lane is missing.
    expect(checkAirWaybill({ number: '706-12345679', kind: 'direct', from: 'KE', to: 'NL' }, {}, '2026-10-29')).toMatchObject({ problem: 'check_digit', missing: ['The weight of the consignment (MC99 Art. 5(c)).'] });
    // A Hague lane without the liability notice: the airline's consequence, said as one.
    const hague = checkAirWaybill({ number: '706-12345675', kind: 'master', from: 'KE', to: 'ZM', weightKg: 100 }, {}, '2026-10-29');
    expect(hague).toMatchObject({ regime: 'warsaw_hague', electronicPossible: false });
    expect(hague.missing[0]).toMatch(/^The notice that the Warsaw Convention may limit/);
    expect(checkAirWaybill({ number: '706-12345675', kind: 'master', from: 'KE', to: 'ZM', weightKg: 100, liabilityNotice: true }, {}, '2026-10-29').missing).toEqual([]);
    // A house waybill asks for its own number and says whose contract is whose; never that the flight will go.
    const house = checkAirWaybill({ number: '706-12345675', kind: 'house', from: 'KE', to: 'NL', weightKg: 10 }, {}, '2026-10-29');
    expect(house.ask).toContain('The forwarder’s house waybill number, and the master waybill it travels under.');
    expect(house.caveats.join(' ')).toMatch(/MC99 Art\. 42/);
    expect(house.caveats.join(' ')).toMatch(/airlines may fly without any part of the cargo/);
  });
});
