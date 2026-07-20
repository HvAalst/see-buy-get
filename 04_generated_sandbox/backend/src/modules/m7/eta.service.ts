import { Injectable, NotFoundException } from '@nestjs/common';
import { DigitalTwinService } from './digital-twin.service';
import { DisruptionService } from './disruption.service';
import { EtaPrediction, ShipmentState } from './twin.types';

/** Indicative transit hours per leg mode — the baseline before live/disruption adjustment. */
const MODE_HOURS: Record<string, number> = { courier: 4, road: 12, rail: 48, air: 18, ocean: 240, multimodal: 96 };
const DEFAULT_LEG_HOURS = 24;
const DISRUPTION_FACTOR = 1.5; // a shipment in a disruption blast radius runs ~50% slower

/**
 * EtaService (M7-020, NFR-M7-02). Continuously-updated ETA derived from the twin's current state,
 * the planned route's remaining legs, and a disruption factor. Returns a 95% confidence interval and
 * a human-readable basis (NFR-M7-06). Pure/in-memory, so a single recompute is well under 200ms.
 */
@Injectable()
export class EtaService {
  constructor(
    private readonly twin: DigitalTwinService,
    private readonly disruption: DisruptionService,
  ) {}

  /**
   * Hours to completion given an explicit `impacted` flag — ignoring real disruption state. Lets the
   * what-if simulator project a clean baseline vs. a disrupted scenario without touching live data.
   */
  projectHours(glosShipmentId: string, impacted: boolean): number {
    const node = this.twin.shipment(glosShipmentId);
    if (!node) throw new NotFoundException(`Shipment not in twin: ${glosShipmentId}`);
    const remaining = this.remainingLegs(this.twin.legs(glosShipmentId), node.state);
    const baseHours = remaining.reduce((sum, leg) => sum + (MODE_HOURS[leg.mode] ?? DEFAULT_LEG_HOURS), 0);
    return Math.round(baseHours * (impacted ? DISRUPTION_FACTOR : 1) * 10) / 10;
  }

  predict(glosShipmentId: string): EtaPrediction {
    const node = this.twin.shipment(glosShipmentId);
    if (!node) throw new NotFoundException(`Shipment not in twin: ${glosShipmentId}`);

    const remaining = this.remainingLegs(this.twin.legs(glosShipmentId), node.state);
    const impacted = this.disruption.isImpacted(glosShipmentId);
    const hoursRemaining = this.projectHours(glosShipmentId, impacted);

    const now = Date.now();
    const at = (h: number) => new Date(now + h * 3_600_000).toISOString();
    const basisParts = [`${remaining.length} leg(s) remaining`];
    if (node.state === 'delivered') basisParts[0] = 'delivered';
    if (impacted) basisParts.push('disruption +50%');

    return {
      glosShipmentId,
      hoursRemaining,
      eta: at(hoursRemaining),
      confidence: { low: at(hoursRemaining * 0.8), high: at(hoursRemaining * 1.2), level: 0.95 },
      basis: basisParts.join(' · '),
    };
  }

  /** True when the shipment is predicted to run past the given deadline (drives geo "predicted-late"). */
  isLate(glosShipmentId: string, deadlineIso?: string): boolean {
    const node = this.twin.shipment(glosShipmentId);
    if (!node || node.state === 'delivered') return false;
    if (!deadlineIso) return this.disruption.isImpacted(glosShipmentId);
    return new Date(this.predict(glosShipmentId).eta).getTime() > new Date(deadlineIso).getTime();
  }

  private remainingLegs<T>(legs: T[], state?: ShipmentState): T[] {
    switch (state) {
      case 'delivered':
        return [];
      case 'out_for_delivery':
      case 'handed_over':
        return legs.slice(-1);
      case 'picked_up':
      case 'in_transit':
        return legs.slice(1); // first leg under way / done
      default:
        return legs; // not yet started
    }
  }
}
