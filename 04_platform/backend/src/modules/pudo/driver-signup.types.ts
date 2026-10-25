import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AgreementDto } from '../../foundation/documents/documents.types';

/** A driver's sign-up: the phone they signed in with, and what the email door's `profile` carried (driver, vehicle). */
export class DriverSignupDto {
  @IsString() phone!: string;
  @IsObject() profile!: Record<string, unknown>;
  /** The versions of the terms of use, the data notice and the cookie statement read and agreed to (2026-10-25). */
  @IsOptional() @ValidateNested() @Type(() => AgreementDto) agreement?: AgreementDto;
}
