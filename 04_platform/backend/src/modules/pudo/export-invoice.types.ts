import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { INCOTERMS, type Incoterm } from '../m2/schema/ewaybill-schema';
import { EXPORT_REASONS, type ExportReason } from './commercial-invoice.types';

/**
 * THE COMMERCIAL INVOICE ON AN EXPORT (the user, 2026-10-28: "right call, build it, but keep in mind that it must be a
 * flexible document since it is virtually different in every nation").
 *
 * Drawn from the same lines as the packing list — its prices read from the same file — so the invoice, the list and the
 * letter of instruction cannot disagree. A FIXED CORE every invoice carries (seller and buyer, its number and date, the
 * currency, the trade term, the lines with their values, the charges and the total, and a declaration signed), and a
 * FLEXIBLE REST the exporter shapes for where the goods are going: particulars by name (a buyer's import number, an
 * order number, a licence), declarations in the words that country asks for (an origin statement), which of the list's
 * own columns are printed. No nation's rules are written in here: what an invoice to a country needed is REMEMBERED from
 * the business's own last invoice there, and offered on the next. We compute no duty and classify nothing.
 */

export class InvoiceParty {
  @ApiProperty() name: string;
  @ApiProperty() address: string;
  /** A tax, import or registration number as that party's country knows it — named by the exporter, never assumed. */
  @ApiPropertyOptional() taxId?: string;
  @ApiPropertyOptional() contact?: string;
}

/** A charge beside the goods' value: freight, insurance, or another, by name. A discount is a charge below zero. */
export class InvoiceCharge {
  @ApiProperty() label: string;
  @ApiProperty() amount: number;
}

/** A particular the destination asks for, by its own name: "Buyer's EORI number", "Import licence", "Order number". */
export class InvoiceField {
  @ApiProperty() label: string;
  @ApiProperty() value: string;
}

/** The invoice as the exporter left it. */
export class InvoiceDraft {
  @ApiProperty() number: string;
  /** YYYY-MM-DD. */
  @ApiProperty() date: string;
  /** Three letters; the goods' values are in it. */
  @ApiProperty() currency: string;
  @ApiPropertyOptional({ enum: INCOTERMS }) incoterm?: Incoterm;
  @ApiPropertyOptional() incotermPlace?: string;
  @ApiPropertyOptional() paymentTerms?: string;
  @ApiProperty({ enum: EXPORT_REASONS }) reason: ExportReason;
  @ApiPropertyOptional({ type: InvoiceParty }) buyer?: InvoiceParty;
  /** The consignee is the buyer, or as the letter of instruction names it. */
  @ApiPropertyOptional() consigneeIsBuyer?: boolean;
  @ApiProperty({ type: [InvoiceCharge] }) charges: InvoiceCharge[];
  @ApiProperty({ type: [InvoiceField] }) fields: InvoiceField[];
  /** In the words the destination asks for. The truth of the invoice is declared on every one. */
  @ApiProperty({ type: [String] }) declarations: string[];
  /** Which of the packing list's own columns the invoice prints too (a batch, a lot). */
  @ApiProperty({ type: [String] }) columns: string[];
  @ApiProperty() savedAt: string;
  @ApiProperty() savedBy: string;
}

export class InvoiceVersion {
  @ApiProperty() version: number;
  @ApiProperty() signedBy: string;
  @ApiProperty() signedAt: string;
  /** sha256 of the frozen page's bytes. */
  @ApiProperty() fingerprint: string;
  /** sha256 of the lines it was drawn from: a changed list is a changed invoice. */
  @ApiProperty() basis: string;
  @ApiProperty() total: number;
  @ApiProperty() currency: string;
}

export class ExportInvoice {
  @ApiPropertyOptional({ type: InvoiceDraft }) draft?: InvoiceDraft;
  @ApiProperty({ type: [InvoiceVersion] }) versions: InvoiceVersion[];
}

/** What an invoice to this country carried last time, for this business: offered on the next, never imposed. */
export class InvoiceTemplate {
  @ApiProperty() destCountry: string;
  @ApiProperty({ type: [String] }) fieldLabels: string[];
  @ApiProperty({ type: [String] }) declarations: string[];
  @ApiPropertyOptional() paymentTerms?: string;
  @ApiProperty() fromExport: string;
}

export class InvoiceTotals {
  @ApiProperty() lines: number;
  @ApiProperty() goods: number;
  @ApiProperty() charges: number;
  @ApiProperty() total: number;
  /** Lines that carry no value — the invoice is not signed while there are any. */
  @ApiProperty() unvalued: number;
  /** Lines without an HS code or a country of origin: many destinations ask for both, so said, never refused. */
  @ApiProperty() withoutHs: number;
  @ApiProperty() withoutOrigin: number;
}

export class ExportInvoiceView {
  @ApiPropertyOptional({ type: InvoiceDraft }) draft?: InvoiceDraft;
  @ApiProperty({ type: [InvoiceVersion] }) versions: InvoiceVersion[];
  @ApiProperty({ type: InvoiceTotals }) totals: InvoiceTotals;
  /** What signing still needs, in words. */
  @ApiProperty({ type: [String] }) gaps: string[];
  /** Said, not refused: what many destinations ask for that this one does not carry. */
  @ApiProperty({ type: [String] }) notes: string[];
  /** The list changed since the last signed version. */
  @ApiProperty() stale: boolean;
  /** What this business's last invoice to this country carried — offered while there is no draft. */
  @ApiPropertyOptional({ type: InvoiceTemplate }) template?: InvoiceTemplate;
  /** A currency the packing list's price headings named. */
  @ApiPropertyOptional() currencyFromList?: string;
  /** The packing list's own columns, which the invoice may print. */
  @ApiProperty({ type: [String] }) listColumns: string[];
  /** The declaration every invoice carries, in our words — the exporter may add its own beside it. */
  @ApiProperty() truth: string;
}

/* -------------------------------------------------------------------- requests -- */

export class InvoicePartyDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(400) address!: string;
  @IsOptional() @IsString() @MaxLength(60) taxId?: string;
  @IsOptional() @IsString() @MaxLength(120) contact?: string;
}

export class InvoiceChargeDto {
  @IsString() @MaxLength(60) label!: string;
  @IsNumber() @Min(-10_000_000) @Max(10_000_000) amount!: number;
}

export class InvoiceFieldDto {
  @IsString() @MaxLength(60) label!: string;
  @IsString() @MaxLength(200) value!: string;
}

export class InvoiceDraftDto {
  @IsOptional() @IsString() @MaxLength(40) number?: string;
  @IsOptional() @IsString() @MaxLength(10) date?: string;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsIn(INCOTERMS) incoterm?: Incoterm;
  @IsOptional() @IsString() @MaxLength(80) incotermPlace?: string;
  @IsOptional() @IsString() @MaxLength(200) paymentTerms?: string;
  @IsOptional() @IsIn(EXPORT_REASONS) reason?: ExportReason;
  @IsOptional() @ValidateNested() @Type(() => InvoicePartyDto) buyer?: InvoicePartyDto;
  @IsOptional() @IsBoolean() consigneeIsBuyer?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => InvoiceChargeDto) charges?: InvoiceChargeDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => InvoiceFieldDto) fields?: InvoiceFieldDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(1200, { each: true }) declarations?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(80, { each: true }) columns?: string[];
}

export class InvoiceSignDto {
  @IsString() @MaxLength(120) signatory!: string;
}
