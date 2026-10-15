import { Logger } from '@nestjs/common';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { SyncPostgres, type SqlStatement } from './sync-postgres';

/**
 * PersistentMap<K, V> — a Map that survives a process restart.
 *
 * Every record the network must not lose — sign-ins, wallets and prepaid money, parcels, loads, fleets, the books — is
 * kept in one of these, with the surface of a Map (get/set/delete/has/values/keys/entries/size/forEach + iteration),
 * so call sites do not change whatever keeps them. A `new Map()` is still right for what may be lost on a restart:
 * counters of wrong tries, offers that expire in minutes, indexes rebuilt from a PersistentMap.
 *
 * TWO ENGINES, chosen by the environment (`storeEngine`):
 *
 *  - POSTGRES, where DATABASE_URL is set — what a server runs. One table, `glos_store`: a row per record, keyed by
 *    the map's name and the record's key, its value kept as the exact JSON text it was written as (type `json`, not
 *    `jsonb`: jsonb reorders an object's keys, and a document hashed when it was signed must read back byte for byte).
 *    A write is kept before `set()` returns (see SyncPostgres). Only what changed is written: `set` writes its one row,
 *    and the backstop below compares each record with the text last written. Rows come back in the order they were
 *    first written (`seq`), because a Map keeps insertion order and the ledger relies on it. If Postgres cannot be
 *    reached when the server starts, the server does not start: starting on an empty store would be worse.
 *
 *  - FILES, everywhere else — a laptop, the demo. Pure JSON, atomic write-through: every mutation writes the whole map
 *    to `<file>.tmp` and renames it onto `<file>`, so a crash mid-write leaves the previous good file.
 *
 * MOVING FROM FILES TO POSTGRES needs nobody to do anything: a map whose rows are empty in Postgres, and whose file
 * exists, is copied in once when it starts, and the file renamed `<name>.json.moved-to-postgres` — kept, not deleted,
 * and never copied twice.
 *
 * Reads are always served from memory; the engine is touched only when a map starts and when it changes.
 */

/** Where the snapshot files live. Kept out of git (see .gitignore `data/`). */
export const DATA_DIR = process.env.GLOS_DATA_DIR || join(process.cwd(), 'data');

/**
 * On by default; off when GLOS_PERSIST=off, and ALWAYS off under Jest (JEST_WORKER_ID is set in every
 * worker). The Jest guard is not optional: a snapshot store that wrote files during tests would leak
 * state between runs — a parcel set in one test would reload in the next — so persistence is disabled
 * for the whole test process automatically, with no per-suite setup.
 *
 * Evaluated per construction (not a frozen module const) so a test can toggle the env before building
 * an instance. The disk round-trip tests do exactly this.
 */
export function persistenceEnabled(): boolean {
  return (process.env.GLOS_PERSIST ?? 'on').toLowerCase() !== 'off' && process.env.JEST_WORKER_ID === undefined;
}

/** Which engine keeps the maps: Postgres where DATABASE_URL is set, the JSON files otherwise. */
export function storeEngine(): 'postgres' | 'files' {
  return process.env.DATABASE_URL ? 'postgres' : 'files';
}

export interface PersistentMapOptions {
  /** Absolute path override for the snapshot file. Defaults to `<DATA_DIR>/<name>.json`. */
  file?: string;
  /** Disable persistence entirely for this instance regardless of the global flag (used by unit tests). */
  ephemeral?: boolean;
  /** A Postgres connection string for this instance instead of DATABASE_URL (used by the store's own tests). */
  database?: string;
}

/**
 * Backstop flush interval. set()/delete() persist immediately, but an in-place mutation of a stored
 * value (`map.get(id).status = 'X'`) reaches the cache without calling any method — many domain
 * services mutate that way. This periodic, change-detected flush catches those within a couple of
 * seconds without every call site having to re-set. Money paths still re-set explicitly for instant
 * durability; this is the safety net for everything else.
 */
const FLUSH_MS = Number(process.env.GLOS_FLUSH_MS ?? 2000);

/** Every map that persists, so that a stop can write all of them: see flushPersistentMaps. */
const LIVE = new Set<{ touch(): void }>();

