import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * THE TAMPER PROTOCOL (round 35; the user, 2026-10-20, answering the ISO 28000/28001 check: "The tamper protocol").
 *
 * A seal not as written, a seal not as the note says, a broken seal or a cut wrap:
 *   - HOLDS the unit. The hold is kept ON the load or the parcel, so every act that would move it refuses by reading the
 *     unit itself — a pickup, a delivery, a bag, a sort, a hand-over, a hand-out. It changes hands with nobody.
 *   - LOGS the exception against the unit and its SSCCs: what was found, where, when, by whom, with the photographs —
 *     fingerprinted as reported and never rebuilt. The release is kept beside it.
 *   - TELLS operations, as a critical case, before anybody takes custody of it. Only operations releases it, with a
 *     reason; the case closes with that reason.
 *
 * Releasing a hold judges nothing: the exception stays on the unit's record, and a release lets the unit move again.
 * What happens to the goods — a claim, a return, a new seal — is decided by the people whose goods they are.
 */

export const TAMPER_FINDINGS = ['seal_not_as_written', 'seal_not_as_on_the_note', 'seal_broken', 'wrap_cut'] as const;
export type TamperFinding = (typeof TAMPER_FINDINGS)[number];

/** Where it was found: at a load's pickup, on the road, at its delivery; at a shop's counter, or at a hub. */
export const TAMPER_STAGES = ['pickup', 'road', 'delivery', 'counter', 'hub'] as const;
export type TamperStage = (typeof TAMPER_STAGES)[number];

export const TAMPER_UNIT_TYPES = ['load', 'parcel', 'bag'] as const;
export type TamperUnitType = (typeof TAMPER_UNIT_TYPES)[number];

export const TAMPER_REPORTERS = ['driver', 'shop', 'hub'] as const;
export type TamperReporter = (typeof TAMPER_REPORTERS)[number];

/** Photographs to a report: at least one, of what was found. */
export const MAX_TAMPER_PHOTOS = 4;
export const MAX_TAMPER_NOTE = 500;
/** A release says what was found and done: no shorter than this. */
export const MIN_RELEASE_REASON = 10;

/** Kept ON the unit while it is held, so every act that would move it refuses by reading the unit itself. */
export class UnitHold {
  @ApiProperty() since!: string;
  @ApiProperty({ enum: TAMPER_FINDINGS }) finding!: TamperFinding;
  @ApiProperty({ enum: TAMPER_STAGES }) stage!: TamperStage;
  @ApiProperty() exceptionId!: string;
  /** Where it is held, in words: "at pickup", "at Kisumu hub", "at Mama Njeri's". */
  @ApiProperty() where!: string;
}

/** One exception, as reported. Stored; never rebuilt. */
export interface TamperException {
  exceptionId: string;
  /** `ref` is how people say the unit — a load's code, a parcel's number — and the case's subject. */
  unit: { type: TamperUnitType; id: string; ref: string };
  /** The unit's SSCCs when it was reported: a load's package codes, a store parcel's code. Empty where it has none. */
  ssccs: string[];
  finding: TamperFinding;
  stage: TamperStage;
  /** When it was found, by the phone, within limits (whenSeen); when it reached us beside it where the two differ. */
  at: string;
  receivedAt?: string;
  /** Who found it. The name is staff's to read; a shipper reads the party (the driver, a shop, a hub). */
  by: { did: string; name: string; as: TamperReporter };
  where: string;
  location?: { lat: number; lng: number };
  photoRefs: string[];
  note?: string;
  /** For a seal: which one on the load, the number read off the door where it was not the one written, and what broke it. */
  seal?: { sealId: string; no: number; numberRead?: string; cause?: string };
  /** sha256 of the canonical body as reported (everything above). */
  hash: string;
  /** Kept beside the fingerprinted body, never inside it. */
  release?: { at: string; by: string; reason: string };
}

export class TamperRelease {
  @ApiProperty() at!: string;
  @ApiProperty() by!: string;
  @ApiProperty() reason!: string;
}

/** An exception as a reader sees it: staff with who found it; anybody else with the party, never a fleet driver's name. */
export class TamperExceptionView {
  @ApiProperty() exceptionId!: string;
  @ApiProperty({ type: [String] }) ssccs!: string[];
  @ApiProperty({ enum: TAMPER_FINDINGS }) finding!: TamperFinding;
  @ApiProperty({ enum: TAMPER_STAGES }) stage!: TamperStage;
  @ApiProperty() at!: string;
  @ApiPropertyOptional() receivedAt?: string;
  @ApiProperty({ enum: TAMPER_REPORTERS }) byAs!: TamperReporter;
  /** Staff only: the person who found it. */
  @ApiPropertyOptional() byName?: string;
  @ApiProperty() where!: string;
  @ApiProperty({ type: [String] }) photoRefs!: string[];
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() sealNo?: number;
  @ApiPropertyOptional() numberRead?: string;
  @ApiPropertyOptional() cause?: string;
  /** sha256 of the exception as reported. Never named `hash` on the wire: a response field of that name is stripped. */
  @ApiProperty() fingerprint!: string;
  @ApiPropertyOptional({ type: TamperRelease }) release?: TamperRelease;
}

