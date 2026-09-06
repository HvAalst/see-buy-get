import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { BooksService } from '../books/books.service';
import { ACCOUNT_CODES } from '../books/books.types';
import { EntityService } from '../entity/entity.service';
import { IN_FLIGHT, PAYOUT_RAIL, Payout, PayoutRail, PayoutStatus } from './payout.types';

/** The day a settlement covers, in the network's own reckoning. */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * Paying the people the network owes.
 *
 * `driverPayout` and `sortLabour` accrue a payable; nothing has ever drawn one down, so what the network
 * owed simply grew. This is the other end of it, and the shape is dictated by two rules from the money
 * model rather than by convenience:
 *
 *  - **Money leaves only on an observed external event.** The books move on `settled` and on nothing else.
 *    Requesting is a decision and submitting is a handover; neither is a payment, and treating either as
 *    one would report money gone that is still sitting in the account.
 *  - **A payout has a lifecycle**, every step of it stamped.
 *
 * And one rule of its own: **you cannot pay out cash you do not hold.** Settlement lowers what is held and
 * what is owed by the same amount, so it leaves the coverage RATIO untouched — the binding constraint is
 * simply the cash. A run that overdraws custody is how a sister spends the shops' float on its drivers.
 */
@Injectable()
export class PayoutService {
  private readonly payouts = new PersistentMap<string, Payout>('payouts');

  constructor(
    private readonly books: BooksService,
    private readonly entities: EntityService,
    @Inject(PAYOUT_RAIL) private readonly rail: PayoutRail,
  ) {}

  /**
   * Raise a payout for everybody this sister owes, once per payee per day.
   *
   * Same-day settlement is a promise about WHEN, so the day is the unit: run it on a morning cron, run it
   * again after a failure, run it twice by accident — the second run raises nothing, because a payee who
   * already has today's payout is not owed a second one.
   *
   * It raises requests; it does not pay. `submit` hands them to the rail and the rail's answer settles
   * them, which is the only order in which the books can stay honest.
   */
  runFor(entityId: string, now: number = Date.now()): { day: string; raised: Payout[]; skipped: { payeeDid: string; reason: string }[] } {
    const entity = this.entities.get(entityId);
    const currency = entity.currency ?? '';
    const day = dayOf(now);
    const raised: Payout[] = [];
    const skipped: { payeeDid: string; reason: string }[] = [];
    // What is actually in the account right now. Read ONCE for the whole run and drawn down as it is
    // committed, so a run cannot promise the same shilling to three different people.
    let available = this.books.coverage(entityId, currency).held;

    for (const { counterparty, amount } of this.books.outstanding(entityId, ACCOUNT_CODES.PAYABLE_PROVIDER, currency)) {
      if (this.paidToday(entityId, counterparty, day)) {
        skipped.push({ payeeDid: counterparty, reason: 'already settled today' });
        continue;
      }
      // Never two at once. A payment we have handed over and not heard back about might still land, and
      // raising another beside it is how somebody gets paid twice for one day's work.
      if (this.inFlightFor(entityId, counterparty).length) {
        skipped.push({ payeeDid: counterparty, reason: 'a payment is already on its way' });
        continue;
      }
      if (amount > available) {
        // Stated, not silently trimmed. A part-payment nobody asked for is worse than a clear "not today":
        // it looks like the amount was wrong rather than like the money was short.
        skipped.push({ payeeDid: counterparty, reason: 'not enough cash held to cover it' });
        continue;
      }
      const payout: Payout = {
        payoutId: `pay_${randomBytes(8).toString('hex')}`,
        entityId,
        payeeDid: counterparty,
        amount,
        currency,
        status: 'requested',
        day,
        requestedAt: new Date(now).toISOString(),
      };
      this.payouts.set(payout.payoutId, payout);
      available = Math.round((available - amount) * 100) / 100;
      raised.push(payout);
    }
    return { day, raised, skipped };
  }

  /** Hand a requested payout to the rail. Still not a payment — it is a payment ATTEMPT with a reference. */
  submit(payoutId: string, now: number = Date.now()): Payout {
    const payout = this.require(payoutId);
    if (payout.status !== 'requested') throw new GlosError('INVALID_STATE', `Payout is ${payout.status} — only a requested payout can be submitted`);
    const { providerRef } = this.rail.submit({ payoutId: payout.payoutId, payeeDid: payout.payeeDid, amount: payout.amount, currency: payout.currency });
    payout.status = 'submitted';
    payout.submittedAt = new Date(now).toISOString();
    payout.providerRef = providerRef;
    return this.save(payout);
  }

