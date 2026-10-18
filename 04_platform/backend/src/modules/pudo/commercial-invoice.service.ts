import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { Entity } from '../../foundation/entity/entity.types';
import { GlosError } from '../../foundation/http/glos-error';
import { escapeHtml } from '../../foundation/mail/mail.blocks';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CommercialInvoice, CommercialInvoiceView, EXPORT_REASONS, ExportReason, INVOICE_COPIES, INVOICE_DECLARATION, InvoiceLine, InvoiceParty, MAX_INVOICE_LINES } from './commercial-invoice.types';
import { Freight } from './dispatch.types';
import { canonicalJson } from './note-archive.types';

/** What the shipper types: everything the invoice says that the load does not already know. */
export interface InvoiceInput {
  number: string;
  issuedOn?: string;
  exporterAddress?: string;
  importer: { name: string; address?: string; country: string; taxNo?: string };
  currency: string;
  reason?: string;
  lines: Array<{ description: string; quantity: number; netKg: number; unitValue: number; originCountry: string; hsCode: string }>;
  /** The signer agrees to the declaration: this is the signature. */
  declare: boolean;
}

/** Who signs: a member of the business that posted the load. */
export interface InvoiceSigner {
  entity: Entity;
  name: string;
}

/**
 * A LOAD'S COMMERCIAL INVOICE (commercial-invoice.types.ts): written and signed by the business that posted the load,
 * read by everyone who reads the load's consignment note, printed in three copies, never changed once signed.
 */
@Injectable()
export class CommercialInvoiceService {
  private readonly invoices = new PersistentMap<string, CommercialInvoice>('commercial-invoices');

  /** The invoice the load travels with now, when there is one. */
  current(freightId: string): CommercialInvoice | undefined {
    return this.all(freightId).find((i) => !i.supersededBy);
  }

  /** Every invoice the load has had, the newest first. */
  all(freightId: string): CommercialInvoice[] {
    return [...this.invoices.values()].filter((i) => i.freightId === freightId).sort((a, b) => b.signed.at.localeCompare(a.signed.at));
  }

  view(f: Freight, mayWrite: boolean): CommercialInvoiceView {
    const all = this.all(f.freightId);
    const current = all.find((i) => !i.supersededBy);
    return {
      freightId: f.freightId,
      crossesBorder: crossesBorder(f),
      ...(current ? { current } : {}),
      earlier: all.filter((i) => i.supersededBy).map((i) => ({ invoiceId: i.invoiceId, number: i.number, issuedOn: i.issuedOn, signedBy: i.signed.name, signedAt: i.signed.at, ...(i.supersededAt ? { supersededAt: i.supersededAt } : {}) })),
      mayWrite,
    };
  }

  /** May this business write the load's invoice: it posted the load. */
  isShipper(f: Freight, entity: Entity): boolean {
    return f.postedByDid === entity.did;
  }

