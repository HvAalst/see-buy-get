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
import { MollieError } from '../../foundation/mollie/mollie-client';
import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import { DriverService } from './driver.service';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { NotificationService } from './notification.service';
import { money, noticeOf, said } from './notice-words/say';
import type { LoadPayment, LoadPaymentView, LoadRefund, LoadRoute } from './person-load-pay.types';

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Moneys paid in whole units: what is asked is rounded up, and what was not used goes back. */
const WHOLE_UNITS = new Set(['KES', 'UGX', 'TZS', 'RWF', 'BIF']);
/** How long a person has to pay after accepting a price, before the driver is let go. */
export const LOAD_PAY_WINDOW_MIN = 15;
/** Mollie routes a payment within 90 days of it; a day is kept in hand. */
export const ROUTE_WITHIN_MS = 89 * 24 * 60 * 60_000;
/** A route or a refund Mollie did not answer is asked again this often, under the same key — after first asking what is there. */
export const MOLLIE_AGAIN_AFTER_MS = 5 * 60_000;

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
    // 2026-11-25 — route plan part 9b, step 2: the carrier's pay routed through Mollie, money back as a Mollie refund.
    @Optional() private readonly mollie?: MollieConnectService,
    @Optional() private readonly drivers?: DriverService,
  ) {}

  onModuleInit(): void {
    this.dispatch.registerPrepaid({
      // Paid, and — for the hold after delivery (2026-11-15) — delivered: still this service's money to give back.
      owns: (f) => Boolean(this.held(f.freightId) ?? this.settled(f.freightId)),
      bill: (f, bill) => this.bill(f, bill),
      giveBack: (f, charged, why) => this.giveBack(f, charged, why),
      refundCarriage: (f, charged, why) => this.refundCarriage(f, charged, why),
      payerOf: (f) => this.latest(f.freightId)?.personDid,
      roadPaid: (f, payee, amount) => this.roadPaid(f, payee, amount),
      mollieFirst: (f, driverDid) => this.mollieFirst(f, driverDid),
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
      ...(p.phoneMasked ? { phoneMasked: p.phoneMasked } : {}),
      ...(p.link ? { link: p.link } : {}),
      ...(p.instructions ? { instructions: p.instructions } : {}),
      ...(p.reference ? { reference: p.reference } : {}),
      ...(p.pushed != null ? { pushed: p.pushed } : {}),
      ...(p.owedBack ? { owedBack: p.owedBack } : {}),
      ...(p.owedBack ? { backTo: this.mollieOf(p) ? 'account' : 'number' } : {}),
      ...(p.why ? { why: p.why } : {}),
    };
  }

  /**
   * The person accepts a driver's price by paying for it — the driver's own, or the person's price back that the driver took.
   * Refused before anything is written: not their load, a load they pay the driver for directly, not open, a payment already
   * waiting, a number M-Pesa could not ask.
   */
  async pay(personDid: string, freightId: string, input: { proposalId: string; phone?: string }, now: number = Date.now()): Promise<LoadPaymentView> {
    const f = this.dispatch.requireFreightPublic(freightId);
    if (f.postedByDid !== personDid) throw new GlosError('FORBIDDEN', 'That load is not yours');
    if (!f.escrow || !f.sellerEntityId) throw new GlosError('INVALID_STATE', 'You pay the driver of this load directly: accept the price instead');
    if (!(f.status === 'available' || f.status === 'scheduled')) throw new GlosError('INVALID_STATE', `The load is ${f.status}`);
    const waiting = this.latest(freightId);
    if (waiting?.state === 'awaiting') throw new GlosError('INVALID_STATE', 'A payment for this load is already waiting: pay it, or wait until its time runs out');
    const proposal = this.dispatch.requireProposalPublic(input.proposalId);
    if (proposal.freightId !== freightId || proposal.status !== 'open') throw new GlosError('INVALID_STATE', 'That price is no longer open');
    const price = proposal.counterTaken && proposal.counter ? proposal.counter.price : proposal.price;
    const entity = this.entities.get(f.sellerEntityId);
    const currency = entity.currency ?? f.postedCurrency ?? '';
    // 2026-11-24 — the payment hub chooses the way by the country's money (the owner): a number only where its rail rings one.
    const ringsPhone = this.funding.needsPhone(currency);
    const phone = ringsPhone ? (input.phone ?? '').trim() : '';
    if (ringsPhone && !isPlausiblePhone(phone)) throw new GlosError('INVALID_INPUT', 'Give the number M-Pesa should ask, with its country code', { field: 'phone' });
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
      ...(phone ? { phone, phoneMasked: maskMsisdn(phone) } : {}),
      openedAt: new Date(now).toISOString(),
      until,
      state: 'awaiting',
    };
    // Kept BEFORE the rail is asked: the rail asks who pays (resolvePayer) before it answers.
    this.payments.set(payment.payId, payment);
    let funding;
    try {
      funding = await this.funding.open({ payerKind: 'person', payerDid: personDid, purpose: 'load', amount, ...(phone ? { payerPhone: phone } : {}) }, now);
    } catch (err) {
      this.payments.delete(payment.payId);
      throw err;
    }
    payment.fundingId = funding.fundingId;
    payment.reference = funding.reference;
    // 2026-11-25 — where the carrier's pay will go, decided now: Mollie routes only to an account connected before the payment.
    const routeTo = this.routeFor(proposal.driverDid, currency, entity.entityId, funding.provider);
    if (routeTo) payment.routeTo = routeTo;
    if (funding.instructions) payment.instructions = funding.instructions;
    payment.pushed = Boolean(funding.pushed);
    if (funding.link) payment.link = funding.link;
    this.payments.set(payment.payId, payment);
    this.dispatch.holdForPayment(freightId, proposal.proposalId, until);
    this.tellDriver(proposal.driverDid, noticeOf(said('personLoadPay.priceAccepted.title', { code: f.code }), said('personLoadPay.priceAccepted.body', { price: money(this.money(price, currency), price, currency), until: until.slice(11, 16) })), freightId);
    return this.viewFor(personDid, freightId)!;
  }

  /** The person says it arrived — the driver may then deliver without the code (their receiver lost it). */
  arrived(personDid: string, freightId: string, now: number = Date.now()): { confirmedAt: string } {
    const f = this.dispatch.requireFreightPublic(freightId);
    if (f.postedByDid !== personDid) throw new GlosError('FORBIDDEN', 'That load is not yours');
    return { confirmedAt: this.dispatch.posterSaysArrived(freightId, now, personDid) };
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
      p.paidAt = new Date(now).toISOString();
      this.payments.set(p.payId, p);
      try {
        this.dispatch.releasePayHold(p.freightId);
        this.dispatch.acceptProposal(p.proposalId, now, p.price);
        this.dispatch.issueDeliveryCode(p.freightId);
        this.tell(personDid, noticeOf(said('personLoadPay.paidOnItsWay.title', { code: p.loadCode }), said('personLoadPay.paidOnItsWay.body')), p.freightId);
        return { entryId: entry.entryId };
      } catch (err) {
        this.logger.warn(`load ${p.loadCode} not committed after payment: ${(err as Error).message}`);
        p.state = 'refunded';
        p.why = 'the driver could no longer take it';
        this.payments.set(p.payId, p);
        this.owe(p, gross);
        this.tell(personDid, noticeOf(said('personLoadPay.refusedByDriver.title', { code: p.loadCode }), said('personLoadPay.refusedByDriver.body', { amount: money(this.money(gross, p.currency), gross, p.currency), where: this.backWords(p) })), p.freightId);
        return { entryId: entry.entryId };
      }
    }
    // Arrived after the time ran out, a second time, or for no load: all of it goes back.
    const req = p ?? undefined;
    this.oweLoose(personDid, funding.entityId, funding.currency, gross, req);
    this.tell(personDid, noticeOf(said('personLoadPay.loose.title'), said('personLoadPay.loose.body', { amount: money(this.money(gross, funding.currency), gross, funding.currency) })), p?.freightId);
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
    this.tell(p.personDid, noticeOf(said('personLoadPay.giveBack.title', { code: p.loadCode }), said('personLoadPay.giveBack.body', { why: this.whyWords(why), amount: money(this.money(p.paid ?? 0, p.currency), p.paid ?? 0, p.currency), where: this.backWords(p) })), p.freightId);
  }

  /** 2026-11-15 — the protocol gave the carriage price back after delivery: the bill reversed, and it goes back to the person. */
  private refundCarriage(f: Freight, charged: { gross: number; tax: number; provision: number }, why: string): void {
    const p = this.settled(f.freightId) ?? this.held(f.freightId);
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
    this.owe(p, charged.gross);
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

  /* ------------------------------------------- 9b step 2: through Mollie -- */

  /**
   * WHERE THE CARRIER'S PAY GOES, decided when the person pays (route plan part 9b, step 2; the owner: "the system will choose the
   * right method depending on the country"): the carrier's own Mollie account — where routing is switched on for our account, the
   * money is euros paid through Mollie, the carrier (or its fleet) is paid by the same company of ours, and its account was
   * connected through the Connect app, can take payments, and was not taken away. Else nothing: paid the country's way.
   */
  private routeFor(driverDid: string, currency: string, entityId: string, provider: string | undefined): LoadPayment['routeTo'] {
    if (!this.mollie?.cfg.routing || provider !== 'mollie' || currency.toUpperCase() !== 'EUR' || !this.drivers) return undefined;
    let payee: { entityId?: string; payeeDid: string };
    try {
      payee = this.drivers.payeeOrNone(driverDid);
    } catch {
      return undefined;
    }
    if (payee.entityId !== entityId) return undefined;
    const c = this.mollie.connection(payee.payeeDid);
    if (!c || c.via !== 'oauth' || c.lostAt || !c.organization?.id || c.canReceivePayments === false) return undefined;
    return { payeeId: payee.payeeDid, organizationId: c.organization.id };
  }

  /**
   * 2026-11-26 — BEFORE A PRICE IS NAMED (the weakness after part 9b, fixed as recommended): a load a person pays upfront in euros,
   * through Mollie, where routing is on and the driver is paid by the same company of ours — would its pay go straight into the
   * carrier's own Mollie account? Where not yet, the Driver app's board says so with the way to connect: Mollie routes only to an
   * account connected before the sender pays, so connecting afterwards is too late for that load (it is paid the country's way).
   */
  mollieFirst(f: Freight, driverDid: string): 'connect' | 'office' | undefined {
    if (!this.mollie?.cfg.routing || !f.escrow || !f.sellerEntityId || !this.drivers) return undefined;
    let currency: string;
    let payee: { entityId?: string; payeeDid: string };
    try {
      currency = (this.entities.get(f.sellerEntityId).currency ?? f.postedCurrency ?? '').toUpperCase();
      payee = this.drivers.payeeOrNone(driverDid);
    } catch {
      return undefined;
    }
    if (currency !== 'EUR' || this.funding.providerFor(currency) !== 'mollie' || payee.entityId !== f.sellerEntityId) return undefined;
    if (this.routeFor(driverDid, currency, f.sellerEntityId, 'mollie')) return undefined;
    return payee.payeeDid === driverDid ? 'connect' : 'office';
  }

  /** The payment on our Mollie account this load's money came in by, where it came in through Mollie. */
  private mollieOf(p: LoadPayment): { paymentId: string } | undefined {
    if (!p.fundingId) return undefined;
    try {
      const f = this.funding.get(p.fundingId);
      return f.provider === 'mollie' && f.railRef?.startsWith('tr_') ? { paymentId: f.railRef } : undefined;
    } catch {
      return undefined;
    }
  }

  /** Where money owed back goes, said to the person. */
  private backWords(p: LoadPayment) {
    return this.mollieOf(p) ? said('personLoadPay.back.account') : said('personLoadPay.back.number');
  }

  /** Why a load went back, said to the person: the reasons dispatch gives are known; any other is said as it is. */
  private whyWords(why: string) {
    if (why === 'freight no-show release') return said('personLoadPay.why.noShow');
    if (why === 'load handed back by the driver before pickup') return said('personLoadPay.why.handedBack');
    if (why === 'freight cancelled by the sender') return said('personLoadPay.why.cancelled');
    return why;
  }

  /**
   * THE DRIVER'S PAY WAS JUST OWED (dispatch's payTheRoad, after the 24-hour hold): where it was to go through Mollie, it is settled in
   * our books IN THIS SAME TURN — so no payout run can also raise it — and Mollie is asked to route it from the person's payment to
   * the carrier's account. Too late for Mollie (90 days), or a payee other than the one decided at payment: paid the country's way.
   */
  roadPaid(f: Freight, payee: { payeeDid: string; entityId: string }, amount: number, now: number = Date.now()): void {
    const p = this.settled(f.freightId) ?? this.held(f.freightId);
    if (!p?.routeTo || p.route || payee.payeeDid !== p.routeTo.payeeId || payee.entityId !== p.entityId || !(amount > 0) || !this.mollieOf(p)) return;
    const exact = round2(amount);
    if (now - Date.parse(p.paidAt ?? p.openedAt) > ROUTE_WITHIN_MS) {
      p.route = { state: 'failed', amount: exact, at: new Date(now).toISOString(), tries: 0, why: 'too_late' };
      this.payments.set(p.payId, p);
      this.logger.warn(`load ${p.loadCode}: past Mollie's 90 days, its carrier is paid the country's way`);
      return;
    }
    this.books.post({
      entityId: p.entityId,
      kind: 'driver-payout-routed',
      ref: f.freightId,
      currency: p.currency,
      lines: [
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: payee.payeeDid, amount: exact },
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -exact },
      ],
    });
    p.route = { state: 'asked', amount: exact, at: new Date(now).toISOString(), tries: 0 };
    this.payments.set(p.payId, p);
    void this.routeNow(p.payId, now).catch((err: Error) => this.logger.warn(`load ${p.loadCode}: route not asked: ${err.message}`));
  }

  /**
   * ASK MOLLIE TO ROUTE IT: first whether a route to the carrier is there already (a retry never routes twice), then the route, under
   * a key of its own. Routed: the carrier told. Refused: our books undone, the carrier paid the country's way. No answer: asked again.
   */
  async routeNow(payId: string, now: number = Date.now()): Promise<LoadPayment | undefined> {
    const p = this.payments.get(payId);
    if (!p?.route || p.route.state !== 'asked' || !p.routeTo) return p;
    const to = p.routeTo;
    const route: LoadRoute = { ...p.route, tries: p.route.tries + 1, lastTriedAt: new Date(now).toISOString() };
    p.route = route;
    this.payments.set(p.payId, p);
    const paid = this.mollieOf(p);
    const token = this.mollie?.ownToken();
    if (!paid || !token || !this.mollie) return this.routeUndone(p, 'not_set_up');
    try {
      const there = (await this.mollie.api().listRoutes(token.bearer, paid.paymentId)).find((r) => (r.destination as { organizationId?: string } | undefined)?.organizationId === to.organizationId);
      const made =
        there ??
        (await this.mollie.api().createRoute(
          token.bearer,
          paid.paymentId,
          { amount: { currency: p.currency.toUpperCase(), value: route.amount.toFixed(2) }, description: `SeeBuyGet ${p.loadCode}`.slice(0, 255), destination: { type: 'organization', organizationId: to.organizationId } },
          `route-${p.payId}`,
        ));
      p.route = { ...route, state: 'routed', routedAt: new Date(now).toISOString(), ...(typeof made.id === 'string' ? { routeId: made.id } : {}) };
      this.payments.set(p.payId, p);
      this.tellCarrier(to.payeeId, noticeOf(said('personLoadPay.routed.title', { code: p.loadCode }), said('personLoadPay.routed.body', { amount: money(this.money(route.amount, p.currency), route.amount, p.currency), code: p.loadCode })), p.freightId);
      return p;
    } catch (err) {
      if (err instanceof MollieError && err.status < 500) return this.routeUndone(p, err.detail || err.title);
      if (route.tries % 12 === 0) this.logger.warn(`load ${p.loadCode}: Mollie has not answered the route ${route.tries} times; asked again`);
      return p;
    }
  }

  /** Mollie refused the route: nothing moved there, so our books are undone and the carrier is owed again — paid the country's way. */
  private routeUndone(p: LoadPayment, why: string): LoadPayment {
    const route = p.route as LoadRoute;
    const payeeId = (p.routeTo as { payeeId: string }).payeeId;
    this.books.post({
      entityId: p.entityId,
      kind: 'driver-payout-routed-undone',
      ref: p.freightId,
      currency: p.currency,
      lines: [
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: payeeId, amount: -route.amount },
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: route.amount },
      ],
    });
    p.route = { ...route, state: 'failed', why: why.slice(0, 200) };
    this.payments.set(p.payId, p);
    this.logger.warn(`load ${p.loadCode}: Mollie did not route the carrier's pay (${why}); it is paid the country's way`);
    return p;
  }

  /**
   * MONEY BACK THROUGH MOLLIE, to the account the person paid from: settled in our books first — so no payout run raises it — then
   * asked of Mollie. Never on a payment part of which went to the carrier: that is given back by hand.
   */
  private refundThroughMollie(p: LoadPayment, amount: number, now: number = Date.now()): void {
    if (p.route && p.route.state !== 'failed') return;
    if (!this.mollieOf(p) || !this.mollie?.ownToken()) return;
    const exact = round2(amount);
    this.books.post({
      entityId: p.entityId,
      kind: 'load-refund',
      ref: p.payId,
      currency: p.currency,
      lines: [
        { code: ACCOUNT_CODES.PAYABLE_PERSON, counterparty: p.personDid, amount: exact },
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -exact },
      ],
    });
    const back: LoadRefund = { n: (p.refunds?.length ?? 0) + 1, amount: exact, state: 'asked', at: new Date(now).toISOString(), tries: 0 };
    p.refunds = [...(p.refunds ?? []), back];
    this.payments.set(p.payId, p);
    void this.refundNow(p.payId, back.n, now).catch((err: Error) => this.logger.warn(`load ${p.loadCode}: refund not asked: ${err.message}`));
  }

  /** Ask Mollie for one refund: first whether it is there already (by its own marks), then the refund. Refused: undone, by hand. */
  async refundNow(payId: string, n: number, now: number = Date.now()): Promise<LoadRefund | undefined> {
    const p = this.payments.get(payId);
    const r = p?.refunds?.find((x) => x.n === n);
    if (!p || !r || r.state !== 'asked') return r;
    const tried: LoadRefund = { ...r, tries: r.tries + 1, lastTriedAt: new Date(now).toISOString() };
    const save = (next: LoadRefund): LoadRefund => {
      p.refunds = (p.refunds ?? []).map((x) => (x.n === n ? next : x));
      this.payments.set(p.payId, p);
      return next;
    };
    save(tried);
    const paid = this.mollieOf(p);
    const token = this.mollie?.ownToken();
    if (!paid || !token || !this.mollie) return this.refundUndone(p, tried, 'not_set_up');
    const mark = `${p.payId}:${n}`;
    try {
      const there = (await this.mollie.api().listRefunds(token.bearer, paid.paymentId)).find((x) => (x.metadata as { mark?: string } | undefined)?.mark === mark);
      const made =
        there ??
        (await this.mollie.api().createRefund(
          token.bearer,
          paid.paymentId,
          { amount: { currency: p.currency.toUpperCase(), value: tried.amount.toFixed(2) }, description: `SeeBuyGet ${p.loadCode}: money back`.slice(0, 255), metadata: { mark } },
          `load-refund-${mark}`,
        ));
      return save({ ...tried, state: 'sent', ...(typeof made.id === 'string' ? { refundId: made.id } : {}) });
    } catch (err) {
      if (err instanceof MollieError && err.status < 500) return this.refundUndone(p, tried, err.detail || err.title);
      return tried;
    }
  }

  /** Mollie refused the refund: our books undone, the person owed again — given back by hand. */
  private refundUndone(p: LoadPayment, r: LoadRefund, why: string): LoadRefund {
    this.books.post({
      entityId: p.entityId,
      kind: 'load-refund-undone',
      ref: p.payId,
      currency: p.currency,
      lines: [
        { code: ACCOUNT_CODES.PAYABLE_PERSON, counterparty: p.personDid, amount: -r.amount },
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: r.amount },
      ],
    });
    const next: LoadRefund = { ...r, state: 'failed', why: why.slice(0, 200) };
    p.refunds = (p.refunds ?? []).map((x) => (x.n === r.n ? next : x));
    this.payments.set(p.payId, p);
    this.logger.warn(`load ${p.loadCode}: Mollie did not take the refund (${why}); it is given back by hand`);
    return next;
  }

  /** Every route and refund Mollie has not answered yet, asked again — at most every five minutes each. */
  async mollieAgain(now: number = Date.now()): Promise<void> {
    const due = (lastTriedAt?: string) => !lastTriedAt || now - Date.parse(lastTriedAt) >= MOLLIE_AGAIN_AFTER_MS;
    for (const p of [...this.payments.values()]) {
      if (p.route?.state === 'asked' && due(p.route.lastTriedAt)) await this.routeNow(p.payId, now);
      for (const r of p.refunds ?? []) if (r.state === 'asked' && due(r.lastTriedAt)) await this.refundNow(p.payId, r.n, now);
    }
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
      this.tell(p.personDid, noticeOf(said('personLoadPay.lapsed.title', { code: p.loadCode }), said('personLoadPay.lapsed.body')), p.freightId);
      try {
        this.tellDriver(this.dispatch.requireProposalPublic(p.proposalId).driverDid, noticeOf(said('personLoadPay.lapsedDriver.title', { code: p.loadCode }), said('personLoadPay.lapsedDriver.body')), p.freightId);
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

  /** Delivered, its money settled — still this service's to give back, while a hold after delivery runs. */
  private settled(freightId: string): LoadPayment | undefined {
    return [...this.payments.values()].find((p) => p.freightId === freightId && p.state === 'delivered');
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
      // 2026-11-25 — paid through Mollie: given back there, to the account it came from (route plan part 9b, step 2).
      this.refundThroughMollie(p, owed);
    }
    return owed;
  }

  private refundDestination(payeeId: string): { numberId: string; masked: string } | undefined {
    const p = [...this.payments.values()].filter((x) => x.personDid === payeeId && x.phone).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
    return p?.phoneMasked ? { numberId: `load:${p.payId}`, masked: p.phoneMasked } : undefined;
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
  private tell(personDid: string, n: ReturnType<typeof noticeOf>, freightId?: string): void {
    void this.notifications
      ?.notify(personDid, { kind: 'load_payment', ...n, link: '/?screen=parcels', tag: `load:${freightId ?? personDid}:${n.title}`, data: freightId ? { freightId } : {} })
      .catch((err: Error) => this.logger.warn(`load notice not sent: ${err.message}`));
  }

  /** The carrier paid for the load: the courier, or its fleet's office — in its own app. */
  private tellCarrier(payeeDid: string, n: ReturnType<typeof noticeOf>, freightId: string): void {
    void this.notifications
      ?.notify(payeeDid, { kind: 'load_payment', ...n, link: '/?board', tag: `load:${freightId}:routed`, data: { freightId } })
      .catch((err: Error) => this.logger.warn(`load notice not sent: ${err.message}`));
  }

  private tellDriver(driverDid: string, n: ReturnType<typeof noticeOf>, freightId: string): void {
    void this.notifications
      ?.notify(driverDid, { kind: 'load_payment', ...n, link: '/?board', tag: `load:${freightId}:${n.title}`, data: { freightId } })
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
      void this.loads.mollieAgain().catch((err: Error) => this.logger.warn(`routes and refunds not asked again: ${err.message}`));
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
