import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { WalletService } from '../m1/wallet/wallet.service';
import { ComplianceService } from './compliance.service';
import { InvoiceService } from './invoice.service';
import { FxService } from './fx.service';
import { TripleEntryLedger } from './triple-entry-ledger.service';
import { Escrow, EscrowSummary, MilestoneName, MilestoneRelease, MilestoneTerm } from './escrow.types';

export interface CreateEscrowInput {
  glosShipmentId: string;
  payerDid: string;
  currency: string;
  totalAmount: number;
  milestones: MilestoneTerm[];
  requireAcceptance?: boolean;
  commissionRate?: number;
  staged?: boolean;
  deadline?: string;
  latePenaltyPct?: number;
  earlyBonusPct?: number;
}

const PLATFORM = 'glos:platform';
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * EscrowService — programmable conditional settlement (SSE-010..082). Funds from the payer wallet
 * (whole or staged), releases each milestone on an M4 oracle event, applies the GLOS commission
 * (SSE-041), late penalty / early bonus (SSE-034) and cross-border FX (SSE-042), pays the payee
 * wallet, keeps the smart invoice + triple-entry journal live, and reconciles after every move.
 */
@Injectable()
export class EscrowService {
  private readonly escrows = new Map<string, Escrow>();
  private readonly byShipment = new Map<string, string>();

  constructor(
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly events: EventBus,
    private readonly compliance: ComplianceService,
    private readonly invoices: InvoiceService,
    private readonly fx: FxService,
    private readonly journal: TripleEntryLedger,
  ) {}

  create(input: CreateEscrowInput): Escrow {
    if (!(input.totalAmount > 0)) throw new BadRequestException('totalAmount must be positive');
    const sum = input.milestones.reduce((s, m) => s + m.percent, 0);
    if (Math.round(sum) !== 100) throw new BadRequestException(`milestone percents must sum to 100 (got ${sum})`);
    if (this.byShipment.has(input.glosShipmentId)) throw new BadRequestException('Escrow already exists for this shipment');

    const milestones = this.allocate(input.milestones, input.totalAmount);
    const core = { glosShipmentId: input.glosShipmentId, payerDid: input.payerDid, currency: input.currency, totalAmount: input.totalAmount, milestones };
    const escrow: Escrow = {
      escrowId: `esc_${randomBytes(12).toString('hex')}`,
      ...core,
      fundedAmount: 0,
      releasedAmount: 0,
      feesCollected: 0,
      status: 'created',
      requireAcceptance: Boolean(input.requireAcceptance),
      staged: Boolean(input.staged),
      commissionRate: input.commissionRate ?? 0.1,
      deadline: input.deadline,
      latePenaltyPct: input.latePenaltyPct ?? 0.05,
      earlyBonusPct: input.earlyBonusPct ?? 0,
      disputes: [],
      anchorTxId: this.ledger.anchor(core).txId,
      createdAt: new Date().toISOString(),
    };
    this.escrows.set(escrow.escrowId, escrow);
    this.byShipment.set(escrow.glosShipmentId, escrow.escrowId);
    this.invoices.createDraft(escrow);

    void this.events.publish(GlosEvent.Settlement.EscrowCreated, { escrowId: escrow.escrowId, glosShipmentId: escrow.glosShipmentId, totalAmount: escrow.totalAmount }, { source: 'sse' }).catch(() => undefined);
    return escrow;
  }

  /** SSE-011/012: fund the whole escrow, or a single stage when `staged`. */
  fund(escrowId: string, milestoneName?: MilestoneName): Escrow {
    const escrow = this.require(escrowId);

    if (!escrow.staged) {
      if (escrow.fundedAmount > 0) throw new BadRequestException('Escrow already funded');
      this.wallet.debit(escrow.payerDid, escrow.totalAmount, escrow.currency);
      escrow.fundedAmount = escrow.totalAmount;
      escrow.milestones.forEach((m) => (m.funded = true));
      this.journal.record(escrowId, 'fund', { account: escrow.payerDid, amount: escrow.totalAmount, currency: escrow.currency }, { account: escrowId, amount: escrow.totalAmount, currency: escrow.currency });
    } else {
      const milestone = escrow.milestones.find((m) => m.name === milestoneName && !m.funded);
      if (!milestone) throw new BadRequestException('No unfunded stage with that name');
      this.wallet.debit(escrow.payerDid, milestone.amount, escrow.currency);
      milestone.funded = true;
      escrow.fundedAmount = round2(escrow.fundedAmount + milestone.amount);
      this.journal.record(escrowId, 'fund', { account: escrow.payerDid, amount: milestone.amount, currency: escrow.currency }, { account: escrowId, amount: milestone.amount, currency: escrow.currency });
    }
    escrow.status = escrow.status === 'created' ? 'funded' : escrow.status;
    void this.events.publish(GlosEvent.Settlement.EscrowFunded, { escrowId, glosShipmentId: escrow.glosShipmentId, fundedAmount: escrow.fundedAmount }, { source: 'sse' }).catch(() => undefined);
    return escrow;
  }

