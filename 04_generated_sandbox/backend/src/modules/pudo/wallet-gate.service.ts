import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { WalletService } from '../m1/wallet/wallet.service';
import { AgentService } from './agent.service';
import { LOCK_THRESHOLD, NETWORK_CURRENCY, TRADE_CREDIT_LIMIT, TRADE_CREDIT_PARCELS } from './pudo.config';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES, type AccountCode } from '../../foundation/books/books.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { FxService } from '../../foundation/money/fx.service';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { LedgerType, PudoLedgerEntry } from './pudo.types';
import { paginate, textMatch, toCsv, withinDates, type Page } from './query';

/* ------------------- agent earnings-ledger register (R4) — the mirror of the vendor ledger (R3) ------- */

/** The shop's word for a ledger entry: it earns handling pay + shipping fees, tops up its float, and takes
 *  refunds / emergency credit. */
export function agentLedgerTypeWord(type: LedgerType): string {
  switch (type) {
    case 'TOP_UP':
      return 'Top-up';
    case 'FEE':
      return 'Shipping fee';
    case 'LABOR_PAYOUT':
      return 'Handling pay';
    case 'REFUND':
      return 'Refund';
    default:
      // Includes historical 'OVERDRAFT' rows, which render as their raw type — the concept is gone.
      return type;
  }
}

export interface AgentLedgerQuery {
  q?: string; // reference (parcel id / bank ref) or the type word
  type?: LedgerType;
  direction?: 'in' | 'out'; // in = received (sign '+'), out = spent (sign '-')
  from?: string; // ISO or YYYY-MM-DD (inclusive)
  to?: string;
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  limit?: number | string;
  offset?: number | string;
}

export interface AgentLedgerRow {
  id: string;
  type: LedgerType;
  sign: '+' | '-';
  amount: number;
  currency: string;
  reference: string;
  refType: PudoLedgerEntry['refType'];
  at: string;
}

/**
 * The currency of a ledger row. Rows written before the field existed carry none, so they are read as
 * the network currency — which is what they were, they simply never said so.
 */
export function agentLedgerCurrencyOf(e: PudoLedgerEntry): string {
  return e.currency ?? NETWORK_CURRENCY;
}

export function agentLedgerRowOf(e: PudoLedgerEntry): AgentLedgerRow {
  return { id: e.id, type: e.type, sign: e.sign, amount: e.amount, currency: agentLedgerCurrencyOf(e), reference: e.reference, refType: e.refType, at: e.at };
}

export interface AgentLedgerSummary {
  in: number;
  out: number;
  net: number;
  count: number;
  /** What the three totals above are denominated in — a total without one is not a figure, it is a rumour. */
  currency: string;
}

export function agentLedgerSummaryOf(rows: PudoLedgerEntry[]): AgentLedgerSummary {
  let inSum = 0;
  let outSum = 0;
  for (const e of rows) {
    if (e.sign === '+') inSum += e.amount;
    else outSum += e.amount;
  }
  inSum = Math.round(inSum * 100) / 100;
  outSum = Math.round(outSum * 100) / 100;
  // Single-currency by construction today (one network, one currency). When sisters own their own
  // accounts this must become the entity's currency, and a mixed set must refuse to total at all.
  return { in: inSum, out: outSum, net: Math.round((inSum - outSum) * 100) / 100, count: rows.length, currency: NETWORK_CURRENCY };
}

function agentLedgerSort(sort?: AgentLedgerQuery['sort']): (a: PudoLedgerEntry, b: PudoLedgerEntry) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.at.localeCompare(b.at);
    case 'amount_desc':
      return (a, b) => b.amount - a.amount;
    case 'amount_asc':
      return (a, b) => a.amount - b.amount;
    default:
      return (a, b) => b.at.localeCompare(a.at); // newest first
  }
}

/** Filter + search + sort a shop's ledger for the earnings register (PURE — the owner scope + entries({did})
 *  that restrict to THIS shop are the caller's). */
export function filterAgentLedger(rows: PudoLedgerEntry[], q: AgentLedgerQuery): PudoLedgerEntry[] {
  let out = rows;
  if (q.type) out = out.filter((e) => e.type === q.type);
  if (q.direction) out = out.filter((e) => (q.direction === 'in' ? e.sign === '+' : e.sign === '-'));
  if (q.from || q.to) out = out.filter((e) => withinDates(e.at, q.from, q.to));
  if (q.q) out = out.filter((e) => textMatch([e.reference, agentLedgerTypeWord(e.type)], q.q));
  return [...out].sort(agentLedgerSort(q.sort));
}

