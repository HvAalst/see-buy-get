import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { GeoPoint } from './pudo.types';

/**
 * A SEAL ON A LOAD (the user, round 15: "shipper writes driver matches according to iso 17712 including the required
 * photographs etc"; "None required"; the re-seal "With the clearing step"; a broken one "Reported at once; damage
 * report").
 *
 * A seal is the proof that nobody opened the load between two people who looked: the shipper who closed it and wrote the
 * number down, and whoever reads the number next. So the number the shipper writes is the one the driver must find on the
 * door — read, never copied: the driver's app does not show it — and every later reading is kept beside it: customs
 * opening the load at a post and sealing it again, a seal found broken on the road, the receiver's look at the door.
 *
 * ISO 17712 sorts seals by what they withstand: I (indicative), S (security), H (high security). A high-security seal
 * carries a unique number and its maker's name or logo; the shipper writes both as they are marked. Any country's seals
 * fit — a bolt, a cable, an electronic seal with a number — and no load waits for one: a seal is recorded when there is one.
 *
 * KEPT BESIDE THE LOAD, like its steps on the road: a reading names the driver who made it. What the shipper, the systems,
 * the note and the tracking page read is the seal and what became of it, never who read it.
 */
export const SEAL_CLASSES = ['I', 'S', 'H'] as const;
export type SealClass = (typeof SEAL_CLASSES)[number];
/** Who closed it: the shipper's own seal, or an official customs seal (an office of departure, an authorised trader). */
export const SEAL_APPLIED_BY = ['sender', 'customs'] as const;
export type SealAppliedBy = (typeof SEAL_APPLIED_BY)[number];
export const SEAL_STATES = ['on', 'replaced', 'broken'] as const;
export type SealState = (typeof SEAL_STATES)[number];
/** Who or what broke it on the road. */
export const SEAL_BREAK_CAUSES = ['police', 'customs', 'repair', 'found_broken', 'other'] as const;
export type SealBreakCause = (typeof SEAL_BREAK_CAUSES)[number];
/** The receiver's look at the door, with the driver: the seals as the note says, or not. */
export const SEALS_AT_DELIVERY = ['as_on_the_note', 'not_as_on_the_note'] as const;
export type SealsAtDelivery = (typeof SEALS_AT_DELIVERY)[number];

/** Seals on one load. */
export const MAX_SEALS = 10;
/** The longest seal number written: the printed number, a prefix with it. */
export const MAX_SEAL_NUMBER = 40;
/** Photographs of one broken seal. */
export const MAX_BREAK_PHOTOS = 4;

/**
 * THE THREE PHOTOGRAPHS a shipper takes when it seals a load (the shipper's sealing practice the user asked for): the load
 * open, blocked and braced; the doors closed with the vehicle's or container's number and the seal both in view; the seal
 * close up, its whole number readable.
 */
export const SEAL_PHOTOS = ['loadedOpen', 'closedWithSeal', 'sealCloseUp'] as const;
export type SealPhoto = (typeof SEAL_PHOTOS)[number];

export interface SealReading {
  at: string;
  stage: 'pickup' | 'delivery';
  result: 'matched' | SealsAtDelivery;
  photoRef?: string;
  /** The driver. Never leaves this store. */
  by: string;
}

/** One seal, as kept. */
export interface LoadSeal {
  sealId: string;
  freightId: string;
  /** As written: the number printed on the seal, a prefix with it. */
  number: string;
  /** The number folded for matching: no spaces or dashes, one case. */
  key: string;
  /** Its ISO 17712 class, as marked. A seal customs put on in place of another may not say. */
  sealClass?: SealClass;
  /** The maker's name or logo, as marked on the seal. */
  maker?: string;
  appliedBy: SealAppliedBy;
  photos: Partial<Record<SealPhoto, string>>;
  state: SealState;
  writtenAt: string;
  /** Who wrote it down: the shipper's member, or — for one customs put on at a post — the driver's word. */
  writtenBy: string;
  /** In place of another, after customs opened the load. */
  replaces?: string;
  readings: SealReading[];
  replaced?: { at: string; post?: string; officer?: string; by: string; newSealId: string };
  broken?: { at: string; receivedAt?: string; cause: SealBreakCause; note?: string; photoRefs: string[]; paperRef?: string; location?: GeoPoint; by: string };
}

