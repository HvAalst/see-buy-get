import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, IsArray, ArrayMaxSize } from 'class-validator';
import { HOLD_OUTCOMES, HoldAnswer, HoldOverride, ProtocolReading, type HoldOutcome } from './pay-hold.types';

/** 2026-11-15 — a held load in staff's queue: the record side by side, and what the protocol says (H3). */
export class HoldProblem {
  kind: string;
  description: string;
  at: string;
  @ApiPropertyOptional() photoRef?: string;
}

export class HoldQueueRow {
  freightId: string;
  code: string;
  description: string;
  @ApiPropertyOptional() country?: string;
  @ApiPropertyOptional() price?: number;
  @ApiPropertyOptional() currency?: string;
  deliveredAt: string;
  heldUntil: string;
  @ApiProperty({ type: HoldProblem }) problem: HoldProblem;
  @ApiPropertyOptional() pickupPhotoRef?: string;
  @ApiPropertyOptional() pickupNote?: string;
  @ApiPropertyOptional() doorPhotoRef?: string;
  @ApiProperty({ type: [String] }) doorNotes: string[];
  @ApiPropertyOptional({ type: HoldAnswer }) answer?: HoldAnswer;
  @ApiPropertyOptional({ type: HoldOverride }) pendingOverride?: HoldOverride;
  @ApiProperty({ type: ProtocolReading }) reading: ProtocolReading;
}

export class HoldQueueResponse {
  @ApiProperty({ type: [HoldQueueRow] }) items: HoldQueueRow[];
}

export class HoldOverrideDto {
  @ApiProperty({ enum: HOLD_OUTCOMES }) @IsIn(HOLD_OUTCOMES as unknown as string[]) outcome!: HoldOutcome;
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() by?: string;
}

export class HoldStaffDto {
  @IsOptional() @IsString() by?: string;
}

export class HoldAnswerDto {
  @IsString() @MaxLength(1000) words!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) photoRefs?: string[];
}
