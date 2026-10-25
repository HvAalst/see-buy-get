import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AgreementDto } from '../../foundation/documents/documents.types';

class SignupPlaceDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

class SignupNumbersDto {
  @IsString() @MaxLength(64) businessRegistrationNo!: string;
  @IsString() @MaxLength(64) transportOperatorLicence!: string;
  @IsString() @MaxLength(64) taxId!: string;
}

/** The four papers, each the id of a photograph the person signing up took and uploaded themselves. */
export class FleetSignupPapersDto {
  @IsString() @MaxLength(64) businessRegCertRef!: string;
  @IsString() @MaxLength(64) operatorLicenceRef!: string;
  @IsString() @MaxLength(64) ownerIdRef!: string;
  @IsString() @MaxLength(64) proofOfAddressRef!: string;
}

/**
 * A FLEET SIGNS ITSELF UP: the company, its depot, who owns it, its three numbers and its four papers — what a member of
 * staff types into the console for a fleet they register, asked of the fleet instead. `phone` is the number the person
 * signed in with: it becomes the fleet's contact number and the first manager's, and must be theirs.
 */
export class FleetSignupDto {
  @IsString() phone!: string;
  /** The versions of the terms of use, the data notice and the cookie statement read and agreed to (2026-10-25). */
  @IsOptional() @ValidateNested() @Type(() => AgreementDto) agreement?: AgreementDto;
  @IsString() @MaxLength(120) companyName!: string;
  @IsOptional() @IsString() @MaxLength(120) tradingName?: string;
  /** Country of incorporation: which SeeBuyGet company, if any, contracts with the fleet. */
  @IsString() @MaxLength(2) jurisdiction!: string;
  /** Where we write about the sign-up: received, sent back, active. */
  @IsString() @MaxLength(200) contactEmail!: string;
  @IsString() @MaxLength(120) ownerFullName!: string;
  @IsString() @MaxLength(64) ownerNationalId!: string;
  @IsOptional() @IsString() @MaxLength(200) depotAddress?: string;
  @IsOptional() @ValidateNested() @Type(() => SignupPlaceDto) location?: SignupPlaceDto;
  @ValidateNested() @Type(() => SignupNumbersDto) requirements!: SignupNumbersDto;
  @ValidateNested() @Type(() => FleetSignupPapersDto) papers!: FleetSignupPapersDto;
}
