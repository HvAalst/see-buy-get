import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * THE PILOT, WEEK BY WEEK (the user, 2026-10-18: "pilot metrics + Lost"). The compendium's own four numbers (Ch 17.3,
 * "MVP success metrics", and the Control Tower Playbook's Monday table), counted per week and FROZEN once the week is
 * over: a week's numbers are a record of that week, never worked out again from data that has since moved on.
 *
 *   handshake rate  > 95%  (warn < 92%)  — of the parcels due onto a bus at a counter handover, the share scanned on
 *   loss rate       < 1%   (warn > 1.5%) — parcels declared lost or reported damaged, per parcel taken in that week
 *   take-in time    < 30 s (warn > 45 s) — the median time from starting a take-in at the counter to taking it in
 *   shop retention  > 80% at week 8      — of the shops that worked a counter in the pilot's first week, the share
 *                                          that worked one this week
 *
 * Weeks run Monday 00:00 to Monday 00:00, UTC.
 */
export const PILOT_TARGETS = {
  handshake: { target: 0.95, warn: 0.92 },
  loss: { target: 0.01, warn: 0.015 },
  takeInSeconds: { target: 30, warn: 45 },
  retention: { target: 0.8, atWeek: 8 },
} as const;

/** A take-in timed at the counter: longer than this was interrupted, not slow, and is not counted. */
export const TAKE_IN_MAX_S = 900;

/** One counter handover: what was due onto the bus, and what the shop scanned onto it. */
export interface HandoverRecord {
  at: string;
  agentDid: string;
  /** Parcels the manifest expected, and of those how many were left behind. */
  expected: number;
  handed: number;
  missed: number;
}

/** One take-in, timed at the counter. Kept beside the parcel, never on it. */
export interface TakeInRecord {
  parcelId: string;
  agentDid: string;
  at: string;
  seconds: number;
}

export class PilotHandshake {
  @ApiProperty({ description: 'Parcels scanned onto a bus at a counter handover.' }) handed: number;
  @ApiProperty({ description: 'Parcels due onto a bus and left behind, whatever the reason.' }) missed: number;
  @ApiPropertyOptional({ description: 'handed ÷ (handed + missed); absent when no parcel was due.' }) rate?: number;
}

export class PilotLoss {
  @ApiProperty({ description: 'Parcels declared lost this week and not found by the time the week was frozen.' }) lost: number;
  @ApiProperty({ description: 'Problems reported on parcels this week (a counter or a receiver).' }) damaged: number;
  @ApiProperty({ description: 'Parcels taken in this week.' }) takenIn: number;
  @ApiPropertyOptional({ description: '(lost + damaged) ÷ taken in; absent when nothing was taken in.' }) rate?: number;
}

export class PilotTakeIn {
  @ApiProperty({ description: 'Take-ins timed at the counter this week.' }) timed: number;
  @ApiPropertyOptional({ description: 'Their median, in seconds.' }) medianSeconds?: number;
  @ApiPropertyOptional({ description: 'The slowest one in ten, in seconds.' }) p90Seconds?: number;
}

export class PilotRetention {
  @ApiProperty({ description: 'Which week of the pilot this is: 1 is the week the first parcel was taken in.' }) pilotWeek: number;
  @ApiProperty({ description: 'Shops that worked a counter in the pilot’s first week.' }) original: number;
  @ApiProperty({ description: 'Of those, the ones that worked a counter this week.' }) active: number;
  @ApiPropertyOptional() rate?: number;
}

export class PilotWeek {
  @ApiProperty({ description: 'ISO week, e.g. 2026-W42.' }) week: string;
  from: string;
  to: string;
  @ApiProperty({ description: 'False for the week still running: its numbers are "so far" and are not kept.' }) frozen: boolean;
  @ApiPropertyOptional({ description: 'When the week was frozen, and the fingerprint of what was frozen.' }) frozenAt?: string;
  @ApiPropertyOptional() sha256?: string;
  handshake: PilotHandshake;
  loss: PilotLoss;
  takeIn: PilotTakeIn;
  @ApiPropertyOptional({ description: 'Absent until a first parcel has been taken in anywhere.' }) retention?: PilotRetention;
}

export class PilotTargetsView {
  handshake: number;
  handshakeWarn: number;
  loss: number;
  lossWarn: number;
  takeInSeconds: number;
  takeInWarnSeconds: number;
  retention: number;
  retentionAtWeek: number;
}

export class PilotBoard {
  @ApiProperty({ description: 'The week still running, so far.' }) thisWeek: PilotWeek;
  @ApiProperty({ type: [PilotWeek], description: 'Frozen weeks, newest first.' }) weeks: PilotWeek[];
  targets: PilotTargetsView;
}
