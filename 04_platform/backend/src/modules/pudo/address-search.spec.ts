import { AddressSearchService, GazetteerGeocoder } from './geocoder';

/*
 * AN ADDRESS, ANYWHERE THE NETWORK RUNS (the user, 2026-10-25: "A map is the better option and a toggle for an address
 * which would work for pretty many countries as well"). What is held to here: with no service set, the offline
 * gazetteer answers what it knows; with one set, the service is asked as Nominatim asks to be asked, its answers kept;
 * when it fails, the gazetteer answers; and what nobody finds is NOT FOUND — never a stand-in point drawn as a pin.
 */
describe('finding an address', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  /** A service that answers `hits`, and remembers what it was asked. */
  function serviceAnswering(hits: unknown, ok = true) {
    const svc = new AddressSearchService(new GazetteerGeocoder());
    const asked: Array<{ url: string; headers: Record<string, string> }> = [];
    svc.fetcher = async (url, init) => {
      asked.push({ url, headers: init.headers });
      return { ok, status: ok ? 200 : 503, json: async () => hits };
    };
    return { svc, asked };
  }

  it('with no service set, answers the places the gazetteer knows — and nothing for a name it does not', async () => {
    delete process.env.GLOS_GEOCODER_URL;
    const svc = new AddressSearchService(new GazetteerGeocoder());
    expect(await svc.search('Westlands')).toMatchObject({ confidence: 'exact', matched: 'Westlands' });
    // The gazetteer's stand-in for an unknown name (a point near the middle) is not a place anybody said.
    expect(new GazetteerGeocoder().geocode('12 Nowhere Lane, Atlantis').confidence).toBe('fallback'); // the guard reads one
    expect(await svc.search('12 Nowhere Lane, Atlantis')).toBeNull();
  });

  it('asks a Nominatim-compatible service as it asks to be asked, in the countries named, and says a house from a street', async () => {
    process.env.GLOS_GEOCODER_URL = 'https://geo.example.org/';
    process.env.SBG_PUBLIC_URL = 'https://seebuyget.com';
    process.env.GLOS_GEOCODER_KEY = 'k-123';
    const house = serviceAnswering([{ lat: '-1.2836', lon: '36.8233', display_name: '12, Moi Avenue, Nairobi, Kenya', address: { house_number: '12' } }]);
    expect(await house.svc.search('12 Moi Avenue, Nairobi', ['KE', 'ug', 'nonsense'])).toEqual({
      location: { lat: -1.2836, lng: 36.8233 },
      confidence: 'exact',
      matched: '12, Moi Avenue, Nairobi, Kenya',
    });
    const url = new URL(house.asked[0].url);
    expect(url.origin + url.pathname).toBe('https://geo.example.org/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '12 Moi Avenue, Nairobi', format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'ke,ug', key: 'k-123' });
    // Named, as OpenStreetMap's own service asks of every app.
    expect(house.asked[0].headers['User-Agent']).toBe('SeeBuyGet (https://seebuyget.com)');

    const street = serviceAnswering([{ lat: '0.3476', lon: '32.5825', display_name: 'Kampala Road, Kampala, Uganda', address: {} }]);
    expect(await street.svc.search('Kampala Road', ['UG'])).toMatchObject({ confidence: 'approx', matched: 'Kampala Road, Kampala, Uganda' });
  });

  it('keeps an answer, so the same address is not asked for twice in a day', async () => {
    process.env.GLOS_GEOCODER_URL = 'https://geo.example.org';
    const { svc, asked } = serviceAnswering([{ lat: '1', lon: '2', display_name: 'A street', address: {} }]);
    const now = Date.now();
    await svc.search('A street', [], now);
    await svc.search('a street ', [], now + 3_600_000);
    expect(asked).toHaveLength(1);
    await svc.search('A street', [], now + 25 * 3_600_000); // a day on, asked again
    expect(asked).toHaveLength(2);
  });

  it('when the service finds nothing, the gazetteer may; when it fails, the gazetteer answers — and nothing found is nothing', async () => {
    process.env.GLOS_GEOCODER_URL = 'https://geo.example.org';
    expect(await serviceAnswering([]).svc.search('Westlands')).toMatchObject({ matched: 'Westlands' });
    expect(await serviceAnswering([]).svc.search('12 Nowhere Lane, Atlantis')).toBeNull();
    expect(await serviceAnswering({ error: 'busy' }, false).svc.search('Westlands')).toMatchObject({ matched: 'Westlands' });
    const unreachable = new AddressSearchService(new GazetteerGeocoder());
    unreachable.fetcher = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    expect(await unreachable.search('Westlands')).toMatchObject({ matched: 'Westlands' });
    expect(await unreachable.search('12 Nowhere Lane, Atlantis')).toBeNull();
  });
});
