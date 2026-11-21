import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PaymentHubService } from '../../foundation/payment-hub/payment-hub.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { PartnerLedgerService, type PartnerOwedLine, type PartnerPayeeKind } from './partner-ledger.service';
import { PayoutNumberService } from './payout-number.service';

/** The hour of the day (UTC) a partner's hands are paid: 15:00 UTC is 18:00 in East Africa, the end of a working day. */
export const PAYOUT_HOUR_UTC = 15;
/** A payout that waits (no number yet, a number just changed, the account short) is tried again this often. */
export const PAYOUT_AGAIN_AFTER_MS = 60 * 60_000;
/** How often the run looks whether anything is due. */
const LOOK_EVERY_MS = 10 * 60_000;

export const PAYOUT_WAITS = ['no_number', 'number_new', 'balance', 'refused', 'unreachable'] as const;
export type PayoutWait = (typeof PAYOUT_WAITS)[number];

/**
 * 2026-11-20 — WHAT A PARTNER OWES, PAID (the payments plan, 4c; P4-b "once per day"; P3-d "the payout waits"). Once a day every
 * hand a partner owes — a shop, a hub, a courier, a fleet for its drivers — is paid what it is owed, from the partner's own
 * account through the payment hub, to the number the hand set and confirmed itself. One payout per hand per day, for every
 * step not paid yet, steps taken back netted against it. A payout that cannot go waits — no number set yet, a number changed
 * less than a day ago, or the partner's account short — and is tried again every hour; the partner is told on its own screen,
 * and the hand sees "owed, not paid". Nothing is ever sent twice: a payout whose payment is still on its way is not sent again.
 */
export interface PartnerPayout {
  payoutId: string;
  partnerEntityId: string;
  partnerName: string;
  payeeId: string;
  payeeKind: PartnerPayeeKind;
  amount: number;
  currency: string;
  /** The owed lines it pays — and the take-backs netted in. Each line is paid once: by this payout, and no other. */
  lineIds: string[];
  state: 'waiting' | 'paid';
  /** Why it waits, where it does. */
  why?: PayoutWait;
  /** The hub's payment that carries it — the last one tried. */
  hubPaymentId?: string;
  /** The number it went to, masked. */
  numberMasked?: string;
  /** The UTC day it was made for. */
  day: string;
  createdAt: string;
  tries: number;
  lastTriedAt?: string;
  paidAt?: string;
  /** Asked now by our staff, by name, rather than at the day's hour. */
  askedBy?: string;
}

export class PartnerPayoutRow {
  @ApiProperty() payoutId: string;
  @ApiProperty() payeeId: string;
  @ApiProperty({ enum: ['shop', 'hub', 'driver', 'fleet'] }) payeeKind: PartnerPayeeKind;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() steps: number;
  @ApiProperty({ enum: ['waiting', 'paid'] }) state: 'waiting' | 'paid';
  @ApiPropertyOptional({ enum: PAYOUT_WAITS }) why?: PayoutWait;
  @ApiPropertyOptional() numberMasked?: string;
  @ApiProperty() day: string;
  @ApiPropertyOptional() paidAt?: string;
  @ApiPropertyOptional({ description: 'Paid out now by our staff, by name, rather than at the day’s hour.' }) askedBy?: string;
}

