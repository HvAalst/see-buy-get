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
import { HUB_PROVIDERS, HUB_WHY, type HubPayment, type HubPaymentView, type HubProvider, type HubProviderId, type HubWhy, type OpenedAccount, type PaymentAccountView, type ProviderAnswer } from './hub.types';

/** Further providers, each an adapter (a test's own, or a real one once it is built for a chosen partner). */
export const PAYMENT_HUB_PROVIDERS = 'PAYMENT_HUB_PROVIDERS';
/** A prompt still waiting after this is asked of its provider no more: it lapsed. A real provider's own lapse is shorter. */
export const PROMPT_LAPSES_AFTER_MS = 15 * 60_000;
/** How often the prompts still waiting are asked of their provider. */
const LOOK_EVERY_MS = 5_000;

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
  /** The prompts still waiting: what the sweep asks about. Built from the kept payments when it first runs. */
  private waiting?: Set<string>;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

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
    return { provider: a.provider, test: !a.live, currency: a.currency, ready: this.ready(), ...(held ? { balance: held.amount } : {}) };
  }

  /**
   * MONEY ASKED OF A PAYER'S PHONE, into the company's account: a payment prompt on the phone, kept as asked until the provider
   * says paid or failed. Kept BEFORE the provider is asked, so no prompt is ever out that we hold no record of. A reference
   * already paid is refused; one whose prompt is still waiting gives that same prompt for the same phone and amount — a second
   * press at a counter asks nobody twice — and is refused for another, so one thing is never paid twice from two phones.
   */
  async collect(ownerEntityId: string, req: { reference: string; amount: number; payerPhone: string; description: string; askedBy?: string }, now: number = Date.now()): Promise<HubPayment> {
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
    if (now - Date.parse(p.askedAt) > PROMPT_LAPSES_AFTER_MS) return this.apply(paymentId, { state: 'failed', why: 'expired' }, now);
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
    } finally {
      this.running = false;
    }
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
    };
    this.payments.set(paymentId, next);
    if (next.state !== 'asked') {
      this.waitingSet().delete(paymentId);
      this.told(next);
    }
    return next;
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
  };
}
