import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
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
      const closure: BagClosure = { ...unsigned, hash: createHash('sha256').update(canonicalJson(unsigned)).digest('hex') };
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
   */
  checkReceipt(tote: Tote, by: BagParty, ownerDid: string, input: { sealNumber?: string; photoRef?: string; asClosed?: boolean } | undefined): (step: Step) => void {
    const closure = this.current(tote);
    if (!closure) throw new GlosError('INVALID_STATE', `Bag ${tote.code} left without being closed: report it, and tell SeeBuyGet operations`);
    const link = { type: 'bag' as const, id: closure.closureId };
    if (!input?.photoRef) throw new GlosError('FIELD_REQUIRED', 'Photograph the bag as it arrived, its seal in view, before you open it', { field: 'receipt.photoRef' });
    this.media.requireHeld(input.photoRef, ownerDid, link, 'receipt.photoRef');
    const reported = this.tamper?.reportedSince(tote.toteId, closure.closedAt) ?? false;
    const numberRead = sealNumber(input.sealNumber);
    if (closure.kind === 'seal' && !reported) {
      if (!numberRead) throw new GlosError('FIELD_REQUIRED', `Read the number on bag ${tote.code}’s seal off the seal itself, as printed`, { field: 'receipt.sealNumber' });
      if (keyOf(numberRead) !== closure.key) {
        throw new GlosError('SEAL_MISMATCH', `The seal on bag ${tote.code} is not the one it was closed with. Read it again — still not the same? Report it: the bag is held and operations told before anybody opens it.`, { field: 'receipt.sealNumber' });
      }
    }
    if (input.asClosed === undefined && !reported) throw new GlosError('FIELD_REQUIRED', 'Say whether the bag is as it was closed: no cut, no broken seal', { field: 'receipt.asClosed' });
    if (input.asClosed === false && !reported) {
      throw new GlosError('TAMPER_REPORT_FIRST', 'The bag is not as it was closed: report it first, with a photograph. Operations is told before anybody opens it.', { field: 'receipt.asClosed' });
    }
    const photoRef = input.photoRef;
    return (step) => {
      this.closures.set(closure.closureId, {
        ...closure,
        receipt: {
          at: step.at,
          ...(step.receivedAt ? { receivedAt: step.receivedAt } : {}),
          by,
          photoRef,
          ...(numberRead ? { numberRead } : {}),
          asClosed: !reported,
          ...(reported ? { asFound: true } : {}),
        },
      });
      this.media.adopt(photoRef, ownerDid, link, 'seal');
      this.media.anchorBagTerminal(closure.closureId);
    };
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

/** A seal number as printed: trimmed, single spaces, at most so long; absent when there is none. */
function sealNumber(raw: string | undefined): string | undefined {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, MAX_BAG_SEAL) : undefined;
}
