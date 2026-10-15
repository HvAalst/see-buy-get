import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoPoint } from './pudo.types';

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
  /** What a service overdue does: only warns (the default), or takes the vehicle off the road until one is recorded. */
  @ApiProperty({ enum: ['warn', 'off_road'] }) serviceOverdue: 'warn' | 'off_road';
}

export const SERVICE_KINDS = ['service', 'repair', 'tyres', 'inspection', 'other'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/**
 * WHAT WAS DONE TO IT, AND WHEN: a service, a repair, new tyres, an inspection. The day, the odometer then, the
 * workshop's name and a photo of its job card. Never what it cost or which parts — that is the workshop's business.
 * Only a SERVICE starts the count to the next one again.
 */
export class ServiceRecord {
  recordId: string;
  vehicleId: string;
  day: string;
  @ApiProperty({ enum: SERVICE_KINDS }) what: ServiceKind;
  @ApiPropertyOptional() km?: number;
  @ApiPropertyOptional() workshop?: string;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() hasPhoto?: boolean;
  by: string;
  at: string;
}

export const BREAKDOWN_CAUSES = ['engine', 'tyre', 'electrical', 'brakes', 'fuel', 'accident', 'other'] as const;
export type BreakdownCause = (typeof BREAKDOWN_CAUSES)[number];

/** A load that was in the vehicle, or on its way to be collected by it, when it broke down. */
export class BreakdownLoad {
  @ApiProperty({ enum: ['freight', 'booking'] }) kind: 'freight' | 'booking';
  /** The order's id, or the run booking's. */
  id: string;
  /** What the office calls it: the order's code, or what the booking said it was. */
  label: string;
  @ApiProperty({ enum: ['aboard', 'to_collect'] }) state: 'aboard' | 'to_collect';
  @ApiPropertyOptional() departureId?: string;
  /** Its shipper is somebody here, and was told. The fleet's own loads tell nobody. */
  shipperTold: boolean;
}

/**
 * A BREAKDOWN'S LOADS, TAKEN OVER by another of the fleet's vehicles: who took them, in what, when and where, and on
 * whose word — the pass of the driver handing over (the two of them at the vehicle together), or the office's.
 */
export class BreakdownHandover {
  at: string;
  toDriverDid: string;
  toDriverName: string;
  toVehicleId: string;
  toPlate: string;
  /** What moved: order codes, and what run bookings said they were. */
  @ApiProperty({ type: [String] }) loads: string[];
  @ApiProperty({ enum: ['pass', 'office'] }) proof: 'pass' | 'office';
  /** Who recorded it: the driver who took them over, or the office. */
  by: string;
  @ApiPropertyOptional({ type: GeoPoint }) location?: GeoPoint;
}

/**
 * BROKEN DOWN ON THE ROAD: what happened, where, who was driving, what was aboard then, and which of today's planned
 * orders were held for it. Open until the office says how it ended: back on the road, or into the workshop.
 */
export class VehicleBreakdown {
  breakdownId: string;
  vehicleId: string;
  plate: string;
  @ApiProperty({ enum: BREAKDOWN_CAUSES }) cause: BreakdownCause;
  note: string;
  @ApiPropertyOptional() hasPhoto?: boolean;
  reportedBy: string;
  @ApiPropertyOptional() reportedByDid?: string;
  /** The driver on a shift in it then, if anybody was. */
  @ApiPropertyOptional() driverDid?: string;
  @ApiPropertyOptional() driverName?: string;
  reportedAt: string;
  @ApiPropertyOptional({ type: GeoPoint }) location?: GeoPoint;
  @ApiPropertyOptional() locatedAt?: string;
  /** Where the position came from: the phone as it was reported, or the shift's last known. */
  @ApiPropertyOptional({ enum: ['phone', 'last_known'] }) locationFrom?: 'phone' | 'last_known';
  @ApiProperty({ type: [BreakdownLoad] }) aboard: BreakdownLoad[];
  /** Today's planned orders that were waiting for it, held: their codes. */
  @ApiProperty({ type: [String] }) held: string[];
  /** DERIVED on read: what of it is still with the driver it broke down under — what a handover would move. */
  @ApiProperty({ type: [String] }) stillAboard: string[];
  /** Its loads, taken over by other vehicles of the fleet. */
  @ApiProperty({ type: [BreakdownHandover] }) handovers: BreakdownHandover[];
  @ApiProperty({ enum: ['open', 'resolved'] }) status: 'open' | 'resolved';
  @ApiPropertyOptional({ enum: ['back_on_road', 'workshop'] }) outcome?: 'back_on_road' | 'workshop';
  @ApiPropertyOptional() resolvedBy?: string;
  @ApiPropertyOptional() resolvedAt?: string;
  @ApiPropertyOptional() resolutionNote?: string;
}

/** One load a rescuing driver would take over: what it is, whether it is aboard or still to collect, and its weight. */
export class TakeOverLoad {
  @ApiProperty({ enum: ['freight', 'booking'] }) kind: 'freight' | 'booking';
  label: string;
  @ApiProperty({ enum: ['aboard', 'to_collect'] }) state: 'aboard' | 'to_collect';
  weightKg: number;
}

/** A broken-down vehicle of the driver's own fleet with loads still to take over — as the driver coming for them sees it. */
export class BreakdownToTakeOver {
  breakdownId: string;
  vehicleId: string;
  plate: string;
  /** Who is with it: the one whose pass hands the loads over. */
  @ApiPropertyOptional() driverName?: string;
  reportedAt: string;
  @ApiPropertyOptional({ type: GeoPoint }) location?: GeoPoint;
  @ApiProperty({ type: [TakeOverLoad] }) loads: TakeOverLoad[];
  totalKg: number;
}

/** A driver of the fleet out in another vehicle now, who could take a broken-down vehicle's loads over — and the room left. */
export class BreakdownTaker {
  driverDid: string;
  driverName: string;
  vehicleId: string;
  plate: string;
  roomKg: number;
}

/** What a handover moved. */
export class TakeOverResult {
  breakdownId: string;
  fromPlate: string;
  toPlate: string;
  @ApiProperty({ type: [String] }) moved: string[];
}

/** How often it is serviced: every so many km or months, whichever comes first. The class's usual unless the office set its own. */
export class ServicePlanView {
  @ApiPropertyOptional() everyKm?: number;
  @ApiPropertyOptional() everyMonths?: number;
  @ApiProperty({ enum: ['class', 'office'] }) source: 'class' | 'office';
}

/** When the next service is due, and how it stands. */
export class ServiceDueView {
  @ApiProperty({ type: ServicePlanView }) plan: ServicePlanView;
  @ApiPropertyOptional() dueDay?: string;
  @ApiPropertyOptional() dueKm?: number;
  @ApiPropertyOptional() currentKm?: number;
  @ApiProperty({ enum: ['ok', 'soon', 'overdue', 'unknown'] }) state: 'ok' | 'soon' | 'overdue' | 'unknown';
  /** The state in words, as notices and the vehicle's row say it. */
  line: string;
  /** What the count runs from: the last service, or (none yet) when the vehicle was registered — and that day. */
  @ApiProperty({ enum: ['service', 'registered'] }) from: 'service' | 'registered';
  fromDay: string;
}

/** A vehicle's upkeep as its owner reads it. */
export class VehicleCareView {
  vehicleId: string;
  plate: string;
  /** Today on the owner's clock (the fleet's): what every day on this sheet is judged by — not the reader's device. */
  today: string;
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
  /** The next service: when it is due, and how it stands. */
  @ApiProperty({ type: ServiceDueView }) service: ServiceDueView;
  /** What was done to it, newest first. */
  @ApiProperty({ type: [ServiceRecord] }) services: ServiceRecord[];
  /** Broken down: the open one, and those resolved in the last month, newest first. */
  @ApiProperty({ type: [VehicleBreakdown] }) breakdowns: VehicleBreakdown[];
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
