// Smart Settlement & Escrow domain (Compendium §9). Operational; funds move between M1 wallets.

export type MilestoneName = 'PICKUP' | 'HANDOVER' | 'DELIVERY';
export type MilestoneState = 'pending' | 'released' | 'frozen' | 'awaiting_acceptance';
export type EscrowStatus = 'created' | 'funded' | 'partially_released' | 'released';

/** Dispute classification — drives both the SSE freeze and the M5 dimension it adjusts. */
export type DisputeTag = 'damage' | 'delay' | 'documentation' | 'payment';

/** A term supplied on escrow creation (from M3 later; directly for now). */
export interface MilestoneTerm {
  name: MilestoneName;
  percent: number;
  payeeDid: string;
}

export interface MilestoneRelease {
  name: MilestoneName;
  percent: number;
  payeeDid: string;
  amount: number; // gross, in escrow currency
  state: MilestoneState;
  funded: boolean; // staged funding (SSE-012)
  releasedAt?: string;
  triggerEventId?: string;
  // settlement detail (filled on release)
  payeeNet?: number; // after fee + penalty, in escrow currency
  fee?: number; // GLOS commission (SSE-041)
  penalty?: number; // late penalty deducted, refunded to payer (SSE-034)
  bonus?: number; // early bonus, extra from payer (SSE-034)
  fx?: { currency: string; rate: number; converted: number }; // cross-border payout (SSE-042)
}

export interface EscrowTermsExtras {
  commissionRate?: number; // 0–1, default 0.1
  requireAcceptance?: boolean;
  staged?: boolean; // SSE-012
  deadline?: string; // for penalty/bonus (SSE-034)
  latePenaltyPct?: number; // 0–1
  earlyBonusPct?: number; // 0–1
}

export interface Escrow {
  escrowId: string;
  glosShipmentId: string;
  payerDid: string;
  currency: string;
  totalAmount: number;
  fundedAmount: number;
  releasedAmount: number; // gross released, in escrow currency
  feesCollected: number;
  status: EscrowStatus;
  requireAcceptance: boolean;
  staged: boolean;
  commissionRate: number;
  deadline?: string;
  latePenaltyPct: number;
  earlyBonusPct: number;
  milestones: MilestoneRelease[];
  disputes: Dispute[];
  anchorTxId: string;
  createdAt: string;
}

export interface Dispute {
  disputeId: string;
  escrowId: string;
  milestone: MilestoneName;
  tag: DisputeTag;
  reason: string;
  evidenceRefs: string[];
  filedByDid: string;
  status: 'open' | 'resolved';
  frozenAmount: number;
  at: string;
  resolution?: {
    level: 1 | 2 | 3;
    method: 'auto_negotiation' | 'ai_mediation' | 'human_arbitration';
    payeeSplitPct: number; // 0–100 of the frozen amount to the payee
    atFaultDid?: string;
    note?: string;
    at: string;
    anchorTxId: string;
  };
}

export interface EscrowSummary {
  escrowId: string;
  glosShipmentId: string;
  currency: string;
  totalAmount: number;
  fundedAmount: number;
  releasedAmount: number;
  heldAmount: number;
  feesCollected: number;
  status: EscrowStatus;
  staged: boolean;
  milestones: MilestoneRelease[];
  disputes: Dispute[];
}

export interface InvoiceLine {
  milestone: MilestoneName;
  payeeDid: string;
  gross: number;
  fee: number;
  penalty: number;
  bonus: number;
  net: number;
  currency: string;
  triggerEventId?: string;
  at: string;
}

export interface Invoice {
  invoiceId: string;
  escrowId: string;
  glosShipmentId: string;
  currency: string;
  status: 'draft' | 'final';
  lines: InvoiceLine[];
  total: number;
  feesTotal: number;
  finalizedAt?: string;
  anchorTxId?: string;
}
