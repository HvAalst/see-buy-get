import { GlosError } from '../../foundation/http/glos-error';
import type { DepartureService } from './departure.service';
import type { FleetService } from './fleet.service';
import type { Vehicle } from './fleet.types';
import type { VehicleService } from './vehicle.service';

/**
 * 2026-11-21 — A VEHICLE TAKEN OFF: SOLD, SCRAPPED, OR ADDED BY MISTAKE (the owner: "consider that a vehicle may be sold and no
 * longer belongs to a driver as well"). One guard for every way it happens — its fleet, the courier who owns it, an owner who
 * says they sold it, staff on a plate claim: never while a shift runs on it, and never while a run waits for it (put the run on
 * another vehicle first). It is retired: its history stays, it is offered no more, and its plate is free for the vehicle that
 * really carries it now.
 */
export function takeOffVehicle(deps: { vehicles: VehicleService; fleet: FleetService; departures: DepartureService }, vehicleId: string): Vehicle {
  const v = deps.vehicles.get(vehicleId); // 404 if unknown
  if (v.status === 'RETIRED') throw new GlosError('INVALID_STATE', `${v.plate} is off the list already`);
  if (deps.fleet.activeForVehicle(vehicleId)) throw new GlosError('INVALID_STATE', `A shift is running on ${v.plate}: end it first`);
  const run = deps.departures.openRunsOf(vehicleId)[0];
  if (run) {
    throw new GlosError('INVALID_STATE', `${v.plate} is on the ${run.lineName} run leaving ${run.leavesAt.slice(0, 10)}, not left yet: put the run on another vehicle first`);
  }
  return deps.vehicles.retire(vehicleId);
}
