import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import type { PresenceCapability } from '../presence/presence.types';
import { PersistentMap } from '../store/persistent-map';
import { EntityAdminService } from './entity-admin.service';
import { EntityService } from './entity.service';

const SWEEP_MS = 6 * 60 * 60 * 1000;

/**
 * How many days before a licence or a policy runs out its company is told — and once more on the day it has lapsed.
 * The first mark is far out on purpose: renewing with a regulator or an insurer is weeks of somebody else's time.
 */
export const PAPER_REMINDER_DAYS = [60, 30, 14, 7, 1] as const;
export type PaperStage = (typeof PAPER_REMINDER_DAYS)[number] | 'lapsed';
/** From this mark on, the company's PARENT is told as well: a paper a week from lapsing is no longer one company's affair. */
export const PAPER_ESCALATES_AT_DAYS = 7;

/** A licence or policy that is running out, as `EntityService.expiring` lists it. */
export interface DatedPaper {
  entityId: string;
  name: string;
  jurisdiction?: string;
  source: 'licence' | 'insurance';
  kind: string;
  reference: string;
  expiresAt: string;
  supports: string[];
  lapsed: boolean;
  daysLeft: number;
}

/** What the company was last told about one paper — or that there was nobody to tell. */
export interface PaperTold {
  stage: PaperStage;
  at: string;
  /** How many administrators it was handed over for, of how many there were to tell. */
  to: number;
  of: number;
  /** Nobody at the company, or above it, has a login: the reminder went nowhere, and staff are the only ones who know. */
  nobody?: true;
}

export type WatchedPaper = DatedPaper & { told?: PaperTold };

const LICENCE_WORDS: Record<string, string> = {
  courier: 'Courier licence',
  postal: 'Postal licence',
  transport_operator: 'Transport operator licence',
  customs_broker: 'Customs broker licence',
  money_handling: 'Money handling licence',
};
const INSURANCE_WORDS: Record<string, string> = {
  goods_in_transit: 'Goods-in-transit insurance',
  claims_provision: 'Claims provision',
  public_liability: 'Public liability insurance',
  motor_fleet: 'Motor fleet insurance',
};
/** The same words the console uses for what a paper permits (tower.presence.cap.*). */
const CAPABILITY_WORDS: Partial<Record<PresenceCapability, string>> = {
  takeIn: 'take goods in',
  merchantOfRecord: 'charge customers',
  holdFloat: 'hold float',
  cashOnDelivery: 'handle cash',
  claims: 'pay claims',
  tax: 'collect tax',
  payouts: 'pay suppliers',
};

/** The paper, in words somebody at the company would use for it. */
export function paperWords(source: 'licence' | 'insurance', kind: string): string {
  return (source === 'licence' ? LICENCE_WORDS[kind] : INSURANCE_WORDS[kind]) ?? (source === 'licence' ? 'Licence' : 'Insurance policy');
}

/** What switches off when it lapses, in words. Empty: nothing does by itself. */
export function stopsWords(supports: string[]): string[] {
  return supports.map((c) => CAPABILITY_WORDS[c as PresenceCapability]).filter((w): w is string => Boolean(w));
}

/**
 * The mark a paper has reached: the nearest one at or past its days left — twelve days left is past the 14-day mark
 * and not yet at the 7. Lapsed is the last mark of all.
 */
export function stageOf(paper: { lapsed: boolean; daysLeft: number }): PaperStage | undefined {
  if (paper.lapsed) return 'lapsed';
  return [...PAPER_REMINDER_DAYS].sort((a, b) => a - b).find((d) => paper.daysLeft <= d);
}

/** Later marks outrank earlier ones: a paper told at 30 days is told again at 14, never again at 60. */
function rank(stage: PaperStage): number {
  return stage === 'lapsed' ? PAPER_REMINDER_DAYS.length : PAPER_REMINDER_DAYS.indexOf(stage);
}

/**
 * A COMPANY OF OURS IS TOLD BEFORE ITS OWN PAPER LAPSES.
 *
 * A licence or a policy has an expiry date, and the day after it the capability it supports is off in its country:
 * a courier licence, and the company can no longer charge customers; a goods-in-transit policy, and it can no longer
 * pay a claim. That half was built (CA5). The other half of the same sentence in the design note — "ahead of it, the
 * company's administrators are told" — was not: the console listed what was lapsing for network staff, and the people
 * who could renew it, the company's own administrators, heard nothing. A country could stop charging its customers
 * on a date everybody at that company had forgotten.
 *
 * So, by the clock: at each mark (PAPER_REMINDER_DAYS) and on the day it has lapsed, every administrator of the
 * company is emailed which paper, when, what stops, and where to put the new date. From a week out — and whenever the
 * company has no administrator of its own — its parent's administrators are told too. Once per mark per expiry date:
 * a renewed paper has a new date, and starts again. Where there is NOBODY to tell, that is kept and shown to staff,
 * because a reminder that went nowhere is the one thing a list of reminders must not hide.
 *
 * (A fleet's vehicles and drivers have had this since FP4 — papers-watch.service.ts. This is the same promise kept
 * for the companies that are ours.)
 */
