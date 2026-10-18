import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclareLostDto {
  /** Where you looked and what you found. The sender reads it; it is the problem on the damage claim report. */
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class FoundAgainDto {
  /** Where it turned up, and in whose hands. */
  @IsString() @MaxLength(300) note!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}
