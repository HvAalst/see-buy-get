import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VEHICLE_CLASSES, VehicleClass } from './fleet.config';

/*
 * P3 — a fleet's plan for one day, as its office reads it. The arithmetic is in day-plan.ts; these are the names and
 * the words round it.
 */

/** Why an order is not in the plan. `no_pin` is this layer's own: an address with no point cannot be routed at all. */
export const PLAN_LEFT_REASONS = ['no_pin', 'too_heavy', 'no_truck_can_carry', 'no_time', 'no_driver', 'no_trucks'] as const;
export type PlanLeftReason = (typeof PLAN_LEFT_REASONS)[number];

/**
 * The hour a fleet's planned day starts, where its office has not said otherwise — and so the hour from which an
 * order for that day that is on no vehicle is something its shipper should hear (dispatch.service.ts, lateOf).
 */
export const DEFAULT_DAY_START = '07:00';

export class PlanStopView {
  freightId: string;
  code: string;
  @ApiPropertyOptional() orderRef?: string;
  description: string;
  shipperName: string;
  destLabel: string;
  weightKg: number;
  /** Kilometres from the collection, or from the stop before. */
  km: number;
  /** When the goods are handed over at this door, on the clock (HH:MM). An estimate from distance and the day's settings. */
  arrive: string;
  /** The window in the shipper's own words. */
  @ApiPropertyOptional() deliveryWindow?: string;
  /** The window as the plan READ those words ("08:00–12:00", "before 14:00") — what it planned to. Absent: no window, or words it could not read as one. */
  @ApiPropertyOptional() window?: string;
  /** The shipper wrote something about when, and the plan could not read it as a time: it is shown, and was not planned to. */
  @ApiPropertyOptional() windowUnread?: boolean;
  /** Minutes after its window closed that the door is reached. Planned all the same, and said. */
  @ApiPropertyOptional() lateMin?: number;
  /** Minutes before its window opens that the goods are handed over: the day had no room to wait. */
  @ApiPropertyOptional() earlyMin?: number;
  /** Minutes the truck stands at the door before its window opens; `arrive` is then the opening. */
  @ApiPropertyOptional() waitMin?: number;
}

export class PlanTripView {
  no: number;
  pickupLabel: string;
  /** Empty running to reach the collection: from the depot, or from where the last trip ended. */
  emptyKm: number;
  start: string;
  end: string;
  weightKg: number;
  @ApiProperty({ type: [PlanStopView] }) stops: PlanStopView[];
}

export class PlanRouteView {
  vehicleId: string;
  plate: string;
  @ApiProperty({ enum: VEHICLE_CLASSES }) vehicleClass: VehicleClass;
  capacityKg: number;
  @ApiProperty({ type: [PlanTripView] }) trips: PlanTripView[];
  km: number;
  emptyKm: number;
  /** Depot to depot, in minutes, and when the truck is home again. */
  minutes: number;
  home: string;
  /** Everything it carries in the day, over all its trips. */
  weightKg: number;
  /** Its fullest trip, as a share of what it carries at once (0–100). */
  fullestPct: number;
}

export class PlanLeftView {
  freightId: string;
  code: string;
  @ApiPropertyOptional() orderRef?: string;
  description: string;
  shipperName: string;
  destLabel: string;
  weightKg: number;
  @ApiProperty({ enum: PLAN_LEFT_REASONS }) reason: PlanLeftReason;
  /**
   * For an order heavier than the fleet's largest vehicle that the office MAY split: how many loads of that vehicle
   * it would make. A suggestion — the office decides, and the shipper is told.
   */
  @ApiPropertyOptional() splitInto?: number;
  /** What that largest vehicle carries. */
  @ApiPropertyOptional() loadKg?: number;
}

export class PlanHire {
  /** How many more trucks like the fleet's largest the leftover orders would take. */
  trucks: number;
  orders: number;
  weightKg: number;
  /** What one of those trucks carries. */
  capacityKg: number;
}

export class PlanVehicle {
  vehicleId: string;
  plate: string;
  @ApiProperty({ enum: VEHICLE_CLASSES }) vehicleClass: VehicleClass;
  capacityKg: number;
  /** Left out of this plan by the office. */
  excluded: boolean;
  /** Off the road for a reason of its own (papers, status): never planned, and said why. */
  @ApiPropertyOptional({ type: [String] }) offRoad?: string[];
}

/**
 * P5 — A RULE THE OFFICE PUT ON A PLAN: keep one order off one vehicle, or put one order on one vehicle. Narrow on
 * purpose — an order and a vehicle, both named — so that what was asked can be read back and checked. Anything wider
 * (an area, a customer) is said as several of these.
 */
export const PLAN_RULE_KINDS = ['keep_off', 'put_on'] as const;
export type PlanRuleKind = (typeof PLAN_RULE_KINDS)[number];

export class PlanRuleView {
  @ApiProperty({ enum: PLAN_RULE_KINDS }) kind: PlanRuleKind;
  freightId: string;
  code: string;
  vehicleId: string;
  plate: string;
}

export class PlanSettings {
  /** When the trucks leave the depot (HH:MM), and the longest a truck's day may be, in hours. */
  dayStart: string;
  dayHours: number;
  speedKmh: number;
  loadMin: number;
  unloadMin: number;
}

