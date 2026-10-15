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

export const READING_SOURCES = ['shift_start', 'shift_end', 'office'] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

/**
 * WHAT THE ODOMETER SAID — the one usage reading service intervals run on. Typed by the driver as a shift starts and
 * ends, or by the office (at a service, or when a meter is replaced). Never lower than the last unless the office
 * records a new meter. A jump bigger than a vehicle can drive in the time since the last is kept, and said to be doubtful.
 */
export class OdometerReading {
  readingId: string;
  vehicleId: string;
  km: number;
  at: string;
  @ApiProperty({ enum: READING_SOURCES }) source: ReadingSource;
  by: string;
  @ApiPropertyOptional() byDid?: string;
  /** The office recorded a new meter: this reading starts again from what it shows. */
  @ApiPropertyOptional() newMeter?: boolean;
  /** Why the reading is doubtful, in words. Absent: nothing odd about it. */
  @ApiPropertyOptional() doubtful?: string;
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
  /** The latest odometer reading. Absent: none yet. */
  @ApiPropertyOptional({ type: OdometerReading }) odometer?: OdometerReading;
  /** The last few readings, newest first. */
  @ApiProperty({ type: [OdometerReading] }) readings: OdometerReading[];
}

/** What became of a reading given as a shift ended: the shift ends whatever it said. */
export class EndReadingResult {
  kept: boolean;
  @ApiPropertyOptional() why?: string;
  @ApiPropertyOptional() doubtful?: string;
}
