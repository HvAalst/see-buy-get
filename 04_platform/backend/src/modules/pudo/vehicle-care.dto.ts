import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { BREAKDOWN_CAUSES, CHECK_ITEMS, DEFECT_ITEMS, OFF_ROAD_REASONS, SERVICE_KINDS, type BreakdownCause, type CheckItem, type DefectItem, type OffRoadReason, type ServiceKind } from './vehicle-care.types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The largest odometer reading taken: a number past it is a typing slip, not a vehicle. */
export const MAX_ODOMETER_KM = 9_999_999;

/** What the odometer says, in whole kilometres — by the office, at a service or when a meter is replaced. */
export class RecordReadingDto {
  @IsInt() @Min(0) @Max(MAX_ODOMETER_KM) km!: number;
  /** A new meter: this reading may be lower than the last, and starts again from here. */
  @IsOptional() @IsBoolean() newMeter?: boolean;
}

/** One item of a daily check: fine, or not — and what is wrong, in words or a photograph. */
export class CheckAnswerDto {
  @IsIn(CHECK_ITEMS) item!: CheckItem;
  @IsBoolean() ok!: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() @MaxLength(80) photoRef?: string;
}

/** A daily check of the vehicle named (as picked, or by its QR): every item of its class answered. */
export class VehicleCheckDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() vehicleQr?: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CheckAnswerDto) answers!: CheckAnswerDto[];
}

/** A defect found at any time: what, in words (and a photograph), and whether the driver thinks it is safe to drive. */
export class ReportDefectDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsIn(DEFECT_ITEMS) item!: DefectItem;
  @IsString() @MaxLength(300) note!: string;
  @IsOptional() @IsString() @MaxLength(80) photoRef?: string;
  @IsBoolean() safe!: boolean;
}

/** The office's word on a defect: fixed, or safe to drive as it is — with why. */
export class DecideDefectDto {
  @IsIn(['fixed', 'cleared']) decision!: 'fixed' | 'cleared';
  @IsString() @MaxLength(300) note!: string;
}

/** Broken down: what happened, a photo, and where the phone is now — when it can say. */
export class ReportBreakdownDto {
  @IsIn(BREAKDOWN_CAUSES) cause!: BreakdownCause;
  @IsString() @MaxLength(300) note!: string;
  @IsOptional() @IsString() @MaxLength(80) photoRef?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

/** How a breakdown ended: back on the road, or into the workshop (until a day, or until put back) — with what was done. */
export class ResolveBreakdownDto {
  @IsIn(['back_on_road', 'workshop']) outcome!: 'back_on_road' | 'workshop';
  @IsString() @MaxLength(300) note!: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) untilDay?: string;
}

/** A fleet's upkeep rules: either or both. What is not sent stays as it was. */
export class CareSettingsDto {
  @IsOptional() @IsBoolean() requireDailyCheck?: boolean;
  @IsOptional() @IsIn(['warn', 'off_road']) serviceOverdue?: 'warn' | 'off_road';
}

/** How often a vehicle is serviced — or back to its class's usual. */
export class ServicePlanDto {
  @IsOptional() @IsInt() @Min(500) @Max(200_000) everyKm?: number;
  @IsOptional() @IsInt() @Min(1) @Max(36) everyMonths?: number;
  @IsOptional() @IsBoolean() useClassUsual?: boolean;
}

/** What was done to it: the day, what, the odometer then, the workshop, and its job card. No costs, no parts. */
export class ServiceRecordDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
  @IsIn(SERVICE_KINDS) what!: ServiceKind;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_ODOMETER_KM) km?: number;
  @IsOptional() @IsString() @MaxLength(120) workshop?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() @MaxLength(80) photoRef?: string;
}

export class CheckSheetQueryDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() vehicleQr?: string;
}

/** Take a vehicle off the road: why, from which day, until which (or until it is put back). */
export class TakeOffRoadDto {
  @IsIn(OFF_ROAD_REASONS) reason!: OffRoadReason;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) fromDay?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) untilDay?: string;
}
