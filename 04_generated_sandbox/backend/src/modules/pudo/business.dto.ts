import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { BUSINESS_ACTIVITIES } from '../../foundation/entity/entity.types';
import { BUSINESS_MEMBER_ROLES } from './business.types';

/** B1 — set up a business, as the person signed in. */
export class CreateBusinessDto {
  @IsString() @MaxLength(120) name!: string;
  /** Two letters, from the country catalogue. */
  @IsString() @MaxLength(2) country!: string;
  @IsString() @MaxLength(60) registrationNo!: string;
  @IsOptional() @IsString() @MaxLength(60) taxNo?: string;
  @ApiProperty({ enum: BUSINESS_ACTIVITIES, isArray: true }) @IsArray() @ArrayMaxSize(BUSINESS_ACTIVITIES.length) @IsString({ each: true }) activities!: string[];
  /** How the person setting it up appears inside it. */
  @IsString() @MaxLength(80) yourName!: string;
}

/** Change what the business says about itself. Each field sent replaces the one on record. */
export class UpdateBusinessDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) registrationNo?: string;
  /** Null clears it. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) @ApiPropertyOptional({ nullable: true }) taxNo?: string | null;
  @IsOptional() @ApiPropertyOptional({ enum: BUSINESS_ACTIVITIES, isArray: true }) @IsArray() @ArrayMaxSize(BUSINESS_ACTIVITIES.length) @IsString({ each: true }) activities?: string[];
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

/** Staff refuse a check — always with the reason the business will read. */
export class RefuseBusinessDto {
  @IsString() @MaxLength(500) reason!: string;
  /** The shared operator key's typed name. A named staff session's own name always wins. */
  @IsOptional() @IsString() by?: string;
}

export class ApproveBusinessDto {
  @IsOptional() @IsString() by?: string;
}