  /**
   * Write and sign the load's commercial invoice. Everything is checked before anything is kept; a load that already has
   * one gets the new one in its place, and the old one stays on the record, replaced.
   */
  issue(f: Freight, signer: InvoiceSigner, input: InvoiceInput, now: number = Date.now()): CommercialInvoice {
    if (!this.isShipper(f, signer.entity)) throw new GlosError('FORBIDDEN', 'The commercial invoice is written by the business that posted the load');
    if (f.status === 'cancelled') throw new GlosError('INVALID_STATE', 'This load was cancelled');
    if (f.status === 'delivered') throw new GlosError('INVALID_STATE', 'These goods were delivered: an invoice travels with the goods, before they arrive');
    if (input.declare !== true) throw new GlosError('FIELD_REQUIRED', 'Confirm the declaration: that is what signs the invoice', { field: 'declare' });

    const number = text(input.number, 40);
    if (!number) throw new GlosError('FIELD_REQUIRED', 'Give your own number for this invoice', { field: 'number' });
    const issuedOn = input.issuedOn?.trim() || new Date(now).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(Date.parse(`${issuedOn}T00:00:00Z`))) throw new GlosError('VALIDATION_FAILED', 'The invoice date is a day: YYYY-MM-DD', { field: 'issuedOn' });
    const currency = String(input.currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new GlosError('VALIDATION_FAILED', 'The money is three letters, like KES or USD', { field: 'currency' });
    const reason = (input.reason ?? 'sale') as ExportReason;
    if (!EXPORT_REASONS.includes(reason)) throw new GlosError('VALIDATION_FAILED', 'Why the goods cross the border: sale, sample, gift, repair, return or other', { field: 'reason' });

    const importerName = text(input.importer?.name, 120);
    if (!importerName) throw new GlosError('FIELD_REQUIRED', 'Name the buyer the goods go to', { field: 'importer.name' });
    const importerCountry = country(input.importer?.country);
    if (!importerCountry) throw new GlosError('VALIDATION_FAILED', 'Choose the country of the buyer', { field: 'importer.country' });
    const exporterCountry = country(signer.entity.jurisdiction);
    if (!exporterCountry) throw new GlosError('INVALID_STATE', 'Your business has no country on record');

    if (!Array.isArray(input.lines) || !input.lines.length) throw new GlosError('FIELD_REQUIRED', 'List what is in the shipment, at least one line', { field: 'lines' });
    if (input.lines.length > MAX_INVOICE_LINES) throw new GlosError('VALIDATION_FAILED', `Up to ${MAX_INVOICE_LINES} lines on one invoice`, { field: 'lines' });
    const lines: InvoiceLine[] = input.lines.map((l, i) => line(l, i + 1));
    const totalNetKg = round(lines.reduce((s, l) => s + l.netKg, 0), 3);
    // Customs adds the weights up: goods weighing more net than the whole load does gross is a paper that gets stopped.
    if (totalNetKg > f.weightKg) {
      throw new GlosError('VALIDATION_FAILED', `The goods weigh ${totalNetKg} kg net on the invoice, more than the load's ${f.weightKg} kg gross`, { field: 'lines' });
    }

    const at = new Date(now).toISOString();
    const replaced = this.current(f.freightId);
    const body = {
      invoiceId: `ci_${randomBytes(8).toString('hex')}`,
      number,
      issuedOn,
      freightId: f.freightId,
      loadCode: f.code,
      entityId: signer.entity.entityId,
      exporter: party({ name: signer.entity.name, address: text(input.exporterAddress, 200) || f.pickupLabel, country: exporterCountry, taxNo: signer.entity.business?.taxNo }),
      importer: party({ name: importerName, address: text(input.importer.address, 200), country: importerCountry, taxNo: text(input.importer.taxNo, 60) }),
      lines,
      currency,
      totalValue: round(lines.reduce((s, l) => s + l.lineValue, 0), 2),
      totalNetKg,
      grossKg: f.weightKg,
      ...(f.packages ? { packages: f.packages } : {}),
      ...(f.incoterm ? { incoterm: f.incoterm } : {}),
      ...(f.namedPlace ? { namedPlace: f.namedPlace } : {}),
      reason,
      declaration: INVOICE_DECLARATION,
      signed: { name: text(signer.name, 80) || 'A member of the business', for: signer.entity.name, at },
      copies: INVOICE_COPIES,
      ...(replaced ? { supersedes: replaced.invoiceId } : {}),
    };
    const invoice: CommercialInvoice = { ...body, fingerprint: createHash('sha256').update(canonicalJson(body)).digest('hex') };
    this.invoices.set(invoice.invoiceId, invoice);
    if (replaced) this.invoices.set(replaced.invoiceId, { ...replaced, supersededBy: invoice.invoiceId, supersededAt: at });
    return invoice;
  }

  /** What box 5 of the consignment note lists for it. */
  noteLine(freightId: string): string | undefined {
    const i = this.current(freightId);
    return i ? `Commercial invoice ${i.number} of ${i.issuedOn}, ${i.copies} copies` : undefined;
  }

  /* ------------------------------------------------------------------ the page -- */

