import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { type BagClosure, type BagClosureKind, type BagParty, MAX_BAG_SEAL } from './bag-closure.types';
import { keyOf } from './load-seal.service';
import { MediaService } from './media.service';
import { canonicalJson } from './note-archive.types';
import type { Step } from './observed-at';
import type { Tote } from './pudo.types';
import { ToteService } from './tote.service';

/** What the tamper protocol answers for a bag's receipt: whether it was reported since the bag was closed. */
export interface BagTamperHooks {
  reportedSince(toteId: string, since: string): boolean;
}

/**
 * A BAG CLOSED ON OUR OWN SEAL, AND RECEIVED BY IT (bag-closure.types.ts). Each act is checked whole before anything is
 * kept; what to keep is handed back, to be done once the act it belongs to has been written.
 */
@Injectable()
export class BagClosureService {
  private readonly closures = new PersistentMap<string, BagClosure>('pudo-bag-closures');
  private tamper?: BagTamperHooks;

  constructor(
    private readonly media: MediaService,
    private readonly totes: ToteService,
    // The trail: each closing, take and receipt anchored as it is kept. Optional for the specs.
    @Optional() private readonly ledger?: LedgerService,
  ) {}

  /** Registered rather than injected: the tamper protocol reads bags. */
  registerTamper(hooks: BagTamperHooks): void {
    this.tamper = hooks;
  }

  /** The closing a bag carries now; none once it has been received and emptied. */
  current(tote: Tote): BagClosure | undefined {
    return tote.closureId ? this.closures.get(tote.closureId) : undefined;
  }

