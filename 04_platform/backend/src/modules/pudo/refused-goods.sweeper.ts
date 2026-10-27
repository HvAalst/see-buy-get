import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DispatchService } from './dispatch.service';

/** Often enough that "48 hours" means 48 hours and not 49; the sweep itself is cheap. */
const SWEEP_MS = 10 * 60 * 1000;

/**
 * THE 48 HOURS ON REFUSED GOODS (the user, 2026-10-27: "Back after 2 days"). A sender that has not said where goods
 * refused at the door go is told before the time is up, and at the end of it they go back to where they were picked up,
 * at its cost (DispatchService.sweepRefusals). Kept out of DispatchService so that a test building that service never
 * starts a clock.
 */
@Injectable()
export class RefusedGoodsSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RefusedGoodsSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly dispatch: DispatchService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.dispatch.sweepRefusals();
      } catch (err) {
        this.logger.warn(`the refused-goods sweep did not run: ${(err as Error).message}`);
      }
      // A matched load delivered three days ago that nobody said was paid: its carrier is asked (2026-10-27).
      try {
        this.dispatch.sweepUnconfirmedPay();
      } catch (err) {
        this.logger.warn(`the were-you-paid sweep did not run: ${(err as Error).message}`);
      }
    }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
