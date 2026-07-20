import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { EventSource, RawTrackingEvent } from './tracking.types';

export interface NormalizedEvent {
  id: string;
  glosShipmentId: string;
  type: RawTrackingEvent['type'];
  occurredAt: string;
  location?: { lat: number; lng: number };
  carrierDid?: string;
  source: EventSource;
  confidence: number;
  eventHash: string;
}

const CONFIDENCE: Record<EventSource, number> = { api: 90, mobile: 80, manual: 50 };

/**
 * NormalizationService (VTT-011). Turns any carrier-agnostic raw event into the GLOS Standard
 * Tracking Event shape with a deterministic event hash and a data-quality confidence score
 * (manual events default lower unless backed by proof).
 */
@Injectable()
export class NormalizationService {
  normalize(raw: RawTrackingEvent): NormalizedEvent {
    const source: EventSource = raw.source ?? 'api';
    const occurredAt = raw.occurredAt ?? new Date().toISOString();
    const confidence = source === 'manual' && raw.proof ? 80 : CONFIDENCE[source];

    const eventHash = createHash('sha256')
      .update(JSON.stringify({ s: raw.glosShipmentId, t: raw.type, o: occurredAt, l: raw.location ?? null, c: raw.carrierDid ?? null }))
      .digest('hex');

    return {
      id: `evt_${randomBytes(10).toString('hex')}`,
      glosShipmentId: raw.glosShipmentId,
      type: raw.type,
      occurredAt,
      location: raw.location,
      carrierDid: raw.carrierDid,
      source,
      confidence,
      eventHash,
    };
  }
}
