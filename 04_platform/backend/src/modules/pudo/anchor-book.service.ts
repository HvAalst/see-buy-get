import { Injectable } from '@nestjs/common';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { PersistentMap } from '../../foundation/store/persistent-map';

/**
 * THE TRAIL'S ANCHOR BOOK (trail.types.ts): where a step was anchored, kept BESIDE the record rather than on it — for the
 * records whose own bytes are fingerprinted (a damage claim report and its notes), and for those that grow (a seal, read
 * at pickup, broken on the road, read again at the door). Keyed by what was anchored: `seal:<id>:written`,
 * `seal:<id>:reading:<n>`, `damage:<parcel>`, `damage-note:<parcel>:<note>`.
 */
@Injectable()
export class AnchorBook {
  private readonly book = new PersistentMap<string, { txId: string; at: string }>('trail-anchors');

  constructor(private readonly ledger: LedgerService) {}

  /** Anchor what a step said, once: anchored already under this key, it is the anchor already made. */
  anchor(key: string, payload: unknown, now: number = Date.now()): string {
    const kept = this.book.get(key);
    if (kept) return kept.txId;
    const { txId } = this.ledger.anchor(payload);
    this.book.set(key, { txId, at: new Date(now).toISOString() });
    return txId;
  }

  txIdOf(key: string): string | undefined {
    return this.book.get(key)?.txId;
  }
}
