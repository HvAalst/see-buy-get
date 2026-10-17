import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, Matches, MaxLength, IsOptional, ValidateNested } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Who drives on a day: the whole list, which replaces what was said for that day before. */
export class SetRosterDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(200, { each: true }) driverDids!: string[];
  /** Where a driver starts that day, where it is not their home site. Absent: everybody from home. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => RosterStartDto) starts?: RosterStartDto[];
}

export class RosterStartDto {
  @IsString() @MaxLength(200) driverDid!: string;
  @IsString() @MaxLength(40) siteId!: string;
  /** Which shift of that site. Absent: the site's first. */
  @IsOptional() @IsString() @MaxLength(40) shiftId?: string;
}

export class RosterDayQueryDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
}
