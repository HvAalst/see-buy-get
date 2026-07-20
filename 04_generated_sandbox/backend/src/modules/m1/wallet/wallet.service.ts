import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../../foundation/events/event-bus.service';
import { GlosEvent } from '../../../foundation/events/glos-events';
import { BankLinkChallenge, CurrencyCode, PayoutRecord, SettlementTrigger, Wallet, WalletSummary } from './wallet.types';
import { validateSettlementTrigger } from './settlement-trigger';

const CURRENCY_BY_JURISDICTION: Record<string, CurrencyCode> = {
  NL: 'EUR', DE: 'EUR', FR: 'EUR', BE: 'EUR', ES: 'EUR', IT: 'EUR', IE: 'EUR', PT: 'EUR', AT: 'EUR',
  GB: 'GBP', US: 'USD', SG: 'SGD', CN: 'CNY',
};

function currencyFor(jurisdiction?: string): CurrencyCode {
  return (jurisdiction && CURRENCY_BY_JURISDICTION[jurisdiction.toUpperCase()]) || 'USD';
}

/**
 * WalletService — embedded multi-currency wallet (UDIW-040/043/044).
 * Auto-provisioned for a verified DID, holds balances, carries a configurable settlement
 * trigger, and executes instant payouts. Emits `wallet.provisioned` / `wallet.payout_completed`.
 */
@Injectable()
export class WalletService {
  private readonly wallets = new Map<string, Wallet>();
  private readonly bankChallenges = new Map<string, { did: string; amounts: [number, number] }>();

  constructor(private readonly events: EventBus) {}

  /** Idempotent: provision a wallet for a verified DID (UDIW-040). */
  provision(did: string, options: { jurisdiction?: string; corporate?: boolean } = {}): Wallet {
    const existing = this.wallets.get(did);
    if (existing) return existing;

    const wallet: Wallet = {
      walletId: `wal_${randomBytes(12).toString('hex')}`,
      did,
      balances: {},
      settlementCurrency: currencyFor(options.jurisdiction),
      settlementTrigger: { type: 'instant' },
      corporate: Boolean(options.corporate),
      bankLinked: false,
      createdAt: new Date().toISOString(),
    };
    this.wallets.set(did, wallet);
    void this.events
      .publish(GlosEvent.Wallet.Provisioned, { did, walletId: wallet.walletId, currency: wallet.settlementCurrency }, { source: 'm1' })
      .catch(() => undefined);
    return wallet;
  }

  get(did: string): Wallet | undefined {
    return this.wallets.get(did);
  }

  require(did: string): Wallet {
    const wallet = this.wallets.get(did);
    if (!wallet) throw new NotFoundException(`No wallet for ${did}. Verify identity first.`);
    return wallet;
  }

  setCorporate(did: string, corporate: boolean): void {
    this.require(did).corporate = corporate;
  }

  /** UDIW-043: configure how settlement releases for this wallet. */
  setSettlementTrigger(did: string, trigger: SettlementTrigger): Wallet {
    const wallet = this.require(did);
    wallet.settlementTrigger = validateSettlementTrigger(trigger);
    return wallet;
  }

  balanceOf(did: string, currency?: CurrencyCode): number {
    const wallet = this.require(did);
    return wallet.balances[currency ?? wallet.settlementCurrency] ?? 0;
  }

  /** Credit funds (e.g. completed-task earnings, settlement release). */
  credit(did: string, amount: number, currency?: CurrencyCode): Wallet {
    if (amount <= 0) throw new BadRequestException('Credit amount must be positive');
    const wallet = this.require(did);
    const ccy = currency ?? wallet.settlementCurrency;
    wallet.balances[ccy] = (wallet.balances[ccy] ?? 0) + amount;
    return wallet;
  }

  /** Debit funds (internal transfer, e.g. funding an escrow). Throws on insufficient balance. */
  debit(did: string, amount: number, currency?: CurrencyCode): Wallet {
    if (amount <= 0) throw new BadRequestException('Debit amount must be positive');
    const wallet = this.require(did);
    const ccy = currency ?? wallet.settlementCurrency;
    if ((wallet.balances[ccy] ?? 0) < amount) throw new BadRequestException('Insufficient balance');
    wallet.balances[ccy] -= amount;
    return wallet;
  }

  /** UDIW-044: instant payout to an external rail. Debits the wallet, emits the event. */
  payout(did: string, input: { amount: number; currency?: CurrencyCode; destination?: string }): PayoutRecord {
    const wallet = this.require(did);
    const currency = input.currency ?? wallet.settlementCurrency;
    if (input.amount <= 0) throw new BadRequestException('Payout amount must be positive');
    if ((wallet.balances[currency] ?? 0) < input.amount) {
      throw new BadRequestException('Insufficient balance');
    }
    wallet.balances[currency] -= input.amount;

    const record: PayoutRecord = {
      payoutId: `pay_${randomBytes(12).toString('hex')}`,
      did,
      amount: input.amount,
      currency,
      destination: input.destination ?? 'linked-account',
      status: 'completed',
      at: new Date().toISOString(),
    };
    void this.events
      .publish(GlosEvent.Wallet.PayoutCompleted, record, { source: 'm1' })
      .catch(() => undefined);
    return record;
  }

  /** UDIW micro-deposit bank linking — start: deposit two amounts the user will confirm. */
  startBankLink(did: string): BankLinkChallenge {
    this.require(did);
    const cents = () => Math.floor(parseInt(randomBytes(1).toString('hex'), 16) / 256 * 98 + 1) / 100; // 0.01–0.99
    const amounts: [number, number] = [cents(), cents()];
    const challengeId = `bl_${randomBytes(10).toString('hex')}`;
    this.bankChallenges.set(challengeId, { did, amounts });
    return { challengeId, amounts };
  }

  verifyBankLink(did: string, challengeId: string, amount1: number, amount2: number): { linked: boolean } {
    const challenge = this.bankChallenges.get(challengeId);
    if (!challenge || challenge.did !== did) throw new BadRequestException('Invalid bank-link challenge');
    if (challenge.amounts[0] !== amount1 || challenge.amounts[1] !== amount2) {
      throw new BadRequestException('Amounts do not match');
    }
    this.bankChallenges.delete(challengeId);
    this.require(did).bankLinked = true;
    return { linked: true };
  }

  summary(did: string): WalletSummary {
    const w = this.require(did);
    return {
      walletId: w.walletId,
      did: w.did,
      balances: w.balances,
      settlementCurrency: w.settlementCurrency,
      settlementTrigger: w.settlementTrigger,
      corporate: w.corporate,
      bankLinked: w.bankLinked,
    };
  }
}