/**
 * Write every map's pending change NOW — what the server does when it is told to stop.
 *
 * A value changed in place reaches disk only on the backstop above, so a process that simply died took up to
 * FLUSH_MS of such changes with it. On a laptop that is a restart nobody notices; on a server it is every deploy
 * and every reboot, each one stopping the process on purpose. `main.ts` calls this on SIGTERM, after the last
 * request has been answered.
 */
export function flushPersistentMaps(): void {
  for (const map of LIVE) map.touch();
}

/* ------------------------------------------------------------------------------------------ Postgres -- */

/** The one table. Created when the first map starts, if it is not there. */
const SCHEMA: SqlStatement[] = [
  {
    sql: `CREATE TABLE IF NOT EXISTS glos_store (
      collection text NOT NULL,
      key text NOT NULL,
      value json NOT NULL,
      seq bigserial NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (collection, key)
    )`,
  },
  { sql: 'CREATE INDEX IF NOT EXISTS glos_store_in_order ON glos_store (collection, seq)' },
];

/** One connection per database a process uses — in practice one, DATABASE_URL's. */
const DATABASES = new Map<string, SyncPostgres>();

function databaseAt(url: string): SyncPostgres {
  let db = DATABASES.get(url);
  if (!db) {
    db = new SyncPostgres(url);
    try {
      db.transaction(SCHEMA);
    } catch (err) {
      throw new Error(`DATABASE_URL is set and Postgres could not be reached or prepared (${(err as Error).message}). The server does not start on an empty store.`);
    }
    DATABASES.set(url, db);
  }
  return db;
}

const UPSERT = 'INSERT INTO glos_store (collection, key, value) VALUES ($1, $2, $3::json) ON CONFLICT (collection, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()';
const REMOVE = 'DELETE FROM glos_store WHERE collection = $1 AND key = $2';

/* ------------------------------------------------------------------------------------------------ map -- */

export class PersistentMap<K extends string, V> implements Map<K, V> {
  private readonly logger = new Logger(PersistentMap.name);
  private readonly cache = new Map<K, V>();
  private readonly file: string;
  private readonly persist: boolean;
  /** Postgres, when that is the engine. */
  private readonly db?: SyncPostgres;
  /** Postgres: each record's text as last written — what tells a changed record from an unchanged one. */
  private readonly written = new Map<K, string>();
  /** Files: the whole map's text as last written. */
  private lastSerialized = '';
  private timer?: NodeJS.Timeout;

  /** @param name stable identifier → the snapshot filename, and the rows' collection. Changing it orphans the old ones. */
  constructor(
    private readonly name: string,
    options: PersistentMapOptions = {},
  ) {
    this.file = options.file || join(DATA_DIR, `${name}.json`);
    this.persist = persistenceEnabled() && !options.ephemeral;
    if (this.persist) {
      const url = options.database ?? (storeEngine() === 'postgres' ? process.env.DATABASE_URL : undefined);
      if (url) {
        this.db = databaseAt(url);
        this.loadRows();
      } else {
        this.load();
        this.lastSerialized = this.serialize(); // loaded state is already on disk — don't rewrite it
      }
      // Backstop for in-place mutations. unref() so this timer never holds the process open.
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      this.timer.unref?.();
      LIVE.add(this);
    }
  }

  // --- Map surface ---

  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  set(key: K, value: V): this {
    this.cache.set(key, value);
    if (this.db) this.writeRows([key], []);
    else this.flush();
    return this;
  }

  delete(key: K): boolean {
    const existed = this.cache.delete(key);
    if (existed) {
      if (this.db) this.writeRows([], [key]);
      else this.flush();
    }
    return existed;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    const gone = [...this.cache.keys()];
    this.cache.clear();
    if (this.db) this.writeRows([], gone);
    else this.flush();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): MapIterator<K> {
    return this.cache.keys();
  }

  values(): MapIterator<V> {
    return this.cache.values();
  }

  entries(): MapIterator<[K, V]> {
    return this.cache.entries();
  }

