// M7 signal-ingestion contracts. A "signal" is a raw real-world advisory from an external feed
// (port authority, weather service, risk/news provider, AIS, partner webhook) before it has been
// classified into a typed Disruption.

import { DisruptionType } from './twin.types';

export interface RawSignal {
  /** Originating feed/adapter id (e.g. 'partner-advisories', 'webhook'). */
  source: string;
  /** Affected place — matched against shipment routes (name) and/or geofences (center+radius). */
  zone: string;
  /** Free-text advisory; classified into a DisruptionType when `type` is omitted. */
  headline: string;
  type?: DisruptionType;
  severity?: 'low' | 'medium' | 'high';
  center?: { lat: number; lng: number };
  radiusKm?: number;
  /** Stable upstream id for idempotent dedup across repeated polls. */
  externalId?: string;
  observedAt?: string;
}

export interface ProcessedSignal {
  source: string;
  zone: string;
  headline: string;
  type: DisruptionType;
  disruptionId: string;
  at: string;
}

/**
 * A pluggable feed connector. `poll()` fetches the current advisories from an upstream source; a
 * production adapter calls the provider's HTTP/RSS/AIS API, the ingest service dedups by externalId.
 */
export interface SignalSource {
  readonly id: string;
  poll(): Promise<RawSignal[]> | RawSignal[];
}
