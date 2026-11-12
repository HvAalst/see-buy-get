import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { GeoPoint } from './pudo.types';
import { SuggestionNumbers, SUGGESTION_KINDS, type SuggestionKind } from './hub-density.types';

/*
 * 2026-11-12 — A COUNTRY'S HUB LIST (the owner's D2 and D7 on the plan "Hubs on the Road"): every hub place its staff work
 * through — the hubs it has (joined) and the places a hub is needed (each suggestion of "where hubs are needed" a row), with
 * open fields staff fill in, a status they move, and an invitation to join sent from the row. Joined is set by the system.
 */

export const HUB_ROW_STATUSES = ['open', 'negotiating', 'rejected', 'joined'] as const;
export type HubRowStatus = (typeof HUB_ROW_STATUSES)[number];
/** The statuses staff set; joined is the system's alone. */
export const STAFF_ROW_STATUSES = ['open', 'negotiating', 'rejected'] as const;

export class HubRow {
  rowId!: string;
  /** In the network already (a hub), or a place a hub is wanted. */
  @ApiProperty({ enum: ['hub', 'place'] }) kind!: 'hub' | 'place';
  /** A hub of the network; a suggestion of the map; a place staff added. */
  @ApiProperty({ enum: ['network', 'optimiser', 'staff'] }) source!: 'network' | 'optimiser' | 'staff';
  @ApiPropertyOptional({ enum: SUGGESTION_KINDS }) suggestionKind?: SuggestionKind;
  @ApiPropertyOptional() suggestionId?: string;
  /** The row's own code, in its invitation; made when the first invitation is. */
  @ApiPropertyOptional() code?: string;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() location?: GeoPoint;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() email?: string;
  @ApiProperty({ enum: HUB_ROW_STATUSES }) status!: HubRowStatus;
  /** Rejected: why, by whom, when — it comes back open after 90 days, or sooner once its numbers double. */
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() rejectedBy?: string;
  @ApiPropertyOptional() rejectedAt?: string;
  /** Joined: the hub, and when it signed up. */
  @ApiPropertyOptional() mdpId?: string;
  @ApiPropertyOptional() hubName?: string;
  @ApiPropertyOptional() joinedAt?: string;
  /** A suggestion's reason and numbers, beside the row. */
  @ApiPropertyOptional({ type: SuggestionNumbers }) numbers?: SuggestionNumbers;
  @ApiProperty({ type: [String] }) zoneNames!: string[];
  @ApiProperty({ type: [String] }) hubNames!: string[];
  @ApiProperty({ type: [String] }) towns!: string[];
  /** The suggestion it stands for is no longer made (its place found a hub, or its numbers fell): kept, said so. */
  @ApiPropertyOptional() stale?: boolean;
  @ApiPropertyOptional() updatedBy?: string;
  @ApiPropertyOptional() updatedAt?: string;
}

export class HubListCounts {
  open!: number;
  negotiating!: number;
  rejected!: number;
  joined!: number;
}

export class HubListView {
  entityId!: string;
  country!: string;
  @ApiProperty({ type: [HubRow] }) rows!: HubRow[];
  @ApiProperty({ type: HubListCounts }) counts!: HubListCounts;
}

/** What staff fill in or change on a row: the fields, and the status they set (never joined). */
export class HubRowDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsIn([...STAFF_ROW_STATUSES]) status?: 'open' | 'negotiating' | 'rejected';
  /** Why it was rejected: required with that status. */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) reason?: string;
}

/** A hub place staff add themselves. */
export class HubRowNewDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
}

/** An invitation code as a link carries it: letters and digits. */
export const INVITE_CODE = /^[A-Z0-9]{6,16}$/;
