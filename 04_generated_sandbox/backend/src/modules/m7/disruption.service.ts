import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DigitalTwinService } from './digital-twin.service';
import { Disruption, DisruptionType, ImpactedShipment } from './twin.types';

interface DisruptionSignal {
  type?: DisruptionType;
  zone: string;
  center?: { lat: number; lng: number };
  radiusKm?: number;
  severity?: Disruption['severity'];
  keywords?: string[];
}

const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Keyword → disruption-type classifier (M7-021). Order matters: first hit wins.
const CLASSIFIERS: Array<{ type: DisruptionType; terms: string[] }> = [
  { type: 'port_strike', terms: ['strike', 'walkout', 'labor', 'industrial action'] },
  { type: 'weather', terms: ['storm', 'typhoon', 'hurricane', 'cyclone', 'flood', 'snow', 'fog'] },
  { type: 'unrest', terms: ['unrest', 'protest', 'riot', 'conflict', 'border closure'] },
  { type: 'carrier_failure', terms: ['bankrupt', 'insolvency', 'grounded', 'fleet'] },
  { type: 'congestion', terms: ['congestion', 'backlog', 'delay', 'queue'] },
];

const SEVERITY_SCORE: Record<Disruption['severity'], number> = { low: 15, medium: 35, high: 55 };
const STATE_RISK: Record<string, number> = { in_transit: 35, picked_up: 35, handed_over: 30, out_for_delivery: 20, assigned: 25, planned: 15, created: 10 };

/**
 * DisruptionService (M7-021/022). Ingests a disruption signal, classifies it, and emits
 * `orchestration.disruption_detected`. Computes the blast radius — every shipment whose route
 * touches the zone — and returns a ranked "most critical impacted" list (`orchestration.impact_assessed`).
 */
@Injectable()
export class DisruptionService {
  private readonly disruptions = new Map<string, Disruption>();

  constructor(
    private readonly twin: DigitalTwinService,
    private readonly events: EventBus,
  ) {}

  /** Build + classify a typed Disruption from a raw signal, WITHOUT storing or emitting (pure). */
  draft(signal: DisruptionSignal): Disruption {
    return {
      id: `disr_${randomBytes(8).toString('hex')}`,
      type: signal.type ?? this.classify([signal.zone, ...(signal.keywords ?? [])].join(' ')),
      zone: signal.zone,
      center: signal.center,
      radiusKm: signal.radiusKm ?? 100,
      severity: signal.severity ?? 'medium',
      detectedAt: new Date().toISOString(),
    };
  }

  /** M7-021: ingest + classify a raw signal into a typed Disruption (stored + emitted). */
  ingest(signal: DisruptionSignal): Disruption {
    const disruption = this.draft(signal);
    this.disruptions.set(disruption.id, disruption);
    void this.events.publish(GlosEvent.Orchestration.DisruptionDetected, { ...disruption }, { source: 'm7' }).catch(() => undefined);
    return disruption;
  }

  /** Pure blast-radius computation against the current twin — no side effects (used by simulation). */
  assess(disruption: Disruption): ImpactedShipment[] {
    return this.twin
      .shipments()
      .filter((n) => n.state !== 'delivered' && this.shipmentInZone(String(n.props.glosShipmentId), disruption))
      .map<ImpactedShipment>((n) => ({
        glosShipmentId: String(n.props.glosShipmentId),
        state: n.state ?? 'created',
        reason: `route within ${disruption.radiusKm}km of ${disruption.type.replace('_', ' ')} @ ${disruption.zone}`,
        criticality: Math.min(100, SEVERITY_SCORE[disruption.severity] + (STATE_RISK[n.state ?? 'created'] ?? 10) + (n.props.exception ? 10 : 0)),
      }))
      .sort((a, b) => b.criticality - a.criticality);
  }

  /** M7-022: blast radius for a stored disruption — affected shipments ranked, emits ImpactAssessed. */
  impact(disruptionId: string): ImpactedShipment[] {
    const disruption = this.require(disruptionId);
    const ranked = this.assess(disruption);
    void this.events
      .publish(GlosEvent.Orchestration.ImpactAssessed, { disruptionId, zone: disruption.zone, impacted: ranked.length, mostCritical: ranked[0]?.glosShipmentId }, { source: 'm7' })
      .catch(() => undefined);
    return ranked;
  }

  /** True if the shipment sits in ANY active disruption's blast radius (used by ETA). */
  isImpacted(glosShipmentId: string): boolean {
    return [...this.disruptions.values()].some((d) => this.shipmentInZone(glosShipmentId, d));
  }

  active(): Disruption[] {
    return [...this.disruptions.values()];
  }

  get(disruptionId: string): Disruption {
    return this.require(disruptionId);
  }

  // --- internals ---

  private shipmentInZone(glosShipmentId: string, d: Disruption): boolean {
    const legs = this.twin.legs(glosShipmentId);
    const zoneLower = d.zone.toLowerCase();
    return legs.some((leg) => {
      const byName = leg.origin?.toLowerCase().includes(zoneLower) || leg.destination?.toLowerCase().includes(zoneLower);
      const center = leg.handover?.geofence?.center;
      const byGeo = d.center && center ? haversineKm(center, d.center) <= d.radiusKm : false;
      return byName || byGeo;
    });
  }

  private classify(text: string): DisruptionType {
    const lower = text.toLowerCase();
    return CLASSIFIERS.find((c) => c.terms.some((t) => lower.includes(t)))?.type ?? 'congestion';
  }

  private require(disruptionId: string): Disruption {
    const d = this.disruptions.get(disruptionId);
    if (!d) throw new NotFoundException(`Disruption not found: ${disruptionId}`);
    return d;
  }
}