  /** SSE-030: release a milestone, triggered by an M4 oracle event. */
  releaseByMilestone(glosShipmentId: string, name: MilestoneName, triggerEventId?: string): { released: boolean; reason?: string } {
    const escrowId = this.byShipment.get(glosShipmentId);
    if (!escrowId) return { released: false, reason: 'no_escrow' };
    const escrow = this.require(escrowId);

    const milestone = escrow.milestones.find((m) => m.name === name && (m.state === 'pending' || m.state === 'awaiting_acceptance'));
    if (!milestone) return { released: false, reason: 'no_pending_milestone' };
    if (!milestone.funded) return { released: false, reason: 'not_funded' };

    for (const did of [escrow.payerDid, milestone.payeeDid]) {
      if (!this.compliance.screen(did).ok) {
        milestone.state = 'frozen';
        return { released: false, reason: 'compliance_hold' };
      }
    }

    if (name === 'DELIVERY' && escrow.requireAcceptance && milestone.state === 'pending') {
      milestone.state = 'awaiting_acceptance';
      return { released: false, reason: 'awaiting_acceptance' };
    }

    this.settle(escrow, milestone, triggerEventId);
    return { released: true };
  }

  accept(escrowId: string): Escrow {
    const escrow = this.require(escrowId);
    const milestone = escrow.milestones.find((m) => m.name === 'DELIVERY' && m.state === 'awaiting_acceptance');
    if (!milestone) throw new BadRequestException('No delivery milestone awaiting acceptance');
    this.settle(escrow, milestone);
    return escrow;
  }

  // --- dispute support (used by DisputeService) ---

  freezeMilestone(escrowId: string, name: MilestoneName): MilestoneRelease {
    const escrow = this.require(escrowId);
    const milestone = escrow.milestones.find((m) => m.name === name && m.state === 'pending');
    if (!milestone) throw new BadRequestException('No pending milestone to freeze');
    milestone.state = 'frozen';
    this.journal.record(escrowId, 'dispute_freeze', { account: escrowId, amount: milestone.amount, currency: escrow.currency }, { account: 'dispute:hold', amount: milestone.amount, currency: escrow.currency });
    return milestone;
  }

  /** Resolve a frozen milestone by splitting it: payeeSplitPct% to payee, remainder refunded. */
  applyDisputeResolution(escrowId: string, name: MilestoneName, payeeSplitPct: number): void {
    const escrow = this.require(escrowId);
    const milestone = escrow.milestones.find((m) => m.name === name && m.state === 'frozen');
    if (!milestone) throw new BadRequestException('No frozen milestone for this dispute');
    const payeeShare = round2((milestone.amount * payeeSplitPct) / 100);
    const refund = round2(milestone.amount - payeeShare);
    if (payeeShare > 0) this.payTo(escrow, milestone.payeeDid, payeeShare, 'dispute_resolve');
    if (refund > 0) {
      this.wallet.credit(escrow.payerDid, refund, escrow.currency);
      this.journal.record(escrowId, 'dispute_resolve', { account: escrowId, amount: refund, currency: escrow.currency }, { account: escrow.payerDid, amount: refund, currency: escrow.currency });
    }
    milestone.state = 'released';
    milestone.releasedAt = new Date().toISOString();
    milestone.payeeNet = payeeShare;
    escrow.releasedAmount = round2(escrow.releasedAmount + milestone.amount);
    escrow.status = escrow.releasedAmount >= escrow.totalAmount ? 'released' : 'partially_released';
    this.reconcile(escrow);
  }

  get(escrowId: string): Escrow {
    return this.require(escrowId);
  }

  getByShipment(glosShipmentId: string): Escrow | undefined {
    const id = this.byShipment.get(glosShipmentId);
    return id ? this.escrows.get(id) : undefined;
  }

  summary(escrowId: string): EscrowSummary {
    const e = this.require(escrowId);
    return {
      escrowId: e.escrowId,
      glosShipmentId: e.glosShipmentId,
      currency: e.currency,
      totalAmount: e.totalAmount,
      fundedAmount: e.fundedAmount,
      releasedAmount: e.releasedAmount,
      heldAmount: round2(e.fundedAmount - e.releasedAmount),
      feesCollected: e.feesCollected,
      status: e.status,
      staged: e.staged,
      milestones: e.milestones,
      disputes: e.disputes,
    };
  }

  // --- internals ---

