import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { ZoneMapService } from './zone-map.service';
import { decodePolygon } from './zone-geometry';

/** A square of `size` degrees whose south-west corner is (lng, lat). */
const square = (lng: number, lat: number, size = 0.1): number[][] => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat],
];
/** Four areas in a square of squares: North-west, North-east, South-west, South-east. */
const FOUR = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    ['North-west', 36.7, -1.2],
    ['North-east', 36.8, -1.2],
    ['South-west', 36.7, -1.3],
    ['South-east', 36.8, -1.3],
  ].map(([name, lng, lat]) => ({ type: 'Feature', properties: { shapeName: name }, geometry: { type: 'Polygon', coordinates: [square(lng as number, lat as number)] } })),
});
const AREAS = { geojson: FOUR, source: 'A test survey', licence: 'CC BY 4.0', attribution: 'Test survey contributors', level: 'wards' };
const IN = { nw: { lat: -1.15, lng: 36.75 }, ne: { lat: -1.15, lng: 36.85 }, sw: { lat: -1.25, lng: 36.75 }, se: { lat: -1.25, lng: 36.85 } };
const HOUR = 3_600_000;

describe('a country’s zones (zone pricing, step 1)', () => {
  let entities: EntityService;
  let zones: ZoneMapService;
  // Shops and hubs as the zones see them: a pin and a country.
  const shops: Array<{ shopName: string; location?: { lat: number; lng: number }; country: string }> = [];
  const hubs: Array<{ name: string; location?: { lat: number; lng: number }; country: string }> = [];
  const agents = { list: () => shops, countryOf: (a: { country: string }) => a.country };
  const mdps = { list: () => hubs, countryOf: (m: { country: string }) => m.country };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    zones = new ZoneMapService(entities, agents as never, mdps as never);
    shops.length = 0;
    hubs.length = 0;
  });

  const codeOf = (name: string, which: 'draft' | 'inForce' = 'draft') => zones.setup('sbg-ke')[which]!.zones.find((z) => z.name === name)!.code;

  it('starts every country with three groups in plain words, and nothing else', () => {
    const s = zones.setup('sbg-ke');
    expect(s.groups).toEqual([
      { key: 'urban', name: 'Urban' },
      { key: 'rural', name: 'Rural' },
      { key: 'remote', name: 'Remote' },
    ]);
    expect(s.inForce).toBeUndefined();
    expect(s.draft).toBeUndefined();
    expect(s.versions).toEqual([]);
    expect(s.outside).toEqual([]);
  });

  it('belongs to the company that runs a country: the group keeps none', () => {
    expect(() => zones.setup('sbg')).toThrow(/does not run a country/);
  });

  it('brings in the country’s areas as a draft of one zone each, in the middle group, with where they came from — and records who did it', () => {
    const s = zones.importAreas('sbg-ke', AREAS, 'Njeri W.');
    expect(s.draft!.version).toBe(1);
    expect(s.draft!.zones.map((z) => [z.code, z.name, z.group, z.areas])).toEqual([
      ['Z0001', 'North-west', 'rural', 1],
      ['Z0002', 'North-east', 'rural', 1],
      ['Z0003', 'South-west', 'rural', 1],
      ['Z0004', 'South-east', 'rural', 1],
    ]);
    expect(s.draft!.areas).toMatchObject({ source: 'A test survey', licence: 'CC BY 4.0', attribution: 'Test survey contributors', level: 'wards', count: 4, importedBy: 'Njeri W.' });
    expect(s.draft!.zones[0].areaKm2).toBeGreaterThan(120);
    const change = entities.changes('sbg-ke')[0];
    expect(change).toMatchObject({ by: 'Njeri W.', what: 'zones', from: 'no zones', to: 'draft 1: 4 wards from A test survey, one zone each' });
  });

  it('refuses a file it cannot read, a file without its credit, and new areas over an open draft', () => {
    expect(() => zones.importAreas('sbg-ke', { ...AREAS, geojson: '{' }, 'N')).toThrow(/not GeoJSON/);
    expect(() => zones.importAreas('sbg-ke', { ...AREAS, attribution: ' ' }, 'N')).toThrow(/the credit their licence asks for/);
    zones.importAreas('sbg-ke', AREAS, 'N');
    expect(() => zones.importAreas('sbg-ke', AREAS, 'N')).toThrow(/A draft is open/);
  });

  it('renames a zone and gives it another group; refuses a group the country does not have', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    const code = codeOf('North-west');
    const s = zones.changeZone('sbg-ke', code, { name: 'City centre', group: 'urban' }, 'Njeri W.');
    expect(s.draft!.zones.find((z) => z.code === code)).toMatchObject({ name: 'City centre', group: 'urban' });
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ from: `${code} North-west · Rural`, to: `${code} City centre · Urban` });
    expect(() => zones.changeZone('sbg-ke', code, { group: 'island' }, 'N')).toThrow(/There is no group island/);
    expect(() => zones.changeZone('sbg-ke', 'Z9999', { name: 'x' }, 'N')).toThrow(/There is no zone Z9999/);
  });

  it('makes two zones one, keeping the first one’s code; the other code is never used again', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    const [nw, ne] = [codeOf('North-west'), codeOf('North-east')];
    const s = zones.merge('sbg-ke', [nw, ne], 'North', 'N');
    const north = s.draft!.zones.find((z) => z.code === nw)!;
    expect(north).toMatchObject({ name: 'North', areas: 2, from: [ne] });
    expect(s.draft!.zones.map((z) => z.code)).not.toContain(ne);
    expect(() => zones.merge('sbg-ke', [nw], undefined, 'N')).toThrow(/at least two zones/);
    // A new zone after this takes a fresh code, not the one that went.
    const shapes = zones.shapes('sbg-ke');
    const swArea = shapes.areas.find((a) => a.name === 'South-west')!.id;
    const split = zones.move('sbg-ke', [swArea], undefined, 'Lakeside', 'N');
    expect(split.draft!.zones.find((z) => z.name === 'Lakeside')!.code).toBe('Z0005');
  });

  it('moves areas into another zone or a new one; a zone left with nothing is gone', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    const area = (name: string) => zones.shapes('sbg-ke').areas.find((a) => a.name === name)!.id;
    const se = codeOf('South-east');
    const sw = codeOf('South-west');
    const s = zones.move('sbg-ke', [area('South-west')], se, undefined, 'N');
    expect(s.draft!.zones.map((z) => z.code)).not.toContain(sw);
    expect(s.draft!.zones.find((z) => z.code === se)!.areas).toBe(2);
    expect(() => zones.move('sbg-ke', [area('South-west')], se, undefined, 'N')).toThrow(/in South-east already/);
    expect(() => zones.move('sbg-ke', ['999'], se, undefined, 'N')).toThrow(/no area 999/);
  });

  it('publishes the draft: from then on a pin finds its zone, with the group in the country’s words', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    zones.changeZone('sbg-ke', codeOf('North-east'), { group: 'urban' }, 'N');
    const s = zones.publish('sbg-ke', undefined, 'Njeri W.');
    expect(s.draft).toBeUndefined();
    expect(s.inForce!.version).toBe(1);
    expect(s.versions).toEqual([expect.objectContaining({ version: 1, status: 'in_force', publishedBy: 'Njeri W.', zones: 4 })]);
    expect(zones.zoneAt('KE', IN.ne)).toMatchObject({ name: 'North-east', group: 'urban', groupName: 'Urban', version: 1 });
    expect(zones.zoneAt('KE', { lat: 5, lng: 40 })).toBeUndefined();
    // The country renames its groups; a pin says the new words.
    zones.setGroups('sbg-ke', [{ key: 'urban', name: 'Mjini' }, { key: 'rural', name: 'Vijijini' }, { key: 'remote', name: 'Mbali' }], 'N');
    expect(zones.zoneAt('KE', IN.ne)!.groupName).toBe('Mjini');
  });

  it('keeps each country’s zones its own: a pin in Ethiopia never finds a Kenyan zone', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    zones.publish('sbg-ke', undefined, 'N');
    expect(zones.zoneAt('KE', IN.nw)?.name).toBe('North-west');
    expect(zones.zoneAt('ET', IN.nw)).toBeUndefined();
    expect(zones.setup('sbg-et').inForce).toBeUndefined();
    expect(zones.setup('sbg-et').groups.map((g) => g.name)).toEqual(['Urban', 'Rural', 'Remote']);
  });

  it('a map published for a date to come takes over only on that date; the date is never in the past and at most a year ahead', () => {
    const now = Date.now();
    zones.importAreas('sbg-ke', AREAS, 'N', now);
    zones.publish('sbg-ke', undefined, 'N', now);
    zones.startDraft('sbg-ke', 'N', now);
    zones.changeZone('sbg-ke', codeOf('North-west'), { name: 'Old town' }, 'N', now);
    expect(() => zones.publish('sbg-ke', new Date(now - 2 * HOUR).toISOString(), 'N', now)).toThrow(/never in the past/);
    expect(() => zones.publish('sbg-ke', new Date(now + 400 * 24 * HOUR).toISOString(), 'N', now)).toThrow(/at most a year ahead/);
    const s = zones.publish('sbg-ke', new Date(now + 24 * HOUR).toISOString(), 'N', now);
    expect(s.inForce!.version).toBe(1);
    expect(s.scheduled.map((m) => m.version)).toEqual([2]);
    expect(zones.zoneAt('KE', IN.nw, now)!.name).toBe('North-west');
    expect(zones.zoneAt('KE', IN.nw, now + 25 * HOUR)!.name).toBe('Old town');
    expect(zones.setup('sbg-ke', now + 25 * HOUR).versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'in_force'],
      [1, 'past'],
    ]);
  });

  it('a group a zone still uses cannot be taken away; a new one gets a key of its own; two of one name are refused', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    expect(() => zones.setGroups('sbg-ke', [{ key: 'urban', name: 'Urban' }, { key: 'remote', name: 'Remote' }], 'N')).toThrow(/“Rural” is still the group of a zone/);
    const s = zones.setGroups('sbg-ke', [{ key: 'urban', name: 'Urban' }, { key: 'rural', name: 'Rural' }, { name: 'Island' }], 'N');
    expect(s.groups).toEqual([
      { key: 'urban', name: 'Urban' },
      { key: 'rural', name: 'Rural' },
      { key: 'g4', name: 'Island' },
    ]);
    expect(() => zones.setGroups('sbg-ke', [{ key: 'urban', name: 'Island' }, { key: 'g4', name: 'island' }, { key: 'rural', name: 'Rural' }], 'N')).toThrow(/Two groups are called/);
  });

  it('throws a draft away, and with it the areas brought in for it alone', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    const s = zones.discardDraft('sbg-ke', 'N');
    expect(s.draft).toBeUndefined();
    expect(() => zones.shapes('sbg-ke')).toThrow(/has no zones yet/);
    expect(() => zones.startDraft('sbg-ke', 'N')).toThrow(/bring in the country’s areas first/);
  });

  it('counts the shops and hubs in each zone, and names the ones whose pin lies in no zone', () => {
    shops.push({ shopName: 'Duka la Kati', location: IN.ne, country: 'KE' }, { shopName: 'Far away', location: { lat: 4, lng: 41 }, country: 'KE' }, { shopName: 'Addis shop', location: IN.ne, country: 'ET' });
    hubs.push({ name: 'Sort 1', location: IN.sw, country: 'KE' });
    zones.importAreas('sbg-ke', AREAS, 'N');
    zones.publish('sbg-ke', undefined, 'N');
    const s = zones.setup('sbg-ke');
    expect(s.inForce!.zones.find((z) => z.name === 'North-east')).toMatchObject({ shops: 1, hubs: 0 });
    expect(s.inForce!.zones.find((z) => z.name === 'South-west')).toMatchObject({ shops: 0, hubs: 1 });
    expect(s.outside).toEqual(['Shop Far away']);
    expect(zones.zoneOfShop(shops[0] as never)?.name).toBe('North-east');
    expect(zones.zoneOfShop(shops[2] as never)).toBeUndefined(); // an Ethiopian shop, and Ethiopia keeps no zones yet
    expect(zones.zoneOfHub(hubs[0] as never)?.name).toBe('South-west');
  });

  it('gives the map its shapes: every area with its zone, in the compact form that reads back to the file’s corners', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    const shapes = zones.shapes('sbg-ke');
    expect(shapes.attribution).toBe('Test survey contributors');
    expect(shapes.areas).toHaveLength(4);
    const nw = shapes.areas.find((a) => a.name === 'North-west')!;
    expect(nw.zone).toBe('Z0001');
    // The file's corners to 5 decimals, as they were kept (the test's own sums carry floating-point noise: 36.7 + 0.1).
    expect(decodePolygon(nw.polygons[0])).toEqual([square(36.7, -1.2).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])]);
  });
});
