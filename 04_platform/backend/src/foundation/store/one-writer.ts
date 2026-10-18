import { Logger } from '@nestjs/common';
import { hostname } from 'os';
import { join } from 'path';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { DATA_DIR, persistenceEnabled, storeDatabase, storeEngine } from './persistent-map';

/**
 * ONE SERVER WRITES THE STORE (the user, 2026-10-18: "evidence that lasts").
 *
 * Every server process holds the whole store in memory and writes through to it (persistent-map.ts): a wallet's
 * balance is read from memory, changed, and written. That is safe while one process does it — Node runs one request at
 * a time and every write is synchronous — and it is NOT safe for two: each would work from its own copy, and the
 * second to write a wallet would put back what the first had taken out. Nothing stopped a second process from starting
 * against the same database or the same data directory: a second container, a deploy that started the new server
 * before the old one stopped, a script opening the store while the server ran.
 *
 * So the first one claims the store and a second one does not start, saying which process holds it. On Postgres the
 * claim is a session advisory lock on the store's own connection, checked again every half minute: a connection that
 * dropped and came back has lost its lock, takes it again if it is free, and stops the server if somebody else has it
 * — continuing would be two writers. On files it is a lock file in the data directory naming the process; one whose
 * process is gone is taken over.
 */

/** The advisory lock's two keys: "GLOS" and the store. */
export const STORE_LOCK: readonly [number, number] = [0x474c4f53, 1];
const RECHECK_MS = 30_000;
/**
 * How long a claim waits for the holder to go before refusing: a restart (the dev server's watch, a deploy that starts
 * the new server as the old one is stopping) is two processes for a moment, not two writers.
 */
const WAIT_MS = 15_000;

/** Wait without leaving this function: the claim is made before anything else in the process starts. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
const LOCK_FILE = '.writer.lock';

export interface StoreClaim {
  engine: 'postgres' | 'files';
  release(): void;
}

/** The claim this process holds, for staff to read: which engine, and since when. */
let held: { engine: 'postgres' | 'files'; pid: number; since: string } | undefined;

export function storeClaimed(): { engine: 'postgres' | 'files'; pid: number; since: string } | undefined {
  return held;
}

/** The part of the Postgres connection the claim needs: one query at a time. */
export interface Querier {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
}

/** Claim the store for this process, or refuse to start. Nothing to claim where nothing persists (tests, GLOS_PERSIST=off). */
export function claimTheStore(): StoreClaim | undefined {
  if (!persistenceEnabled()) return undefined;
  const claim = storeEngine() === 'postgres' ? claimPostgres(storeDatabase(), () => process.exit(1)) : claimFiles(DATA_DIR, process.pid);
  held = { engine: claim.engine, pid: process.pid, since: new Date().toISOString() };
  return claim;
}

/** Who holds the store's lock in Postgres, said the way somebody can find the process. */
function holderOf(db: Querier): string {
  const rows = db.query<{ pid: number; application_name: string | null; client_addr: string | null; backend_start: string | null }>(
    `SELECT a.pid, a.application_name, a.client_addr::text AS client_addr, a.backend_start::text AS backend_start
       FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.classid = $1 AND l.objid = $2 AND l.granted`,
    [STORE_LOCK[0], STORE_LOCK[1]],
  );
  const h = rows[0];
  return h ? `database session ${h.pid}${h.client_addr ? ` from ${h.client_addr}` : ''}${h.backend_start ? `, connected since ${h.backend_start}` : ''}` : 'another session';
}

export function claimPostgres(db: Querier, stop: () => void, recheckMs = RECHECK_MS, waitMs = WAIT_MS): StoreClaim {
  const logger = new Logger('OneWriter');
  const take = () => db.query<{ got: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS got', [STORE_LOCK[0], STORE_LOCK[1]])[0]?.got === true;
  const held = () =>
    db.query<{ held: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objid = $2 AND pid = pg_backend_pid() AND granted) AS held", [STORE_LOCK[0], STORE_LOCK[1]])[0]?.held === true;
  const until = Date.now() + waitMs;
  let got = take();
  while (!got && Date.now() < until) {
    pause(250);
    got = take();
  }
  if (!got) {
    throw new Error(
      `Another server is already writing to this database (${holderOf(db)}). Two would each keep their own copy of the wallets and the books and write over each other's. Stop the other one first, then start this one.`,
    );
  }
  const timer = setInterval(() => {
    try {
      if (held() || take()) return;
      logger.error(`The store's lock is held by ${holderOf(db)}: this server stops, rather than be a second writer.`);
      stop();
    } catch (err) {
      // The database not answering is not somebody else writing: the store's own writes fail loudly meanwhile.
      logger.warn(`Could not check the store's lock: ${(err as Error).message}`);
    }
  }, recheckMs);
  timer.unref?.();
  return {
    engine: 'postgres',
    release: () => {
      clearInterval(timer);
      try {
        db.query('SELECT pg_advisory_unlock($1, $2)', [STORE_LOCK[0], STORE_LOCK[1]]);
      } catch {
        /* the session ending releases it anyway */
      }
    },
  };
}

/** Whether a process with this id is running on this machine. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it is somebody else's. ESRCH: there is no such process.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function claimFiles(dir: string, pid: number, waitMs = WAIT_MS): StoreClaim {
  const file = join(dir, LOCK_FILE);
  const mine = JSON.stringify({ pid, host: hostname(), since: new Date().toISOString() });
  const until = Date.now() + waitMs;
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(file, mine, { flag: 'wx' });
      return {
        engine: 'files',
        release: () => {
          try {
            if ((JSON.parse(readFileSync(file, 'utf8')) as { pid?: number }).pid === pid) unlinkSync(file);
          } catch {
            /* gone already */
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let other: { pid?: number; host?: string; since?: string } = {};
      try {
        other = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        /* unreadable: treated as a lock nobody holds */
      }
      if (other.pid === pid) return { engine: 'files', release: () => undefined };
      if (other.pid && other.host === hostname() && alive(other.pid)) {
        if (Date.now() < until) {
          pause(250);
          continue;
        }
        throw new Error(
          `Another server is already writing to ${dir} (process ${other.pid}, since ${other.since ?? 'an earlier start'}). Two would write over each other's wallets and books. Stop it first (/stop), then start this one. If no server is running, remove ${file}.`,
        );
      }
      if (attempt > 3) throw new Error(`Could not claim ${file}`);
      // A lock whose process has gone: a server that died. Taken over.
      try {
        unlinkSync(file);
      } catch {
        /* somebody else took it over first: the next attempt says so */
      }
    }
  }
}
