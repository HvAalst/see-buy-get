import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { EXPORT_REASONS, MAX_INVOICE_LINES } from './commercial-invoice.types';

/** The buyer the goods go to. */
export class InvoiceImporterDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  /** ISO 3166 alpha-2. */
  @IsString() @MaxLength(2) country!: string;
  @IsOptional() @IsString() @MaxLength(60) taxNo?: string;
}

/** One line of what is in the shipment. */
export class InvoiceLineDto {
  @IsString() @MaxLength(200) description!: string;
  @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  /** The line's net weight, in kg. */
  @IsNumber() @Min(0) netKg!: number;
  /** The value of ONE item, in the invoice's currency. */
  @IsNumber() @Min(0) unitValue!: number;
  /** ISO 3166 alpha-2: where the goods were made. */
  @IsString() @MaxLength(2) originCountry!: string;
  /** As you or your customs agent classify the goods: 6 to 10 digits, dots allowed. SeeBuyGet suggests none. */
  @IsString() @MaxLength(16) hsCode!: string;
}

/** Our own paper invoice travels with the goods — or no longer. */
export class OwnInvoicePaperDto {
  @IsBoolean() travels!: boolean;
}

/** A load's commercial invoice, written and signed by the business that posted the load. */
export class CommercialInvoiceDto {
  /** Your own number for this invoice. */
  @IsString() @MaxLength(40) number!: string;
  /** YYYY-MM-DD; today when not given. */
  @IsOptional() @IsString() @MaxLength(10) issuedOn?: string;
  /** Where the goods leave from, as the invoice should say it; the load's pickup place when not given. */
  @IsOptional() @IsString() @MaxLength(200) exporterAddress?: string;
  @ValidateNested() @Type(() => InvoiceImporterDto) importer!: InvoiceImporterDto;
  /** ISO 4217, like KES or USD. */
  @IsString() @MaxLength(3) currency!: string;
  @IsOptional() @IsIn(EXPORT_REASONS as unknown as string[]) @ApiPropertyOptional({ enum: EXPORT_REASONS }) reason?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_INVOICE_LINES) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines!: InvoiceLineDto[];
  /** I declare that the information on this invoice is true and correct: this is the signature. */
  @IsBoolean() declare!: boolean;
}
