import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ImportService } from './import.service';

/** Often enough that a warning on the last free day comes within ten minutes of it. */
const SWEEP_MS = 10 * 60 * 1000;

/**
 * THE RAIL TERMINAL'S FREE DAYS, WATCHED (2026-10-29, where road meets rail): the importer and its agent are told on the
 * last free day at the rail terminal, and once when they ended with the box still there (ImportService.sweepRail). Kept
 * out of the service so a test building it never starts a clock.
 */
@Injectable()
export class RailTerminalSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RailTerminalSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly imports: ImportService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.imports.sweepRail();
      } catch (err) {
        this.logger.warn(`the rail terminal sweep did not run: ${(err as Error).message}`);
      }
    }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
