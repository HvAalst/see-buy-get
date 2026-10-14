import { Injectable } from '@nestjs/common';
import { LedgerAdapter, LedgerAppendResult } from './ledger.types';

/**
 * In-memory permissioned-ledger adapter for the sandbox. Deterministic, append-only,
 * good enough to exercise M2 anchoring (M2-050/051) and the DID registry (T-005) end-to-end.
 * Replace with a Fabric/Polygon adapter in production — the interface stays identical.
 */
@Injectable()
export class InMemoryLedgerAdapter implements LedgerAdapter {
  private height = 0;
  private readonly store = new Map<string, LedgerAppendResult>();

  append(hash: string): LedgerAppendResult {
    const existing = this.store.get(hash);
    if (existing) return existing;
    this.height += 1;
    const result: LedgerAppendResult = {
      txId: `glostx_${this.height.toString(16).padStart(8, '0')}_${hash.slice(0, 12)}`,
      blockHeight: this.height,
    };
    this.store.set(hash, result);
    return result;
  }

  has(hash: string): boolean {
    return this.store.has(hash);
  }

  get(hash: string): LedgerAppendResult | undefined {
    return this.store.get(hash);
  }
}
