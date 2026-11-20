import { Injectable, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PresenceService } from '../../foundation/presence/presence.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { AmountKey } from './amount-keys';

/** Who did the step: a shop, a hub, a driver who rides for itself — or the fleet a driver rides for, which is paid for it. */
export type PartnerPayeeKind = 'shop' | 'hub' | 'driver' | 'fleet';
/** The step itself: a shop's work on a parcel, a hub's sort, receiving or passing a bag on, a driver's road. */
export type PartnerStep = 'labour' | 'sort' | 'receiving' | 'pass_on' | 'haul';

/**
 * 2026-11-20 — WHICH WORK, exactly (the payments plan, 3b): a shop's take-in, shelving, release, hand-over to a driver, or the
 * days it kept a parcel past its free time; a hub's sort, receiving or pass-on; a driver's bag loaded or its road. Said to the
 * hand ("Taken in", not "Work on a parcel"), and what the fraud checks read: a work done once per parcel is owed once.
 */
export const PARTNER_WORKS = ['take_in', 'shelving', 'release', 'handover', 'holding', 'sort', 'receiving', 'pass_on', 'bag_load', 'road'] as const;
export type PartnerWork = (typeof PARTNER_WORKS)[number];
/** A shop's work, as payLabour is told it. */
export type ShopWork = Extract<PartnerWork, 'take_in' | 'shelving' | 'release' | 'handover' | 'holding'>;

/** The figure on the partner's own list a work is paid at — none where the pay is the hand's own or the road's. */
export const LISTED_AT: Partial<Record<PartnerWork, AmountKey>> = {
  take_in: 'labourFee',
  shelving: 'shelvingFee',
  release: 'releaseFee',
  handover: 'handoverFee',
  sort: 'mdpSortFee',
  pass_on: 'mdpPassOnFee',
  bag_load: 'toteLoadFee',
};

/**
 * 2026-11-20 — WHAT THE PARTNER OWES, STEP BY STEP (the payments plan, 3a; the owner: "Option A, but fully automated"; "the
 * partner's own list"; the hands see it, "named"). In a Partnered country the partner contracts and pays, and SeeBuyGet keeps
 * the record: every step of a parcel carried under the partner's promise — a shop's take-in, hand-over, shelving or release, a
 * hub's sort, a driver's road — is owed by the partner to the hand that did it, at the partner's own rates, in its money.
 * Owed, never held: none of it is in our books (CA7: a partner is never a party to them). Nothing here moves money; step 4 does.
 */
export interface PartnerOwedLine {
  lineId: string;
  partnerEntityId: string;
  partnerName: string;
  country: string;
  payeeId: string;
  payeeKind: PartnerPayeeKind;
  amount: number;
  currency: string;
  /** What it was for: a parcel, a hand-over sheet, a hub, a driver. */
  reference: string;
  refType: string;
  step: PartnerStep;
  at: string;
  /** A step undone (a parcel voided or called off at the shop): the line it takes back, its amount here below zero. */
  undoes?: string;
  /** Which work, exactly (3b). Absent on a line from before it was said. */
  work?: PartnerWork;
  /** What the partner's own list said for that work when it was owed — what "paid off the list" is read against. */
  listed?: number;
}

export class PartnerOwedRow {
  @ApiProperty() lineId: string;
  @ApiProperty() partnerName: string;
  @ApiProperty() payeeId: string;
  @ApiProperty({ enum: ['shop', 'hub', 'driver', 'fleet'] }) payeeKind: PartnerPayeeKind;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() reference: string;
  @ApiProperty({ enum: ['labour', 'sort', 'receiving', 'pass_on', 'haul'] }) step: PartnerStep;
  @ApiProperty() at: string;
  @ApiPropertyOptional({ description: 'A step undone: what was owed for it, taken back (the amount below zero).' }) takenBack?: boolean;
  @ApiPropertyOptional({ enum: PARTNER_WORKS, description: 'Which work, exactly.' }) work?: PartnerWork;
  @ApiPropertyOptional({ description: 'What the partner’s own list said for that work when it was owed.' }) listed?: number;
  @ApiPropertyOptional({ description: '4c — paid to the hand, by the partner’s daily payout.' }) paid?: boolean;
}

export class PartnerOwedTotal {
  @ApiProperty() payeeId: string;
  @ApiProperty({ enum: ['shop', 'hub', 'driver', 'fleet'] }) payeeKind: PartnerPayeeKind;
  @ApiProperty() amount: number;
  @ApiProperty() steps: number;
}

