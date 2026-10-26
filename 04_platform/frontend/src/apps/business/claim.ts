import type { MessageKey } from '../../shared/i18n';

/**
 * A PROBLEM WITH THE GOODS DELIVERED (FP3b, CL1), from either side of a load: the business that sent it (its Loads), or
 * the business it was sent to at one of its receiving points (its Coming in; the user, 2026-10-26: "Its copy, no
 * carriage price"). The rule is the one the counter and the server keep: whoever carries the risk on the road claims —
 * the trade term says who, and with none it is the sender; nothing of ours pays unless a company of ours stated cover,
 * and otherwise the claimant's copy of the note, frozen with the claim on it, is the damage claim report.
 */
export type ClaimKind = 'damaged' | 'short' | 'not_received';
export const CLAIM_KINDS: readonly ClaimKind[] = ['damaged', 'short', 'not_received'];

export interface LoadClaim {
  state: 'open' | 'resolved';
  kind: ClaimKind;
  description?: string;
  raisedAt: string;
  decision?: 'upheld' | 'partly_upheld' | 'rejected' | 'report_only';
  note?: string;
  decidedAt?: string;
  /** On a load coming in: whether its supplier or the receiver made it. */
  by?: 'sender' | 'receiver';
}

/** Which side of the load the business reading it is on. */
export type ClaimSide = 'sender' | 'receiver';

/** Where a load stands for a claim, from this side — or null before it is delivered. */
export type ClaimStanding = { kind: 'made'; claim: LoadClaim } | { kind: 'receiver_claims' } | { kind: 'sender_claims' } | { kind: 'may_claim' } | { kind: 'window_closed' } | null;

export function claimStanding(row: { status: string; claim?: LoadClaim; claimant?: 'sender' | 'receiver'; canClaim?: boolean }, side: ClaimSide = 'sender'): ClaimStanding {
  if (row.status !== 'delivered') return null;
  if (row.claim) return { kind: 'made', claim: row.claim };
  // The loss on the road is the other side's: they claim, not this one.
  if (side === 'sender' && row.claimant === 'receiver') return { kind: 'receiver_claims' };
  if (side === 'receiver' && row.claimant !== 'receiver') return { kind: 'sender_claims' };
  return row.canClaim ? { kind: 'may_claim' } : { kind: 'window_closed' };
}

export const CLAIM_KIND_KEYS: Record<ClaimKind, MessageKey> = {
  damaged: 'business.claim.kind.damaged',
  short: 'business.claim.kind.short',
  not_received: 'business.claim.kind.not_received',
};

/** What the claim says in one line: sent and waiting, the report made, decided — or, read by the receiver, its supplier's. */
export function claimLine(claim: LoadClaim, side: ClaimSide = 'sender'): { key: MessageKey; kind: ClaimKind } {
  if (side === 'receiver' && claim.by === 'sender') return { key: 'business.claim.line.supplier', kind: claim.kind };
  if (side === 'sender' && claim.by === 'receiver') return { key: 'business.claim.line.receiver', kind: claim.kind };
  if (claim.state === 'open') return { key: 'business.claim.line.open', kind: claim.kind };
  if (claim.decision === 'report_only') return { key: 'business.claim.line.report', kind: claim.kind };
  return { key: claim.decision === 'rejected' ? 'business.claim.line.rejected' : claim.decision === 'partly_upheld' ? 'business.claim.line.partly' : 'business.claim.line.upheld', kind: claim.kind };
}

/** Whether a claim can be sent as written: what was found, in a few words at least — the server asks the same. */
export function claimReady(form: { kind: ClaimKind | ''; text: string }): boolean {
  return CLAIM_KINDS.includes(form.kind as ClaimKind) && form.text.trim().length >= 3;
}
