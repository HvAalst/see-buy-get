import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DispatchService } from './dispatch.service';

/**
 * 2026-11-24 — A CODE ABOUT TO RUN OUT (the owner's brief, feature 2: "an alert notification to both the Sender and Assigned
 * Carrier/Dispatcher 24 hours before ro_uit_expires_at"): every ten minutes, each UIT or UTN on a load still moving whose end is
 * within a day, or already past, is told once: to the sender, who gives a new one, and to the carrier's driver and office.
 */
@Injectable()
export class FiscalCodeSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FiscalCodeSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly dispatch: DispatchService,
    private readonly events: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        this.logger.warn(`the fiscal code sweep did not run: ${(err as Error).message}`);
      }
    }, 600_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Tell each code due once; how many were told. */
  sweep(now: number = Date.now()): number {
    const due = this.dispatch.fiscalCodesToTell(now);
    for (const d of due) {
      void this.events.publish(GlosEvent.Pudo.FiscalCodeExpiring, d, { source: 'pudo' }).catch(() => undefined);
      this.dispatch.markFiscalTold(d.freightId, d.key);
    }
    return due.length;
  }
}
