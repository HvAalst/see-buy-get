import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * An address in the parts its country writes (2026-10-30): which are asked, and checked, is the country's to say
 * (foundation/countries/address-format.ts).
 *
 * IN A FILE OF ITS OWN, importing nothing of the app's, on purpose: a person's profile (pudo.dto) and a business's
 * details (business.dto, business.types) both carry it, and business.types importing pudo.dto made a circle that left
 * a service's dependency undefined at start-up — "Nest can't resolve dependencies of the RatingService" (2026-11-01).
 */
export class AddressPartsDto {
  @IsString() @Matches(/^[A-Za-z]{2}$/) country!: string;
  @IsOptional() @IsString() @MaxLength(120) building?: string;
  @IsOptional() @IsString() @MaxLength(120) street?: string;
  @IsOptional() @IsString() @MaxLength(120) number?: string;
  @IsOptional() @IsString() @MaxLength(120) addition?: string;
  @IsOptional() @IsString() @MaxLength(120) line?: string;
  @IsOptional() @IsString() @MaxLength(120) area?: string;
  @IsOptional() @IsString() @MaxLength(120) poBox?: string;
  @IsOptional() @IsString() @MaxLength(120) postcode?: string;
  @IsOptional() @IsString() @MaxLength(120) town?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
}
