import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { BagClosureService, closureHashOf } from './bag-closure.service';
import { custodyAnchorOf, DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { NoteArchiveService } from './note-archive.service';
import { noteAnchorOf, noteFingerprint } from './note-archive.types';
import { exceptionAnchorOf, exceptionHashOf, TamperService } from './tamper.service';
import { ToteService } from './tote.service';
import type { TrailState, TrailStep, TrailView } from './trail.types';

/** THE TRAIL (trail.types.ts): a load's or a bag's anchored steps, each worked out again and checked against the chain. */
@Injectable()
export class TrailService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly dispatch: DispatchService,
    private readonly archive: NoteArchiveService,
    private readonly tamper: TamperService,
    private readonly totes: ToteService,
    private readonly closures: BagClosureService,
  ) {}

  /** A load by its code or id, or a bag by its code. */
  of(ref: string): TrailView {
    const key = ref.trim();
    const f = this.dispatch.freightByCode(key) ?? this.freightById(key);
    const chain = this.ledger.check();
    if (f) return { ref: f.code, kind: 'load', steps: byTime(this.ofLoad(f)), ...(chain ? { chain } : {}) };
    const tote = this.totes.byCodeMaybe(key.toUpperCase());
    if (tote) return { ref: tote.code, kind: 'bag', steps: byTime(this.ofBag(tote.toteId)), ...(chain ? { chain } : {}) };
    throw new GlosError('NOT_FOUND', 'No load or bag has that code');
  }

  private ofLoad(f: Freight): TrailStep[] {
    const steps: TrailStep[] = [];
    for (const step of ['picked_up', 'delivered'] as const) {
      const at = step === 'picked_up' ? f.pickedUpAt : f.deliveredAt;
      if (!at) continue;
      const anchor = f.custodyAnchors?.find((a) => a.step === step);
      steps.push({ kind: step, at, ...this.checked(anchor?.txId, () => custodyAnchorOf(f, step)) });
    }
    for (const v of this.archive.versionsOfFreight(f.freightId)) {
      // The copy as kept, fingerprinted again: a word of it changed and it is not the copy that was anchored.
      const sha256 = noteFingerprint(v.note);
      steps.push({ kind: 'note', at: v.at, detail: v.stage, ...this.checked(v.anchorTxId, () => noteAnchorOf(v.note.number, { seq: v.seq, stage: v.stage, sha256, at: v.at }), sha256 === v.sha256) });
    }
    for (const e of this.tamper.forUnit('load', f.freightId)) {
      steps.push({ kind: 'exception', at: e.at, detail: e.finding, ...this.checked(e.anchorTxId, () => exceptionAnchorOf(e), exceptionHashOf(e) === e.hash) });
    }
    return steps;
  }

  private ofBag(toteId: string): TrailStep[] {
    const steps: TrailStep[] = [];
    for (const c of this.closures.forStaff(toteId)) {
      steps.push({ kind: 'bag_closed', at: c.closedAt, detail: c.kind, ...this.checked(c.closedTxId, () => ({ c: c.closureId, h: c.hash }), closureHashOf(c) === c.hash) });
      if (c.taken) steps.push({ kind: 'bag_taken', at: c.taken.at, ...this.checked(c.takenTxId, () => ({ c: c.closureId, taken: c.taken })) });
      if (c.receipt) steps.push({ kind: 'bag_received', at: c.receipt.at, ...this.checked(c.receiptTxId, () => ({ c: c.closureId, receipt: c.receipt })) });
    }
    for (const e of this.tamper.forUnit('bag', toteId)) {
      steps.push({ kind: 'exception', at: e.at, detail: e.finding, ...this.checked(e.anchorTxId, () => exceptionAnchorOf(e), exceptionHashOf(e) === e.hash) });
    }
    return steps;
  }

  /** Anchored or not; and anchored, whether the record as it stands is what the chain holds. */
  private checked(txId: string | undefined, payload: () => unknown, selfConsistent = true): { state: TrailState; txId?: string } {
    if (!txId) return { state: 'not_anchored' };
    return { state: selfConsistent && this.ledger.verify(payload(), txId) ? 'intact' : 'altered', txId };
  }

  private freightById(id: string): Freight | undefined {
    try {
      return this.dispatch.requireFreightPublic(id);
    } catch {
      return undefined;
    }
  }
}

function byTime(steps: TrailStep[]): TrailStep[] {
  return [...steps].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
