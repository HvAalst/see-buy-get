import type { Translate } from '../../shared/i18n';
import type { Gs1View } from '../../shared/gs1';

/*
 * A LOAD'S PAPERS IN THE BUSINESS APP — the package labels (our code, and the shipper's GS1 code beside it) and the
 * commercial invoice. The rules are the server's (shipper-codes.service.ts, commercial-invoice.service.ts); these say
 * them before a form is sent, so the shipper is told what is missing while they can still see the field.
 */

/** The business's GS1 company prefix, as its view carries it: read the way a store's is (round 29). */
export type { Gs1View } from '../../shared/gs1';
export { cleanPrefix, ssccSpaced } from '../../shared/gs1';

/** What a load's labels will carry. */
export interface PackageLabels {
  freightId: string;
  labels: number;
  packages?: number;
  codes: string[];
  companyPrefix?: string;
}

export interface InvoiceParty {
  name: string;
  address?: string;
  country: string;
  taxNo?: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  netKg: number;
  unitValue: number;
  lineValue: number;
  originCountry: string;
  hsCode: string;
}

export interface CommercialInvoice {
  invoiceId: string;
  number: string;
  issuedOn: string;
  exporter: InvoiceParty;
  importer: InvoiceParty;
  lines: InvoiceLine[];
  currency: string;
  totalValue: number;
  totalNetKg: number;
  grossKg: number;
  packages?: number;
  reason: ExportReason;
  signed: { name: string; for: string; at: string };
  fingerprint: string;
  copies: number;
}

export interface CommercialInvoiceView {
  freightId: string;
  crossesBorder: boolean;
  current?: CommercialInvoice;
  earlier: Array<{ invoiceId: string; number: string; issuedOn: string; signedBy: string; signedAt: string; supersededAt?: string }>;
  /** The shipper said its own paper invoice travels with the goods. */
  ownPaper?: { by: string; for: string; at: string };
  /** Whether a carrier may take the goods over, as far as the invoice goes. */
  collectable: boolean;
  mayWrite: boolean;
}

export const EXPORT_REASONS = ['sale', 'sample', 'gift', 'repair', 'return', 'other'] as const;
export type ExportReason = (typeof EXPORT_REASONS)[number];

/** "Prefix 6161234, extension digit 3 · 999,999,997 codes left". */
export function gs1Line(g: Gs1View, t: Translate): string {
  return t('business.gs1.line', { prefix: g.companyPrefix, digit: g.extensionDigit, left: g.left.toLocaleString() });
}

/** What the labels will be, in a sentence: how many, and whether each carries its SSCC. */
export function labelsLine(l: PackageLabels, hasPrefix: boolean, t: Translate): string {
  if (l.codes.length) return t('business.papers.labelsCoded', { n: l.labels });
  if (!l.packages) return t(hasPrefix ? 'business.papers.labelsNoCount' : 'business.papers.labelsOneOurs');
  return t(hasPrefix ? 'business.papers.labelsBefore' : 'business.papers.labelsOurs', { n: l.labels });
}

/* ------------------------------------------------------------------ the invoice form -- */

export interface InvoiceLineForm {
  description: string;
  quantity: string;
  netKg: string;
  unitValue: string;
  originCountry: string;
  hsCode: string;
}

export interface InvoiceForm {
  number: string;
  issuedOn: string;
  importerName: string;
  importerAddress: string;
  importerCountry: string;
  importerTaxNo: string;
  currency: string;
  reason: ExportReason;
  lines: InvoiceLineForm[];
  declare: boolean;
}

export const EMPTY_LINE: InvoiceLineForm = { description: '', quantity: '', netKg: '', unitValue: '', originCountry: '', hsCode: '' };

