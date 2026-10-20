import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A FLEET'S OWN SYSTEM, TOLD OF ITS WORK (the user, round 11: the events recommended; "the system should also be able to
 * 'just' match a fleet when handling freight", the money on each load we pay it for and nothing else about money; where
 * its vehicles are "differs from fleet to fleet … the decision is with them, we facilitate", the driver told; any manager
 * sets it up, under their own name). What its system hears, and what it reads back about each message.
 */

/**
 * What its system hears, as the event names it. Each carries exactly what the fleet's own app shows about it: an order as
 * its Orders screen reads it, a load as its Earnings screen reads it (the money only where we pay the fleet), a
 * breakdown, a run, the day's plan. Nothing about its drivers as people: who is on the roster, who joined, who left.
 */
export const FLEET_HOOK_EVENTS = [
  // An order under its contracts: it came in (ordered from it, offered to it, handed to it), what it shows changed, it is
  // no longer in its Orders (an offer taken back or taken by another partner, put back together with another load), it
  // was cancelled.
  'order.received',
  'order.changed',
  'order.removed',
  'order.cancelled',
  // A load it carries — an order of its own, or one of its drivers took off the open board.
  'load.assigned',
  'load.taken',
  'load.handed_back',
  'load.picked_up',
  // Its driver said it is at a border post, has cleared it, or is at a hub (round 14).
  'load.at_border',
  'load.border_cleared',
  'load.at_hub',
  // A seal on it found broken on the road (round 15).
  'load.seal_broken',
  // Its cold chain broken on the road: the reading that broke it, and when (round 25).
  'load.cold_chain_broken',
  // Held by the police, customs or another authority on the road, as its driver said — and let go.
  'load.held',
  'load.let_go',
  'load.delivery_failed',
  'load.delivered',
  'load.cancelled',
  'load.claim_opened',
  'load.claim_decided',
  // Its vehicles: broke down, how that ended, and its loads moved to another of its vehicles.
  'vehicle.broke_down',
  'vehicle.breakdown_ended',
  'vehicle.loads_moved',
  // Round 16 — one of its vehicles stood still on a shift longer than it allows, away from any stop.
  'vehicle.standing_still',
  // Round 17 — the phone on one of its vehicles said nothing on a shift longer than it allows; where it was last heard.
  'vehicle.gone_silent',
  // Its runs: space booked by a shipper, given back, the run called off.
  'run.booked',
  'run.booking_cancelled',
  'run.cancelled',
  // The day's plan, accepted.
  'plan.accepted',
] as const;
export type FleetHookEvent = (typeof FLEET_HOOK_EVENTS)[number];

/** Only where the fleet has turned it on: where each of its vehicles is, while a driver is on a shift in it. */
export const FLEET_POSITION_EVENT = 'vehicle.position';
/** How often a vehicle's position may be sent, in minutes. The fleet chooses; nothing is sent until it does. */
export const FLEET_POSITION_EVERY = [1, 5, 15] as const;
export type FleetPositionEvery = (typeof FLEET_POSITION_EVERY)[number];

export class FleetHookMessageView {
  id: string;
  @ApiProperty({ description: 'One of the events, or "test".' }) event: string;
  at: string;
  @ApiProperty({ enum: ['pending', 'delivered', 'failed'] }) state: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextTryAt: string;
  @ApiPropertyOptional() deliveredAt?: string;
  @ApiPropertyOptional({ description: 'Our words for what went wrong last. Never the system’s own answer.' }) lastError?: string;
  @ApiPropertyOptional() resent?: number;
  /** The exact body that was signed and sent. */
  body: string;
}

/** Where its vehicles are, sent to its system: how often, who turned it on, and how the sending goes. Counted, never listed. */
export class FleetPositionsView {
  @ApiProperty({ enum: FLEET_POSITION_EVERY }) everyMin: FleetPositionEvery;
  setAt: string;
  /** The manager who turned it on, or last changed how often. */
  setBy: string;
  /** Since it was turned on: positions that arrived, and ones that did not (each is tried once, then the next replaces it). */
  delivered: number;
  notDelivered: number;
  @ApiPropertyOptional() lastDeliveredAt?: string;
  @ApiPropertyOptional() lastError?: string;
  @ApiPropertyOptional() lastErrorAt?: string;
}

export class FleetSystemView {
  /** Where its system is told; absent while it has given none, and nothing is sent. */
  @ApiPropertyOptional() url?: string;
  @ApiPropertyOptional() setAt?: string;
  /** The manager who gave the address, or last changed it. */
  @ApiPropertyOptional() setBy?: string;
  /** Whether it has a signing secret, and when and by whom it was last made. The secret itself is shown once, when made. */
  hasSecret: boolean;
  @ApiPropertyOptional() secretTurnedAt?: string;
  @ApiPropertyOptional() secretTurnedBy?: string;
  /** Only in the answer that made it: copy it now, it is not shown again. */
  @ApiPropertyOptional() secret?: string;
  @ApiProperty({ type: [String], description: 'What its system hears.' }) events: string[];
  /** Absent while positions are off: nothing about where its vehicles are is sent. */
  @ApiPropertyOptional({ type: FleetPositionsView }) positions?: FleetPositionsView;
  @ApiProperty({ type: [FleetHookMessageView] }) messages: FleetHookMessageView[];
}

/** For network staff: counts only. They read it; they send nothing in a fleet's name. */
export class FleetSystemCounts {
  hasAddress: boolean;
  delivered: number;
  waiting: number;
  givenUp: number;
  /** Whether it sends where its vehicles are to its system. */
  positions: boolean;
  /** Round 12 — its keys that work, by mode. */
  keys?: { live: number; test: number };
}

/** For a driver on a shift: their fleet's own system is told where they are, and how often. */
export class PositionsToFleetSystem {
  fleetName: string;
  @ApiProperty({ enum: FLEET_POSITION_EVERY }) everyMin: FleetPositionEvery;
}
