import { NotificationService } from './notification.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { FxService } from '../../foundation/money/fx.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { PartnerLedgerService } from './partner-ledger.service';

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** How often closed weeks are looked for: a week closes at midnight on Saturday, UTC; within the hour is soon enough. */
const SWEEP_EVERY_MS = 60 * 60_000;

/** What became of one week's statement in our books: owed when the week closed, paid when staff said so. */
interface StatementRecord {
  accrued?: { at: string; entryId: string; amount: number; currency: string };
  paid?: { at: string; by: string; reference: string; entryId: string };
}

export class PartnerStatementView {
  @ApiProperty() statementId: string;
  @ApiProperty() partnerEntityId: string;
  @ApiProperty() partnerName: string;
  /** The company of ours that owes it: the one that sold the parcels. */
  @ApiProperty() sellerEntityId: string;
  @ApiProperty() sellerName: string;
  /** The week, Sunday to Saturday (UTC). */
  @ApiProperty() weekStart: string;
  @ApiProperty() weekEnd: string;
  /** What is owed, in the partner's money, and how many steps it is made of. */
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() steps: number;
  /** The week is over: its statement stands. */
  @ApiProperty() closed: boolean;
  /** Owed in our books, in the seller's money; and paid, by whom, with the bank transfer's reference. */
  @ApiPropertyOptional() owedInBooks?: number;
  @ApiPropertyOptional() booksCurrency?: string;
  @ApiPropertyOptional() paidAt?: string;
  @ApiPropertyOptional() paidBy?: string;
  @ApiPropertyOptional() paidReference?: string;
}

