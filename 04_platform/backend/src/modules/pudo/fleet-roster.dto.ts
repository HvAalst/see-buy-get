import { ArrayMaxSize, IsArray, IsString, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Who drives on a day: the whole list, which replaces what was said for that day before. */
export class SetRosterDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(200, { each: true }) driverDids!: string[];
}

export class RosterDayQueryDto {
  @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) day!: string;
}
