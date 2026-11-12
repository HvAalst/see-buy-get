import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { HeuristicRouter } from './router';
import { RoadMapService } from './road-map.service';
import { defaultMinKm, pathBetween, proposeRoadPlan, stopOf, without, type Km } from './road-map';

/** Kenyan towns, as the road map's example (the plan "Hubs on the Road"): the Moyale road and the road west. */
const AT = {
  nairobi: { lat: -1.2864, lng: 36.8172 },
  thika: { lat: -1.0333, lng: 37.0693 },
  isiolo: { lat: 0.3546, lng: 37.5822 },
  marsabit: { lat: 2.3284, lng: 37.9899 },
  moyale: { lat: 3.5231, lng: 39.0553 },
  nakuru: { lat: -0.3031, lng: 36.08 },
  eldoret: { lat: 0.5143, lng: 35.2698 },
  kisumu: { lat: -0.0917, lng: 34.768 },
};
type Town = keyof typeof AT;
const router = new HeuristicRouter();
const km: Km = (a, b) => router.roadKm(AT[a as Town], AT[b as Town]);

describe('a road map of hubs (2026-11-12, the plan "Hubs on the Road")', () => {
  it('proposes stops and local-only hubs by the minimum distance, the larger floor the stop, and neighbours with no stop on the way', () => {
    const hubs = (Object.keys(AT) as Town[]).map((t) => ({ mdpId: t, bagPlaces: t === 'nairobi' ? 40 : t === 'thika' ? 10 : 20 }));
    const plan = proposeRoadPlan(hubs, km, defaultMinKm('KE'));
    // Thika, about 45 km from Nairobi, is local only: Nairobi has the larger floor.
    expect(plan.local).toEqual({ thika: 'nairobi' });
    expect(plan.stops).not.toContain('thika');
    const linked = (a: string, b: string) => plan.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    // The Moyale road: Nairobi – Isiolo – Marsabit – Moyale, each the next one's neighbour; never Nairobi straight to Moyale.
    expect(linked('nairobi', 'isiolo') && linked('isiolo', 'marsabit') && linked('marsabit', 'moyale')).toBe(true);
    expect(linked('nairobi', 'moyale')).toBe(false);
    expect(linked('nairobi', 'marsabit')).toBe(false);
    // West: Kisumu goes by Nakuru, so Nairobi and Kisumu are not neighbours.
    expect(linked('nairobi', 'nakuru')).toBe(true);
    expect(linked('nairobi', 'kisumu')).toBe(false);
    expect(pathBetween(plan, 'nairobi', 'moyale', km)).toEqual(['nairobi', 'isiolo', 'marsabit', 'moyale']);
    expect(stopOf(plan, 'thika')).toBe('nairobi');
    // The other countries' starting figures (D1).
    expect([defaultMinKm('ET'), defaultMinKm('UG'), defaultMinKm('NL'), defaultMinKm('TZ')]).toEqual([70, 50, 25, 50]);
  });

  it('a stop taken out (down, no longer approved): its neighbours become each other’s, its local hubs go to the nearest stop left', () => {
    const plan = proposeRoadPlan((Object.keys(AT) as Town[]).map((t) => ({ mdpId: t, bagPlaces: t === 'thika' ? 1 : 10 })), km, 60);
    const less = without(plan, new Set(['marsabit']), km);
    expect(less.stops).not.toContain('marsabit');
    expect(pathBetween(less, 'nairobi', 'moyale', km)).toEqual(['nairobi', 'isiolo', 'moyale']);
    // Of a too-close pair, the larger floor is the stop, whatever its name.
    expect(proposeRoadPlan([{ mdpId: 'aaa', bagPlaces: 5 }, { mdpId: 'zzz', bagPlaces: 50 }], () => 10, 60)).toMatchObject({ stops: ['zzz'], local: { aaa: 'zzz' } });
    // A stop taken out joins ITS neighbours — not merely the closest pair of what is left.
    const d: Record<string, number> = { 'A|B': 50, 'B|C': 50, 'C|D': 50, 'A|C': 100, 'A|D': 40, 'B|D': 100 };
    const kmLine: Km = (a, b) => (a === b ? 0 : d[[a, b].sort().join('|')]);
    const line = without({ stops: ['A', 'B', 'C', 'D'], local: {}, links: [['A', 'B'], ['B', 'C'], ['C', 'D']] }, new Set(['B']), kmLine);
    expect(line.links).toContainEqual(['A', 'C']);
    // A map in pieces is joined at its closest pair: Kisumu, left alone, is joined to the nearest of the others.
    const apart = without({ stops: ['nairobi', 'nakuru', 'kisumu'], local: {}, links: [['nairobi', 'nakuru']] }, new Set(['nowhere']), km);
    expect(apart.links).toContainEqual(['kisumu', 'nakuru']);
    expect(pathBetween(apart, 'nairobi', 'kisumu', km)).toEqual(['nairobi', 'nakuru', 'kisumu']);
    const noNairobi = without(plan, new Set(['nairobi']), km);
    expect(noNairobi.local.thika).not.toBe('nairobi');
    expect(noNairobi.stops).toContain(noNairobi.local.thika);
  });

  describe('the service: proposed, changed and confirmed by the country’s staff', () => {
    let entities: EntityService;
    let maps: RoadMapService;
    const down = new Set<string>();
    const approved = new Set<string>();
    const hubs = (Object.keys(AT) as Town[]).map((t) => ({ mdpId: `mdp_${t}`, name: t[0].toUpperCase() + t.slice(1), location: AT[t], bagPlaces: t === 'nairobi' ? 40 : t === 'thika' ? 10 : 20, country: 'KE' }));
    const mdps = {
      list: () => hubs,
      require: (id: string) => hubs.find((h) => h.mdpId === id)!,
      find: (id: string) => hubs.find((h) => h.mdpId === id),
      isApproved: (m: { mdpId: string }) => approved.has(m.mdpId),
      countryOf: (m: { country: string }) => m.country,
      isDown: (m: { mdpId: string }) => down.has(m.mdpId),
    };
    const id = (t: Town) => `mdp_${t}`;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
      }).compile();
      entities = moduleRef.get(EntityService);
      entities.seed();
      maps = new RoadMapService(entities, mdps as never, router);
      down.clear();
      approved.clear();
      for (const h of hubs) if (h.mdpId !== 'mdp_kisumu') approved.add(h.mdpId);
    });

    it('nothing is in force until staff confirm; a proposal, changed and confirmed, is in force — every change logged', () => {
      expect(maps.inForce('KE')).toBeUndefined();
      expect(maps.ofHub(id('isiolo'))).toEqual({ mdpId: id('isiolo'), inForce: false, routing: false, neighbours: [] });
      const v0 = maps.view('sbg-ke');
      expect(v0).toMatchObject({ country: 'KE', minKm: 60, minKmStart: 60, joined: [], left: [] });
      expect(v0.draft).toBeUndefined();
      expect(v0.proposal.local).toEqual([expect.objectContaining({ mdpId: id('thika'), via: id('nairobi'), viaName: 'Nairobi' })]);

      const proposed = maps.propose('sbg-ke', 'Amina');
      expect(proposed.draft!.stops.map((s) => s.mdpId)).not.toContain(id('thika'));
      // Thika made a stop: too close to Nairobi, and said so.
      const withThika = maps.setRole('sbg-ke', id('thika'), 'stop', 'Amina');
      expect(withThika.draft!.tooClose).toEqual([expect.objectContaining({ a: id('nairobi'), b: id('thika') })]);
      maps.setRole('sbg-ke', id('thika'), 'local', 'Amina');
      // Every road to Moyale taken away leaves the map in two pieces: it cannot be confirmed.
      const roads = maps.view('sbg-ke').draft!.stops.find((x) => x.mdpId === id('moyale'))!.neighbours.map((n) => n.mdpId);
      expect(roads.length).toBeGreaterThan(0);
      let cut = maps.view('sbg-ke');
      for (const n of roads) cut = maps.setLink('sbg-ke', id('moyale'), n, false, 'Amina');
      expect(cut.draft!.pieces).toBe(2);
      expect(() => maps.confirm('sbg-ke', 'Amina')).toThrow(/2 pieces/);
      // A taken road stays taken through a change of stops; given back, then confirmed.
      maps.setRole('sbg-ke', id('eldoret'), 'local', 'Amina');
      expect(maps.setRole('sbg-ke', id('eldoret'), 'stop', 'Amina').draft!.pieces).toBe(2);
      maps.setLink('sbg-ke', id('moyale'), id('marsabit'), true, 'Amina');
      const done = maps.confirm('sbg-ke', 'Njeri W.');
      expect(done.draft).toBeUndefined();
      expect(done.confirmed).toMatchObject({ confirmedBy: 'Njeri W.', pieces: 1 });
      expect(entities.changes('sbg-ke').filter((c) => c.what === 'roadMap').length).toBeGreaterThanOrEqual(7);
      expect(() => maps.setLink('sbg-ke', id('isiolo'), id('isiolo'), true, 'Amina')).toThrow(/two different stops/);

      // In force: each hub's place on the road.
      const isiolo = maps.ofHub(id('isiolo'));
      expect(isiolo).toMatchObject({ inForce: true, role: 'stop' });
      expect(isiolo.neighbours.map((n) => n.name)).toEqual(expect.arrayContaining(['Nairobi', 'Marsabit']));
      expect(maps.ofHub(id('thika'))).toMatchObject({ inForce: true, role: 'local', via: { mdpId: id('nairobi'), name: 'Nairobi' } });

      // Marsabit down: left out while it is — Isiolo and Moyale each other's next stop.
      down.add(id('marsabit'));
      const live = maps.inForce('KE')!;
      expect(pathBetween(live.plan, id('nairobi'), id('moyale'), live.km)).toEqual([id('nairobi'), id('isiolo'), id('moyale')]);
      down.clear();

      // A hub approved since: said as joined, carried by its nearest stop until staff confirm again.
      approved.add(id('kisumu'));
      expect(maps.view('sbg-ke').joined).toEqual([id('kisumu')]);
      expect(maps.inForce('KE')!.plan.local[id('kisumu')]).toBeTruthy();
      // One no longer approved: said as left, out of the map in force.
      approved.delete(id('marsabit'));
      expect(maps.view('sbg-ke').left).toEqual([id('marsabit')]);
      expect(maps.inForce('KE')!.plan.stops).not.toContain(id('marsabit'));
    });

    it('parcels go along it only once a price card is in force (D3): the path between two hubs, and the next stop', () => {
      let card = false;
      const priceCards = { inForceFor: (c: string) => (card && c === 'KE' ? { entityId: 'sbg-ke' } : undefined) };
      const routed = new RoadMapService(entities, { ...mdps, find: mdps.find } as never, router, priceCards as never);
      routed.propose('sbg-ke', 'Amina');
      routed.confirm('sbg-ke', 'Amina');
      expect(routed.routing('KE')).toBeUndefined();
      expect(routed.pathFor(id('nairobi'), id('moyale'))).toBeUndefined();
      expect(routed.ofHub(id('isiolo'))).toMatchObject({ inForce: true, routing: false, role: 'stop' });
      card = true;
      expect(routed.pathFor(id('nairobi'), id('moyale'))).toEqual([id('nairobi'), id('isiolo'), id('marsabit'), id('moyale')]);
      expect(routed.nextToward(id('nairobi'), id('moyale'))).toBe(id('isiolo'));
      expect(routed.nextToward(id('marsabit'), id('moyale'))).toBe(id('moyale'));
      expect(routed.nextToward(id('moyale'), id('moyale'))).toBeUndefined();
      // A local hub goes by its stop: Thika to Moyale passes Nairobi first.
      expect(routed.pathFor(id('thika'), id('moyale'))!.slice(0, 2)).toEqual([id('thika'), id('nairobi')]);
      expect(routed.ofHub(id('isiolo'))).toMatchObject({ routing: true });
      // Marsabit down: around it.
      down.add(id('marsabit'));
      expect(routed.pathFor(id('nairobi'), id('moyale'))).toEqual([id('nairobi'), id('isiolo'), id('moyale')]);
    });

    it('the minimum distance is the country’s own, logged; a company that runs no country has no road map', () => {
      const v = maps.setMinKm('sbg-ke', 30, 'Amina');
      expect(v.minKm).toBe(30);
      expect(v.proposal.local).toEqual([]);
      expect(entities.changes('sbg-ke').find((c) => c.what === 'roadMap')).toMatchObject({ from: 'stops at least 60 km apart', to: 'stops at least 30 km apart' });
      const network = entities.list().find((e) => e.kind !== 'sister');
      if (network) expect(() => maps.view(network.entityId)).toThrow(/does not run a country/);
      expect(() => maps.confirm('sbg-ke', 'Amina')).toThrow(/Make a proposal first/);
    });
  });
});
