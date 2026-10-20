import type { SbgError } from '../../lib/sbg';
import type { Translate } from '../../shared/i18n';
import { ssccSpaced, type DisputeTone, type Gs1DisputeView, type Gs1View } from '../../shared/gs1';

/**
 * ROUND 29 — A STORE'S LABELS CARRY A GS1 CODE ("A store's labels carry a GS1 code"; "In the Store app, as a business
 * does"). The store gives its GS1 company prefix here; each of its parcels, once paid, is given an SSCC under it, printed
 * on its label as a GS1-128 barcode beside our QR. Held to a business's rules: never a digit another prints under, and a
 * prefix two say is theirs decided by two members of SeeBuyGet staff on the licences.
 */

/** What the card asks of the server, bound to the store signed in. Each answer is the server's, refusals included. */
export interface StoreGs1Api {
  set(companyPrefix: string, extensionDigit: number): Promise<{ error: SbgError | null }>;
  clear(): Promise<{ error: SbgError | null }>;
  disputes(): Promise<Gs1DisputeView[] | null>;
  open(body: { companyPrefix: string; extensionDigit: number; licenceRef: string; note?: string }): Promise<{ error: SbgError | null }>;
  sendLicence(disputeId: string, licenceRef: string): Promise<{ error: SbgError | null }>;
  withdraw(disputeId: string): Promise<{ error: SbgError | null }>;
  /** The licence photographed or a screenshot, uploaded as the store's own media: its id, or null when it did not go. */
  licencePhoto(file: File): Promise<string | null>;
}

/** "Prefix 6161234, extension digit 3 · 999,999,997 codes left". */
export function storeGs1Line(g: Gs1View, t: Translate): string {
  return t('vendor.gs1.line', { prefix: g.companyPrefix, digit: g.extensionDigit, left: g.left.toLocaleString() });
}

/** Where a dispute stands for this store, in a sentence — and how loudly to say it. Its parcels, never loads. */
export function storeDisputeLine(d: Gs1DisputeView, t: Translate, day: (iso: string) => string): { text: string; tone: DisputeTone } {
  const prefix = d.companyPrefix;
  if (d.state === 'withdrawn') return { text: t('vendor.gs1.d.withdrawn', { prefix }), tone: 'idle' };
  if (d.decided) {
    const reason = d.decided.reason;
    if (d.decided.mine) return { text: t('vendor.gs1.d.decidedMine', { prefix, reason }), tone: 'ok' };
    if (d.side === 'claimant') return { text: t('vendor.gs1.d.decidedNotClaimant', { prefix, reason }), tone: 'danger' };
    return { text: t('vendor.gs1.d.decidedNotHolder', { prefix, claimant: d.claimantName, reason }), tone: 'danger' };
  }
  if (d.side === 'claimant') return { text: t('vendor.gs1.d.claimantOpen', { prefix, names: d.holderNames.join(', '), n: d.holderNames.length, by: day(d.answerBy) }), tone: 'idle' };
  if (d.licenceSent) return { text: t('vendor.gs1.d.holderSent', { prefix, claimant: d.claimantName }), tone: 'idle' };
  return { text: t('vendor.gs1.d.holderAsk', { prefix, claimant: d.claimantName, by: day(d.answerBy) }), tone: 'warn' };
}

/**
 * An order's SSCC as GS1 prints it for a person — spaced at the prefix while the store still holds the prefix it was
 * given under; the eighteen digits as they are otherwise, since where one prefix ends is not in the number.
 */
export function ssccWords(sscc: string, gs1: Gs1View | undefined): string {
  const n = gs1?.companyPrefix.length;
  return gs1 && n && sscc.slice(1, 1 + n) === gs1.companyPrefix ? ssccSpaced(sscc, n) : sscc;
}
