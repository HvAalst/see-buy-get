import { randomBytes } from 'crypto';
import { PersistentMap } from '../store/persistent-map';
import type { CollectRequest, HubProvider, OpenedAccount, PayoutRequest, ProviderAnswer } from './hub.types';

/** How long the stand-in takes to answer a payment prompt: long enough for a counter's screen to show it waiting. */
export const STAND_IN_ANSWERS_AFTER_MS = 4_000;
/** A prompt nobody answers lapses after this, as one on a real phone does. */
export const STAND_IN_LAPSES_AFTER_MS = 2 * 60_000;

/** How the stand-in answers, by the last four digits of the payer's number — so a test, or the owner trying it, can choose. */
export const STAND_IN_DECLINES = '0000';
export const STAND_IN_NEVER_ANSWERS = '9999';

interface StandInRequest {
  ref: string;
  accountId: string;
  kind: 'in' | 'out' | 'refund';
  amount: number;
  currency: string;
  /** The last four digits of the phone: all the stand-in reads of it. */
  ends: string;
  at: number;
  /** A refund: the payment it gives back. */
  paidRef?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const lastFour = (phone: string): string => phone.replace(/\D/g, '').slice(-4);

/**
 * THE STAND-IN PROVIDER (the payments plan, step 4: "built and tried first against a stand-in provider, so the whole loop runs
 * in the test setup with no partner and no real money"). No network and no money: it answers as a provider would, and keeps
 * what an account holds as a provider does, so every screen and every rule is tried before a partner and its provider exist.
 *
 * A payment prompt is answered after a few seconds: paid — or declined, where the number ends in 0000; or never answered, and
 * lapsed after two minutes, where it ends in 9999. A payout or a refund goes at once, while the account holds enough.
 */
export class StandInProvider implements HubProvider {
  readonly id = 'stand-in' as const;
  private readonly requests = new PersistentMap<string, StandInRequest>('payment-hub-stand-in');

  async collect(account: OpenedAccount, req: CollectRequest, now: number = Date.now()): Promise<ProviderAnswer> {
    const r: StandInRequest = { ref: `si_${randomBytes(9).toString('base64url')}`, accountId: account.accountId, kind: 'in', amount: round2(req.amount), currency: req.currency, ends: lastFour(req.payerPhone), at: now };
    this.requests.set(r.ref, r);
    return this.answer(r, now);
  }

  async status(account: OpenedAccount, ref: { providerRef?: string; ourRef: string }, now: number = Date.now()): Promise<ProviderAnswer> {
    const r = ref.providerRef ? this.requests.get(ref.providerRef) : undefined;
    // Another account's request reads as one this account never made, as a provider answers.
    if (!r || r.accountId !== account.accountId) return { state: 'failed', why: 'unknown' };
    return this.answer(r, now);
  }

  async payout(account: OpenedAccount, req: PayoutRequest, now: number = Date.now()): Promise<ProviderAnswer> {
    if (this.held(account.accountId, now) < round2(req.amount) - 1e-9) return { state: 'failed', why: 'insufficient' };
    const r: StandInRequest = { ref: `si_${randomBytes(9).toString('base64url')}`, accountId: account.accountId, kind: 'out', amount: round2(req.amount), currency: req.currency, ends: lastFour(req.payeePhone), at: now };
    this.requests.set(r.ref, r);
    return { state: 'paid', providerRef: r.ref };
  }

  async refund(account: OpenedAccount, req: PayoutRequest & { paidRef: string }, now: number = Date.now()): Promise<ProviderAnswer> {
    const paid = this.requests.get(req.paidRef);
    if (!paid || paid.accountId !== account.accountId || paid.kind !== 'in' || this.answer(paid, now).state !== 'paid') return { state: 'failed', why: 'unknown' };
    const back = [...this.requests.values()].filter((x) => x.kind === 'refund' && x.paidRef === req.paidRef).reduce((s, x) => s + x.amount, 0);
    // Never more back than came in, and never from money the account no longer holds.
    if (round2(back + req.amount) > paid.amount + 1e-9) return { state: 'failed', why: 'more_than_paid' };
    if (this.held(account.accountId, now) < round2(req.amount) - 1e-9) return { state: 'failed', why: 'insufficient' };
    const r: StandInRequest = { ref: `si_${randomBytes(9).toString('base64url')}`, accountId: account.accountId, kind: 'refund', amount: round2(req.amount), currency: req.currency, ends: paid.ends, at: now, paidRef: req.paidRef };
    this.requests.set(r.ref, r);
    return { state: 'paid', providerRef: r.ref };
  }

  async balance(account: OpenedAccount, now: number = Date.now()): Promise<{ amount: number; currency: string }> {
    return { amount: this.held(account.accountId, now), currency: account.currency };
  }

  private answer(r: StandInRequest, now: number): ProviderAnswer {
    if (r.kind !== 'in') return { state: 'paid', providerRef: r.ref };
    const waited = now - r.at;
    if (r.ends === STAND_IN_NEVER_ANSWERS) return waited >= STAND_IN_LAPSES_AFTER_MS ? { state: 'failed', providerRef: r.ref, why: 'expired' } : { state: 'asked', providerRef: r.ref };
    if (waited < STAND_IN_ANSWERS_AFTER_MS) return { state: 'asked', providerRef: r.ref };
    return r.ends === STAND_IN_DECLINES ? { state: 'failed', providerRef: r.ref, why: 'declined' } : { state: 'paid', providerRef: r.ref };
  }

  /** What the account holds: every prompt paid, less every payout and refund. */
  private held(accountId: string, now: number): number {
    let sum = 0;
    for (const r of this.requests.values()) {
      if (r.accountId !== accountId) continue;
      if (r.kind === 'in') sum += this.answer(r, now).state === 'paid' ? r.amount : 0;
      else sum -= r.amount;
    }
    return round2(sum);
  }
}
