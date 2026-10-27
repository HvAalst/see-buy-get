import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { BooksService } from '../books/books.service';
import { ACCOUNT_CODES } from '../books/books.types';
import { EntityService } from '../entity/entity.service';
import { sameSigner, type Signer } from '../entity/same-person';
import { IN_FLIGHT, PAYOUT_RAIL, Payout, PayoutRail, PayoutStatus, RailOutcome } from './payout.types';
import { isSandbox } from '../runtime/sandbox';
import { MPESA_PAYOUT_RAIL, type B2cResult, type MpesaPayoutRail } from './mpesa-payout-rail.adapter';
import { isRefusal, payoutWayOf, type PayoutDestination, type PayoutDestinationRefusal, type PayoutDestinations, type PayoutWay } from './payout-ways';

/**
 * Why a payee may NOT be paid out right now — or null when they may.
 *
 * Registered by whoever knows where a payee stands (a shop's country, and whether money may leave to a
 * supplier there), because this service knows only a counterparty id. "Owed, not paid" (user, 2026-09-13):
 * a shop in a country we only match is OWED for work on a sale a sister made, and that debt stays on the
 * books — visibly — until the country can be paid out in.
 */
export type PayeeGate = (payeeDid: string) => string | null;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  private payeeGate: PayeeGate | null = null;
  /** Who keeps payees' numbers: the payout numbers payees set, and the number a person paid from (2026-10-27). */
  private readonly destinations: PayoutDestinations[] = [];

  /**
   * Say who may not be paid out. One registration at boot rather than a parameter on `runFor`: an optional
   * argument is a thing every call site forgets, which is exactly how the driver payable once went missing.
   */
  registerPayeeGate(gate: PayeeGate): void {
    this.payeeGate = gate;
  }

  /** Say where payees are paid, in a country whose way needs a number of theirs (payout-ways.ts). Registered at boot. */
  registerDestinations(destinations: PayoutDestinations): void {
    this.destinations.push(destinations);
  }

  /**
   * Where this payee is paid, from whichever source keeps its number. A number one source keeps wins over another source's
   * refusal (a person owed back what their door load did not use has no payout number, and needs none); only where none has
   * a number is a refusal said — and nothing, where no source knows the payee.
   */
  private destinationOf(payeeId: string, way: PayoutWay, now: number): PayoutDestination | PayoutDestinationRefusal | undefined {
    let refused: PayoutDestinationRefusal | undefined;
    for (const source of this.destinations) {
      const found = source.of(payeeId, way, now);
      if (!found) continue;
      if (!isRefusal(found)) return found;
      refused ??= found;
    }
    return refused;
  }

  constructor(
    private readonly books: BooksService,
    private readonly entities: EntityService,
    @Inject(PAYOUT_RAIL) private readonly rail: PayoutRail,
    /** Kenya's way, where it is set up (mpesa-payout-rail.adapter.ts). Absent: refused off a sandbox, stood in for on one. */
    @Optional() @Inject(MPESA_PAYOUT_RAIL) private readonly mpesa?: MpesaPayoutRail | null,
  ) {}

  /** Sends to a live rail still waiting for its first answer, by payout — so the approval's response can say what it said. */
  private readonly handing = new Map<string, Promise<void>>();

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
  runFor(entityId: string, now: number = Date.now(), by?: Signer): { day: string; raised: Payout[]; skipped: { payeeDid: string; reason: string }[] } {
    const entity = this.entities.get(entityId);
    const currency = entity.currency ?? '';
    const way = payoutWayOf(entity.jurisdiction);
    const day = dayOf(now);
    const raised: Payout[] = [];
    const skipped: { payeeDid: string; reason: string }[] = [];
    // What is actually in the account right now. Read ONCE for the whole run and drawn down as it is
    // committed, so a run cannot promise the same shilling to three different people.
    let available = this.books.coverage(entityId, currency).held;

    // What providers earned, then what people are owed back from loads to their door they paid for first (2026-10-27).
    const owing = (code: typeof ACCOUNT_CODES.PAYABLE_PROVIDER | typeof ACCOUNT_CODES.PAYABLE_PERSON) => this.books.outstanding(entityId, code, currency).map((o) => ({ ...o, code }));
    for (const { counterparty, amount: owed, code } of [...owing(ACCOUNT_CODES.PAYABLE_PROVIDER), ...owing(ACCOUNT_CODES.PAYABLE_PERSON)]) {
      // M-Pesa pays whole shillings: the cents stay owed, to the next run, rather than be rounded away or up.
      const amount = way === 'mpesa' ? Math.floor(owed) : owed;
      if (amount < 1 && way === 'mpesa') {
        skipped.push({ payeeDid: counterparty, reason: 'less than one shilling owed' });
        continue;
      }
      // Asked first: a payee who may not be paid out is not short of cash or already paid — they are owed,
      // and the run says so by name rather than raising a payment that must never be submitted.
      const barred = this.payeeGate?.(counterparty);
      if (barred) {
        skipped.push({ payeeDid: counterparty, reason: barred });
        continue;
      }
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
      // Where it goes, asked before any cash is set aside for it: a payee with no number of its own, or one changed
      // less than a day ago, is owed — and the run says why it is not paid today.
      const destination = way === 'mpesa' ? this.destinationOf(counterparty, way, now) : undefined;
      if (destination && isRefusal(destination)) {
        skipped.push({ payeeDid: counterparty, reason: destination.reason });
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
        ...(code === ACCOUNT_CODES.PAYABLE_PERSON ? { owed: code } : {}),
        way,
        ...(destination ? { destination } : {}),
        day,
        requestedAt: new Date(now).toISOString(),
        ...(by ? { requestedBy: { name: by.name, ...(by.key ? { key: by.key } : {}) } } : {}),
      };
      this.payouts.set(payout.payoutId, payout);
      available = Math.round((available - amount) * 100) / 100;
      raised.push(payout);
    }
    return { day, raised, skipped };
  }

  /**
   * Hand a requested payout to the rail. Still not a payment — it is a payment ATTEMPT with a reference.
   *
   * TWO PEOPLE (the user, 2026-10-18): it is approved by a different member of staff from the one who raised it, the
   * same rule as every other act of staff on money or identity. Refused before anything moves.
   */
  submit(payoutId: string, now: number = Date.now(), by?: Signer): Payout {
    const payout = this.require(payoutId);
    if (payout.status !== 'requested') throw new GlosError('INVALID_STATE', `Payout is ${payout.status} — only a requested payout can be submitted`);
    if (by && payout.requestedBy && sameSigner(payout.requestedBy, by)) {
      throw new GlosError('CONFLICT', 'A second member of staff approves a payout — not the one who raised it');
    }
    this.assertSameDestination(payout, now);
    const rail = this.railFor(payout);
    const msisdn = this.numberFor(payout, rail);
    // CLAIMED BEFORE THE RAIL IS ASKED: a second approval meanwhile finds it on its way, not still raised.
    payout.status = 'submitted';
    payout.submittedAt = new Date(now).toISOString();
    if (by) payout.approvedBy = { name: by.name, ...(by.key ? { key: by.key } : {}) };
    this.save(payout);
    const answer = rail.submit({ payoutId: payout.payoutId, payeeDid: payout.payeeDid, amount: payout.amount, currency: payout.currency, ...(msisdn ? { msisdn } : {}) });
    if (answer instanceof Promise) {
      const handed = answer
        .catch((err: Error): RailOutcome => ({ taken: 'unknown', why: `The rail failed while sending (${err.message}). The payment may have gone: wait for its result, or check with the provider.` }))
        .then((outcome) => this.apply(payout.payoutId, outcome, now))
        .finally(() => this.handing.delete(payout.payoutId));
      this.handing.set(payout.payoutId, handed);
    } else {
      this.apply(payout.payoutId, answer, now);
    }
    return payout;
  }

  /** The payout once its rail has given its first answer — taken, refused or unknown. At once for a rail that answers at once. */
  async handedOver(payoutId: string): Promise<Payout> {
    await this.handing.get(payoutId);
    return this.require(payoutId);
  }

  /**
   * WHAT A LIVE RAIL SAID LATER, on its result door. Paid: the books move — even for a payout marked failed meanwhile,
   * because the money did leave, and a book that hides it cannot be reconciled; it is said under the payout. Not paid:
   * failed, the payable standing. Unsure: said, and left on its way for a person to resolve from the provider's portal.
   */
  fromRail(result: B2cResult, now: number = Date.now()): Payout {
    const payout = this.require(result.payoutId);
    if ('repeat' in result) return payout;
    if ('unsure' in result) {
      if (IN_FLIGHT.includes(payout.status)) {
        payout.railNote = result.unsure;
        this.save(payout);
      }
      return payout;
    }
    if (result.paid) {
      if (payout.status === 'settled' || payout.status === 'reversed') return payout;
      const wasFailed = payout.status === 'failed';
      payout.status = 'submitted';
      const settled = this.settle(payout.payoutId, result.receipt, now);
      if (wasFailed) {
        settled.railNote = 'Paid by M-Pesa after it was marked failed. If it was raised again since, check it was not paid twice.';
        this.save(settled);
      } else if (settled.railNote) {
        delete settled.railNote;
        this.save(settled);
      }
      return settled;
    }
    if (payout.status !== 'submitted') return payout;
    return this.fail(payout.payoutId, result.reason, now);
  }

  /**
   * STAFF SAY IT WAS PAID. By hand, as ever — and for a payout sent through M-Pesa, with M-Pesa's own receipt from the
   * portal: a payment we cannot point at is one we cannot reconcile.
   */
  settleByHand(payoutId: string, providerRef?: string, now: number = Date.now()): Payout {
    const payout = this.require(payoutId);
    if (payout.railRef && !providerRef?.trim()) {
      throw new GlosError('FIELD_REQUIRED', 'Give the M-Pesa receipt (the transaction ID on the M-Pesa portal): this payout was sent through M-Pesa', { field: 'providerRef' });
    }
    return this.settle(payoutId, providerRef?.trim() || undefined, now);
  }

  /**
   * STAFF SAY IT DID NOT GO. A payout M-Pesa is still working on is not theirs to fail: failing it lets the next run raise
   * it again, and if M-Pesa then pays both, the day is paid twice. So only once M-Pesa has said it could not tell, or a day
   * has gone by with no answer — and the M-Pesa portal checked first.
   */
  failByHand(payoutId: string, reason: string, now: number = Date.now()): Payout {
    const payout = this.require(payoutId);
    if (payout.status === 'submitted' && payout.railRef && !payout.railNote && now - Date.parse(payout.submittedAt ?? payout.requestedAt) < DAY_MS) {
      throw new GlosError('CONFLICT', 'M-Pesa has not answered this payment yet: its answer settles or fails it. If none comes, it can be marked failed after a day, once the M-Pesa portal shows it was not paid.');
    }
    return this.fail(payoutId, reason, now);
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
    // The payable it was raised against: a provider's earnings, or what a person is owed back.
    const owed = payout.owed ?? ACCOUNT_CODES.PAYABLE_PROVIDER;
    const entry = this.books.post({
      entityId: payout.entityId,
      kind: owed === ACCOUNT_CODES.PAYABLE_PERSON ? 'person-refund' : 'provider-settlement',
      ref: payout.payoutId,
      currency: payout.currency,
      lines: [
        { code: owed, counterparty: payout.payeeDid, amount: payout.amount },
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
    const owed = payout.owed ?? ACCOUNT_CODES.PAYABLE_PROVIDER;
    const entry = this.books.post({
      entityId: payout.entityId,
      kind: owed === ACCOUNT_CODES.PAYABLE_PERSON ? 'person-refund-reversal' : 'provider-settlement-reversal',
      ref: payout.payoutId,
      currency: payout.currency,
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: payout.amount },
        { code: owed, counterparty: payout.payeeDid, amount: -payout.amount },
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

  /**
   * Sent only to the number it was raised to. A number changed in between (or paused after a change) refuses the send:
   * the payout is failed and the next run raises it to the number as it is now — never quietly redirected.
   */
  private assertSameDestination(payout: Payout, now: number): void {
    if (!payout.destination || !this.destinations.length) return;
    const current = this.destinationOf(payout.payeeDid, payout.way ?? 'mpesa', now);
    if (!current) throw new GlosError('CONFLICT', 'Not sent: nobody keeps a number for this payee any more');
    if (isRefusal(current)) throw new GlosError('CONFLICT', `Not sent: ${current.reason}`);
    if (current.numberId !== payout.destination.numberId) {
      throw new GlosError('CONFLICT', 'The payout number changed after this payout was raised. Mark it failed; the next run raises it to the new number.');
    }
  }

  /** Which rail carries this payout: its country's way. M-Pesa not set up: refused off a sandbox, stood in for on one. */
  private railFor(payout: Payout): PayoutRail {
    if (payout.way !== 'mpesa') return this.rail;
    if (this.mpesa) return this.mpesa;
    if (isSandbox()) return this.rail;
    throw new GlosError('INVALID_STATE', 'M-Pesa payouts are not set up on this server, so nothing was sent. See mpesa_rail.md.');
  }

  /** The payee's whole number, for a live M-Pesa rail only — read now, from the number the payout was raised to. */
  private numberFor(payout: Payout, rail: PayoutRail): string | undefined {
    if (rail !== this.mpesa || !this.mpesa) return undefined;
    const msisdn = payout.destination ? this.destinations.map((d) => d.full(payout.payeeDid, payout.destination!.numberId)).find(Boolean) : undefined;
    if (!msisdn) throw new GlosError('CONFLICT', 'Not sent: this payout has no payout number of the payee’s to go to. Mark it failed; the next run raises it again.');
    return msisdn;
  }

  /** The rail's first answer, written on the payout it is about. */
  private apply(payoutId: string, outcome: RailOutcome, now: number): void {
    const payout = this.require(payoutId);
    if (outcome.taken === true) {
      if (outcome.providerRef) payout.providerRef = outcome.providerRef;
      if (outcome.railRef) payout.railRef = outcome.railRef;
      this.save(payout);
      return;
    }
    if (outcome.taken === false) {
      if (payout.status === 'submitted') this.fail(payoutId, outcome.refused, now);
      return;
    }
    if (outcome.railRef) payout.railRef = outcome.railRef;
    if (IN_FLIGHT.includes(payout.status)) payout.railNote = outcome.why;
    this.save(payout);
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
