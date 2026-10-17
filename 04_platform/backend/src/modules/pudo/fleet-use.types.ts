import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VEHICLE_CLASSES, VehicleClass } from './fleet.config';

/**
 * HOW A FLEET'S VEHICLES WERE USED over some days — from what is already recorded and nothing else: the shifts drivers
 * started in them, the odometer readings they gave, the loads delivered and the runs driven in them, and the days they
 * were off the road. No tracker, and nothing about how anybody drives: a vehicle's use, never a person's performance.
 *
 * A shift counts on the day it started. Days still to come are not counted. A day is the fleet's own.
 */

export class UseTotals {
  vehicles: number;
  /** Days a shift was started in it. */
  daysOut: number;
  /** Days it was off the road — a spell (workshop, service, accident) or a breakdown — and not out. */
  daysOffRoad: number;
  /** Days it could have gone out and did not. */
  daysIdle: number;
  shifts: number;
  hoursOnShift: number;
  /** Driven, from its odometer readings within the days. Absent where fewer than two readings were given. */
  @ApiPropertyOptional() km?: number;
  /** Loads delivered from it, their weight, and the kilometres they were carried loaded and run empty to reach them. */
  loads: number;
  kgDelivered: number;
  loadedKm: number;
  emptyKm: number;
  /** Runs that left in it, and the weight booked on them. */
  runs: number;
  runKg: number;
}

export class VehicleUse extends UseTotals {
  vehicleId: string;
  plate: string;
  @ApiProperty({ enum: VEHICLE_CLASSES }) vehicleClass: VehicleClass;
  capacityKg: number;
  siteId: string;
  siteName: string;
}

export class SiteUse extends UseTotals {
  siteId: string;
  name: string;
}

export class FleetUseView {
  from: string;
  to: string;
  /** The days counted: from `from` to `to`, or to today where `to` has not come. */
  days: number;
  @ApiProperty({ type: [VehicleUse] }) vehicles: VehicleUse[];
  @ApiProperty({ type: [SiteUse] }) sites: SiteUse[];
  @ApiProperty({ type: UseTotals }) totals: UseTotals;
}
