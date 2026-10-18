import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Who is acting, typed: only on a laptop's shared staff key, where a name is all there is to tell two people apart. */
export class CaseStaffDto {
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

/** A note on a case: what was done or found. */
export class CaseNoteDto {
  @IsString() @MaxLength(500) text!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

/** Done for now: what was done, and in how many hours to look again if the flag is still there. */
export class CaseDoneDto {
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsNumber() @Min(1) @Max(168) recheckHours?: number;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}