  private settle(escrow: Escrow, milestone: MilestoneRelease, triggerEventId?: string): void {
    const gross = milestone.amount;
    const { penalty, bonus } = this.penaltyAndBonus(escrow, milestone);
    const afterPenalty = round2(gross - penalty);
    const fee = round2(afterPenalty * escrow.commissionRate);
    const payeeNet = round2(afterPenalty - fee); // escrow currency

    // Penalty is refunded to the payer; fee goes to the platform.
    if (penalty > 0) {
      this.wallet.credit(escrow.payerDid, penalty, escrow.currency);
      this.journal.record(escrow.escrowId, 'penalty_refund', { account: escrow.escrowId, amount: penalty, currency: escrow.currency }, { account: escrow.payerDid, amount: penalty, currency: escrow.currency });
    }
    if (fee > 0) this.journal.record(escrow.escrowId, 'fee', { account: escrow.escrowId, amount: fee, currency: escrow.currency }, { account: PLATFORM, amount: fee, currency: escrow.currency });

    // Pay the payee (escrow share + any bonus from the payer), with FX if cross-border.
    let bonusPaid = 0;
    if (bonus > 0) {
      try {
        this.wallet.debit(escrow.payerDid, bonus, escrow.currency);
        bonusPaid = bonus;
      } catch {
        bonusPaid = 0; // payer can't cover the bonus — skip it
      }
    }
    const fx = this.payTo(escrow, milestone.payeeDid, round2(payeeNet + bonusPaid), 'release');

    milestone.state = 'released';
    milestone.releasedAt = new Date().toISOString();
    milestone.triggerEventId = triggerEventId;
    milestone.payeeNet = payeeNet;
    milestone.fee = fee;
    milestone.penalty = penalty;
    milestone.bonus = bonusPaid;
    if (fx) milestone.fx = fx;

    escrow.releasedAmount = round2(escrow.releasedAmount + gross);
    escrow.feesCollected = round2(escrow.feesCollected + fee);
    escrow.status = escrow.releasedAmount >= escrow.totalAmount ? 'released' : 'partially_released';

    this.invoices.addReleaseLine(escrow.escrowId, milestone.name, milestone.payeeDid, { gross, fee, penalty, bonus: bonusPaid, net: payeeNet, triggerEventId });
    this.reconcile(escrow);

    void this.events.publish(GlosEvent.Settlement.MilestoneReleased, { escrowId: escrow.escrowId, glosShipmentId: escrow.glosShipmentId, milestone: milestone.name, gross, net: payeeNet, fee, penalty, bonus: bonusPaid, payeeDid: milestone.payeeDid }, { source: 'sse' }).catch(() => undefined);
    void this.events.publish(GlosEvent.Wallet.PayoutCompleted, { did: milestone.payeeDid, amount: round2(payeeNet + bonusPaid), currency: fx ? fx.currency : escrow.currency, source: 'escrow', escrowId: escrow.escrowId }, { source: 'sse' }).catch(() => undefined);

    if (escrow.status === 'released') this.invoices.finalize(escrow.escrowId);
  }

  /** Credit a payee, converting from escrow currency to their wallet currency if needed. */
  private payTo(escrow: Escrow, payeeDid: string, amountEscrowCcy: number, type: 'release' | 'dispute_resolve'): { currency: string; rate: number; converted: number } | undefined {
    const payeeWallet = this.wallet.get(payeeDid);
    const payeeCcy = payeeWallet?.settlementCurrency ?? escrow.currency;
    if (payeeCcy === escrow.currency) {
      this.wallet.credit(payeeDid, amountEscrowCcy, escrow.currency);
      this.journal.record(escrow.escrowId, type, { account: escrow.escrowId, amount: amountEscrowCcy, currency: escrow.currency }, { account: payeeDid, amount: amountEscrowCcy, currency: escrow.currency });
      return undefined;
    }
    const { converted, rate } = this.fx.convert(amountEscrowCcy, escrow.currency, payeeCcy);
    this.wallet.credit(payeeDid, converted, payeeCcy);
    this.journal.record(escrow.escrowId, 'fx', { account: escrow.escrowId, amount: amountEscrowCcy, currency: escrow.currency }, { account: payeeDid, amount: converted, currency: payeeCcy });
    return { currency: payeeCcy, rate, converted };
  }

  private penaltyAndBonus(escrow: Escrow, milestone: MilestoneRelease): { penalty: number; bonus: number } {
    if (milestone.name !== 'DELIVERY' || !escrow.deadline) return { penalty: 0, bonus: 0 };
    const late = Date.now() > new Date(escrow.deadline).getTime();
    if (late) return { penalty: round2(milestone.amount * escrow.latePenaltyPct), bonus: 0 };
    return { penalty: 0, bonus: escrow.earlyBonusPct > 0 ? round2(milestone.amount * escrow.earlyBonusPct) : 0 };
  }

  private reconcile(escrow: Escrow): void {
    const pending = escrow.milestones.filter((m) => m.state !== 'released').reduce((s, m) => s + m.amount, 0);
    if (round2(escrow.releasedAmount + pending) !== round2(escrow.totalAmount)) {
      throw new Error(`Reconciliation failure on escrow ${escrow.escrowId}`);
    }
    if (escrow.releasedAmount > escrow.fundedAmount + 0.001) {
      throw new Error(`Over-release on escrow ${escrow.escrowId}: released > funded`);
    }
  }

  private allocate(terms: MilestoneTerm[], total: number): MilestoneRelease[] {
    let running = 0;
    return terms.map((t, i) => {
      const amount = i === terms.length - 1 ? round2(total - running) : round2((total * t.percent) / 100);
      running = round2(running + amount);
      return { name: t.name, percent: t.percent, payeeDid: t.payeeDid, amount, state: 'pending' as const, funded: false };
    });
  }

  private require(escrowId: string): Escrow {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new NotFoundException(`Escrow not found: ${escrowId}`);
    return escrow;
  }
}
