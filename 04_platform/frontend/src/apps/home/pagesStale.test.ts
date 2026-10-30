import { describe, expect, it } from 'vitest';
import { builtData, countriesKey, entriesKey, townsKey } from '../../../scripts/pages-stale.mjs';

/*
 * THE NIGHTLY CHECK OF THE PUBLIC PAGES (2026-10-30): what changes what a page says is a difference; what moves every
 * hour (a shop open or shut, the counts of what we have seen) is not — or the site would be rebuilt every night.
 */
describe('are the public pages out of date', () => {
  it('reads what a built page was built from, and nothing from a page that was not built', () => {
    expect(builtData('<div></div><script type="application/json" id="prerender-data">{"towns":[],"directory":{"index":{"countries":[]}}}</script>')).toEqual({ towns: [], directory: { index: { countries: [] } } });
    expect(builtData('<html><body>the front page, served for an address nobody built</body></html>')).toBeNull();
  });

  it('counts a shop opening as nothing, and a new shop as a difference', () => {
    const shop = { shopName: 'Mama Njeri', landmark: 'By the matatu stage', handle: 'mama-njeri', openState: 'open' };
    const town = (shops: object[]) => [{ slug: 'thika', town: 'Thika', country: 'KE', shops }];
    expect(townsKey(town([shop]))).toBe(townsKey(town([{ ...shop, openState: 'closed' }])));
    expect(townsKey(town([shop]))).not.toBe(townsKey(town([shop, { ...shop, shopName: 'Kamau Stores', handle: 'kamau' }])));
  });

  it('counts a delivery as nothing, and a firm’s own line or contact as a difference', () => {
    const firm = { handle: 'baobab', name: 'Baobab Haulage', kinds: ['haulier'], seen: {}, words: 'Flatbeds', checks: [] };
    expect(entriesKey([firm])).toBe(entriesKey([{ ...firm, seen: { delivered: 4 } }]));
    expect(entriesKey([firm])).not.toBe(entriesKey([{ ...firm, words: 'Flatbeds and box trucks' }]));
    expect(entriesKey([firm])).not.toBe(entriesKey([{ ...firm, contact: { phone: '+254 700 000 000' } }]));
    expect(entriesKey([firm])).not.toBe(entriesKey([]));
  });

  it('counts a country’s counts and its marker', () => {
    const ke = { country: 'KE', total: 2, forwarder: 1, clearing_agent: 1, depot: 0, haulier: 0, at: { lat: -1.3, lng: 36.8 } };
    expect(countriesKey([ke])).toBe(countriesKey([{ ...ke, name: 'Kenya' }]));
    expect(countriesKey([ke])).not.toBe(countriesKey([{ ...ke, total: 3, haulier: 1 }]));
    expect(countriesKey([ke])).not.toBe(countriesKey([{ ...ke, at: undefined }]));
  });
});
