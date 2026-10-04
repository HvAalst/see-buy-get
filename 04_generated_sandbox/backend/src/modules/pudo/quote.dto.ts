import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Paid, or back to open — with the payment's own reference, when there is one. */
export class QuoteStatusDto {
  @IsIn(['open', 'paid']) @ApiProperty({ enum: ['open', 'paid'] }) status!: 'open' | 'paid';
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

/** The proforma invoice, as a data URL — PDF, PNG or JPEG. */
export class QuoteProformaDto {
  @IsString() dataUrl!: string;
  @IsOptional() @IsString() @MaxLength(120) fileName?: string;
}

/** What a carrier asked to be paid for a load or a booking, as the shipper recorded it. Every field defaults to the agreed price. */
export class RecordCarrierQuoteDto {
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
