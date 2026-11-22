import { GazetteerGeocoder } from './geocoder';
import { countryNear, GAZETTEER, lookupPlace, nearestPlace, nearestPlaceAt, normalizePlace } from './geo-gazetteer';

/** 2026-11-11 — every place the network knows by name is in a country, and a lookup that knows the reader's keeps to it. */
describe('the places the network knows, by country', () => {
  it('puts every place in a country: Kenya, Ethiopia, Uganda, the Netherlands and Bulgaria', () => {
    expect(GAZETTEER.every((e) => /^[A-Z]{2}$/.test(e.country))).toBe(true);
    expect([...new Set(GAZETTEER.map((e) => e.country))].sort()).toEqual(['BG', 'ET', 'KE', 'NL', 'UG']);
    expect(GAZETTEER.find((e) => e.name === 'Nairobi')?.country).toBe('KE');
    expect(GAZETTEER.find((e) => e.name === 'Kampala')?.country).toBe('UG');
    expect(GAZETTEER.find((e) => e.name === 'Amsterdam')?.country).toBe('NL');
  });

  it('places a typed Ugandan or Dutch town — and keeps to the countries asked', () => {
    expect(lookupPlace('Plot 12, Jinja Road, Mbarara')?.entry).toMatchObject({ name: 'Mbarara', country: 'UG' });
    expect(lookupPlace('Kampala')?.entry.country).toBe('UG');
    expect(lookupPlace("Pettelaarpark 1, 's-Hertogenbosch")?.entry).toMatchObject({ name: "'s-Hertogenbosch", country: 'NL' });
    expect(lookupPlace('Den Bosch', ['NL'])?.entry.name).toBe("'s-Hertogenbosch");
    // Moyale stands on both sides of the Kenya–Ethiopia border: each country's own, by the reader's country (2026-11-12).
    expect(lookupPlace('Moyale', ['KE'])?.entry.country).toBe('KE');
    expect(lookupPlace('Moyale', ['ET'])?.entry.country).toBe('ET');
    expect(lookupPlace('Moyale', ['ET'])!.entry.location.lat).toBeGreaterThan(lookupPlace('Moyale', ['KE'])!.entry.location.lat);
    expect(lookupPlace('Marsabit', ['KE'])?.entry.country).toBe('KE');
    expect(lookupPlace('Yabelo', ['ET'])?.entry.country).toBe('ET');
    // A Kampala asked of Kenya alone is nothing — never a pin in another country.
    expect(lookupPlace('Kampala', ['KE'])).toBeNull();
  });

  // 2026-11-22 — Bulgaria (the Netherlands–Bulgaria plan, part 10): its towns, typed in Latin letters or in Cyrillic.
  it('places a Bulgarian town as it is written in Latin letters or in Cyrillic, and tells a Bulgarian pin from a Dutch one', () => {
    expect(lookupPlace('ul. Ivan Vazov 12, Plovdiv')?.entry).toMatchObject({ name: 'Plovdiv', country: 'BG' });
    expect(lookupPlace('бул. Витоша 1, София')?.entry).toMatchObject({ name: 'Sofia', country: 'BG' });
    expect(lookupPlace('Велико Търново', ['BG'])?.entry.name).toBe('Veliko Tarnovo');
    expect(lookupPlace('Sofia', ['NL'])).toBeNull();
    expect(normalizePlace('Стара  Загора!')).toBe('стара загора');
    expect(normalizePlace("'s-Hertogenbosch")).toBe('s hertogenbosch'); // Latin as before
    // A person posting a load: where its pin is decides its country (load-posting.service personMayPost).
    expect(countryNear({ lat: 42.7, lng: 23.32 })).toBe('BG');
    expect(countryNear({ lat: 41.4, lng: 23.36 })).toBe('BG'); // Kulata, at the Greek border
    expect(countryNear({ lat: 52.37, lng: 4.9 })).toBe('NL');
  });

  it('never names a Busia: one stands on each side of the Kenya–Uganda border', () => {
    expect(lookupPlace('Busia')).toBeNull();
    expect(GAZETTEER.some((e) => e.name === 'Busia')).toBe(false);
  });

  it('names a point by its own country’s nearest town where its country is known', () => {
    const busiaKenya = { lat: 0.4608, lng: 34.1115 };
    expect(nearestPlace(busiaKenya, 60, 'KE')?.name).toBe('Bungoma');
    expect(nearestPlace(busiaKenya)?.name).toBe('Tororo'); // without its country, the nearest of all — across the border
    expect(nearestPlace({ lat: 52.37, lng: 4.9 }, 60, 'NL')?.name).toBe('Amsterdam');
    expect(nearestPlaceAt({ lat: 0.32, lng: 32.58 }, 60, 'UG')).toMatchObject({ name: 'Kampala', location: { lat: 0.3136, lng: 32.5811 } });
    expect(nearestPlace({ lat: 0.32, lng: 32.58 }, 60, 'KE')).toBeNull(); // no Kenyan town within 60 km of Kampala
  });

  it('the offline geocoder keeps to the countries it is told', () => {
    const g = new GazetteerGeocoder();
    expect(g.geocode('Kampala')).toMatchObject({ confidence: 'exact', matched: 'Kampala' });
    expect(g.geocode('Kampala', ['KE']).confidence).toBe('fallback');
    expect(g.geocode('Utrecht', ['NL'])).toMatchObject({ confidence: 'exact', location: { lat: 52.0907, lng: 5.1214 } });
  });
});
