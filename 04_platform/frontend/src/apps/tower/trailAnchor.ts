/**
 * Round 40 — THE TRAIL ANCHORED OUTSIDE OUR DATABASE (the user: "Daily to an auditor"), as the console reads it
 * (trail-anchor.service.ts): who receives the daily head, a change waiting for a second member of staff, the days kept, and an
 * auditor's copy checked against the chain.
 */
export interface DailyHeadRow {
  date: string;
  at: string;
  height: number;
  txId: string;
  whole: boolean;
  brokenAt?: number;
  to?: string;
  mailed: boolean;
  stillMatches: boolean;
}

export interface AnchorsView {
  auditor?: { address: string; setAt: string; proposedBy: string; approvedBy: string };
  proposal?: { address: string; at: string; by: string; mine: boolean };
  heads: DailyHeadRow[];
  nextAt: string;
  delivers: boolean;
}

export interface CopyCheckView {
  height: number;
  match: boolean;
  txId?: string;
  at?: string;
  why: string;
}

/** A fingerprint shortened for a table: the first ten and the last six, so two can still be told apart at a glance. */
export function shortTx(txId: string): string {
  return txId.length > 20 ? `${txId.slice(0, 10)}…${txId.slice(-6)}` : txId;
}

/** A copy can be checked once it is a whole link number and the 64 letters and digits, as the email shows them. */
export function copyReady(height: string, txId: string): boolean {
  return /^\d+$/.test(height.trim()) && Number(height) > 0 && /^[0-9a-fA-F]{64}$/.test(txId.trim());
}

/** Days the chain no longer gives the same link for: the ones worth a person's attention. */
export function daysNotMatching(view: AnchorsView | null): number {
  return (view?.heads ?? []).filter((h) => !h.stillMatches).length;
}