/** A seal as the shipper, its system, the note and staff read it: what it is and what became of it — never who read it. */
export class LoadSealView {
  sealId: string;
  number: string;
  @ApiPropertyOptional({ enum: SEAL_CLASSES }) sealClass?: SealClass;
  @ApiPropertyOptional() maker?: string;
  @ApiProperty({ enum: SEAL_APPLIED_BY }) appliedBy: SealAppliedBy;
  @ApiProperty({ enum: SEAL_STATES }) state: SealState;
  writtenAt: string;
  /** Found on the door at pickup, as written. */
  @ApiPropertyOptional() matchedAt?: string;
  /** In place of this number, after customs opened the load. */
  @ApiPropertyOptional() replaces?: string;
  @ApiPropertyOptional() replaced?: { at: string; post?: string; officer?: string; by: string };
  @ApiPropertyOptional() broken?: { at: string; cause: SealBreakCause; note?: string };
  /** The look at the door at delivery. */
  @ApiPropertyOptional() atDelivery?: { at: string; result: SealsAtDelivery };
}

/** A seal as the driver's app reads it: which one to find and what it is — NOT its number, which the driver reads off the door. */
export class SealToFind {
  sealId: string;
  /** Seal 1, 2, … in the order written. */
  no: number;
  @ApiPropertyOptional({ enum: SEAL_CLASSES }) sealClass?: SealClass;
  @ApiPropertyOptional() maker?: string;
  @ApiProperty({ enum: SEAL_APPLIED_BY }) appliedBy: SealAppliedBy;
  @ApiProperty({ enum: SEAL_STATES }) state: SealState;
  /** sha256 of `<freightId>|<number folded>`: the app checks a reading against it with no signal (load-seal.service sealCheck). */
  check: string;
}

/** The seals of a load, and whether the shipper may still write them (until the goods are taken over). */
export class LoadSealsView {
  freightId: string;
  @ApiProperty({ type: [LoadSealView] }) seals: LoadSealView[];
  editable: boolean;
}

class SealPhotosDto {
  @IsString() loadedOpen!: string;
  @IsString() closedWithSeal!: string;
  @IsString() sealCloseUp!: string;
}

/** The shipper writes a seal on its load, before pickup. */
export class WriteSealDto {
  @IsString() @MaxLength(MAX_SEAL_NUMBER) number!: string;
  @IsIn(SEAL_CLASSES) sealClass!: SealClass;
  @IsOptional() @IsString() @MaxLength(60) maker?: string;
  @IsIn(SEAL_APPLIED_BY) appliedBy!: SealAppliedBy;
  @ValidateNested() @Type(() => SealPhotosDto) photos!: SealPhotosDto;
}

/** At pickup: the number the driver read off the door, and the close-up taken then. */
export class SealReadDto {
  @IsString() sealId!: string;
  @IsString() @MaxLength(MAX_SEAL_NUMBER) number!: string;
  @IsString() photoRef!: string;
}

/** At a post, customs opened the load and sealed it again: the seal it took off, the new one, its photo, the officer. */
export class SealReplacedDto {
  @IsString() sealId!: string;
  @IsString() @MaxLength(MAX_SEAL_NUMBER) newNumber!: string;
  @IsString() photoRef!: string;
  @IsOptional() @IsString() @MaxLength(80) officer?: string;
}

/** On clearing a border with seals on: as they were, or which customs replaced. */
export class SealsAtPostDto {
  @IsOptional() @IsBoolean() asTheyWere?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_SEALS) @ValidateNested({ each: true }) @Type(() => SealReplacedDto) replaced?: SealReplacedDto[];
}

class BreakLocationDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

/** A seal found broken on the road. Who says it comes from the sign-in. */
export class ReportBrokenSealDto {
  @IsIn(SEAL_BREAK_CAUSES) cause!: SealBreakCause;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BREAK_PHOTOS) @IsString({ each: true }) photoRefs!: string[];
  /** A photograph of any official paper about it: a police statement, a customs note. */
  @IsOptional() @IsString() paperRef?: string;
  @IsOptional() @ValidateNested() @Type(() => BreakLocationDto) location?: BreakLocationDto;
  @IsOptional() @IsDateString() observedAt?: string;
}
