import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SavedTripService } from './saved-trip.service';

const SWEEP_MS = 5 * 60 * 1000;

/** 2026-11-12 — saved trips' bells: every five minutes, the runs coming up (saved-trip.service.ts sweep). */
@Injectable()
export class SavedTripSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SavedTripSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly trips: SavedTripService) {}

  onApplicationBootstrap(): void {
    // Under jest nothing ticks: a test sweeps when it means to.
    if (process.env.JEST_WORKER_ID) return;
    this.run();
    this.timer = setInterval(() => this.run(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private run(): void {
    try {
      this.trips.sweep();
    } catch (err) {
      this.logger.warn(`the saved trips' bells did not run: ${(err as Error).message}`);
    }
  }
}
