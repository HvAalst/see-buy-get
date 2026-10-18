import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { AgentService } from './agent.service';
import type { ParcelService } from './parcel.service';

/**
 * RATINGS SURVIVE A RESTART. Each rating was kept in memory alone while its average was written to the core: a deploy
 * wiped them, reset every count, and lifted the bar that keeps a driver rated below the floor off freight. Persistence
 * is off under Jest by design, so the guard is lifted and the data directory pointed at a temp folder for this test
 * alone; the module is loaded fresh so it reads that directory (the shelf's restart test does the same).
 */
describe('ratings, across a restart', () => {
  const origWorker = process.env.JEST_WORKER_ID;
  const origDir = process.env.GLOS_DATA_DIR;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'glos-ratings-'));
    process.env.GLOS_DATA_DIR = dir;
    delete process.env.JEST_WORKER_ID;
  });
  afterEach(() => {
    if (origWorker !== undefined) process.env.JEST_WORKER_ID = origWorker;
    if (origDir === undefined) delete process.env.GLOS_DATA_DIR;
    else process.env.GLOS_DATA_DIR = origDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every shop and driver rating, so the averages, the counts and the freight bar are the same after it', () => {
    jest.isolateModules(() => {
      // Loaded inside the isolated registry, so it reads the temp directory set above.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const { RatingService: Ratings, belowFloor } = require('./rating.service') as typeof import('./rating.service');
      const parcels = { get: (parcelId: string) => ({ parcelId, status: 'Delivered', originAgentDid: 'did:glos:shop' }) } as unknown as ParcelService;
      const core = { updateReputation: () => undefined } as unknown as OperationalStore;
      const events = { publish: () => Promise.resolve() } as unknown as EventBus;
      const make = () => new Ratings(parcels, {} as AgentService, core, events);

      const before = make();
      before.rate({ parcelId: 'P-1', stars: 5, raterMobile: '+254700000001' });
      before.rate({ parcelId: 'P-2', stars: 4, raterMobile: '+254700000002' });
      before.rate({ parcelId: 'P-2', stars: 3, raterMobile: '+254700000002' }); // the same parcel again: one vote, revised
      before.rateDriver({ driverDid: 'did:glos:drv', byAgentDid: 'did:glos:shop-a', stars: 1 });
      before.rateDriver({ driverDid: 'did:glos:drv', byAgentDid: 'did:glos:shop-b', stars: 2 });
      before.rateFreight({ freightId: 'frt_1', driverDid: 'did:glos:drv', byDid: 'did:glos:biz', stars: 2 });
      expect(before.agentRating('did:glos:shop')).toEqual({ agentDid: 'did:glos:shop', average: 4, count: 2, isNew: true });
      expect(belowFloor(before.driverRating('did:glos:drv'))).toBe(true);

      // The server starts again: nothing carried over in memory.
      const after = make();
      expect(after.agentRating('did:glos:shop')).toEqual({ agentDid: 'did:glos:shop', average: 4, count: 2, isNew: true });
      expect(after.driverRating('did:glos:drv')).toEqual({ agentDid: 'did:glos:drv', average: 1.67, count: 3, isNew: false });
      // The driver rated below the floor is still kept off freight.
      expect(belowFloor(after.driverRating('did:glos:drv'))).toBe(true);
      expect(after.fleetRating('did:glos:fleet', ['did:glos:drv']).count).toBe(3);
      expect(after.list()).toHaveLength(2);
      expect(after.driverRatingsFor('did:glos:drv')).toHaveLength(3);
      // A rating revised after the restart is still one vote.
      after.rateDriver({ driverDid: 'did:glos:drv', byAgentDid: 'did:glos:shop-a', stars: 5 });
      expect(make().driverRating('did:glos:drv')).toEqual({ agentDid: 'did:glos:drv', average: 3, count: 3, isNew: false });
    });
  });
});
