import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** The Kenyan company's tax invoices: one company's, in one state, a page at a time. */
export class FiscalInvoiceQueryDto {
  @IsOptional() @IsString() @MaxLength(40) entityId?: string;
  @IsOptional() @IsIn(['waiting', 'recorded', 'refused', 'needs_check', 'not_sendable']) state?: 'waiting' | 'recorded' | 'refused' | 'needs_check' | 'not_sendable';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
