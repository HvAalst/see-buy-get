import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { GeoPoint } from './pudo.types';

/**
 * A VEHICLE STANDING STILL (the user, round 16: "A watch on stopped vehicles"; "The fleet's managers"; "Each fleet sets
 * it; 45 min to start").
 *
 * A seal says what happened at the door; a border step says where the load got to. Neither says, while it is happening,
 * that a truck on a shift has stood in one place too long, away from anywhere it had reason to stop — the first sign of a
 * hijacking, a breakdown nobody reported, a driver in trouble. The phone on a shift already says where it is; this watches
 * it: a vehicle that stays within a few hundred metres for longer than its fleet allows — away from its loads' stops, the
 * fleet's own sites, the network's hubs and shops, and not waiting at a border post its driver said it is at — opens a
 * case for the fleet's managers. They call their driver and say how it was.
 *
 * Only the fleet is told: where its vehicles are stays the fleet's to share (round 11). A phone that stops reporting is not
 * a vehicle standing still — it is a phone gone dark, said apart on the fleet's map.
 */

/** The minutes a fleet starts with, and what it may set: no fewer than 15 (a red light is not a case), no more than 4 hours. */
export const STANDSTILL_DEFAULT_MIN = 45;
export const STANDSTILL_MIN_MIN = 15;
export const STANDSTILL_MAX_MIN = 240;
/** Within this of where it stopped, a vehicle is still standing there: a truck edging up a queue has not moved on. */
export const STILL_RADIUS_KM = 0.3;
/** Within this of a stop, a vehicle is at the stop: a yard, a depot, a hub are wider than a pin. */
export const STOP_RADIUS_KM = 0.5;
/** A phone heard from longer ago than this is dark, not standing still (the fleet map's word, apps/fleet/logic.ts). */
export const DARK_AFTER_MIN = 10;
/** How long a case that is over stays in the fleet's list. */
export const STANDSTILL_KEEP_HOURS = 24;

/** What the office found when it called: all well (a queue, a break, waiting to load), no answer, or something wrong. */
export const STANDSTILL_OUTCOMES = ['all_well', 'no_answer', 'problem'] as const;
export type StandstillOutcome = (typeof STANDSTILL_OUTCOMES)[number];

/** A fleet's own setting. */
export interface StandstillSettings {
  fleetDid: string;
  on: boolean;
  afterMin: number;
  setAt: string;
  setBy: string;
}

/** Where a vehicle on a shift stopped, and since when: kept per shift, moved on the first fix away from it. */
export interface StandstillAnchor {
  assignmentId: string;
  driverDid: string;
  vehicleId: string;
  location: GeoPoint;
  since: string;
  lastFixAt: string;
}

export interface StandstillCase {
  caseId: string;
  fleetDid: string;
  driverDid: string;
  vehicleId: string;
  plate: string;
  driverName?: string;
  assignmentId: string;
  location: GeoPoint;
  since: string;
  openedAt: string;
  /** The minutes the fleet allowed when it was opened. */
  afterMin: number;
  answer?: { outcome: StandstillOutcome; note?: string; by: string; at: string };
  /** It ended: the vehicle moved on, the shift ended, or a breakdown was reported for it. */
  over?: { why: 'moved' | 'shift_ended' | 'breakdown'; at: string };
}

export class StandstillSettingsView {
  on: boolean;
  afterMin: number;
  /** True while the fleet has not set it: what every fleet starts with. */
  asStarted: boolean;
  @ApiPropertyOptional() setAt?: string;
  @ApiPropertyOptional() setBy?: string;
}

export class StandstillCaseView {
  caseId: string;
  plate: string;
  @ApiPropertyOptional() driverName?: string;
  location: GeoPoint;
  since: string;
  openedAt: string;
  /** Minutes it stood: so far while it stands, in all once it is over. */
  minutes: number;
  afterMin: number;
  @ApiProperty({ enum: ['open', 'answered', 'over'] }) state: 'open' | 'answered' | 'over';
  @ApiPropertyOptional() answer?: { outcome: StandstillOutcome; note?: string; by: string; at: string };
  @ApiPropertyOptional() over?: { why: 'moved' | 'shift_ended' | 'breakdown'; at: string };
}

export class StandstillView {
  @ApiProperty({ type: StandstillSettingsView }) settings: StandstillSettingsView;
  @ApiProperty({ type: [StandstillCaseView] }) cases: StandstillCaseView[];
}

export class StandstillSettingsDto {
  @IsBoolean() on!: boolean;
  @IsInt() @Min(STANDSTILL_MIN_MIN) @Max(STANDSTILL_MAX_MIN) afterMin!: number;
}

export class AnswerStandstillDto {
  @IsIn(STANDSTILL_OUTCOMES) outcome!: StandstillOutcome;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