  /**
   * The rail says the money landed. THIS is where the books move.
   *
   * The payable falls and custody falls with it — the sister has less cash and owes less, which is what
   * paying somebody actually is. Nothing before this point touched either.
   */
  settle(payoutId: string, providerRef?: string, now: number = Date.now()): Payout {
    const payout = this.require(payoutId);
    if (payout.status === 'settled') return payout; // a rail that confirms twice has not paid twice
    if (payout.status !== 'submitted') throw new GlosError('INVALID_STATE', `Payout is ${payout.status} — only a submitted payout can settle`);
    const entry = this.books.post({
      entityId: payout.entityId,
      kind: 'provider-settlement',
      ref: payout.payoutId,
      currency: payout.currency,
      lines: [
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: payout.payeeDid, amount: payout.amount },
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -payout.amount },
      ],
    });
    payout.status = 'settled';
    payout.settledAt = new Date(now).toISOString();
    payout.entryId = entry.entryId;
    if (providerRef) payout.providerRef = providerRef;
    return this.save(payout);
  }

  /** It did not go. The payable stands, untouched, because the money is still owed. */
  fail(payoutId: string, reason: string, now: number = Date.now()): Payout {
    const payout = this.require(payoutId);
    if (payout.status !== 'requested' && payout.status !== 'submitted') {
      throw new GlosError('INVALID_STATE', `Payout is ${payout.status} — only one still on its way can fail`);
    }
    payout.status = 'failed';
    payout.failedAt = new Date(now).toISOString();
    payout.failureReason = reason;
    return this.save(payout);
  }

  /**
   * A settled payment that came back — a closed account, a recall, a wrong number.
   *
   * Reversed rather than deleted, and with its own journal entry rather than by unwinding the first: the
   * money did leave and did come back, and a book that shows neither cannot be reconciled against a bank
   * statement that shows both.
   */
  reverse(payoutId: string, reason: string, now: number = Date.now()): Payout {
    const payout = this.require(payoutId);
    if (payout.status !== 'settled') throw new GlosError('INVALID_STATE', `Payout is ${payout.status} — only a settled payout can be reversed`);
    const entry = this.books.post({
      entityId: payout.entityId,
      kind: 'provider-settlement-reversal',
      ref: payout.payoutId,
      currency: payout.currency,
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: payout.amount },
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: payout.payeeDid, amount: -payout.amount },
      ],
    });
    payout.status = 'reversed';
    payout.reversedAt = new Date(now).toISOString();
    payout.reversalEntryId = entry.entryId;
    payout.failureReason = reason;
    return this.save(payout);
  }

  /** Every payout for a sister, newest first — the operator's settlement page. */
  list(filter: { entityId?: string; payeeDid?: string; status?: PayoutStatus; day?: string } = {}): Payout[] {
    return [...this.payouts.values()]
      .filter(
        (p) =>
          (!filter.entityId || p.entityId === filter.entityId) &&
          (!filter.payeeDid || p.payeeDid === filter.payeeDid) &&
          (!filter.status || p.status === filter.status) &&
          (!filter.day || p.day === filter.day),
      )
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  get(payoutId: string): Payout {
    return this.require(payoutId);
  }

  /** What this payee has been paid and is still waiting for — their own view of the same records. */
  forPayee(payeeDid: string): { settled: number; inFlight: number; currency?: string } {
    const mine = this.list({ payeeDid });
    const sum = (rows: Payout[]) => Math.round(rows.reduce((n, p) => n + p.amount, 0) * 100) / 100;
    return {
      settled: sum(mine.filter((p) => p.status === 'settled')),
      inFlight: sum(mine.filter((p) => IN_FLIGHT.includes(p.status))),
      currency: mine[0]?.currency,
    };
  }

  private paidToday(entityId: string, payeeDid: string, day: string): boolean {
    // A FAILED payout does not count: the day's work is still unpaid and the next run should try again.
    // A reversed one does not either — the money came back, so it is owed again.
    return this.list({ entityId, payeeDid, day }).some((p) => p.status === 'settled' || IN_FLIGHT.includes(p.status));
  }

  private inFlightFor(entityId: string, payeeDid: string): Payout[] {
    return this.list({ entityId, payeeDid }).filter((p) => IN_FLIGHT.includes(p.status));
  }

  private save(payout: Payout): Payout {
    this.payouts.set(payout.payoutId, payout);
    return payout;
  }

  private require(payoutId: string): Payout {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new GlosError('NOT_FOUND', `Payout not found: ${payoutId}`);
    return payout;
  }
}
