import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EntityService } from '../entity/entity.service';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';
import { GlosError } from '../http/glos-error';
import { hashPhone } from '../identity/phone';
import { currencyForJurisdiction } from '../money/currency';
import { PersistentMap } from '../store/persistent-map';
import { StandInProvider } from './stand-in.provider';
import { HUB_PROVIDERS, HUB_WHY, type HubAccountRecord, type HubPayment, type HubPaymentView, type HubProvider, type HubProviderId, type HubWhy, type OpenedAccount, type PaymentAccountView, type ProviderAnswer } from './hub.types';

/** Further providers, each an adapter (a test's own, or a real one once it is built for a chosen partner). */
export const PAYMENT_HUB_PROVIDERS = 'PAYMENT_HUB_PROVIDERS';
/** A prompt still waiting after this is asked of its provider no more: it lapsed. A real provider's own lapse is shorter. */
export const PROMPT_LAPSES_AFTER_MS = 15 * 60_000;
/** How often the prompts still waiting are asked of their provider. */
const LOOK_EVERY_MS = 5_000;
/** A refund that did not go (the account short, the provider unreachable) is asked again this often. */
export const REFUND_AGAIN_AFTER_MS = 60 * 60_000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * THE PAYMENT HUB (the payments plan, step 4; the owner: "a software that combines PSP's and becomes actually a payment hub").
 * A partner's money goes through its own account at its own provider, and every provider is reached through here: a payment
 * prompt asked of a payer's phone, kept as asked until the provider says paid or failed — a callback where one comes, and
 * asked again every few seconds where none does — and every payment kept, in and out, as the provider answered it.
 *
 * For now every account runs on the stand-in: test money, so the whole loop is tried before a partner exists. A real
 * provider is added as an adapter when a chosen partner uses it; its keys are entered by our staff and kept sealed, and two of
 * them switch it live — none of which exists yet, so nothing here can move real money.
 */