/** Render matched entries as the shop's earnings CSV. Amount is a SIGNED number (out negative). */
export function agentLedgerToCsv(rows: PudoLedgerEntry[]): string {
  return toCsv(
    ['Date', 'Type', 'Direction', 'Amount', 'Currency', 'Reference'],
    rows.map((e) => [e.at, agentLedgerTypeWord(e.type), e.sign === '+' ? 'in' : 'out', e.sign === '+' ? e.amount : -e.amount, agentLedgerCurrencyOf(e), e.reference]),
  );
}

/**
 * WalletGateService (P-003, Light SSE ↔ GLOS SSE). The pre-paid wallet that enforces 'no money, no
 * scan'. It reuses the M1 wallet for the balance and layers the PUDO ledger (typed entries) on top.
 * Every movement is a single wallet op + a ledger row; status is refreshed so the agent auto-locks
 * the instant the balance drops below the threshold — the smallest implementation of NFR-SSE-01
 * ('no lost or double-spent funds') at this scale.
 */
@Injectable()
export class WalletGateService {
  // Durable: the typed money ledger (top-ups, fees, payouts, refunds). Keyed by entry id; a Map
  // preserves insertion order, so entries() stays chronological (then reversed for newest-first).
  private readonly ledger = new PersistentMap<string, PudoLedgerEntry>('pudo-ledger');

  constructor(
    private readonly wallet: WalletService,
    private readonly agents: AgentService,
    private readonly events: EventBus,
    private readonly books: BooksService,
    private readonly entities: EntityService,
    private readonly fx: FxService,
  ) {}

  /**
   * Post a movement to the sister that contracts this shop, and keep the typed ledger row that the
   * earnings register reads. The BOOKS are the money; the PudoLedgerEntry is a projection of it for a
   * shopkeeper's screen — it carries the entry id so the two can never be told apart by an auditor.
   *
   * Every method below names BOTH sides. That is the whole point: before this, payLabour credited an
   * agent out of nowhere and chargeShipping debited into nowhere.
   */
  private postAgent(did: string, kind: string, ref: string, lines: Array<{ code: AccountCode; counterparty?: string; amount: number }>): string {
    const entityId = this.agents.entityIdOf(this.agents.get(did));
    return this.books.post({ entityId, kind, ref, lines }).entryId;
  }

  /**
   * 'No money, no scan' gate. Returns 200 with a domain payload — an error status must never carry
   * business data (S4), so a locked agent is a normal, readable answer, not a 402. `canTransact` is the
   * new field; `ok` is kept as an alias so the shipped agent app keeps working. `code` lets a
   * low-literacy UI pick the right icon (top-up vs unlock) and `shortfall` names the exact gap.
   */
  canTransact(did: string): { ok: boolean; canTransact: boolean; code: string | null; balance: number; threshold: number; shortfall: number; credit: { limit: number; used: number; available: number } } {
    const balance = this.agents.balance(did);
    // What the shop can actually spend: its own float PLUS the trade-credit line. A customer paying cash
    // at the counter is not turned away for an empty float — the shop keeps scanning, on credit, up to a
    // bounded number of parcels. With the limit at zero this is exactly the old 'no money, no scan' rule.
    const spendable = Math.round((balance + TRADE_CREDIT_LIMIT) * 100) / 100;
    const funded = spendable >= LOCK_THRESHOLD;
    const ok = this.agents.canScan(did) && funded;
    const code = ok ? null : !funded ? 'WALLET_INSUFFICIENT' : 'AGENT_LOCKED';
    const shortfall = funded ? 0 : Math.round((LOCK_THRESHOLD - spendable) * 100) / 100;
    const used = this.agents.creditOwed(did);
    return {
      ok,
      canTransact: ok,
      code,
      balance,
      threshold: LOCK_THRESHOLD,
      shortfall,
      credit: { limit: TRADE_CREDIT_LIMIT, used, available: Math.round((TRADE_CREDIT_LIMIT - used) * 100) / 100 },
    };
  }

