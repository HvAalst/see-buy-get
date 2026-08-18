/**
 * Double-entry books — the structure the money model has been missing.
 *
 * Until now every movement had ONE side: payLabour credited an agent with money that came from nowhere,
 * chargeShipping debited one that went nowhere, and the 2% was a multiplication nobody received. Value
 * could be created and destroyed per call, and nothing could be checked, because there was nothing for a
 * balance to be checked against.
 *
 * Here, a movement is an ENTRY of two or more LINES that must sum to zero. That single rule is what makes
 * the books answerable: every shilling that leaves one account arrives in another, so the trial balance is
 * a fact rather than a hope, and "where did this come from" always has an answer.
 */

/**
 * Account kinds, in the ordinary accounting sense.
 *
 * ONE sign convention throughout, and it is worth stating plainly because half the bugs in hand-rolled
 * ledgers come from two of them: **a debit is positive, a credit is negative, and an entry sums to zero.**
 *
 * So an asset or expense going up is a positive line, and a liability or revenue going up is a negative
 * one. Read a balance the same way: `cash.custody` reads positive for money held, `deposit.agent` reads
 * negative for money owed to a shop. Anywhere a human sees those figures, the sign is flipped at the
 * presentation edge (see BooksService.coverage), never in the books.
 */
export type AccountKind = 'asset' | 'liability' | 'revenue' | 'expense' | 'equity';

/**
 * The chart of accounts. Deliberately small and named for what the money IS, not for where it sits in a
 * report — a shopkeeper's deposit and a driver's fee are different obligations and must never share a row.
 */
export const ACCOUNT_CODES = {
  /** Real money the sister holds: bank, mobile-money merchant account, cash in transit. */
  CASH_CUSTODY: 'cash.custody',
  /** A shop's prepaid balance. A DEPOSIT — money we hold, not money we have earned. Per agent. */
  DEPOSIT_AGENT: 'deposit.agent',
  /** A store's prepaid balance. Same nature as an agent's deposit. Per vendor. */
  DEPOSIT_VENDOR: 'deposit.vendor',
  /** Owed to a provider for work performed — a fleet's haul, a courier's leg, a hub's sort. */
  PAYABLE_PROVIDER: 'payable.provider',
  /** What that work COST the sister. The other side of a provider fee, whether it is paid out or
   *  credited to the shop's float. Without it, paying a fee would conjure the money it pays with. */
  EXPENSE_PROVIDER_FEES: 'expense.provider_fees',
  /** Credit extended to a shop that has not funded it — an operator overdraft. They owe it back. */
  RECEIVABLE_AGENT: 'receivable.agent',
  /** Tax collected on behalf of an authority. Never revenue, not for a moment. */
  PAYABLE_TAX: 'payable.tax',
  /** The mother's periodic licence fee, owed by a sister. */
  PAYABLE_GROUP: 'payable.group',
  /** Bilateral running balance with another sister; the counterparty entity is on the account. */
  INTERCOMPANY: 'intercompany',
  /** What the sister has actually earned: its margin, and the legs it performed itself. */
  REVENUE: 'revenue',
  /** What a payment provider took to move the money. The first thing that breaks reconciliation if unmodelled. */
  EXPENSE_PAYMENT_FEES: 'expense.payment_fees',
  /** Difference between the rate at posting and the rate at settlement. */
  FX_GAINLOSS: 'fx.gainloss',
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

/** Which side each code is natural on — the one place the sign convention is written down. */
export const ACCOUNT_KIND: Record<AccountCode, AccountKind> = {
  [ACCOUNT_CODES.CASH_CUSTODY]: 'asset',
  [ACCOUNT_CODES.DEPOSIT_AGENT]: 'liability',
  [ACCOUNT_CODES.DEPOSIT_VENDOR]: 'liability',
  [ACCOUNT_CODES.PAYABLE_PROVIDER]: 'liability',
  [ACCOUNT_CODES.EXPENSE_PROVIDER_FEES]: 'expense',
  [ACCOUNT_CODES.RECEIVABLE_AGENT]: 'asset',
  [ACCOUNT_CODES.PAYABLE_TAX]: 'liability',
  [ACCOUNT_CODES.PAYABLE_GROUP]: 'liability',
  [ACCOUNT_CODES.INTERCOMPANY]: 'asset', // a receivable when positive, a payable when negative
  [ACCOUNT_CODES.REVENUE]: 'revenue',
  [ACCOUNT_CODES.EXPENSE_PAYMENT_FEES]: 'expense',
  [ACCOUNT_CODES.FX_GAINLOSS]: 'revenue',
};

/**
 * An account belongs to exactly ONE entity — there is no global money. Payables, deposits and
 * intercompany balances are further keyed by the counterparty they concern, so "what we owe this shop"
 * is a real balance rather than a filter over a shared pile.
 */
export class Account {
  accountId: string; // `${entityId}:${code}:${currency}` (+ `:${counterparty}` where one applies)
  entityId: string;
  code: AccountCode;
  kind: AccountKind;
  currency: string;
  /** The agent / vendor / provider / sister this balance is with. Absent on the pooled accounts. */
  counterparty?: string;
  createdAt: string;
}

/** One side of a movement: an account and a signed amount, in that account's own currency. */
export interface EntryLine {
  accountId: string;
  amount: number; // debit positive, credit negative; an entry's lines sum to zero
}

/**
 * A journal entry: what happened, when, and the lines that must balance.
 *
 * ONE entity and ONE currency per entry, deliberately. A movement between two sisters is not one entry —
 * it is two, in two sets of books, linked by `ref`. That keeps each sister's book internally complete
 * (it can be read, audited and reconciled alone) and makes the intercompany pair explicit rather than an
 * artefact of a clever cross-book entry.
 */
export class JournalEntry {
  entryId: string;
  entityId: string;
  currency: string;
  /** What kind of movement this is — 'top-up', 'shipping', 'labour', 'billing', 'psp-fee'… */
  kind: string;
  /** The domain thing it concerns: a parcel id, a manifest id, a settlement reference. */
  ref?: string;
  /** Free-text for a human reading the book. Never PII. */
  memo?: string;
  lines: EntryLine[];
  at: string;
}
