import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CHECK_ITEMS, DEFECT_ITEMS, OFF_ROAD_REASONS, type CheckItem, type DefectItem, type OffRoadReason } from './vehicle-care.types';

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

export class CareSettingsDto {
  @IsBoolean() requireDailyCheck!: boolean;
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
