import { describe, expect, it } from 'vitest';
import { mapsNavUrl, mapsSearchUrl } from './maps';

describe('maps deep links', () => {
  const p = { lat: -1.2864, lng: 36.8172 };

  it('builds a Google Maps search (pin) link', () => {
    expect(mapsSearchUrl(p)).toBe('https://www.google.com/maps/search/?api=1&query=-1.2864%2C36.8172');
  });

  it('builds a Google Maps directions link', () => {
    expect(mapsNavUrl(p)).toBe('https://www.google.com/maps/dir/?api=1&destination=-1.2864%2C36.8172');
  });

  it('returns null for a missing or non-finite point', () => {
    expect(mapsNavUrl(undefined)).toBeNull();
    expect(mapsNavUrl(null)).toBeNull();
    expect(mapsSearchUrl({ lat: NaN, lng: 36 })).toBeNull();
    expect(mapsNavUrl({ lat: 1, lng: Infinity })).toBeNull();
  });
});
