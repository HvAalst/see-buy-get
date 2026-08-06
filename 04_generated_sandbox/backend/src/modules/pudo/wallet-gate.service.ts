import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { WalletService } from '../m1/wallet/wallet.service';
import { AgentService } from './agent.service';
import { LOCK_THRESHOLD } from './pudo.config';
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
    case 'OVERDRAFT':
      return 'Credit';
    default:
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
  reference: string;
  refType: PudoLedgerEntry['refType'];
  at: string;
}

export function agentLedgerRowOf(e: PudoLedgerEntry): AgentLedgerRow {
  return { id: e.id, type: e.type, sign: e.sign, amount: e.amount, reference: e.reference, refType: e.refType, at: e.at };
}

export interface AgentLedgerSummary {
  in: number;
  out: number;
  net: number;
  count: number;
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
  return { in: inSum, out: outSum, net: Math.round((inSum - outSum) * 100) / 100, count: rows.length };
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
    ['Date', 'Type', 'Direction', 'Amount', 'Reference'],
    rows.map((e) => [e.at, agentLedgerTypeWord(e.type), e.sign === '+' ? 'in' : 'out', e.sign === '+' ? e.amount : -e.amount, e.reference]),
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
  ) {}

  /**
   * 'No money, no scan' gate. Returns 200 with a domain payload — an error status must never carry
   * business data (S4), so a locked agent is a normal, readable answer, not a 402. `canTransact` is the
   * new field; `ok` is kept as an alias so the shipped agent app keeps working. `code` lets a
   * low-literacy UI pick the right icon (top-up vs unlock) and `shortfall` names the exact gap.
   */
  canTransact(did: string): { ok: boolean; canTransact: boolean; code: string | null; balance: number; threshold: number; shortfall: number } {
    const balance = this.agents.balance(did);
    const funded = balance >= LOCK_THRESHOLD;
    const ok = this.agents.canScan(did) && funded;
    const code = ok ? null : !funded ? 'WALLET_INSUFFICIENT' : 'AGENT_LOCKED';
    const shortfall = funded ? 0 : Math.round((LOCK_THRESHOLD - balance) * 100) / 100;
    return { ok, canTransact: ok, code, balance, threshold: LOCK_THRESHOLD, shortfall };
  }

  /** Real money in → credits the wallet, may activate the agent. */
  topUp(did: string, amount: number, bankRef = 'cash'): PudoLedgerEntry {
    if (amount <= 0) throw new GlosError('AMOUNT_INVALID', 'Top-up amount must be positive');
    this.wallet.require(did); // wallet must exist (agent approved)
    this.wallet.credit(did, amount);
    const entry = this.record('TOP_UP', '+', amount, did, bankRef, 'bank');
    this.agents.refreshLock(did);
    void this.events.publish(GlosEvent.Pudo.WalletToppedUp, { did, amount, bankRef }, { source: 'pudo' }).catch(() => undefined);
    return entry;
  }

  /** Cash-customer parcel: the platform credit is consumed; the agent keeps the retail spread off-platform. */
  chargeShipping(did: string, amount: number, parcelId: string): PudoLedgerEntry {
    this.wallet.debit(did, amount); // throws on insufficient — the gate should have caught it first
    const entry = this.record('FEE', '-', amount, did, parcelId, 'parcel');
    this.agents.refreshLock(did);
    return entry;
  }

  /** Pay the agent a labour/handover fee (pre-paid drop, or handover to bus). */
  payLabour(did: string, amount: number, reference: string, refType: PudoLedgerEntry['refType']): PudoLedgerEntry {
    this.wallet.credit(did, amount);
    const entry = this.record('LABOR_PAYOUT', '+', amount, did, reference, refType);
    this.agents.refreshLock(did);
    return entry;
  }

  /** Reverse a shipping charge within the void window. */
  refund(did: string, amount: number, parcelId: string): PudoLedgerEntry {
    this.wallet.credit(did, amount);
    const entry = this.record('REFUND', '+', amount, did, parcelId, 'parcel');
    this.agents.refreshLock(did);
    return entry;
  }

  /** Admin emergency credit (does not require the wallet to be funded). */
  overdraft(did: string, amount: number, adminId: string): PudoLedgerEntry {
    this.wallet.credit(did, amount);
    const entry = this.record('OVERDRAFT', '+', amount, did, adminId, 'admin');
    this.agents.refreshLock(did);
    return entry;
  }

  /** Weekly driver settlement — a system-level outflow (not an agent wallet entry). */
  driverPayout(driverId: string, amount: number): PudoLedgerEntry {
    return this.record('DRIVER_PAYOUT', '-', amount, undefined, driverId, 'driver');
  }

  /** MDP sort labour — a system-level outflow keyed to the hub (no agent wallet). */
  sortLabour(mdpId: string, amount: number, reference: string): PudoLedgerEntry {
    return this.record('LABOR_PAYOUT', '-', amount, undefined, reference || mdpId, 'mdp');
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

  private record(type: LedgerType, sign: '+' | '-', amount: number, did: string | undefined, reference: string, refType: PudoLedgerEntry['refType']): PudoLedgerEntry {
    const entry: PudoLedgerEntry = { id: `led_${randomBytes(8).toString('hex')}`, type, sign, amount: Math.round(amount * 100) / 100, did, reference, refType, at: new Date().toISOString() };
    this.ledger.set(entry.id, entry);
    return entry;
  }
}
