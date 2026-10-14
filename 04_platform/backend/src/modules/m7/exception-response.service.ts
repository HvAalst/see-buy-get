import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { OrchestrationService } from './orchestration.service';

/** Severity → assumed delay shock (hours) used to drive policy evaluation. */
const SEVERITY_DELAY_HOURS: Record<string, number> = { critical: 24, high: 12 };

/**
 * ExceptionResponseService (M7-031, telemetry loop). Closes the loop from real tracking telemetry to
 * autonomy: when M4 raises a high/critical `tracking.exception_raised`, the affected shipment's
 * shipper policies are evaluated and may execute autonomously (behind the human-in-the-loop gate).
 * Lower-severity exceptions are left to operators.
 */
@Injectable()
export class ExceptionResponseService implements OnModuleInit {
  private readonly logger = new Logger(ExceptionResponseService.name);

  constructor(
    private readonly orchestration: OrchestrationService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<{ glosShipmentId: string; severity?: string; exceptionType?: string }>(GlosEvent.Tracking.ExceptionRaised, (e) => {
      const delay = SEVERITY_DELAY_HOURS[e.payload.severity ?? ''];
      if (!delay) return; // only high/critical severities drive autonomous response
      const action = this.orchestration.evaluateException(e.payload.glosShipmentId, delay);
      if (action) this.logger.log(`Exception ${e.payload.exceptionType} on ${e.payload.glosShipmentId} → autonomous ${action.option.action} (${action.status}).`);
    });
  }
}
