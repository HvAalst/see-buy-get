import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { QUICK_REPLIES, REPORT_REASONS, SETTLE_METHODS, SETTLE_WHEN } from './conversation.types';
import { FILED_AS, PHOTO_SOURCES, PROOF_OF } from './filed-photo.types';

/** Where the driver is when naming a price. Declared here: pudo.dto's own GeoDto is not exported. */
export class ThreadPositionDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

/** CV1 — ask about a load; CV5 — or talk about a parcel waiting at a shop. Exactly one of the two. */
export class OpenConversationDto {
  @IsOptional() @IsString() freightId?: string;
  @IsOptional() @IsString() parcelId?: string;
}

/** Text, or a quick reply by its key — exactly one (the service refuses neither and both). */
export class SendMessageDto {
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsIn([...QUICK_REPLIES]) quick?: string;
  /**
   * When the person pressed Send, by the phone's clock. A message written with no signal waits on the phone and goes when
   * the signal comes back (2026-11-01); "On my way" read forty minutes late must say when it was said.
   */
  @IsOptional() @IsISO8601() writtenAt?: string;
}

/** Move the caller's read marker up to this sequence number. */
export class ReadMarkerDto {
  @IsInt() @Min(0) seq!: number;
}

/** Why a received message is being reported. */
export class ReportMessageDto {
  @IsIn([...REPORT_REASONS]) reason!: string;
}

/**
 * CV2 — the driver names a price in the thread. `from` is required for the same reason the negotiation requires
 * it: an accepted haul must record a real empty run, never an invented zero.
 */
export class ProposePriceInThreadDto {
  @IsNumber() @Min(0.01) price!: number;
  @IsOptional() @IsString() note?: string;
  @ValidateNested() @Type(() => ThreadPositionDto) from!: ThreadPositionDto;
}

/** CV4 — a voice message: the recording as a data URL, and how long it runs. The bytes are checked server-side. */
export class VoiceMessageDto {
  @IsString() dataUrl!: string;
  @IsNumber() @Min(1) @Max(120) durationSec!: number;
}

/**
 * 2026-11-02 — FILE A PHOTO to the thread's load or parcel, then show it (filed-photo.types.ts). The photo was uploaded
 * first (POST sbg/media, kind `filed`); this names it, says what it is, and where it came from — every label checked by
 * the service before anything is kept.
 */
export class FilePhotoDto {
  /** The uploaded photo — the caller's own, not yet anybody else's evidence. */
  @IsString() mediaId!: string;
  /** What it is: damage, a paper, or proof. */
  @IsIn([...FILED_AS]) as!: string;
  /** Proof of which moment — loading (a load only), handover or delivery. Only with `as: proof`. */
  @IsOptional() @IsIn([...PROOF_OF]) proofOf?: string;
  /** Where it came from: the app's own live camera, the phone's gallery, or not known. */
  @IsIn([...PHOTO_SOURCES]) source!: string;
  /** app_camera — when it was taken, by the phone's clock. */
  @IsOptional() @IsISO8601() takenAt?: string;
  /** gallery — the date the phone wrote into the photo (EXIF DateTimeOriginal), as written there: 2026-10-30T14:22:05. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:\d{2})?$/) phoneDate?: string;
  /** SHA-256 of the file as it was on the phone, before it was made smaller to send. */
  @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/) originalSha256?: string;
  /** When Send was pressed, by the phone's clock — said beside the card if it waited for a signal. */
  @IsOptional() @IsISO8601() writtenAt?: string;
}

/** CV3 — the driver shares this conversation with their fleet manager, or stops. */
export class ShareConversationDto {
  @IsBoolean() on!: boolean;
}

/** CV3 — the messages a party chooses to show the network, and why. */
export class DisputeReportDto {
  @IsArray() @ArrayMaxSize(200) @IsInt({ each: true }) seqs!: number[];
  @IsOptional() @IsString() note?: string;
}

/** CV2 — write down how a load the network does not pay will be settled. A record, never a posting. */
export class RecordSettlementDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsIn([...SETTLE_METHODS]) method!: string;
  @IsIn([...SETTLE_WHEN]) when!: string;
  @IsOptional() @IsString() note?: string;
}
