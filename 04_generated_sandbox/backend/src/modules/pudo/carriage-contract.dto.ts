import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** P1 — the fleet records a contract it carries under. */
export class CreateContractDto {
  /** Who the fleet carries for — the sender on every order's consignment note until their business links it. */
  @IsString() @MaxLength(120) shipperName!: string;
  /** Their own contract number. Never a price: the terms are between the two of them. */
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @Matches(DAY, { message: 'A start date is a calendar day (YYYY-MM-DD)' }) startsOn?: string;
  @IsOptional() @Matches(DAY, { message: 'An end date is a calendar day (YYYY-MM-DD)' }) endsOn?: string;
}

/** The shipper's business links a contract with the code its fleet sent. */
export class LinkContractDto {
  @IsString() @MaxLength(40) code!: string;
}

export class EndContractDto {
  @IsOptional() @IsString() @MaxLength(280) reason?: string;
}

/**
 * P1b — a sheet of orders: the text of a CSV file, or cells pasted out of a spreadsheet. `dryRun` (the default) judges
 * every line and creates nothing.
 */
export class ImportOrdersDto {
  @IsString() @MaxLength(1_500_000) text!: string;
  /** Where the goods are collected, for every line that does not say otherwise. Both, or neither. */
  @IsOptional() @IsString() @MaxLength(160) pickupLabel?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) pickupLat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) pickupLng?: number;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

/**
 * P3 — what a plan for a day is asked with. Everything but the day has a default; the office changes what is true of
 * its own day (a truck in the workshop, a later start, slower roads).
 */
/** P5 — one order and one vehicle: the two things a plan's rule names. */
export class PlanPairDto {
  @IsString() @MaxLength(80) freightId!: string;
  @IsString() @MaxLength(80) vehicleId!: string;
}

export class PlanDayDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) excludeVehicleIds?: string[];
  @IsOptional() @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: 'A start time is HH:MM' }) dayStart?: string;
  @IsOptional() @Type(() => Number) @IsNumber() dayHours?: number;
  @IsOptional() @Type(() => Number) @IsNumber() speedKmh?: number;
  @IsOptional() @Type(() => Number) @IsNumber() loadMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() unloadMin?: number;
  /** P5 — keep these orders off these vehicles; put these orders on these vehicles. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PlanPairDto) keepOff?: PlanPairDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PlanPairDto) putOn?: PlanPairDto[];
}

/** P5 — one turn of the talk with the adviser so far, as the screen kept it. */
export class AdviserTurnDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MaxLength(4000) text!: string;
}

/** P5 — what the dispatcher says to the adviser, about the plan made with these asks. */
export class AdvisePlanDto {
  @ValidateNested() @Type(() => PlanDayDto) ask!: PlanDayDto;
  @IsString() @MinLength(1) @MaxLength(1000) message!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => AdviserTurnDto) history?: AdviserTurnDto[];
}

export class PlanStateQueryDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
}

/** P4 — name a fleet to hand overflow to. */
export class InvitePartnerDto {
  @IsString() @MaxLength(120) partnerName!: string;
}

/** P4 — orders to offer to partners, or to release to the open board. */
export class HandOnOrdersDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) freightIds!: string[];
}

export class HandBackOrderDto {
  @IsString() @MinLength(3) @MaxLength(280) reason!: string;
}

/** P1b — where an uploaded order is delivered, as a point. */
export class PinOrderDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class WithdrawOrderDto {
  @IsString() @MinLength(3) @MaxLength(280) reason!: string;
}

/** A fleet's orders, by the day they must arrive. Both ends inclusive; absent means unbounded. */
export class FleetOrdersQueryDto {
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) to?: string;
}
