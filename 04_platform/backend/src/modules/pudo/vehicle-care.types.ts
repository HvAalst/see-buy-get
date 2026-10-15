import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A VEHICLE'S UPKEEP — what the network keeps about the state a vehicle is in, as far as it touches the work: whether it
 * can go out, what the driver found when they checked it, when it is due a service, and when it broke down.
 *
 * NOT a workshop's system, by decision (the user, 2026-10-15): no parts stock, no mechanics' time, no workshop invoices
 * or payments, no costs. A fleet's workshop is its own business, as its payroll is; the network keeps what decides
 * whether a vehicle goes out and what a driver and a shipper are told.
 */

export const OFF_ROAD_REASONS = ['repair', 'service', 'accident', 'breakdown', 'other'] as const;
export type OffRoadReason = (typeof OFF_ROAD_REASONS)[number];

/**
 * A SPELL OFF THE ROAD: from a day, until a day or until somebody says it is back. Days are the owner's (a fleet's own
 * clock), and inclusive. Ending it ends it from that moment; ending one that has not started yet calls it off.
 */
export class OffRoadSpell {
  spellId: string;
  vehicleId: string;
  @ApiProperty({ enum: OFF_ROAD_REASONS }) reason: OffRoadReason;
  @ApiPropertyOptional() note?: string;
  fromDay: string;
  /** The last day off the road. Absent: until it is put back by hand. */
  @ApiPropertyOptional() untilDay?: string;
  setBy: string;
  setAt: string;
  @ApiPropertyOptional() endedAt?: string;
  @ApiPropertyOptional() endedBy?: string;
}

/** A vehicle's upkeep as its owner reads it. */
export class VehicleCareView {
  vehicleId: string;
  plate: string;
  /** Can it start a shift now, and if not, every reason — its papers, and whatever else keeps it off the road. */
  usable: boolean;
  offRoad: string[];
  /** Grounded before grounding had a way back: "back on the road" returns it. */
  @ApiPropertyOptional() grounded?: boolean;
  /** Spells now or to come, soonest first; ended ones are history and not listed. */
  @ApiProperty({ type: [OffRoadSpell] }) spells: OffRoadSpell[];
  /** A driver is on a shift in it right now: a spell starting today leaves that shift running, and stops the next. */
  inUse: boolean;
}
