import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { FundingService } from '../../foundation/funding/funding.service';
import type { FundingPurpose } from '../../foundation/funding/funding.types';
import { maskMsisdn, normaliseMsisdn } from '../../foundation/funding/mpesa-funding-rail.adapter';
import { GlosError } from '../../foundation/http/glos-error';
import { isPlausiblePhone } from '../../foundation/identity/phone';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { NotificationService } from './notification.service';
import type { LoadPayment, LoadPaymentView } from './person-load-pay.types';

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Moneys paid in whole units: what is asked is rounded up, and what was not used goes back. */
const WHOLE_UNITS = new Set(['KES', 'UGX', 'TZS', 'RWF', 'BIF']);
/** How long a person has to pay after accepting a price, before the driver is let go. */
export const LOAD_PAY_WINDOW_MIN = 15;

/**
 * 2026-11-13 — A PERSON'S LOAD, PAID FIRST AND HELD UNTIL DELIVERY (unusual loads, part 3b; the owner: "It should normally be kept
 * in escrow until delivery is accomplished" — "go ahead"). Like a person's own door (PersonDoorService): what they pay is held
 * for ONE load in DEPOSIT_PERSON, never a balance; billed only when the load is committed to the driver; the driver paid only
 * after delivery (dispatch's payTheRoad), which for this load needs the code the person gave whoever receives it.
 *
 * In order, each step refused before anything is written where it cannot be done:
 *   1. pay — the person accepts a driver's price (or the driver took the person's price back): M-Pesa asks them for it, all in,
 *      within LOAD_PAY_WINDOW_MIN; the driver is told it is accepted and being paid; no other price can be taken meanwhile;
 *   2. paid — the money is posted, the price accepted, the load committed, billed out of what was paid, and its delivery code
 *      made for the person to hand on;
 *   3. delivered — what was not used (the rounding) goes back. Or: the time ran out — the driver is let go, nothing paid; or
 *      the driver gave it back — everything goes back, and the person accepts a price again.
 */
@Injectable()
export class PersonLoadPayService implements OnModuleInit {
  private readonly logger = new Logger(PersonLoadPayService.name);
  private readonly payments = new PersistentMap<string, LoadPayment>('person-load-payments');

  constructor(
    private readonly dispatch: DispatchService,
    private readonly funding: FundingService,
    private readonly books: BooksService,
    private readonly entities: EntityService,
    private readonly payouts: PayoutService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly events?: EventBus,
  ) {}

