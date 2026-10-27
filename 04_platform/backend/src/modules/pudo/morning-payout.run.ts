import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import type { Entity } from '../../foundation/entity/entity.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { OperatorAccountService } from '../../foundation/entity/operator-account.service';
import { MailService } from '../../foundation/mail/mail.service';
import type { Signer } from '../../foundation/entity/same-person';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { clockAt, clocksOfCountry } from './fleet-clock';

/** When the morning run is raised: 06:00 on the clock of the country the company is in. */
export const MORNING_RUN_AT_MIN = 6 * 60;

/** Who raises it: the system, not a person — so ONE member of staff approving it is still two parties to every payout. */
export const MORNING_RUN_SIGNER: Signer = { name: 'SeeBuyGet morning run', key: 'system:morning-run' };

/** Often enough that "06:00" means a few minutes past six. */
const TICK_MS = 10 * 60 * 1000;

/**
 * THE MORNING PAYOUT RUN (the user, 2026-10-27: "Morning run, one approves"). Every morning at MORNING_RUN_AT_MIN, on its
 * own country's clock, each company that transacts has its payout run raised by the system — what providers earned and what
 * people are owed back — and one member of staff checks it and approves sending, as before (PayoutService.submit refuses
 * the approver who raised it, and the system is not a person). Raised once a day per company; a server that was down at six
 * raises it at its next tick. Nothing is sent here: raising is a request, the approval hands it to the rail.
 */
@Injectable()
export class MorningPayoutRun implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MorningPayoutRun.name);
  /** The day, on the company's own clock, its morning run was last raised. */
  private readonly ran = new PersistentMap<string, string>('payout-morning-runs');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly entities: EntityService,
    private readonly payouts: PayoutService,
    // Who is told a run waits: the members of staff who hold the money role (2026-10-27).
    @Optional() private readonly staff?: OperatorAccountService,
    @Optional() private readonly mail?: MailService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Each company whose morning has come and that has not run today: its run, raised by the system. Answers which ran. */
  tick(now: number = Date.now()): Array<{ entityId: string; day: string; raised: number; skipped: number }> {
    const out: Array<{ entityId: string; day: string; raised: number; skipped: number }> = [];
    for (const entity of this.entities.sisters()) {
      const zone = clocksOfCountry(entity.jurisdiction, now)[0] ?? 'UTC';
      const local = clockAt(now, zone);
      if (local.minutes < MORNING_RUN_AT_MIN || this.ran.get(entity.entityId) === local.day) continue;
      // Marked first: a run that throws half way is looked at by a person, not raised again every ten minutes.
      this.ran.set(entity.entityId, local.day);
      try {
        const run = this.payouts.runFor(entity.entityId, now, MORNING_RUN_SIGNER);
        out.push({ entityId: entity.entityId, day: local.day, raised: run.raised.length, skipped: run.skipped.length });
        if (run.raised.length) this.tellMoneyStaff(entity, local.day, run, now);
      } catch (err) {
        this.logger.warn(`the morning payout run for ${entity.entityId} was not raised: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /**
   * A RUN NOBODY APPROVES PAYS NOBODY: every member of staff who holds the money role is emailed that this company's run
   * waits — how many, how much, how many skipped — and opens the console to approve it. Nothing to say for a run that raised
   * nothing. Email is where they are reached at six in the morning; the console's Money screen holds the rest.
   */
  private tellMoneyStaff(entity: Entity, day: string, run: { raised: Array<{ amount?: number }>; skipped: unknown[] }, now: number): void {
    const total = run.raised.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const money = `${entity.currency ? `${entity.currency} ` : ''}${total.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    for (const member of this.staff?.list(now) ?? []) {
      if (!member.roles?.includes('money')) continue;
      void this.mail
        ?.send('payout-run-waiting', { address: member.email, name: member.name }, { company: entity.name, day, count: run.raised.length, total: money, skipped: run.skipped.length }, now)
        .catch((err: Error) => this.logger.warn(`the morning run's email to ${member.email} was not sent: ${err.message}`));
    }
  }

  /** When this company's morning run was last raised, by its own clock's day — for the console. */
  lastRanOn(entityId: string): string | undefined {
    return this.ran.get(entityId);
  }
}
