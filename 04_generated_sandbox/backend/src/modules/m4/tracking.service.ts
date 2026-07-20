import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { NormalizationService, NormalizedEvent } from './normalization.service';
import { TrackingContextService } from './tracking-context.service';
import { ConnectorRegistry } from './connectors/connectors';
import { isAdvancing, isLegalTransition, ShipmentState, TrackingEventType } from './event-vocabulary';
import { EventSource, ProofOfDelivery, RawTrackingEvent, Timeline, TrackingContext, TrackingEvent } from './tracking.types';

export interface IngestResult {
  status: 'accepted' | 'duplicate' | 'conflict_preserved';
  glosShipmentId: string;
  eventId?: string;
  type?: TrackingEventType;
  anomaly?: boolean;
  state?: ShipmentState;
  hasContext?: boolean;
}

interface ShipmentTrack {
  events: TrackingEvent[];
  state: ShipmentState;
  seenHashes: Set<string>;
  slotPrimary: Map<string, string>;
  conflicts: TrackingEvent[];
}

function sourcePriority(source: EventSource, proof?: boolean): number {
  if (source === 'api') return 3;
  if (source === 'mobile') return 2;
  return proof ? 2 : 1; // manual
}

/**
 * TrackingService (VTT-020/021/022/060/061). The event oracle: ingests carrier-agnostic
 * events, deduplicates and resolves conflicts, enforces the state machine (illegal transitions
 * → anomaly), anchors every validated event, builds the unified timeline, and emits the
 * settlement/reputation oracle events (pickup_ok / handover_ok / delivered / exception).
 */
@Injectable()
export class TrackingService {
  private readonly tracks = new Map<string, ShipmentTrack>();

  constructor(
    private readonly normalization: NormalizationService,
    private readonly ledger: LedgerService,
    private readonly events: EventBus,
    private readonly context: TrackingContextService,
    private readonly connectors: ConnectorRegistry,
  ) {}

  ingestViaConnector(connectorName: string, payload: Record<string, unknown>): IngestResult {
    return this.ingest(this.connectors.get(connectorName).parse(payload));
  }

  ingest(raw: RawTrackingEvent, options: { pod?: ProofOfDelivery } = {}): IngestResult {
    const normalized = this.normalization.normalize(raw);
    const track = this.trackFor(raw.glosShipmentId);

    // Exact duplicate (VTT-020).
    if (track.seenHashes.has(normalized.eventHash)) {
      return { status: 'duplicate', glosShipmentId: raw.glosShipmentId };
    }

    // Same-slot conflict resolution: a same-type event at the same second is the same event
    // reported again — resolve by source priority, preserving the loser for audit.
    const slotKey = `${normalized.type}@${normalized.occurredAt.slice(0, 19)}`;
    const existingId = track.slotPrimary.get(slotKey);
    if (existingId) {
      const existing = track.events.find((e) => e.id === existingId);
      if (existing && sourcePriority(normalized.source, raw.proof) <= sourcePriority(existing.source)) {
        const preserved = this.buildEvent(normalized, {});
        track.conflicts.push(preserved);
        track.seenHashes.add(normalized.eventHash);
        return { status: 'conflict_preserved', glosShipmentId: raw.glosShipmentId, type: normalized.type };
      }
      if (existing) {
        track.events = track.events.filter((e) => e.id !== existingId);
        track.conflicts.push(existing);
      }
    }

    // State machine (VTT-021). An anomaly is recorded for audit but does NOT advance state or
    // occupy a slot — so an illegal event can't block a later valid one.
    const legal = isLegalTransition(track.state, normalized.type);
    const anomaly = isAdvancing(normalized.type) && !legal;

    const event = this.buildEvent(normalized, { pod: options.pod, anomaly });
    track.events.push(event);
    track.seenHashes.add(normalized.eventHash);
    if (!anomaly) {
      track.slotPrimary.set(slotKey, event.id);
      if (isAdvancing(normalized.type) && legal) track.state = normalized.type as ShipmentState;
    }

    this.emitOracle(event, anomaly);

    return {
      status: 'accepted',
      glosShipmentId: raw.glosShipmentId,
      eventId: event.id,
      type: event.type,
      anomaly: anomaly || undefined,
      state: track.state,
      hasContext: this.context.has(raw.glosShipmentId),
    };
  }

  /** Submit final delivery with proof (VTT-061) — ingests a DELIVERED event carrying the PoD. */
  submitDelivery(glosShipmentId: string, pod: ProofOfDelivery, location?: { lat: number; lng: number }): IngestResult {
    return this.ingest({ glosShipmentId, type: 'DELIVERED', source: 'mobile', location }, { pod });
  }

