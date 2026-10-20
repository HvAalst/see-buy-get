/*
 * ROUND 36 — A BAG CLOSED ON OUR OWN SEAL, AND RECEIVED BY IT (backend bag-closure.types.ts). A bag leaves closed with a
 * coded security seal — its printed number typed, the bag photographed with the seal in view — or, without a seal,
 * photographed closed. Whoever receives it photographs it as it arrived and, on a sealed bag, reads the number off the
 * seal: it is never shown, so the reading is worth something. Not as it was closed, and it is reported first.
 */

export type BagClosedWith = 'seal' | 'photo';

export interface BagCloseForm {
  kind: BagClosedWith;
  seal: string;
  photoRef: string;
}

/** The coded seal is what we suggest, so it is what the form starts on. */
export const EMPTY_BAG_CLOSE: BagCloseForm = { kind: 'seal', seal: '', photoRef: '' };

/** Ready to send: a photograph, and on a sealed bag its number. */
export function closeReady(f: BagCloseForm): boolean {
  return Boolean(f.photoRef) && (f.kind === 'photo' || f.seal.trim().length > 0);
}

/** What the server is sent: the seal's number only when there is one. */
export function closureBody(f: BagCloseForm): { seal?: string; photoRef: string } {
  return { ...(f.kind === 'seal' && f.seal.trim() ? { seal: f.seal.trim() } : {}), photoRef: f.photoRef };
}

export interface BagReceiptForm {
  sealNumber: string;
  photoRef: string;
  /** As it was closed (true), not (false), not said yet (null). */
  asClosed: boolean | null;
}

export const EMPTY_BAG_RECEIPT: BagReceiptForm = { sealNumber: '', photoRef: '', asClosed: null };

/**
 * Ready to send: a photograph, and whether it is as it was closed — and on a sealed bag said to be as closed, the number
 * read off it. Not as closed goes to the server too: it answers "report it first", or — once operations has released a
 * report — takes the bag as found.
 */
export function receiptReady(f: BagReceiptForm, closedWith: BagClosedWith | undefined): boolean {
  if (!f.photoRef || f.asClosed === null) return false;
  return !(f.asClosed && closedWith === 'seal' && !f.sealNumber.trim());
}

/**
 * Round 37 — a driver taking a bag: ready as a receipt is, and not while the number typed — checked on the phone against
 * how the bag was closed — is not the one it was closed with and the bag is said to be as closed (`match` false).
 */
export function takeReady(f: BagReceiptForm, closedWith: BagClosedWith | undefined, match: boolean | null): boolean {
  return receiptReady(f, closedWith) && !(f.asClosed === true && match === false);
}

export function receiptBody(f: BagReceiptForm): { sealNumber?: string; photoRef: string; asClosed: boolean } {
  return { ...(f.sealNumber.trim() ? { sealNumber: f.sealNumber.trim() } : {}), photoRef: f.photoRef, asClosed: f.asClosed === true };
}

/** What a shop or hub reports of a bag. */
export type BagFinding = 'seal_not_as_written' | 'seal_broken' | 'wrap_cut';

export interface BagReportForm {
  finding: BagFinding | null;
  numberRead: string;
  photoRef: string;
  note: string;
}

export function reportReady(f: BagReportForm): boolean {
  return Boolean(f.finding) && Boolean(f.photoRef) && (f.finding !== 'seal_not_as_written' || f.numberRead.trim().length > 0);
}

export function reportBody(f: BagReportForm): { finding: BagFinding; numberRead?: string; photoRefs: string[]; note?: string } {
  return {
    finding: f.finding as BagFinding,
    ...(f.finding === 'seal_not_as_written' && f.numberRead.trim() ? { numberRead: f.numberRead.trim() } : {}),
    photoRefs: [f.photoRef],
    ...(f.note.trim() ? { note: f.note.trim() } : {}),
  };
}

/** The findings a bag may be reported with: a seal only where it was closed with one. */
export function bagFindings(closedWith: BagClosedWith | undefined): BagFinding[] {
  return closedWith === 'seal' ? ['seal_not_as_written', 'seal_broken', 'wrap_cut'] : ['wrap_cut'];
}
