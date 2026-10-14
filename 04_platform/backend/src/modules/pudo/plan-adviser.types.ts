import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayPlanView } from './fleet-plan.types';

/*
 * P5 — the adviser over a day's plan. The math plans; the adviser explains the plan and changes what the math is
 * ASKED. What it answers with is always a plan the server worked out, and a list of changes the server derived.
 */

/** One turn of the conversation so far, as plain text. The client keeps it; the server keeps nothing. */
export class AdviserTurn {
  @ApiProperty({ enum: ['user', 'assistant'] }) role: 'user' | 'assistant';
  text: string;
}

/** The asks a plan is made with, in full — so the screen can go on from exactly what the adviser left. */
export class PlanAskView {
  day: string;
  @ApiProperty({ type: [String] }) excludeVehicleIds: string[];
  dayStart: string;
  dayHours: number;
  speedKmh: number;
  loadMin: number;
  unloadMin: number;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { freightId: { type: 'string' }, vehicleId: { type: 'string' } }, required: ['freightId', 'vehicleId'] } })
  keepOff: Array<{ freightId: string; vehicleId: string }>;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { freightId: { type: 'string' }, vehicleId: { type: 'string' } }, required: ['freightId', 'vehicleId'] } })
  putOn: Array<{ freightId: string; vehicleId: string }>;
}

/**
 * Why there is no reply, when there is none: `not_configured` no key on this server · `busy` the service is rate
 * limiting · `unreachable` it could not be reached, or failed · `declined` it would not answer this.
 */
export const ADVISER_FAILURES = ['not_configured', 'busy', 'unreachable', 'declined'] as const;
export type AdviserFailure = (typeof ADVISER_FAILURES)[number];

export class PlanAdviceView {
  /** What the adviser said. Empty when it could not answer — `failed` then says why. */
  reply: string;
  @ApiPropertyOptional({ enum: ADVISER_FAILURES }) failed?: AdviserFailure;
  /**
   * What changed in the asks, in words — worked out by the server from the asks before and after, never taken from
   * the adviser's own account of itself.
   */
  @ApiProperty({ type: [String] }) changed: string[];
  @ApiProperty({ type: PlanAskView }) ask: PlanAskView;
  /** The plan under those asks: a proposal, worked out by the solver. Nothing is accepted by asking. */
  @ApiProperty({ type: DayPlanView }) plan: DayPlanView;
}

export class PlanAdviserStatus {
  /** Whether this server can reach the adviser at all. */
  configured: boolean;
}
