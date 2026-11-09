import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AddressPartsDto } from './address-parts.dto';
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
  /** The sender's address on its consignment notes. Null clears it. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) @ApiPropertyOptional({ nullable: true }) address?: string | null;
  /**
   * The same in its country's parts (the owner, 2026-11-01: "it goes on invoices"): checked by the field, and printed as
   * one line in the country's own order. Null clears the address.
   */
  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => AddressPartsDto) @ApiPropertyOptional({ type: () => AddressPartsDto, nullable: true }) addressParts?: AddressPartsDto | null;
  @IsOptional() @ApiPropertyOptional({ enum: BUSINESS_ACTIVITIES, isArray: true }) @IsArray() @ArrayMaxSize(BUSINESS_ACTIVITIES.length) @IsString({ each: true }) activities?: string[];
  /** 2026-11-09 — its Global Location Number (13 digits, from GS1). `null` or empty: it has none. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(24) @ApiPropertyOptional({ nullable: true }) gln?: string | null;
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
  /** 2026-11-09 — the client's Global Location Number, from GS1, where it has one: it is the sender on the notes. */
  @IsOptional() @IsString() @MaxLength(24) gln?: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) contactEmail?: string;
}

export class UpdateBusinessClientDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  /** 2026-11-09 — its GLN; empty: it has none. */
  @IsOptional() @IsString() @MaxLength(24) gln?: string;
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
