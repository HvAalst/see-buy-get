import type { Translate } from './i18n';

/*
 * TAX INVOICES (backend fiscal-invoice.types.ts; the user, 2026-10-18: "KRA eTIMS invoices", "eTIMS only for Kenya").
 * The Kenyan company's invoice for every sale and its credit note for every sale given back, recorded with KRA's eTIMS.
 * Read by the company in the console and by each buyer in their own app. Printed only once KRA has signed it; the
 * buyer's first opening is the original, every other a copy (KRA's rules for a till).
 */

export type FiscalState = 'waiting' | 'recorded' | 'refused' | 'needs_check' | 'not_sendable';

export interface FiscalInvoiceRow {
  invoiceId: string;
  entityId: string;
  seller: string;
  number: number;
  kind: 'sale' | 'credit';
  originalNumber?: number;
  ref?: string;
  buyer: { kind: 'shop' | 'store' | 'person'; id?: string; name: string };
  line: { description: string; net: number; tax: number; gross: number; band?: string; ratePct: number };
  currency: string;
  paidBy: 'cash' | 'prepaid';
  at: string;
  etims: { state: FiscalState; tries: number; lastTriedAt?: string; note?: string; receipt?: { curRcptNo: number; sdcId: string; sandbox?: boolean } };
}

export interface FiscalInvoiceList {
  items: FiscalInvoiceRow[];
  total: number;
  counts: Partial<Record<FiscalState, number>>;
  rail: 'kra' | 'stand_in' | 'not_set_up';
  env?: 'sandbox' | 'production';
  /** The company's way of telling its tax authority: eTIMS for Kenya's, absent for every other country's. */
  way?: 'etims';
}

export const FISCAL_STATES: FiscalState[] = ['waiting', 'refused', 'needs_check', 'recorded', 'not_sendable'];

/** The tag's tone: recorded is done, refused is the one to act on, the rest wait or are said. */
export function fiscalTone(state: FiscalState): 'ok' | 'warn' | 'danger' | 'info' | 'quiet' {
  if (state === 'recorded') return 'ok';
  if (state === 'refused') return 'danger';
  if (state === 'needs_check' || state === 'not_sendable') return 'warn';
  return 'info';
}

/** Printed only once KRA has signed it (TIS rule 10). */
export function printable(row: FiscalInvoiceRow): boolean {
  return row.etims.state === 'recorded' && Boolean(row.etims.receipt);
}

/** Sent again by the company: one KRA refused, or one KRA said it already held. */
export function mayResend(row: FiscalInvoiceRow): boolean {
  return row.etims.state === 'refused' || row.etims.state === 'needs_check';
}

/** "Tax invoice no. 41" / "Credit note no. 42, gives back no. 41". */
export function fiscalTitle(row: FiscalInvoiceRow, t: Translate): string {
  const head = t(row.kind === 'credit' ? 'fiscal.creditNo' : 'fiscal.invoiceNo', { number: row.number });
  return row.originalNumber ? `${head} · ${t('fiscal.givesBack', { number: row.originalNumber })}` : head;
}

/** Where it stands with KRA, in a few words — and a stand-in's answer never said to be KRA's. */
export function fiscalStanding(row: FiscalInvoiceRow, t: Translate): string {
  if (row.etims.receipt?.sandbox) return t('fiscal.standIn');
  return t(`fiscal.state.${row.etims.state}` as never);
}
