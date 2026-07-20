import { RawSignal, SignalSource } from '../signal.types';

/**
 * Example feed connector. Represents an upstream advisory queue (port authority / weather / risk
 * provider). In production `poll()` calls that provider's HTTP/RSS/AIS API; here it returns a buffer
 * of current advisories with stable `externalId`s, so repeated polls are idempotent (the ingest
 * service dedups). `enqueue()` lets a webhook drop a new advisory in to be picked up on the next poll.
 */
export class PartnerFeedSource implements SignalSource {
  readonly id = 'partner-advisories';

  private readonly buffer: RawSignal[] = [
    { source: this.id, externalId: 'PA-SG-2207', zone: 'Singapore', headline: 'Port labor walkout halts container handling', severity: 'high', radiusKm: 120 },
    { source: this.id, externalId: 'PA-SUEZ-1184', zone: 'Suez', headline: 'Convoy congestion and queue building at the canal', severity: 'medium', radiusKm: 150 },
  ];

  enqueue(signal: RawSignal): void {
    this.buffer.push({ ...signal, source: this.id });
  }

  poll(): RawSignal[] {
    return [...this.buffer];
  }
}
