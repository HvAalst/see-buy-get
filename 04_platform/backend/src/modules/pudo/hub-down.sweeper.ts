import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { MdpService } from './mdp.service';

const SWEEP_MS = 15 * 60 * 1000;

/**
 * 2026-11-11 — THE DAILY BELL OF A HUB THAT IS DOWN (the owner: "we need to confirm before it opens whether it actually will
 * be open through a daily bell"): every quarter hour, MdpService.sweepDown asks each hub that is down once a day, opens the
 * ones past a time they confirmed, and tells the ones past a time they never confirmed that they stay closed.
 */
@Injectable()
export class HubDownSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HubDownSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly mdps: MdpService) {}

  onApplicationBootstrap(): void {
    this.run();
    this.timer = setInterval(() => this.run(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private run(): void {
    try {
      this.mdps.sweepDown();
    } catch (err) {
      this.logger.warn(`the hub-down bell did not run: ${(err as Error).message}`);
    }
  }
}