/** A new invoice, or a new one in place of the last: everything it said, the declaration not yet made again. */
export function invoiceForm(today: string, from?: CommercialInvoice, originDefault = ''): InvoiceForm {
  if (!from) return { number: '', issuedOn: today, importerName: '', importerAddress: '', importerCountry: '', importerTaxNo: '', currency: '', reason: 'sale', lines: [{ ...EMPTY_LINE, originCountry: originDefault }], declare: false };
  return {
    number: from.number,
    issuedOn: today,
    importerName: from.importer.name,
    importerAddress: from.importer.address ?? '',
    importerCountry: from.importer.country,
    importerTaxNo: from.importer.taxNo ?? '',
    currency: from.currency,
    reason: from.reason,
    lines: from.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), netKg: String(l.netKg), unitValue: String(l.unitValue), originCountry: l.originCountry, hsCode: hsDisplay(l.hsCode) })),
    declare: false,
  };
}

/** An HS code as typed, as digits: 6 to 10 of them, dots and spaces dropped. */
export function cleanHs(raw: string): string | undefined {
  const digits = raw.replace(/[\s.]/g, '');
  return /^\d{6,10}$/.test(digits) ? digits : undefined;
}

/** "847130" → "8471.30". */
export function hsDisplay(digits: string): string {
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}${digits.length > 6 ? `.${digits.slice(6)}` : ''}`;
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** The totals as the form stands: value and net weight, from the lines that can be added up. */
export function invoiceTotals(form: InvoiceForm): { value: number; netKg: number } {
  let value = 0;
  let netKg = 0;
  for (const l of form.lines) {
    const q = num(l.quantity);
    const v = num(l.unitValue);
    const w = num(l.netKg);
    if (Number.isFinite(q) && Number.isFinite(v)) value += q * v;
    if (Number.isFinite(w)) netKg += w;
  }
  return { value: Math.round(value * 100) / 100, netKg: Math.round(netKg * 1000) / 1000 };
}

/** What a gap is called: a field of the invoice, or `line.<n>.<field>`. */
export type InvoiceGap = 'number' | 'importerName' | 'importerCountry' | 'currency' | 'lines' | 'overweight' | 'declare' | `line.${number}.${keyof InvoiceLineForm}`;

/** What the server would refuse, said before it is sent. */
export function invoiceGaps(form: InvoiceForm, grossKg: number): InvoiceGap[] {
  const gaps: InvoiceGap[] = [];
  if (!form.number.trim()) gaps.push('number');
  if (!form.importerName.trim()) gaps.push('importerName');
  if (!form.importerCountry) gaps.push('importerCountry');
  if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) gaps.push('currency');
  if (!form.lines.length) gaps.push('lines');
  form.lines.forEach((l, i) => {
    if (!l.description.trim()) gaps.push(`line.${i}.description`);
    const q = num(l.quantity);
    if (!Number.isInteger(q) || q < 1) gaps.push(`line.${i}.quantity`);
    const w = num(l.netKg);
    if (!Number.isFinite(w) || w <= 0) gaps.push(`line.${i}.netKg`);
    const v = num(l.unitValue);
    if (!Number.isFinite(v) || v < 0) gaps.push(`line.${i}.unitValue`);
    if (!l.originCountry) gaps.push(`line.${i}.originCountry`);
    if (!cleanHs(l.hsCode)) gaps.push(`line.${i}.hsCode`);
  });
  if (invoiceTotals(form).netKg > grossKg) gaps.push('overweight');
  if (!form.declare) gaps.push('declare');
  return gaps;
}

/** The form as the server takes it. */
export function invoiceBody(form: InvoiceForm): Record<string, unknown> {
  return {
    number: form.number.trim(),
    ...(form.issuedOn ? { issuedOn: form.issuedOn } : {}),
    importer: { name: form.importerName.trim(), country: form.importerCountry, ...(form.importerAddress.trim() ? { address: form.importerAddress.trim() } : {}), ...(form.importerTaxNo.trim() ? { taxNo: form.importerTaxNo.trim() } : {}) },
    currency: form.currency.trim().toUpperCase(),
    reason: form.reason,
    lines: form.lines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), netKg: Number(l.netKg), unitValue: Number(l.unitValue), originCountry: l.originCountry, hsCode: l.hsCode.trim() })),
    declare: form.declare,
  };
}

/** "USD 360.00". */
export function money(currency: string, n: number): string {
  return `${currency} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
