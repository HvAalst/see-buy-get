import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { EXPORT_REASONS, InvoiceParty, MAX_INVOICE_LINES, type ExportReason } from './commercial-invoice.types';

/**
 * A STORE PARCEL'S PAPERS ABROAD (the user, round 13: "A store parcel's papers abroad"; per item "As shippers do"; the
 * buyer "shop or address as per the decision of both sender and receiver. Address entered is address carried"; "The
 * store, with the label").
 *
 * The same commercial invoice a shipper's load has (commercial-invoice.types.ts), written by the store's own system when
 * it creates a shipment that crosses a border: line by line, signed with its declaration, three copies printed by the
 * store with the label and put in the pouch. Its HS codes are the store's own, where it has them — never ours. The buyer
 * is named, and their address is the one the store and the buyer settled on, carried exactly as it was entered; or, when
 * none was given, the shop they collect from.
 */

/** Where the buyer's address on the papers came from: as the store entered it, or the shop the parcel is collected from. */
export const IMPORTER_ADDRESS_FROM = ['entered', 'shop'] as const;
export type ImporterAddressFrom = (typeof IMPORTER_ADDRESS_FROM)[number];

/** The longest address carried: longer is refused, never cut — an address entered is the address carried. */
export const MAX_ADDRESS_LENGTH = 300;

export class ParcelInvoiceLine {
  description: string;
  quantity: number;
  netKg: number;
  unitValue: number;
  lineValue: number;
  originCountry: string;
  /** The store's own HS code, where it has one: digits only (6 to 10). Never one of ours. */
  @ApiPropertyOptional() hsCode?: string;
}

export class ParcelInvoice {
  invoiceId: string;
  number: string;
  issuedOn: string;
  parcelId: string;
  vendorId: string;
  exporter: InvoiceParty;
  importer: InvoiceParty;
  @ApiProperty({ enum: IMPORTER_ADDRESS_FROM }) importerAddressFrom: ImporterAddressFrom;
  @ApiProperty({ type: [ParcelInvoiceLine] }) lines: ParcelInvoiceLine[];
  currency: string;
  totalValue: number;
  totalNetKg: number;
  grossKg: number;
  /** The parcel's weight as the store stated it when it created the shipment: what a correction is checked against. */
  @ApiPropertyOptional() statedGrossKg?: number;
  @ApiProperty({ enum: EXPORT_REASONS }) reason: ExportReason;
  declaration: string;
  signed: { name: string; for: string; at: string };
  /** sha256 of everything above: printed on every copy, so a copy can be checked against ours. */
  fingerprint: string;
  copies: number;
  @ApiPropertyOptional() supersedes?: string;
  @ApiPropertyOptional() supersededBy?: string;
  @ApiPropertyOptional() supersededAt?: string;
}

export class ParcelInvoiceView {
  parcelId: string;
  @ApiPropertyOptional({ type: ParcelInvoice }) current?: ParcelInvoice;
  @ApiProperty({ type: [ParcelInvoice] }) earlier: ParcelInvoice[];
  /** Whether it may still be corrected: until the parcel is handed in. */
  correctable: boolean;
}

export class ParcelInvoiceLineDto {
  @IsString() @MaxLength(200) description!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0.001) netKg!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitValue!: number;
  /** ISO 3166 alpha-2: where the goods were made. */
  @IsString() @MaxLength(2) originCountry!: string;
  /** The store's own HS code, where it has one. Never suggested by us. */
  @IsOptional() @IsString() @MaxLength(16) hsCode?: string;
}

export class ParcelInvoiceImporterDto {
  /** The buyer, by name, as the store has it. */
  @IsString() @MaxLength(120) name!: string;
  /** The address the store and the buyer settled on, carried exactly as entered. Absent: the shop the parcel is collected from. */
  @IsOptional() @IsString() @MaxLength(MAX_ADDRESS_LENGTH) address?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNo?: string;
}

/** A store parcel's commercial invoice, as the store's own system sends it. */
export class ParcelInvoiceDto {
  /** The store's own number for the invoice. */
  @IsString() @MaxLength(40) number!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'The invoice date is a day: YYYY-MM-DD' }) issuedOn?: string;
  /** ISO 4217: the money the goods were sold in. */
  @IsString() @Matches(/^[A-Za-z]{3}$/, { message: 'The money is three letters, like KES or USD' }) currency!: string;
  @IsOptional() @IsIn(EXPORT_REASONS as unknown as string[]) reason?: ExportReason;
  /** The store's address as the exporter, where it differs from the one on record. */
  @IsOptional() @IsString() @MaxLength(MAX_ADDRESS_LENGTH) exporterAddress?: string;
  @ValidateNested() @Type(() => ParcelInvoiceImporterDto) importer!: ParcelInvoiceImporterDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_INVOICE_LINES) @ValidateNested({ each: true }) @Type(() => ParcelInvoiceLineDto) lines!: ParcelInvoiceLineDto[];
  /** The store agrees to the declaration: this is its signature. */
  @IsBoolean() @Equals(true, { message: 'Confirm the declaration: that is what signs the invoice' }) declare!: boolean;
}
