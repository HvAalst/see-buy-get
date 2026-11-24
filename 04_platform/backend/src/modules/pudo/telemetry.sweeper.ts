import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';

/**
 * 2026-11-24 — EVERY MINUTE, THE GPS WATCH (the owner's brief, feature 4: "trigger an immediate dispatcher & driver alert if
 * last_ping_at exceeds 15 minutes while ACTIVE_IN_RO"): a silence in Romania is told, a watch whose shift ended or whose cargo
 * is gone is closed, and positions older than their keeping are deleted.
 */
@Injectable()
export class TelemetrySweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelemetrySweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly telemetry: TelemetryService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.telemetry.sweep();
      } catch (err) {
        this.logger.warn(`the GPS watch sweep did not run: ${(err as Error).message}`);
      }
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