  /** The invoice as a printable page: the same invoice three times, one copy a page, each saying which copy it is. */
  htmlFor(i: CommercialInvoice): string {
    const e = escapeHtml;
    const money = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const kg = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 3 });
    const partyBox = (title: string, p: InvoiceParty) =>
      `<div class="box"><div class="h">${e(title)}</div><b>${e(p.name)}</b>${p.address ? `<br>${e(p.address)}` : ''}<br>${e(countryName(p.country))}${p.taxNo ? `<br>Tax no. ${e(p.taxNo)}` : ''}</div>`;
    const rows = i.lines
      .map((l, n) => `<tr><td>${n + 1}</td><td>${e(l.description)}</td><td class="r">${l.quantity.toLocaleString('en')}</td><td class="r">${kg(l.netKg)}</td><td class="r">${money(l.unitValue)}</td><td class="r">${money(l.lineValue)}</td><td>${e(countryName(l.originCountry))}</td><td class="mono">${e(hsDisplay(l.hsCode))}</td></tr>`)
      .join('');
    const term = i.incoterm ? `${e(i.incoterm)}${i.namedPlace ? ` ${e(i.namedPlace)}` : ''}` : 'Not stated';
    const copy = (n: number) => `<section class="copy">
  <header><div><h1>Commercial invoice</h1><div class="sub">No. <b>${e(i.number)}</b> · ${e(i.issuedOn)} · Load ${e(i.loadCode)}</div></div><div class="copyno">Copy ${n} of ${i.copies}${n === 1 ? '<br><span>original</span>' : ''}</div></header>
  <div class="grid">${partyBox('Exporter (seller)', i.exporter)}${partyBox('Importer (buyer)', i.importer)}</div>
  <div class="grid4"><div class="box"><div class="h">Reason for export</div>${e(REASON_WORDS[i.reason])}</div><div class="box"><div class="h">Trade term</div>${term}</div><div class="box"><div class="h">Packages</div>${i.packages ?? 'Not stated'}</div><div class="box"><div class="h">Gross weight</div>${kg(i.grossKg)} kg</div></div>
  <table><thead><tr><th>#</th><th>Description of the goods</th><th class="r">Quantity</th><th class="r">Net kg</th><th class="r">Value per item (${e(i.currency)})</th><th class="r">Value (${e(i.currency)})</th><th>Country of origin</th><th>HS code</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td></td><td>Total</td><td class="r">${i.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString('en')}</td><td class="r">${kg(i.totalNetKg)}</td><td></td><td class="r"><b>${e(i.currency)} ${money(i.totalValue)}</b></td><td colspan="2"></td></tr></tfoot></table>
  <p class="fine">HS codes and values are as the exporter declared them. SeeBuyGet does not classify goods.</p>
  <div class="decl"><p>${e(i.declaration)}</p>
    <div class="sign"><div><b>Signed electronically</b> by ${e(i.signed.name)} for ${e(i.signed.for)}, ${e(when(i.signed.at))}.<br><span class="mono">Fingerprint ${e(i.fingerprint.slice(0, 16))}…</span></div>
    <div class="hand">Signature <span class="line"></span><br>Name <span class="line"></span> Date <span class="line short"></span></div></div></div>
  <p class="pouch">All ${i.copies} copies go in a clear pouch on the outside of package 1, with the load's consignment note.</p>
</section>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Commercial invoice ${e(i.number)} — ${e(i.loadCode)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 12px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; background: #fff; }
  .copy { max-width: 800px; margin: 0 auto 32px; }
  .copy + .copy { break-before: page; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 20px; margin: 0; text-transform: uppercase; letter-spacing: .04em; }
  .sub { margin-top: 2px; }
  .copyno { border: 2px solid #111; padding: 4px 10px; font-weight: 700; text-align: center; }
  .copyno span { font-weight: 400; font-size: 11px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
  .box { border: 1px solid #555; padding: 6px 8px; min-height: 44px; }
  .h { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #444; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #555; padding: 4px 6px; vertical-align: top; text-align: left; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .03em; background: #f1f1f1; }
  .r { text-align: right; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  tfoot td { font-weight: 600; }
  .fine { font-size: 10px; color: #444; margin: 4px 0 10px; }
  .decl { border: 1px solid #555; padding: 8px; }
  .decl p { margin: 0 0 8px; }
  .sign { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; }
  .hand { line-height: 2.2; white-space: nowrap; }
  .line { display: inline-block; width: 150px; border-bottom: 1px solid #111; }
  .line.short { width: 80px; }
  .pouch { margin-top: 10px; font-weight: 600; }
  @media (max-width: 640px) { .grid, .grid4 { grid-template-columns: 1fr; } .sign { flex-direction: column; align-items: flex-start; } }
</style></head><body>
${Array.from({ length: i.copies }, (_, n) => copy(n + 1)).join('\n')}
</body></html>`;
  }
}

