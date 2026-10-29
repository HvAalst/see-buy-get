import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { CallOffService } from './call-off.service';
import { BusinessDoorService } from './business-door.service';

/** Often enough that "a day" means a day and not a day and an hour; the sweep itself is cheap. */
const SWEEP_MS = 10 * 60 * 1000;

/**
 * A DAY WITH NO DRIVER (the user, 2026-10-27: "Switch to a shop"): a store whose load to its own door nobody has taken in
 * DOOR_LOAD_REMIND_H hours is told, once, that it can raise the most it pays or send the box to a shop instead
 * (CallOffService.remindDoorLoads). Kept out of that service so that a test building it never starts a clock.
 */
@Injectable()
export class DoorLoadSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DoorLoadSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly callOffs: CallOffService,
    // A business's last leg to its own door, untaken in a day (2026-10-29): told the same way.
    @Optional() private readonly doors?: BusinessDoorService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.callOffs.remindDoorLoads();
        this.doors?.remindUntaken();
      } catch (err) {
        this.logger.warn(`the door-load sweep did not run: ${(err as Error).message}`);
      }
    }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
