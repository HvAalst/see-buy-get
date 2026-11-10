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

  it('marks a zone an island, no door delivery or not served — said in the change log, cleared by marking nothing; nothing else is a mark (2026-11-09)', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    const code = codeOf('South-east');
    const s = zones.changeZone('sbg-ke', code, { flags: ['notServed', 'island'] }, 'Njeri W.');
    // Kept in one order, whatever order they were said in.
    expect(s.draft!.zones.find((z) => z.code === code)!.flags).toEqual(['island', 'notServed']);
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ from: `${code} South-east · Rural`, to: `${code} South-east · Rural · an island, not served` });
    // A rename keeps the marks.
    zones.changeZone('sbg-ke', code, { name: 'Islands' }, 'N');
    expect(zones.setup('sbg-ke').draft!.zones.find((z) => z.code === code)!.flags).toEqual(['island', 'notServed']);
    expect(() => zones.changeZone('sbg-ke', code, { flags: ['volcano'] }, 'N')).toThrow(/not volcano/);
    zones.changeZone('sbg-ke', code, { flags: [] }, 'N');
    expect(zones.setup('sbg-ke').draft!.zones.find((z) => z.code === code)!.flags).toBeUndefined();
  });

  it('refuses a new parcel to or from a zone not served, and a door where none is delivered — by name; an unmarked zone and a pin in none pass', () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    zones.changeZone('sbg-ke', codeOf('South-east'), { flags: ['notServed'] }, 'N');
    zones.changeZone('sbg-ke', codeOf('South-west'), { flags: ['noDoor', 'island'] }, 'N');
    // A draft refuses nothing: only the map in force does.
    expect(() => zones.refuseUnserved('KE', IN.se, 'to')).not.toThrow();
    zones.publish('sbg-ke', undefined, 'N');
    expect(zones.zoneAt('KE', IN.sw)).toMatchObject({ name: 'South-west', flags: ['island', 'noDoor'] });
    expect(() => zones.refuseUnserved('KE', IN.se, 'to')).toThrow(/We do not deliver in South-east yet/);
    expect(() => zones.refuseUnserved('KE', IN.se, 'from')).toThrow(/We do not collect in South-east yet/);
    // No door delivery is not unserved: its shops serve it.
    expect(() => zones.refuseUnserved('KE', IN.sw, 'to')).not.toThrow();
    expect(() => zones.refuseNoDoor('KE', IN.sw)).toThrow(/We do not deliver to doors in South-west/);
    expect(() => zones.refuseNoDoor('KE', IN.se)).toThrow(/We do not deliver in South-east yet/);
    expect(() => zones.refuseNoDoor('KE', IN.nw)).not.toThrow();
    expect(() => zones.refuseUnserved('KE', { lat: 5, lng: 40 }, 'to')).not.toThrow();
    expect(() => zones.refuseUnserved('ET', IN.se, 'to')).not.toThrow();
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

describe('the first map proposed for a country — Kenya’s, for Kenya’s company alone (2026-11-08)', () => {
  let zones: ZoneMapService;
  let entities: EntityService;
  const none = { list: () => [], countryOf: () => 'KE' };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    zones = new ZoneMapService(entities, none as never, none as never);
  });

  it('is offered to Kenya’s company, and to no other country’s', () => {
    const ke = zones.setup('sbg-ke').proposal!;
    expect(ke).toMatchObject({ level: 'wards', areas: 1452 });
    expect(ke.zones).toBeGreaterThan(250);
    expect(ke.attribution).toMatch(/geoBoundaries/);
    // A country with no map of its own is offered none — never another country's.
    entities.createCompany({ kind: 'sister', jurisdiction: 'TZ', name: 'SeeBuyGet Tanzania' }, 'Owner');
    expect(zones.setup('sbg-tz').proposal).toBeUndefined();
    expect(() => zones.startFromProposal('sbg-tz', 'N')).toThrow(/No map is proposed for SeeBuyGet Tanzania/);
  });

  it('Uganda has its own (2026-11-10): its 1,521 sub-counties, Kampala’s five divisions one zone, a zone for each city and town and each district’s rest; remote where Posta prices its far band and on the islands', () => {
    entities.createCompany({ kind: 'sister', jurisdiction: 'UG', name: 'SeeBuyGet Uganda' }, 'Owner');
    const ug = zones.setup('sbg-ug').proposal!;
    expect(ug).toMatchObject({ level: 'sub-counties', areas: 1521, zones: 168 });
    expect(ug.attribution).toMatch(/UNHCR/);
    const s = zones.startFromProposal('sbg-ug', 'Grace N.');
    expect(s.draft!.zones.reduce((n, z) => n + z.areas, 0)).toBe(1521);
    expect(s.draft!.zones.every((z) => ['urban', 'rural', 'remote'].includes(z.group) && z.evidence?.length)).toBe(true);
    expect(s.draft!.zones.filter((z) => z.group === 'remote').every((z) => z.evidence!.some((e) => /\(.*\)/.test(e)))).toBe(true); // each remote zone cites its source
    zones.publish('sbg-ug', undefined, 'Grace N.');
    entities.activate('sbg-ug', 'Owner');
    expect(zones.zoneAt('UG', { lat: 0.3136, lng: 32.5811 })).toMatchObject({ name: 'Kampala', group: 'urban' });
    expect(zones.zoneAt('UG', { lat: 0.4233, lng: 33.2039 })).toMatchObject({ name: 'Jinja', group: 'urban' });
    expect(zones.zoneAt('UG', { lat: -0.3214, lng: 32.2919 })).toMatchObject({ name: 'Kalangala', group: 'remote' });
    expect(zones.zoneAt('UG', { lat: 3.52, lng: 34.12 })).toMatchObject({ name: 'Kaabong', group: 'remote' });
    // Uganda's alone: a Kenyan pin in Kampala finds nothing in it.
    expect(zones.zoneAt('KE', { lat: 0.3136, lng: 32.5811 })).toBeUndefined();
  });

  it('Ethiopia has its own (2026-11-10): its 690 woredas, Addis Ababa one zone, a zone for each town and each administrative zone’s rest; remote only with a source', () => {
    const et = zones.setup('sbg-et').proposal!;
    expect(et).toMatchObject({ level: 'woredas', areas: 690, zones: 85 });
    expect(et.attribution).toMatch(/Code for Ethiopia/);
    expect(et.licence).toMatch(/ODbL/);
    const s = zones.startFromProposal('sbg-et', 'Hanna T.');
    expect(s.draft!.zones.reduce((n, z) => n + z.areas, 0)).toBe(690);
    expect(s.draft!.zones.every((z) => ['urban', 'rural', 'remote'].includes(z.group) && z.evidence?.length)).toBe(true);
    expect(s.draft!.zones.filter((z) => z.group === 'remote').every((z) => z.evidence!.some((e) => /\(.*20\d\d\)/.test(e)))).toBe(true); // each remote zone cites a dated source
    zones.publish('sbg-et', undefined, 'Hanna T.');
    expect(zones.zoneAt('ET', { lat: 9.03, lng: 38.74 })).toMatchObject({ name: 'Addis Ababa', group: 'urban' });
    expect(zones.zoneAt('ET', { lat: 8.54, lng: 39.27 })).toMatchObject({ name: 'Adama', group: 'urban' });
    expect(zones.zoneAt('ET', { lat: 3.53, lng: 39.05 })).toMatchObject({ name: 'Borena', group: 'remote' });
    // Still Ethiopia's alone: a Kenyan pin finds nothing in it, and Kenya is offered its own.
    expect(zones.zoneAt('KE', { lat: 9.03, lng: 38.74 })).toBeUndefined();
    expect(zones.setup('sbg-ke').proposal).toMatchObject({ level: 'wards' });
  });

  it('opens as a draft: every ward in one zone, each zone with its proposed group and the evidence for it; published, pins find their zones', () => {
    const s = zones.startFromProposal('sbg-ke', 'Njeri W.');
    const draft = s.draft!;
    expect(draft.areas).toMatchObject({ count: 1452, level: 'wards', importedBy: 'Njeri W.' });
    expect(draft.zones.reduce((n, z) => n + z.areas, 0)).toBe(1452);
    expect(draft.zones.every((z) => ['urban', 'rural', 'remote'].includes(z.group) && z.evidence?.length)).toBe(true);
    zones.publish('sbg-ke', undefined, 'Njeri W.');
    expect(zones.zoneAt('KE', { lat: -1.2864, lng: 36.8172 })).toMatchObject({ name: 'Nairobi', group: 'urban' });
    expect(zones.zoneAt('KE', { lat: -4.0435, lng: 39.6682 })).toMatchObject({ name: 'Mombasa', group: 'urban' });
    expect(zones.zoneAt('KE', { lat: -1.0333, lng: 37.0693 })).toMatchObject({ name: 'Thika', group: 'urban' });
    expect(zones.zoneAt('KE', { lat: 3.1191, lng: 35.5973 })).toMatchObject({ name: 'Turkana Central', group: 'remote' });
    // Still Kenya's alone: an Ethiopian pin finds nothing, even where Kenya keeps a zone.
    expect(zones.zoneAt('ET', { lat: -1.2864, lng: 36.8172 })).toBeUndefined();
  });

  it('the Netherlands has its own (2026-11-09): its 342 municipalities, a zone for each city, island and region’s rest — Kenya’s never offered there, nor the Dutch one in Kenya', () => {
    entities.createCompany({ kind: 'sister', jurisdiction: 'NL', name: 'SeeBuyGet Nederland' }, 'Owner');
    const nl = zones.setup('sbg-nl').proposal!;
    expect(nl).toMatchObject({ level: 'municipalities', areas: 342, zones: 87, licence: 'CC BY 4.0' });
    expect(nl.attribution).toMatch(/CBS/);
    expect(zones.setup('sbg-ke').proposal).toMatchObject({ level: 'wards' });
    const s = zones.startFromProposal('sbg-nl', 'Sanne B.');
    expect(s.draft!.areas).toMatchObject({ count: 342, level: 'municipalities' });
    expect(s.draft!.zones.reduce((n, z) => n + z.areas, 0)).toBe(342);
    expect(s.draft!.zones.every((z) => ['urban', 'rural', 'remote'].includes(z.group) && z.evidence?.length)).toBe(true);
    zones.publish('sbg-nl', undefined, 'Sanne B.');
    // Prepared while the company is a draft; it places pins once the company is switched on.
    expect(zones.zoneAt('NL', { lat: 52.3728, lng: 4.8936 })).toBeUndefined();
    entities.activate('sbg-nl', 'Owner');
    expect(zones.zoneAt('NL', { lat: 52.3728, lng: 4.8936 })).toMatchObject({ name: 'Amsterdam', group: 'urban' });
    expect(zones.zoneAt('NL', { lat: 51.9244, lng: 4.4777 })).toMatchObject({ name: 'Rotterdam', group: 'urban' });
    expect(zones.zoneAt('NL', { lat: 53.0546, lng: 4.7972 })).toMatchObject({ name: 'Texel', group: 'remote' });
    expect(zones.zoneAt('NL', { lat: 52.7858, lng: 6.8976 })).toMatchObject({ name: 'Emmen', group: 'rural' });
    expect(zones.zoneAt('NL', { lat: 51.9725, lng: 6.7194 })).toMatchObject({ name: 'Achterhoek', group: 'rural' });
    // Still the Netherlands' alone: a Kenyan pin in Amsterdam finds nothing.
    expect(zones.zoneAt('KE', { lat: 52.3728, lng: 4.8936 })).toBeUndefined();
  });

  it('a proposed group the company has taken away starts in its middle group; refused over an open draft', () => {
    zones.setGroups('sbg-ke', [{ key: 'urban', name: 'Urban' }, { key: 'rural', name: 'Rural' }], 'N');
    const s = zones.startFromProposal('sbg-ke', 'N');
    expect(s.draft!.zones.some((z) => z.group === 'remote')).toBe(false);
    expect(s.draft!.zones.find((z) => z.name === 'Turkana Central')!.group).toBe('rural');
    expect(() => zones.startFromProposal('sbg-ke', 'N')).toThrow(/A draft is open/);
  });
});
