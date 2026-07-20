import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ShipmentService } from './shipment.service';
import { deriveRequirements } from './handling-codes';
import { RouteTemplate } from './legs/route-template.service';
import { Geofence, HandoverPoint, JobRequirementVector, Leg, Milestone, Shipment, TransportMode } from './shipment.types';

/**
 * LegDecompositionService — turns a shipment into atomic transport legs with standardized
 * handover points, geofences, milestones, and per-leg negotiation slots (M2-060/061/062), and
 * produces the Job Requirement Vector (M2-032). Emits `shipment.leg_decomposed` + `.jrv_ready`.
 */
@Injectable()
export class LegDecompositionService {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly events: EventBus,
  ) {}

  /** Auto-decompose from origin/destination + mode. */
  decompose(glosShipmentId: string): Shipment {
    const shipment = this.shipments.require(glosShipmentId);
    const legs = this.planLegs(shipment, shipment.ewaybill.transport.mode, shipment.ewaybill.handling.codes);
    return this.finalize(shipment, legs);
  }

  /** Decompose from a saved route template (M2-063). */
  decomposeFromRoute(glosShipmentId: string, route: RouteTemplate): Shipment {
    const shipment = this.shipments.require(glosShipmentId);
    const constraints = shipment.ewaybill.handling.codes;
    const legs = route.legs.map((rl, i) =>
      this.leg(i, rl.mode, rl.origin, rl.destination, this.handover(rl.destination, rl.verification ?? 'geofence'), constraints, rl.constraints ?? []),
    );
    return this.finalize(shipment, legs);
  }

  buildJobRequirementVector(shipment: Shipment): JobRequirementVector {
    return {
      glosShipmentId: shipment.glosShipmentId,
      perLeg: shipment.legs.map((leg) => {
        // Inherited master + leg-specific constraints (M2-062).
        const { mandatoryVCs, equipment } = deriveRequirements([...leg.constraints, ...leg.legConstraints]);
        return { legIndex: leg.index, mode: leg.mode, mandatoryVCs, equipment, maxWeightKg: shipment.ewaybill.packaging.totalWeightKg };
      }),
    };
  }

  // --- internals ---

  private finalize(shipment: Shipment, legs: Leg[]): Shipment {
    shipment.legs = legs;
    shipment.milestones = this.planMilestones(legs);
    shipment.status = 'decomposed';
    this.shipments.appendVersion(shipment, 'leg-decomposition');

    const jrv = this.buildJobRequirementVector(shipment);
    void this.events.publish(GlosEvent.Shipment.LegDecomposed, { glosShipmentId: shipment.glosShipmentId, legs: shipment.legs, milestones: shipment.milestones }, { source: 'm2' }).catch(() => undefined);
    void this.events.publish(GlosEvent.Shipment.JobRequirementVectorReady, jrv, { source: 'm2' }).catch(() => undefined);
    return shipment;
  }

  private planLegs(shipment: Shipment, mode: TransportMode, constraints: string[]): Leg[] {
    const { origin, destination } = shipment;
    if (mode === 'courier' || mode === 'road') {
      return [this.leg(0, 'courier', origin, destination, this.handover(destination, 'signature'), constraints)];
    }
    const originHub = `${origin} Hub`;
    const destHub = `${destination} Hub`;
    return [
      this.leg(0, 'road', origin, originHub, this.handover(originHub, 'geofence'), constraints),
      this.leg(1, mode, originHub, destHub, this.handover(destHub, 'geofence'), constraints),
      this.leg(2, 'courier', destHub, destination, this.handover(destination, 'signature'), constraints),
    ];
  }

  private planMilestones(legs: Leg[]): Milestone[] {
    const milestones: Milestone[] = [{ id: 'ms-pickup', name: 'PICKUP', legIndex: 0 }];
    for (let i = 0; i < legs.length - 1; i += 1) {
      milestones.push({ id: `ms-handover-${i}`, name: 'HANDOVER', legIndex: i });
    }
    milestones.push({ id: 'ms-delivery', name: 'DELIVERY', legIndex: legs.length - 1 });
    return milestones;
  }

  private leg(index: number, mode: TransportMode, origin: string, destination: string, handover: HandoverPoint, constraints: string[], legConstraints: string[] = []): Leg {
    return { index, mode, origin, destination, handover, constraints: [...constraints], legConstraints: [...legConstraints], negotiation: { proposals: [] } };
  }

  private handover(locationName: string, verification: HandoverPoint['verification']): HandoverPoint {
    return { locationId: `LOC-${this.hashId(locationName)}`, geofence: this.geofence(locationName, verification === 'geofence' ? 500 : 150), verification };
  }

  private geofence(locationName: string, radiusM: number): Geofence {
    return { id: `GEO-${this.hashId(locationName)}`, center: LegDecompositionService.geocodeStub(locationName), radiusM };
  }

  private hashId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 10);
  }

  private static geocodeStub(name: string): { lat: number; lng: number } {
    const hash = createHash('sha256').update(name).digest();
    const lat = (hash.readUInt16BE(0) / 65535) * 120 - 60;
    const lng = (hash.readUInt16BE(2) / 65535) * 360 - 180;
    return { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4 };
  }
}
