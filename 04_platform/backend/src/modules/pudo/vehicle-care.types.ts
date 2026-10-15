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

/** What a daily check asks about. Which of them a vehicle is asked, and which are safety-critical, depends on its class. */
export const CHECK_ITEMS = ['tyres', 'brakes', 'lights', 'mirrors', 'horn', 'wipers', 'leaks', 'chain', 'load_gear', 'body'] as const;
export type CheckItem = (typeof CHECK_ITEMS)[number];
/** What a defect is about: a check item, or something the check does not name. */
export const DEFECT_ITEMS = [...CHECK_ITEMS, 'other'] as const;
export type DefectItem = (typeof DEFECT_ITEMS)[number];

export class CheckItemView {
  @ApiProperty({ enum: CHECK_ITEMS }) item: CheckItem;
  /** A problem with it keeps the vehicle off the road until the office has it fixed, or says it is safe as it is. */
  safety: boolean;
}

/** What the driver is asked before a shift: the vehicle, its items, and whether it was checked today already. */
export class CheckSheet {
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  @ApiProperty({ type: [CheckItemView] }) items: CheckItemView[];
  /** Checked today already (by anybody): who, and when. */
  @ApiPropertyOptional() checkedTodayBy?: string;
  @ApiPropertyOptional() checkedTodayAt?: string;
  /** The fleet asks for a check before a shift: none today, and the shift does not start. */
  required: boolean;
}

export const DEFECT_STATUSES = ['open', 'fixed', 'cleared'] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

/**
 * A DEFECT: what is wrong, with a photograph where there is one, who found it and when. Safety-critical — brakes,
 * tyres, lights at a check, or anything the driver says is not safe to drive — keeps the vehicle off the road until the
 * office marks it FIXED, or CLEARED (safe to drive as it is, with its reason). The driver who reported it is told which.
 */
export class VehicleDefect {
  defectId: string;
  vehicleId: string;
  @ApiProperty({ enum: DEFECT_ITEMS }) item: DefectItem;
  @ApiPropertyOptional() note?: string;
  /** The photograph, served by the upkeep routes to the vehicle's owner (GET vehicles/:id/defects/:defectId/photo). */
  @ApiPropertyOptional() hasPhoto?: boolean;
  safety: boolean;
  reportedBy: string;
  @ApiPropertyOptional() reportedByDid?: string;
  reportedAt: string;
  @ApiProperty({ enum: ['check', 'report'] }) found: 'check' | 'report';
  @ApiProperty({ enum: DEFECT_STATUSES }) status: DefectStatus;
  @ApiPropertyOptional() decidedBy?: string;
  @ApiPropertyOptional() decidedAt?: string;
  @ApiPropertyOptional() decisionNote?: string;
}

/** What came of a check: what it found new, what was already reported, and whether the vehicle can go out. */
export class CheckResult {
  checkId: string;
  /** Nothing wrong. */
  clean: boolean;
  @ApiProperty({ type: [VehicleDefect] }) found: VehicleDefect[];
  /** Problems already reported and still open: not reported twice. */
  @ApiProperty({ type: [VehicleDefect] }) alreadyOpen: VehicleDefect[];
  usable: boolean;
  offRoad: string[];
}

/** A fleet's own rules for its vehicles' upkeep. */
export class CareSettings {
  /** A driver checks the vehicle before a shift, or the shift does not start. Off unless the fleet turns it on. */
  requireDailyCheck: boolean;
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
  /** Defects still open, safety-critical first; and the last few decided. */
  @ApiProperty({ type: [VehicleDefect] }) defects: VehicleDefect[];
  @ApiProperty({ type: [VehicleDefect] }) decided: VehicleDefect[];
  /** The last daily check: who, when, and what it found. */
  @ApiPropertyOptional() lastCheckBy?: string;
  @ApiPropertyOptional() lastCheckAt?: string;
  @ApiPropertyOptional() lastCheckClean?: boolean;
}

/** What became of a reading given as a shift ended: the shift ends whatever it said. */
export class EndReadingResult {
  kept: boolean;
  @ApiPropertyOptional() why?: string;
  @ApiPropertyOptional() doubtful?: string;
}