/** The load crosses a border: both countries known, and different. */
export function crossesBorder(f: Pick<Freight, 'pickupCountry' | 'destCountry'>): boolean {
  return Boolean(f.pickupCountry && f.destCountry && f.pickupCountry !== f.destCountry);
}

/** An HS code as the shipper typed it, as digits: 6 to 10 of them, dots and spaces dropped. Nothing when it is not one. */
export function cleanHsCode(raw: string | undefined): string | undefined {
  const digits = String(raw ?? '').replace(/[\s.]/g, '');
  return /^\d{6,10}$/.test(digits) ? digits : undefined;
}

/** "847130" → "8471.30"; "84713000" → "8471.30.00": the way HS codes are written. */
export function hsDisplay(digits: string): string {
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}${digits.length > 6 ? `.${digits.slice(6)}` : ''}`;
}

const REASON_WORDS: Record<ExportReason, string> = { sale: 'Sale', sample: 'Sample', gift: 'Gift', repair: 'Repair', return: 'Return', other: 'Other' };

function line(l: InvoiceInput['lines'][number], n: number): InvoiceLine {
  const where = { field: `lines.${n - 1}` };
  const description = text(l?.description, 200);
  if (!description) throw new GlosError('FIELD_REQUIRED', `Line ${n}: say what the goods are`, where);
  const quantity = Number(l.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) throw new GlosError('VALIDATION_FAILED', `Line ${n}: the quantity is a whole number, 1 or more`, where);
  const netKg = Number(l.netKg);
  if (!Number.isFinite(netKg) || netKg <= 0 || netKg > 1_000_000) throw new GlosError('VALIDATION_FAILED', `Line ${n}: the net weight is in kg, more than 0`, where);
  const unitValue = Number(l.unitValue);
  if (!Number.isFinite(unitValue) || unitValue < 0 || unitValue > 1e12) throw new GlosError('VALIDATION_FAILED', `Line ${n}: the value per item is a number, 0 or more`, where);
  const originCountry = country(l.originCountry);
  if (!originCountry) throw new GlosError('VALIDATION_FAILED', `Line ${n}: choose the country the goods were made in`, where);
  const hsCode = cleanHsCode(l.hsCode);
  if (!hsCode) throw new GlosError('VALIDATION_FAILED', `Line ${n}: the HS code is 6 to 10 digits, as you or your customs agent classify the goods`, where);
  return { description, quantity, netKg: round(netKg, 3), unitValue: round(unitValue, 2), lineValue: round(quantity * unitValue, 2), originCountry, hsCode };
}

function party(p: InvoiceParty): InvoiceParty {
  return { name: p.name, ...(p.address ? { address: p.address } : {}), country: p.country, ...(p.taxNo ? { taxNo: p.taxNo } : {}) };
}

function text(raw: string | undefined, max: number): string {
  return String(raw ?? '').trim().slice(0, max);
}

function country(raw: string | undefined): string | undefined {
  return catalogueEntry(raw)?.code;
}

function countryName(code: string): string {
  return catalogueEntry(code)?.name ?? code;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
