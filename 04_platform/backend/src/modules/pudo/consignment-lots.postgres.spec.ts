import { ConsignmentService } from './consignment.service';
import { SyncPostgres } from '../../foundation/store/sync-postgres';
import type { DispatchService } from './dispatch.service';

/**
 * A COOPERATIVE'S LOTS SURVIVE A RESTART. They were held in memory alone: a deploy emptied every open lot, and the
 * kilos its members had brought in with it. Run on a real store (Postgres, as a server runs), where one is given —
 * see persistent-map.postgres.spec.ts.
 */
const URL = process.env.GLOS_TEST_DATABASE_URL;
const maybe = URL ? describe : describe.skip;

maybe('consolidation lots, across a restart', () => {
  const env = { worker: process.env.JEST_WORKER_ID, url: process.env.DATABASE_URL };
  let db: SyncPostgres;
  const clear = () => db.query("DELETE FROM glos_store WHERE collection = 'consignment-lots'");

  beforeAll(() => {
    db = new SyncPostgres(URL!);
  });
  beforeEach(() => {
    delete process.env.JEST_WORKER_ID;
    process.env.DATABASE_URL = URL;
    clear();
  });
  afterEach(() => {
    if (env.worker !== undefined) process.env.JEST_WORKER_ID = env.worker;
    if (env.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = env.url;
    clear();
  });

  it('keeps the lots and their deposits, finds them by code again, and never gives a number twice', () => {
    const lot = (svc: ConsignmentService, dest: string) => svc.open({ ownerDid: 'did:glos:coop', natureCode: 'FOD', pickupLabel: 'Coop store', pickupLocation: { lat: -1.2, lng: 36.8 }, destLabel: dest, targetKg: 10_000 });
    const before = new ConsignmentService({} as DispatchService);
    const first = lot(before, 'Merkato');
    const second = lot(before, 'Gikomba');
    before.deposit(first.code, 'Member 12', 400);

    // The server starts again.
    const after = new ConsignmentService({} as DispatchService);
    expect(after.list({ ownerDid: 'did:glos:coop' }).map((l) => [l.code, l.weightKg])).toEqual(
      expect.arrayContaining([
        [first.code, 400],
        [second.code, 0],
      ]),
    );
    expect(after.deposit(first.code, 'Member 30', 100).weightKg).toBe(500);
    // The next lot carries on from the highest number kept.
    expect(lot(after, 'Kisumu').code).toBe('LOT-003');
  });
});
