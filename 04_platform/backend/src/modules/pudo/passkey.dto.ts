import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PinDevicesDto } from './pudo.dto';

/**
 * 2026-11-02 — unlock with fingerprint or face (passkeys.ts). The phone's own answers travel as the JSON the browser
 * makes of them (`RegistrationResponseJSON`, `AuthenticationResponseJSON`); @simplewebauthn/server reads every field of
 * them and refuses what is not right, so they are taken here as an object and nothing more.
 */

/** Settings, turning it on — step one: this browser's device keys (one is this person's), and the PIN again. */
export class PasskeyOnOptionsDto extends PinDevicesDto {
  @IsString() @MaxLength(12) pin!: string;
}

/** Settings, turning it on — step two: the phone's answer to the challenge it was handed. */
export class PasskeyOnDto extends PinDevicesDto {
  /** The browser's `PublicKeyCredential` as JSON (a registration response). */
  @IsObject() response!: Record<string, unknown>;
}

/** A sign-in screen: the number and this device's key. Answered in the same shape whoever asks. */
export class UnlockOptionsDto {
  @IsString() @MaxLength(40) phone!: string;
  /** The key this device was handed when a code to the phone was typed on it. */
  @IsOptional() @IsString() @MaxLength(120) device?: string;
}

/** A sign-in screen: the phone's answer, for a ticket the app's own door takes in place of the PIN. */
export class UnlockDto extends UnlockOptionsDto {
  /** The browser's `PublicKeyCredential` as JSON (an authentication response). */
  @IsObject() response!: Record<string, unknown>;
}
