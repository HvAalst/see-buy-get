import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EntityService } from '../../foundation/entity/entity.service';
import { NotificationService } from './notification.service';
import { ContainerBoxService } from './container-box.service';
import { BOX_WARN_DAYS, boxClock, boxDueSoon } from './container-box';

const SWEEP_MS = 6 * 60 * 60 * 1000;

/**
 * TELL THEM BEFORE THE DATE, NOT AFTER IT — the other half of Y1.
 *
 * A detention charge that arrives on an invoice is the two-weeks-at-customs story in different clothes:
 * the cost was knowable in advance and nobody said it. So this sweeps the boxes that are out, and warns
 * while there is still time to arrange a truck.
 *
 * WHO IS TOLD, AND WHY BOTH: the agent who booked the box owes its return, and the importer is the one
 * the charge lands on. Warning only the holder of the obligation would leave the payer to find out from
 * the invoice; warning only the payer would tell the person who cannot act.
 *
 * WHAT IT NEVER SAYS: what it will cost. We carry the free days the importer told us and count the days —
 * the rate is in a contract we have never seen, and a figure we invented would be relied on. That is the
 * same line the project holds on duty and on demurrage tariffs.
 *
 * ONCE PER DUE DATE. The key is the spell plus the date it is counting to, so a corrected free-days claim
 * moves the date and earns a fresh warning, while an ignored warning is never repeated — the reminder
 * pattern the fleet credential sweep already uses, for the same reason: a notification that repeats is one
 * people learn to dismiss.
 */
@Injectable()
export class ContainerClockService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly told = new PersistentMap<string, string>('container-clock-warnings');
  private readonly logger = new Logger(ContainerClockService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly boxes: ContainerBoxService,
    private readonly entities: EntityService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep().catch(() => undefined);
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many warnings went out. Callable from a test with a fixed clock. */
  async sweep(now: number = Date.now()): Promise<number> {
    if (!this.notifications) return 0;
    let sent = 0;
    for (const box of this.boxes.all()) {
      for (const term of box.terms) {
        if (term.ending) continue;
        // The same derivation the screens read, so a warning cannot disagree with the countdown beside it.
        const view = this.boxes.viewOf(box.containerNo, now, term.importId ? { importId: term.importId } : {});
        const clock = view?.clock ?? boxClock(term, now);
        if (!clock.dueBackAt || (!boxDueSoon(clock) && !clock.overdue)) continue;

        const key = `${term.termId}:${clock.dueBackAt}:${clock.overdue ? 'over' : 'soon'}`;
        if (this.told.has(key)) continue;

        const owed = term.owedByName ?? 'whoever booked it';
        const title = clock.overdue
          ? `${box.containerNo} is past its free days`
          : `${box.containerNo} is due back ${clock.dueBackAt.slice(0, 10)}`;
        const body = clock.overdue
          ? `${clock.kind === 'detention' ? 'Detention' : 'Demurrage'} ran out on ${clock.dueBackAt.slice(0, 10)} — day ${clock.daysElapsed} of the ${clock.freeDays} free days ${clock.freeDaysBy} recorded. ${owed} booked the box and owes the return${term.importCode ? ` (${term.importCode})` : ''}. What it costs is between you and the line; we only count the days.`
          : `${clock.daysLeft} day${clock.daysLeft === 1 ? '' : 's'} of the ${clock.freeDays} free days ${clock.freeDaysBy} recorded are left${term.importCode ? ` on ${term.importCode}` : ''}. ${owed} booked the box and owes the return, so a truck arranged now is cheaper than one arranged after the date.`;

        for (const entityId of new Set([term.owedByEntityId, term.importerEntityId].filter(Boolean) as string[])) {
          const did = this.entities.find(entityId)?.did;
          if (!did) continue;
          try {
            await this.notifications.notify(did, {
              kind: 'box_due',
              title,
              body,
              link: '/',
              tag: `box:${term.termId}:${clock.overdue ? 'over' : 'soon'}`,
              data: { containerNo: box.containerNo, ...(term.importId ? { importId: term.importId } : {}) },
            });
            sent += 1;
          } catch (err) {
            this.logger.warn(`box-due notify failed for ${box.containerNo}: ${(err as Error).message}`);
          }
        }
        this.told.set(key, new Date(now).toISOString());
      }
    }
    return sent;
  }

  /** How many days ahead this warns. Exported for the screens, so the two cannot disagree. */
  static readonly warnDays = BOX_WARN_DAYS;
}
