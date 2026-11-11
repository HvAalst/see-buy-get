import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { ZoneMapService } from './zone-map.service';
import { CatchmentService } from './catchment.service';
import { HeuristicRouter } from './router';

/** A square of `size` degrees whose south-west corner is (lng, lat). */
const square = (lng: number, lat: number, size = 0.1): number[][] => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat],
];
/** Four areas in a square of squares. */
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

/**
 * A NET OF HUBS (2026-11-09 — the owner: "we should not restrict hubs … to 1 per zone … We should aim for a net of hubs";
 * answers: "Own zone + hub adds", "Nearest with room"). What is pinned: every approved hub serves the zone it stands in by
 * itself; a zone may have many hubs, and a pin goes to the nearest of them with room; staff add a hub to a zone or take one
 * away — the zone it stands in too — and give it back; a hub adds and drops zones itself, but never one staff took away
 * and never the zone it stands in; a zone no hub serves may be given the nearest, as a proposal; a hub no longer approved
 * serves nothing; a zone merged or split since carries its added hubs over; one hub a zone, as kept before, still reads.
 */
describe('a net of hubs: which hubs serve each zone', () => {
  let entities: EntityService;
  let zones: ZoneMapService;
  let catchments: CatchmentService;
  // Kenyan hubs: two in the north-west, one in the south-east; an Ethiopian one; and which are approved, and full.
  const hubs = [
    { mdpId: 'mdp_north', name: 'North hub', location: { lat: -1.14, lng: 36.72 }, country: 'KE' },
    { mdpId: 'mdp_north2', name: 'North Two hub', location: { lat: -1.18, lng: 36.79 }, country: 'KE' },
    { mdpId: 'mdp_south', name: 'South hub', location: { lat: -1.26, lng: 36.86 }, country: 'KE' },
    { mdpId: 'mdp_addis', name: 'Addis hub', location: { lat: 9.03, lng: 38.74 }, country: 'ET' },
  ];
  const approved = new Set<string>();
  const full = new Set<string>();
  const none = { list: () => [], countryOf: () => 'KE' };
  const mdps = {
    list: () => hubs,
    require: (id: string) => hubs.find((h) => h.mdpId === id)!,
    isApproved: (m: { mdpId: string }) => approved.has(m.mdpId),
    countryOf: (m: { country: string }) => m.country,
    hasRoom: (m: { mdpId: string }) => !full.has(m.mdpId),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    zones = new ZoneMapService(entities, none as never, none as never);
    catchments = new CatchmentService(entities, zones, mdps as never, new HeuristicRouter());
    approved.clear();
    full.clear();
    for (const h of hubs) approved.add(h.mdpId);
  });

  const codeOf = (name: string, which: 'draft' | 'inForce' = 'inForce') => zones.setup('sbg-ke')[which]!.zones.find((z) => z.name === name)!.code;
  const published = () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    zones.publish('sbg-ke', undefined, 'N');
  };
  const zoneOf = (name: string) => catchments.view('sbg-ke').zones.find((z) => z.name === name)!;
  const hubsOf = (name: string) => zoneOf(name).hubs.map((h) => [h.mdpId, h.how]);

  it('has nothing to say before the country’s zones are published, and proposes nothing', () => {
    expect(catchments.view('sbg-ke')).toMatchObject({ country: 'KE', zones: [], unserved: 0 });
    expect(catchments.view('sbg-ke').hubs.map((h) => h.name)).toEqual(['North hub', 'North Two hub', 'South hub']);
    expect(() => catchments.propose('sbg-ke', 'Njeri W.')).toThrow(/Publish the country’s zones first/);
  });

  it('every approved hub serves the zone it stands in, by itself — a zone may have several, nearest first', () => {
    published();
    const v = catchments.view('sbg-ke');
    expect(hubsOf('North-west')).toEqual([['mdp_north', 'stands'], ['mdp_north2', 'stands']]);
    expect(hubsOf('South-east')).toEqual([['mdp_south', 'stands']]);
    expect(zoneOf('North-west').hubs.every((h) => typeof h.km === 'number' && h.hubName)).toBe(true);
    expect(v.unserved).toBe(2);
    expect(v.hubs).toEqual([
      { mdpId: 'mdp_north', name: 'North hub', zones: 1 },
      { mdpId: 'mdp_north2', name: 'North Two hub', zones: 1 },
      { mdpId: 'mdp_south', name: 'South hub', zones: 1 },
    ]);
    // Never the Ethiopian hub, however it lay.
    expect(v.zones.every((z) => z.hubs.every((h) => h.mdpId !== 'mdp_addis'))).toBe(true);
  });

  it('a pin goes to the nearest of its zone’s hubs that has room — none with room, the nearest', () => {
    published();
    const nearNorth = { lat: -1.13, lng: 36.71 };
    const nearNorthTwo = { lat: -1.19, lng: 36.79 };
    expect(catchments.hubForPoint('KE', nearNorth)).toBe('mdp_north');
    expect(catchments.hubForPoint('KE', nearNorthTwo)).toBe('mdp_north2');
    full.add('mdp_north2');
    expect(catchments.hubForPoint('KE', nearNorthTwo)).toBe('mdp_north');
    full.add('mdp_north');
    expect(catchments.hubForPoint('KE', nearNorthTwo)).toBe('mdp_north2');
    // Both serve the zone: either hands a parcel for there straight to its shop.
    expect(catchments.serves('mdp_north', 'KE', nearNorthTwo)).toBe(true);
    expect(catchments.serves('mdp_south', 'KE', nearNorthTwo)).toBe(false);
    expect(catchments.hubForPoint('KE', { lat: 5, lng: 40 })).toBeUndefined();
    expect(catchments.hubForPoint('ET', IN.nw)).toBeUndefined();
    expect(catchments.hubsFor('KE', undefined)).toEqual([]);
  });

  it('a hub that is down serves no zone while it is — shown on Zones still; past the time it confirmed, it serves again (2026-11-11)', () => {
    published();
    const nearNorthTwo = { lat: -1.19, lng: 36.79 };
    const north2 = hubs[1] as (typeof hubs)[number] & { down?: { until?: string; confirmedAt?: string } };
    try {
      north2.down = {};
      expect(catchments.hubsFor('KE', codeOf('North-west'))).toEqual(['mdp_north']);
      expect(catchments.hubForPoint('KE', nearNorthTwo)).toBe('mdp_north');
      expect(hubsOf('North-west')).toEqual([['mdp_north', 'stands'], ['mdp_north2', 'stands']]);
      // Past its time, never confirmed: it still serves nothing.
      north2.down = { until: new Date(Date.now() - 60_000).toISOString() };
      expect(catchments.hubsFor('KE', codeOf('North-west'))).toEqual(['mdp_north']);
      // Confirmed in the day before: it serves again.
      north2.down = { until: new Date(Date.now() - 60_000).toISOString(), confirmedAt: new Date(Date.now() - 3_600_000).toISOString() };
      expect(catchments.hubsFor('KE', codeOf('North-west'))).toEqual(['mdp_north', 'mdp_north2']);
      expect(catchments.hubForPoint('KE', nearNorthTwo)).toBe('mdp_north2');
    } finally {
      delete north2.down;
    }
  });

  it('proposes the nearest hub by road for every zone no hub serves — said to be a proposal, and logged', () => {
    published();
    const v = catchments.propose('sbg-ke', 'Njeri W.');
    expect(v.unserved).toBe(0);
    expect(zoneOf('North-east').hubs).toEqual([expect.objectContaining({ how: 'proposed' })]);
    expect(zoneOf('South-west').hubs).toEqual([expect.objectContaining({ how: 'proposed' })]);
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ what: 'catchments', by: 'Njeri W.', to: '2 zones given the nearest hub by road (proposed)' });
    // Asked again: nothing left to propose, nothing written.
    catchments.propose('sbg-ke', 'N');
    expect(entities.changes('sbg-ke').filter((c) => c.what === 'catchments')).toHaveLength(1);
  });

  it('staff add a hub to a zone, take one away — the zone it stands in too — and give it back, every change logged', () => {
    published();
    const ne = codeOf('North-east');
    const nw = codeOf('North-west');
    catchments.setServing('sbg-ke', ne, 'mdp_south', true, 'Otieno K.');
    expect(hubsOf('North-east')).toEqual([['mdp_south', 'added']]);
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ what: 'catchments', by: 'Otieno K.', from: `${ne} North-east`, to: 'South hub serves it' });
    // The zone a hub stands in, taken away: the other hub there serves it alone, and a pin there goes to it.
    catchments.setServing('sbg-ke', nw, 'mdp_north', false, 'Otieno K.');
    expect(hubsOf('North-west')).toEqual([['mdp_north2', 'stands']]);
    expect(zoneOf('North-west').taken).toEqual(['mdp_north']);
    expect(catchments.hubForPoint('KE', { lat: -1.13, lng: 36.71 })).toBe('mdp_north2');
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ to: 'North hub taken away from it' });
    // Given back.
    catchments.setServing('sbg-ke', nw, 'mdp_north', true, 'N');
    expect(hubsOf('North-west').map(([id]) => id)).toEqual(['mdp_north', 'mdp_north2']);
    expect(zoneOf('North-west').taken).toEqual([]);
    expect(() => catchments.setServing('sbg-ke', ne, 'mdp_addis', true, 'N')).toThrow(/not an approved hub of SeeBuyGet Kenya/);
    expect(() => catchments.setServing('sbg-ke', 'Z9999', 'mdp_north', true, 'N')).toThrow(/no zone Z9999 on the map in force/);
  });

  it('a hub adds neighbouring zones itself and drops them — never the zone it stands in, never one staff took away', () => {
    published();
    const ne = codeOf('North-east');
    const se = codeOf('South-east');
    const before = catchments.ofHub('mdp_south');
    expect(before.standsIn).toMatchObject({ code: se, name: 'South-east', how: 'stands' });
    expect(before.serves.map((z) => z.code)).toEqual([se]);
    expect(before.nearby.map((z) => z.name)).toEqual(expect.arrayContaining(['North-east', 'South-west', 'North-west']));
    const after = catchments.setServingByHub('mdp_south', ne, true, 'South hub owner');
    expect(after.serves.find((z) => z.code === ne)).toMatchObject({ how: 'hub' });
    expect(after.nearby.some((z) => z.code === ne)).toBe(false);
    expect(hubsOf('North-east')).toEqual([['mdp_south', 'hub']]);
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ to: 'South hub serves it (added by the hub)' });
    expect(() => catchments.setServingByHub('mdp_south', se, false, 'S')).toThrow(/is where South hub stands: it is always yours/);
    catchments.setServingByHub('mdp_south', ne, false, 'S');
    expect(hubsOf('North-east')).toEqual([]);
    // Staff took North-east away from it: the hub cannot add it back; staff can.
    catchments.setServing('sbg-ke', ne, 'mdp_south', false, 'Otieno K.');
    expect(catchments.ofHub('mdp_south').taken.map((z) => z.code)).toEqual([ne]);
    expect(() => catchments.setServingByHub('mdp_south', ne, true, 'S')).toThrow(/staff took North-east away from South hub: ask them to give it back/);
    // A hub not yet approved serves nothing and adds nothing.
    approved.delete('mdp_north2');
    expect(() => catchments.setServingByHub('mdp_north2', ne, true, 'N')).toThrow(/once SeeBuyGet has approved it/);
  });

  it('a hub no longer approved serves nothing: its zone goes to the hubs left, or is routed as before', () => {
    published();
    approved.delete('mdp_south');
    expect(catchments.hubForPoint('KE', IN.se)).toBeUndefined();
    const v = catchments.view('sbg-ke');
    expect(v.hubs.map((h) => h.mdpId)).toEqual(['mdp_north', 'mdp_north2']);
    expect(v.unserved).toBe(3);
  });

  it('a zone merged or split since carries its added hubs over until it has its own', () => {
    approved.delete('mdp_south');
    published();
    catchments.setServing('sbg-ke', codeOf('South-east'), 'mdp_north', true, 'N');
    const se = codeOf('South-east');
    // A new map: South-east split into a new zone, Harbour.
    zones.startDraft('sbg-ke', 'N');
    const area = zones.shapes('sbg-ke').areas.find((a) => a.name === 'South-east')!.id;
    zones.move('sbg-ke', [area], undefined, 'Harbour', 'N');
    zones.publish('sbg-ke', undefined, 'N');
    const harbour = codeOf('Harbour');
    expect(harbour).not.toBe(se);
    expect(hubsOf('Harbour')).toEqual([['mdp_north', 'inherited']]);
    expect(catchments.hubForPoint('KE', IN.se)).toBe('mdp_north');
    // Its own now: no longer carried over.
    catchments.setServing('sbg-ke', harbour, 'mdp_north2', true, 'N');
    expect(hubsOf('Harbour')).toEqual([['mdp_north2', 'added']]);
  });

  it('one hub a zone, as kept before the net, still reads: as a hub added to it', () => {
    published();
    const ne = codeOf('North-east');
    (catchments as unknown as { store: { set: (k: string, v: unknown) => void } }).store.set('sbg-ke', { entityId: 'sbg-ke', hubs: { [ne]: { mdpId: 'mdp_south', by: 'Otieno K.', at: '2026-11-09T10:00:00Z' } } });
    expect(hubsOf('North-east')).toEqual([['mdp_south', 'added']]);
    // Written in the new shape from then on, the old one kept as an added hub.
    catchments.setServing('sbg-ke', ne, 'mdp_north2', true, 'N');
    expect(hubsOf('North-east').map(([id]) => id).sort()).toEqual(['mdp_north2', 'mdp_south']);
  });
});