/** Staff say a week's statement was paid: the bank transfer's reference, and who, where the sign-in names nobody. */
export class PartnerStatementPaidDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(80) reference!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class PartnerStatementsView {
  @ApiProperty({ type: [PartnerStatementView] }) statements: PartnerStatementView[];
  /** Still to pay, in all, per money: closed weeks not paid. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) unpaid: Record<string, number>;
}

/** The Sunday a moment's week starts on, as YYYY-MM-DD (UTC): a week runs Sunday to Saturday. */
export function weekStartOf(iso: string): string {
  const d = new Date(iso);
  const sunday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - d.getUTCDay() * DAY;
  return new Date(sunday).toISOString().slice(0, 10);
}

/**
 * 2026-11-24 — WHAT A COMPANY OF OURS OWES A PARTNER, WEEK BY WEEK (route plan part 4; the owner: "we owe it weekly"). Every step
 * the partner's hands did on parcels a company of ours sold is on the partner's record with that company's share (boughtBy); the
 * week's lines, Sunday to Saturday, make one statement per partner, company and money. When the week is over its statement stands,
 * and the company books what it owes the partner, as a supplier; staff pay it by bank transfer and say so, with the transfer's
 * reference, and the company books it paid. Nothing is paid here: the money moves in the bank.
 */
@Injectable()
export class PartnerStatementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartnerStatementService.name);
  private readonly records = new PersistentMap<string, StatementRecord>('partner-statements');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly ledger: PartnerLedgerService,
    private readonly entities: EntityService,
    private readonly books: BooksService,
    @Optional() private readonly fx?: FxService,
    // 2026-11-26 — told in the partner's own bell: a week that stands, and a week paid.
    @Optional() private readonly notices?: NotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      try {
        this.closeWeeks();
      } catch (err) {
        this.logger.warn(`closing the weeks: ${(err as Error).message}`);
      }
    }, SWEEP_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A partner's statements, newest week first, with what is still to pay. */
  statementsOf(partnerEntityId: string, now: number = Date.now()): PartnerStatementsView {
    const partner = this.entities.get(partnerEntityId);
    const groups = new Map<string, { sellerEntityId: string; weekStart: string; currency: string; amount: number; steps: number }>();
    for (const line of this.ledger.linesOf(partnerEntityId)) {
      for (const share of line.boughtBy ?? []) {
        const weekStart = weekStartOf(line.at);
        const id = statementIdOf(partnerEntityId, weekStart, share.entityId, line.currency);
        const g = groups.get(id) ?? { sellerEntityId: share.entityId, weekStart, currency: line.currency, amount: 0, steps: 0 };
        g.amount = round2(g.amount + share.amount);
        g.steps += share.amount > 0 ? 1 : share.amount < 0 ? -1 : 0;
        groups.set(id, g);
      }
    }
    const statements = [...groups.entries()]
      .filter(([, g]) => g.amount !== 0)
      .map(([statementId, g]): PartnerStatementView => {
        const end = Date.parse(`${g.weekStart}T00:00:00.000Z`) + 7 * DAY;
        const r = this.records.get(statementId);
        let sellerName = g.sellerEntityId;
        try {
          sellerName = this.entities.get(g.sellerEntityId).name;
        } catch {
          // a company this server no longer knows: its id stands
        }
        return {
          statementId,
          partnerEntityId,
          partnerName: partner.name,
          sellerEntityId: g.sellerEntityId,
          sellerName,
          weekStart: g.weekStart,
          weekEnd: new Date(end - DAY).toISOString().slice(0, 10),
          amount: g.amount,
          currency: g.currency,
          steps: Math.max(0, g.steps),
          closed: now >= end,
          ...(r?.accrued ? { owedInBooks: r.accrued.amount, booksCurrency: r.accrued.currency } : {}),
          ...(r?.paid ? { paidAt: r.paid.at, paidBy: r.paid.by, paidReference: r.paid.reference } : {}),
        };
      })
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.sellerName.localeCompare(b.sellerName));
    const unpaid: Record<string, number> = {};
    for (const s of statements) if (s.closed && !s.paidAt && s.amount > 0) unpaid[s.currency] = round2((unpaid[s.currency] ?? 0) + s.amount);
    return { statements, unpaid };
  }

  /**
   * THE WEEKS THAT ARE OVER: each statement that stands and owes something is booked by the company that owes it — the cost of the
   * steps it bought, owed to the partner as a supplier, in its own money. Once each.
   */
  closeWeeks(now: number = Date.now()): number {
    let booked = 0;
    for (const partner of this.entities.list().filter((e) => e.kind === 'partner' && e.status !== 'draft')) {
      for (const s of this.statementsOf(partner.entityId, now).statements) {
        if (!s.closed || s.amount <= 0 || this.records.get(s.statementId)?.accrued) continue;
        const currency = this.currencyOf(s.sellerEntityId) ?? s.currency;
        const amount = round2(currency === s.currency ? s.amount : (this.fx?.convert(s.amount, s.currency, currency) ?? s.amount));
        const entry = this.books.post({
          entityId: s.sellerEntityId,
          kind: 'partner-statement',
          ref: s.statementId,
          currency,
          memo: `${s.partnerName}, the week of ${s.weekStart} to ${s.weekEnd}: ${s.steps} steps on parcels we sold`,
          lines: [
            { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount },
            { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: s.partnerEntityId, amount: -amount },
          ],
        });
        this.records.set(s.statementId, { ...this.records.get(s.statementId), accrued: { at: new Date(now).toISOString(), entryId: entry.entryId, amount, currency } });
        booked += 1;
        this.tell(partner.did, `${s.sellerName} owes you ${moneyOf(amount, currency)} for the week of ${s.weekStart} to ${s.weekEnd}`, `For ${s.steps} steps your people did on parcels it sold. It is paid by bank transfer, and you are told here when.`, `statement:${s.statementId}:owed`);
      }
    }
    return booked;
  }

  /**
   * PAID: staff say a closed week's statement was paid by bank transfer, with the transfer's reference. Refused before anything is
   * written: a week not over, nothing owed, or paid already.
   */
  markPaid(partnerEntityId: string, statementId: string, input: { by: string; reference: string }, now: number = Date.now()): PartnerStatementView {
    const reference = (input.reference ?? '').trim();
    if (reference.length < 3 || reference.length > 80) throw new GlosError('FIELD_REQUIRED', 'Give the bank transfer’s reference, as the bank shows it', { field: 'reference' });
    this.closeWeeks(now);
    const s = this.statementsOf(partnerEntityId, now).statements.find((x) => x.statementId === statementId);
    if (!s) throw new GlosError('NOT_FOUND', 'No such statement for this partner');
    if (!s.closed) throw new GlosError('INVALID_STATE', `The week of ${s.weekStart} is not over yet: its statement is paid once it stands`);
    const r = this.records.get(statementId);
    if (r?.paid) throw new GlosError('INVALID_STATE', `This statement was paid on ${r.paid.at.slice(0, 10)} by ${r.paid.by}`);
    if (!r?.accrued) throw new GlosError('INVALID_STATE', 'Nothing is owed on this statement');
    const entry = this.books.post({
      entityId: s.sellerEntityId,
      kind: 'partner-statement-paid',
      ref: statementId,
      currency: r.accrued.currency,
      memo: `Paid to ${s.partnerName} by bank transfer, reference ${reference}`,
      lines: [
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: partnerEntityId, amount: r.accrued.amount },
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -r.accrued.amount },
      ],
    });
    this.records.set(statementId, { ...r, paid: { at: new Date(now).toISOString(), by: input.by, reference, entryId: entry.entryId } });
    this.tell(this.entities.get(partnerEntityId).did, `${s.sellerName} paid you ${moneyOf(r.accrued.amount, r.accrued.currency)} for the week of ${s.weekStart} to ${s.weekEnd}`, `By bank transfer, reference ${reference}.`, `statement:${statementId}:paid`);
    return this.statementsOf(partnerEntityId, now).statements.find((x) => x.statementId === statementId)!;
  }

  /** 2026-11-26 — a notice in the partner's own bell, opening its Money section. */
  private tell(partnerDid: string, title: string, body: string, tag: string): void {
    void this.notices?.notify(partnerDid, { kind: 'partner_money', title, body, link: '/?go=money', tag }).catch(() => undefined);
  }

  private currencyOf(entityId: string): string | undefined {
    try {
      return this.entities.get(entityId).currency;
    } catch {
      return undefined;
    }
  }
}

/** A statement's id: the partner, the week, the company that owes it, and the money. */
function statementIdOf(partnerEntityId: string, weekStart: string, sellerEntityId: string, currency: string): string {
  return `pst_${weekStart}_${sellerEntityId}_${partnerEntityId}_${currency}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

/** 2026-11-26 — a sum as a notice says it: the money's code and two decimals. */
function moneyOf(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}
