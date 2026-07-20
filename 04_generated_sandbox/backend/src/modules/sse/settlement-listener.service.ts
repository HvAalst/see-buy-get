import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { EscrowService } from './escrow.service';
import { MilestoneName } from './escrow.types';

/**
 * SettlementListener (SSE-030). The settlement loop: M4 oracle events drive escrow releases.
 * tracking.pickup_ok → PICKUP, handover_ok → HANDOVER, delivered → DELIVERY.
 */
@Injectable()
export class SettlementListener implements OnModuleInit {
  private readonly logger = new Logger(SettlementListener.name);

  constructor(
    private readonly events: EventBus,
    private readonly escrow: EscrowService,
  ) {}

  onModuleInit(): void {
    this.subscribe(GlosEvent.Tracking.PickupOk, 'PICKUP');
    this.subscribe(GlosEvent.Tracking.HandoverOk, 'HANDOVER');
    this.subscribe(GlosEvent.Tracking.Delivered, 'DELIVERY');

    // M3 match → auto-create the escrow from the agreed terms (replaces the manual stand-in).
    this.events.subscribe<{ glosShipmentId: string; payerDid: string; currency: string; total: number; milestones: Array<{ name: 'PICKUP' | 'HANDOVER' | 'DELIVERY'; percent: number; payeeDid: string }> }>(
      GlosEvent.Match.Confirmed,
      (event) => {
        const m = event.payload;
        try {
          this.escrow.create({ glosShipmentId: m.glosShipmentId, payerDid: m.payerDid, currency: m.currency, totalAmount: m.total, milestones: m.milestones });
          this.logger.log(`Escrow created from match for ${m.glosShipmentId}`);
        } catch {
          // escrow may already exist for this shipment — ignore
        }
      },
    );
  }

  private subscribe(topic: string, milestone: MilestoneName): void {
    this.events.subscribe<{ glosShipmentId: string; eventId?: string }>(topic, (event) => {
      const result = this.escrow.releaseByMilestone(event.payload.glosShipmentId, milestone, event.payload.eventId);
      if (result.released) {
        this.logger.log(`Released ${milestone} for ${event.payload.glosShipmentId}`);
      }
    });
  }
}
