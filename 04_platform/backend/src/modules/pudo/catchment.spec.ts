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
 * WHICH HUB SERVES EACH ZONE (2026-11-09 — the catchments-and-runs plan, Part A, D1 as recommended: "each zone belongs to
 * exactly one hub, proposed by the nearest hub by road, changeable in the console"). What is pinned: the proposal gives
 * every zone without a hub its nearest hub and says it is a proposal; a person's choice replaces it and is logged; a hub
 * no longer approved serves nothing; a zone merged or split since carries its hub over; and routing asks by pin.
 */
describe('which hub serves each zone', () => {
  let entities: EntityService;
  let zones: ZoneMapService;
  let catchments: CatchmentService;
  // Two Kenyan hubs, one in the north-west, one in the south-east; an Ethiopian one; and the approved ones.
  const hubs = [
    { mdpId: 'mdp_north', name: 'North hub', location: { lat: -1.14, lng: 36.74 }, country: 'KE' },
    { mdpId: 'mdp_south', name: 'South hub', location: { lat: -1.26, lng: 36.86 }, country: 'KE' },
    { mdpId: 'mdp_addis', name: 'Addis hub', location: { lat: 9.03, lng: 38.74 }, country: 'ET' },
  ];
  const approved = new Set(hubs.map((h) => h.mdpId));
  const none = { list: () => [], countryOf: () => 'KE' };
  const mdps = { list: () => hubs, isApproved: (m: { mdpId: string }) => approved.has(m.mdpId), countryOf: (m: { country: string }) => m.country };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    zones = new ZoneMapService(entities, none as never, none as never);
    catchments = new CatchmentService(entities, zones, mdps as never, new HeuristicRouter());
    approved.clear();
    for (const h of hubs) approved.add(h.mdpId);
  });

  const codeOf = (name: string, which: 'draft' | 'inForce' = 'inForce') => zones.setup('sbg-ke')[which]!.zones.find((z) => z.name === name)!.code;
  const published = () => {
    zones.importAreas('sbg-ke', AREAS, 'N');
    zones.publish('sbg-ke', undefined, 'N');
  };

  it('has nothing to say before the country’s zones are published, and proposes nothing', () => {
    expect(catchments.view('sbg-ke')).toMatchObject({ country: 'KE', zones: [], unserved: 0 });
    expect(catchments.view('sbg-ke').hubs.map((h) => h.name)).toEqual(['North hub', 'South hub']);
    expect(() => catchments.propose('sbg-ke', 'Njeri W.')).toThrow(/Publish the country’s zones first/);
  });

  it('proposes the nearest of the country’s hubs by road for every zone without one — said to be a proposal, and logged', () => {
    published();
    expect(catchments.view('sbg-ke').unserved).toBe(4);
    const v = catchments.propose('sbg-ke', 'Njeri W.');
    const hubOf = (name: string) => v.zones.find((z) => z.name === name)!;
    expect(hubOf('North-west')).toMatchObject({ hubName: 'North hub', proposed: true });
    expect(hubOf('South-east')).toMatchObject({ hubName: 'South hub', proposed: true });
    expect(hubOf('North-west').km).toBeGreaterThan(0);
    expect(v.unserved).toBe(0);
    expect(v.hubs).toEqual([
      { mdpId: 'mdp_north', name: 'North hub', zones: expect.any(Number) },
      { mdpId: 'mdp_south', name: 'South hub', zones: expect.any(Number) },
    ]);
    // Never the Ethiopian hub, however it lay.
    expect(v.zones.every((z) => z.mdpId !== 'mdp_addis')).toBe(true);
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ what: 'catchments', by: 'Njeri W.', to: '4 zones given the nearest hub by road (proposed)' });
    // Asked again: nothing left to propose, nothing written.
    catchments.propose('sbg-ke', 'N');
    expect(entities.changes('sbg-ke').filter((c) => c.what === 'catchments')).toHaveLength(1);
  });

  it('takes a person’s choice over the proposal, or no hub at all — refusing a hub of another country and a zone not on the map', () => {
    published();
    catchments.propose('sbg-ke', 'N');
    const ne = codeOf('North-east');
    const v = catchments.assign('sbg-ke', ne, 'mdp_south', 'Otieno K.');
    expect(v.zones.find((z) => z.code === ne)).toMatchObject({ mdpId: 'mdp_south', hubName: 'South hub' });
    expect(v.zones.find((z) => z.code === ne)!.proposed).toBeUndefined();
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ what: 'catchments', by: 'Otieno K.', to: `${ne} North-east · South hub` });
    expect(catchments.assign('sbg-ke', ne, undefined, 'N').zones.find((z) => z.code === ne)!.mdpId).toBeUndefined();
    expect(() => catchments.assign('sbg-ke', ne, 'mdp_addis', 'N')).toThrow(/not an approved hub of SeeBuyGet Kenya/);
    expect(() => catchments.assign('sbg-ke', 'Z9999', 'mdp_north', 'N')).toThrow(/no zone Z9999 on the map in force/);
  });

  it('answers routing by pin: the hub that serves where a pin lies, or nothing', () => {
    published();
    catchments.propose('sbg-ke', 'N');
    expect(catchments.hubForPoint('KE', IN.nw)).toBe('mdp_north');
    expect(catchments.hubForPoint('KE', IN.se)).toBe('mdp_south');
    expect(catchments.hubForPoint('KE', { lat: 5, lng: 40 })).toBeUndefined();
    expect(catchments.hubForPoint('ET', IN.nw)).toBeUndefined();
    expect(catchments.hubFor('KE', undefined)).toBeUndefined();
  });

  it('a hub no longer approved serves nothing: its zones are routed as before until another serves them', () => {
    published();
    catchments.propose('sbg-ke', 'N');
    approved.delete('mdp_south');
    expect(catchments.hubForPoint('KE', IN.se)).toBeUndefined();
    const v = catchments.view('sbg-ke');
    expect(v.hubs.map((h) => h.mdpId)).toEqual(['mdp_north']);
    expect(v.unserved).toBeGreaterThan(0);
  });

  it('a zone merged or split since carries its hub over until somebody sets its own', () => {
    published();
    catchments.assign('sbg-ke', codeOf('North-west'), 'mdp_north', 'N');
    catchments.assign('sbg-ke', codeOf('South-east'), 'mdp_south', 'N');
    const se = codeOf('South-east');
    // A new map: North-east merged into North-west (which keeps its code), and South-east split into a new zone.
    zones.startDraft('sbg-ke', 'N');
    zones.merge('sbg-ke', [codeOf('North-west', 'draft'), codeOf('North-east', 'draft')], undefined, 'N');
    const area = zones.shapes('sbg-ke').areas.find((a) => a.name === 'South-east')!.id;
    zones.move('sbg-ke', [area], undefined, 'Harbour', 'N');
    zones.publish('sbg-ke', undefined, 'N');
    const harbour = codeOf('Harbour');
    expect(harbour).not.toBe(se);
    expect(catchments.hubForPoint('KE', IN.ne)).toBe('mdp_north');
    expect(catchments.hubForPoint('KE', IN.se)).toBe('mdp_south');
    expect(catchments.view('sbg-ke').zones.find((z) => z.code === harbour)).toMatchObject({ hubName: 'South hub', inherited: true });
    // Set its own: no longer carried over.
    catchments.assign('sbg-ke', harbour, 'mdp_north', 'N');
    expect(catchments.hubForPoint('KE', IN.se)).toBe('mdp_north');
    expect(catchments.view('sbg-ke').zones.find((z) => z.code === harbour)!.inherited).toBeUndefined();
  });
});