@Injectable()
export class PaymentHubService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PaymentHub');
  private readonly providers = new Map<HubProviderId, HubProvider>();
  private readonly payments = new PersistentMap<string, HubPayment>('payment-hub-payments');
  /** Each company's settings in the hub: our fee on its payments (P4-c). */
  private readonly accounts = new PersistentMap<string, HubAccountRecord>('payment-hub-accounts');
  /** The prompts still waiting: what the sweep asks about. Built from the kept payments when it first runs. */
  private waiting?: Set<string>;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private refundsLookedAt = 0;

  constructor(
    private readonly entities: EntityService,
    @Optional() private readonly events?: EventBus,
    @Optional() @Inject(PAYMENT_HUB_PROVIDERS) extra?: HubProvider[],
  ) {
    for (const p of [new StandInProvider(), ...(extra ?? [])]) this.providers.set(p.id, p);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep().catch((err) => this.logger.warn(`payment hub: ${(err as Error).message}`)), LOOK_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The providers whose adapter is ready: the stand-in, until a real provider's is built for a chosen partner. */
  ready(): HubProviderId[] {
    return HUB_PROVIDERS.filter((id) => this.providers.has(id));
  }

  /** The account a company's money goes through. For now always the stand-in: test money, in the company's own currency. */
  account(ownerEntityId: string): OpenedAccount & { provider: HubProviderId } {
    const entity = this.entities.get(ownerEntityId);
    const currency = this.entities.amountsFor(ownerEntityId).currency ?? entity.currency ?? currencyForJurisdiction(entity.jurisdiction);
    return { accountId: ownerEntityId, currency, keys: {}, live: false, provider: 'stand-in' };
  }

  /** The account as staff read it: its provider, test money or not, its money, and what it holds where the provider says. */
  async accountView(ownerEntityId: string, now: number = Date.now()): Promise<PaymentAccountView> {
    const a = this.account(ownerEntityId);
    const held = await this.provider(a.provider).balance(a, now).catch(() => undefined);
    const rec = this.accounts.get(ownerEntityId);
    return {
      provider: a.provider,
      test: !a.live,
      currency: a.currency,
      ready: this.ready(),
      ...(held ? { balance: held.amount } : {}),
      ...(rec?.feePct != null ? { feePct: rec.feePct, ...(rec.feeSetBy ? { feeSetBy: rec.feeSetBy } : {}), ...(rec.feeSetAt ? { feeSetAt: rec.feeSetAt } : {}) } : {}),
      feeOwed: this.feeOwed(ownerEntityId),
    };
  }

  /**
   * MONEY ASKED OF A PAYER'S PHONE, into the company's account: a payment prompt on the phone, kept as asked until the provider
   * says paid or failed. Kept BEFORE the provider is asked, so no prompt is ever out that we hold no record of. A reference
   * already paid is refused; one whose prompt is still waiting gives that same prompt for the same phone and amount — a second
   * press at a counter asks nobody twice — and is refused for another, so one thing is never paid twice from two phones.
   */
  async collect(ownerEntityId: string, req: { reference: string; amount: number; payerPhone: string; description: string; askedBy?: string; siteId?: string }, now: number = Date.now()): Promise<HubPayment> {
    const amount = round2(req.amount);
    if (!(amount > 0)) throw new GlosError('VALIDATION_FAILED', 'A payment is for more than nothing');
    const digits = (req.payerPhone ?? '').replace(/\D/g, '');
    if (digits.length < 9) throw new GlosError('VALIDATION_FAILED', 'Give the whole phone number the payment is asked of');
    const phoneHash = hashPhone(req.payerPhone);
    const earlier = this.latest(ownerEntityId, req.reference, 'in');
    if (earlier?.state === 'paid') throw new GlosError('INVALID_STATE', `${req.reference} is paid already`);
    if (earlier?.state === 'asked') {
      if (earlier.phoneHash === phoneHash && earlier.amount === amount) return earlier;
      throw new GlosError('INVALID_STATE', `A payment prompt for ${req.reference} is still waiting on the phone ending ${earlier.phoneEnds}: let it be answered or lapse first`);
    }
    const a = this.account(ownerEntityId);
    const payment: HubPayment = {
      paymentId: `hp_${randomBytes(9).toString('base64url')}`,
      kind: 'in',
      ownerEntityId,
      provider: a.provider,
      reference: req.reference,
      amount,
      currency: a.currency,
      phoneEnds: digits.slice(-3),
      phoneHash,
      state: 'asked',
      test: !a.live,
      askedAt: new Date(now).toISOString(),
      ...(req.askedBy ? { askedBy: req.askedBy } : {}),
      ...(req.siteId ? { siteId: req.siteId } : {}),
    };
    this.payments.set(payment.paymentId, payment);
    this.waitingSet().add(payment.paymentId);
    this.told(payment);
    let answer: ProviderAnswer | undefined;
    try {
      answer = await this.provider(a.provider).collect(a, { ourRef: payment.paymentId, amount, currency: a.currency, payerPhone: req.payerPhone, description: req.description }, now);
    } catch (err) {
      // Its answer was lost on the way, not necessarily its prompt: kept as asked, and asked again by our own reference.
      this.logger.warn(`a payment prompt went unanswered by ${a.provider}: ${(err as Error).message}`);
    }
    return answer ? this.apply(payment.paymentId, answer, now) : payment;
  }

  /** A try of the account by our staff: a payment prompt to a phone, on test money — the loop seen working end to end. */
  async tryPayment(ownerEntityId: string, input: { phone: string; amount: number }, by: string, now: number = Date.now()): Promise<HubPaymentView> {
    const a = this.account(ownerEntityId);
    if (a.live) throw new GlosError('FORBIDDEN', 'A try is for test money: this account moves real money');
    const p = await this.collect(ownerEntityId, { reference: `try_${randomBytes(6).toString('base64url')}`, amount: input.amount, payerPhone: input.phone, description: 'A try of the payment account', askedBy: by }, now);
    return viewOf(p);
  }

  /** Where a waiting prompt stands, asked of its provider; one waiting too long has lapsed. Settled once, never changed after. */
  async settle(paymentId: string, now: number = Date.now()): Promise<HubPayment> {
    const p = this.payments.get(paymentId);
    if (!p) throw new GlosError('NOT_FOUND', `No payment ${paymentId}`);
    if (p.state !== 'asked') return p;
    // A prompt nobody answers lapses; money sent out, or given back, never does by itself — taken for failed, it would be
    // sent again while it may have gone. Its provider is asked until it answers.
    if (p.kind === 'in' && now - Date.parse(p.askedAt) > PROMPT_LAPSES_AFTER_MS) return this.apply(paymentId, { state: 'failed', why: 'expired' }, now);
    const provider = this.providers.get(p.provider);
    if (!provider) return p;
    const answer = await provider.status(this.account(p.ownerEntityId), { ...(p.providerRef ? { providerRef: p.providerRef } : {}), ourRef: p.paymentId }, now).catch(() => undefined);
    return answer ? this.apply(paymentId, answer, now) : p;
  }

  /** Every few seconds: each prompt still waiting, asked of its provider. */
  async sweep(now: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const id of [...this.waitingSet()]) await this.settle(id, now);
      if (now - this.refundsLookedAt >= REFUND_AGAIN_AFTER_MS) {
        this.refundsLookedAt = now;
        await this.refundsAgain(now);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * OUR FEE ON A PARTNER'S PAYMENTS (P4-c; the owner: "needs to be set as a percentage on the total turnover so it can be
   * ingested per transaction"): set by our staff, by name. It counts on every payment paid from then on — each payment keeps
   * the percentage it was counted at — and never on one already paid.
   */
  setFee(ownerEntityId: string, pct: number, by: string, now: number = Date.now()): HubAccountRecord {
    this.entities.get(ownerEntityId);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new GlosError('VALIDATION_FAILED', 'Our fee is a percentage from 0 to 50');
    if (!by?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say who sets the fee: it is kept by name');
    const rec: HubAccountRecord = { ...(this.accounts.get(ownerEntityId) ?? { ownerEntityId }), feePct: round2(pct), feeSetBy: by.trim(), feeSetAt: new Date(now).toISOString() };
    this.accounts.set(ownerEntityId, rec);
    return rec;
  }

  /** Our fee counted on a company's payments, less any given back: what the partner owes us, a loan until we can invoice it. */
  feeOwed(ownerEntityId: string): number {
    const back = this.refunded();
    let sum = 0;
    for (const p of this.payments.values()) if (p.ownerEntityId === ownerEntityId && p.kind === 'in' && p.state === 'paid' && p.fee && !back.has(p.paymentId)) sum += p.fee.amount;
    return round2(sum);
  }

  /**
   * ONE PAYMENT, ONE PARCEL: a paid prompt taken as the payment for the parcel it was asked for, once. Asked by the take-in
   * before anything is written, and kept with the parcel as it is kept.
   */
  use(paymentId: string, parcelId: string): HubPayment {
    const p = this.payments.get(paymentId);
    if (!p) throw new GlosError('NOT_FOUND', `No payment ${paymentId}`);
    if (p.usedFor && p.usedFor !== parcelId) throw new GlosError('INVALID_STATE', `That payment was for ${p.usedFor} already`);
    const next = { ...p, usedFor: parcelId };
    this.payments.set(paymentId, next);
    return next;
  }

  /**
   * A PAYMENT GIVEN BACK (P4-d: a parcel voided after it was paid is refunded to the sender's phone, at once). The refund is
   * kept before the provider is asked, as a prompt is, and asked again until it answers; once given back, never twice.
   */
  async refund(paymentId: string, description: string, now: number = Date.now()): Promise<HubPayment> {
    const paid = this.payments.get(paymentId);
    if (!paid || paid.kind !== 'in' || paid.state !== 'paid') throw new GlosError('INVALID_STATE', 'Only a payment that was paid is given back');
    const earlier = [...this.payments.values()].find((x) => x.kind === 'refund' && x.refundOf === paymentId && x.state !== 'failed');
    if (earlier) return earlier;
    const a = this.account(paid.ownerEntityId);
    const back: HubPayment = {
      paymentId: `hp_${randomBytes(9).toString('base64url')}`,
      kind: 'refund',
      ownerEntityId: paid.ownerEntityId,
      provider: paid.provider,
      reference: paid.reference,
      amount: paid.amount,
      currency: paid.currency,
      phoneEnds: paid.phoneEnds,
      phoneHash: paid.phoneHash,
      state: 'asked',
      test: paid.test,
      askedAt: new Date(now).toISOString(),
      refundOf: paymentId,
    };
    this.payments.set(back.paymentId, back);
    this.waitingSet().add(back.paymentId);
    this.told(back);
    let answer: ProviderAnswer | undefined;
    try {
      answer = await this.provider(paid.provider).refund(a, { ourRef: back.paymentId, amount: paid.amount, currency: paid.currency, description, paidRef: paid.providerRef ?? '' }, now);
    } catch (err) {
      this.logger.warn(`a refund went unanswered by ${paid.provider}: ${(err as Error).message}`);
    }
    return answer ? this.apply(back.paymentId, answer, now) : back;
  }

  /**
   * 2026-11-20 — MONEY OUT, from the company's account to a payee's phone (the payments plan, 4c: what the partner owes a hand,
   * paid once a day). Kept before the provider is asked, as every payment is; a payout the account cannot cover fails with
   * "insufficient", and the caller decides when to ask again — never this, so one sum is never sent twice.
   */
  async payout(ownerEntityId: string, req: { reference: string; amount: number; payeePhone: string; description: string }, now: number = Date.now()): Promise<HubPayment> {
    const amount = round2(req.amount);
    if (!(amount > 0)) throw new GlosError('VALIDATION_FAILED', 'A payout is for more than nothing');
    const digits = (req.payeePhone ?? '').replace(/\D/g, '');
    if (digits.length < 9) throw new GlosError('VALIDATION_FAILED', 'Give the whole phone number the payout goes to');
    const a = this.account(ownerEntityId);
    const out: HubPayment = {
      paymentId: `hp_${randomBytes(9).toString('base64url')}`,
      kind: 'out',
      ownerEntityId,
      provider: a.provider,
      reference: req.reference,
      amount,
      currency: a.currency,
      phoneEnds: digits.slice(-3),
      phoneHash: hashPhone(req.payeePhone),
      state: 'asked',
      test: !a.live,
      askedAt: new Date(now).toISOString(),
    };
    this.payments.set(out.paymentId, out);
    this.waitingSet().add(out.paymentId);
    this.told(out);
    let answer: ProviderAnswer | undefined;
    try {
      answer = await this.provider(a.provider).payout(a, { ourRef: out.paymentId, amount, currency: a.currency, payeePhone: req.payeePhone, description: req.description }, now);
    } catch (err) {
      this.logger.warn(`a payout went unanswered by ${a.provider}: ${(err as Error).message}`);
    }
    return answer ? this.apply(out.paymentId, answer, now) : out;
  }

  /**
   * A refund that did not go — the account short, or the provider unreachable — is asked again, once an hour, until it goes
   * (P4-d: the sender gets the money back; 4c: when the balance allows).
   */
  async refundsAgain(now: number = Date.now()): Promise<HubPayment[]> {
    const all = [...this.payments.values()];
    const given = new Set(all.filter((x) => x.kind === 'refund' && x.state !== 'failed' && x.refundOf).map((x) => x.refundOf as string));
    const lastFailed = new Map<string, HubPayment>();
    for (const x of all) {
      if (x.kind !== 'refund' || x.state !== 'failed' || !x.refundOf || given.has(x.refundOf)) continue;
      const seen = lastFailed.get(x.refundOf);
      if (!seen || x.askedAt > seen.askedAt) lastFailed.set(x.refundOf, x);
    }
    const out: HubPayment[] = [];
    for (const [paidId, failed] of lastFailed) {
      if (now - Date.parse(failed.settledAt ?? failed.askedAt) < REFUND_AGAIN_AFTER_MS) continue;
      out.push(await this.refund(paidId, `${failed.reference}: given back, asked again`, now));
    }
    return out;
  }

  /** A company's payments, newest first. */
  paymentsOf(ownerEntityId: string, limit = 50): HubPaymentView[] {
    return [...this.payments.values()]
      .filter((p) => p.ownerEntityId === ownerEntityId)
      .sort((a, b) => b.askedAt.localeCompare(a.askedAt))
      .slice(0, limit)
      .map(viewOf);
  }

  get(paymentId: string): HubPayment | undefined {
    return this.payments.get(paymentId);
  }

  private apply(paymentId: string, answer: ProviderAnswer, now: number): HubPayment {
    const p = this.payments.get(paymentId) as HubPayment;
    if (p.state !== 'asked') return p;
    const next: HubPayment = {
      ...p,
      ...(answer.providerRef ? { providerRef: answer.providerRef } : {}),
      state: answer.state,
      ...(answer.state === 'failed' ? { why: answer.why ?? 'failed' } : {}),
      ...(answer.state !== 'asked' ? { settledAt: new Date(now).toISOString() } : {}),
      ...(answer.state === 'paid' ? this.feeOn(p) : {}),
    };
    this.payments.set(paymentId, next);
    if (next.state !== 'asked') {
      this.waitingSet().delete(paymentId);
      this.told(next);
    }
    return next;
  }

  /** Our fee on a payment as it is paid: a parcel's payment into an account whose fee is set — never a try by our staff. */
  private feeOn(p: HubPayment): Partial<HubPayment> {
    const pct = this.accounts.get(p.ownerEntityId)?.feePct;
    if (p.kind !== 'in' || p.askedBy || !pct) return {};
    return { fee: { pct, amount: round2((p.amount * pct) / 100) } };
  }

  /** The payments given back, by the payment each gives back. */
  private refunded(): Set<string> {
    const out = new Set<string>();
    for (const p of this.payments.values()) if (p.kind === 'refund' && p.state === 'paid' && p.refundOf) out.add(p.refundOf);
    return out;
  }

  /** Every payment asked, paid or failed is said on the bus: the console's live view hears it, and whatever waits on it. */
  private told(p: HubPayment): void {
    void this.events?.publish(GlosEvent.Pudo.HubPayment, { paymentId: p.paymentId, ownerEntityId: p.ownerEntityId, kind: p.kind, reference: p.reference, state: p.state }, { source: 'payment-hub' }).catch(() => undefined);
  }

  private latest(ownerEntityId: string, reference: string, kind: HubPayment['kind']): HubPayment | undefined {
    let found: HubPayment | undefined;
    for (const p of this.payments.values()) if (p.ownerEntityId === ownerEntityId && p.reference === reference && p.kind === kind && (!found || p.askedAt >= found.askedAt)) found = p;
    return found;
  }

  private waitingSet(): Set<string> {
    if (!this.waiting) this.waiting = new Set([...this.payments.values()].filter((p) => p.state === 'asked').map((p) => p.paymentId));
    return this.waiting;
  }

  private provider(id: HubProviderId): HubProvider {
    const p = this.providers.get(id);
    if (!p) throw new GlosError('INVALID_STATE', `${id} is not ready in the payment hub yet`);
    return p;
  }
}

export function viewOf(p: HubPayment): HubPaymentView {
  const why = (HUB_WHY as readonly string[]).includes(p.why ?? '') ? (p.why as HubWhy) : undefined;
  return {
    paymentId: p.paymentId,
    kind: p.kind,
    reference: p.reference,
    amount: p.amount,
    currency: p.currency,
    phoneEnds: p.phoneEnds,
    state: p.state,
    ...(why ? { why } : {}),
    test: p.test,
    askedAt: p.askedAt,
    ...(p.settledAt ? { settledAt: p.settledAt } : {}),
    ...(p.askedBy ? { askedBy: p.askedBy } : {}),
    ...(p.usedFor ? { usedFor: p.usedFor } : {}),
    ...(p.fee ? { fee: p.fee.amount } : {}),
    ...(p.refundOf ? { refundOf: p.refundOf } : {}),
  };
}
