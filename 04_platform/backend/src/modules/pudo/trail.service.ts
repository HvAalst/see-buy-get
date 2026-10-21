import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { ssccFromScan } from '../../foundation/gs1/gs1';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { createHash } from 'crypto';
import { AnchorBook } from './anchor-book.service';
import { BagClosureService, closureHashOf } from './bag-closure.service';
import { DamageReportService, fingerprintOf, unsignedNote } from './damage-report.service';
import { LoadSealService, sealWrittenOf } from './load-seal.service';
import { ParcelService } from './parcel.service';
import type { Parcel } from './pudo.types';
import { custodyAnchorOf, DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { NoteArchiveService } from './note-archive.service';
import { canonicalJson, noteAnchorOf, noteFingerprint } from './note-archive.types';
import { exceptionAnchorOf, exceptionHashOf, TamperService } from './tamper.service';
import { ShipperCodesService } from './shipper-codes.service';
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
    private readonly seals: LoadSealService,
    private readonly anchors: AnchorBook,
    private readonly parcels: ParcelService,
    private readonly reports: DamageReportService,
    // A package's SSCC, scanned off its label, names the load or the store parcel it was given to.
    private readonly codes: ShipperCodesService,
  ) {}

  /** A load by its code or id, a bag by its code, or a parcel by its number. */
  of(ref: string): TrailView {
    const key = ref.trim();
    // An SSCC as read off a label — with its spaces, or with the (00) in front that a GS1-128 scan carries.
    const sscc = ssccFromScan(key);
    const viaSscc = sscc ? this.codes.freightOfSscc(sscc) : undefined;
    const f = this.dispatch.freightByCode(key) ?? this.freightById(key) ?? (viaSscc ? this.freightById(viaSscc) : undefined);
    const chain = this.ledger.check();
    if (f) return { ref: f.code, kind: 'load', steps: byTime(this.ofLoad(f)), ...(chain ? { chain } : {}) };
    const tote = this.totes.byCodeMaybe(key.toUpperCase());
    if (tote) return { ref: tote.code, kind: 'bag', steps: byTime(this.ofBag(tote.toteId)), ...(chain ? { chain } : {}) };
    const storeParcel = sscc ? this.codes.parcelOfSscc(sscc) : undefined;
    const parcel = this.parcelById(key) ?? (storeParcel ? this.parcelById(storeParcel) : undefined);
    if (parcel) return { ref: parcel.parcelId, kind: 'parcel', steps: byTime(this.ofParcel(parcel)), ...(chain ? { chain } : {}) };
    throw new GlosError('NOT_FOUND', 'No load, bag, parcel or package has that code');
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
    // Its seals: written, read at pickup and at the door, broken or replaced on the road.
    for (const s of this.seals.of(f.freightId)) {
      steps.push({ kind: 'seal_written', at: s.writtenAt, detail: s.appliedBy, ...this.checked(this.anchors.txIdOf(`seal:${s.sealId}:written`), () => sealWrittenOf(s)) });
      s.readings.forEach((r, n) => {
        steps.push({ kind: 'seal_read', at: r.at, detail: `${r.stage} · ${r.result}`, ...this.checked(this.anchors.txIdOf(`seal:${s.sealId}:reading:${n}`), () => ({ s: s.sealId, n, reading: r })) });
      });
      if (s.broken) steps.push({ kind: 'seal_broken', at: s.broken.at, detail: s.broken.cause, ...this.checked(this.anchors.txIdOf(`seal:${s.sealId}:broken`), () => ({ s: s.sealId, broken: s.broken })) });
      if (s.replaced) steps.push({ kind: 'seal_replaced', at: s.replaced.at, ...this.checked(this.anchors.txIdOf(`seal:${s.sealId}:replaced`), () => ({ s: s.sealId, replaced: s.replaced })) });
    }
    return steps;
  }

  /**
   * A parcel: every scan after it was made (anchored as it was made, all along), and its damage claim report with each note
   * added. Not the making itself: its anchor is the creation receipt, taken over what it was booked with — a destination
   * shop that may change on arrival — so working it out again from the parcel would call a parcel altered that was not.
   */
  private ofParcel(p: Parcel): TrailStep[] {
    const steps: TrailStep[] = p.scans.filter((s) => s.status !== 'CREATED').map((s) => ({
      kind: 'scan' as const,
      at: s.at,
      detail: s.status,
      ...this.checked(s.anchorTxId, () => ({ p: p.parcelId, st: s.status, by: s.by, at: s.at, ...(s.receivedAt ? { receivedAt: s.receivedAt } : {}) })),
    }));
    const report = this.reports.keptFor(p.parcelId);
    if (report) {
      steps.push({ kind: 'damage_report', at: report.madeAt, ...this.checked(this.anchors.txIdOf(`damage:${p.parcelId}`), () => ({ p: p.parcelId, sha256: report.sha256 }), fingerprintOf(report.body) === report.sha256) });
      for (const n of report.notes ?? []) {
        const sha256 = createHash('sha256').update(canonicalJson(unsignedNote(n))).digest('hex');
        steps.push({ kind: 'damage_note', at: n.at, ...this.checked(this.anchors.txIdOf(`damage-note:${p.parcelId}:${n.noteId}`), () => ({ p: p.parcelId, n: n.noteId, sha256: n.sha256 }), sha256 === n.sha256) });
      }
    }
    for (const e of this.tamper.forUnit('parcel', p.parcelId)) {
      steps.push({ kind: 'exception', at: e.at, detail: e.finding, ...this.checked(e.anchorTxId, () => exceptionAnchorOf(e), exceptionHashOf(e) === e.hash) });
    }
    return steps;
  }

  private parcelById(id: string): Parcel | undefined {
    try {
      return this.parcels.get(id);
    } catch {
      return undefined;
    }
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

