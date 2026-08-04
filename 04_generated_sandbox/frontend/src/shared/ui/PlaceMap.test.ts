import { describe, expect, it } from 'vitest';
import { initialMapMode } from './PlaceMap';

describe('initialMapMode (G3a)', () => {
  it('honours a stored choice regardless of connectivity', () => {
    expect(initialMapMode(true, 'plot')).toBe('plot');
    expect(initialMapMode(false, 'map')).toBe('map');
  });

  it('with no stored choice, defaults to the map online and the dot-plot offline', () => {
    expect(initialMapMode(true, null)).toBe('map');
    expect(initialMapMode(false, null)).toBe('plot');
  });

  it('ignores a garbage stored value and falls back to the connectivity default', () => {
    expect(initialMapMode(true, 'nonsense')).toBe('map');
    expect(initialMapMode(false, '')).toBe('plot');
  });
});
