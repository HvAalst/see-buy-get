import { Logger } from '@nestjs/common';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';

/**
 * PersistentMap<K, V> — a Map that survives a process restart.
 *
 * The rest of the codebase keeps 78 in-memory `new Map<>()`s; most hold data that is fine to lose on
 * restart (it is re-seeded). Six do NOT: they hold real user credentials and real prepaid money, and
 * losing those on a deploy is losing cash an agent paid across a counter. Those six — and only those
 * six — swap `new Map()` for `new PersistentMap()` and gain durability with an identical surface
 * (get/set/delete/has/values/keys/entries/size/forEach + Symbol.iterator), so call sites do not change.
 *
 * STORAGE ENGINE — pure JSON, atomic write-through. The plan named better-sqlite3, but it is a native
 * module with no prebuilt binary for this runtime and no build toolchain present, and the backend has
 * no SQL to run behind this interface. At prototype scale (tens–hundreds of records) a whole-file
 * snapshot per mutation is more than adequate. Durability details:
 *   - Every mutation writes the full map to `<file>.tmp` then renames onto `<file>`. rename() is
 *     atomic on a single filesystem, so a crash mid-write leaves the previous good file intact —
 *     never a half-written one.
 *   - Reads are served from an in-memory cache; disk is touched only on load and on mutation.
 *   - Values are whatever `JSON.stringify` round-trips. These six maps hold plain data objects, so
 *     that is exact. (Dates are stored as ISO strings here already; Maps/Sets/class instances would
 *     need a reviver — none of the six use them.)
 *
 * This is the seam S10 upgrades: when single-instance durability stops being enough, a Postgres- or
 * SQLite-backed implementation of this same interface is a one-file change and no call site moves.
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

export interface PersistentMapOptions {
  /** Absolute path override for the snapshot file. Defaults to `<DATA_DIR>/<name>.json`. */
  file?: string;
  /** Disable disk entirely for this instance regardless of the global flag (used by unit tests). */
  ephemeral?: boolean;
}

/**
 * Backstop flush interval. set()/delete() persist immediately, but an in-place mutation of a stored
 * value (`map.get(id).status = 'X'`) reaches the cache without calling any method — many domain
 * services mutate that way. This periodic, change-detected flush catches those within a couple of
 * seconds without every call site having to re-set. Money paths still re-set explicitly for instant
 * durability; this is the safety net for everything else.
 */
const FLUSH_MS = Number(process.env.GLOS_FLUSH_MS ?? 2000);

/** Every map that writes to disk, so that a stop can write all of them: see flushPersistentMaps. */
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

export class PersistentMap<K extends string, V> implements Map<K, V> {
  private readonly logger = new Logger(PersistentMap.name);
  private readonly cache = new Map<K, V>();
  private readonly file: string;
  private readonly persist: boolean;
  private lastSerialized = '';
  private timer?: NodeJS.Timeout;

  /** @param name stable identifier → the snapshot filename. Changing it orphans the old file. */
  constructor(
    private readonly name: string,
    options: PersistentMapOptions = {},
  ) {
    this.file = options.file || join(DATA_DIR, `${name}.json`);
    this.persist = persistenceEnabled() && !options.ephemeral;
    if (this.persist) {
      this.load();
      this.lastSerialized = this.serialize(); // loaded state is already on disk — don't rewrite it
      // Backstop for in-place mutations. unref() so this timer never holds the process open.
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      this.timer.unref?.();
      LIVE.add(this);
    }
  }

  // --- Map surface (the six call sites only use get/set/delete/has/values/entries/keys) ---

  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  set(key: K, value: V): this {
    this.cache.set(key, value);
    this.flush();
    return this;
  }

  delete(key: K): boolean {
    const existed = this.cache.delete(key);
    if (existed) this.flush();
    return existed;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.flush();
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

  // --- disk ---

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

  private flush(): void {
    if (!this.persist) return;
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

  /** Stop the backstop timer and write any pending change. For tests and graceful shutdown. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    LIVE.delete(this);
    this.flush();
  }
}
