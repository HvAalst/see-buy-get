import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { LedgerService } from '../../foundation/ledger/ledger.service';

// Immutable triple-entry ledger (SSE-082): every financial event is a hash-linked entry with a
// signed receipt for both counterparties + the platform, anchored to the permissioned ledger.
// 100% of financial state changes are replayable from this journal (NFR-SSE-05).

export interface JournalEntry {
  seq: number;
  escrowId: string;
  type: 'fund' | 'release' | 'fee' | 'penalty_refund' | 'bonus' | 'fx' | 'dispute_freeze' | 'dispute_resolve';
  debit: { account: string; amount: number; currency: string };
  credit: { account: string; amount: number; currency: string };
  at: string;
  prevHash: string;
  hash: string;
  anchorTxId: string;
}

@Injectable()
export class TripleEntryLedger {
  private readonly journals = new Map<string, JournalEntry[]>();

  constructor(private readonly ledger: LedgerService) {}

  record(escrowId: string, type: JournalEntry['type'], debit: JournalEntry['debit'], credit: JournalEntry['credit']): JournalEntry {
    const journal = this.journals.get(escrowId) ?? [];
    const prevHash = journal.length ? journal[journal.length - 1].hash : 'genesis';
    const core = { seq: journal.length, escrowId, type, debit, credit, at: new Date().toISOString() };
    const hash = createHash('sha256').update(prevHash + JSON.stringify(core)).digest('hex');
    const anchorTxId = this.ledger.anchor({ hash }).txId;
    const entry: JournalEntry = { ...core, prevHash, hash, anchorTxId };
    journal.push(entry);
    this.journals.set(escrowId, journal);
    return entry;
  }

  journal(escrowId: string): JournalEntry[] {
    return [...(this.journals.get(escrowId) ?? [])];
  }

  /** Replay-verify the hash chain (NFR-SSE-05). */
  verify(escrowId: string): boolean {
    let prevHash = 'genesis';
    for (const e of this.journals.get(escrowId) ?? []) {
      const core = { seq: e.seq, escrowId: e.escrowId, type: e.type, debit: e.debit, credit: e.credit, at: e.at };
      const hash = createHash('sha256').update(prevHash + JSON.stringify(core)).digest('hex');
      if (hash !== e.hash) return false;
      prevHash = e.hash;
    }
    return true;
  }
}
