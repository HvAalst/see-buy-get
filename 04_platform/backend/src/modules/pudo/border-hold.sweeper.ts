import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ParcelService } from './parcel.service';

/** 2026-11-19 — every hour: a parcel held by customs and not paid within its days is marked so, and its sender asked (step 3; D5). */
@Injectable()
export class BorderHoldSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BorderHoldSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly parcels: ParcelService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.parcels.lapseUnpaidHolds();
      } catch (err) {
        this.logger.warn(`the customs hold sweep did not run: ${(err as Error).message}`);
      }
    }, 3_600_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