  /** Real money in → the shop's DEPOSIT grows and the sister holds the cash. Nothing is earned here:
   *  we charge for service, not for balance, so revenue waits until a parcel actually moves. */
  topUp(did: string, amount: number, bankRef = 'cash'): PudoLedgerEntry {
    if (amount <= 0) throw new GlosError('AMOUNT_INVALID', 'Top-up amount must be positive');
    // KYC gate. This used to ride on "the m1 wallet exists", which was provisioned at approval — an
    // implicit coupling that stopped meaning anything once the balance moved into the books. Say it.
    const status = this.agents.get(did).status;
    if (status === 'DRAFT' || status === 'KYC_PENDING') {
      throw new GlosError('KYC_INCOMPLETE', 'This shop is not approved yet — it cannot hold a balance');
    }
    // Trade credit is settled FIRST, out of the money coming in — a shop that scanned on credit clears
    // its debt before it builds a float again. Only what is left over becomes spendable balance.
    const repay = Math.min(amount, this.agents.creditOwed(did));
    const toDeposit = Math.round((amount - repay) * 100) / 100;
    const entryId = this.postAgent(did, 'top-up', bankRef, [
      { code: ACCOUNT_CODES.CASH_CUSTODY, amount },
      ...(repay > 0 ? [{ code: ACCOUNT_CODES.RECEIVABLE_AGENT, counterparty: did, amount: -repay }] : []),
      ...(toDeposit > 0 ? [{ code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: did, amount: -toDeposit }] : []),
    ]);
    const entry = this.record('TOP_UP', '+', amount, did, bankRef, 'bank', entryId);
    this.agents.refreshLock(did);
    void this.events.publish(GlosEvent.Pudo.WalletToppedUp, { did, amount, bankRef }, { source: 'pudo' }).catch(() => undefined);
    return entry;
  }

