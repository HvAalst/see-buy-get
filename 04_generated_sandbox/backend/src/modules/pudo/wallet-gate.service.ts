import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { WalletService } from '../m1/wallet/wallet.service';
import { AgentService } from './agent.service';
import { LOCK_THRESHOLD } from './pudo.config';
import { LedgerType, PudoLedgerEntry } from './pudo.types';

/**
 * WalletGateService (P-003, Light SSE ↔ GLOS SSE). The pre-paid wallet that enforces 'no money, no
 * scan'. It reuses the M1 wallet for the balance and layers the PUDO ledger (typed entries) on top.
 * Every movement is a single wallet op + a ledger row; status is refreshed so the agent auto-locks
 * the instant the balance drops below the threshold — the smallest implementation of NFR-SSE-01
 * ('no lost or double-spent funds') at this scale.
 */
@Injectable()
export class WalletGateService {
  private readonly ledger: PudoLedgerEntry[] = [];

  constructor(
    private readonly wallet: WalletService,
    private readonly agents: AgentService,
    private readonly events: EventBus,
  ) {}

  /** 'No money, no scan' gate (GET /agent/can-transact → 402 if false). */
  canTransact(did: string): { ok: boolean; balance: number; threshold: number } {
    const balance = this.agents.balance(did);
    return { ok: this.agents.canScan(did) && balance >= LOCK_THRESHOLD, balance, threshold: LOCK_THRESHOLD };
  }

  /** Real money in → credits the wallet, may activate the agent. */
  topUp(did: string, amount: number, bankRef = 'cash'): PudoLedgerEntry {
    if (amount <= 0) throw new BadRequestException('Top-up amount must be positive');
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
    return this.ledger.filter((e) => (!filter.did || e.did === filter.did) && (!filter.type || e.type === filter.type)).slice().reverse();
  }

  /** Sum of all agent wallet balances — the platform's pre-paid liability (System Float). */
  float(): number {
    return Math.round(this.agents.list().reduce((sum, a) => sum + this.agents.balance(a.did), 0) * 100) / 100;
  }

  private record(type: LedgerType, sign: '+' | '-', amount: number, did: string | undefined, reference: string, refType: PudoLedgerEntry['refType']): PudoLedgerEntry {
    const entry: PudoLedgerEntry = { id: `led_${randomBytes(8).toString('hex')}`, type, sign, amount: Math.round(amount * 100) / 100, did, reference, refType, at: new Date().toISOString() };
    this.ledger.push(entry);
    return entry;
  }
}
