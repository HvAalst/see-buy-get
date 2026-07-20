import { ArrayNotEmpty, IsArray, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ParticipantRole } from './participant.types';

export class RegisterDto {
  @IsString()
  fullName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ParticipantRole, { each: true })
  roles!: ParticipantRole[];

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;

  @IsOptional()
  @IsString()
  paymentInstrumentHash?: string;
}

export class AddRoleDto {
  @IsEnum(ParticipantRole)
  role!: ParticipantRole;
}

export class VerifyIdentityDto {
  @IsString()
  governmentId!: string;

  @IsString()
  livenessChallengeId!: string;

  @IsString()
  livenessResponse!: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;
}

export class VerifyBusinessDto {
  @IsString()
  businessName!: string;

  @IsString()
  registrationId!: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;
}
