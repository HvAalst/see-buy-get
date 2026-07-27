import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { DeadLetter, EventEnvelope, EventHandler, PublishOptions } from './event.types';

interface TraceContext {
  traceId: string;
}

export interface EventBusConfig {
  /** Max delivery attempts per subscriber before dead-lettering (at-least-once). */
  maxAttempts: number;
  /** Backoff in ms for a given attempt number (1-based). Defaults to 0 (sandbox/tests). */
  backoffMs: (attempt: number) => number;
}

/** Optional DI token to override bus config in production wiring. */
export const EVENT_BUS_CONFIG = 'EVENT_BUS_CONFIG';

/**
 * EventBus — the async cascade spine (T-002, INF-1).
 *
 * - Typed pub/sub over EventEnvelope.
 * - At-least-once delivery: each subscriber is retried up to `maxAttempts`; a handler that
 *   never succeeds is moved to the dead-letter queue (one failing subscriber never blocks
 *   the others).
 * - Trace propagation: handlers run inside an AsyncLocalStorage scope carrying the event's
 *   traceId, so any event they publish inherits it automatically — the whole cascade shares
 *   one correlation id without threading it by hand.
 */
@Injectable()
export class EventBus {
  /** Cap on the retained in-memory event log (observability/tests only). Newest kept, oldest dropped. */
  private static readonly LOG_CAP = 10_000;
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly log: EventEnvelope[] = [];
  private readonly deadLetters: DeadLetter[] = [];
  private readonly als = new AsyncLocalStorage<TraceContext>();
  private readonly config: EventBusConfig;

  constructor(@Optional() @Inject(EVENT_BUS_CONFIG) config?: Partial<EventBusConfig>) {
    this.config = {
      maxAttempts: config?.maxAttempts ?? 3,
      backoffMs: config?.backoffMs ?? (() => 0),
    };
  }

  /** Subscribe to an event type. Returns an unsubscribe function. */
  subscribe<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(type, set);
    return () => this.handlers.get(type)?.delete(handler as EventHandler);
  }

  /**
   * Publish an event and deliver it to all subscribers (awaiting delivery so callers can
   * rely on completion in tests). The traceId defaults to the ambient cascade trace, then
   * an explicit override, then a fresh id.
   */
  async publish<T = unknown>(type: string, payload: T, options: PublishOptions = {}): Promise<EventEnvelope<T>> {
    const traceId = options.traceId ?? this.als.getStore()?.traceId ?? randomUUID();
    const envelope: EventEnvelope<T> = {
      id: randomUUID(),
      type,
      traceId,
      occurredAt: new Date().toISOString(),
      source: options.source,
      attempt: 0,
      payload,
    };
    this.log.push(envelope);
    // Ring buffer: the log is observability/test-only (getLog copies it), so bound it — otherwise a
    // long-running instance grows it without limit (one entry per publish, forever).
    if (this.log.length > EventBus.LOG_CAP) this.log.splice(0, this.log.length - EventBus.LOG_CAP);

    const subscribers = Array.from(this.handlers.get(type) ?? []);
    await Promise.all(subscribers.map((handler) => this.deliver(handler, envelope)));
    return envelope;
  }

  /** All events ever published (newest last). For observability/tests. */
  getLog(): ReadonlyArray<EventEnvelope> {
    return [...this.log];
  }

  /** Events whose delivery to a subscriber exhausted all attempts. */
  getDeadLetters(): ReadonlyArray<DeadLetter> {
    return [...this.deadLetters];
  }

  private async deliver(handler: EventHandler, envelope: EventEnvelope): Promise<void> {
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        const attempted: EventEnvelope = { ...envelope, attempt };
        // Run inside the trace scope so downstream publishes inherit the traceId.
        await this.als.run({ traceId: envelope.traceId }, () => Promise.resolve(handler(attempted)));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= this.config.maxAttempts) {
          this.logger.warn(`Dead-lettering ${envelope.type} (${envelope.id}) after ${attempt} attempts: ${message}`);
          this.deadLetters.push({ envelope, error: message, failedAt: new Date().toISOString() });
          return;
        }
        const wait = this.config.backoffMs(attempt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
}
