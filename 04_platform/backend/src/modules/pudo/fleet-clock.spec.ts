import { clockAt, clocksOfCountry, isTimeZone, minutesOf, offsetAt, utcDay, zoneName, zonesOfCountry } from './fleet-clock';

/**
 * A FLEET'S OWN CLOCK. What is pinned: a country's zones come from the platform and not from us, a country with
 * several is not guessed at, a moment is read on a zone's own clock (and its own DAY, which is where UTC was wrong),
 * daylight saving is the zone's business, and only a place's zone is a zone a fleet can keep.
 */
describe('a fleet’s own clock', () => {
  const at = (iso: string) => Date.parse(iso);

  it('knows the zone of a country that keeps one, and does not choose for a country that keeps several', () => {
    expect(zonesOfCountry('KE')).toEqual(['Africa/Nairobi']);
    expect(zonesOfCountry('ke ')).toEqual(['Africa/Nairobi']);
    expect(zonesOfCountry('ET')).toEqual(['Africa/Addis_Ababa']);
    expect(zonesOfCountry('NL')).toEqual(['Europe/Amsterdam']);
    const congo = zonesOfCountry('CD');
    expect(congo).toEqual(expect.arrayContaining(['Africa/Kinshasa', 'Africa/Lubumbashi']));
    expect(congo.length).toBeGreaterThan(1);
    expect(zonesOfCountry('US').length).toBeGreaterThan(5);
  });

  it('counts clocks, not names: two zones that keep the same time all year are one clock', () => {
    const now = at('2026-10-06T12:00:00Z');
    // Germany: Berlin, and the exclave of Büsingen — one clock, and nothing for a fleet to choose.
    expect(zonesOfCountry('DE').length).toBeGreaterThan(1);
    expect(clocksOfCountry('DE', now)).toEqual(['Europe/Berlin']);
    expect(clocksOfCountry('KE', now)).toEqual(['Africa/Nairobi']);
    // The Congo really keeps two: an hour apart, all year.
    expect(clocksOfCountry('CD', now)).toEqual(['Africa/Kinshasa', 'Africa/Lubumbashi']);
    // A country of many zones is a handful of clocks, each under its first name.
    const us = clocksOfCountry('US', now);
    expect(us.length).toBeGreaterThan(4);
    expect(us.length).toBeLessThan(zonesOfCountry('US').length);
    expect(new Set(us).size).toBe(us.length);
    // The same hour in winter and a different one in summer is not the same clock as the same hour all year.
    expect(us).toEqual(expect.arrayContaining(['America/Phoenix']));
    expect(clocksOfCountry('XX', now)).toEqual([]);
  });

  it('reads how far a clock stands from UTC, across midnight both ways', () => {
    expect(offsetAt(at('2026-10-06T21:30:00Z'), 'Africa/Nairobi')).toBe(180);
    expect(offsetAt(at('2026-10-06T02:30:00Z'), 'America/Los_Angeles')).toBe(-420);
    expect(offsetAt(at('2026-12-06T02:30:00Z'), 'America/Los_Angeles')).toBe(-480);
    expect(offsetAt(at('2026-10-06T12:00:00Z'), 'UTC')).toBe(0);
    expect(offsetAt(at('2026-10-06T20:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('has no zone for what is not a country', () => {
    for (const not of [undefined, '', 'K', 'KEN', '12', 'XX', 'k-e']) expect(zonesOfCountry(not as string)).toEqual([]);
  });

  it('reads a moment on the zone’s own clock — and its own day, which is not always the day in UTC', () => {
    // Half past nine in the evening in UTC is already tomorrow in Nairobi, and still this afternoon in Los Angeles.
    const now = at('2026-10-06T21:30:00Z');
    expect(utcDay(now)).toBe('2026-10-06');
    expect(clockAt(now, 'Africa/Nairobi')).toEqual({ day: '2026-10-07', minutes: 30, clock: '00:30' });
    expect(clockAt(now, 'Europe/Amsterdam')).toEqual({ day: '2026-10-06', minutes: 23 * 60 + 30, clock: '23:30' });
    expect(clockAt(now, 'America/Los_Angeles')).toEqual({ day: '2026-10-06', minutes: 14 * 60 + 30, clock: '14:30' });
    expect(clockAt(now, 'UTC')).toEqual({ day: '2026-10-06', minutes: 21 * 60 + 30, clock: '21:30' });
    // Midnight is 00:00 of the new day, never 24:00 of the old one.
    expect(clockAt(at('2026-10-06T21:00:00Z'), 'Africa/Nairobi')).toEqual({ day: '2026-10-07', minutes: 0, clock: '00:00' });
    expect(clockAt(at('2026-10-06T20:59:00Z'), 'Africa/Nairobi')).toEqual({ day: '2026-10-06', minutes: 23 * 60 + 59, clock: '23:59' });
  });

  it('leaves daylight saving to the zone: the same UTC hour is a different hour in summer and in winter', () => {
    expect(clockAt(at('2026-07-01T08:00:00Z'), 'Europe/Amsterdam').clock).toBe('10:00');
    expect(clockAt(at('2026-12-01T08:00:00Z'), 'Europe/Amsterdam').clock).toBe('09:00');
    // And a place with none keeps the same hour all year.
    expect(clockAt(at('2026-07-01T08:00:00Z'), 'Africa/Nairobi').clock).toBe('11:00');
    expect(clockAt(at('2026-12-01T08:00:00Z'), 'Africa/Nairobi').clock).toBe('11:00');
  });

  it('takes a place’s own zone, or UTC — not a bare offset, not a made-up name, not a name with space around it', () => {
    for (const ok of ['Africa/Nairobi', 'Europe/Amsterdam', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'UTC']) expect(isTimeZone(ok)).toBe(true);
    for (const bad of ['+03:00', 'GMT+3', 'EAT', 'Nairobi', 'Africa/Atlantis', '', ' Africa/Nairobi', 'Africa/Nairobi ', 'x'.repeat(80), 3, null, undefined, {}]) expect(isTimeZone(bad)).toBe(false);
  });

  it('reads a clock time as minutes, strictly', () => {
    expect([minutesOf('00:00'), minutesOf('07:05'), minutesOf('9:30'), minutesOf('23:59')]).toEqual([0, 425, 570, 1439]);
    for (const bad of [undefined, '', '24:00', '7', '07:60', 'noon', '07:5']) expect(minutesOf(bad as string)).toBeUndefined();
  });

  it('names a zone as somebody would, and falls back to the zone itself', () => {
    expect(zoneName('Africa/Nairobi', at('2026-10-06T12:00:00Z'))).toBe('East Africa Time');
    expect(zoneName('Europe/Amsterdam', at('2026-07-01T12:00:00Z'))).toBe('Central European Summer Time');
    expect(zoneName('Europe/Amsterdam', at('2026-12-01T12:00:00Z'))).toBe('Central European Standard Time');
    expect(zoneName('Not/AZone', at('2026-10-06T12:00:00Z'))).toBe('Not/AZone');
  });
});
