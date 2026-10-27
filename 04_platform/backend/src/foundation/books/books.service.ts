import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { EntityService } from '../entity/entity.service';
import { Account, ACCOUNT_CODES, ACCOUNT_KIND, AccountCode, EntryLine, JournalEntry } from './books.types';

/**
 * The ledger stores integers — minor units, cents rather than shillings — so its arithmetic is exact and
 * an entry balances or it does not. There is no tolerance and no epsilon: those exist only to paper over
 * float drift, and a fraction of a cent lost per posting becomes, across a network, a number nobody can
 * explain and "floating point" does not answer for.
 *
 * Callers still speak in major units, so the boundary converts, once, here.
 */
const toMinor = (major: number): number => Math.round(major * 100);
/** Back to major units for the outside world. `|| 0` normalises −0, a different value to Object.is. */
const toMajor = (minor: number): number => minor / 100 || 0;

export interface PostInput {
  entityId: string;
  currency?: string; // defaults to the entity's settlement currency
  kind: string;
  ref?: string;
  memo?: string;
  lines: Array<{ code: AccountCode; counterparty?: string; amount: number }>;
}

/**
 * BooksService — the sisters' ledgers.
 *
 * Two rules, and everything else follows from them:
 *
 *  1. An entry must BALANCE. Lines that do not sum to zero are refused, so value cannot be conjured or
 *     destroyed by a caller who forgot the other side. This is the whole difference from what came before.
 *  2. Only a sister keeps books. The group holds no custody and is not a party to transactions, so it has
 *     no cash account to post to — asking for one is an error, not an empty balance.
 */
@Injectable()
export class BooksService {
  // Durable: these are the books. Losing them on restart would be losing the money.
  private readonly accounts = new PersistentMap<string, Account>('books-accounts');
  private readonly entries = new PersistentMap<string, JournalEntry>('books-entries');
  private readonly listeners = new Set<(entry: JournalEntry) => void>();

  constructor(private readonly entities: EntityService) {}

  /**
   * Told of every entry once it is written — what a tax invoice is made from, so no path that charges can forget one.
   * A listener cannot undo or refuse the entry: the money moved, and what it throws is logged, never passed up.
   */
  onPosted(listener: (entry: JournalEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One account, by its id — what an entry's line points at. */
  accountById(accountId: string): Account | undefined {
    return this.accounts.get(accountId);
  }

  /** The id an account is filed under: entity, code, currency, and the counterparty where one applies. */
  accountIdFor(entityId: string, code: AccountCode, currency: string, counterparty?: string): string {
    return [entityId, code, currency, counterparty].filter(Boolean).join(':');
  }

  /**
   * Fetch or open an account. Opening is lazy because a chart of accounts with a row per agent is not
   * something to enumerate up front — the first posting that needs it brings it into being.
   */
  account(entityId: string, code: AccountCode, currency?: string, counterparty?: string): Account {
    const entity = this.entities.get(entityId);
    if (entity.kind !== 'sister') {
      throw new GlosError('FORBIDDEN', `${entity.name} keeps no books: a holding company holds no custody and is not a party to transactions`);
    }
    const ccy = currency ?? entity.currency;
    if (!ccy) throw new GlosError('INTERNAL', `${entity.name} has no settlement currency`);
    const accountId = this.accountIdFor(entityId, code, ccy, counterparty);
    const existing = this.accounts.get(accountId);
    if (existing) return existing;
    const account: Account = { accountId, entityId, code, kind: ACCOUNT_KIND[code], currency: ccy, counterparty, createdAt: new Date().toISOString() };
    this.accounts.set(accountId, account);
    return account;
  }

  /**
   * Record a movement. Every line is resolved to an account of the SAME entity and currency, the lines are
   * checked to sum to zero, and only then is anything written — a refused entry leaves no trace of itself,
   * so a half-posted movement is not a state the books can be in.
   */
  post(input: PostInput): JournalEntry {
    const entity = this.entities.requireTransacting(input.entityId);
    const currency = input.currency ?? entity.currency;
    if (!currency) throw new GlosError('INTERNAL', `${entity.name} has no settlement currency`);
    if (!input.lines?.length) throw new GlosError('INVALID_INPUT', 'An entry needs lines');

    const lines: EntryLine[] = input.lines.map((l) => {
      if (!Number.isFinite(l.amount)) throw new GlosError('INVALID_INPUT', `Line amount for ${l.code} is not a number`);
      return { accountId: this.account(entity.entityId, l.code, currency, l.counterparty).accountId, amount: toMinor(l.amount) };
    });

    // Integers, so this is exact. An entry whose lines round to a non-zero sum is refused rather than
    // absorbed — if a caller's arithmetic cannot make its own sides meet, the books must not pretend.
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    if (sum !== 0) {
      throw new GlosError('INVALID_INPUT', `Entry does not balance: the lines sum to ${toMajor(sum)}, not 0`);
    }

    const entry: JournalEntry = {
      entryId: `je_${randomBytes(8).toString('hex')}`,
      entityId: entity.entityId,
      currency,
      kind: input.kind,
      ref: input.ref,
      memo: input.memo,
      lines,
      at: new Date().toISOString(),
    };
    this.entries.set(entry.entryId, entry);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
        new Logger(BooksService.name).error(`A listener failed on entry ${entry.entryId} (${entry.kind}): ${(err as Error).message}`);
      }
    }
    return entry;
  }

