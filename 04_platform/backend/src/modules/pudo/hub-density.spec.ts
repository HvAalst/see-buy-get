import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { HeuristicRouter } from './router';
import { HubDensityService } from './hub-density.service';
import { coverageOf, gatherNeeds, reachOfGroup, reachStartOf, ROAD_GAP_KM, stillAside } from './hub-density';

/**
 * WHERE HUBS ARE NEEDED (2026-11-12, the plan "Hubs on the Road", step 3). Kenya, as its example: a hub at Nairobi, shops and
 * parcels at Marsabit far beyond any hub, a hub at Isiolo full most days, two stops kept too close, and a long road.
 */
const AT = {
  nairobi: { lat: -1.2864, lng: 36.8172 },
  isiolo: { lat: 0.3546, lng: 37.5822 },
  marsabit: { lat: 2.3284, lng: 37.9899 },
  thika: { lat: -1.0333, lng: 37.0693 },
  lodwar: { lat: 3.119, lng: 35.597 },
};
const router = new HeuristicRouter();

describe('where hubs are needed (2026-11-12)', () => {
  it('judges a zone by its group, gathers neighbouring zones, and keeps a suggestion aside 90 days or until it doubles', () => {
    const ke = reachStartOf('KE');
    expect(ke).toEqual({ urban: 15, rural: 60, remote: 150 });
    expect([reachStartOf('ET').rural, reachStartOf('NL').urban, reachStartOf('TZ').remote]).toEqual([80, 5, 150]);
    expect(reachOfGroup(ke, 'urban')).toBe(15);
    expect(reachOfGroup(ke, 'industrial')).toBe(60);
    expect([coverageOf(10, 15), coverageOf(25, 15), coverageOf(40, 15), coverageOf(undefined, 15)]).toEqual(['near', 'far', 'too_far', 'too_far']);
    const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => router.roadKm(a, b);
    const groups = gatherNeeds(
      [
        { code: 'A', centre: AT.marsabit, score: 50, reach: 150 },
        { code: 'B', centre: { lat: 2.4, lng: 38.0 }, score: 10, reach: 150 },
        { code: 'C', centre: AT.lodwar, score: 30, reach: 150 },
      ],
      km,
    );
    expect(groups.map((g) => g.map((z) => z.code))).toEqual([['A', 'B'], ['C']]);
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(stillAside({ at: '2026-11-01T00:00:00Z', score: 40 }, 60, now)).toBe(true);
    expect(stillAside({ at: '2026-11-01T00:00:00Z', score: 40 }, 80, now)).toBe(false);
    expect(stillAside({ at: '2026-07-01T00:00:00Z', score: 40 }, 40, now)).toBe(false);
    expect(ROAD_GAP_KM).toBe(440);
  });

  describe('the service', () => {
    let entities: EntityService;
    let density: HubDensityService;
    const hub = (key: keyof typeof AT, extra: Record<string, unknown> = {}) => ({ mdpId: `mdp_${key}`, name: key[0].toUpperCase() + key.slice(1), location: AT[key], country: 'KE', ...extra });
    const hubs = [hub('nairobi'), hub('isiolo', { sortPerDay: 10 }), hub('thika')];
    const zonesInForce = [
      { code: 'KE-NBO', name: 'Nairobi', group: 'urban', centre: AT.nairobi },
      { code: 'KE-MRS', name: 'Marsabit', group: 'remote', centre: AT.marsabit },
      { code: 'KE-ISO', name: 'Isiolo', group: 'rural', centre: AT.isiolo },
    ];
    const zoneAtPoint = (p: { lat: number; lng: number }) => (p.lat > 1.5 ? 'KE-MRS' : p.lat > 0 ? 'KE-ISO' : 'KE-NBO');
    const shops = [
      { did: 's1', status: 'ACTIVE', location: { lat: 2.33, lng: 37.99 } },
      { did: 's2', status: 'ACTIVE', location: { lat: 2.34, lng: 37.98 } },
      { did: 's3', status: 'KYC_PENDING', location: { lat: 2.35, lng: 37.97 } },
      { did: 's4', status: 'ACTIVE', location: { lat: -1.29, lng: 36.82 } },
      { did: 's5', status: 'ACTIVE', location: { lat: 0.35, lng: 37.58 } },
    ];
    const now = Date.now();
    const recent = new Date(now - 2 * 86_400_000).toISOString();
    const parcels = [
      ...Array.from({ length: 20 }, (_, i) => ({ parcelId: `p${i}`, acceptedAt: recent, originAgentDid: 's4', destAgentDid: i % 2 ? 's1' : 's5' })),
      { parcelId: 'old', acceptedAt: new Date(now - 60 * 86_400_000).toISOString(), originAgentDid: 's4', destAgentDid: 's1' },
    ];
    const deps = () => ({
      zones: {
        setup: () => ({ inForce: { version: 1, zones: zonesInForce } }),
        zoneAt: (_c: string, p: { lat: number; lng: number }) => ({ code: zoneAtPoint(p) }),
      },
      mdps: {
        list: () => hubs,
        isApproved: () => true,
        countryOf: (m: { country: string }) => m.country,
        isDown: () => false,
        daysOf: (id: string, n: number) => Array.from({ length: n }, (_, i) => ({ day: `d${i}`, sorted: id === 'mdp_isiolo' ? 12 : 1, ...(id === 'mdp_isiolo' && i % 2 ? { full: true } : {}) })),
      },
      catchments: {
        view: () => ({
          zones: [
            { code: 'KE-NBO', hubs: [{ mdpId: 'mdp_nairobi' }, { mdpId: 'mdp_thika' }] },
            { code: 'KE-ISO', hubs: [{ mdpId: 'mdp_isiolo' }] },
            { code: 'KE-MRS', hubs: [] },
          ],
        }),
      },
      roadMaps: {
        view: () => ({
          proposal: {
            links: [{ a: 'mdp_isiolo', b: 'mdp_nairobi', aName: 'Isiolo', bName: 'Nairobi', km: 520 }, { a: 'mdp_isiolo', b: 'mdp_thika', aName: 'Isiolo', bName: 'Thika', km: 200 }],
            tooClose: [{ a: 'mdp_nairobi', b: 'mdp_thika', aName: 'Nairobi', bName: 'Thika', km: 45 }],
            minKm: 60,
          },
        }),
        inForce: () => undefined,
      },
      agents: {
        list: () => shops,
        find: (did: string) => shops.find((s) => s.did === did),
        countryOf: () => 'KE',
      },
      parcels: { list: () => parcels },
      totes: { list: () => [{ waitsForRoom: { hubId: 'mdp_isiolo' } }] },
    });

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
      }).compile();
      entities = moduleRef.get(EntityService);
      entities.seed();
      const d = deps();
      density = new HubDensityService(entities, d.zones as never, d.mdps as never, d.catchments as never, d.roadMaps as never, d.agents as never, d.parcels as never, d.totes as never, router);
    });

    it('coverage, demand and pressure by zone and hub; the four kinds of suggestion, each with its numbers and a place', () => {
      const v = density.view('sbg-ke');
      expect(v).toMatchObject({ country: 'KE', mapVersion: 1, reach: { urban: 15, rural: 60, remote: 150 }, roadMapInForce: false });
      const zone = (code: string) => v.zones.find((z) => z.code === code)!;
      // Marsabit: two shops (one still being checked is not counted), ten parcels in 30 days, no hub serving it, far beyond reach.
      expect(zone('KE-MRS')).toMatchObject({ shops: 2, received30: 10, sent30: 0, served: false, coverage: 'too_far' });
      expect(zone('KE-NBO')).toMatchObject({ shops: 1, sent30: 20, served: true, coverage: 'near' });
      const isiolo = v.hubs.find((h) => h.mdpId === 'mdp_isiolo')!;
      expect(isiolo).toMatchObject({ fullDays: 7, sortedPerDay: 12, sortPerDay: 10, waiting: 1, down: false });
      const kinds = v.suggestions.map((s) => s.kind).sort();
      expect(kinds).toEqual(['extra_hub', 'hub_needed', 'road_gap', 'too_close']);
      // Only the road longer than a day's drive is a gap; one of 200 km is not.
      expect(v.suggestions.filter((x) => x.kind === 'road_gap')).toHaveLength(1);
      expect(v.links).toHaveLength(2);
      const need = v.suggestions.find((s) => s.kind === 'hub_needed')!;
      expect(need).toMatchObject({ zones: ['KE-MRS'], numbers: { shops: 2, parcels: 10, reach: 150 }, place: { name: 'Marsabit' } });
      expect(need.numbers.km).toBeGreaterThan(150);
      expect(v.suggestions.find((s) => s.kind === 'extra_hub')).toMatchObject({ hubs: ['mdp_isiolo'], numbers: { fullDays: 7, days: 14 } });
      expect(v.suggestions.find((s) => s.kind === 'too_close')).toMatchObject({ hubNames: ['Nairobi', 'Thika'], numbers: { apart: 45, min: 60 } });
      const gap = v.suggestions.find((s) => s.kind === 'road_gap')!;
      expect(gap).toMatchObject({ hubNames: ['Isiolo', 'Nairobi'], numbers: { apart: 520 } });
      expect(gap.towns.length).toBeGreaterThan(0);
    });

    it('set aside with why — logged, and back by staff; the reach is the country’s own, logged', () => {
      const need = density.view('sbg-ke').suggestions.find((s) => s.kind === 'hub_needed')!;
      const aside = density.setAside('sbg-ke', need.id, 'A hub is being recruited there', 'Amina');
      expect(aside.suggestions.map((s) => s.id)).not.toContain(need.id);
      expect(aside.setAside.find((s) => s.id === need.id)?.aside).toMatchObject({ by: 'Amina', reason: 'A hub is being recruited there' });
      expect(entities.changes('sbg-ke').find((c) => c.what === 'hubDensity')?.to).toMatch(/^set aside for 90 days/);
      expect(() => density.setAside('sbg-ke', 'need:nowhere', 'gone', 'Amina')).toThrow(/no longer made/);
      expect(density.bringBack('sbg-ke', need.id, 'Amina').suggestions.map((s) => s.id)).toContain(need.id);
      expect(() => density.bringBack('sbg-ke', need.id, 'Amina')).toThrow(/not set aside/);
      // A wider reach for remote zones: Marsabit's shops are within it, and no hub is needed there.
      const wide = density.setReach('sbg-ke', { urban: 15, rural: 60, remote: 600 }, 'Amina');
      expect(wide.reach.remote).toBe(600);
      expect(wide.zones.find((z) => z.code === 'KE-MRS')!.coverage).toBe('near');
      expect(wide.suggestions.some((s) => s.kind === 'hub_needed')).toBe(false);
    });
  });
});
