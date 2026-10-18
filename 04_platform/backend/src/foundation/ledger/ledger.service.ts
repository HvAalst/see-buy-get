import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AnchorReceipt, LedgerAdapter, LedgerCheck, LEDGER_ADAPTER, NetworkInfo } from './ledger.types';

/**
 * LedgerService — the shared anchoring primitive (T-004).
 * Anchors only a SHA-256 hash of a payload (no PII, no commercial values on-chain —
 * §5.3 blockchain data minimization). Consumed by M2 (genesis + amendments) and the
 * DID registry; later by M4 event anchoring.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(LEDGER_ADAPTER) private readonly adapter: LedgerAdapter) {}

  /** Deterministic hash of a payload (keys sorted recursively so equal data → equal hash). */
  hash(payload: unknown): string {
    return createHash('sha256').update(LedgerService.canonicalize(payload)).digest('hex');
  }

  /** Hash + commit to the ledger, returning a receipt. */
  anchor(payload: unknown): AnchorReceipt {
    const hash = this.hash(payload);
    const { txId, blockHeight } = this.adapter.append(hash);
    return { hash, txId, blockHeight, anchoredAt: new Date().toISOString() };
  }

  /** Describe the underlying permissioned network (e.g. Hyperledger Fabric). */
  networkInfo(): NetworkInfo {
    return this.adapter.networkInfo?.() ?? { network: 'in-memory' };
  }

  /** Every anchor walked: whole, or where the chain breaks. An adapter that keeps nothing has nothing to say. */
  check(): LedgerCheck | undefined {
    return this.adapter.check?.();
  }

  /** Verify a payload is anchored; if a txId is supplied it must match. */
  verify(payload: unknown, txId?: string): boolean {
    const hash = this.hash(payload);
    const record = this.adapter.get(hash);
    if (!record) return false;
    return txId ? record.txId === txId : true;
  }

  private static canonicalize(value: unknown): string {
    const normalize = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(normalize);
      if (v && typeof v === 'object') {
        return Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = normalize((v as Record<string, unknown>)[key]);
            return acc;
          }, {});
      }
      return v;
    };
    return JSON.stringify(normalize(value));
  }
}
