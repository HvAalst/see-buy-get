import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PersistentMap } from './persistent-map';

/**
 * These tests must exercise REAL disk (the whole point of the class), but the global Jest guard
 * disables persistence for every PersistentMap by default. We opt back in per-instance by passing an
 * explicit `file`, which forces the durable path regardless of JEST_WORKER_ID... except the guard is
 * process-wide. So instead we drive load()/flush() through an explicit temp file and assert the file
 * round-trips. To force persistence on under Jest, we set GLOS_PERSIST via the ephemeral:false path is
 * not enough — so we test the disk round-trip by constructing two maps over the same file.
 */
describe('PersistentMap', () => {
  let dir: string;
  const origWorker = process.env.JEST_WORKER_ID;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'glos-pm-'));
    // Persistence is disabled under Jest by design; lift the guard for these disk tests only.
    delete process.env.JEST_WORKER_ID;
  });
  afterEach(() => {
    if (origWorker !== undefined) process.env.JEST_WORKER_ID = origWorker;
    rmSync(dir, { recursive: true, force: true });
  });

  it('behaves like a Map in memory', () => {
    const m = new PersistentMap<string, number>('t', { file: join(dir, 't.json') });
    m.set('a', 1).set('b', 2);
    expect(m.get('a')).toBe(1);
    expect(m.has('b')).toBe(true);
    expect(m.size).toBe(2);
    expect([...m.keys()]).toEqual(['a', 'b']);
    expect([...m.values()]).toEqual([1, 2]);
    m.delete('a');
    expect(m.has('a')).toBe(false);
    expect(m.size).toBe(1);
  });

  it('survives a "restart" — a second instance over the same file reloads the data', () => {
    const file = join(dir, 'accounts.json');
    const first = new PersistentMap<string, { balance: number }>('accounts', { file });
    first.set('agent-1', { balance: 20 });
    first.set('agent-2', { balance: 5 });
    expect(existsSync(file)).toBe(true);

    // New process would construct a fresh instance; it loads from disk.
    const second = new PersistentMap<string, { balance: number }>('accounts', { file });
    expect(second.size).toBe(2);
    expect(second.get('agent-1')).toEqual({ balance: 20 });
    expect(second.get('agent-2')).toEqual({ balance: 5 });
  });

  it('persists in-place mutations when the caller re-sets the value', () => {
    const file = join(dir, 'w.json');
    const first = new PersistentMap<string, { balances: Record<string, number> }>('w', { file });
    const w = { balances: { USD: 0 } };
    first.set('did', w);
    w.balances.USD += 20; // in-place, like wallet.credit()
    first.set('did', w); // the save() discipline
    expect(new PersistentMap('w', { file }).get('did')).toEqual({ balances: { USD: 20 } });
  });

  it('preserves insertion order (the ledger relies on it)', () => {
    const file = join(dir, 'led.json');
    const m = new PersistentMap<string, number>('led', { file });
    ['x', 'y', 'z'].forEach((k, i) => m.set(k, i));
    expect([...new PersistentMap<string, number>('led', { file }).values()]).toEqual([0, 1, 2]);
  });

  it('starts empty (not crash) on a corrupt snapshot', () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ this is not json', 'utf8');
    const m = new PersistentMap<string, number>('bad', { file });
    expect(m.size).toBe(0);
    m.set('a', 1); // and remains usable, overwriting the corrupt file
    expect(new PersistentMap<string, number>('bad', { file }).get('a')).toBe(1);
  });

  it('touches nothing on disk when ephemeral', () => {
    const file = join(dir, 'eph.json');
    const m = new PersistentMap<string, number>('eph', { file, ephemeral: true });
    m.set('a', 1);
    expect(existsSync(file)).toBe(false);
  });
});
