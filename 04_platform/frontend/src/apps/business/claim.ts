import type { MessageKey } from '../../shared/i18n';

/**
 * A PROBLEM WITH THE GOODS DELIVERED, from the business that sent them (FP3b, CL1). Found 2026-10-25 building the receiving
 * moment: a claim on a delivered load could be opened only by a shop at its counter; a business sending its own loads had
 * no way to. The rule is unchanged — the claim goes to whoever carries the risk on the road (the trade term; with none,
 * the sender), nothing of ours pays unless a company of ours stated cover, and otherwise the consignment note, frozen with
 * the claim on it, is the damage claim report to hand to the carrier or an insurer.
 */
export type ClaimKind = 'damaged' | 'short' | 'not_received';
export const CLAIM_KINDS: readonly ClaimKind[] = ['damaged', 'short', 'not_received'];

export interface LoadClaim {
  state: 'open' | 'resolved';
  kind: ClaimKind;
  description: string;
  raisedAt: string;
  decision?: 'upheld' | 'partly_upheld' | 'rejected' | 'report_only';
  note?: string;
  decidedAt?: string;
}

/** Where a load stands for a claim, from the sender's side — or null before it is delivered. */
export type ClaimStanding = { kind: 'made'; claim: LoadClaim } | { kind: 'receiver_claims' } | { kind: 'may_claim' } | { kind: 'window_closed' } | null;

export function claimStanding(row: { status: string; claim?: LoadClaim; claimant?: 'sender' | 'receiver'; canClaim?: boolean }): ClaimStanding {
  if (row.status !== 'delivered') return null;
  if (row.claim) return { kind: 'made', claim: row.claim };
  // The trade term passed the risk at the origin: the loss on the road is the receiver's to claim.
  if (row.claimant === 'receiver') return { kind: 'receiver_claims' };
  return row.canClaim ? { kind: 'may_claim' } : { kind: 'window_closed' };
}

export const CLAIM_KIND_KEYS: Record<ClaimKind, MessageKey> = {
  damaged: 'business.claim.kind.damaged',
  short: 'business.claim.kind.short',
  not_received: 'business.claim.kind.not_received',
};

/** What the claim says in one line: sent and waiting, the report made, or decided — with the message and its words. */
export function claimLine(claim: LoadClaim): { key: MessageKey; kind: ClaimKind } {
  if (claim.state === 'open') return { key: 'business.claim.line.open', kind: claim.kind };
  if (claim.decision === 'report_only') return { key: 'business.claim.line.report', kind: claim.kind };
  return { key: claim.decision === 'rejected' ? 'business.claim.line.rejected' : claim.decision === 'partly_upheld' ? 'business.claim.line.partly' : 'business.claim.line.upheld', kind: claim.kind };
}

/** Whether a claim can be sent as written: what was found, in a few words at least — the server asks the same. */
export function claimReady(form: { kind: ClaimKind | ''; text: string }): boolean {
  return CLAIM_KINDS.includes(form.kind as ClaimKind) && form.text.trim().length >= 3;
}
