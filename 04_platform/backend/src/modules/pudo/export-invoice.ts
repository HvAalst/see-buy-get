import { createHash } from 'crypto';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { hsDisplay } from './commercial-invoice.service';
import { INVOICE_DECLARATION } from './commercial-invoice.types';
import type { PackingLine } from './export-packing.types';
import type { SliFacts } from './export-sli';
import type { InvoiceDraft, InvoiceDraftDto, InvoiceTemplate, InvoiceTotals } from './export-invoice.types';

/**
 * THE COMMERCIAL INVOICE ON AN EXPORT — its rules and its page. The shapes are in export-invoice.types.ts.
 *
 * Its lines ARE the packing list's: one set of lines, read once from the shipper's own file, so the invoice and the list
 * cannot disagree about what is in the box. What differs from nation to nation is carried as the exporter's own words —
 * particulars by name, declarations as that country wants them worded — and remembered per destination for its next
 * invoice there. Nothing here knows any one country's rules, and nothing computes a duty.
 */

/** The declaration every invoice carries, in our words; the exporter adds its own beside it. */
export const INVOICE_TRUTH = INVOICE_DECLARATION;

const trimmed = (s: string | undefined, max: number) => (s?.trim() ? s.trim().slice(0, max) : undefined);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The form, cleaned. A field kept by its name even while empty — it was asked for, and saying so is the point. */
export function cleanInvoice(input: InvoiceDraftDto, by: string, now: number): InvoiceDraft {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date?.trim() ?? '') && !Number.isNaN(Date.parse(input.date!.trim())) ? input.date!.trim() : new Date(now).toISOString().slice(0, 10);
  const currency = (input.currency ?? '').trim().toUpperCase();
  const buyer = input.buyer && (input.buyer.name?.trim() || input.buyer.address?.trim())
    ? {
        name: trimmed(input.buyer.name, 160) ?? '',
        address: trimmed(input.buyer.address, 400) ?? '',
        ...(trimmed(input.buyer.taxId, 60) ? { taxId: trimmed(input.buyer.taxId, 60) } : {}),
        ...(trimmed(input.buyer.contact, 120) ? { contact: trimmed(input.buyer.contact, 120) } : {}),
      }
    : undefined;
  return {
    number: trimmed(input.number, 40) ?? '',
    date,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
    ...(input.incoterm ? { incoterm: input.incoterm } : {}),
    ...(input.incoterm && trimmed(input.incotermPlace, 80) ? { incotermPlace: trimmed(input.incotermPlace, 80) } : {}),
    ...(trimmed(input.paymentTerms, 200) ? { paymentTerms: trimmed(input.paymentTerms, 200) } : {}),
    reason: input.reason ?? 'sale',
    ...(buyer ? { buyer } : {}),
    ...(input.consigneeIsBuyer ? { consigneeIsBuyer: true } : {}),
    charges: (input.charges ?? []).filter((c) => c.label?.trim() && Number.isFinite(c.amount) && c.amount !== 0).map((c) => ({ label: c.label.trim().slice(0, 60), amount: round2(c.amount) })),
    fields: (input.fields ?? []).filter((f) => f.label?.trim()).map((f) => ({ label: f.label.trim().slice(0, 60), value: (f.value ?? '').trim().slice(0, 200) })),
    declarations: (input.declarations ?? []).map((d) => d.trim().slice(0, 1200)).filter((d) => d && d !== INVOICE_TRUTH),
    columns: [...new Set((input.columns ?? []).map((c) => c.trim()).filter(Boolean))].slice(0, 10),
    savedAt: new Date(now).toISOString(),
    savedBy: by,
  };
}

/** A line's value: its own, or its unit price times its quantity (or its packages, where no quantity is given). */
export function lineValueOf(l: PackingLine): number | undefined {
  if (l.lineValue != null) return round2(l.lineValue);
  if (l.unitPrice != null) return round2(l.unitPrice * (l.quantity ?? l.packages));
  return undefined;
}

