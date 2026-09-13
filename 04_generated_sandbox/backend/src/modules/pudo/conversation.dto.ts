import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { QUICK_REPLIES, REPORT_REASONS } from './conversation.types';

/** CV1 — ask about a load. */
export class OpenConversationDto {
  @IsString() freightId!: string;
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
