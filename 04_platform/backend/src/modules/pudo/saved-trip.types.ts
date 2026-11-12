import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/*
 * 2026-11-12 — A SAVED TRIP, LIKE AN ALARM (the owner: "much like an alarm driving route a to b monday to saturday from 5:30 AM
 * and from b to a monday to saturday from 16:00 PM? or several trips selecting the specific day and start time … as a general
 * option, also for a fleet"). One direction, on chosen days of the week, at a start time on its own clock. Before each run a
 * bell notice says how many loads are on the way and opens them in one tap; the evening before a morning run, too, when there
 * are loads already. It never starts a shift or takes a load by itself. A fleet sets its drivers' trips; they see them.
 */

/** Days of the week as the platform counts them: Sunday 0 to Saturday 6 (a week runs Sunday to Saturday). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** 2026-11-12 — a fleet's trip posts each run as a departure this many days ahead (the owner's answer: "a week ahead"). */
export const TRIP_POST_DAYS = 7;
/** The bell before a run: this many minutes ahead. */
export const TRIP_NOTICE_MIN = 30;
/** A run starting before this (minutes into its day) is a morning run: its loads are also said the evening before… */
export const MORNING_ENDS_MIN = 12 * 60;
/** …from this time on the evening before. */
export const EVENING_FROM_MIN = 19 * 60;

export class TripEnd {
  label!: string;
  lat!: number;
  lng!: number;
}

/** A fleet's trip sells its space: on which of its lines, how much, and at what price — each run a departure. */
export class TripSale {
  corridorId!: string;
  @ApiPropertyOptional() capacityKg?: number;
  @ApiProperty({ enum: ['per_trip', 'per_km', 'per_kg'] }) basis!: 'per_trip' | 'per_km' | 'per_kg';
  amount!: number;
}

export interface StoredTrip {
  tripId: string;
  driverDid: string;
  /** Set by its fleet (the driver sees it, never changes it), or by the driver. */
  setBy: 'driver' | 'fleet';
  managerDid?: string;
  name?: string;
  from: TripEnd;
  to: TripEnd;
  days: number[];
  /** HH:MM on the trip's own clock. */
  startTime: string;
  /** The clock it keeps (Africa/Nairobi, Europe/Amsterdam). */
  zone: string;
  minEarn?: number;
  paused?: boolean;
  /** Days skipped, as its clock dates them (YYYY-MM-DD). */
  skips: string[];
  createdAt: string;
  updatedAt: string;
  /** The bells sent for a run, by its day — never twice. */
  noticed?: Record<string, { before?: string; evening?: string }>;
  /** 2026-11-12 — a fleet's trip: the vehicle it goes in, its space for sale, and each run's departure by its day. */
  vehicleId?: string;
  sale?: TripSale;
  posted?: Record<string, string>;
  /** Why the last run could not be posted (a line not published, the vehicle off the road), said to the fleet. */
  postError?: string;
}

export class TripRunView {
  /** The run's day on its own clock, and the time. */
  day!: string;
  clock!: string;
  /** The moment it starts. */
  at!: string;
}

export class SavedTripView {
  tripId!: string;
  @ApiProperty({ enum: ['driver', 'fleet'] }) setBy!: 'driver' | 'fleet';
  @ApiPropertyOptional() name?: string;
  @ApiProperty({ type: TripEnd }) from!: TripEnd;
  @ApiProperty({ type: TripEnd }) to!: TripEnd;
  @ApiProperty({ type: [Number] }) days!: number[];
  startTime!: string;
  zone!: string;
  @ApiPropertyOptional() minEarn?: number;
  paused!: boolean;
  @ApiProperty({ type: [String] }) skips!: string[];
  /** The next run, where there is one (paused: none). */
  @ApiPropertyOptional({ type: TripRunView }) next?: TripRunView;
  /** The driver may change it: their own, not their fleet's. */
  mine!: boolean;
  /** 2026-11-12 — a fleet's trip, as the fleet reads it: its driver, its vehicle, its space for sale and the runs posted. */
  @ApiPropertyOptional() driverDid?: string;
  @ApiPropertyOptional() driverName?: string;
  @ApiPropertyOptional() vehicleId?: string;
  @ApiPropertyOptional() plate?: string;
  @ApiPropertyOptional({ type: TripSale }) sale?: TripSale;
  @ApiPropertyOptional({ type: [TripRunView] }) posted?: TripRunView[];
  @ApiPropertyOptional() postError?: string;
}

/** A trip as the driver (or their fleet) saves it: two named, pinned ends; days; a start time on a clock. */
export class SavedTripDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsString() @MinLength(1) @MaxLength(120) fromLabel!: string;
  @IsNumber() @Min(-90) @Max(90) fromLat!: number;
  @IsNumber() @Min(-180) @Max(180) fromLng!: number;
  @IsString() @MinLength(1) @MaxLength(120) toLabel!: string;
  @IsNumber() @Min(-90) @Max(90) toLat!: number;
  @IsNumber() @Min(-180) @Max(180) toLng!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) days!: number[];
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string;
  /** The phone's own clock (Intl), where it says one; else the driver's country's. */
  @IsOptional() @IsString() @MaxLength(64) zone?: string;
  @IsOptional() @IsNumber() @Min(0) minEarn?: number;
}

export class TripSkipDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) day!: string;
  /** False: the day is driven after all. */
  @IsOptional() @IsBoolean() skip?: boolean;
}

export class TripPauseDto {
  @IsBoolean() paused!: boolean;
}

export const TRIP_SET_BY = ['driver', 'fleet'] as const;
export const TRIP_DAY_WORDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const TRIP_SKIP_DAYS_AHEAD = 60;

export class TripSaleDto {
  @IsString() @MinLength(3) @MaxLength(80) corridorId!: string;
  @IsOptional() @IsNumber() @Min(1) @Max(100000) capacityKg?: number;
  @IsIn(['per_trip', 'per_km', 'per_kg']) basis!: 'per_trip' | 'per_km' | 'per_kg';
  @IsNumber() @Min(0.01) @Max(1e9) amount!: number;
}

/** A fleet sets a trip for one of its drivers, in one of its vehicles — and, where it sells space, on one of its lines. */
export class FleetTripDto extends SavedTripDto {
  @IsString() @MinLength(3) @MaxLength(120) driverDid!: string;
  @IsOptional() @IsString() @MaxLength(80) vehicleId?: string;
  @IsOptional() @ValidateNested() @Type(() => TripSaleDto) sell?: TripSaleDto;
}