/** The price of one unit as the invoice prints it: its own, or the value spread over the quantity. */
export function unitPriceOf(l: PackingLine): number | undefined {
  if (l.unitPrice != null) return l.unitPrice;
  if (l.lineValue != null) return Math.round((l.lineValue / (l.quantity ?? l.packages)) * 10_000) / 10_000;
  return undefined;
}

export function invoiceTotals(lines: PackingLine[], draft?: Pick<InvoiceDraft, 'charges'>): InvoiceTotals {
  const goods = round2(lines.reduce((s, l) => s + (lineValueOf(l) ?? 0), 0));
  const charges = round2((draft?.charges ?? []).reduce((s, c) => s + c.amount, 0));
  return {
    lines: lines.length,
    goods,
    charges,
    total: round2(goods + charges),
    unvalued: lines.filter((l) => lineValueOf(l) == null).length,
    withoutHs: lines.filter((l) => !l.hsCode).length,
    withoutOrigin: lines.filter((l) => !l.originCountry?.trim()).length,
  };
}

/** What signing still needs — what no invoice anywhere goes without. */
export function invoiceGaps(d: InvoiceDraft | undefined, lines: PackingLine[]): string[] {
  if (!lines.length) return ['Bring in the packing list: the invoice’s lines are its lines'];
  if (!d) return ['Fill in the invoice'];
  const out: string[] = [];
  if (!d.number) out.push('The invoice’s number');
  if (!d.currency) out.push('The currency, as its three letters');
  if (!(d.buyer?.name && d.buyer.address)) out.push('The buyer’s name and address');
  const unvalued = invoiceTotals(lines).unvalued;
  if (unvalued) out.push(`${unvalued} line${unvalued === 1 ? '' : 's'} with no value — bring in your list with a unit price or a value column`);
  return out;
}

/**
 * Said, never refused — because what one destination demands another does not ask: the lines without an HS code or a
 * country of origin, and the particulars this business's last invoice there carried that are empty here.
 */
export function invoiceNotes(d: InvoiceDraft | undefined, totals: InvoiceTotals, template: InvoiceTemplate | undefined, destCountry: string): string[] {
  const out: string[] = [];
  const dest = catalogueEntry(destCountry)?.name ?? destCountry;
  if (totals.withoutHs) out.push(`${totals.withoutHs} line${totals.withoutHs === 1 ? ' has' : 's have'} no HS code — many destinations ask for one on the invoice.`);
  if (totals.withoutOrigin) out.push(`${totals.withoutOrigin} line${totals.withoutOrigin === 1 ? ' has' : 's have'} no country of origin — many destinations ask for it, line by line.`);
  const empty = (d?.fields ?? []).filter((f) => !f.value).map((f) => f.label);
  if (empty.length) out.push(`Empty, and not printed: ${empty.join('; ')}${template ? ` — your last invoice to ${dest} carried ${empty.length === 1 ? 'it' : 'them'}` : ''}.`);
  return out;
}

