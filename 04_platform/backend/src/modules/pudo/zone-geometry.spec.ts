import { AreaFileProblem, AreaIndex, boxOf, contains, decodePolygon, decodeRing, distanceKm, encodePolygon, encodeRing, measure, parseAreaFile, type Shape } from './zone-geometry';

/** A square of `size` degrees whose south-west corner is (lng, lat), as GeoJSON writes it. */
const square = (lng: number, lat: number, size = 0.1): number[][] => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat],
];
const feature = (name: string | undefined, coordinates: unknown, type = 'Polygon', props: Record<string, unknown> = {}) => ({ type: 'Feature', properties: { ...(name ? { shapeName: name } : {}), ...props }, geometry: { type, coordinates } });
const file = (...features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });

describe('the geometry of a country’s zones', () => {
  it('reads named areas from a boundary file: corners to 5 decimals, repeats dropped, rings closed', () => {
    const areas = parseAreaFile(
      file(
        feature('North', [[[36.700001, -1.2], [36.8, -1.2], [36.8, -1.2], [36.8, -1.1], [36.7, -1.1]]]),
        feature('South', [[square(36.7, -1.3)]], 'MultiPolygon'),
      ),
    );
    expect(areas.map((a) => a.name)).toEqual(['North', 'South']);
    expect(areas[0].shape[0][0]).toEqual([
      [36.7, -1.2],
      [36.8, -1.2],
      [36.8, -1.1],
      [36.7, -1.1],
      [36.7, -1.2],
    ]);
    expect(areas[1].shape).toHaveLength(1);
  });

  it('takes the names from the field it is told, else from the usual ones', () => {
    expect(parseAreaFile(file(feature(undefined, [square(1, 1)], 'Polygon', { WARD: 'Kati' })))[0].name).toBe('Kati');
    expect(parseAreaFile(file(feature(undefined, [square(1, 1)], 'Polygon', { label: 'Mji' })), 'label')[0].name).toBe('Mji');
    // The Dutch statistics office's files name a municipality, a district or a neighbourhood so (2026-11-08).
    expect(parseAreaFile(file(feature(undefined, [square(1, 1)], 'Polygon', { statcode: 'GM0363', statnaam: 'Amsterdam' })))[0].name).toBe('Amsterdam');
    expect(parseAreaFile(file(feature(undefined, [square(1, 1)], 'Polygon', { buurtcode: 'BU03630000', buurtnaam: 'Kop Zeedijk', gemeentenaam: 'Amsterdam' })))[0].name).toBe('Kop Zeedijk');
  });

  it('refuses what is not a file of named areas — nothing is left out quietly', () => {
    const refused = (text: string, nameField?: string) => {
      try {
        parseAreaFile(text, nameField);
      } catch (e) {
        expect(e).toBeInstanceOf(AreaFileProblem);
        return (e as Error).message;
      }
      throw new Error('was taken');
    };
    expect(refused('{not json')).toMatch(/not GeoJSON/);
    expect(refused(JSON.stringify({ type: 'Point', coordinates: [1, 1] }))).toMatch(/FeatureCollection/);
    expect(refused(file())).toMatch(/no areas/);
    expect(refused(file(feature('A town', [36.8, -1.2], 'Point')))).toMatch(/Area 1 \(A town\) is not an area: it is a Point/);
    expect(refused(file(feature(undefined, [square(1, 1)])))).toMatch(/Area 1 has no name/);
    expect(refused(file(feature(undefined, [square(1, 1)])), 'label')).toMatch(/Area 1 has no “label”/);
    expect(refused(file(feature('Far', [[[200, 1], [201, 1], [201, 2], [200, 1]]])))).toMatch(/outside the earth/);
    expect(refused(file(feature('Thin', [[[1, 1], [2, 2], [1, 1]]])))).toMatch(/fewer than three corners/);
  });

  it('measures an area in km² and finds its centre', () => {
    // A tenth of a degree square on the equator: about 11.13 km by 11.06 km.
    const m = measure([[square(36.8, 0)]] as unknown as Shape);
    expect(m.areaKm2).toBeGreaterThan(121);
    expect(m.areaKm2).toBeLessThan(125);
    expect(m.centre.lat).toBeCloseTo(0.05, 3);
    expect(m.centre.lng).toBeCloseTo(36.85, 3);
    expect(boxOf([[square(36.8, 0)]] as unknown as Shape)).toEqual([36.8, 0, 36.9, 0.1]);
  });

  it('knows a point inside an area from one in its hole, and how far a point lies outside', () => {
    const withHole = [[square(36.7, -1.3, 0.3), square(36.8, -1.2, 0.1)]] as unknown as Shape;
    expect(contains(withHole, { lat: -1.25, lng: 36.75 })).toBe(true);
    expect(contains(withHole, { lat: -1.15, lng: 36.85 })).toBe(false); // in the hole
    expect(distanceKm(withHole, { lat: -1.25, lng: 36.75 })).toBe(0);
    // A hundredth of a degree east of the east edge, on the equator's doorstep: about 1.1 km.
    expect(distanceKm(withHole, { lat: -1.25, lng: 37.01 })).toBeCloseTo(1.11, 1);
  });

  it('finds the area a pin lies in; a pin in the hair between two areas takes the nearer; one far out lies in none', () => {
    const areas = [
      { id: 'west', shape: [[square(36.7, -1.3)]] as unknown as Shape },
      { id: 'east', shape: [[square(36.801, -1.3)]] as unknown as Shape }, // a gap of a thousandth of a degree from west
    ].map((a) => ({ ...a, box: boxOf(a.shape) }));
    const index = new AreaIndex(areas);
    expect(index.find({ lat: -1.25, lng: 36.75 })).toBe('west');
    expect(index.find({ lat: -1.25, lng: 36.85 })).toBe('east');
    expect(index.find({ lat: -1.25, lng: 36.8008 })).toBe('east'); // in the gap, nearer east
    expect(index.find({ lat: -1.25, lng: 37.5 })).toBeUndefined();
    expect(index.find({ lat: Number.NaN, lng: 36.75 })).toBeUndefined();
  });

  it('writes a ring as the standard encoded polyline, and reads it back', () => {
    // The worked example of the encoding's own documentation.
    const ring: Array<[number, number]> = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ];
    expect(encodeRing(ring)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodeRing(encodeRing(ring))).toEqual(ring);
    // Corners as a file keeps them, to 5 decimals (the test's own sums carry floating-point noise: 36.7 + 0.1).
    const r5 = (ring: number[][]) => ring.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
    const polygon = [r5(square(36.7, -1.3, 0.3)), r5(square(36.8, -1.2, 0.1))] as Array<Array<[number, number]>>;
    expect(decodePolygon(encodePolygon(polygon))).toEqual(polygon);
  });
});
