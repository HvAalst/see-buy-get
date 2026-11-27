import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { refused } from './notice-words/refuse';
import { said, type Said } from './notice-words/say';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { appUrl } from '../../foundation/mail/mail.templates';
import { MollieError } from '../../foundation/mollie/mollie-client';
import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import { directPayWayOf } from '../../foundation/mollie/mollie.types';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { ParcelService, parcelCurrency } from './parcel.service';
import type { Parcel } from './pudo.types';
import { BOOKING_PAY_FINAL, type BookingPayStatus, type BookingPayView, type BookingPayWhyNot, type BookingPayment } from './booking-pay.types';

/** An open payment is asked about again, when the sender's screen looks, no more often than this. */
const LOOK_EVERY_MS = 5_000;
const STATUSES: readonly BookingPayStatus[] = ['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed'];
const round2 = (n: number) => Math.round(n * 100) / 100;
/** A refund Mollie could not take is asked again this often. */
const REFUND_AGAIN_MS = 3_600_000;

/**
 * 2026-11-21 — A SEND-APP BOOKING PAID ONLINE WHEN BOOKED (the payments plan, 5a and 5b; P5-a "netherlands first", P5-b "it stays
 * optional").
 *
 * Where Mollie runs (the Netherlands) and the booking is in euros, its sender may pay by iDEAL at once, into OUR OWN company's
 * Mollie account (its API key in the server's settings; the test key stands in for test money). The booking code and cash at the
 * shop stay for anybody who would rather.
 *
 * Mollie's word is checked, never taken: its notice only names a payment, which is fetched again, and marks the booking paid only
 * for what was asked, in the money asked for. Then the label is made (ParcelService.markPaidOnline), to print at home or show at
 * the shop, and the money is held as the sender's (DEPOSIT_PERSON) until the shop takes the parcel in — then it is our income,
 * with its tax (takenIn). Mollie's own charge is our cost, booked when Mollie reports it.
 */
