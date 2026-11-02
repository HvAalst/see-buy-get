import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PinDevicesDto, ShopDevicesDto } from './pudo.dto';

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

/*
 * 2026-11-02, later (the owner: "ok go ahead with the fingerprint") — the same for a shop's, a hub's and a store's own
 * sign-in, whose password is the account's. A shop's phone holds ONE key for its account (the app keeps it under the
 * account's address), so these carry that one key, as the shop's phones list does (ShopDevicesDto).
 */

/** Turning it on — step one: this phone's key, and the password again. */
export class AccountPasskeyOptionsDto extends ShopDevicesDto {
  @IsString() @MaxLength(200) password!: string;
}

/** Turning it on — step two: the phone's answer to the challenge it was handed. */
export class AccountPasskeyOnDto extends ShopDevicesDto {
  /** The browser's `PublicKeyCredential` as JSON (a registration response). */
  @IsObject() response!: Record<string, unknown>;
}

/** A sign-in screen: the address the account signs in with, and this phone's key. Answered in the same shape whoever asks. */
export class AccountUnlockOptionsDto {
  @IsString() @MaxLength(254) email!: string;
  @IsOptional() @IsString() @MaxLength(80) device?: string;
}

/** A sign-in screen: the phone's answer, for a ticket the account's own door takes in place of the password. */
export class AccountUnlockDto extends AccountUnlockOptionsDto {
  /** The browser's `PublicKeyCredential` as JSON (an authentication response). */
  @IsObject() response!: Record<string, unknown>;
}