  onModuleInit(): void {
    this.dispatch.registerPrepaid({
      owns: (f) => Boolean(this.held(f.freightId)),
      bill: (f, bill) => this.bill(f, bill),
      giveBack: (f, charged, why) => this.giveBack(f, charged, why),
    });
    this.payouts.registerDestinations({
      of: (payeeId) => this.refundDestination(payeeId),
      full: (payeeId, numberId) => this.refundNumber(payeeId, numberId),
    });
    this.events?.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightDelivered, (e) => this.delivered(e.payload.freightId));
  }

  /* ------------------------------------------------------------------- pay -- */

  /** What the person reads of their payment for this load, or nothing where they started none. */
  viewFor(personDid: string, freightId: string): LoadPaymentView | undefined {
    const p = this.latest(freightId);
    if (!p || p.personDid !== personDid) return undefined;
    return {
      state: p.state,
      amount: p.amount,
      currency: p.currency,
      price: p.price,
      until: p.until,
      phoneMasked: p.phoneMasked,
      ...(p.instructions ? { instructions: p.instructions } : {}),
      ...(p.reference ? { reference: p.reference } : {}),
      ...(p.pushed != null ? { pushed: p.pushed } : {}),
      ...(p.owedBack ? { owedBack: p.owedBack } : {}),
      ...(p.why ? { why: p.why } : {}),
    };
  }

  /**
   * The person accepts a driver's price by paying for it — the driver's own, or the person's price back that the driver took.
   * Refused before anything is written: not their load, a load they pay the driver for directly, not open, a payment already
   * waiting, a number M-Pesa could not ask.
   */
  async pay(personDid: string, freightId: string, input: { proposalId: string; phone: string }, now: number = Date.now()): Promise<LoadPaymentView> {
    const f = this.dispatch.requireFreightPublic(freightId);
    if (f.postedByDid !== personDid) throw new GlosError('FORBIDDEN', 'That load is not yours');
    if (!f.escrow || !f.sellerEntityId) throw new GlosError('INVALID_STATE', 'You pay the driver of this load directly: accept the price instead');
    if (!(f.status === 'available' || f.status === 'scheduled')) throw new GlosError('INVALID_STATE', `The load is ${f.status}`);
    const waiting = this.latest(freightId);
    if (waiting?.state === 'awaiting') throw new GlosError('INVALID_STATE', 'A payment for this load is already waiting: pay it, or wait until its time runs out');
    const proposal = this.dispatch.requireProposalPublic(input.proposalId);
    if (proposal.freightId !== freightId || proposal.status !== 'open') throw new GlosError('INVALID_STATE', 'That price is no longer open');
    const phone = (input.phone ?? '').trim();
    if (!isPlausiblePhone(phone)) throw new GlosError('INVALID_INPUT', 'Give the number M-Pesa should ask, with its country code', { field: 'phone' });
    const price = proposal.counterTaken && proposal.counter ? proposal.counter.price : proposal.price;
    const entity = this.entities.get(f.sellerEntityId);
    const currency = entity.currency ?? f.postedCurrency ?? '';
    const gross = this.dispatch.chargeFor(freightId, price);
    const amount = WHOLE_UNITS.has(currency.toUpperCase()) ? Math.ceil(gross - 1e-9) : round2(gross);
    const until = new Date(now + LOAD_PAY_WINDOW_MIN * 60_000).toISOString();
    const payment: LoadPayment = {
      payId: `lpay_${randomBytes(6).toString('hex')}`,
      freightId,
      loadCode: f.code,
      proposalId: proposal.proposalId,
      personDid,
      entityId: entity.entityId,
      currency,
      price,
      amount,
      phone,
      phoneMasked: maskMsisdn(phone),
      openedAt: new Date(now).toISOString(),
      until,
      state: 'awaiting',
    };
    // Kept BEFORE the rail is asked: the rail asks who pays (resolvePayer) before it answers.
    this.payments.set(payment.payId, payment);
    let funding;
    try {
      funding = await this.funding.open({ payerKind: 'person', payerDid: personDid, purpose: 'load', amount, payerPhone: phone }, now);
    } catch (err) {
      this.payments.delete(payment.payId);
      throw err;
    }
    payment.fundingId = funding.fundingId;
    payment.reference = funding.reference;
    if (funding.instructions) payment.instructions = funding.instructions;
    payment.pushed = Boolean(funding.pushed);
    this.payments.set(payment.payId, payment);
    this.dispatch.holdForPayment(freightId, proposal.proposalId, until);
    this.tellDriver(proposal.driverDid, `Your price for ${f.code} is accepted`, `The sender is paying ${this.money(price, currency)} now. The load is yours once it is paid — by ${until.slice(11, 16)} UTC.`, freightId);
    return this.viewFor(personDid, freightId)!;
  }

  /** The person says it arrived — the driver may then deliver without the code (their receiver lost it). */
  arrived(personDid: string, freightId: string, now: number = Date.now()): { confirmedAt: string } {
    const f = this.dispatch.requireFreightPublic(freightId);
    if (f.postedByDid !== personDid) throw new GlosError('FORBIDDEN', 'That load is not yours');
    return { confirmedAt: this.dispatch.posterSaysArrived(freightId, now) };
  }

  /* ------------------------------------------------------------- the rail -- */

  /** Which company collects, for the payment the rail is about to ask for. */
  resolvePayer(personDid: string): { entityId: string; currency: string; label: string } {
    const p = [...this.payments.values()].filter((x) => x.personDid === personDid && x.state === 'awaiting').sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
    if (!p) throw new GlosError('NOT_FOUND', 'No load payment is waiting for this person');
    return { entityId: p.entityId, currency: p.currency, label: `load ${p.loadCode}` };
  }

  /** The rail confirmed: posted first; then the price accepted and the load committed — or, where it no longer can be, all back. */
  paid(personDid: string, c: { purpose: FundingPurpose; gross: number; fee: number; reference: string; fundingId: string }, now: number = Date.now()): { entryId: string } {
    const funding = this.funding.get(c.fundingId);
    const gross = round2(c.gross);
    const fee = round2(c.fee);
    const entry = this.books.post({
      entityId: funding.entityId,
      kind: 'load-prepayment',
      ref: c.reference,
      currency: funding.currency,
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: round2(gross - fee) },
        ...(fee > 0 ? [{ code: ACCOUNT_CODES.EXPENSE_PAYMENT_FEES, amount: fee }] : []),
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: personDid, amount: -gross },
      ],
    });
    const p = [...this.payments.values()].find((x) => x.fundingId === c.fundingId);
    if (p && p.state === 'awaiting') {
      p.state = 'paid';
      p.paid = gross;
      this.payments.set(p.payId, p);
      try {
        this.dispatch.releasePayHold(p.freightId);
        this.dispatch.acceptProposal(p.proposalId, now, p.price);
        this.dispatch.issueDeliveryCode(p.freightId);
        this.tell(personDid, `Paid: ${p.loadCode} is on its way`, 'The driver collects it. SeeBuyGet holds your money until it is delivered. Give whoever receives it the delivery code from My parcels.', p.freightId);
        return { entryId: entry.entryId };
      } catch (err) {
        this.logger.warn(`load ${p.loadCode} not committed after payment: ${(err as Error).message}`);
        p.state = 'refunded';
        p.why = 'the driver could no longer take it';
        this.payments.set(p.payId, p);
        this.owe(p, gross);
        this.tell(personDid, `Your payment for ${p.loadCode} goes back to you`, `The driver could no longer take it. ${this.money(gross, p.currency)} goes back to your number with the next payout; choose another price.`, p.freightId);
        return { entryId: entry.entryId };
      }
    }
    // Arrived after the time ran out, a second time, or for no load: all of it goes back.
    const req = p ?? undefined;
    this.oweLoose(personDid, funding.entityId, funding.currency, gross, req);
    this.tell(personDid, 'Your payment goes back to you', `${this.money(gross, funding.currency)} came in with nothing waiting for it — it goes back to your number with the next payout.`, p?.freightId);
    return { entryId: entry.entryId };
  }

  /** It bounced: the exact mirror. A load already committed is left to staff, who are told in the log. */
  reversed(personDid: string, c: { purpose: FundingPurpose; gross: number; fee: number; reference: string; fundingId: string }): { entryId: string } {
    const funding = this.funding.get(c.fundingId);
    const gross = round2(c.gross);
    const fee = round2(c.fee);
    const entry = this.books.post({
      entityId: funding.entityId,
      kind: 'load-prepayment-reversed',
      ref: c.reference,
      currency: funding.currency,
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -round2(gross - fee) },
        ...(fee > 0 ? [{ code: ACCOUNT_CODES.EXPENSE_PAYMENT_FEES, amount: -fee }] : []),
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: personDid, amount: gross },
      ],
    });
    const p = [...this.payments.values()].find((x) => x.fundingId === c.fundingId);
    if (p) {
      p.state = 'reversed';
      this.payments.set(p.payId, p);
      this.logger.warn(`load payment ${p.payId} for ${p.loadCode} reversed by the rail: staff to look at the load`);
    }
    return { entryId: entry.entryId };
  }

  /* --------------------------------------------------- billed, given back -- */

  /** Billed out of what was paid, when the load is committed. False where it does not cover the price. */
  private bill(f: Freight, bill: { gross: number; tax: number; provision: number }): boolean {
    const p = this.held(f.freightId);
    if (!p || p.paid == null || bill.gross > p.paid + 1e-9) return false;
    this.books.post({
      entityId: p.entityId,
      kind: 'shipping',
      ref: f.freightId,
      currency: p.currency,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: p.personDid, amount: round2(bill.gross) },
        { code: ACCOUNT_CODES.REVENUE, amount: -round2(bill.gross - bill.tax - bill.provision) },
        ...(bill.tax > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: -round2(bill.tax) }] : []),
        ...(bill.provision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: -round2(bill.provision) }] : []),
      ],
    });
    p.billed = round2(bill.gross);
    this.payments.set(p.payId, p);
    return true;
  }

  /** The driver gave it back, or it was withdrawn: the bill reversed, and everything the person paid goes back to them. */
  private giveBack(f: Freight, charged: { gross: number; tax: number; provision: number }, why: string): void {
    const p = this.held(f.freightId);
    if (!p) return;
    this.books.post({
      entityId: p.entityId,
      kind: 'rebate',
      ref: f.freightId,
      currency: p.currency,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: p.personDid, amount: -round2(charged.gross) },
        { code: ACCOUNT_CODES.REVENUE, amount: round2(charged.gross - charged.tax - charged.provision) },
        ...(charged.tax > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: round2(charged.tax) }] : []),
        ...(charged.provision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: round2(charged.provision) }] : []),
      ],
    });
    p.billed = undefined;
    p.state = 'refunded';
    p.why = why;
    this.payments.set(p.payId, p);
    this.owe(p, p.paid ?? 0);
    this.tell(p.personDid, `${p.loadCode}: your money goes back to you`, `The driver did not carry it (${why}). ${this.money(p.paid ?? 0, p.currency)} goes back to your number with the next payout, and the load is open for prices again.`, p.freightId);
  }

  /** Delivered: what was paid and not used (the rounding up) goes back. */
  private delivered(freightId: string): void {
    const p = this.held(freightId);
    if (!p) return;
    p.state = 'delivered';
    this.payments.set(p.payId, p);
    const left = round2((p.paid ?? 0) - (p.billed ?? 0));
    if (left > 0) this.owe(p, left);
  }

  /* ---------------------------------------------------------------- time -- */

  /** A payment not made in time: the driver let go, the prices open again, both told. */
  sweep(now: number = Date.now()): void {
    for (const p of this.payments.values()) {
      if (p.state !== 'awaiting' || Date.parse(p.until) > now) continue;
      p.state = 'lapsed';
      p.why = 'not paid in time';
      this.payments.set(p.payId, p);
      if (p.fundingId) {
        try {
          if (this.funding.get(p.fundingId).status === 'awaiting') this.funding.expire(p.fundingId, 'not paid in time', now);
        } catch {
          // the request is gone: nothing to expire
        }
      }
      this.dispatch.releasePayHold(p.freightId);
      this.tell(p.personDid, `${p.loadCode}: not paid in time`, 'The price you accepted was not paid within the time, so the driver is free again. Accept a price again when you are ready.', p.freightId);
      try {
        this.tellDriver(this.dispatch.requireProposalPublic(p.proposalId).driverDid, `${p.loadCode} was not paid`, 'The sender did not pay in time: the load is open again, and your price stands.', p.freightId);
      } catch {
        // the price is gone
      }
    }
  }

  /* -------------------------------------------------------------- inside -- */

  /** The payment that holds this load's money now: paid, and not yet given back or settled. */
  private held(freightId: string): LoadPayment | undefined {
    return [...this.payments.values()].find((p) => p.freightId === freightId && p.state === 'paid');
  }

  private latest(freightId: string): LoadPayment | undefined {
    return [...this.payments.values()].filter((p) => p.freightId === freightId).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
  }

  private owe(p: LoadPayment, amount: number): void {
    this.oweLoose(p.personDid, p.entityId, p.currency, amount, p);
  }

  /** What is owed back moves to PAYABLE_PERSON at once, for the payout run to send to the number it came from. */
  private oweLoose(personDid: string, entityId: string, currency: string, amount: number, p: LoadPayment | undefined): number {
    const exact = round2(amount);
    if (exact <= 0) return 0;
    const owed = WHOLE_UNITS.has(currency.toUpperCase()) ? Math.ceil(exact - 1e-9) : exact;
    const given = round2(owed - exact);
    this.books.post({
      entityId,
      kind: 'load-unused',
      ref: p?.payId ?? `load:${personDid}`,
      currency,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: personDid, amount: exact },
        ...(given > 0 ? [{ code: ACCOUNT_CODES.REVENUE, amount: given }] : []),
        { code: ACCOUNT_CODES.PAYABLE_PERSON, counterparty: personDid, amount: -owed },
      ],
    });
    if (p) {
      p.owedBack = round2((p.owedBack ?? 0) + owed);
      this.payments.set(p.payId, p);
    }
    return owed;
  }

  private refundDestination(payeeId: string): { numberId: string; masked: string } | undefined {
    const p = [...this.payments.values()].filter((x) => x.personDid === payeeId && x.phone).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
    return p ? { numberId: `load:${p.payId}`, masked: p.phoneMasked } : undefined;
  }

  private refundNumber(payeeId: string, numberId: string): string | undefined {
    if (!numberId.startsWith('load:')) return undefined;
    const p = this.payments.get(numberId.slice('load:'.length));
    return p && p.personDid === payeeId && p.phone ? (normaliseMsisdn(p.phone) ?? p.phone) : undefined;
  }

  private money(amount: number, currency: string): string {
    return `${currency} ${amount.toFixed(2)}`;
  }

  /** The person, in their own app — never a text. */
  private tell(personDid: string, title: string, body: string, freightId?: string): void {
    void this.notifications
      ?.notify(personDid, { kind: 'load_payment', title, body, link: '/?screen=parcels', tag: `load:${freightId ?? personDid}:${title}`, data: freightId ? { freightId } : {} })
      .catch((err: Error) => this.logger.warn(`load notice not sent: ${err.message}`));
  }

  private tellDriver(driverDid: string, title: string, body: string, freightId: string): void {
    void this.notifications
      ?.notify(driverDid, { kind: 'load_payment', title, body, link: '/?board', tag: `load:${freightId}:${title}`, data: { freightId } })
      .catch((err: Error) => this.logger.warn(`load notice not sent: ${err.message}`));
  }
}

/** Every minute: a payment not made in time lets the driver go. */
@Injectable()
export class PersonLoadPaySweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PersonLoadPaySweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly loads: PersonLoadPayService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.loads.sweep();
      } catch (err) {
        this.logger.warn(`the load payment sweep did not run: ${(err as Error).message}`);
      }
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