  /**
   * CLOSING A BAG: the number on its coded seal and a photograph of it closed, or the photograph alone. A seal number on
   * another bag still travelling is refused: one coded seal closes one bag.
   */
  checkClose(tote: Tote, by: BagParty, ownerDid: string, input: { seal?: string; photoRef?: string } | undefined): (step: Step) => BagClosure {
    if (tote.closureId) throw new GlosError('INVALID_STATE', `Bag ${tote.code} is closed already`);
    if (!tote.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${tote.code} is empty`);
    if (!input || !input.photoRef) {
      throw new GlosError('FIELD_REQUIRED', 'Close the bag: put a coded seal on it, type its number and photograph the bag with the seal in view — or, without a seal, photograph the bag closed', { field: 'closure' });
    }
    const number = sealNumber(input.seal);
    if (number && this.travelling(keyOf(number))) {
      throw new GlosError('VALIDATION_FAILED', `Seal ${number} closes another bag still on its way: a coded seal is used once`, { field: 'closure.seal' });
    }
    const closureId = `bcl_${randomBytes(8).toString('hex')}`;
    const link = { type: 'bag' as const, id: closureId };
    this.media.requireHeld(input.photoRef, ownerDid, link, 'closure.photoRef');
    const photoRef = input.photoRef;
    return (step) => {
      const kind: BagClosureKind = number ? 'seal' : 'photo';
      const unsigned = {
        closureId,
        toteId: tote.toteId,
        code: tote.code,
        kind,
        ...(number ? { number, key: keyOf(number) } : {}),
        photoRef,
        parcels: [...tote.parcels],
        closedAt: step.at,
        ...(step.receivedAt ? { closedReceivedAt: step.receivedAt } : {}),
        closedBy: by,
      };
      const hash = createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
      const closedTxId = this.ledger?.anchor({ c: closureId, h: hash }).txId;
      const closure: BagClosure = { ...unsigned, hash, ...(closedTxId ? { closedTxId } : {}) };
      this.closures.set(closureId, closure);
      this.media.adopt(photoRef, ownerDid, link, 'seal');
      this.totes.markClosed(tote.code, kind, closureId);
      return closure;
    };
  }

  /**
   * RECEIVING A BAG, before it is opened: a photograph of it as it arrived and — on a sealed bag — the number read off
   * the seal, never shown first. Not the number it was closed with, or not as it was closed, and it is reported first
   * (the tamper protocol); once operations has released a report made since the bag was closed, it is received as found.
   * Round 37 — a bag a driver carried is received only once that driver has read its seal (checkTake).
   */
  checkReceipt(tote: Tote, by: BagParty, ownerDid: string, input: BagReadingInput | undefined): (step: Step) => void {
    const closure = this.current(tote);
    if (!closure) throw new GlosError('INVALID_STATE', `Bag ${tote.code} left without being closed: report it, and tell SeeBuyGet operations`);
    const reportedSoFar = this.tamper?.reportedSince(tote.toteId, closure.closedAt) ?? false;
    if (tote.carriedBy && !closure.taken && !reportedSoFar) {
      throw new GlosError('BAG_NOT_TAKEN', `The driver has not read bag ${tote.code}’s seal yet: they read it in their app, under My loads, before handing it over. Read with no signal? Their phone sends it once it has signal`);
    }
    const { photoRef, numberRead, reported, link } = this.read(tote, closure, ownerDid, input, 'receipt');
    return (step) => {
      const receipt = { at: step.at, ...(step.receivedAt ? { receivedAt: step.receivedAt } : {}), by, photoRef, ...(numberRead ? { numberRead } : {}), asClosed: !reported, ...(reported ? { asFound: true } : {}) };
      const receiptTxId = this.ledger?.anchor({ c: closure.closureId, receipt }).txId;
      this.closures.set(closure.closureId, { ...closure, receipt, ...(receiptTxId ? { receiptTxId } : {}) });
      this.media.adopt(photoRef, ownerDid, link, 'seal');
      this.media.anchorBagTerminal(closure.closureId);
    };
  }

  /**
   * Round 37 — A DRIVER TAKES A BAG ON ITS SEAL (the user: "A driver takes a bag on its seal"): the number read off the
   * seal — never shown first — a photograph of the bag as taken, and whether it is as it was closed. When the driver loads
   * it from their own app it is part of the load; when a hub scans the driver's pass, the driver reads it afterwards, and
   * the bag is received nowhere until they have. The same reading by the same driver again (a phone sending what it kept
   * with no signal) is the one already made.
   */
  checkTake(tote: Tote, by: BagParty, driverDid: string, input: BagReadingInput | undefined): (step: Step) => void {
    const closure = this.current(tote);
    if (!closure) throw new GlosError('BAG_NOT_CLOSED', `Bag ${tote.code} is not closed: the shop or hub closes it before you take it`);
    if (closure.taken?.by.did === driverDid) return () => undefined;
    const { photoRef, numberRead, reported, link } = this.read(tote, closure, driverDid, input, 'take');
    return (step) => {
      const taken = { at: step.at, ...(step.receivedAt ? { receivedAt: step.receivedAt } : {}), by, photoRef, ...(numberRead ? { numberRead } : {}), asClosed: !reported, ...(reported ? { asFound: true } : {}) };
      const takenTxId = this.ledger?.anchor({ c: closure.closureId, taken }).txId;
      this.closures.set(closure.closureId, { ...closure, taken, ...(takenTxId ? { takenTxId } : {}) });
      this.media.adopt(photoRef, driverDid, link, 'seal');
    };
  }

  /**
   * A READING OF A BAG before it changes hands — at its receipt, or by the driver taking it: a photograph, the reader's
   * own; on a sealed bag the number off the seal, which must be the one it was closed with; and as it was closed. Unless
   * a report was made since it was closed, which operations has released: then it changes hands as found.
   */
  private read(tote: Tote, closure: BagClosure, ownerDid: string, input: BagReadingInput | undefined, field: 'receipt' | 'take') {
    const link = { type: 'bag' as const, id: closure.closureId };
    const words = WORDS[field];
    if (!input?.photoRef) throw new GlosError('FIELD_REQUIRED', words.photo, { field: `${field}.photoRef` });
    this.media.requireHeld(input.photoRef, ownerDid, link, `${field}.photoRef`);
    const reported = this.tamper?.reportedSince(tote.toteId, closure.closedAt) ?? false;
    const numberRead = sealNumber(input.sealNumber);
    if (closure.kind === 'seal' && !reported) {
      if (!numberRead) throw new GlosError('FIELD_REQUIRED', `Read the number on bag ${tote.code}’s seal off the seal itself, as printed`, { field: `${field}.sealNumber` });
      if (keyOf(numberRead) !== closure.key) {
        throw new GlosError('SEAL_MISMATCH', `The seal on bag ${tote.code} is not the one it was closed with. Read it again — still not the same? Report it: ${words.mismatch}`, { field: `${field}.sealNumber` });
      }
    }
    if (input.asClosed === undefined && !reported) throw new GlosError('FIELD_REQUIRED', 'Say whether the bag is as it was closed: no cut, no broken seal', { field: `${field}.asClosed` });
    if (input.asClosed === false && !reported) {
      throw new GlosError('TAMPER_REPORT_FIRST', `The bag is not as it was closed: report it first, with a photograph. ${words.notAsClosed}`, { field: `${field}.asClosed` });
    }
    return { photoRef: input.photoRef, numberRead, reported, link };
  }

  /** The tamper protocol: a seal said not to be the one the bag was closed with — refused when it is. */
  notAsClosed(tote: Tote, raw: string | undefined): { numberRead: string } {
    const closure = this.current(tote);
    if (!closure || closure.kind !== 'seal') throw new GlosError('INVALID_STATE', `Bag ${tote.code} was not closed with a coded seal: report the bag cut or opened`, { field: 'finding' });
    const numberRead = sealNumber(raw);
    if (!numberRead) throw new GlosError('FIELD_REQUIRED', 'Write the number on the seal as you read it', { field: 'numberRead' });
    if (keyOf(numberRead) === closure.key) throw new GlosError('VALIDATION_FAILED', 'That is the number it was closed with: this seal is as it was', { field: 'numberRead' });
    return { numberRead };
  }

  /** Staff: a bag's closings, newest first — what it was closed with, by whom, and how it was received. */
  forStaff(toteId: string): BagClosure[] {
    return [...this.closures.values()].filter((c) => c.toteId === toteId).sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1));
  }

  private travelling(key: string): boolean {
    return [...this.closures.values()].some((c) => c.key === key && !c.receipt);
  }
}

/** A closing's fingerprint worked out again from what is kept: what was closed, never what came after it. */
export function closureHashOf(c: BagClosure): string {
  const { hash: _h, taken: _t, receipt: _r, closedTxId: _c, takenTxId: _tt, receiptTxId: _rt, ...unsigned } = c;
  void [_h, _t, _r, _c, _tt, _rt];
  return createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

/** How each reading says what it asks for and what follows. */
const WORDS = {
  receipt: { photo: 'Photograph the bag as it arrived, its seal in view, before you open it', mismatch: 'the bag is held and operations told before anybody opens it.', notAsClosed: 'Operations is told before anybody opens it.' },
  take: { photo: 'Photograph the bag as you take it, its seal in view', mismatch: 'the bag is held, and does not leave until operations releases it.', notAsClosed: 'Operations is told before you take it.' },
} as const;

export interface BagReadingInput {
  sealNumber?: string;
  photoRef?: string;
  asClosed?: boolean;
}

/** A seal number as printed: trimmed, single spaces, at most so long; absent when there is none. */
function sealNumber(raw: string | undefined): string | undefined {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, MAX_BAG_SEAL) : undefined;
}
