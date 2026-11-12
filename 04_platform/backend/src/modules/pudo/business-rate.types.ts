import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/*
 * 2026-11-12 — A LARGE SENDER'S OWN RATE (the owner's D3 on the plan "Hubs on the Road": "Large senders negotiate. On a fixed
 * card they get their own lower card — volume tiers or a contract card for one business account; on factors, a discount on
 * the formula"). Built first: the contract card and the discount (volume tiers later). Set by the country's staff for one
 * sender account (a store or a business), approved by a second member of staff, ended by staff; every change logged.
 * The network carries what it gives away: hubs and shops are paid their own fees as before.
 */

export const BUSINESS_RATE_KINDS = ['card', 'discount'] as const;
export type BusinessRateKind = (typeof BUSINESS_RATE_KINDS)[number];
/** The most a discount may take off the formula's price. */
export const MAX_DISCOUNT_PCT = 0.5;

export interface StoredBusinessRate {
  entityId: string;
  vendorId: string;
  kind: BusinessRateKind;
  /** card: a price for each weight, at the weights of the country's fixed card when it was set. */
  steps?: number[];
  prices?: number[];
  /** card: the price of each kg above the last weight. */
  perExtraKg?: number;
  /** discount: taken off the formula's price, 0.1 = 10%. */
  discountPct?: number;
  note?: string;
  status: 'proposed' | 'approved';
  proposedBy: string;
  /** The account that proposed it: who may not approve it. */
  proposedById: string;
  proposedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface StoredBusinessRates {
  key: string;
  /** In force, where one is approved. */
  approved?: StoredBusinessRate;
  /** Waiting for a second member of staff. */
  proposed?: StoredBusinessRate;
}

export class BusinessRateTerms {
  @ApiProperty({ enum: BUSINESS_RATE_KINDS }) kind!: BusinessRateKind;
  @ApiPropertyOptional({ type: [Number] }) steps?: number[];
  @ApiPropertyOptional({ type: [Number] }) prices?: number[];
  @ApiPropertyOptional() perExtraKg?: number;
  @ApiPropertyOptional() discountPct?: number;
  @ApiPropertyOptional() note?: string;
  proposedBy!: string;
  proposedAt!: string;
  @ApiPropertyOptional() approvedBy?: string;
  @ApiPropertyOptional() approvedAt?: string;
}

export class BusinessRateRow {
  vendorId!: string;
  /** The sender's name: its store's, or its business's. */
  name!: string;
  @ApiPropertyOptional({ type: BusinessRateTerms }) approved?: BusinessRateTerms;
  @ApiPropertyOptional({ type: BusinessRateTerms }) proposed?: BusinessRateTerms;
  /** The rate in force prices nothing while the country prices the other way: a card on factors, a discount on a fixed card. */
  @ApiProperty() idle!: boolean;
}

export class BusinessRateSender {
  vendorId!: string;
  name!: string;
}

export class BusinessRatesView {
  entityId!: string;
  currency!: string;
  /** How parcels are priced in the country: a contract card applies on a fixed card, a discount by factors. */
  @ApiProperty({ enum: ['fixed', 'factors'] }) mode!: 'fixed' | 'factors';
  /** The weights a new contract card has a price for: the country's fixed card in force, else its starting sizes. */
  @ApiProperty({ type: [Number] }) steps!: number[];
  @ApiProperty({ type: [BusinessRateRow] }) rows!: BusinessRateRow[];
  /** The country's sender accounts, to choose from. */
  @ApiProperty({ type: [BusinessRateSender] }) senders!: BusinessRateSender[];
}

/** What a sender sees of its own rate. */
export class OwnBusinessRate {
  @ApiProperty({ enum: BUSINESS_RATE_KINDS }) kind!: BusinessRateKind;
  @ApiPropertyOptional({ type: [Number] }) steps?: number[];
  @ApiPropertyOptional({ type: [Number] }) prices?: number[];
  @ApiPropertyOptional() perExtraKg?: number;
  @ApiPropertyOptional() discountPct?: number;
  @ApiProperty() since!: string;
  @ApiProperty() idle!: boolean;
}

/** Staff propose a sender's rate: a contract card (a price for each weight) or a discount. */
export class BusinessRateDto {
  @IsString() @MinLength(3) @MaxLength(80) vendorId!: string;
  @IsIn([...BUSINESS_RATE_KINDS]) kind!: BusinessRateKind;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsNumber({}, { each: true }) prices?: number[];
  @IsOptional() @IsNumber() @Min(0) @Max(1e9) perExtraKg?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(MAX_DISCOUNT_PCT) discountPct?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
