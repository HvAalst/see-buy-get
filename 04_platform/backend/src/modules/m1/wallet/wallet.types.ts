// Embedded wallet domain (UDIW-040/043/044). Operational, keyed by DID.

export type CurrencyCode = string;

/** Settlement trigger config (UDIW-043) — consumed later by SSE to shape escrow release. */
export type SettlementTrigger =
  | { type: 'instant' }
  | { type: 'time_locked'; stages: Array<{ milestone: string; percent: number }> }
  | { type: 'condition_locked'; condition: { kind: string; params?: Record<string, unknown> } };

export interface Wallet {
  walletId: string;
  did: string;
  balances: Record<CurrencyCode, number>;
  settlementCurrency: CurrencyCode;
  settlementTrigger: SettlementTrigger;
  corporate: boolean;
  bankLinked: boolean;
  createdAt: string;
}

export interface BankLinkChallenge {
  challengeId: string;
  /** Two micro-deposit amounts the user confirms (revealed here for the sandbox only). */
  amounts: [number, number];
}

export interface PayoutRecord {
  payoutId: string;
  did: string;
  amount: number;
  currency: CurrencyCode;
  destination: string;
  status: 'completed';
  at: string;
}

export interface WalletSummary {
  walletId: string;
  did: string;
  balances: Record<CurrencyCode, number>;
  settlementCurrency: CurrencyCode;
  settlementTrigger: SettlementTrigger;
  corporate: boolean;
  bankLinked: boolean;
}
