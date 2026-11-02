import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PinDevicesDto } from './pudo.dto';

/**
 * MESSAGES IN THE CAR — what the Driver app's Settings and the Android app's native part send (car-messages.service.ts;
 * the owner, 2026-11-02: "we start with 2").
 */

/** Settings: is it on here? This browser's device keys (one is this person's), and the app's language. */
export class CarHereDto extends PinDevicesDto {
  /** The Driver app's language (`en`, `sw`, …): a quick reply is read aloud in it. */
  @IsOptional() @IsString() @Matches(/^[a-z]{2}$/) lang?: string;
}

/** Settings, turning it on: the PIN again, on a phone it already works on. */
export class CarOnDto extends CarHereDto {
  @IsString() @MaxLength(12) pin!: string;
}

/** The native part: where Firebase reaches this phone. */
export class CarTokenDto {
  /** The phone's Firebase registration token. */
  @IsString() @MaxLength(4096) token!: string;
}

/**
 * The native part: a spoken reply, as text. Its length is the chat's to refuse, in the chat's own words — this only stops
 * a body no message could ever be.
 */
export class CarReplyDto {
  @IsString() @MaxLength(4000) text!: string;
}

/** The native part: "Mark as read", up to the newest message the notification showed — never past what the car read. */
export class CarReadDto {
  @IsInt() @Min(0) seq!: number;
}