/** A partner's payouts, as its own people and our staff read them: what waits, and why; what was paid. */
export class PartnerPayoutsView {
  @ApiProperty() currency: string;
  @ApiProperty() waiting: number;
  @ApiProperty() waitingAmount: number;
  @ApiProperty({ description: 'Of what waits, what waits for the partner’s account to hold enough.' }) shortAmount: number;
  @ApiProperty() paidAmount: number;
  @ApiProperty({ type: [PartnerPayoutRow] }) rows: PartnerPayoutRow[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

@Injectable()
export class PartnerPayoutService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PartnerPayouts');
  private readonly payouts = new PersistentMap<string, PartnerPayout>('partner-payouts');
  /** The last UTC day the run made its payouts: once a day. */
  private readonly runs = new PersistentMap<string, { day: string; at: string }>('partner-payout-runs');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly ledger: PartnerLedgerService,
    private readonly numbers: PayoutNumberService,
    @Optional() private readonly hub?: PaymentHubService,
    @Optional() private readonly events?: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick().catch((err) => this.logger.warn(`partner payouts: ${(err as Error).message}`)), LOOK_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Every ten minutes: the day's payouts once the hour has come, and every waiting payout once an hour. */
  async tick(now: number = Date.now()): Promise<void> {
    if (this.running || !this.hub) return;
    this.running = true;
    try {
      const day = dayOf(now);
      if (new Date(now).getUTCHours() >= PAYOUT_HOUR_UTC && this.runs.get('last')?.day !== day) {
        this.runs.set('last', { day, at: new Date(now).toISOString() });
        for (const partnerEntityId of this.ledger.partnersWithLines()) this.make(partnerEntityId, now);
      }
      await this.tryWaiting(now);
    } finally {
      this.running = false;
    }
  }

  /**
   * Our staff pay a partner's hands NOW, rather than at the day's hour — by name: to try it, or after the partner's account
   * was topped up. The day's own run still comes; it only finds less to pay.
   */
  async payNow(partnerEntityId: string, by: string, now: number = Date.now()): Promise<PartnerPayoutsView> {
    if (!this.hub) throw new GlosError('INVALID_STATE', 'Payment by phone is not set up on this server');
    if (!by?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say who pays out: it is kept by name');
    this.make(partnerEntityId, now, by.trim());
    await this.tryWaiting(now, partnerEntityId, true);
    return this.viewOf(partnerEntityId);
  }

  /**
   * THE DAY'S PAYOUTS for one partner: per hand, every line not paid yet — the steps owed and the take-backs — in one payout,
   * where they come to more than nothing. A hand whose take-backs come to as much as what it is owed waits for its next step.
   */
  make(partnerEntityId: string, now: number = Date.now(), askedBy?: string): PartnerPayout[] {
    const covered = new Set<string>();
    for (const p of this.payouts.values()) if (p.partnerEntityId === partnerEntityId) for (const id of p.lineIds) covered.add(id);
    const open = new Map<string, PartnerOwedLine[]>();
    for (const line of this.ledger.linesOf(partnerEntityId)) {
      if (covered.has(line.lineId)) continue;
      const list = open.get(line.payeeId) ?? [];
      list.push(line);
      open.set(line.payeeId, list);
    }
    const made: PartnerPayout[] = [];
    for (const [payeeId, lines] of open) {
      const amount = round2(lines.reduce((sum, l) => sum + l.amount, 0));
      if (!(amount > 0.005)) continue;
      const first = lines[0];
      const payout: PartnerPayout = {
        payoutId: `pp_${randomBytes(9).toString('base64url')}`,
        partnerEntityId,
        partnerName: first.partnerName,
        payeeId,
        payeeKind: first.payeeKind,
        amount,
        currency: first.currency,
        lineIds: lines.map((l) => l.lineId),
        state: 'waiting',
        day: dayOf(now),
        createdAt: new Date(now).toISOString(),
        tries: 0,
        ...(askedBy ? { askedBy } : {}),
      };
      this.payouts.set(payout.payoutId, payout);
      made.push(payout);
    }
    if (made.length) this.told(partnerEntityId);
    return made;
  }

  /** Every waiting payout not tried in the last hour (or all of one partner's, when staff pay now): tried again. */
  async tryWaiting(now: number = Date.now(), onlyPartner?: string, regardless = false): Promise<void> {
    const due = [...this.payouts.values()].filter(
      (p) => p.state === 'waiting' && (!onlyPartner || p.partnerEntityId === onlyPartner) && (regardless || !p.lastTriedAt || now - Date.parse(p.lastTriedAt) >= PAYOUT_AGAIN_AFTER_MS),
    );
    for (const p of due.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) await this.attempt(p.payoutId, now);
  }

  /**
   * ONE PAYOUT, TRIED: to the hand's own number, from the partner's account. Never sent while an earlier try is still on its way;
   * paid once the provider says so; waiting, with why, where it cannot go.
   */
  async attempt(payoutId: string, now: number = Date.now()): Promise<PartnerPayout> {
    const p = this.payouts.get(payoutId);
    if (!p || p.state === 'paid' || !this.hub) return p as PartnerPayout;
    // An earlier try still on its way is waited for, never sent again; one that was paid, is.
    if (p.hubPaymentId) {
      const earlier = await this.hub.settle(p.hubPaymentId, now).catch(() => this.hub?.get(p.hubPaymentId as string));
      if (earlier?.state === 'paid') return this.save({ ...p, state: 'paid', paidAt: earlier.settledAt ?? new Date(now).toISOString() });
      if (earlier?.state === 'asked') return this.save({ ...p, lastTriedAt: new Date(now).toISOString(), why: 'unreachable' });
    }
    const tried = { ...p, tries: p.tries + 1, lastTriedAt: new Date(now).toISOString() };
    const to = this.numbers.partnerDestination(p.payeeId, now);
    if ('reason' in to) return this.save({ ...tried, why: to.reason === 'number_new' ? 'number_new' : 'no_number' });
    const msisdn = this.numbers.fullNumber(p.payeeId, to.numberId);
    if (!msisdn) return this.save({ ...tried, why: 'no_number' });
    const paid = await this.hub.payout(p.partnerEntityId, { reference: p.payoutId, amount: p.amount, payeePhone: `+${msisdn}`, description: `${p.partnerName}: ${p.lineIds.length} steps` }, now);
    const next: PartnerPayout = { ...tried, hubPaymentId: paid.paymentId, numberMasked: to.masked };
    if (paid.state === 'paid') return this.save({ ...next, state: 'paid', paidAt: paid.settledAt ?? new Date(now).toISOString(), why: undefined });
    if (paid.state === 'asked') return this.save({ ...next, why: 'unreachable' });
    return this.save({ ...next, why: paid.why === 'insufficient' ? 'balance' : 'refused' });
  }

  /** A partner's payouts: what waits and why, what was paid. Newest first. */
  viewOf(partnerEntityId: string, limit = 100): PartnerPayoutsView {
    const mine = [...this.payouts.values()].filter((p) => p.partnerEntityId === partnerEntityId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const waiting = mine.filter((p) => p.state === 'waiting');
    return {
      currency: mine[0]?.currency ?? this.ledger.ledgerOf(partnerEntityId).currency,
      waiting: waiting.length,
      waitingAmount: round2(waiting.reduce((s, p) => s + p.amount, 0)),
      shortAmount: round2(waiting.filter((p) => p.why === 'balance').reduce((s, p) => s + p.amount, 0)),
      paidAmount: round2(mine.filter((p) => p.state === 'paid').reduce((s, p) => s + p.amount, 0)),
      rows: mine.slice(0, limit).map(rowOf),
    };
  }

  /** 4e — a partner's payouts as they are kept: what the money checks read. */
  payoutsOf(partnerEntityId: string): PartnerPayout[] {
    return [...this.payouts.values()].filter((p) => p.partnerEntityId === partnerEntityId);
  }

  /** The owed lines a payout has paid — what a hand sees as paid. */
  paidLineIds(): Set<string> {
    const out = new Set<string>();
    for (const p of this.payouts.values()) if (p.state === 'paid') for (const id of p.lineIds) out.add(id);
    return out;
  }

  private save(p: PartnerPayout): PartnerPayout {
    const clean = { ...p };
    if (clean.state === 'paid' || clean.why === undefined) delete clean.why;
    this.payouts.set(clean.payoutId, clean);
    this.told(clean.partnerEntityId);
    return clean;
  }

  /** Said on the bus: the partner's own screens and the console read it again. */
  private told(partnerEntityId: string): void {
    void this.events?.publish(GlosEvent.Pudo.PartnerPayout, { partnerEntityId }, { source: 'pudo' }).catch(() => undefined);
  }
}

function rowOf(p: PartnerPayout): PartnerPayoutRow {
  return {
    payoutId: p.payoutId,
    payeeId: p.payeeId,
    payeeKind: p.payeeKind,
    amount: p.amount,
    currency: p.currency,
    steps: p.lineIds.length,
    state: p.state,
    ...(p.why ? { why: p.why } : {}),
    ...(p.numberMasked ? { numberMasked: p.numberMasked } : {}),
    day: p.day,
    ...(p.paidAt ? { paidAt: p.paidAt } : {}),
    ...(p.askedBy ? { askedBy: p.askedBy } : {}),
  };
}
