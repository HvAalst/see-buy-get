import { MessageChannel, MessagePort, Worker, receiveMessageOnPort } from 'worker_threads';

/**
 * POSTGRES, ANSWERED SYNCHRONOUSLY — so that the store every service already uses can keep its shape.
 *
 * PersistentMap is a Map: `set()` returns when the value is kept, and a service reads it back on the next line. Its
 * file engine kept that promise by writing the file before returning. Every Postgres client for Node is asynchronous,
 * and making the store asynchronous would move every one of its call sites. So the client runs in a worker thread of
 * its own, and the caller WAITS for its answer: the request is posted to the worker, the main thread sleeps on a
 * shared flag (`Atomics.wait` — allowed on Node's main thread), the worker sets the flag when Postgres has answered,
 * and the answer is read off the port synchronously (`receiveMessageOnPort`). A write is therefore kept in Postgres
 * before `set()` returns, exactly as it was kept on disk before.
 *
 * What it costs is the same thing the file engine cost: the server waits for each write. A round trip to a database
 * on the same network is about a millisecond; the file engine rewrote a whole collection's file on every write.
 */

/** The worker, as plain JavaScript: it runs in a thread with no TypeScript loader, so it is evaluated from a string. */
const WORKER_SOURCE = `
const { workerData } = require('node:worker_threads');
const { Client } = require(workerData.pgPath);
const flag = new Int32Array(workerData.signal);
const port = workerData.port;
let client;
async function connect() {
  const c = new Client({ connectionString: workerData.url });
  // A connection that drops is made again on the next request, not left broken.
  c.on('error', () => { if (client === c) client = undefined; });
  await c.connect();
  client = c;
}
async function run(op) {
  if (!client) await connect();
  if (op.kind === 'query') return (await client.query(op.sql, op.params)).rows;
  await client.query('BEGIN');
  try {
    for (const s of op.statements) await client.query(s.sql, s.params);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
  return [];
}
port.on('message', async (op) => {
  let reply;
  try {
    reply = { id: op.id, ok: true, rows: await run(op) };
  } catch (e) {
    const message = String((e && e.message) || e);
    if (/terminated|not queryable|ECONN|closed/i.test(message)) client = undefined;
    reply = { id: op.id, ok: false, error: message, code: e && e.code };
  }
  port.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
`;

export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

interface Reply {
  id: number;
  ok: boolean;
  rows?: unknown[];
  error?: string;
  code?: string;
}

export class SyncPostgres {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly flag: Int32Array;
  private next = 0;

  /** @param url a Postgres connection string; `?sslmode=require` and the like are read from it. */
  constructor(
    url: string,
    private readonly timeoutMs = Number(process.env.GLOS_DB_TIMEOUT_MS ?? 15_000),
  ) {
    const signal = new SharedArrayBuffer(4);
    this.flag = new Int32Array(signal);
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { url, signal, port: port2, pgPath: require.resolve('pg') }, transferList: [port2] });
    // Neither holds the process open: a server told to stop has already written what it holds (flushPersistentMaps).
    this.worker.unref();
    this.port.unref();
  }

  /** One statement; its rows. */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.call({ kind: 'query', sql, params }) as T[];
  }

  /** Several statements, kept together or not at all. */
  transaction(statements: SqlStatement[]): void {
    if (statements.length) this.call({ kind: 'batch', statements });
  }

  private call(op: Record<string, unknown>): unknown[] {
    const id = ++this.next;
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage({ ...op, id });
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      // An answer to an earlier request that timed out may be waiting: it is read and set aside.
      for (let got = receiveMessageOnPort(this.port); got; got = receiveMessageOnPort(this.port)) {
        const reply = got.message as Reply;
        if (reply.id !== id) continue;
        if (!reply.ok) throw Object.assign(new Error(reply.error ?? 'Postgres refused the request'), { code: reply.code });
        return reply.rows ?? [];
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Postgres did not answer within ${this.timeoutMs} ms`);
      Atomics.wait(this.flag, 0, 0, left);
      Atomics.store(this.flag, 0, 0);
    }
  }
}
