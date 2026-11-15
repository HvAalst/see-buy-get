import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DispatchService } from './dispatch.service';

/** 2026-11-15 — every minute: a driver's pay held 24 hours with nothing reported is released (the hold, H1). */
@Injectable()
export class PayHoldSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PayHoldSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly dispatch: DispatchService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.dispatch.releaseDueHolds();
        // 2026-11-15 — a reported problem nobody decided in three days: the protocol's answer applies.
        this.dispatch.decideOverdueHolds();
      } catch (err) {
        this.logger.warn(`the pay hold sweep did not run: ${(err as Error).message}`);
      }
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
