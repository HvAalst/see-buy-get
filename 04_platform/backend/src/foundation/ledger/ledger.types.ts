// Permissioned-ledger anchoring contracts (T-004).
// The sandbox ships an in-memory adapter; a real Hyperledger Fabric / Polygon Edge
// adapter implements the same LedgerAdapter interface and swaps in with no caller changes.

export interface AnchorReceipt {
  /** SHA-256 hash of the canonicalized payload (only the hash is ever put on-chain). */
  hash: string;
  /** Ledger transaction id. */
  txId: string;
  /** Block height the transaction landed in. */
  blockHeight: number;
  /** ISO timestamp the anchor was confirmed. */
  anchoredAt: string;
}

export interface LedgerAppendResult {
  txId: string;
  blockHeight: number;
}

export interface NetworkInfo {
  network: string;
  channel?: string;
  chaincode?: string;
}

/** What a walk over every anchor found: whole, or the first block where the chain breaks and why. */
export interface LedgerCheck {
  anchors: number;
  whole: boolean;
  brokenAt?: number;
  reason?: string;
  first?: string;
  last?: string;
}

export interface LedgerAdapter {
  /** Append a hash to the ledger, returning its tx id + block height. */
  append(hash: string): LedgerAppendResult;
  /** Whether a hash has been anchored. */
  has(hash: string): boolean;
  /** Look up the append result for a hash (for verification). */
  get(hash: string): LedgerAppendResult | undefined;
  /** Optional: describe the underlying permissioned network. */
  networkInfo?(): NetworkInfo;
  /** Optional: walk every anchor and say whether the chain is whole (an adapter that keeps its anchors). */
  check?(): LedgerCheck;
  /** Optional: the newest anchor — the chain's head as it stands. Nothing while the chain is empty. */
  head?(): ChainPoint | undefined;
  /**
   * Optional: the id at `height` WORKED OUT AGAIN from every hash up to it, ignoring the ids kept beside them — what a copy
   * held outside (an auditor's) is checked against. Anything changed at or below that height gives another id.
   */
  recomputedAt?(height: number): ChainPoint | undefined;
}

/** One place in the chain: its height, its id, and when it was anchored. */
export interface ChainPoint {
  height: number;
  txId: string;
  at: string;
}

export const LEDGER_ADAPTER = 'LEDGER_ADAPTER';
