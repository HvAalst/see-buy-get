import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { EscrowService } from './escrow.service';
import { InvoiceService } from './invoice.service';
import { TripleEntryLedger } from './triple-entry-ledger.service';
import { Dispute, DisputeTag, MilestoneName } from './escrow.types';

export interface FileDisputeInput {
  escrowId: string;
  milestone: MilestoneName;
  tag: DisputeTag;
  reason: string;
  filedByDid: string;
  evidenceRefs?: string[];
}

export interface ResolveDisputeInput {
  level: 1 | 2 | 3;
  /** Optional explicit split (0–100 to payee); otherwise derived by level. */
  payeeSplitPct?: number;
  atFaultDid?: string;
  atFault?: boolean;
  note?: string;
}

const METHOD_BY_LEVEL = { 1: 'auto_negotiation', 2: 'ai_mediation', 3: 'human_arbitration' } as const;

/**
 * DisputeService (SSE-050..054). Structured filing freezes the disputed milestone; an evidence
 * pack is auto-compiled; tiered resolution (L1 auto-negotiation → L2 AI mediation → L3 human
 * arbitration) splits the frozen funds, records the outcome immutably, and emits
 * `settlement.dispute_resolved` → M5 adjusts the at-fault party's reputation.
 */
@Injectable()
export class DisputeService {
  private readonly disputes = new Map<string, Dispute>();

  constructor(
    private readonly escrows: EscrowService,
    private readonly invoices: InvoiceService,
    private readonly journal: TripleEntryLedger,
    private readonly ledger: LedgerService,
    private readonly events: EventBus,
  ) {}

  /** SSE-050/051: file a dispute and freeze the disputed milestone. */
  file(input: FileDisputeInput): Dispute {
    const escrow = this.escrows.get(input.escrowId);
    const milestone = this.escrows.freezeMilestone(input.escrowId, input.milestone);
    const dispute: Dispute = {
      disputeId: `dsp_${randomBytes(10).toString('hex')}`,
      escrowId: input.escrowId,
      milestone: input.milestone,
      tag: input.tag,
      reason: input.reason,
      evidenceRefs: input.evidenceRefs ?? [],
      filedByDid: input.filedByDid,
      status: 'open',
      frozenAmount: milestone.amount,
      at: new Date().toISOString(),
    };
    escrow.disputes.push(dispute);
    this.disputes.set(dispute.disputeId, dispute);
    return dispute;
  }

  /** SSE-052: auto-compiled resolution pack (event/invoice/escrow trail). */
  evidencePack(disputeId: string): Record<string, unknown> {
    const dispute = this.require(disputeId);
    return {
      dispute,
      escrow: this.escrows.summary(dispute.escrowId),
      invoice: this.invoices.get(dispute.escrowId),
      journal: this.journal.journal(dispute.escrowId),
      journalVerified: this.journal.verify(dispute.escrowId),
    };
  }

  /** SSE-053/054: resolve, split the frozen funds, record immutably, notify M5. */
  resolve(disputeId: string, input: ResolveDisputeInput): Dispute {
    const dispute = this.require(disputeId);
    if (dispute.status === 'resolved') throw new BadRequestException('Dispute already resolved');

    const payeeSplitPct = input.payeeSplitPct ?? this.defaultSplit(input.level, input.atFault);
    this.escrows.applyDisputeResolution(dispute.escrowId, dispute.milestone, payeeSplitPct);

    const at = new Date().toISOString();
    const anchorTxId = this.ledger.anchor({ disputeId, payeeSplitPct, atFaultDid: input.atFaultDid, at }).txId;
    dispute.status = 'resolved';
    dispute.resolution = { level: input.level, method: METHOD_BY_LEVEL[input.level], payeeSplitPct, atFaultDid: input.atFaultDid, note: input.note, at, anchorTxId };

    // Notify M5 — the at-fault party's reputation adjusts by the dispute's dimension (M5-050/051).
    if (input.atFaultDid) {
      void this.events
        .publish(GlosEvent.Settlement.DisputeResolved, { subjectDid: input.atFaultDid, tag: dispute.tag, atFault: input.atFault ?? true, note: dispute.reason }, { source: 'sse' })
        .catch(() => undefined);
    }
    return dispute;
  }

  get(disputeId: string): Dispute {
    return this.require(disputeId);
  }

  /** L1 leans to the filer, L3 is even unless overridden; at-fault flips the split. */
  private defaultSplit(level: 1 | 2 | 3, atFault?: boolean): number {
    if (atFault === true) return 0; // payee at fault → nothing to payee
    if (atFault === false) return 100; // payee cleared → full release
    return level === 1 ? 50 : level === 2 ? 60 : 50;
  }

  private require(disputeId: string): Dispute {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw new NotFoundException(`Dispute not found: ${disputeId}`);
    return dispute;
  }
}
