import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { PersistentMap, flushPersistentMaps } from './persistent-map';
import { SyncPostgres } from './sync-postgres';

/**
 * THE POSTGRES ENGINE, against a real Postgres. Run where one is given (CI starts one; on a laptop:
 *   docker run -d -p 127.0.0.1:55432:5432 -e POSTGRES_USER=glos -e POSTGRES_PASSWORD=glos-test -e POSTGRES_DB=glos postgres:16-alpine
 *   GLOS_TEST_DATABASE_URL=postgres://glos:glos-test@127.0.0.1:55432/glos npx jest persistent-map.postgres
 * ) and skipped where none is: the rest of the suite never needs a database.
 */
const URL = process.env.GLOS_TEST_DATABASE_URL;
const maybe = URL ? describe : describe.skip;

maybe('PersistentMap on Postgres', () => {
  const origWorker = process.env.JEST_WORKER_ID;
  let dir: string;
  let db: SyncPostgres;
  /** A collection name of this test's own, so runs and tests never see each other's rows. */
  const fresh = (what: string) => `test-${what}-${randomBytes(4).toString('hex')}`;
  const open = <V>(name: string, file?: string) => new PersistentMap<string, V>(name, { database: URL, file: file ?? join(dir, `${name}.json`) });
  const rowsOf = (name: string) => db.query<{ key: string; value: string }>('SELECT key, value::text AS value FROM glos_store WHERE collection = $1 ORDER BY seq', [name]);

  beforeAll(() => {
    db = new SyncPostgres(URL!);
  });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'glos-pg-'));
    // Persistence is off under Jest by design; these tests are about persistence.
    delete process.env.JEST_WORKER_ID;
  });
  afterEach(() => {
    if (origWorker !== undefined) process.env.JEST_WORKER_ID = origWorker;
    rmSync(dir, { recursive: true, force: true });
  });
  afterAll(() => {
    db.query("DELETE FROM glos_store WHERE collection LIKE 'test-%'");
  });

  it('keeps a write before set() returns, and a second start reads it back', () => {
    const name = fresh('accounts');
    const first = open<{ balance: number }>(name);
    first.set('agent-1', { balance: 20 }).set('agent-2', { balance: 5 });
    // In Postgres already — no flush, no stop.
    expect(rowsOf(name).map((r) => [r.key, JSON.parse(r.value)])).toEqual([
      ['agent-1', { balance: 20 }],
      ['agent-2', { balance: 5 }],
    ]);
    const second = open<{ balance: number }>(name);
    expect([...second.entries()]).toEqual([...first.entries()]);
    first.stop();
    second.stop();
  });

  it('reads back in the order a Map keeps: first written first, a re-set keeps its place, a deleted one comes back last', () => {
    const name = fresh('ledger');
    const m = open<number>(name);
    ['x', 'y', 'z'].forEach((k, i) => m.set(k, i));
    m.set('x', 10);
    m.delete('y');
    m.set('y', 11);
    expect([...open<number>(name).entries()]).toEqual([...m.entries()]);
    expect([...m.keys()]).toEqual(['x', 'z', 'y']);
    m.stop();
  });

  it('reads a record back as the exact text it was written — key order and all, because signed documents are hashed', () => {
    const name = fresh('notes');
    const value = { z: 1, a: { y: [3, 2, 1], b: 'x' }, n: 0.1 + 0.2 };
    const m = open<typeof value>(name);
    m.set('note-1', value);
    expect(rowsOf(name)[0].value).toBe(JSON.stringify(value));
    expect(JSON.stringify(open<typeof value>(name).get('note-1'))).toBe(JSON.stringify(value));
    m.stop();
  });

  it('writes a value changed in place on the backstop, and when the server is told to stop', () => {
    const name = fresh('parcels');
    const m = open<{ status: string }>(name);
    m.set('p1', { status: 'At_PUDO' });
    (m.get('p1') as { status: string }).status = 'On_Bus'; // in place, no set()
    expect(JSON.parse(rowsOf(name)[0].value)).toEqual({ status: 'At_PUDO' });
    flushPersistentMaps();
    expect(JSON.parse(rowsOf(name)[0].value)).toEqual({ status: 'On_Bus' });
    m.stop();
    // Stopped, it is left alone.
    (m.get('p1') as { status: string }).status = 'Delivered';
    flushPersistentMaps();
    expect(JSON.parse(rowsOf(name)[0].value)).toEqual({ status: 'On_Bus' });
  });

  it('writes only what changed', () => {
    const name = fresh('many');
    const m = open<{ n: number }>(name);
    m.set('a', { n: 1 }).set('b', { n: 2 });
    const before = db.query<{ key: string; seq: string; updated_at: string }>('SELECT key, seq::text, updated_at::text FROM glos_store WHERE collection = $1 ORDER BY seq', [name]);
    (m.get('b') as { n: number }).n = 3;
    m.touch();
    const after = db.query<{ key: string; seq: string; updated_at: string }>('SELECT key, seq::text, updated_at::text FROM glos_store WHERE collection = $1 ORDER BY seq', [name]);
    expect(after[0]).toEqual(before[0]); // a: not written again
    expect(after[1].updated_at).not.toBe(before[1].updated_at); // b: written
    m.stop();
  });

  it('keeps maps apart, removes what is deleted or cleared, and writes nothing for an ephemeral one', () => {
    const one = fresh('one');
    const two = fresh('two');
    const a = open<number>(one);
    const b = open<number>(two);
    a.set('k', 1);
    b.set('k', 2);
    expect(open<number>(one).get('k')).toBe(1);
    expect(open<number>(two).get('k')).toBe(2);
    a.delete('k');
    expect(rowsOf(one)).toEqual([]);
    b.set('l', 3);
    b.clear();
    expect(rowsOf(two)).toEqual([]);
    const eph = fresh('eph');
    new PersistentMap<string, number>(eph, { database: URL, ephemeral: true }).set('k', 1);
    expect(rowsOf(eph)).toEqual([]);
    a.stop();
    b.stop();
  });

  it('moves a map’s file in once, in order, and keeps the file under a name that says so', () => {
    const name = fresh('moved');
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify([['w1', { balance: 7 }], ['w2', { balance: 9 }]]), 'utf8');
    const m = open<{ balance: number }>(name, file);
    expect([...m.entries()]).toEqual([['w1', { balance: 7 }], ['w2', { balance: 9 }]]);
    expect(rowsOf(name).map((r) => r.key)).toEqual(['w1', 'w2']);
    expect(existsSync(file)).toBe(false);
    expect(JSON.parse(readFileSync(`${file}.moved-to-postgres`, 'utf8'))).toHaveLength(2);
    // A file that turns up again later is not copied over what Postgres holds.
    writeFileSync(file, JSON.stringify([['w1', { balance: 0 }]]), 'utf8');
    expect(open<{ balance: number }>(name, file).get('w1')).toEqual({ balance: 7 });
    m.stop();
  });

  it('refuses to start when Postgres cannot be reached, rather than start empty', () => {
    expect(() => new PersistentMap('anything', { database: 'postgres://glos:wrong@127.0.0.1:1/glos' })).toThrow(/does not start on an empty store/);
  });
});
