import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PlannedLeg, PlannedMilestone, TrackingContext } from './tracking.types';

/**
 * TrackingContextService (T4-002). Holds each shipment's planned route (legs, handover points,
 * geofences, milestones). Populated by subscribing to M2's `shipment.leg_decomposed` event;
 * a direct `register` path stays for tests/back-fill. Events for an unknown shipment are still
 * accepted by the tracker, just flagged "no context".
 */
@Injectable()
export class TrackingContextService implements OnModuleInit {
  private readonly contexts = new Map<string, TrackingContext>();

  constructor(private readonly events: EventBus) {}

  onModuleInit(): void {
    this.events.subscribe<{ glosShipmentId: string; legs: PlannedLeg[]; milestones: PlannedMilestone[] }>(
      GlosEvent.Shipment.LegDecomposed,
      (event) => {
        const { glosShipmentId, legs, milestones } = event.payload;
        this.register(glosShipmentId, legs, milestones);
      },
    );
  }

  register(glosShipmentId: string, legs: PlannedLeg[], milestones: PlannedMilestone[]): TrackingContext {
    const context: TrackingContext = { glosShipmentId, legs, milestones, registeredAt: new Date().toISOString() };
    this.contexts.set(glosShipmentId, context);
    return context;
  }

  get(glosShipmentId: string): TrackingContext | undefined {
    return this.contexts.get(glosShipmentId);
  }

  has(glosShipmentId: string): boolean {
    return this.contexts.has(glosShipmentId);
  }
}
