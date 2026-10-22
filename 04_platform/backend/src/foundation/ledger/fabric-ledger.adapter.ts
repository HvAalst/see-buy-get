import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PersistentMap } from '../store/persistent-map';
import { ChainPoint, LedgerAdapter, LedgerAppendResult, LedgerCheck, NetworkInfo } from './ledger.types';

/** One anchor as it is kept: the hash's place in the chain, and the id of the one before it. */
interface LedgerEntry extends LedgerAppendResult {
  hash: string;
  /** The txId of the anchor before this one; '' for the first. */
  prev: string;
  at: string;
}

/**
 * Hyperledger Fabric ledger adapter (M2-050 choice). Presents Fabric semantics — a permissioned
 * channel + chaincode, 64-hex transaction ids, and increasing block heights — and the production
 * adapter submits the same hash to a real Fabric peer. Only the hash is ever committed (no
 * PII/commercial data on-chain) — §5.3 data minimization.
 *
 * EVIDENCE THAT LASTS (the user, 2026-10-18). The commit log was kept in memory, so every fingerprint on a scan, a
 * damage claim report or a consignment note stopped being checkable at the next restart, and the block heights began
 * again from one. It is kept in the store now, like every record the network must not lose, and CHAINED: each id is
 * taken over its height, its hash and the id before it, so an anchor changed, taken out or put in out of order breaks
 * every id after it — and `check()` says where.
 */
@Injectable()
export class FabricLedgerAdapter implements LedgerAdapter {
  private readonly channel = 'glos-shipments';
  private readonly chaincode = 'ewaybill';
  private readonly store = new PersistentMap<string, LedgerEntry>('ledger-anchors');
  private height = 0;
  private tip = '';

  constructor() {
    for (const e of this.store.values()) {
      if (e.blockHeight > this.height) {
        this.height = e.blockHeight;
        this.tip = e.txId;
      }
    }
  }

  append(hash: string): LedgerAppendResult {
    const existing = this.store.get(hash);
    if (existing) return { txId: existing.txId, blockHeight: existing.blockHeight };
    const blockHeight = this.height + 1;
    const prev = this.tip;
    const txId = this.idOf(blockHeight, hash, prev); // Fabric-style 64-hex tx id
    // Kept before it is answered: a fingerprint handed out is one that can be checked after any restart.
    this.store.set(hash, { hash, txId, blockHeight, prev, at: new Date().toISOString() });
    this.height = blockHeight;
    this.tip = txId;
    return { txId, blockHeight };
  }

  has(hash: string): boolean {
    return this.store.has(hash);
  }

  get(hash: string): LedgerAppendResult | undefined {
    const e = this.store.get(hash);
    return e ? { txId: e.txId, blockHeight: e.blockHeight } : undefined;
  }

  networkInfo(): NetworkInfo {
    return { network: 'hyperledger-fabric', channel: this.channel, chaincode: this.chaincode };
  }

  /** Every anchor, in order, its id worked out again from its hash and the one before: whole, or where it breaks. */
  check(): LedgerCheck {
    const entries = [...this.store.values()].sort((a, b) => a.blockHeight - b.blockHeight);
    let prev = '';
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const why =
        e.blockHeight !== i + 1 ? `block ${i + 1} is missing` : e.prev !== prev ? 'it does not follow the block before it' : e.txId !== this.idOf(e.blockHeight, e.hash, e.prev) ? 'its id does not match what it holds' : undefined;
      if (why) return { anchors: entries.length, whole: false, brokenAt: e.blockHeight, reason: why };
      prev = e.txId;
    }
    return { anchors: entries.length, whole: true, ...(entries.length ? { first: entries[0].at, last: entries[entries.length - 1].at } : {}) };
  }

  /** The newest anchor: the chain's head as it stands. */
  head(): ChainPoint | undefined {
    if (!this.height) return undefined;
    const e = [...this.store.values()].find((x) => x.blockHeight === this.height);
    return e ? { height: e.blockHeight, txId: e.txId, at: e.at } : undefined;
  }

  /** The id at `height` worked out again from every hash up to it — not read from the ids kept. Nothing where a height is missing. */
  recomputedAt(height: number): ChainPoint | undefined {
    if (!Number.isInteger(height) || height < 1) return undefined;
    const byHeight = new Map([...this.store.values()].map((e) => [e.blockHeight, e]));
    let prev = '';
    for (let h = 1; h <= height; h++) {
      const e = byHeight.get(h);
      if (!e) return undefined;
      prev = this.idOf(h, e.hash, prev);
      if (h === height) return { height, txId: prev, at: e.at };
    }
    return undefined;
  }

  private idOf(height: number, hash: string, prev: string): string {
    return createHash('sha256').update(`${this.channel}:${this.chaincode}:${height}:${hash}:${prev}`).digest('hex');
  }
}
