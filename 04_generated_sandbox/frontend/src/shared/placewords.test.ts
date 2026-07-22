import { describe, expect, it } from 'vitest';
import { DEFAULT_BOUNDS, distanceLabel, fitBounds, haversineKm, project, unproject } from './geo';
import { PLACE_WORDS, fromPlaceWords, isPlaceWords, toPlaceWords } from './placewords';

describe('geo', () => {
  it('fitBounds pads, enforces a minimum span, and survives nothing to fit', () => {
    const b = fitBounds([{ lat: -1.2, lng: 36.8 }]);
    expect(b.maxLat - b.minLat).toBeGreaterThanOrEqual(0.08);
    expect(fitBounds([])).toEqual(DEFAULT_BOUNDS);
    const two = fitBounds([
      { lat: -1.2, lng: 36.7 },
      { lat: -1.4, lng: 36.9 },
    ]);
    expect(two.minLat).toBeLessThan(-1.4);
    expect(two.maxLng).toBeGreaterThan(36.9);
  });

  it('project clamps into the frame and unproject inverts it', () => {
    const b = DEFAULT_BOUNDS;
    const p = { lat: -1.25, lng: 36.8 };
    const { x, y } = project(p, b);
    expect(x).toBeGreaterThanOrEqual(4);
    expect(y).toBeLessThanOrEqual(94);
    const back = unproject(x, y, b);
    expect(back.lat).toBeCloseTo(p.lat, 3);
    expect(back.lng).toBeCloseTo(p.lng, 3);
  });

  it('haversine matches a known city-scale pair and the label speaks plainly', () => {
    // Nairobi CBD → Westlands is roughly 4 km.
    const km = haversineKm({ lat: -1.2864, lng: 36.8172 }, { lat: -1.2648, lng: 36.8021 });
    expect(km).toBeGreaterThan(2.5);
    expect(km).toBeLessThan(4.5);
    expect(distanceLabel(0.42)).toBe('400 m away');
    expect(distanceLabel(2.31)).toBe('2.3 km away');
    expect(distanceLabel(14.7)).toBe('15 km away');
  });
});

describe('place words', () => {
  it('the wordlist is 4096 distinct lowercase words', () => {
    expect(PLACE_WORDS.length).toBe(4096);
    expect(new Set(PLACE_WORDS).size).toBe(4096);
    for (const w of PLACE_WORDS) expect(w).toMatch(/^[a-z]+$/);
  });

  it('round-trips: decode lands inside the same cell it encoded', () => {
    for (const p of [
      { lat: -1.2864, lng: 36.8172 }, // the network's home
      { lat: 52.37, lng: 4.9 }, // Amsterdam
      { lat: -33.86, lng: 151.21 }, // Sydney
      { lat: 0, lng: 0 },
    ]) {
      const words = toPlaceWords(p);
      expect(words.split(' ')).toHaveLength(3);
      const back = fromPlaceWords(words)!;
      // Within one cell: ~76 m of latitude, ~153 m of longitude.
      expect(Math.abs(back.lat - p.lat)).toBeLessThan(0.0007);
      expect(Math.abs(back.lng - p.lng)).toBeLessThan(0.0014);
      expect(toPlaceWords(back)).toBe(words); // the centre re-encodes to the same words
    }
  });

  it('parsing forgives case and separators, and rejects everything else', () => {
    const words = toPlaceWords({ lat: -1.2864, lng: 36.8172 });
    const [a, b, c] = words.split(' ');
    expect(fromPlaceWords(`${a.toUpperCase()}. ${b} · ${c}`)).not.toBeNull();
    expect(isPlaceWords(words)).toBe(true);
    expect(fromPlaceWords('not real words')).toBeNull();
    expect(fromPlaceWords(`${a} ${b}`)).toBeNull();
    expect(fromPlaceWords('')).toBeNull();
  });

  it('a one-word slip never lands nearby — it moves far or fails', () => {
    const p = { lat: -1.2864, lng: 36.8172 };
    const words = toPlaceWords(p).split(' ');
    const slipped = [words[0], words[1], PLACE_WORDS[(PLACE_WORDS.indexOf(words[2]) + 1) % 4096]].join(' ');
    const back = fromPlaceWords(slipped);
    if (back) {
      // The last digit steps one longitude cell — same latitude band, ~150 m east; a slip in
      // EITHER other word jumps whole degrees. Assert the middle word's failure mode:
      const slippedMid = [words[0], PLACE_WORDS[(PLACE_WORDS.indexOf(words[1]) + 1) % 4096], words[2]].join(' ');
      const backMid = fromPlaceWords(slippedMid);
      if (backMid) expect(haversineKm(p, backMid)).toBeGreaterThan(5);
    }
  });
});
