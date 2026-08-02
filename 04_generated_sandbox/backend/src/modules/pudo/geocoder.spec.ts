import { GazetteerGeocoder } from './geocoder';
import { GAZETTEER, lookupPlace, normalizePlace } from './geo-gazetteer';
import { haversineKm } from './geo';

describe('geo gazetteer (G1)', () => {
  describe('normalizePlace', () => {
    it('lowercases, strips punctuation, collapses whitespace', () => {
      expect(normalizePlace('  Nairobi,  CBD! ')).toBe('nairobi cbd');
      expect(normalizePlace('Biashara St. 12')).toBe('biashara st 12');
    });
  });

  describe('lookupPlace', () => {
    it('matches a known place exactly', () => {
      const m = lookupPlace('Westlands');
      expect(m?.entry.name).toBe('Westlands');
      expect(m?.kind).toBe('exact');
    });

    it('matches an alias (CBD → Nairobi)', () => {
      expect(lookupPlace('CBD')?.entry.name).toBe('Nairobi');
      expect(lookupPlace('nairobi cbd')?.entry.name).toBe('Nairobi');
    });

    it('prefers the specific neighbourhood over the broad city when both are named', () => {
      // Both "Westlands" and "Nairobi" appear — the specific neighbourhood wins.
      expect(lookupPlace('Ring Road, Westlands, Nairobi')?.entry.name).toBe('Westlands');
      expect(lookupPlace('Plot 7, Karen, Nairobi')?.entry.name).toBe('Karen');
    });

    it('resolves a real street address to its town', () => {
      expect(lookupPlace('Biashara St 12, Nairobi CBD')?.entry.name).toBe('Nairobi');
      expect(lookupPlace('Moi Avenue, Mombasa')?.entry.name).toBe('Mombasa');
    });

    it('does NOT mistake a town-named ROAD for the town — "Mombasa Road, Nairobi" is in Nairobi', () => {
      expect(lookupPlace('Sameer Business Park, Mombasa Road, Nairobi')?.entry.name).toBe('Nairobi');
      expect(lookupPlace('Garden City, Thika Road, Nairobi')?.entry.name).toBe('Nairobi');
      expect(lookupPlace('Meru Road, Nairobi')?.entry.name).toBe('Nairobi');
      expect(lookupPlace('Naivasha Road, Nairobi')?.entry.name).toBe('Nairobi');
    });

    it('takes the trailing town over an earlier estate/proper-noun name — "Riverside Estate, Nakuru" → Nakuru', () => {
      expect(lookupPlace('Riverside Estate, Nakuru')?.entry.name).toBe('Nakuru');
      // and a bare "Riverside" is still the Nairobi neighbourhood
      expect(lookupPlace('Riverside')?.entry.name).toBe('Riverside');
    });

    it('matches on whole words only — not a substring of a longer word', () => {
      expect(lookupPlace('Karenni Refugee Info')).toBeNull(); // "Karen" is not a word here
    });

    it('returns null for an unknown place', () => {
      expect(lookupPlace('Atlantis Underwater City')).toBeNull();
      expect(lookupPlace('   ')).toBeNull();
    });

    it('every gazetteer entry has plausible Kenya coordinates', () => {
      for (const e of GAZETTEER) {
        expect(e.location.lat).toBeGreaterThanOrEqual(-5);
        expect(e.location.lat).toBeLessThanOrEqual(5.5);
        expect(e.location.lng).toBeGreaterThanOrEqual(33.5);
        expect(e.location.lng).toBeLessThanOrEqual(42);
      }
    });
  });

  describe('GazetteerGeocoder', () => {
    const geo = new GazetteerGeocoder();

    it('resolves a known place to its REAL coordinates with exact confidence', () => {
      const r = geo.geocode('Kisumu');
      expect(r.confidence).toBe('exact');
      expect(r.matched).toBe('Kisumu');
      // within ~2 km of the real Kisumu centroid
      expect(haversineKm(r.location, { lat: -0.0917, lng: 34.768 })).toBeLessThan(2);
    });

    it('resolves an address naming a place with approx confidence', () => {
      const r = geo.geocode('Plot 7, Karen, Nairobi');
      expect(r.confidence).toBe('approx');
      expect(r.matched).toBe('Karen');
    });

    it('falls back to a deterministic point (near the centroid) for an unknown address', () => {
      const r = geo.geocode('12 Nowhere Lane, Atlantis');
      expect(r.confidence).toBe('fallback');
      expect(r.matched).toBeUndefined();
      // stable: the same input always yields the same point
      expect(geo.geocode('12 Nowhere Lane, Atlantis').location).toEqual(r.location);
      // and it lands in the network's operating area (near Nairobi), not at 0,0
      expect(haversineKm(r.location, { lat: -1.28, lng: 36.82 })).toBeLessThan(60);
    });

    it('two DIFFERENT known places resolve to genuinely different points', () => {
      const a = geo.geocode('Mombasa').location;
      const b = geo.geocode('Eldoret').location;
      expect(haversineKm(a, b)).toBeGreaterThan(400); // Mombasa↔Eldoret is really far apart
    });
  });
});
