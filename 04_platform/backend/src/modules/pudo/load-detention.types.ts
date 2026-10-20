import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { GeoPoint } from './pudo.types';

/**
 * A LOAD HELD BY THE POLICE OR CUSTOMS (the ISO 28000 check: "Held by police or customs as a state, with operations told";
 * built without asking — the user: "continue to close gaps that do not need my decision").
 *
 * A truck stopped at a checkpoint and kept there was, to everybody else, a truck standing still: the fleet's watch opened
 * a case as if it might be a hijacking, and the shipper, operations and the tracking page knew nothing. Now the driver
 * carrying it says so, a tap on the load in their app — held by the police, by customs, or by somebody else, who and
 * where in their own words — and says it again when they are let go. Each is dated by the phone (a tap made with no
 * signal waits on it). While it is held, SeeBuyGet operations has a critical case; the shipper and the fleet's office
 * are told, in their bells and their systems; it is not delivered; and the tracking page says it is held on the way.
 *
 * KEPT BESIDE THE LOAD, never on it, like a border step (load-passage.types.ts): it names the driver who said it, and
 * where their phone was, and neither leaves this store.
 */

export const HELD_BY = ['police', 'customs', 'other'] as const;
export type HeldBy = (typeof HELD_BY)[number];

/** Who and where, in the driver's words: "Traffic police, Athi River" — no longer than this. */
export const MAX_HELD_WHO = 120;
export const MAX_HELD_NOTE = 500;

/** One time a load was held, as kept. */
export interface LoadDetention {
  detentionId: string;
  freightId: string;
  by: HeldBy;
  who?: string;
  note?: string;
  /** When the driver said it, by their phone (observed-at.ts). */
  at: string;
  /** When it reached SeeBuyGet, where that is later than it was said. */
  receivedAt?: string;
  /** The driver who said it. Never leaves this store. */
  driverDid: string;
  /** Where the phone was. Never leaves this store either. */
  location?: GeoPoint;
  /** Let go, as the driver said it. */
  letGo?: { at: string; receivedAt?: string; note?: string };
}

/** How the shipper, its system, the fleet's office and staff read it: no driver, no position. */
export class HeldByAuthority {
  @ApiProperty({ enum: HELD_BY }) by!: HeldBy;
  @ApiPropertyOptional() who?: string;
  @ApiPropertyOptional() note?: string;
  since!: string;
  /** Said with no signal: when it reached us. */
  @ApiPropertyOptional() receivedAt?: string;
  /** Let go: when, and anything the driver said. */
  @ApiPropertyOptional() letGoAt?: string;
  @ApiPropertyOptional() letGoNote?: string;
}

/** The tracking page, which anybody with the label's key reads: that it is held on the way, and since when — not by whom. */
export class HeldOnTheWay {
  since!: string;
}

class HeldLocationDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

/** The driver carrying the load says it is held. Who they are comes from the sign-in, never from here. */
export class SayHeldDto {
  @IsIn(HELD_BY) by!: HeldBy;
  @IsOptional() @IsString() @MaxLength(MAX_HELD_WHO) who?: string;
  @IsOptional() @IsString() @MaxLength(MAX_HELD_NOTE) note?: string;
  @IsOptional() @ValidateNested() @Type(() => HeldLocationDto) location?: HeldLocationDto;
  @IsOptional() @IsDateString() observedAt?: string;
}

/** …and that they were let go. */
export class SayLetGoDto {
  @IsOptional() @IsString() @MaxLength(MAX_HELD_NOTE) note?: string;
  @IsOptional() @IsDateString() observedAt?: string;
}

/** What saying it answers with: the hold as it now stands, and whether this was the same tap sent again. */
export class HeldSaid {
  @ApiProperty({ type: HeldByAuthority }) held!: HeldByAuthority;
  replayed!: boolean;
}

/** Words for who holds it, for the bell, the case and the note's readers. */
export const HELD_BY_WORDS: Record<HeldBy, string> = { police: 'the police', customs: 'customs', other: 'an authority' };

export function heldView(d: LoadDetention): HeldByAuthority {
  return {
    by: d.by,
    ...(d.who ? { who: d.who } : {}),
    ...(d.note ? { note: d.note } : {}),
    since: d.at,
    ...(d.receivedAt ? { receivedAt: d.receivedAt } : {}),
    ...(d.letGo ? { letGoAt: d.letGo.at, ...(d.letGo.note ? { letGoNote: d.letGo.note } : {}) } : {}),
  };
}
