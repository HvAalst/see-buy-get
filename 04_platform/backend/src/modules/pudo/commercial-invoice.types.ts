/**
 * THE COMMERCIAL INVOICE — the paper customs reads at a border, written and signed by the shipper.
 *
 * What it carries is the standard set: what is in the shipment line by line — description, quantity, net weight,
 * value per item, country of origin and HS code — who sells and who buys, the money, the trade term, and the
 * exporter's signed declaration. Three copies travel with the goods in a clear pouch on the outside of the first
 * package, which is what most carriers and border posts ask for.
 *
 * THE SHIPPER'S DOCUMENT, NOT OURS. Every value and every HS code on it is the shipper's own; SeeBuyGet does not
 * classify goods or suggest a code, and nobody pays anybody through it (quotations, never payments). It is kept the way
 * the consignment note is kept: never changed once signed. A correction is a new invoice that replaces it, and the one
 * it replaced stays on the record, marked so.
 */

/** Why the goods cross the border — the line every commercial invoice has. */
export const EXPORT_REASONS = ['sale', 'sample', 'gift', 'repair', 'return', 'other'] as const;
export type ExportReason = (typeof EXPORT_REASONS)[number];

/** How many copies travel with the goods. */
export const INVOICE_COPIES = 3;

/** A load's invoice lists at most this many lines. */
export const MAX_INVOICE_LINES = 50;

/** The words the exporter signs. */
export const INVOICE_DECLARATION = 'I declare that the information on this invoice is true and correct, and that the contents of this shipment are as stated above.';

export class InvoiceParty {
  name: string;
  address?: string;
  /** ISO 3166 alpha-2. */
  country: string;
  /** Their tax or VAT number, where they gave one. */
  taxNo?: string;
}

export class InvoiceLine {
  description: string;
  quantity: number;
  /** The line's net weight, in kg. */
  netKg: number;
  /** The value of ONE item, in the invoice's currency. */
  unitValue: number;
  /** quantity × unitValue, rounded to the cent. */
  lineValue: number;
  /** ISO 3166 alpha-2: where the goods were made. */
  originCountry: string;
  /** The HS code as the shipper declared it, digits only (6 to 10). Never one of ours. */
  hsCode: string;
}

export class InvoiceSignature {
  /** The person who signed, by name. */
  name: string;
  /** For which business. */
  for: string;
  at: string;
}

export class CommercialInvoice {
  invoiceId: string;
  /** The shipper's own invoice number. */
  number: string;
  /** YYYY-MM-DD. */
  issuedOn: string;
  freightId: string;
  loadCode: string;
  /** The business that wrote it. */
  entityId: string;
  exporter: InvoiceParty;
  importer: InvoiceParty;
  lines: InvoiceLine[];
  /** ISO 4217. */
  currency: string;
  totalValue: number;
  totalNetKg: number;
  /** The load's gross weight, from the load. */
  grossKg: number;
  /** The number of packages, from the load, when it was given. */
  packages?: number;
  incoterm?: string;
  namedPlace?: string;
  reason: ExportReason;
  declaration: string;
  signed: InvoiceSignature;
  /** sha256 of everything above: printed on every copy, so a copy can be checked against ours. */
  fingerprint: string;
  copies: number;
  /** The invoice this one replaced. */
  supersedes?: string;
  /** Replaced by a later one: kept, and said. */
  supersededBy?: string;
  supersededAt?: string;
}

/** An earlier invoice of the load, replaced. */
export class InvoiceEarlier {
  invoiceId: string;
  number: string;
  issuedOn: string;
  signedBy: string;
  signedAt: string;
  supersededAt?: string;
}

/** A load's commercial invoice, as its readers see it. */
export class CommercialInvoiceView {
  freightId: string;
  /** The load crosses a border (its two countries are known and differ): customs will ask for the invoice. */
  crossesBorder: boolean;
  current?: CommercialInvoice;
  earlier: InvoiceEarlier[];
  /** Whether the reader may write a new one: the business that posted the load, a member who may act. */
  mayWrite: boolean;
}
