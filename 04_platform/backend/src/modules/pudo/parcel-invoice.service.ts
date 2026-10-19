import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { country, invoiceLine, invoicePage, invoiceParty, round, text } from './commercial-invoice.service';
import { INVOICE_COPIES, INVOICE_DECLARATION, type ExportReason } from './commercial-invoice.types';
import { canonicalJson } from './note-archive.types';
import { MAX_ADDRESS_LENGTH, type ParcelInvoice, type ParcelInvoiceDto, type ParcelInvoiceLine, type ParcelInvoiceView } from './parcel-invoice.types';

/** What the invoice knows that the store does not send: who it is, where the goods go, which parcel, how heavy. */
export interface ParcelInvoiceContext {
  store: { vendorId: string; name: string; address?: string };
  /** The border crossed: where the goods leave from and where they arrive. */
  fromCountry: string;
  toCountry: string;
  /** The shop the parcel is collected from: the buyer's address when the store gave none. */
  shop: { name: string; zone: string; landmark?: string; address?: string };
  /** The parcel, once it exists: its id, and its gross weight when known. */
  parcelId?: string;
  grossKg?: number;
  /** Who signs: the store's system, or a person of the store. */
  signer: string;
}

/**
 * A STORE PARCEL'S COMMERCIAL INVOICE (parcel-invoice.types.ts; round 13). Checked in full before anything is kept, kept
 * the way a load's is — never changed once signed; a correction is a new one that replaces it, and the one it replaced
 * stays on the record. Printed in three copies by the store, with the label.
 */
@Injectable()
export class ParcelInvoiceService {
  private readonly invoices = new PersistentMap<string, ParcelInvoice>('parcel-invoices');

  /** The invoice the parcel travels with now, when there is one. */
  current(parcelId: string): ParcelInvoice | undefined {
    return this.all(parcelId).find((i) => !i.supersededBy);
  }

  /** Every invoice the parcel has had, the newest first. */
  all(parcelId: string): ParcelInvoice[] {
    return [...this.invoices.values()].filter((i) => i.parcelId === parcelId).sort((a, b) => b.signed.at.localeCompare(a.signed.at));
  }

  view(parcelId: string, correctable: boolean): ParcelInvoiceView {
    const all = this.all(parcelId);
    const current = all.find((i) => !i.supersededBy);
    return { parcelId, ...(current ? { current } : {}), earlier: all.filter((i) => i.supersededBy), correctable };
  }

