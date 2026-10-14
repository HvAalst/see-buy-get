import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { GlosError } from './glos-error';
import { PersistentMap } from '../store/persistent-map';

/**
 * Do this once, however many times you are asked.
 *
 * A quote is safe to repeat — it creates nothing, so a retry costs nothing. A MINT is not: a network that
 * drops the response to "create this shipment" leaves the caller with no way to tell a request that failed
 * from one that succeeded silently, and the only two things they can do are both wrong. Retry and they may
 * ship twice; do not retry and they may not ship at all.
 *
 * So the caller names the attempt, and we promise that a name is spent at most once. Three rules, and the
 * middle one is the one people forget:
 *
 *  - **The same name with the same request** returns the FIRST answer, byte for byte, without doing
 *    anything again. Replays are free and safe for as long as the record is kept.
 *  - **The same name with a DIFFERENT request is refused.** It means the caller's own bookkeeping has gone
 *    wrong — two different shipments sharing one name — and quietly returning the first one would ship the
 *    wrong parcel and report success. Louder is kinder.
 *  - **A name still in flight is refused too**, rather than run twice in parallel. Node is single-threaded
 *    per request but not per await, and the window between "started" and "finished" is exactly where a
 *    double-click lands.
 *
 * A FAILED attempt releases its name. The caller could not have known the request was doomed, and making
 * them mint a fresh id to retry a fixable error (a top-up that had not landed yet) turns a recoverable
 * problem into a lost order.
 *
 * Scoped per caller: two merchants choosing the same uuid is unlikely and must still be harmless.
 */

/** How long a spent name is remembered. Beyond this a replay quietly becomes a new request. */
export const IDEMPOTENCY_TTL_H = 24;

interface Record_ {
  scope: string;
  key: string;
  /** Hash of the request, so a reused name with different parameters is caught rather than served. */
  fingerprint: string;
  status: 'running' | 'done';
  response?: unknown;
  at: string;
}

@Injectable()
export class IdempotencyService {
  // Durable: the whole promise is that it survives whatever made the caller retry — including us restarting.
  private readonly records = new PersistentMap<string, Record_>('idempotency');

  /** A stable fingerprint of a request body. Key order must not change the answer. */
  static fingerprint(body: unknown): string {
    return createHash('sha256').update(stable(body)).digest('hex');
  }

  /**
   * Run `work` at most once for this (scope, key). Returns the result and whether it is a replay.
   *
   * `key` may be absent — idempotency is the CALLER's tool, and a caller who does not use it simply gets
   * ordinary at-least-once behaviour rather than a refusal. Requiring it would push the burden onto the
   * many callers who retry nothing to protect the few who do.
   */
  async run<T>(scope: string, key: string | undefined, body: unknown, work: () => Promise<T> | T): Promise<{ result: T; replayed: boolean }> {
    const name = key?.trim();
    if (!name) return { result: await work(), replayed: false };

    const id = `${scope}:${name}`;
    const fingerprint = IdempotencyService.fingerprint(body);
    const existing = this.live(id);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new GlosError('IDEMPOTENCY_REUSED', `Idempotency-Key "${name}" was already used for a different request — use a new one`, { key: name });
      }
      if (existing.status === 'running') {
        throw new GlosError('CONFLICT', `A request with Idempotency-Key "${name}" is still in progress — wait for it, then retry`, { key: name });
      }
      return { result: existing.response as T, replayed: true };
    }

    this.records.set(id, { scope, key: name, fingerprint, status: 'running', at: new Date().toISOString() });
    let result: T;
    try {
      result = await work();
    } catch (err) {
      // Release the name. The caller could not have known this would fail, and forcing a fresh id to retry
      // a fixable error turns a recoverable problem into a lost order.
      this.records.delete(id);
      throw err;
    }
    this.records.set(id, { scope, key: name, fingerprint, status: 'done', response: result, at: new Date().toISOString() });
    return { result, replayed: false };
  }

  /** The record for this name, if it has not aged out. Pruning on read keeps the store from growing. */
  private live(id: string): Record_ | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    const age = Date.now() - new Date(record.at).getTime();
    if (Number.isFinite(age) && age > IDEMPOTENCY_TTL_H * 3_600_000) {
      this.records.delete(id);
      return undefined;
    }
    return record;
  }
}

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` are the same request. Arrays keep their order. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}
