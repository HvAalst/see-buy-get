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

export interface LedgerAdapter {
  /** Append a hash to the ledger, returning its tx id + block height. */
  append(hash: string): LedgerAppendResult;
  /** Whether a hash has been anchored. */
  has(hash: string): boolean;
  /** Look up the append result for a hash (for verification). */
  get(hash: string): LedgerAppendResult | undefined;
  /** Optional: describe the underlying permissioned network. */
  networkInfo?(): NetworkInfo;
}

export const LEDGER_ADAPTER = 'LEDGER_ADAPTER';
