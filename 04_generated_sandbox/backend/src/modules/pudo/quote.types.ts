import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A QUOTATION — what one party asked another to pay for a piece of work, and whether it has been paid.
 *
 * The user, 2026-10-04: "we don't manage the clearing agent's fee, but we do handle quotations for anyone. Like
 * proforma invoices are common so we have a field for it, but the user needs to confirm open/paid. That keeps all
 * vital information in one place."
 *
 * So this is a RECORD AND NEVER A POSTING. No money moves through SeeBuyGet for it, nothing lands on any company's
 * books, and "paid" means a party to it said so — dated, attributed and kept, the same way a free-days claim is
 * carried. When a business connects its own payment network (B5), that network will say so through the same field.
 *
 * What it is about: `import` an agent's fee for clearing a container · `freight` the carrier's price for a load a
 * business posted · `booking` the carrier's price for space a business booked on a run.
 */
export const QUOTE_SUBJECTS = ['import', 'freight', 'booking'] as const;
export type QuoteSubjectKind = (typeof QUOTE_SUBJECTS)[number];

export const QUOTE_STATUSES = ['open', 'paid'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** A party to a quotation: a company by entityId, or anybody else by DID, always with a name to show. */
export class QuoteParty {
  @ApiProperty() name: string;
  @ApiPropertyOptional() entityId?: string;
  @ApiPropertyOptional() did?: string;
}

export class QuoteSubject {
  @ApiProperty({ enum: QUOTE_SUBJECTS }) kind: QuoteSubjectKind;
  @ApiProperty() id: string;
  /** What a person reads it as — IMP-004, FRT-012. */
  @ApiPropertyOptional() code?: string;
}

/** The proforma invoice, kept exactly as it was handed over, with the fingerprint of its bytes. */
export class QuoteProforma {
  @ApiProperty() fileName: string;
  @ApiProperty() contentType: string;
  @ApiProperty() size: number;
  /** sha256 of the bytes. Never called `hash`: the response mask strips that name at every depth. */
  @ApiProperty() fingerprint: string;
  @ApiProperty() addedBy: string;
  @ApiProperty() addedAt: string;
}

/** One thing that happened to a quotation. Nothing is overwritten: a correction is a second line. */
export class QuoteEvent {
  @ApiProperty() at: string;
  @ApiProperty() by: string;
  @ApiProperty({ enum: ['quoted', 'requoted', 'proforma', 'agreed', 'paid', 'open'] }) what: 'quoted' | 'requoted' | 'proforma' | 'agreed' | 'paid' | 'open';
  @ApiPropertyOptional() note?: string;
}

export class Quote {
  @ApiProperty() quoteId: string;
  @ApiProperty({ type: QuoteSubject }) subject: QuoteSubject;
  /** Who is asking to be paid — the agent, the carrier. */
  @ApiProperty({ type: QuoteParty }) issuer: QuoteParty;
  /** Who is asked to pay — the importer, the business. */
  @ApiProperty({ type: QuoteParty }) payer: QuoteParty;
  @ApiProperty() amount: number;
  /** Whatever currency the parties agreed in. Ours to show, never to convert. */
  @ApiProperty() currency: string;
  @ApiPropertyOptional() note?: string;
  /** Their own number for it — the quotation or invoice number on the proforma. */
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional({ type: QuoteProforma }) proforma?: QuoteProforma;
  /** The payer agreed to the figure. Not every quotation asks for it; a run's published price was agreed by booking. */
  @ApiPropertyOptional() agreedAt?: string;
  @ApiPropertyOptional() agreedBy?: string;
  @ApiProperty({ enum: QUOTE_STATUSES }) status: QuoteStatus;
  @ApiPropertyOptional() paidAt?: string;
  @ApiPropertyOptional() paidBy?: string;
  /** The payment's own reference, as the person confirming it gave it — a bank or mobile-money transaction. */
  @ApiPropertyOptional() paidReference?: string;
  @ApiProperty({ type: [QuoteEvent] }) history: QuoteEvent[];
  @ApiProperty() createdAt: string;
  @ApiProperty() createdBy: string;
}
