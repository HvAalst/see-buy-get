import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** 2026-11-21 — "I bought it": the plate whose owner is asked whether they sold it. */
export class PlateClaimAskDto {
  @IsString() @MaxLength(32) plate!: string;
}

/** The owner's answer: sold (it comes off their vehicles now), or still theirs. */
export class PlateClaimAnswerDto {
  @IsBoolean() sold!: boolean;
}

/** Staff decide a claim nobody answered — with a reason both are told. */
export class PlateClaimDecisionDto {
  @IsString() @MaxLength(40) claimId!: string;
  /** True: take the vehicle off its owner's list. False: leave it. */
  @IsBoolean() release!: boolean;
  @IsOptional() @IsString() @MaxLength(400) reason?: string;
  /** The member of staff, by name, where the sign-in is shared. */
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}
