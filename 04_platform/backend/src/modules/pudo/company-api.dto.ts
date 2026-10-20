import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A business's system withdraws one of its loads nobody has taken yet, and says why. */
/** Round 33 — a photograph a business's system sends before naming it (a seal's three photographs). */
export class CompanyPhotoDto {
  /** The photo as a data URL: data:image/jpeg;base64,… (JPEG, PNG or WebP, up to 500 KB). */
  @IsString() dataUrl!: string;
  /** A small thumbnail the same way, up to 64 KB. */
  @IsOptional() @IsString() thumbDataUrl?: string;
}

export class WithdrawLoadDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

/** One order a fleet's own system sends in: the columns of the order sheet, by name (order-sheet.ts). */
export class ApiOrderDto {
  /** The shipper's own order number: used once under a contract. */
  @IsString() @MaxLength(60) reference!: string;
  @IsString() @MaxLength(200) goods!: string;
  @Type(() => Number) @IsNumber() @Min(0.1) weightKg!: number;
  @IsString() @MaxLength(200) deliverTo!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) deliverOn!: string;
  @IsOptional() @IsString() @MaxLength(40) window?: string;
  @IsOptional() @IsString() @MaxLength(80) contact?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(40) packaging?: string;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
}

/** Orders a fleet's own system sends in under one of its contracts — checked exactly as an uploaded sheet is. */
export class SendOrdersDto {
  @IsString() contractId!: string;
  /** Where the goods are collected, for every order that does not say otherwise. Both, or neither. */
  @IsOptional() @IsString() @MaxLength(160) pickupLabel?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) pickupLat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) pickupLng?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ApiOrderDto) orders!: ApiOrderDto[];
}

/** A board load a fleet's system takes, at its price, for one of its drivers on a shift. */
export class TakeLoadDto {
  @IsString() driverDid!: string;
}

export class ApiBoardQueryDto {
  /** One of the fleet's drivers on a shift: the board is read for that driver's vehicle. */
  @ApiPropertyOptional() @IsOptional() @IsString() driverDid?: string;
}

export class ApiPlanQueryDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
}

export class ApiOrdersQueryDto {
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) to?: string;
}
