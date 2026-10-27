import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PersonDoorService } from './person-door.service';

/** Every minute: a payment window is minutes long, and a box held at a hub for a payment that will not come holds up the floor. */
const SWEEP_MS = 60 * 1000;

/**
 * A PERSON'S OWN DOOR, PAID FIRST (the user, 2026-10-27: "Mobile money first"): a payment that did not come in time lets the
 * box go on to the shop; a load no driver has taken in a day is told to its sender; a number nothing is owed back to any
 * more is forgotten (PersonDoorService.sweep). Kept out of that service so a test building it never starts a clock.
 */
@Injectable()
export class PersonDoorSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PersonDoorSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly doors: PersonDoorService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.doors.sweep();
      } catch (err) {
        this.logger.warn(`the door-delivery sweep did not run: ${(err as Error).message}`);
      }
    }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
