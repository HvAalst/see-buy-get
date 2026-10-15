import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { OFF_ROAD_REASONS, type OffRoadReason } from './vehicle-care.types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The largest odometer reading taken: a number past it is a typing slip, not a vehicle. */
export const MAX_ODOMETER_KM = 9_999_999;

/** What the odometer says, in whole kilometres — by the office, at a service or when a meter is replaced. */
export class RecordReadingDto {
  @IsInt() @Min(0) @Max(MAX_ODOMETER_KM) km!: number;
  /** A new meter: this reading may be lower than the last, and starts again from here. */
  @IsOptional() @IsBoolean() newMeter?: boolean;
}

/** Take a vehicle off the road: why, from which day, until which (or until it is put back). */
export class TakeOffRoadDto {
  @IsIn(OFF_ROAD_REASONS) reason!: OffRoadReason;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) fromDay?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) untilDay?: string;
}