export class PlanTotals {
  /** Orders for the day still without a truck when the plan was made, and how many of them it placed. */
  orders: number;
  planned: number;
  weightKg: number;
  plannedKg: number;
  km: number;
  emptyKm: number;
  trucksUsed: number;
  trucksAvailable: number;
  /** Drivers the fleet has to send out — on the day's roster, or every active driver where there is none: the plan uses no more trucks than this. */
  drivers: number;
  /** Planned orders that reach their door outside the window their shipper asked for — late, or early. Each is marked. */
  outsideWindow: number;
  /** Orders whose window is in words the plan could not read as a time. They are planned, to the day only. */
  unreadWindows: number;
}

export class PlanAccepted {
  at: string;
  by: string;
}

/**
 * WHAT A PLAN'S DISTANCES ARE. `roads` — from the routing server the operator configured · `estimate` — straight
 * lines with an allowance for the road, as a plan was always made. When a routing server is configured and could not
 * be used, `why` says so; `gaps` counts the legs it knew no road for, each estimated on its own.
 */
export class PlanDistances {
  @ApiProperty({ enum: ['roads', 'estimate'] }) source: 'roads' | 'estimate';
  @ApiPropertyOptional() why?: string;
  @ApiPropertyOptional() gaps?: number;
}

/** WHO THE PLAN COUNTED as driving that day, and why: the office's roster for the day, or — where it set none — everybody. */
export class PlanRoster {
  @ApiProperty({ enum: ['roster', 'everyone'] }) source: 'roster' | 'everyone';
  names: string[];
}

export class DayPlanView {
  day: string;
  madeAt: string;
  @ApiProperty({ type: [PlanRouteView] }) routes: PlanRouteView[];
  @ApiProperty({ type: [PlanLeftView] }) unplanned: PlanLeftView[];
  @ApiPropertyOptional({ type: PlanHire }) hire?: PlanHire;
  @ApiProperty({ type: PlanTotals }) totals: PlanTotals;
  @ApiProperty({ type: PlanSettings }) settings: PlanSettings;
  @ApiProperty({ type: [PlanVehicle] }) vehicles: PlanVehicle[];
  /** The rules this plan was made under. Empty when there are none. */
  @ApiProperty({ type: [PlanRuleView] }) rules: PlanRuleView[];
  /** Who it counted as driving. A plan kept from before there were rosters has none: it counted everybody. */
  @ApiPropertyOptional({ type: PlanRoster }) roster?: PlanRoster;
  /** What its distances are. A plan kept from before there was a routing server to ask has none: it was an estimate. */
  @ApiPropertyOptional({ type: PlanDistances }) distances?: PlanDistances;
  /** The clock its times are on: the fleet's own time zone when the plan was made. Absent: the fleet had none. */
  @ApiPropertyOptional() timeZone?: string;
  /** Set on the plan the office accepted for this day. A proposal has none. */
  @ApiPropertyOptional({ type: PlanAccepted }) accepted?: PlanAccepted;
}

/** The accepted plan for a day, and how the day has moved on since it was accepted. */
export class DayPlanState {
  day: string;
  /** The plan as it was accepted — a record, not recomputed. Absent: no plan accepted for this day. */
  @ApiPropertyOptional({ type: DayPlanView }) plan?: DayPlanView;
  /** Orders the accepted plan could not place, still waiting: known about, and somebody's to hire for or pin. */
  leftOut: number;
  /** Orders for the day that ARRIVED after the plan was accepted: the plan has never seen them. */
  newSince: number;
  /** Orders in the accepted plan that have since been withdrawn. */
  withdrawnSince: number;
}

/** Why the plan could not put an order on its truck when its trip came up: the same refusal a dispatcher would get. */
export class PlanHeld {
  why: string;
  at: string;
}

/**
 * `sent` its next trip went onto the driver · `no_driver` nobody is on a shift in this truck · `carrying` the driver
 * still has goods aboard, so the next trip waits · `nothing_left` every trip planned on it has gone out.
 */
export const PLAN_SEND_STATES = ['sent', 'no_driver', 'carrying', 'nothing_left'] as const;
export type PlanSendState = (typeof PLAN_SEND_STATES)[number];

export class PlanSendHeld {
  code: string;
  why: string;
}

export class PlanSendTruck {
  vehicleId: string;
  plate: string;
  @ApiProperty({ enum: PLAN_SEND_STATES }) state: PlanSendState;
  @ApiPropertyOptional() driverName?: string;
  @ApiPropertyOptional() tripNo?: number;
  /** The orders that went onto the driver, by code. */
  @ApiProperty({ type: [String] }) sent: string[];
  /** The orders of that trip that were refused, and why. They stay in the queue, marked. */
  @ApiProperty({ type: [PlanSendHeld] }) held: PlanSendHeld[];
}

export class PlanSendResult {
  day: string;
  @ApiProperty({ type: [PlanSendTruck] }) trucks: PlanSendTruck[];
}

/** What an order carries once a plan it is in has been accepted. */
export class PlannedOn {
  day: string;
  vehicleId: string;
  plate: string;
  tripNo: number;
  /** Its place in the trip's round, from 1. */
  seq: number;
  /** When the truck is expected at the door, on the clock. */
  arrive: string;
  /** The window the plan was made to, as it was read then — kept, because the shipper may reword what it asked for. */
  @ApiPropertyOptional() window?: string;
  /** Planned to arrive this many minutes after the window its shipper asked for. */
  @ApiPropertyOptional() lateMin?: number;
  /** Planned to be handed over this many minutes before its window opens. */
  @ApiPropertyOptional() earlyMin?: number;
  at: string;
  /** Set when its trip came up and it could not be put on the truck. Cleared when it is, or when the day is planned again. */
  @ApiPropertyOptional({ type: PlanHeld }) held?: PlanHeld;
}
