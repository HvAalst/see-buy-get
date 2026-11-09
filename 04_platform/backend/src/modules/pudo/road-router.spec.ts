import { HeuristicRouter } from './router';
import { MAX_SNAP_M, type OsrmRoadMatrix } from './road-matrix';
import { RoadRouter, RoadTableWarmer } from './road-router';
import type { AgentService } from './agent.service';
import type { MdpService } from './mdp.service';

/**
 * DISTANCES BY ROAD BETWEEN THE NETWORK'S OWN PLACES (2026-11-09 — zone pricing step 4, and the Netherlands matched beside
 * Kenya). What is pinned: a pair of the network's places is measured by road, each way on its own; anything else is the
 * estimate it always was; arrival times and detours follow the same distances; the table is measured from every shop and
 * hub, kept when the routing server fails, and never asked for where no routing server is set.
 */
describe('distances by road between the network’s places', () => {
  const estimate = new HeuristicRouter();
  // Two shops in Nairobi, a hub in Thika, a shop in Amsterdam — the network spans countries; the map, both.
  const westlands = { lat: -1.2683, lng: 36.8111 };
  const cbd = { lat: -1.2864, lng: 36.8172 };
  const thika = { lat: -1.0388, lng: 37.0834 };
  const amsterdam = { lat: 52.3676, lng: 4.9041 };
  const driver = { lat: -1.3, lng: 36.9 };

  /** A table of the three Kenyan places: km i→j = 10·(i+1) + j, not the same both ways; no road from CBD to Thika. */
  function loaded() {
    const router = new RoadRouter(estimate);
    const places = [westlands, cbd, thika];
    const km = new Float64Array(9).map((_, k) => {
      const i = Math.floor(k / 3);
      const j = k % 3;
      return i === j ? 0 : 10 * (i + 1) + j;
    });
    km[1 * 3 + 2] = Number.NaN;
    router.load(places, km, '2026-11-09T06:00:00.000Z');
    return router;
  }

  it('measures a pair of the network’s places by road, each way on its own; anything else is the estimate', () => {
    const router = loaded();
    expect(router.roadKm(westlands, cbd)).toBe(11);
    expect(router.roadKm(cbd, westlands)).toBe(20);
    expect(router.roadKm(thika, westlands)).toBe(30);
    // No road known between them: that pair alone is estimated.
    expect(router.roadKm(cbd, thika)).toBe(estimate.roadKm(cbd, thika));
    // A driver's position, a place the table does not hold: the estimate.
    expect(router.roadKm(driver, cbd)).toBe(estimate.roadKm(driver, cbd));
    expect(router.roadKm(amsterdam, westlands)).toBe(estimate.roadKm(amsterdam, westlands));
    expect(router.state()).toEqual({ places: 3, at: '2026-11-09T06:00:00.000Z' });
  });

  it('times a leg and a detour on the same distances', () => {
    const router = loaded();
    expect(router.etaMinutes(westlands, cbd, 30)).toBe(22);
    // Through Thika on the way from Westlands to CBD: 12 + 31 − 11 km out of the way.
    expect(router.detourKm(westlands, thika, cbd)).toBe(32);
  });

  it('is the estimate everywhere before anything was measured', () => {
    const router = new RoadRouter(estimate);
    expect(router.roadKm(westlands, cbd)).toBe(estimate.roadKm(westlands, cbd));
    expect(router.etaMinutes(westlands, thika, 40)).toBe(estimate.etaMinutes(westlands, thika, 40));
    expect(router.detourKm(westlands, thika, cbd)).toBe(estimate.detourKm(westlands, thika, cbd));
    expect(router.state()).toBeUndefined();
    expect(() => router.load([westlands, cbd], new Float64Array(3), 'x')).toThrow(/4 cells/);
  });

  describe('kept fresh', () => {
    const shops = [{ location: westlands }, { location: cbd }, { location: amsterdam }, { location: { lat: Number.NaN, lng: 1 } }];
    const hubs = [{ location: thika }, { location: westlands }];
    const agents = { list: () => shops } as unknown as AgentService;
    const mdps = { list: () => hubs } as unknown as MdpService;
    function server(answer: (points: unknown[]) => { km: Array<Array<number | null>> } | { why: string }, configured = true) {
      const asked: Array<{ points: unknown[]; snap: number | undefined }> = [];
      const roads = {
        configured: () => configured,
        allPairs: async (points: unknown[], snap?: number) => (asked.push({ points, snap }), answer(points)),
      } as unknown as OsrmRoadMatrix;
      return { roads, asked };
    }

    it('measures every shop and hub against every other — each place once, at the reach of a shop’s pin', async () => {
      const router = new RoadRouter(estimate);
      // km i→j = 100·i + j (and a few metres); no road known from CBD (1) to Thika (3).
      const { roads, asked } = server((points) => ({ km: points.map((_, i) => points.map((_x, j) => (i === j ? 0 : i === 1 && j === 3 ? null : 100 * i + j + 0.04))) }));
      await new RoadTableWarmer(roads, router, agents, mdps).refresh(Date.parse('2026-11-09T06:00:00Z'));
      // Westlands (a shop and a hub's pin both), CBD, Amsterdam, Thika: four places; a pin that is no place left out.
      expect(asked).toHaveLength(1);
      expect(asked[0].points).toEqual([westlands, cbd, amsterdam, thika]);
      expect(asked[0].snap).toBe(MAX_SNAP_M);
      expect(router.state()).toEqual({ places: 4, at: '2026-11-09T06:00:00.000Z' });
      // Kept to a tenth of a km.
      expect(router.roadKm(thika, cbd)).toBe(301);
      expect(router.roadKm(amsterdam, westlands)).toBe(200);
      // No road known: that pair alone is estimated — never read as no distance at all.
      expect(router.roadKm(cbd, thika)).toBe(estimate.roadKm(cbd, thika));
    });

    it('keeps the table it had when the routing server does not answer — and asks nothing where none is set', async () => {
      const router = loaded();
      const failing = server(() => ({ why: 'the routing server did not answer in time' }));
      await new RoadTableWarmer(failing.roads, router, agents, mdps).refresh();
      expect(router.roadKm(westlands, cbd)).toBe(11);
      expect(router.state()?.places).toBe(3);
      const none = server(() => ({ km: [] }), false);
      const warmer = new RoadTableWarmer(none.roads, router, agents, mdps);
      warmer.onApplicationBootstrap();
      await warmer.refresh();
      expect(none.asked).toEqual([]);
      warmer.onModuleDestroy();
    });

    it('measures once at a time: a second ask joins the first', async () => {
      const router = new RoadRouter(estimate);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const asked: unknown[] = [];
      const roads = { configured: () => true, allPairs: async (points: unknown[]) => (asked.push(points), await gate, { km: points.map(() => points.map(() => 1)) }) } as unknown as OsrmRoadMatrix;
      const warmer = new RoadTableWarmer(roads, router, agents, mdps);
      const a = warmer.refresh();
      const b = warmer.refresh();
      release();
      await Promise.all([a, b]);
      expect(asked).toHaveLength(1);
    });
  });
});
