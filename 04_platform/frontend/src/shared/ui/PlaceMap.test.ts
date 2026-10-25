import { describe, expect, it } from 'vitest';
import { framedPoints, initialMapMode } from './PlaceMap';

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

/*
 * WHERE A PICKER LOOKS (the user, 2026-10-25: a newcomer "has no way to confirm" a place on a map of the whole
 * network). With `nearest`, a marked place is framed with its closest shops — not every shop there is.
 */
describe('framedPoints', () => {
  const westlands = { lat: -1.2673, lng: 36.8065 };
  const pin = (id: string, lat: number, lng: number) => ({ id, label: id, point: { lat, lng } });
  const pins = [pin('near-1', -1.268, 36.81), pin('near-2', -1.27, 36.8), pin('near-3', -1.26, 36.82), pin('near-4', -1.25, 36.83), pin('berlin', 52.52, 13.405)];

  it('frames every pin and the marked place, as before, unless asked for the nearest', () => {
    expect(framedPoints({ pins, reference: westlands })).toHaveLength(6);
  });

  it('frames the marked place and its nearest shops — never one a continent away', () => {
    const framed = framedPoints({ pins, reference: westlands, nearest: 3 });
    expect(framed[0]).toEqual(westlands);
    expect(framed).toHaveLength(4);
    expect(framed).not.toContainEqual({ lat: 52.52, lng: 13.405 });
    // Nothing near: the place alone, close up.
    expect(framedPoints({ pins: [pins[4]], reference: westlands, nearest: 3 })).toEqual([westlands]);
  });
});