@Injectable()
export class BookingPayService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BookingPay');
  private readonly payments = new PersistentMap<string, BookingPayment>('booking-payments');
  private readonly latest = new PersistentMap<string, string>('booking-payments-by-parcel');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly mollie: MollieConnectService,
    private readonly parcels: ParcelService,
    private readonly agents: AgentService,
    private readonly books: BooksService,
    @Optional() private readonly events?: EventBus,
  ) {}

  onModuleInit(): void {
    this.parcels.onTakenInPaidOnline((p) => this.takenIn(p));
    // 2026-11-21 — called off or voided before it left the shop (5c): given back to the account that paid.
    this.parcels.onCalledOffPaidOnline((p, why) => void this.refundFor(p.parcelId, why).catch((err) => this.logger.warn(`refund for ${p.parcelId}: ${(err as Error).message}`)));
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.refundsAgain().catch((err) => this.logger.warn(`refunds again: ${(err as Error).message}`)), REFUND_AGAIN_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 2026-11-21 — GIVEN BACK IN FULL TO THE ACCOUNT THAT PAID (the payments plan, 5c): a booking called off or voided before it
   * left the shop, or a payment that arrived for a booking already paid in cash. Asked of Mollie on our own account; the books
   * follow once Mollie takes it (what was income is taken back first, then the money leaves). Mollie unreachable or refusing,
   * it waits and is asked again every hour. Once only.
   */
  async refundFor(parcelId: string, why: string, now: number = Date.now()): Promise<BookingPayment | undefined> {
    const p = this.latestFor(parcelId);
    if (!p || p.status !== 'paid' || p.refund?.state === 'asked') return p;
    return this.askRefund(p, p.refund?.why ?? why, now);
  }

  /** Every hour: each refund Mollie could not take, asked again. */
  async refundsAgain(now: number = Date.now()): Promise<number> {
    let asked = 0;
    for (const p of [...this.payments.values()]) {
      if (p.refund?.state !== 'waiting') continue;
      const done = await this.askRefund(p, p.refund.why, now).catch(() => undefined);
      if (done?.refund?.state === 'asked') asked += 1;
    }
    return asked;
  }

  private async askRefund(p: BookingPayment, why: string, now: number): Promise<BookingPayment> {
    const token = this.mollie.ownToken();
    const at = new Date(now).toISOString();
    const tries = (p.refund?.tries ?? 0) + 1;
    const wait = (error: string): BookingPayment => {
      const next: BookingPayment = { ...p, refund: { state: 'waiting', why, at, error, tries } };
      this.payments.set(p.paymentId, next);
      if (tries === 1) this.tellRefund(next);
      return next;
    };
    if (!token) return wait('Our Mollie account is not set up on this server');
    let made: Record<string, unknown>;
    try {
      made = await this.mollie.api().createRefund(token.bearer, p.paymentId, { amount: { currency: p.currency, value: p.amount.toFixed(2) }, description: `SeeBuyGet ${p.parcelId}: ${why}`.slice(0, 255) }, `refund-${p.paymentId}`);
    } catch (err) {
      return wait(asOurs(err).message);
    }
    const next: BookingPayment = { ...p, refund: { state: 'asked', why, at, ...(typeof made.id === 'string' ? { refundId: made.id } : {}), tries } };
    this.payments.set(p.paymentId, next);
    this.bookRefund(next);
    this.tellRefund(next);
    return next;
  }

  /** The books, once Mollie takes the refund: what was our income taken back first (5b), then the money leaving our account. */
  private bookRefund(p: BookingPayment): void {
    const gross = round2(p.amount);
    try {
      if (p.takenIn) {
        const tax = round2(p.takenIn.tax);
        const provision = round2(p.takenIn.provision);
        this.books.post({
          entityId: p.entityId,
          kind: 'shipping-reversal',
          ref: p.parcelId,
          currency: p.currency,
          lines: [
            { code: ACCOUNT_CODES.REVENUE, amount: round2(gross - tax - provision) },
            ...(tax > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: tax }] : []),
            ...(provision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: provision }] : []),
            { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: p.personDid, amount: -gross },
          ],
        });
      }
      this.books.post({
        entityId: p.entityId,
        kind: 'send-refund',
        ref: p.refund?.refundId ?? p.paymentId,
        currency: p.currency,
        lines: [
          { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: p.personDid, amount: gross },
          { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -gross },
        ],
      });
    } catch (err) {
      this.logger.warn(`Mollie refund for ${p.parcelId} was asked, but could not be booked: ${(err as Error).message}`);
    }
  }

  private tellRefund(p: BookingPayment): void {
    void this.events?.publish(GlosEvent.Pudo.BookingRefunded, { parcelId: p.parcelId, personDid: p.personDid, amount: p.amount, currency: p.currency, state: p.refund?.state }, { source: 'pudo' }).catch(() => undefined);
  }

  /** What the Send app shows for this booking: whether it can be paid online now, and the latest payment. */
  view(parcelId: string): BookingPayView {
    const parcel = this.parcels.get(parcelId);
    const p = this.latestFor(parcelId);
    const offer = this.offerOf(parcel);
    return {
      ...offer,
      ...(p ? { status: p.status, ...(p.checkoutUrl && !BOOKING_PAY_FINAL.includes(p.status) ? { checkoutUrl: p.checkoutUrl } : {}), ...(p.paidAt ? { paidAt: p.paidAt } : {}), ...(p.refund ? { refund: p.refund.state } : {}) } : {}),
    };
  }

  /** The same, after asking Mollie about an open payment — for a phone that came back from the bank before Mollie's notice did. */
  async look(parcelId: string, now: number = Date.now()): Promise<BookingPayView> {
    const p = this.latestFor(parcelId);
    if (p && !BOOKING_PAY_FINAL.includes(p.status) && (!p.checkedAt || now - Date.parse(p.checkedAt) >= LOOK_EVERY_MS)) await this.refresh(p, now).catch(() => undefined);
    return this.view(parcelId);
  }

  /**
   * Pay this booking now: a Mollie payment by iDEAL for its price, into our own account. An open one is given again rather than
   * a second made. The sender comes back to the Send app, on this booking.
   */
  async ask(parcelId: string, personDid: string, now: number = Date.now()): Promise<BookingPayView> {
    const parcel = this.parcels.get(parcelId);
    const offer = this.offerOf(parcel);
    if (!offer.offered) throw refused('INVALID_STATE', refusalOf(offer.why));
    const open = this.latestFor(parcelId);
    if (open && !BOOKING_PAY_FINAL.includes(open.status) && (!open.expiresAt || Date.parse(open.expiresAt) > now)) return this.view(parcelId);
    const token = this.mollie.ownToken()!;
    const amount = offer.amount!;
    const base = this.mollie.cfg.publicBase;
    const hooked = base && !/\/\/(localhost|127\.|\[::1\])/.test(base);
    const tries = [...this.payments.values()].filter((p) => p.parcelId === parcelId).length;
    const body: Record<string, unknown> = {
      amount: { currency: 'EUR', value: amount.toFixed(2) },
      description: `SeeBuyGet ${parcelId}`.slice(0, 255),
      method: 'ideal',
      redirectUrl: `${appUrl('send')}?parcel=${encodeURIComponent(parcelId)}`,
      ...(hooked ? { webhookUrl: `${base}/v1/sbg/mollie/webhook` } : {}),
      metadata: { kind: 'booking', parcelId },
      locale: 'nl_NL',
    };
    let made: Record<string, unknown>;
    try {
      made = await this.mollie.api().createPayment(token.bearer, body, `booking-${parcelId}-${tries + 1}`);
    } catch (err) {
      throw asOurs(err);
    }
    const paymentId = String(made.id ?? '');
    if (!paymentId.startsWith('tr_')) throw refused('PROVIDER_UNAVAILABLE', said('refuse.bookingPay.noPaymentGiven'));
    const checkout = (made._links as { checkout?: { href?: string } } | undefined)?.checkout?.href;
    const p: BookingPayment = {
      paymentId,
      parcelId,
      personDid,
      entityId: parcel.collectingEntityId ?? '',
      amount,
      currency: 'EUR',
      testmode: token.testmode,
      status: statusOf(made.status) ?? 'open',
      ...(checkout ? { checkoutUrl: checkout } : {}),
      createdAt: new Date(now).toISOString(),
      ...(typeof made.expiresAt === 'string' ? { expiresAt: made.expiresAt } : {}),
      checkedAt: new Date(now).toISOString(),
    };
    this.payments.set(paymentId, p);
    this.latest.set(parcelId, paymentId);
    return this.view(parcelId);
  }

  /** Mollie's notice names a payment: ours is fetched again and acted on; anybody else's (a load paid direct) is left. */
  async onWebhook(paymentId: string, now: number = Date.now()): Promise<boolean> {
    const p = this.payments.get(paymentId);
    if (!p) return false;
    await this.refresh(p, now);
    return true;
  }

  /** The payment a booking was paid by, where it was paid online. */
  paidFor(parcelId: string): BookingPayment | undefined {
    const p = this.latestFor(parcelId);
    return p?.status === 'paid' ? p : undefined;
  }

  private offerOf(parcel: Parcel): Pick<BookingPayView, 'offered' | 'why' | 'amount' | 'currency' | 'testmode'> {
    const no = (why: BookingPayWhyNot) => ({ offered: false, why });
    if (parcel.direction !== 'outbound' || !parcel.senderPhoneHash || parcel.vendorId) return no('not_booking');
    if (parcel.paidOnline) return no('paid');
    if (parcel.status !== 'Created' || parcel.paidStatus === 'ParcelPaid') return no('handed_in');
    const country = parcel.originAgentDid ? this.agents.find(parcel.originAgentDid)?.country : undefined;
    if (directPayWayOf(country) !== 'mollie') return no('not_here');
    const currency = parcelCurrency(parcel);
    if (currency !== 'EUR') return no('not_eur');
    const token = this.mollie.ownToken();
    if (!token) return no('no_account');
    return { offered: true, amount: round2(parcel.shipmentCost ?? 0), currency, testmode: token.testmode };
  }

  private async refresh(p: BookingPayment, now: number): Promise<void> {
    const token = this.mollie.ownToken();
    if (!token) return;
    let got: Record<string, unknown>;
    try {
      got = await this.mollie.api().getPayment(token.bearer, p.paymentId, false);
    } catch (err) {
      throw asOurs(err);
    }
    const status = statusOf(got.status) ?? p.status;
    const paidAt = typeof got.paidAt === 'string' ? got.paidAt : undefined;
    const was = p.status;
    const next: BookingPayment = { ...p, status, ...(paidAt ? { paidAt } : {}), checkedAt: new Date(now).toISOString(), ...(typeof got.expiresAt === 'string' ? { expiresAt: got.expiresAt } : {}) };
    if (status !== 'paid') {
      this.payments.set(p.paymentId, next);
      return;
    }
    // Paid what was asked, in the money asked for: anything else is somebody else's payment, and marks nothing paid.
    const amount = got.amount as { currency?: string; value?: string } | undefined;
    if (amount?.currency !== p.currency || Number(amount?.value) !== p.amount) {
      this.logger.warn(`Mollie payment ${p.paymentId} for ${p.parcelId} came back for ${amount?.currency} ${amount?.value}, not ${p.currency} ${p.amount}: not marked paid`);
      this.payments.set(p.paymentId, { ...next, status: was });
      return;
    }
    this.payments.set(p.paymentId, next);
    if (was === 'paid') return;
    this.paid(next, paidAt ? Date.parse(paidAt) : now);
  }

  /** The money arrived: held as the sender's first, always — then the booking marked paid and its label made. */
  private paid(p: BookingPayment, at: number): void {
    const when = new Date(at).toISOString();
    try {
      this.books.post({
        entityId: p.entityId,
        kind: 'send-prepayment',
        ref: p.paymentId,
        currency: p.currency,
        lines: [
          { code: ACCOUNT_CODES.CASH_CUSTODY, amount: round2(p.amount) },
          { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: p.personDid, amount: -round2(p.amount) },
        ],
      });
    } catch (err) {
      this.logger.warn(`Mollie payment ${p.paymentId} for ${p.parcelId} is paid, but could not be booked: ${(err as Error).message}`);
    }
    try {
      this.parcels.markPaidOnline(p.parcelId, { paymentId: p.paymentId, amount: p.amount, currency: p.currency, at: when, test: p.testmode, method: 'ideal' });
      void this.events?.publish(GlosEvent.Pudo.BookingPaidOnline, { parcelId: p.parcelId, personDid: p.personDid, amount: p.amount, currency: p.currency }, { source: 'pudo' }).catch(() => undefined);
    } catch (err) {
      // Handed in for cash, or ended, before Mollie said: the money is the sender's, owed back (5c).
      this.payments.set(p.paymentId, { ...p, unapplied: (err as Error).message });
      this.logger.warn(`Mollie payment ${p.paymentId} is paid, but ${p.parcelId} could not take it: ${(err as Error).message}`);
      // 2026-11-21 — owed back, and given back at once (5c).
      void this.refundFor(p.parcelId, 'paid after it was paid at the shop').catch(() => undefined);
    }
  }

  /** Handed in at the shop (5b): what was held as the sender's becomes our income, with its tax and the claims provision. */
  private takenIn(parcel: Parcel): void {
    const p = this.paidFor(parcel.parcelId);
    if (!p || p.unapplied || p.takenIn) return;
    const gross = round2(p.amount);
    const tax = round2(Math.min(Math.max(parcel.shipmentTax ?? 0, 0), gross));
    const provision = round2(Math.min(Math.max(parcel.shipmentProvision ?? 0, 0), gross - tax));
    this.books.post({
      entityId: p.entityId,
      kind: 'shipping',
      ref: parcel.parcelId,
      currency: p.currency,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: p.personDid, amount: gross },
        { code: ACCOUNT_CODES.REVENUE, amount: -round2(gross - tax - provision) },
        ...(tax > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: -tax }] : []),
        ...(provision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: -provision }] : []),
      ],
    });
    this.payments.set(p.paymentId, { ...p, takenIn: { at: new Date().toISOString(), tax, provision } });
  }

  private latestFor(parcelId: string): BookingPayment | undefined {
    const id = this.latest.get(parcelId);
    return id ? this.payments.get(id) : undefined;
  }
}

function statusOf(s: unknown): BookingPayStatus | undefined {
  return STATUSES.includes(s as BookingPayStatus) ? (s as BookingPayStatus) : undefined;
}

function refusalOf(why: BookingPayWhyNot | undefined): Said {
  switch (why) {
    case 'paid':
      return said('refuse.bookingPay.paid');
    case 'handed_in':
      return said('refuse.bookingPay.handedIn');
    case 'not_here':
      return said('refuse.bookingPay.notHere');
    case 'not_eur':
      return said('refuse.bookingPay.notEur');
    case 'no_account':
      return said('refuse.bookingPay.noAccount');
    default:
      return said('refuse.bookingPay.sendAppOnly');
  }
}

function asOurs(err: unknown): GlosError {
  if (err instanceof GlosError) return err;
  if (err instanceof MollieError) return refused('PROVIDER_UNAVAILABLE', said('refuse.bookingPay.didNotAnswerAsExpected', { why: err.message }));
  return refused('PROVIDER_UNAVAILABLE', said('refuse.bookingPay.couldNotBeReached'));
}
