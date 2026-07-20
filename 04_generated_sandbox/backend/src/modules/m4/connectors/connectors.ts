import { Injectable, NotFoundException } from '@nestjs/common';
import { isKnownEventType, TrackingEventType } from '../event-vocabulary';
import { RawTrackingEvent } from '../tracking.types';

// Connector framework (T4-004/012). A connector parses a carrier-specific payload into the
// GLOS RawTrackingEvent shape. Partner connectors implement the same interface and register.

export interface TrackingConnector {
  readonly name: string;
  parse(payload: Record<string, unknown>): RawTrackingEvent;
}

// Map common carrier status strings → GLOS event types.
const STATUS_MAP: Record<string, TrackingEventType> = {
  picked_up: 'PICKUP',
  pickup: 'PICKUP',
  at_hub: 'ARRIVED_AT_HUB',
  departed: 'DEPARTED',
  handover: 'HANDOVER',
  out_for_delivery: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
};

/** Generic REST carrier feed: { shipmentId, status, ts, lat, lng, carrier }. */
@Injectable()
export class RestCarrierConnector implements TrackingConnector {
  readonly name = 'rest-carrier';
  parse(payload: Record<string, unknown>): RawTrackingEvent {
    const status = String(payload.status ?? '').toLowerCase();
    const type = STATUS_MAP[status];
    if (!type) throw new Error(`Unmapped carrier status: ${payload.status}`);
    return {
      glosShipmentId: String(payload.shipmentId ?? payload.glosShipmentId ?? ''),
      type,
      occurredAt: payload.ts ? String(payload.ts) : undefined,
      location: payload.lat != null && payload.lng != null ? { lat: Number(payload.lat), lng: Number(payload.lng) } : undefined,
      carrierDid: payload.carrier ? String(payload.carrier) : undefined,
      source: 'api',
    };
  }
}

/** Mobile courier SDK: already GLOS-shaped, tagged mobile source. */
@Injectable()
export class MobileSdkConnector implements TrackingConnector {
  readonly name = 'mobile-sdk';
  parse(payload: Record<string, unknown>): RawTrackingEvent {
    const type = String(payload.type ?? '');
    if (!isKnownEventType(type)) throw new Error(`Unknown event type: ${type}`);
    return {
      glosShipmentId: String(payload.glosShipmentId ?? ''),
      type,
      occurredAt: payload.occurredAt ? String(payload.occurredAt) : undefined,
      location: payload.location as { lat: number; lng: number } | undefined,
      carrierDid: payload.carrierDid ? String(payload.carrierDid) : undefined,
      source: 'mobile',
    };
  }
}

@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<string, TrackingConnector>();

  constructor(rest: RestCarrierConnector, mobile: MobileSdkConnector) {
    this.register(rest);
    this.register(mobile);
  }

  register(connector: TrackingConnector): void {
    this.connectors.set(connector.name, connector);
  }

  get(name: string): TrackingConnector {
    const connector = this.connectors.get(name);
    if (!connector) throw new NotFoundException(`Unknown connector: ${name}`);
    return connector;
  }

  list(): string[] {
    return [...this.connectors.keys()];
  }
}
