import { describe, expect, it } from 'vitest';
import { MAP_FIRST_COUNTRIES, MIN_DOWNLINK_MBPS, isMapFirstCountry, mapOrWords, type ConnectionInfo } from './mapOrWords';

/*
 * A PLACE SHOWN: A MAP FIRST WHERE THE CONNECTION CAN SPARE IT, ELSE ITS THREE WORDS (the owner, 2026-11-02: "I prefer
 * the map if the connection is good. That could be country specific: developed nations map by default, otherwise based
 * on connectivity"). The rule, across country × save-data × measured type × measured speed × signal × nothing measured.
 */
const fast: ConnectionInfo = { effectiveType: '4g', downlink: 10 };
const thin4g: ConnectionInfo = { effectiveType: '4g', downlink: 0.8 };
const slow: ConnectionInfo = { effectiveType: '3g', downlink: 0.6 };
const saving: ConnectionInfo = { effectiveType: '4g', downlink: 10, saveData: true };

const rule = (country: string | undefined, connection: ConnectionInfo | null, online = true) => mapOrWords({ country, online, connection });

describe('a map first, or the three words first', () => {
  it('nothing measured (an iPhone’s Safari): the country decides', () => {
    expect(rule('NL', null)).toBe('map');
    expect(rule('GB', null)).toBe('map');
    expect(rule('US', null)).toBe('map');
    expect(rule('AE', null)).toBe('map');
    expect(rule('KE', null)).toBe('words');
    expect(rule('UG', null)).toBe('words');
    expect(rule(undefined, null)).toBe('words');
  });

  it('a good connection now brings the map anywhere — Nairobi on 4G as much as Amsterdam', () => {
    expect(rule('KE', fast)).toBe('map');
    expect(rule('ET', fast)).toBe('map');
    expect(rule(undefined, fast)).toBe('map');
    // 4G with the speed unsaid: the browser's own measure is enough.
    expect(rule('KE', { effectiveType: '4g' })).toBe('map');
  });

  it('a slow or thin connection keeps the words first where data is dear', () => {
    expect(rule('KE', slow)).toBe('words');
    expect(rule('KE', { effectiveType: '2g' })).toBe('words');
    expect(rule('KE', { effectiveType: 'slow-2g', downlink: 0.05 })).toBe('words');
    // "4g" from about 0.7 Mbit/s: below the line, still the words.
    expect(rule('KE', thin4g)).toBe('words');
    expect(rule('KE', { effectiveType: '4g', downlink: MIN_DOWNLINK_MBPS })).toBe('map');
    expect(rule('KE', { effectiveType: '4g', downlink: MIN_DOWNLINK_MBPS - 0.1 })).toBe('words');
  });

  it('where data is cheap the map is the default, whatever is measured — "developed nations map by default"', () => {
    expect(rule('NL', slow)).toBe('map');
    expect(rule('DE', thin4g)).toBe('map');
    expect(rule('nl', null)).toBe('map'); // any case
  });

  it('a phone that asks to save data gets the words, in any country and on any connection', () => {
    expect(rule('NL', saving)).toBe('words');
    expect(rule('KE', saving)).toBe('words');
    expect(rule('NL', { saveData: true })).toBe('words');
  });

  it('no signal: always the words — a map cannot load', () => {
    expect(rule('NL', null, false)).toBe('words');
    expect(rule('NL', fast, false)).toBe('words');
    expect(rule('KE', fast, false)).toBe('words');
  });

  it('the named list: the EU and EEA, Switzerland, the UK, North America, Oceania, Japan, Korea, Singapore and the Gulf — and not East Africa', () => {
    for (const c of ['NL', 'BE', 'DE', 'FR', 'ES', 'IT', 'PL', 'SE', 'IS', 'NO', 'LI', 'CH', 'GB', 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM']) {
      expect(isMapFirstCountry(c), c).toBe(true);
    }
    for (const c of ['KE', 'UG', 'TZ', 'RW', 'ET', 'SO', 'SS', 'BI', 'CD', 'NG', 'ZA', 'IN']) expect(isMapFirstCountry(c), c).toBe(false);
    // 27 of the EU, 3 more of the EEA, CH, GB, 7 further, 6 Gulf states — and each named once.
    expect(MAP_FIRST_COUNTRIES).toHaveLength(45);
    expect(new Set(MAP_FIRST_COUNTRIES).size).toBe(MAP_FIRST_COUNTRIES.length);
    expect(isMapFirstCountry(undefined)).toBe(false);
    expect(isMapFirstCountry('')).toBe(false);
  });
});