  /** One entry, by its id. */
  entry(entryId: string): JournalEntry | undefined {
    return this.entries.get(entryId);
  }

  /** Every entry, newest first — optionally scoped to one entity, or to one domain reference. */
  journal(filter?: { entityId?: string; ref?: string }): JournalEntry[] {
    return [...this.entries.values()]
      .filter((e) => (!filter?.entityId || e.entityId === filter.entityId) && (!filter?.ref || e.ref === filter.ref))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** The balance of one account in MINOR units, summed from its lines — exact, integer arithmetic. */
  balanceMinorOf(accountId: string): number {
    let sum = 0;
    for (const entry of this.entries.values()) {
      for (const line of entry.lines) if (line.accountId === accountId) sum += line.amount;
    }
    return sum;
  }

  /** The balance of one account — the postings are the truth, not a cached figure. */
  balanceOf(accountId: string): number {
    return toMajor(this.balanceMinorOf(accountId));
  }

  balance(entityId: string, code: AccountCode, currency?: string, counterparty?: string): number {
    const entity = this.entities.get(entityId);
    return this.balanceOf(this.accountIdFor(entityId, code, currency ?? entity.currency ?? '', counterparty));
  }

  /**
   * How an award of `amount` splits between what was provisioned for it and what it actually costs.
   *
   * A provision is a POOL, not a per-parcel envelope: the cost-of-risk layer is collected on every
   * shipment precisely because nobody knows which one will break. So this reads the pool's balance and
   * takes what is there, and the remainder is an expense the sister carries.
   *
   * The remainder is the number that matters. With every cost-of-risk knob at zero the pool is empty
   * and every award lands wholly in `EXPENSE_CLAIMS` — which is exactly the reading somebody needs
   * before setting that knob to anything other than a guess. Draining the pool into a negative balance
   * instead would hide the same fact inside a liability that had quietly become an asset.
   */
  provisionSplit(entityId: string, amount: number): { fromProvision: number; fromExpense: number } {
    const want = Math.max(0, Math.round((Number.isFinite(amount) ? amount : 0) * 100) / 100);
    // Liabilities are negative by convention, so a funded provision reads negative; flip it to read
    // "how much is set aside", and never let a pool that somehow went positive lend anything.
    const available = Math.max(0, -this.balance(entityId, ACCOUNT_CODES.PROVISION_CLAIMS));
    const fromProvision = Math.min(want, available);
    return { fromProvision, fromExpense: Math.round((want - fromProvision) * 100) / 100 };
  }

  /** Every account a sister holds, with its balance — the trial balance, in the ordinary sense. */
  trialBalance(entityId: string): Array<Account & { balance: number }> {
    return [...this.accounts.values()]
      .filter((a) => a.entityId === entityId)
      .map((a) => ({ ...a, balance: this.balanceOf(a.accountId) }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId));
  }

  /**
   * The books' own consistency check: every entry balanced, so the sum across ALL accounts is zero.
   *
   * This is the weaker, internal half of the reconciliation invariant from the design note. The strong
   * half — that cash.custody equals what is actually in the bank — cannot be asserted until a real
   * account exists to compare against, and is precisely what the payment rail will make checkable.
   */
  balances(entityId: string): { balanced: boolean; drift: number } {
    // Summed in minor units, so "balanced" is an exact statement rather than one within a tolerance.
    const drift = [...this.accounts.values()].filter((a) => a.entityId === entityId).reduce((s, a) => s + this.balanceMinorOf(a.accountId), 0);
    return { balanced: drift === 0, drift: toMajor(drift) };
  }

  /**
   * What the sister holds against what it owes — the coverage question from the design note.
   *
   *  held  real money in custody: bank, mobile-money merchant account, cash in transit.
   *  lent  trade credit drawn by shops. An ASSET the sister expects back, but not money it has: it is
   *        out there in twenty-parcel slices across the whole network, which is precisely the exposure
   *        worth watching once every approved shop has a standing line.
   *  owed  deposits and payables — other people's money, held as negatives, reported positive to read.
   *  cover held − owed. Deliberately EXCLUDES what is lent: cover asks whether the sister could meet its
   *        obligations today, and credit out with a shopkeeper cannot pay a driver this afternoon.
   */
  coverage(entityId: string, currency?: string): { currency: string; held: number; lent: number; owed: number; cover: number } {
    const entity = this.entities.get(entityId);
    const ccy = currency ?? entity.currency ?? '';
    // An awarded claim is owed the same way a shop's float is: somebody is waiting for that money.
    // The PROVISION is deliberately NOT here — it is money set aside against claims nobody has made
    // yet, so counting it as owed would say the sister is short of cash it has not been asked for.
    const OWED: AccountCode[] = [
      ACCOUNT_CODES.DEPOSIT_AGENT,
      ACCOUNT_CODES.DEPOSIT_VENDOR,
      ACCOUNT_CODES.PAYABLE_PROVIDER,
      ACCOUNT_CODES.PAYABLE_TAX,
      ACCOUNT_CODES.PAYABLE_CLAIM,
      ACCOUNT_CODES.PAYABLE_GROUP,
      // A person's prepayment for one load, and what it did not use: theirs, waiting (2026-10-27).
      ACCOUNT_CODES.DEPOSIT_PERSON,
      ACCOUNT_CODES.PAYABLE_PERSON,
    ];
    const mine = [...this.accounts.values()].filter((a) => a.entityId === entityId && a.currency === ccy);
    const sumMinor = (pick: (code: AccountCode) => boolean) => mine.filter((a) => pick(a.code)).reduce((s, a) => s + this.balanceMinorOf(a.accountId), 0);
    const heldMinor = sumMinor((c) => c === ACCOUNT_CODES.CASH_CUSTODY);
    // Liabilities are negative by convention; report what is OWED as a positive number a human can read.
    const owedMinor = -sumMinor((c) => OWED.includes(c));
    return {
      currency: ccy,
      held: toMajor(heldMinor),
      lent: toMajor(sumMinor((c) => c === ACCOUNT_CODES.RECEIVABLE_AGENT)),
      owed: toMajor(owedMinor),
      cover: toMajor(heldMinor - owedMinor),
    };
  }

  /**
   * Who is owed on one account code, and how much — the list a settlement run works from.
   *
   * Reported POSITIVE for a liability, flipped here at the presentation edge exactly as `coverage` does,
   * because "owed 40" is the sentence a human says and the sign convention is an internal matter.
   *
   * A zero balance is left out. An account opened and then settled back to nothing is not somebody
   * waiting for money, and including it would have every run raise a payout for everybody the network has
   * ever paid.
   */
  outstanding(entityId: string, code: AccountCode, currency?: string): { counterparty: string; amount: number }[] {
    const entity = this.entities.get(entityId);
    const ccy = currency ?? entity.currency ?? '';
    return [...this.accounts.values()]
      .filter((a) => a.entityId === entityId && a.code === code && a.currency === ccy && a.counterparty)
      .map((a) => ({ counterparty: a.counterparty!, amount: toMajor(-this.balanceMinorOf(a.accountId)) }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.counterparty.localeCompare(b.counterparty));
  }

  /**
   * Wipe the books. Sandbox only: the cutover resets rather than migrating notional balances, so a demo
   * never shows a figure that has no postings behind it.
   */
  reset(): void {
    this.entries.clear();
    this.accounts.clear();
  }
}