  /** A parcel moves: the shop's deposit is drawn down and the sister finally EARNS it. On a cash walk-up
   *  the shop keeps the retail spread off-platform — we never see that money and never should. */
  chargeShipping(did: string, amount: number, parcelId: string, tax = 0): PudoLedgerEntry {
    const balance = this.agents.balance(did);
    // `amount` is the GROSS. The credit line is measured against it too: what a shop owes us is the whole
    // charge, and a tax we have already booked as payable is exactly as real a debt as the rest.
    if (balance - amount < -TRADE_CREDIT_LIMIT - 1e-9) {
      throw new GlosError('WALLET_INSUFFICIENT', `Trade credit is used up (${TRADE_CREDIT_PARCELS} parcels) — top up to keep scanning`);
    }
    // Tax first, off the top — held for an authority, never ours, never revenue.
    const collected = Number.isFinite(tax) ? Math.min(Math.max(Math.round(tax * 100) / 100, 0), amount) : 0;
    const net = Math.round((amount - collected) * 100) / 100;
    // Draw the shop's own float first; whatever it cannot cover is drawn on the credit line, which is a
    // RECEIVABLE, not a mysteriously negative deposit. The operator can see exactly what is lent out.
    const fromDeposit = Math.min(Math.max(balance, 0), amount);
    const onCredit = Math.round((amount - fromDeposit) * 100) / 100;
    const entryId = this.postAgent(did, 'shipping', parcelId, [
      ...(fromDeposit > 0 ? [{ code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: did, amount: fromDeposit }] : []),
      ...(onCredit > 0 ? [{ code: ACCOUNT_CODES.RECEIVABLE_AGENT, counterparty: did, amount: onCredit }] : []),
      { code: ACCOUNT_CODES.REVENUE, amount: -net },
      ...(collected > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: -collected }] : []),
    ]);
    const entry = this.record('FEE', '-', amount, did, parcelId, 'parcel', entryId);
    this.agents.refreshLock(did);
    return entry;
  }

  /** Pay the agent a labour/handover fee. It lands in their float (spendable credit, as it always has),
   *  and the sister books the cost — a fee that increased a balance out of nowhere is what we just fixed.
   *
   *  `sellerEntityId` is the sister that SOLD the shipment. When it is another company, this shop's own
   *  sister has just paid for work on somebody else's sale, and recovers it at cost (see recoverAtCost). */
  payLabour(did: string, amount: number, reference: string, refType: PudoLedgerEntry['refType'], sellerEntityId?: string): PudoLedgerEntry {
    const entryId = this.postAgent(did, 'labour', reference, [
      { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount },
      { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: did, amount: -amount },
    ]);
    this.recoverAtCost(this.agents.entityIdOf(this.agents.get(did)), sellerEntityId, amount, reference);
    const entry = this.record('LABOR_PAYOUT', '+', amount, did, reference, refType, entryId);
    this.agents.refreshLock(did);
    return entry;
  }

  /**
   * Recharge one sister's outlay to the sister that sold the shipment — AT COST, and no more.
   *
   * The rule, decided rather than derived (user, 2026-08-26): *"we will recover cost only."* The performing
   * sister takes no margin for handling somebody else's sale, and the way that is written down matters —
   * its own expense is REVERSED rather than matched with revenue, so its books show nothing at all for this
   * parcel. It was reimbursed; it did not sell anything.
   *
   * Two entries, one per book, linked by the same `ref` — the rule JournalEntry states. Each sister's book
   * stays internally complete and readable alone, and the pair is explicit rather than an artefact of some
   * clever cross-book entry. The amounts are deliberately NOT equal numbers: they are equal VALUE, each in
   * its own currency, converted at the MID rate. The buffer the buyer paid never enters here — that is the
   * whole point of it not being ours.
   */
  private recoverAtCost(payerEntityId: string, sellerEntityId: string | undefined, amount: number, ref: string): void {
    if (!sellerEntityId || sellerEntityId === payerEntityId || !(amount > 0)) return;
    // The performer: made whole, earning nothing. A receivable from the seller, and its expense undone.
    this.books.post({
      entityId: payerEntityId,
      kind: 'recharge-at-cost',
      ref,
      lines: [
        { code: ACCOUNT_CODES.INTERCOMPANY, counterparty: sellerEntityId, amount },
        { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount: -amount },
      ],
    });
    // The seller: it collected the price for this leg, so it carries the cost of it — in its own money.
    const cost = this.fx.convert(amount, this.currencyOf(payerEntityId), this.currencyOf(sellerEntityId));
    this.books.post({
      entityId: sellerEntityId,
      kind: 'recharge-at-cost',
      ref,
      lines: [
        { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount: cost },
        { code: ACCOUNT_CODES.INTERCOMPANY, counterparty: payerEntityId, amount: -cost },
      ],
    });
  }

  /**
   * Record an upheld claim for somebody the network cannot simply credit.
   *
   * A walk-up sender paid cash over a counter and has no account here, so there is nothing to pay INTO.
   * The award becomes a payable that sits on the books, visibly, until an operator settles it in cash —
   * the same shape as any other obligation the network owes and has not yet discharged.
   *
   * It deliberately does NOT invent a balance for that person. A wallet conjured to hold a refund would
   * be an account nobody asked for, holding money nobody can spend here, and it would quietly make the
   * network a place that keeps consumers' funds — which is the one thing the money model refuses to be.
   */
  recordClaimPayable(entityId: string, parcelId: string, amount: number, claimant: string): { fromProvision: number; fromExpense: number } {
    const value = Math.round((Number.isFinite(amount) ? amount : 0) * 100) / 100;
    if (value <= 0) return { fromProvision: 0, fromExpense: 0 };
    const split = this.books.provisionSplit(entityId, value);
    this.books.post({
      entityId,
      kind: 'claim',
      ref: parcelId,
      lines: [
        ...(split.fromProvision > 0 ? [{ code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: split.fromProvision }] : []),
        ...(split.fromExpense > 0 ? [{ code: ACCOUNT_CODES.EXPENSE_CLAIMS, amount: split.fromExpense }] : []),
        // Owed to this specific claimant, so "who is still waiting to be paid" is a balance rather than
        // a search through journal memos.
        { code: ACCOUNT_CODES.PAYABLE_CLAIM, counterparty: claimant, amount: -value },
      ],
    });
    return split;
  }

  /** The money a sister keeps its books in. */
  private currencyOf(entityId: string): string {
    const entity = this.entities.get(entityId);
    return entity.currency ?? currencyForJurisdiction(entity.jurisdiction);
  }

  /** Reverse a shipping charge within the void window. A 0 refund is a no-op (a zero-priced parcel was
   *  never charged) — never trip the positive-amount assertion on a reversal. */
  refund(did: string, amount: number, parcelId: string, tax = 0): PudoLedgerEntry | null {
    if (amount <= 0) return null;
    // The mirror of chargeShipping, tax included: a voided sale un-owes the tax it collected. Reversing
    // the gross out of revenue alone would leave the sister liable for tax on a sale that no longer exists.
    const collected = Number.isFinite(tax) ? Math.min(Math.max(Math.round(tax * 100) / 100, 0), amount) : 0;
    const net = Math.round((amount - collected) * 100) / 100;
    const entryId = this.postAgent(did, 'refund', parcelId, [
      ...(net > 0 ? [{ code: ACCOUNT_CODES.REVENUE, amount: net }] : []),
      ...(collected > 0 ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: collected }] : []),
      { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: did, amount: -amount },
    ]);
    const entry = this.record('REFUND', '+', amount, did, parcelId, 'parcel', entryId);
    this.agents.refreshLock(did);
    return entry;
  }

  /** Reverse a labour fee when a paid intake is undone (void / cancel of a peer-send) — the exact mirror
   *  of payLabour, so the pair nets to zero in both the float and the cost. */
  clawbackLabour(did: string, amount: number, parcelId: string): PudoLedgerEntry | null {
    if (amount <= 0) return null;
    const entryId = this.postAgent(did, 'labour-clawback', parcelId, [
      { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: did, amount },
      { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount: -amount },
    ]);
    const entry = this.record('LABOR_PAYOUT', '-', amount, did, parcelId, 'parcel', entryId);
    this.agents.refreshLock(did);
    return entry;
  }

  // The admin overdraft was removed with the trade-credit line. It had become inert: what gates trading
  // is the CREDIT LIMIT, not the balance, and lending a shop money against the same limit moved nobody.
  // Every approved shop now has the same standing line of TRADE_CREDIT_PARCELS — one rule, no override,
  // and no staff member put under pressure to grant one.

  /** Driver settlement — accrues what the sister owes the party it CONTRACTS with (a fleet, or an
   *  independent courier). Never a payroll entry: see the settling-entity rule. */
  driverPayout(driverId: string, amount: number, entityId?: string): PudoLedgerEntry {
    const entryId = entityId
      ? this.books.post({
          entityId,
          kind: 'driver-payout',
          ref: driverId,
          lines: [
            { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount },
            { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: driverId, amount: -amount },
          ],
        }).entryId
      : undefined;
    return this.record('DRIVER_PAYOUT', '-', amount, undefined, driverId, 'driver', entryId);
  }

  /** MDP sort labour — the hub is a provider like any other, so the sister accrues what it owes. A hub in
   *  another country recharges its sister's outlay to the seller exactly as a shop does. */
  sortLabour(mdpId: string, amount: number, reference: string, entityId?: string, sellerEntityId?: string): PudoLedgerEntry {
    const entryId = entityId
      ? this.books.post({
          entityId,
          kind: 'sort-labour',
          ref: reference || mdpId,
          lines: [
            { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount },
            { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: mdpId, amount: -amount },
          ],
        }).entryId
      : undefined;
    if (entityId) this.recoverAtCost(entityId, sellerEntityId, amount, reference || mdpId);
    return this.record('LABOR_PAYOUT', '-', amount, undefined, reference || mdpId, 'mdp', entryId);
  }

  /**
   * Book an inbound shipment's split/contribution settlement: the buyer's capped contribution + the
   * vendor's share. GLOS holds no fiat — these are reconciliation records (who paid what), not wallet ops.
   */
  settleShipment(parcelId: string, vendorId: string, buyerContribution: number, vendorShare: number): void {
    if (buyerContribution > 0) this.record('SETTLEMENT', '+', buyerContribution, undefined, parcelId, 'parcel');
    if (vendorShare > 0) this.record('SETTLEMENT', '+', vendorShare, undefined, vendorId, 'vendor');
  }

  entries(filter: { did?: string; type?: LedgerType } = {}): PudoLedgerEntry[] {
    return [...this.ledger.values()].filter((e) => (!filter.did || e.did === filter.did) && (!filter.type || e.type === filter.type)).reverse();
  }

  // --- earnings register (R4): the shop's OWN ledger, server-side searched / filtered / sorted / paginated ---

  agentLedgerPage(did: string, q: AgentLedgerQuery): Page<AgentLedgerRow> {
    const filtered = filterAgentLedger(this.entries({ did }), q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map(agentLedgerRowOf), total };
  }

  /** Running totals (in / out / net / count) for the CURRENT filtered view — the always-current balance
   *  stays on the wallet, not here (parity with the vendor bookkeeping register). */
  agentLedgerSummary(did: string, q: AgentLedgerQuery): AgentLedgerSummary {
    return agentLedgerSummaryOf(filterAgentLedger(this.entries({ did }), q));
  }

  agentLedgerCsv(did: string, q: AgentLedgerQuery): string {
    return agentLedgerToCsv(filterAgentLedger(this.entries({ did }), q));
  }

  /** Sum of all agent wallet balances — the platform's pre-paid liability (System Float). */
  float(): number {
    return Math.round(this.agents.list().reduce((sum, a) => sum + this.agents.balance(a.did), 0) * 100) / 100;
  }

  private record(type: LedgerType, sign: '+' | '-', amount: number, did: string | undefined, reference: string, refType: PudoLedgerEntry['refType'], entryId?: string): PudoLedgerEntry {
    const entry: PudoLedgerEntry = { id: `led_${randomBytes(8).toString('hex')}`, type, sign, amount: Math.round(amount * 100) / 100, currency: NETWORK_CURRENCY, did, reference, refType, entryId, at: new Date().toISOString() };
    this.ledger.set(entry.id, entry);
    return entry;
  }
}
