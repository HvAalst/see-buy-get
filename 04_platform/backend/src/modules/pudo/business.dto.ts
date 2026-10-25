import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { AgreementDto } from '../../foundation/documents/documents.types';
import { BUSINESS_ACTIVITIES } from '../../foundation/entity/entity.types';
import { BUSINESS_MEMBER_ROLES } from './business.types';

/** B1 — set up a business, as the person signed in. */
export class CreateBusinessDto {
  @IsString() @MaxLength(120) name!: string;
  /** The versions of the terms of use, the data notice and the cookie statement read and agreed to (2026-10-25). */
  @IsOptional() @ValidateNested() @Type(() => AgreementDto) agreement?: AgreementDto;
  /** Two letters, from the country catalogue. */
  @IsString() @MaxLength(2) country!: string;
  @IsString() @MaxLength(60) registrationNo!: string;
  @IsOptional() @IsString() @MaxLength(60) taxNo?: string;
  @ApiProperty({ enum: BUSINESS_ACTIVITIES, isArray: true }) @IsArray() @ArrayMaxSize(BUSINESS_ACTIVITIES.length) @IsString({ each: true }) activities!: string[];
  /** How the person setting it up appears inside it. */
  @IsString() @MaxLength(80) yourName!: string;
}

/** Change what the business says about itself. Each field sent replaces the one on record. */
/** Round 10 — where a business's own system is told of its loads. Empty stops the messages. */
export class BusinessSystemDto {
  @IsString() @MaxLength(500) url!: string;
}

export class UpdateBusinessDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) registrationNo?: string;
  /** Null clears it. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) @ApiPropertyOptional({ nullable: true }) taxNo?: string | null;
  @IsOptional() @ApiPropertyOptional({ enum: BUSINESS_ACTIVITIES, isArray: true }) @IsArray() @ArrayMaxSize(BUSINESS_ACTIVITIES.length) @IsString({ each: true }) activities?: string[];
}

/** The business's GS1 company prefix, and the extension digit it sets aside for labels printed here. */
export class BusinessGs1Dto {
  /** As GS1 gave it: 6 to 12 digits; spaces and dashes are dropped. */
  @IsString() @MaxLength(24) companyPrefix!: string;
  @IsInt() @Min(0) @Max(9) extensionDigit!: number;
}

/** Add somebody by the phone number they sign in with. */
export class InviteMemberDto {
  @IsString() @MaxLength(24) phone!: string;
  @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ enum: BUSINESS_MEMBER_ROLES }) @IsIn(BUSINESS_MEMBER_ROLES as unknown as string[]) role!: string;
}

export class MemberRoleDto {
  @ApiProperty({ enum: BUSINESS_MEMBER_ROLES }) @IsIn(BUSINESS_MEMBER_ROLES as unknown as string[]) role!: string;
}

/** B4 — a client in an expeditor's book. */
export class BusinessClientDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) contactEmail?: string;
}

export class UpdateBusinessClientDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) contactEmail?: string;
}

export class ArchiveClientDto {
  @IsBoolean() archived!: boolean;
}

/** Staff refuse a check — always with the reason the business will read. */
export class RefuseBusinessDto {
  @IsString() @MaxLength(500) reason!: string;
  /** The shared operator key's typed name. A named staff session's own name always wins. */
  @IsOptional() @IsString() by?: string;
}

export class ApproveBusinessDto {
  @IsOptional() @IsString() by?: string;
}
