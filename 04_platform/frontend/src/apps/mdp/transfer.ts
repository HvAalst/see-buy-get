/*
 * 2026-11-24 — A BAG HANDED OVER AT THE HUB FROM ANOTHER COUNTRY (corridor compliance, slice 4; backend hub-transfer.service.ts):
 * the pass on the driver's phone, and what is wrong with the bag, each in words with a photograph where one was taken.
 */

/** At most this many things wrong at one handover (the server's MAX_TRANSFER_EXCEPTIONS): more is a bag to report. */
export const MAX_TRANSFER_EXCEPTIONS = 5;

export interface TransferException {
  note: string;
  photoRef?: string;
}

export interface TransferForm {
  pass: string;
  exceptions: TransferException[];
}

export const EMPTY_TRANSFER: TransferForm = { pass: '', exceptions: [] };

/** Whether a bag about to be received came from another country: it is handed over by name. Unknown either way: no. */
export function crossesBorder(fromCountry: string | undefined, hubCountry: string | undefined): boolean {
  return Boolean(fromCountry && hubCountry && fromCountry !== hubCountry);
}

/** What the drop sends with the receipt, or the word key of what is missing. A line left empty is not sent. */
export type TransferError = 'mdp.transfer.err.pass' | 'mdp.transfer.err.note' | 'mdp.transfer.err.many';

export function transferBody(f: TransferForm): { body: { driverBadgeId: string; exceptions?: TransferException[] } } | { error: TransferError } {
  const pass = f.pass.trim();
  if (pass.length < 2) return { error: 'mdp.transfer.err.pass' };
  const said = f.exceptions.filter((e) => e.note.trim() || e.photoRef);
  if (said.length > MAX_TRANSFER_EXCEPTIONS) return { error: 'mdp.transfer.err.many' };
  const exceptions: TransferException[] = [];
  for (const e of said) {
    const note = e.note.trim().replace(/\s+/g, ' ');
    if (note.length < 3 || note.length > 500) return { error: 'mdp.transfer.err.note' };
    exceptions.push({ note, ...(e.photoRef ? { photoRef: e.photoRef } : {}) });
  }
  return { body: { driverBadgeId: pass, ...(exceptions.length ? { exceptions } : {}) } };
}
