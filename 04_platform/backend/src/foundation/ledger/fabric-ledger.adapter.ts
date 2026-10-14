import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { LedgerAdapter, LedgerAppendResult, NetworkInfo } from './ledger.types';

/**
 * Hyperledger Fabric ledger adapter (M2-050 choice). Presents Fabric semantics — a permissioned
 * channel + chaincode, 64-hex transaction ids, and increasing block heights. The sandbox keeps
 * the commit log in memory; the production adapter submits the same hash to a real Fabric peer.
 * Only the hash is ever committed (no PII/commercial data on-chain) — §5.3 data minimization.
 */
@Injectable()
export class FabricLedgerAdapter implements LedgerAdapter {
  private readonly channel = 'glos-shipments';
  private readonly chaincode = 'ewaybill';
  private height = 0;
  private readonly store = new Map<string, LedgerAppendResult>();

  append(hash: string): LedgerAppendResult {
    const existing = this.store.get(hash);
    if (existing) return existing;
    this.height += 1;
    const txId = createHash('sha256').update(`${this.channel}:${this.chaincode}:${this.height}:${hash}`).digest('hex'); // Fabric-style 64-hex tx id
    const result: LedgerAppendResult = { txId, blockHeight: this.height };
    this.store.set(hash, result);
    return result;
  }

  has(hash: string): boolean {
    return this.store.has(hash);
  }

  get(hash: string): LedgerAppendResult | undefined {
    return this.store.get(hash);
  }

  networkInfo(): NetworkInfo {
    return { network: 'hyperledger-fabric', channel: this.channel, chaincode: this.chaincode };
  }
}