/** A partner's record, as our staff read it: every line, and what it owes each hand in all. */
export class PartnerLedgerView {
  @ApiProperty() partnerEntityId: string;
  @ApiProperty() partnerName: string;
  @ApiProperty() currency: string;
  @ApiProperty() owed: number;
  @ApiProperty({ type: [PartnerOwedTotal] }) byPayee: PartnerOwedTotal[];
  @ApiProperty({ type: [PartnerOwedRow] }) lines: PartnerOwedRow[];
}

/** What one partner owes a hand in all, in its money. */
export class PartnerOwedSum {
  @ApiProperty() partnerName: string;
  @ApiProperty() currency: string;
  @ApiProperty() amount: number;
  @ApiPropertyOptional({ description: '4c — of it, what the partner has paid out to the hand already.' }) paid?: number;
}

/** A hand's own: what each partner owes it, named, with the steps. */
export class MyPartnerOwed {
  @ApiProperty({ type: [PartnerOwedRow] }) lines: PartnerOwedRow[];
  @ApiPropertyOptional({ type: [PartnerOwedSum], description: 'Per partner, in its money.' }) totals?: PartnerOwedSum[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class PartnerLedgerService {
  private readonly lines = new PersistentMap<string, PartnerOwedLine>('partner-owed');

  constructor(
    private readonly presence: PresenceService,
    private readonly entities: EntityService,
    @Optional() private readonly events?: EventBus,
  ) {}

  /** The partner that contracts and pays in this country: only where the country is Partnered and the partner switched on. */
  partnerAt(country?: string): Entity | undefined {
    if (!country) return undefined;
    if (this.presence.resolve(country).level !== 'partnered') return undefined;
    return this.entities.partnerFor(country);
  }

  /** Whose list a step here is paid at: the partner's own, where a partner contracts here. */
  ratesEntityAt(country?: string): string | undefined {
    return this.partnerAt(country)?.entityId;
  }

  /**
   * A STEP DONE UNDER THE PARTNER'S PROMISE: owed by the partner to the hand that did it. Nothing where no partner contracts in
   * that country, or nothing is owed — and never a refusal: this runs inside a custody step, which must not fail on a money
   * question (the P2 lesson).
   */
  owe(input: { country?: string; payeeId: string; payeeKind: PartnerPayeeKind; amount: number; reference: string; refType: string; step: PartnerStep; work?: PartnerWork }, now: number = Date.now()): PartnerOwedLine | undefined {
    const partner = this.partnerAt(input.country);
    if (!partner || !(input.amount > 0) || !input.payeeId) return undefined;
    const key = input.work ? LISTED_AT[input.work] : undefined;
    const listed = key ? this.entities.amountsFor(partner.entityId)[key] : undefined;
    const line: PartnerOwedLine = {
      lineId: `po_${randomBytes(9).toString('base64url')}`,
      partnerEntityId: partner.entityId,
      partnerName: partner.name,
      country: (input.country as string).toUpperCase(),
      payeeId: input.payeeId,
      payeeKind: input.payeeKind,
      amount: round2(input.amount),
      currency: this.entities.amountsFor(partner.entityId).currency ?? partner.currency ?? currencyForJurisdiction(input.country as string),
      reference: input.reference,
      refType: input.refType,
      step: input.step,
      at: new Date(now).toISOString(),
      ...(input.work ? { work: input.work } : {}),
      ...(typeof listed === 'number' ? { listed } : {}),
    };
    this.lines.set(line.lineId, line);
    void this.events?.publish(GlosEvent.Pudo.PartnerOwed, { ...line }, { source: 'pudo' }).catch(() => undefined);
    return line;
  }

  /**
   * A STEP UNDONE — a parcel voided, or called off at the shop: what the partner owed for it, taken back. As a line of its
   * own, never by changing or deleting the one it undoes, so the record keeps both. Only a line that was owed and is not
   * taken back yet — the newest for this hand, this step, this parcel and this amount — so nothing is taken back that was
   * never owed (a step from before, or from a country no partner contracted in). Asked of the line, not of today's
   * country: a country moved off Partnered since still takes back what its partner owed.
   */
  takeBack(input: { payeeId: string; amount: number; reference: string; step: PartnerStep; work?: PartnerWork }, now: number = Date.now()): PartnerOwedLine | undefined {
    if (!(input.amount > 0) || !input.payeeId) return undefined;
    const all = [...this.lines.values()];
    const undone = new Set(all.map((l) => l.undoes).filter((id): id is string => Boolean(id)));
    const cents = Math.round(input.amount * 100);
    // The very work undone, where it is said: a void takes back the take-in, never the shelving of the same amount.
    const sameWork = (l: PartnerOwedLine) => !input.work || !l.work || l.work === input.work;
    const owed = all
      .filter((l) => !l.undoes && !undone.has(l.lineId) && l.payeeId === input.payeeId && l.step === input.step && l.reference === input.reference && sameWork(l) && Math.round(l.amount * 100) === cents)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!owed) return undefined;
    const line: PartnerOwedLine = { ...owed, lineId: `po_${randomBytes(9).toString('base64url')}`, amount: -owed.amount, undoes: owed.lineId, at: new Date(now).toISOString() };
    this.lines.set(line.lineId, line);
    void this.events?.publish(GlosEvent.Pudo.PartnerOwed, { ...line }, { source: 'pudo' }).catch(() => undefined);
    return line;
  }

  /** A partner's record: newest first, with what it owes each hand in all. */
  ledgerOf(partnerEntityId: string, opts: { payeeId?: string; limit?: number; paidLineIds?: Set<string> } = {}): PartnerLedgerView {
    const partner = this.entities.get(partnerEntityId);
    const mine = [...this.lines.values()].filter((l) => l.partnerEntityId === partnerEntityId && (!opts.payeeId || l.payeeId === opts.payeeId)).sort((a, b) => b.at.localeCompare(a.at));
    const totals = new Map<string, PartnerOwedTotal>();
    for (const l of mine) {
      const t = totals.get(l.payeeId) ?? { payeeId: l.payeeId, payeeKind: l.payeeKind, amount: 0, steps: 0 };
      t.amount = round2(t.amount + l.amount);
      // A step taken back is a step no longer owed for.
      t.steps += l.undoes ? -1 : 1;
      totals.set(l.payeeId, t);
    }
    return {
      partnerEntityId,
      partnerName: partner.name,
      currency: this.entities.amountsFor(partnerEntityId).currency ?? partner.currency ?? 'USD',
      owed: round2(mine.reduce((s, l) => s + l.amount, 0)),
      // A hand whose every step was taken back is owed nothing, and is not listed as owed.
      byPayee: [...totals.values()].filter((t) => t.steps > 0 || t.amount !== 0).sort((a, b) => b.amount - a.amount),
      lines: mine.slice(0, opts.limit ?? 500).map((l) => rowOf(l, opts.paidLineIds)),
    };
  }

  /** A hand's own: every line any partner owes it, named — a fleet's for the work of its drivers. */
  owedTo(payeeIds: string[], paidLineIds?: Set<string>): MyPartnerOwed {
    const ids = new Set(payeeIds);
    const mine = [...this.lines.values()].filter((l) => ids.has(l.payeeId)).sort((a, b) => b.at.localeCompare(a.at));
    const totals = new Map<string, { partnerName: string; currency: string; amount: number; paid?: number }>();
    for (const l of mine) {
      const key = `${l.partnerEntityId}|${l.currency}`;
      const t = totals.get(key) ?? { partnerName: l.partnerName, currency: l.currency, amount: 0 };
      t.amount = round2(t.amount + l.amount);
      if (paidLineIds?.has(l.lineId)) t.paid = round2((t.paid ?? 0) + l.amount);
      totals.set(key, t);
    }
    return { lines: mine.slice(0, 200).map((l) => rowOf(l, paidLineIds)), ...(totals.size ? { totals: [...totals.values()] } : {}) };
  }

  /** 2026-11-20 — a partner's lines as they are kept, oldest first, since a moment: what its fraud checks read (3b). */
  linesOf(partnerEntityId: string, sinceMs = 0): PartnerOwedLine[] {
    return [...this.lines.values()].filter((l) => l.partnerEntityId === partnerEntityId && Date.parse(l.at) >= sinceMs).sort((a, b) => a.at.localeCompare(b.at));
  }

  /** The partners that have any line at all: whose figures are checked. */
  partnersWithLines(): string[] {
    return [...new Set([...this.lines.values()].map((l) => l.partnerEntityId))];
  }
}

function rowOf(l: PartnerOwedLine, paidLineIds?: Set<string>): PartnerOwedRow {
  return {
    lineId: l.lineId,
    partnerName: l.partnerName,
    payeeId: l.payeeId,
    payeeKind: l.payeeKind,
    amount: l.amount,
    currency: l.currency,
    reference: l.reference,
    step: l.step,
    at: l.at,
    ...(l.undoes ? { takenBack: true } : {}),
    ...(l.work ? { work: l.work } : {}),
    ...(typeof l.listed === 'number' ? { listed: l.listed } : {}),
    ...(paidLineIds?.has(l.lineId) ? { paid: true } : {}),
  };
}
