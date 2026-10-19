import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { GeoPoint } from './pudo.types';

/**
 * A LOAD AT A BORDER OR A HUB (the user, round 14: "A load at a border or hub"; "The driver, by a tap"; "Each post's
 * promise").
 *
 * Until now nothing recorded where a load was between being picked up and being delivered, and every crossing was
 * assumed to cost the same four hours. The driver carrying it says three things, each a tap on the load in their app:
 * it is AT THE BORDER (at which post), it has CLEARED it, it is AT A HUB (which one). Each is kept with the moment the
 * driver made it — a tap made with no signal waits on the phone and is dated then — and where the phone was.
 *
 * KEPT BESIDE THE LOAD, never on it: a step names the driver who said it, and a join to a person does not travel on the
 * freight record (lesson-a-record-that-travels). What leaves for the shipper, its system, the fleet's system and the
 * tracking page is the step without the driver and without the phone's position.
 */
export const PASSAGE_KINDS = ['at_border', 'cleared_border', 'at_hub'] as const;
export type PassageKind = (typeof PASSAGE_KINDS)[number];

/** What a shipper's and a fleet's own systems hear of each step. */
export const PASSAGE_HOOK_EVENTS = { at_border: 'load.at_border', cleared_border: 'load.border_cleared', at_hub: 'load.at_hub' } as const satisfies Record<PassageKind, string>;

/** A post's measured wait is used for its promise once this many loads have cleared it in the window below. */
export const MIN_MEASURED_CROSSINGS = 5;
/** The crossings a post's wait is measured over: the last ninety days, so a post that got faster or slower is seen to. */
export const WAIT_WINDOW_DAYS = 90;
/** A name for a post or a hub, as the driver gives it. */
export const MAX_PLACE_NAME = 80;

/** One step, as kept. */
export interface LoadPassage {
  passageId: string;
  freightId: string;
  kind: PassageKind;
  /** The border post, as the driver named it (from the crossing's recorded posts, or one of their own). */
  post?: string;
  /** The post's name folded for counting: "Malaba", " malaba " and "MALABA" are one post. */
  postKey?: string;
  /** The crossing it is on: the load's own two countries. A load through a third country is counted under its own pair. */
  from?: string;
  to?: string;
  /** The hub, as the driver named it. */
  hub?: string;
  /** When the driver said it, by their phone (within reason: observed-at.ts). */
  at: string;
  /** When it reached SeeBuyGet, where that is later than it was said. */
  receivedAt?: string;
  /** The driver who said it. Never leaves this store. */
  by: string;
  /** Where the phone was. Never leaves this store either: only the time the rest of the way takes is said. */
  location?: GeoPoint;
  /** On clearing a border: how long the load was at the post, from its arrival to this. */
  waitedMin?: number;
}

/** One step, as the shipper, its system, the fleet's system and the tracking page read it: no driver, no position. */
export class LoadPassageView {
  @ApiProperty({ enum: PASSAGE_KINDS }) kind: PassageKind;
  @ApiPropertyOptional() post?: string;
  @ApiPropertyOptional() hub?: string;
  at: string;
  /** On clearing a border: minutes the load was at the post. */
  @ApiPropertyOptional() waitedMin?: number;
}

/**
 * HOW LONG A CROSSING TAKES, and what that rests on: `measured` — the median of the loads that cleared it in the last
 * ninety days, and how many there were; `standard` — not enough crossings measured yet, so the one figure every
 * crossing used before (pudo.config BORDER_DWELL_H), said as such.
 */
export class BorderWait {
  from: string;
  to: string;
  /** The post it is for. Absent: the crossing as a whole, before the load is at one of its posts. */
  @ApiPropertyOptional() post?: string;
  hours: number;
  @ApiProperty({ enum: ['measured', 'standard'] }) basis: 'measured' | 'standard';
  /** Measured: over how many crossings. */
  @ApiPropertyOptional() crossings?: number;
  /** Measured for the crossing as a whole: the posts the crossings were at. */
  @ApiPropertyOptional({ type: [String] }) posts?: string[];
}

/**
 * A LOAD THAT CROSSES A BORDER, where it has got to: `ahead` — not at the border yet · `at_post` — at a post, since when
 * · `cleared` — across. With the wait it is promised and, while it is on the road, when it is expected at its
 * destination: from the last step the driver said, the drive from there and the wait still ahead. It moves only when the
 * driver says something new, never with the clock — a promise read twice reads the same.
 */
export class LoadCrossing {
  @ApiProperty({ enum: ['ahead', 'at_post', 'cleared'] }) state: 'ahead' | 'at_post' | 'cleared';
  from: string;
  to: string;
  @ApiPropertyOptional() post?: string;
  /** At a post: since when. */
  @ApiPropertyOptional() since?: string;
  /** Across: when, and after how long at the post. */
  @ApiPropertyOptional() clearedAt?: string;
  @ApiPropertyOptional() waitedMin?: number;
  @ApiProperty({ type: BorderWait }) wait: BorderWait;
  /** About when it is at its destination. Absent once delivered, or where its destination has no place on the map. */
  @ApiPropertyOptional() expectedAt?: string;
}

/** What the driver's app needs to say a step on a load it carries. */
export class LoadPassageForDriver {
  /** Whether this load crosses a border: only then may the driver say it is at one. */
  crosses: boolean;
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  /** The crossing's recorded posts, to choose from. Empty: none recorded — the driver names it. */
  @ApiProperty({ type: [String] }) posts: string[];
  /** At a post now: which, since when, and how long it usually takes there. */
  @ApiPropertyOptional() atPost?: { post: string; since: string; wait: BorderWait };
  /** The last step said, if any. */
  @ApiPropertyOptional({ type: LoadPassageView }) last?: LoadPassageView;
}

/** One post's measured wait, as staff read them all. */
export class BorderWaitRow {
  from: string;
  to: string;
  post: string;
  /** The median, in hours, of the loads that cleared it in the window. */
  hours: number;
  crossings: number;
  /** Whether that is enough for the post's own promise. */
  measured: boolean;
  /** The longest of them, so a median is not read as the worst case. */
  longestHours: number;
  lastClearedAt: string;
}

class PassageLocationDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

/** A driver saying a step on the load they carry. Who they are comes from the sign-in, never from here. */
export class RecordPassageDto {
  @IsIn(PASSAGE_KINDS) kind!: PassageKind;
  /** At the border: the post. */
  @IsOptional() @IsString() @MaxLength(MAX_PLACE_NAME) post?: string;
  /** At a hub: the hub. */
  @IsOptional() @IsString() @MaxLength(MAX_PLACE_NAME) hub?: string;
  /** Where the phone was, when it knows. */
  @IsOptional() @ValidateNested() @Type(() => PassageLocationDto) location?: PassageLocationDto;
  /** When the driver said it, by their phone: a tap made with no signal is sent later and dated by this. */
  @IsOptional() @IsDateString() observedAt?: string;
}

/** What saying a step answers with: the step, and the crossing as it now stands. */
export class PassageRecorded {
  @ApiProperty({ type: LoadPassageView }) passage: LoadPassageView;
  @ApiPropertyOptional({ type: LoadCrossing }) crossing?: LoadCrossing;
  /** The same step said again (a tap sent twice): nothing new was kept. */
  replayed: boolean;
}
