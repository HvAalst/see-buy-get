import { IsObject, IsString } from 'class-validator';

/** A driver's sign-up: the phone they signed in with, and what the email door's `profile` carried (driver, vehicle). */
export class DriverSignupDto {
  @IsString() phone!: string;
  @IsObject() profile!: Record<string, unknown>;
}
