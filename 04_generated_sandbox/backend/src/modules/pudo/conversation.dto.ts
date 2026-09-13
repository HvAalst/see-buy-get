import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { QUICK_REPLIES, REPORT_REASONS, SETTLE_METHODS, SETTLE_WHEN } from './conversation.types';

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
