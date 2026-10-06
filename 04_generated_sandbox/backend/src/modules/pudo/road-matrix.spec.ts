import { HeuristicRouter } from './router';
import { OsrmRoadMatrix, ROAD_MAX_POINTS, placeKey, readTable, tableUrl } from './road-matrix';

/**
 * ROAD DISTANCES FROM A ROUTING SERVER. The request and the answer below are the protocol's own shapes — the answer
 * is what the public OSRM demo server sent for three places round Athi River on 2026-10-06, copied as it came (the
 * drive `scratchpad/osrm-live.mjs` asks it again). What is pinned: the request is written the way the protocol wants
 * it, a real answer is read, every way of NOT getting an answer falls back to the estimate and says why, and nothing
 * but coordinates is sent.
 */
describe('road distances for a plan', () => {
  const yard = { lat: -1.45, lng: 36.98 };
  const kitengela = { lat: -1.478, lng: 36.962 };
  const mlolongo = { lat: -1.396, lng: 36.94 };
  // As the demo server answered it, in the order the adapter asks (places sorted by their key): metres, and not the
  // same there as back.
  const REAL = {
    code: 'Ok',
    distances: [
      [0, 13314.6, 14777.9],
      [9429, 0, 5412.8],
      [10688.1, 5846.6, 0],
    ],
    destinations: [{ hint: 'x', location: [36.940091, -1.395692], name: '', distance: 35.5 }],
    sources: [],
  };
  const estimate = new HeuristicRouter();
  let matrix: OsrmRoadMatrix;
  let asked: Array<{ url: string; headers: Record<string, string> }>;
  const answering = (body: unknown, status = 200) => {
    matrix.fetcher = async (url, init) => {
      asked.push({ url, headers: init.headers });
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    };
  };
  const ENV = ['GLOS_ROUTER_URL', 'GLOS_ROUTER_MAX_POINTS', 'GLOS_ROUTER_PROFILE'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    matrix = new OsrmRoadMatrix(estimate);
    asked = [];
    answering(REAL);
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('asks nobody when no routing server is configured: the estimate, as before, and no reason to give', async () => {
    const d = await matrix.between([yard, kitengela, mlolongo]);
    expect(d.source).toBe('estimate');
    expect(d.why).toBeUndefined();
    expect(d.km(yard, kitengela)).toBe(estimate.roadKm(yard, kitengela));
    expect(asked).toEqual([]);
    expect(matrix.configured()).toBe(false);
  });

  it('writes the table request the way the protocol wants it: longitude first, every place once, distances asked for', () => {
    expect(tableUrl('http://osrm.example:5000/', 'driving', [yard, kitengela])).toBe('http://osrm.example:5000/table/v1/driving/36.98000,-1.45000;36.96200,-1.47800?annotations=distance');
    expect(placeKey({ lat: -1.4500001, lng: 36.98 })).toBe(placeKey(yard));
  });

  it('reads a real answer: by road, each way its own distance — and the same door asked twice is one place', async () => {
    process.env.GLOS_ROUTER_URL = 'http://osrm.example:5000';
    const d = await matrix.between([yard, kitengela, mlolongo, { ...kitengela }, yard]);
    expect(d).toMatchObject({ source: 'roads' });
    expect([d.why, d.gaps]).toEqual([undefined, undefined]);
    // The yard to Kitengela is 5.4 km by road and 5.8 km back — a straight line says 3.7 either way.
    expect(d.km(yard, kitengela)).toBeCloseTo(5.4128, 4);
    expect(d.km(kitengela, yard)).toBeCloseTo(5.8466, 4);
    expect(d.km(yard, mlolongo)).toBeCloseTo(9.429, 4);
    expect(d.km(mlolongo, kitengela)).toBeCloseTo(14.7779, 4);
    expect(d.km(yard, yard)).toBe(0);
    expect(d.km(yard, kitengela)).toBeGreaterThan(estimate.roadKm(yard, kitengela));
    // One request, three places, nothing in it but coordinates.
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toBe('http://osrm.example:5000/table/v1/driving/36.94000,-1.39600;36.98000,-1.45000;36.96200,-1.47800?annotations=distance');
    expect(asked[0].headers).toEqual({ accept: 'application/json' });
    expect(matrix.configured()).toBe(true);
  });

  it('asks once for the same places, however often the day is planned again — and again once the answer is old', async () => {
    process.env.GLOS_ROUTER_URL = 'http://osrm.example:5000';
    const t0 = 1_800_000_000_000;
    await matrix.between([yard, kitengela, mlolongo], t0);
    await matrix.between([mlolongo, yard, kitengela], t0 + 60_000);
    expect(asked).toHaveLength(1);
    // Another set of places is another question.
    await matrix.between([yard, kitengela], t0 + 60_000).catch(() => undefined);
    expect(asked).toHaveLength(2);
    await matrix.between([yard, kitengela, mlolongo], t0 + 11 * 60_000);
    expect(asked).toHaveLength(3);
  });

  it('estimates the one leg the map has no road for, and says how many there were', async () => {
    process.env.GLOS_ROUTER_URL = 'http://osrm.example:5000';
    answering({ code: 'Ok', distances: [[0, null, 14777.9], [9429, 0, 5412.8], [null, 5846.6, 0]] });
    const d = await matrix.between([yard, kitengela, mlolongo]);
    expect(d).toMatchObject({ source: 'roads', gaps: 2 });
    expect(d.km(mlolongo, yard)).toBe(estimate.roadKm(mlolongo, yard));
    expect(d.km(yard, kitengela)).toBeCloseTo(5.4128, 4);
    // A place the table was never asked about is estimated too, not looked up as somewhere else.
    const elsewhere = { lat: -1.2, lng: 36.8 };
    expect(d.km(yard, elsewhere)).toBe(estimate.roadKm(yard, elsewhere));
  });

  it('falls back to the estimate, and says why, every way an answer can fail to come', async () => {
    process.env.GLOS_ROUTER_URL = 'http://osrm.example:5000';
    const three = [yard, kitengela, mlolongo];
    const fresh = () => (matrix = Object.assign(new OsrmRoadMatrix(estimate), { fetcher: matrix.fetcher }));
    const cases: Array<[string, () => void, RegExp]> = [
      ['an error from the server', () => answering({ message: 'no' }, 500), /answered 500/],
      ['a refusal', () => answering({ code: 'InvalidQuery' }, 400), /answered 400/],
      ['another code in a 200', () => answering({ code: 'NoTable', distances: REAL.distances }), /not a table of distances/],
      ['a table of the wrong size', () => answering({ code: 'Ok', distances: [[0, 1], [1, 0]] }), /not a table of distances/],
      ['a row of the wrong size', () => answering({ code: 'Ok', distances: [[0, 1, 2], [1, 0], [2, 1, 0]] }), /not a table of distances/],
      ['a row too few', () => answering({ code: 'Ok', distances: [[0, 1, 2], [1, 0, 3]] }), /not a table of distances/],
      ['a row too many', () => answering({ code: 'Ok', distances: [[0, 1, 2], [1, 0, 3], [2, 1, 0], [4, 5, 6]] }), /not a table of distances/],
      ['a distance that is not a number', () => answering({ code: 'Ok', distances: [[0, '5', 2], [1, 0, 3], [2, 1, 0]] }), /not a table of distances/],
      ['a negative distance', () => answering({ code: 'Ok', distances: [[0, -5, 2], [1, 0, 3], [2, 1, 0]] }), /not a table of distances/],
      ['words, not a table', () => answering('<html>502 Bad Gateway</html>'), /not a table of distances/],
      ['nothing at all', () => answering(null), /not a table of distances/],
      ['no answer in time', () => (matrix.fetcher = async () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))), /did not answer in time/],
      ['nobody there', () => (matrix.fetcher = async () => Promise.reject(new TypeError('fetch failed'))), /could not be reached/],
      ['an answer that cannot be read as JSON', () => (matrix.fetcher = async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('Unexpected token')) })), /not a table of distances/],
    ];
    for (const [what, arrange, why] of cases) {
      arrange();
      fresh();
      const d = await matrix.between(three);
      expect([what, d.source, why.test(d.why ?? '')]).toEqual([what, 'estimate', true]);
      expect(d.km(yard, kitengela)).toBe(estimate.roadKm(yard, kitengela));
    }
    // A failure is not kept as if it were an answer: the next plan asks again.
    answering(REAL);
    fresh();
    expect((await matrix.between(three)).source).toBe('roads');
  });

  it('does not send a day with more places than one request takes: the estimate, and the count', async () => {
    process.env.GLOS_ROUTER_URL = 'http://osrm.example:5000';
    const many = Array.from({ length: ROAD_MAX_POINTS + 1 }, (_, i) => ({ lat: -1 - i / 1000, lng: 36 + i / 1000 }));
    const d = await matrix.between(many);
    expect(d).toMatchObject({ source: 'estimate', why: '101 places are more than the routing server takes in one request (100)' });
    expect(asked).toEqual([]);
    // The operator of a server that takes more says so.
    process.env.GLOS_ROUTER_MAX_POINTS = '250';
    answering({ code: 'Ok', distances: many.map(() => many.map(() => 1000)) });
    expect((await matrix.between(many)).source).toBe('roads');
    expect(asked).toHaveLength(1);
  });

  it('has no leg to measure for one place or none, and ignores a point that is not one', async () => {
    process.env.GLOS_ROUTER_URL = 'http://osrm.example:5000';
    expect((await matrix.between([])).source).toBe('estimate');
    expect((await matrix.between([yard, { ...yard }])).source).toBe('estimate');
    expect((await matrix.between([yard, { lat: Number.NaN, lng: 1 }])).source).toBe('estimate');
    expect(asked).toEqual([]);
  });

  it('reads a table strictly: it is a table or it is not', () => {
    expect(readTable(REAL, 3)).toEqual(REAL.distances);
    expect(readTable({ code: 'Ok', distances: [[0, null], [null, 0]] }, 2)).toEqual([[0, null], [null, 0]]);
    for (const bad of [undefined, null, 'Ok', {}, { code: 'Ok' }, { code: 'Ok', distances: 'x' }, { code: 'ok', distances: [[0]] }, { code: 'Ok', distances: [[Number.POSITIVE_INFINITY]] }]) expect(readTable(bad, 1)).toBeUndefined();
  });
});
