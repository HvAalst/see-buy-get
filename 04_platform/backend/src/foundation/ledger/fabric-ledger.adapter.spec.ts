import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FabricLedgerAdapter } from './fabric-ledger.adapter';

/**
 * EVIDENCE THAT LASTS (the user, 2026-10-18): the anchor behind every fingerprint is kept, survives a restart, and is
 * chained to the one before it — so an anchor changed or taken out is found, and where.
 */
describe('the ledger’s anchors', () => {
  it('chains each anchor to the one before, and finds the first one that has been changed or taken out', () => {
    const ledger = new FabricLedgerAdapter();
    const ids = ['a', 'b', 'c', 'd'].map((h) => ledger.append(`hash-${h}`));
    expect(ids.map((r) => r.blockHeight)).toEqual([1, 2, 3, 4]);
    expect(ledger.append('hash-b')).toEqual(ids[1]); // the same hash is the same anchor
    expect(ledger.check()).toMatchObject({ anchors: 4, whole: true });

    const store = (ledger as unknown as { store: Map<string, { txId: string; hash: string; prev: string }> }).store;
    // Changed: what anchor 2 holds no longer matches its id.
    const two = store.get('hash-b')!;
    store.set('hash-b', { ...two, hash: 'hash-B' });
    expect(ledger.check()).toMatchObject({ whole: false, brokenAt: 2, reason: 'its id does not match what it holds' });
    store.set('hash-b', two);
    // Taken out: block 3 is gone, and the chain says so.
    store.delete('hash-c');
    expect(ledger.check()).toMatchObject({ whole: false, brokenAt: 4, reason: 'block 3 is missing' });
  });

  it('keeps every anchor across a restart, and carries on the chain where it stopped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'glos-ledger-'));
    const before = { worker: process.env.JEST_WORKER_ID, data: process.env.GLOS_DATA_DIR };
    // Persistence is off under Jest by design; this test is about persistence. The store reads its folder on load.
    delete process.env.JEST_WORKER_ID;
    process.env.GLOS_DATA_DIR = dir;
    try {
      let first: { txId: string; blockHeight: number } | undefined;
      jest.isolateModules(() => {
        const { FabricLedgerAdapter: Fresh } = jest.requireActual('./fabric-ledger.adapter') as typeof import('./fabric-ledger.adapter');
        const running = new Fresh();
        first = running.append('hash-one');
        running.append('hash-two');
      });
      jest.isolateModules(() => {
        const { FabricLedgerAdapter: Fresh } = jest.requireActual('./fabric-ledger.adapter') as typeof import('./fabric-ledger.adapter');
        const restarted = new Fresh();
        expect(restarted.get('hash-one')).toEqual(first);
        expect(restarted.append('hash-three').blockHeight).toBe(3);
        expect(restarted.check()).toMatchObject({ anchors: 3, whole: true });
      });
    } finally {
      if (before.worker !== undefined) process.env.JEST_WORKER_ID = before.worker;
      if (before.data === undefined) delete process.env.GLOS_DATA_DIR;
      else process.env.GLOS_DATA_DIR = before.data;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