  forEach(callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    this.cache.forEach((v, k) => callback.call(thisArg, v, k, this));
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.cache[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return 'PersistentMap';
  }

  /**
   * Persist a value mutated IN PLACE. `map.get(x).field = y` bypasses set() and never reaches disk;
   * call this after such a mutation (or re-set the value). Callers that already re-set do not need it.
   */
  touch(): void {
    this.flush();
  }

  /** Stop the backstop timer and write any pending change. For tests and graceful shutdown. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    LIVE.delete(this);
    this.flush();
  }

  private flush(): void {
    if (!this.persist) return;
    if (this.db) return this.flushRows();
    const serialized = this.serialize();
    if (serialized === this.lastSerialized) return; // nothing changed since the last write (backstop no-op)
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, serialized, 'utf8');
      renameSync(tmp, this.file); // atomic on a single filesystem — never a half-written file
      this.lastSerialized = serialized;
    } catch (err) {
      // Never let a persistence failure break the request path; the in-memory cache stays correct.
      this.logger.error(`Failed to persist "${this.name}" to ${this.file}: ${(err as Error).message}`);
    }
  }

  // --- files ---

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = readFileSync(this.file, 'utf8');
      if (!raw.trim()) return;
      const entries = JSON.parse(raw) as Array<[K, V]>;
      for (const [k, v] of entries) this.cache.set(k, v);
      this.logger.log(`Loaded ${this.cache.size} record(s) for "${this.name}" from ${this.file}`);
    } catch (err) {
      // A corrupt snapshot must not crash boot. Log loudly and start empty — the operator decides.
      this.logger.error(`Could not read ${this.file} for "${this.name}"; starting empty. ${(err as Error).message}`);
    }
  }

  private serialize(): string {
    return JSON.stringify([...this.cache.entries()]);
  }

  // --- Postgres ---

  private loadRows(): void {
    const rows = this.db!.query<{ key: K; value: string }>('SELECT key, value::text AS value FROM glos_store WHERE collection = $1 ORDER BY seq', [this.name]);
    for (const r of rows) {
      this.cache.set(r.key, JSON.parse(r.value) as V);
      this.written.set(r.key, r.value);
    }
    if (rows.length) this.logger.log(`Loaded ${rows.length} record(s) for "${this.name}" from Postgres`);
    else this.moveFileIn();
  }

  /** The once-only move: a map with nothing in Postgres and a file on disk takes the file's records, in order. */
  private moveFileIn(): void {
    if (!existsSync(this.file)) return;
    this.load();
    if (this.cache.size === 0) return;
    this.writeRows([...this.cache.keys()], [], true);
    if (this.written.size !== this.cache.size) return; // not all were kept: the file stays where it is, and is tried again next start
    const moved = `${this.file}.moved-to-postgres`;
    renameSync(this.file, moved);
    this.logger.log(`Moved ${this.cache.size} record(s) of "${this.name}" from ${this.file} into Postgres; the file is kept as ${moved}`);
  }

  /** Write these records and remove those, together. Unwritten ones stay unwritten, and the backstop tries again. */
  private writeRows(changed: K[], removed: K[], all = false): void {
    if (!this.db) return;
    const texts = changed.filter((k) => this.cache.has(k)).map((k) => [k, JSON.stringify(this.cache.get(k))] as const);
    const writes = all ? texts : texts.filter(([k, text]) => this.written.get(k) !== text);
    const gone = removed.filter((k) => this.written.has(k));
    if (!writes.length && !gone.length) return;
    try {
      this.db.transaction([...gone.map((k) => ({ sql: REMOVE, params: [this.name, k] })), ...writes.map(([k, text]) => ({ sql: UPSERT, params: [this.name, k, text] }))]);
      for (const k of gone) this.written.delete(k);
      for (const [k, text] of writes) this.written.set(k, text);
    } catch (err) {
      // As with the files: the request stands, the record is kept in memory, and it is written when Postgres answers.
      this.logger.error(`Failed to persist "${this.name}" to Postgres: ${(err as Error).message}`);
    }
  }

  /** The backstop on Postgres: every record whose text has changed since it was written, and every one gone. */
  private flushRows(): void {
    this.writeRows([...this.cache.keys()], [...this.written.keys()].filter((k) => !this.cache.has(k)));
  }
}