/** The lines as one fingerprint: what a signed invoice was drawn from. */
export function invoiceBasis(lines: PackingLine[]): string {
  const facts = lines.map((l) => [l.description, l.hsCode ?? '', l.originCountry ?? '', l.quantity ?? '', l.unit ?? '', l.packages, lineValueOf(l) ?? '', l.netKg ?? '', l.grossKg ?? '']);
  return createHash('sha256').update(JSON.stringify(facts), 'utf8').digest('hex');
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const countryName = (code: string) => catalogueEntry(code)?.name ?? code;
const REASON_WORDS: Record<InvoiceDraft['reason'], string> = { sale: 'Sale', sample: 'Sample', gift: 'Gift', repair: 'Repair', return: 'Return', other: 'Other' };

/** THE PRINTED INVOICE: the core every invoice carries, and the rest in the exporter's own words for where it is going. */
export function invoiceHtml(f: SliFacts, consignee: string | undefined, d: InvoiceDraft, lines: PackingLine[], sign: { version: number; signedBy: string; signedAt: string } | 'draft'): string {
  const money = (n: number | undefined, dp = 2) => (n == null ? '—' : n.toLocaleString('en', { minimumFractionDigits: dp, maximumFractionDigits: Math.max(dp, 4) }));
  const kg = (n: number | undefined) => (n == null ? '' : n.toLocaleString('en', { maximumFractionDigits: 1 }));
  const has = (k: keyof PackingLine) => lines.some((l) => l[k] != null && l[k] !== '');
  const t = invoiceTotals(lines, d);
  const draft = sign === 'draft';
  const title = `${draft ? 'DRAFT — ' : ''}Commercial invoice ${d.number || '—'} — ${f.code}${draft ? '' : ` — version ${sign.version}`}`;
  const party = (head: string, body: string) => `<div class="box"><div class="h">${esc(head)}</div>${body}</div>`;
  const seller = `<b>${esc(f.shipper.name)}</b>${f.shipper.address ? `<br>${esc(f.shipper.address)}` : ''}<br>${esc(countryName(f.shipper.country))}${f.shipper.registrationNo ? `<br>Registration ${esc(f.shipper.registrationNo)}` : ''}${f.shipper.taxNo ? `<br>Tax number ${esc(f.shipper.taxNo)}` : ''}`;
  const buyer = d.buyer ? `<b>${esc(d.buyer.name)}</b><br>${esc(d.buyer.address).replace(/\r?\n/g, '<br>')}${d.buyer.taxId ? `<br>${esc(d.buyer.taxId)}` : ''}${d.buyer.contact ? `<br>${esc(d.buyer.contact)}` : ''}` : '—';
  const cons = d.consigneeIsBuyer ? 'The buyer' : consignee ? esc(consignee) : '—';
  const cols = [
    ...(has('marks') ? [{ head: 'Marks', cell: (l: PackingLine) => esc(l.marks ?? '') }] : []),
    ...(has('itemCode') ? [{ head: 'Item', cell: (l: PackingLine) => esc(l.itemCode ?? '') }] : []),
    { head: 'Description', cell: (l: PackingLine) => esc(l.description) },
    { head: 'HS code', cell: (l: PackingLine) => (l.hsCode ? esc(hsDisplay(l.hsCode)) : '—') },
    { head: 'Origin', cell: (l: PackingLine) => esc(l.originCountry ?? '—') },
    { head: 'Quantity', r: true, cell: (l: PackingLine) => (l.quantity != null ? `${kg(l.quantity)}${l.unit ? ` ${esc(l.unit)}` : ''}` : `${l.packages.toLocaleString('en')}${l.packageKind ? ` ${esc(l.packageKind)}` : ''}`) },
    { head: `Unit price (${d.currency || '—'})`, r: true, cell: (l: PackingLine) => money(unitPriceOf(l), 2) },
    { head: `Value (${d.currency || '—'})`, r: true, cell: (l: PackingLine) => money(lineValueOf(l)) },
    ...(has('netKg') ? [{ head: 'Net kg', r: true, cell: (l: PackingLine) => kg(l.netKg) }] : []),
    ...(has('grossKg') ? [{ head: 'Gross kg', r: true, cell: (l: PackingLine) => kg(l.grossKg) }] : []),
    ...d.columns.map((head) => ({ head, cell: (l: PackingLine) => esc(l.extra?.[head] ?? '') })),
  ];
  const rows = lines.map((l, i) => `<tr><td class="r">${i + 1}</td>${cols.map((c) => `<td${'r' in c && c.r ? ' class="r"' : ''}>${c.cell(l)}</td>`).join('')}</tr>`).join('');
  const sums = [`<tr><th colspan="${cols.length}" class="r">Value of the goods</th><td class="r">${money(t.goods)}</td></tr>`, ...d.charges.map((c) => `<tr><th colspan="${cols.length}" class="r">${esc(c.label)}</th><td class="r">${money(c.amount)}</td></tr>`), `<tr class="tot"><th colspan="${cols.length}" class="r">Total (${esc(d.currency || '—')}${d.incoterm ? `, ${esc(d.incoterm)}${d.incotermPlace ? ` ${esc(d.incotermPlace)}` : ''}` : ''})</th><td class="r"><b>${money(t.total)}</b></td></tr>`].join('');
  const fields = d.fields.filter((x) => x.value);
  const facts = [
    ['Invoice number', d.number || '—'],
    ['Date', d.date],
    ['Currency', d.currency || '—'],
    ...(d.incoterm ? [['Trade term', `${d.incoterm}${d.incotermPlace ? ` ${d.incotermPlace}` : ''} (Incoterms 2020)`]] : []),
    ...(d.paymentTerms ? [['Payment terms', d.paymentTerms]] : []),
    ['Reason for export', REASON_WORDS[d.reason]],
    ['Export', f.code],
    ['Booking', `${f.booking} — ${f.forwarder}`],
    ...(f.vessel ? [['Vessel / voyage', `${f.vessel}${f.voyage ? ` / ${f.voyage}` : ''}`]] : []),
    ['From → to', `${f.loadingPort}, ${countryName(f.originCountry)} → ${countryName(f.destCountry)}`],
    ...(f.container.number ? [['Container', `${f.container.number}${f.container.type ? ` (${f.container.type})` : ''}`]] : []),
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:12px/1.45 system-ui,sans-serif;color:#111;margin:20px auto;max-width:1100px;padding:0 14px}h1{font-size:18px;margin:0 0 6px}h2{font-size:13px;margin:16px 0 5px;border-bottom:1px solid #ccc;padding-bottom:2px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}.box{border:1px solid #ddd;border-radius:6px;padding:7px 9px}.h{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.04em}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e6e6e6;padding:3px 5px;text-align:left;vertical-align:top}th{font-weight:600;background:#f6f6f6}.facts th{background:none;width:30%}.r{text-align:right}.tot th,.tot td{background:#eee}.draft{color:#b00020;font-weight:700}.note{color:#555;font-size:11px;margin-top:14px}@media print{body{margin:0}th{background:#fff}}</style></head><body>
<h1>${esc(title)}</h1>
${draft ? '<p class="draft">A draft: not signed.</p>' : ''}
<div class="grid">${party('Seller (exporter)', seller)}${party('Buyer', buyer)}${party('Consignee', cons)}</div>
<h2>The invoice</h2><table class="facts">${facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>The goods</h2><table><tr><th class="r">#</th>${cols.map((c) => `<th${'r' in c && c.r ? ' class="r"' : ''}>${esc(c.head)}</th>`).join('')}</tr>${rows}${sums}</table>
${fields.length ? `<h2>Further particulars</h2><table class="facts">${fields.map((x) => `<tr><th>${esc(x.label)}</th><td>${esc(x.value)}</td></tr>`).join('')}</table>` : ''}
<h2>Declarations</h2>${[INVOICE_TRUTH, ...d.declarations].map((x) => `<p>${esc(x).replace(/\r?\n/g, '<br>')}</p>`).join('')}
<p>${draft ? '<span class="draft">Not signed.</span>' : `Signed by ${esc(sign.signedBy)}, for ${esc(f.shipper.name)}, on ${esc(utc(sign.signedAt))} — version ${sign.version}.`}</p>
<p class="note">The exporter’s own invoice, drawn on SeeBuyGet from the same lines as its packing list. Every value, HS code and origin is the exporter’s; SeeBuyGet classifies nothing and computes no duty. A signed version is kept exactly as signed; a change is a new version.</p>
</body></html>`;
}
