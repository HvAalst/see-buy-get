import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { HeuristicRouter } from './router';
import { HubDensityService } from './hub-density.service';
import { HubListService } from './hub-list.service';
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
        passOnFeeOf: (m: { passOnFee?: number }) => m.passOnFee ?? 0.3,
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
            stops: [{ mdpId: 'mdp_isiolo' }, { mdpId: 'mdp_nairobi' }, { mdpId: 'mdp_thika' }],
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

    it('a hub is a bottleneck: a stop the road map cannot go around, charging above the list figure (the owner’s D3, 2026-11-12)', () => {
      const isiolo = hubs.find((h) => h.mdpId === 'mdp_isiolo')! as { pricePerParcel?: number; passOnFee?: number };
      const thika = hubs.find((h) => h.mdpId === 'mdp_thika')! as { pricePerParcel?: number };
      try {
        // Isiolo joins Nairobi and Thika: without it they are apart. At twice the list figure it is a bottleneck.
        isiolo.pricePerParcel = 0.6;
        thika.pricePerParcel = 0.9; // dear, but at the end of its road: it is gone around, not through
        let v = density.view('sbg-ke');
        const b = v.suggestions.filter((s) => s.kind === 'bottleneck');
        expect(b).toHaveLength(1);
        expect(b[0]).toMatchObject({ id: 'bottleneck:mdp_isiolo', hubs: ['mdp_isiolo'], hubNames: ['Isiolo'], numbers: { ratio: 2, fee: 0.6, list: 0.3 }, place: { name: 'Isiolo' } });
        // Its pass-on fee counts as its sort fee does: the higher of the two.
        isiolo.pricePerParcel = 0.3;
        isiolo.passOnFee = 0.9;
        v = density.view('sbg-ke');
        expect(v.suggestions.find((s) => s.kind === 'bottleneck')?.numbers.ratio).toBe(3);
        // At the list figure: none.
        isiolo.passOnFee = 0.3;
        expect(density.view('sbg-ke').suggestions.some((s) => s.kind === 'bottleneck')).toBe(false);
        // A bottleneck is a row on the hub list: a place a second hub would give the network a choice.
        isiolo.pricePerParcel = 0.45;
        const rows = new HubListService(entities, { list: () => hubs as never, countryOf: (m: { country: string }) => m.country, isApproved: () => true } as never, density).view('sbg-ke').rows;
        expect(rows.find((r) => r.suggestionKind === 'bottleneck')).toMatchObject({ rowId: 'sug:bottleneck:mdp_isiolo', status: 'open', numbers: { ratio: 1.5 } });
      } finally {
        delete isiolo.pricePerParcel;
        delete isiolo.passOnFee;
        delete thika.pricePerParcel;
      }
    });

    it('the reach is the country’s own, logged', () => {
      // A wider reach for remote zones: Marsabit's shops are within it, and no hub is needed there.
      const wide = density.setReach('sbg-ke', { urban: 15, rural: 60, remote: 600 }, 'Amina');
      expect(wide.reach.remote).toBe(600);
      expect(wide.zones.find((z) => z.code === 'KE-MRS')!.coverage).toBe('near');
      expect(wide.suggestions.some((s) => s.kind === 'hub_needed')).toBe(false);
      expect(entities.changes('sbg-ke').find((c) => c.what === 'hubDensity')?.to).toBe('urban 15 km, rural 60 km, remote 600 km');
    });

    /** 2026-11-12 — the country's hub list (the owner's D2 and D7). */
    describe('the hub list', () => {
      const list = () => new HubListService(entities, mdpsStub as never, density);
      let mdpsStub: { list: () => Array<Record<string, unknown>>; countryOf: (m: { country: string }) => string; isApproved: (m: { mdpId: string }) => boolean };
      beforeEach(() => {
        mdpsStub = { list: () => hubs as never, countryOf: (m) => m.country, isApproved: () => true };
      });

      it('its hubs joined from the start; each place a hub is needed an open row; too close is not a row', () => {
        // A hub still waiting for its papers, signed up on its own (no invitation), is not yet a joined row.
        mdpsStub.list = () => [...hubs, { mdpId: 'mdp_pending', name: 'Pending Sort', location: { lat: -1.3, lng: 36.9 }, country: 'KE', vetting: { state: 'pending' } }] as never;
        mdpsStub.isApproved = (m) => m.mdpId !== 'mdp_pending';
        const v = list().view('sbg-ke');
        const joined = v.rows.filter((r) => r.status === 'joined').map((r) => r.mdpId).sort();
        expect(joined).toEqual(['mdp_isiolo', 'mdp_nairobi', 'mdp_thika']);
        const places = v.rows.filter((r) => r.kind === 'place').map((r) => r.suggestionKind).sort();
        expect(places).toEqual(['extra_hub', 'hub_needed', 'road_gap']);
        const need = v.rows.find((r) => r.suggestionKind === 'hub_needed')!;
        expect(need).toMatchObject({ rowId: 'sug:need:KE-MRS', source: 'optimiser', status: 'open', name: 'Marsabit', numbers: { shops: 2, parcels: 10 } });
        expect(v.counts).toEqual({ open: 3, negotiating: 0, rejected: 0, joined: 3 });
        // A hub of the network keeps its own record.
        expect(() => list().update('sbg-ke', 'hub:mdp_nairobi', { phone: '+254700000000' }, 'Amina')).toThrow(/keeps its own record/);
      });

      it('staff fill in a row and move it — never to joined; rejected takes a reason and comes back after 90 days; every change logged', () => {
        const l = list();
        const filled = l.update('sbg-ke', 'sug:need:KE-MRS', { name: 'Marsabit Hardware', phone: '+254711000111', email: 'owner@marsabit.example', address: 'Main road, by the market', status: 'negotiating' }, 'Amina');
        expect(filled.rows.find((r) => r.rowId === 'sug:need:KE-MRS')).toMatchObject({ name: 'Marsabit Hardware', phone: '+254711000111', status: 'negotiating', updatedBy: 'Amina' });
        expect(() => l.update('sbg-ke', 'sug:need:KE-MRS', { status: 'rejected' }, 'Amina')).toThrow(/Say why it is rejected/);
        const t0 = Date.now();
        const rejected = l.update('sbg-ke', 'sug:need:KE-MRS', { status: 'rejected', reason: 'Owner not interested' }, 'Amina', t0);
        expect(rejected.rows.find((r) => r.rowId === 'sug:need:KE-MRS')).toMatchObject({ status: 'rejected', reason: 'Owner not interested', rejectedBy: 'Amina' });
        expect(l.view('sbg-ke', t0 + 91 * 86_400_000).rows.find((r) => r.rowId === 'sug:need:KE-MRS')!.status).toBe('open');
        expect(entities.changes('sbg-ke').filter((c) => c.what === 'hubList').map((c) => c.to)).toEqual(expect.arrayContaining(['negotiating', 'rejected: Owner not interested']));
        expect(() => l.update('sbg-ke', 'sug:need:nowhere', { name: 'x' }, 'Amina')).toThrow(/no longer made/);
        // A place staff add themselves.
        const added = l.add('sbg-ke', { name: 'Laisamis crossroads', lat: 1.6, lng: 37.8 }, 'Amina');
        expect(added.rows.find((r) => r.name === 'Laisamis crossroads')).toMatchObject({ source: 'staff', status: 'open', location: { lat: 1.6, lng: 37.8 } });
      });

      it('an invitation from a row gets the row a code; a hub that signs up with it makes the row joined, with the date; a hub gone, open again', () => {
        const l = list();
        const invited = l.invite('sbg-ke', 'sug:need:KE-MRS', 'Amina');
        const code = invited.rows.find((r) => r.rowId === 'sug:need:KE-MRS')!.code!;
        expect(code).toMatch(/^[A-Z2-9]{6}$/);
        expect(l.invite('sbg-ke', 'sug:need:KE-MRS', 'Amina').rows.find((r) => r.rowId === 'sug:need:KE-MRS')!.code).toBe(code);
        // The hub signs up through it (not yet approved): the row is joined, linked to it.
        const newHub = { mdpId: 'mdp_marsabit', name: 'Marsabit Sort', location: { lat: 2.33, lng: 37.99 }, country: 'KE', inviteCode: code, createdAt: '2026-11-12T10:00:00.000Z', vetting: { state: 'draft' } };
        mdpsStub.list = () => [...hubs, newHub] as never;
        mdpsStub.isApproved = (m) => m.mdpId !== 'mdp_marsabit';
        const joined = l.view('sbg-ke').rows.find((r) => r.rowId === 'sug:need:KE-MRS')!;
        expect(joined).toMatchObject({ status: 'joined', mdpId: 'mdp_marsabit', hubName: 'Marsabit Sort', joinedAt: '2026-11-12T10:00:00.000Z' });
        // Joined is the system's: staff cannot move it.
        expect(() => l.update('sbg-ke', 'sug:need:KE-MRS', { status: 'open' }, 'Amina')).toThrow(/Joined is set by the system/);
        // Refused at its papers, or gone: open again.
        mdpsStub.list = () => [...hubs, { ...newHub, vetting: { state: 'draft', refusal: { reason: 'no papers' } } }] as never;
        expect(l.view('sbg-ke').rows.find((r) => r.rowId === 'sug:need:KE-MRS')!.status).toBe('open');
      });
    });
  });
});
