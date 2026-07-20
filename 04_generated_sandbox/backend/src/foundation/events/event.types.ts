// Event-driven backbone contracts (T-002, INF-1).
// Every state change travels as an immutable envelope so the async cascade
// (M4 event → SSE release → M5 rating, etc.) is uniform and traceable.

export interface EventEnvelope<T = unknown> {
  /** Unique id for this event instance. */
  id: string;
  /** Canonical event type, e.g. 'shipment.created' (see glos-events.ts). */
  type: string;
  /** Correlation id propagated across an entire cascade of related events. */
  traceId: string;
  /** ISO timestamp the event occurred. */
  occurredAt: string;
  /** Emitting module/source, e.g. 'm2'. */
  source?: string;
  /** Delivery attempt counter (>=1 once delivered). */
  attempt: number;
  payload: T;
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => void | Promise<void>;

export interface PublishOptions {
  /** Override the correlation id. Defaults to the ambient trace, else a new id. */
  traceId?: string;
  source?: string;
}

export interface DeadLetter {
  envelope: EventEnvelope;
  error: string;
  failedAt: string;
}
