import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { MailService } from '../../foundation/mail/mail.service';
import { FleetManagerService } from './fleet-manager.service';

/** Machine credentials are worth changing every 90 days (the apps show the same threshold on the card). */
export const CODE_REMINDER_DAYS = 90;
const SWEEP_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Tell a fleet, by email, that its sign-in code is over 90 days old — ONCE per code.
 *
 * The Fleet app says so on the code card, but only to somebody who opens the dashboard; the email reaches the
 * fleet's contact address whether anybody looks or not. Nothing happens when a code gets old, so like the
 * uncollected-parcel reminder this is a sweep, and each reminder is stamped against the code it was about: a new
 * code starts a new clock, and an ignored reminder is never repeated.
 */
@Injectable()
export class CredentialReminderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly reminded = new PersistentMap<string, string>('credential-reminders');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly managers: FleetManagerService,
    @Optional() private readonly mail?: MailService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep().catch(() => undefined);
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many reminders went out. */
  async sweep(now: number = Date.now()): Promise<number> {
    if (!this.mail) return 0;
    let sent = 0;
    for (const m of this.managers.list()) {
      if (m.status !== 'ACTIVE' || !m.loginCode || !m.contactEmail) continue;
      const since = m.codeRotatedAt ?? m.createdAt;
      const days = Math.floor((now - Date.parse(since)) / DAY_MS);
      if (!Number.isFinite(days) || days <= CODE_REMINDER_DAYS) continue;
      const key = `fleet-code:${m.did}:${since}`;
      if (this.reminded.has(key)) continue;
      if (await this.mail.send('fleet-code-due', { address: m.contactEmail, name: m.companyName }, { company: m.companyName, days })) {
        this.reminded.set(key, new Date(now).toISOString());
        sent++;
      }
    }
    return sent;
  }
}
