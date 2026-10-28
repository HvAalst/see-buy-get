import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ExportService } from './export.service';

/** Often enough that a six-hour warning comes within ten minutes of six hours. */
const SWEEP_MS = 10 * 60 * 1000;

/**
 * THE GATE CUT-OFF WATCH (2026-10-27, exports to the port): the exporter is told when the box must leave, when the gate
 * closed without it, and when the VGM is due (ExportService.sweep). Kept out of the service so a test building it never
 * starts a clock.
 */
@Injectable()
export class ExportCutoffSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExportCutoffSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly exports: ExportService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.exports.sweep();
      } catch (err) {
        this.logger.warn(`the export cut-off sweep did not run: ${(err as Error).message}`);
      }
    }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