  /** The invoice as it would be: every check made, nothing kept. A test key's shipment, and the check before a live one. */
  check(input: ParcelInvoiceDto, ctx: ParcelInvoiceContext, now: number = Date.now()): Omit<ParcelInvoice, 'invoiceId' | 'fingerprint'> {
    if (input?.declare !== true) throw new GlosError('FIELD_REQUIRED', 'Confirm the declaration: that is what signs the invoice', { field: 'invoice.declare' });
    const number = text(input.number, 40);
    if (!number) throw new GlosError('FIELD_REQUIRED', 'Give your own number for this invoice', { field: 'invoice.number' });
    const issuedOn = input.issuedOn?.trim() || new Date(now).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(Date.parse(`${issuedOn}T00:00:00Z`))) throw new GlosError('VALIDATION_FAILED', 'The invoice date is a day: YYYY-MM-DD', { field: 'invoice.issuedOn' });
    const currency = String(input.currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new GlosError('VALIDATION_FAILED', 'The money is three letters, like KES or USD', { field: 'invoice.currency' });
    const reason = (input.reason ?? 'sale') as ExportReason;

    const buyer = text(input.importer?.name, 120);
    if (!buyer) throw new GlosError('FIELD_REQUIRED', 'Name the buyer the goods go to', { field: 'invoice.importer.name' });
    // AN ADDRESS ENTERED IS THE ADDRESS CARRIED: kept as the store sent it — never cut, never tidied, never one we chose.
    const entered = typeof input.importer.address === 'string' && input.importer.address.trim() ? input.importer.address : undefined;
    if (entered && entered.length > MAX_ADDRESS_LENGTH) throw new GlosError('VALIDATION_FAILED', `The buyer's address is longer than ${MAX_ADDRESS_LENGTH} characters: we carry it whole or not at all`, { field: 'invoice.importer.address' });
    const shopAddress = `c/o ${[ctx.shop.name, ctx.shop.address ?? ctx.shop.landmark, ctx.shop.zone].filter(Boolean).join(', ')}`;
    const fromCountry = country(ctx.fromCountry);
    const toCountry = country(ctx.toCountry);
    if (!fromCountry || !toCountry) throw new GlosError('INVALID_STATE', 'The countries this shipment crosses between are not known');

    if (!Array.isArray(input.lines) || !input.lines.length) throw new GlosError('FIELD_REQUIRED', 'List what is in the shipment, at least one line', { field: 'invoice.lines' });
    const lines = input.lines.map((l, i) => invoiceLine(l, i + 1, false) as ParcelInvoiceLine);
    const totalNetKg = round(lines.reduce((s, l) => s + l.netKg, 0), 3);
    // Customs adds the weights up: goods weighing more net than the parcel does gross is a paper that gets stopped.
    if (ctx.grossKg != null && totalNetKg > ctx.grossKg) {
      throw new GlosError('VALIDATION_FAILED', `The goods weigh ${totalNetKg} kg net on the invoice, more than the parcel's ${ctx.grossKg} kg`, { field: 'invoice.lines' });
    }
    const exporterAddress = input.exporterAddress?.trim() ? input.exporterAddress : ctx.store.address;
    return {
      number,
      issuedOn,
      parcelId: ctx.parcelId ?? '',
      vendorId: ctx.store.vendorId,
      exporter: invoiceParty({ name: ctx.store.name, ...(exporterAddress ? { address: exporterAddress } : {}), country: fromCountry }),
      importer: invoiceParty({ name: buyer, address: entered ?? shopAddress, country: toCountry, ...(text(input.importer.taxNo, 60) ? { taxNo: text(input.importer.taxNo, 60) } : {}) }),
      importerAddressFrom: entered ? 'entered' : 'shop',
      lines,
      currency,
      totalValue: round(lines.reduce((s, l) => s + l.lineValue, 0), 2),
      totalNetKg,
      // The parcel's weight as the store stated it; where it stated none, the goods' own.
      grossKg: ctx.grossKg ?? totalNetKg,
      ...(ctx.grossKg != null ? { statedGrossKg: ctx.grossKg } : {}),
      reason,
      declaration: INVOICE_DECLARATION,
      signed: { name: text(ctx.signer, 80) || 'The store', for: ctx.store.name, at: new Date(now).toISOString() },
      copies: INVOICE_COPIES,
    };
  }

  /** Sign and keep it for the parcel; one it had before stays on the record, replaced. */
  issue(input: ParcelInvoiceDto, ctx: ParcelInvoiceContext & { parcelId: string }, now: number = Date.now()): ParcelInvoice {
    const checked = this.check(input, ctx, now);
    const replaced = this.current(ctx.parcelId);
    const body = { invoiceId: `pi_${randomBytes(8).toString('hex')}`, ...checked, parcelId: ctx.parcelId, ...(replaced ? { supersedes: replaced.invoiceId } : {}) };
    const invoice: ParcelInvoice = { ...body, fingerprint: createHash('sha256').update(canonicalJson(body)).digest('hex') };
    this.invoices.set(invoice.invoiceId, invoice);
    if (replaced) this.invoices.set(replaced.invoiceId, { ...replaced, supersededBy: invoice.invoiceId, supersededAt: invoice.signed.at });
    return invoice;
  }

  /** The three copies, one a page, for the store to print with the label and put in the pouch. */
  htmlFor(i: ParcelInvoice): string {
    return invoicePage(i, { ref: `Parcel ${i.parcelId}`, code: i.parcelId, pouch: `All ${i.copies} copies go in a clear pouch on the outside of the parcel, with its label.` });
  }
}
