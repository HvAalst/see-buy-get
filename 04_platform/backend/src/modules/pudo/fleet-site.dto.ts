import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { MAX_SHIFTS } from './fleet-site.types';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A shift as the office writes it. Without an id it is a new one; with one, the one it names. */
export class SiteShiftDto {
  @IsOptional() @IsString() @MaxLength(40) shiftId?: string;
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @Matches(HHMM, { message: 'A start time is HH:MM' }) start!: string;
  @IsNumber() @Min(1) @Max(13) hours!: number;
}

/** A new site, or what changes about one: what is not sent stays as it was. */
export class SiteDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  /** Open for loading, day by day ({ mon: { open: '06:00', close: '18:00' }, sun: null }). `null` here: it never closes. */
  @IsOptional() @IsObject() hours?: Record<string, { open: string; close: string } | null> | null;
  @IsOptional() @IsInt() @Min(1) @Max(50) loadingBays?: number;
  /** The whole list of shifts, replacing what was there. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_SHIFTS) @ValidateNested({ each: true }) @Type(() => SiteShiftDto) shifts?: SiteShiftDto[];
}

/** Where a vehicle or a driver works from. */
export class SiteHomeDto {
  @IsIn(['vehicle', 'driver']) kind!: 'vehicle' | 'driver';
  @IsString() @MaxLength(200) id!: string;
  @IsString() @MaxLength(40) siteId!: string;
}
