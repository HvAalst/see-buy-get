import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OFF_ROAD_REASONS, type OffRoadReason } from './vehicle-care.types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Take a vehicle off the road: why, from which day, until which (or until it is put back). */
export class TakeOffRoadDto {
  @IsIn(OFF_ROAD_REASONS) reason!: OffRoadReason;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) fromDay?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) untilDay?: string;
}