/** Round 36 — staff only: how a bag was closed — its coded seal's number — to read beside the number reported. */
/** Round 37 — the driver who took the bag: who, when, the number they read off it, and whether as it was closed. */
export class BagTakenView {
  @ApiProperty() by!: string;
  @ApiProperty() at!: string;
  @ApiPropertyOptional() numberRead?: string;
  @ApiProperty() asClosed!: boolean;
}

export class BagClosedView {
  @ApiProperty({ enum: ['seal', 'photo'] }) kind!: 'seal' | 'photo';
  @ApiPropertyOptional() number?: string;
  @ApiProperty() closedAt!: string;
  @ApiProperty() place!: string;
  @ApiPropertyOptional({ type: BagTakenView }) taken?: BagTakenView;
}

/** A unit's exceptions, newest first, and its hold while it is held. */
export class TamperUnitView {
  @ApiProperty({ enum: TAMPER_UNIT_TYPES }) unitType!: TamperUnitType;
  @ApiProperty() unitId!: string;
  @ApiProperty() ref!: string;
  @ApiPropertyOptional({ type: UnitHold }) held?: UnitHold;
  @ApiProperty({ type: [TamperExceptionView] }) exceptions!: TamperExceptionView[];
  /** Round 36 — a bag, for staff: how it was closed. */
  @ApiPropertyOptional({ type: BagClosedView }) closedWith?: BagClosedView;
}

/** What each finding is, in a line — for a refusal, a case, the note. */
export const FINDING_WORDS: Record<TamperFinding, string> = {
  seal_not_as_written: 'a seal on the door is not the one written',
  seal_not_as_on_the_note: 'the seals are not as the note says',
  seal_broken: 'a seal was found broken',
  wrap_cut: 'the wrap or packaging is cut or opened',
};

/* ------------------------------------------------------------------------ the doors' bodies -- */

export class TamperPointDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

/** The driver, about the load being taken over or carried. A broken seal has its own report (ReportBrokenSealDto). */
export class ReportLoadTamperDto {
  @ApiProperty({ enum: ['seal_not_as_written', 'seal_not_as_on_the_note', 'wrap_cut'] })
  @IsIn(['seal_not_as_written', 'seal_not_as_on_the_note', 'wrap_cut'])
  finding!: TamperFinding;
  /** Which seal, where one is not the one written. */
  @IsOptional() @IsString() sealId?: string;
  /** The number on the door, as read, where it is not the one written. */
  @IsOptional() @IsString() @MaxLength(64) numberRead?: string;
  /** Asked for by the service, which says what to photograph when there is none. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_TAMPER_PHOTOS) @IsString({ each: true }) photoRefs?: string[];
  @IsOptional() @IsString() @MaxLength(MAX_TAMPER_NOTE) note?: string;
  /** On the road, at the receiver's door: a cut wrap found at delivery. */
  @IsOptional() @IsBoolean() atDelivery?: boolean;
  @IsOptional() @IsDateString() observedAt?: string;
  @IsOptional() @ValidateNested() @Type(() => TamperPointDto) location?: TamperPointDto;
}

/** Round 36 — a shop or a hub, about a bag it holds or is receiving: its seal not the one it was closed with, broken, or the bag cut. */
export class ReportBagTamperDto {
  @ApiProperty({ enum: ['seal_not_as_written', 'seal_broken', 'wrap_cut'] })
  @IsIn(['seal_not_as_written', 'seal_broken', 'wrap_cut'])
  finding!: TamperFinding;
  /** The number on the seal, as read, where it is not the one the bag was closed with. */
  @IsOptional() @IsString() @MaxLength(64) numberRead?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_TAMPER_PHOTOS) @IsString({ each: true }) photoRefs?: string[];
  @IsOptional() @IsString() @MaxLength(MAX_TAMPER_NOTE) note?: string;
  @IsOptional() @IsDateString() observedAt?: string;
}

/** A shop or a hub, about a parcel in its hands: its wrap or packaging cut or opened. */
export class ReportParcelTamperDto {
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_TAMPER_PHOTOS) @IsString({ each: true }) photoRefs?: string[];
  @IsOptional() @IsString() @MaxLength(MAX_TAMPER_NOTE) note?: string;
  @IsOptional() @IsDateString() observedAt?: string;
}

export class ReleaseHoldDto {
  @IsString() @MaxLength(MAX_TAMPER_NOTE) reason!: string;
  /** A name typed beside the shared staff key; ignored for a member of staff signed in as themselves. */
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}