  /** Lightweight read of a track's live state + events + last known position (no throw). */
  snapshot(glosShipmentId: string): { state: ShipmentState; events: TrackingEvent[]; lastLocation?: { lat: number; lng: number } } | undefined {
    const track = this.tracks.get(glosShipmentId);
    if (!track) return undefined;
    const lastLocation = [...track.events].reverse().find((e) => e.location)?.location;
    return { state: track.state, events: track.events, lastLocation };
  }

  /** All tracked shipment ids with their current state + carrier (search/list, VTT-071). */
  list(filter: { state?: ShipmentState; carrierDid?: string } = {}): Array<{ glosShipmentId: string; state: ShipmentState; lastEventAt?: string; carrierDid?: string; exceptions: number }> {
    return [...this.tracks.entries()]
      .map(([glosShipmentId, track]) => {
        const last = [...track.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
        return { glosShipmentId, state: track.state, lastEventAt: last?.occurredAt, carrierDid: last?.carrierDid, exceptions: track.events.filter((e) => e.anomaly).length };
      })
      .filter((r) => (!filter.state || r.state === filter.state) && (!filter.carrierDid || r.carrierDid === filter.carrierDid));
  }

  getTimeline(glosShipmentId: string): Timeline {
    const track = this.tracks.get(glosShipmentId);
    if (!track) throw new NotFoundException(`No tracking timeline for ${glosShipmentId}`);
    const context = this.context.get(glosShipmentId);
    return {
      glosShipmentId,
      currentState: track.state,
      events: [...track.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      conflictsPreserved: track.conflicts.length,
      milestoneProgress: this.milestoneProgress(track, context),
      hasContext: Boolean(context),
    };
  }

  // --- internals ---

  private trackFor(glosShipmentId: string): ShipmentTrack {
    let track = this.tracks.get(glosShipmentId);
    if (!track) {
      track = { events: [], state: 'START', seenHashes: new Set(), slotPrimary: new Map(), conflicts: [] };
      this.tracks.set(glosShipmentId, track);
    }
    return track;
  }

  private buildEvent(n: NormalizedEvent, opts: { pod?: ProofOfDelivery; anomaly?: boolean }): TrackingEvent {
    const anchor = this.ledger.anchor({ id: n.id, s: n.glosShipmentId, t: n.type, o: n.occurredAt, l: n.location ?? null, pod: opts.pod ?? null });
    return {
      id: n.id,
      glosShipmentId: n.glosShipmentId,
      type: n.type,
      occurredAt: n.occurredAt,
      location: n.location,
      carrierDid: n.carrierDid,
      source: n.source,
      confidence: n.confidence,
      eventHash: n.eventHash,
      anchorTxId: anchor.txId,
      anomaly: opts.anomaly || undefined,
      pod: opts.pod,
    };
  }

  private emitOracle(event: TrackingEvent, anomaly: boolean): void {
    if (anomaly) {
      void this.events
        .publish(GlosEvent.Tracking.ExceptionRaised, { glosShipmentId: event.glosShipmentId, type: event.type, reason: 'illegal_transition' }, { source: 'm4' })
        .catch(() => undefined);
      return;
    }
    const topic: Record<string, string | undefined> = {
      PICKUP: GlosEvent.Tracking.PickupOk,
      HANDOVER: GlosEvent.Tracking.HandoverOk,
      DELIVERED: GlosEvent.Tracking.Delivered,
    };
    const eventType = topic[event.type];
    if (eventType) {
      void this.events
        .publish(eventType, { glosShipmentId: event.glosShipmentId, eventId: event.id, at: event.occurredAt, carrierDid: event.carrierDid, pod: event.pod }, { source: 'm4' })
        .catch(() => undefined);
    }
  }

  private milestoneProgress(track: ShipmentTrack, context?: TrackingContext): { total: number; reached: number } {
    const real = track.events.filter((e) => !e.anomaly);
    const pickup = real.some((e) => e.type === 'PICKUP');
    const delivered = real.some((e) => e.type === 'DELIVERED');
    let handovers = real.filter((e) => e.type === 'HANDOVER').length;

    if (!context) {
      const reached = (pickup ? 1 : 0) + handovers + (delivered ? 1 : 0);
      return { total: reached, reached };
    }

    let reached = 0;
    for (const m of context.milestones) {
      if (m.name === 'PICKUP' && pickup) reached += 1;
      else if (m.name === 'HANDOVER' && handovers > 0) {
        reached += 1;
        handovers -= 1;
      } else if (m.name === 'DELIVERY' && delivered) reached += 1;
    }
    return { total: context.milestones.length, reached };
  }
}
