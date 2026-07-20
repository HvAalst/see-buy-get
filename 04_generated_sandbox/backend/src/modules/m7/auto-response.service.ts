import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DisruptionService } from './disruption.service';
import { OrchestrationService } from './orchestration.service';

/**
 * AutoResponseService (M7-031, the feed→policy loop). Closes the autonomy loop: whenever a
 * disruption is detected — from any source (real feed, webhook, or operator) — it automatically
 * computes the blast radius and evaluates each impacted shipment's shipper policies. Matching rules
 * execute autonomously (still behind the human-in-the-loop gate / anomaly freeze in
 * OrchestrationService), so policies react to live signals with no operator action.
 */
@Injectable()
export class AutoResponseService implements OnModuleInit {
  private readonly logger = new Logger(AutoResponseService.name);

  constructor(
    private readonly disruption: DisruptionService,
    private readonly orchestration: OrchestrationService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<{ id: string }>(GlosEvent.Orchestration.DisruptionDetected, (e) => this.handle(e.payload.id));
  }

  private handle(disruptionId: string): void {
    const impacted = this.disruption.impact(disruptionId);
    const executed: string[] = [];
    const pending: string[] = [];

    for (const shipment of impacted) {
      const action = this.orchestration.evaluate(shipment.glosShipmentId, disruptionId);
      if (!action) continue;
      if (action.status === 'executed') executed.push(action.id);
      else if (action.status === 'pending_approval') pending.push(action.id);
    }

    if (executed.length || pending.length) {
      this.logger.log(`Auto-response for ${disruptionId}: ${executed.length} executed, ${pending.length} awaiting approval (${impacted.length} impacted).`);
    }
    void this.events
      .publish(GlosEvent.Orchestration.AutoResponseCompleted, { disruptionId, impacted: impacted.length, executed, pending }, { source: 'm7' })
      .catch(() => undefined);
  }
}