@Injectable()
export class CompanyPapersWatch implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CompanyPapersWatch.name);
  /** What each paper's company was last told, by paper and expiry date. Beside the company record, not on it. */
  private readonly told = new PersistentMap<string, PaperTold>('company-paper-reminders');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly entities: EntityService,
    private readonly admins: EntityAdminService,
    // Optional so a hand-built module keeps compiling; without it nothing can be sent, and nothing is noted as sent.
    @Optional() private readonly mail?: MailService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep().catch((err) => this.logger.warn(`company papers sweep failed: ${(err as Error).message}`));
    this.timer = setInterval(() => void this.sweep().catch((err) => this.logger.warn(`company papers sweep failed: ${(err as Error).message}`)), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Every paper running out within the window, with what its company was last told. `reach`: only these companies. */
  list(now: number = Date.now(), withinDays = 60, reach?: Set<string>): WatchedPaper[] {
    return this.entities
      .expiring(now, withinDays)
      .filter((p) => !reach || reach.has(p.entityId))
      .map((p) => {
        const told = this.told.get(this.keyOf(p));
        return { ...p, ...(told ? { told } : {}) };
      });
  }

  /**
   * LOOK AT EVERY PAPER, and tell the company of each that has reached a mark it has not been told of. Returns what
   * it did: emails handed over, papers told, and papers with nobody to tell.
   */
  async sweep(now: number = Date.now()): Promise<{ mails: number; papers: number; nobody: number }> {
    const out = { mails: 0, papers: 0, nobody: 0 };
    if (!this.mail) return out;
    for (const paper of this.entities.expiring(now, PAPER_REMINDER_DAYS[0])) {
      const stage = stageOf(paper);
      if (stage === undefined) continue;
      const key = this.keyOf(paper);
      const last = this.told.get(key);
      // A mark that reached NOBODY is not a mark that was told: the day the company gets an administrator, they hear.
      if (last && !last.nobody && rank(last.stage) >= rank(stage)) continue;

      const recipients = this.recipientsOf(paper.entityId, stage);
      if (recipients.length === 0) {
        // Noted — and shown to staff, who can act on it. Once per mark: the same nothing is not written every six hours.
        if (!(last?.nobody && last.stage === stage)) {
          this.told.set(key, { stage, at: new Date(now).toISOString(), to: 0, of: 0, nobody: true });
          out.nobody += 1;
        }
        continue;
      }
      // A company not switched on yet has nothing running, so nothing of its stops (EntityService.lapsesFor leaves a
      // draft out for the same reason): it is told the paper is running out, and is not told a thing that is not so.
      const running = this.entities.find(paper.entityId)?.status !== 'draft';
      let sent = 0;
      for (const admin of recipients) {
        const ok = await this.mail.send(
          'company-paper-lapsing',
          { address: admin.email, name: admin.name },
          {
            company: paper.name,
            ...(paper.jurisdiction ? { country: paper.jurisdiction } : {}),
            paper: paperWords(paper.source, paper.kind),
            reference: paper.reference,
            expiresOn: paper.expiresAt,
            daysLeft: Math.max(0, paper.daysLeft),
            lapsed: paper.lapsed,
            stops: running ? stopsWords(paper.supports) : [],
            where: paper.source,
          },
          now,
        );
        if (ok) sent += 1;
      }
      // Noted once it was ATTEMPTED, whether or not the provider took it this minute. Where the provider was not
      // there, the mail service keeps the email and tries again for two days — a second attempt from here would send
      // it twice. Where this one email was turned down, or its address has bounced, asking again in six hours is the
      // same refusal or a second email: the next mark sends its own. What the list shows is how many it was handed
      // over for, of how many there were — so somebody can tell them where the email did not.
      this.told.set(key, { stage, at: new Date(now).toISOString(), to: sent, of: recipients.length });
      out.mails += sent;
      out.papers += 1;
    }
    return out;
  }

  /**
   * Who is told: the company's own administrators; and its parent's as well, once the paper is a week from lapsing or
   * the company has none of its own. (Nobody is on both lists: one login administers one company.)
   */
  private recipientsOf(entityId: string, stage: PaperStage): Array<{ email: string; name: string }> {
    const own = this.admins.list(entityId);
    const escalate = own.length === 0 || stage === 'lapsed' || stage <= PAPER_ESCALATES_AT_DAYS;
    const parentId = escalate ? this.entities.find(entityId)?.parentEntityId : undefined;
    const above = parentId ? this.admins.list(parentId) : [];
    return [...own, ...above].map((a) => ({ email: a.email, name: a.name }));
  }

  /** One paper on one date: renewed, it is another paper as far as reminders go. */
  private keyOf(p: Pick<DatedPaper, 'entityId' | 'source' | 'kind' | 'reference' | 'expiresAt'>): string {
    return [p.entityId, p.source, p.kind, p.reference, p.expiresAt].join('|');
  }
}
