import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { CorridorService } from './corridor.service';
import { DriverService } from './driver.service';
import { VehicleService } from './vehicle.service';
import { CLASS_TO_CORRIDOR_VEHICLE } from './fleet.config';
import { Assignment, ResolvedBadge } from './fleet.types';

/**
 * FleetService — the flexible driver↔vehicle coupling (Compendium Ch 19). Drivers and vehicles are
 * independent; an Assignment couples one driver to one vehicle (optionally on a corridor) for as long
 * as it is active, and can be ended + re-formed freely. Rules: both must be usable (driver ACTIVE +
 * licence valid, vehicle ACTIVE), the driver must be licence-cleared for the vehicle's class, and
 * neither may already be in an active coupling. `resolveBadge` is what the handover / bag-load flow
 * calls once a driver badge is scanned — it returns the coupled vehicle + its capacity/handling rules.
 */
@Injectable()
export class FleetService {
  private readonly assignments = new Map<string, Assignment>();

  constructor(
    private readonly drivers: DriverService,
    private readonly vehicles: VehicleService,
    private readonly corridors: CorridorService,
    private readonly events: EventBus,
  ) {}

  /** Couple a driver to a vehicle (the flexible bond). */
  couple(driverDid: string, vehicleId: string, corridorId?: string): Assignment {
    const driver = this.drivers.get(driverDid);
    const vehicle = this.vehicles.get(vehicleId);
    if (!this.drivers.canOperate(driverDid)) throw new BadRequestException(`Driver is ${driver.status} (or licence expired) — cannot be coupled`);
    if (!this.vehicles.isUsable(vehicleId)) throw new BadRequestException(`Vehicle is ${vehicle.status} — cannot be coupled`);
    if (!this.drivers.clearedFor(driverDid, vehicle.vehicleClass)) throw new BadRequestException(`Driver is not licence-cleared for a ${vehicle.vehicleClass}`);
    if (this.activeForDriver(driverDid)) throw new BadRequestException('Driver is already coupled to a vehicle — uncouple first');
    if (this.activeForVehicle(vehicleId)) throw new BadRequestException('Vehicle is already coupled to a driver — uncouple first');
    if (corridorId) this.corridors.requireCorridor(corridorId);

    const assignment: Assignment = {
      assignmentId: `asg_${randomBytes(6).toString('hex')}`,
      driverDid,
      vehicleId,
      corridorId,
      status: 'active',
      startedAt: new Date().toISOString(),
    };
    this.assignments.set(assignment.assignmentId, assignment);
    this.drivers.setAssignedVehicle(driverDid, vehicleId);
    void this.events.publish(GlosEvent.Pudo.DriverCoupled, { assignmentId: assignment.assignmentId, driverDid, vehicleId, vehicleClass: vehicle.vehicleClass, corridorId }, { source: 'pudo' }).catch(() => undefined);
    return assignment;
  }

  /**
   * Start a work shift: the driver scans the vehicle's dashboard QR → couples to it. This is how both
   * the driver and the vehicle are "activated" for the day; closing the session decouples them.
   */
  startSession(driverDid: string, vehicleScan: string): Assignment {
    const vehicle = this.vehicles.byQr(vehicleScan);
    if (!vehicle) throw new NotFoundException('Unknown vehicle QR — scan the sticker on the dashboard');
    return this.couple(driverDid, vehicle.vehicleId);
  }

  /** End the work shift (close session) → decouple driver + vehicle. */
  endSession(driverDid: string): Assignment {
    return this.uncouple(driverDid);
  }

  /** The driver's current shift session (active coupling + the vehicle), or null when off duty. */
  sessionFor(driverDid: string): { active: boolean; assignment: Assignment; vehicle: ReturnType<VehicleService['get']> } | { active: false } {
    const assignment = this.activeForDriver(driverDid);
    if (!assignment) return { active: false };
    return { active: true, assignment, vehicle: this.vehicles.get(assignment.vehicleId) };
  }

  /** End the driver's active coupling (frees both the driver and the vehicle). */
  uncouple(driverDid: string): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new BadRequestException('Driver is not currently coupled to a vehicle');
    active.status = 'ended';
    active.endedAt = new Date().toISOString();
    this.drivers.setAssignedVehicle(driverDid, undefined);
    void this.events.publish(GlosEvent.Pudo.DriverUncoupled, { assignmentId: active.assignmentId, driverDid, vehicleId: active.vehicleId }, { source: 'pudo' }).catch(() => undefined);
    return active;
  }

  /** Driver heartbeat — record the vehicle's GPS position on the active session (live fleet map). */
  reportLocation(driverDid: string, location: { lat: number; lng: number }): Assignment | undefined {
    const active = this.activeForDriver(driverDid);
    if (!active) return undefined;
    active.location = location;
    active.lastLocatedAt = new Date().toISOString();
    return active;
  }

  /**
   * Fleet-manager dashboard rollup: vehicle/driver/session counts, on-duty working hours, and live
   * vehicle positions (active sessions that have reported GPS).
   */
  overview(managerDid?: string, now: number = Date.now()): {
    vehicles: { total: number; active: number; inUse: number; byClass: Record<string, number> };
    drivers: { total: number; onShift: number; offShift: number; byStatus: Record<string, number> };
    sessions: { active: number; todayHours: number; list: Array<{ driverDid: string; driverName: string; plate: string; vehicleClass: string; startedAt: string; hoursOnDuty: number; location?: { lat: number; lng: number } }> };
    positions: Array<{ plate: string; vehicleClass: string; driverName: string; location: { lat: number; lng: number }; hoursOnDuty: number }>;
  } {
    const ownsDriver = (driverDid: string) => !managerDid || this.drivers.get(driverDid).managerDid === managerDid;
    const all = [...this.assignments.values()].filter((a) => ownsDriver(a.driverDid));
    const dayStart = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
    const hoursOf = (a: Assignment) => Math.round((((a.status === 'active' ? now : new Date(a.endedAt!).getTime()) - new Date(a.startedAt).getTime()) / 3_600_000) * 100) / 100;

    const activeSessions = all.filter((a) => a.status === 'active');
    const list = activeSessions.map((a) => {
      const d = this.drivers.get(a.driverDid);
      const v = this.vehicles.get(a.vehicleId);
      return { driverDid: a.driverDid, driverName: d.displayName, plate: v.plate, vehicleClass: v.vehicleClass, startedAt: a.startedAt, hoursOnDuty: hoursOf(a), location: a.location };
    });
    const todayHours = Math.round(all.filter((a) => new Date(a.startedAt).getTime() >= dayStart).reduce((s, a) => s + hoursOf(a), 0) * 100) / 100;

    const allVehicles = this.vehicles.list({ managerDid });
    const byClass: Record<string, number> = {};
    for (const v of allVehicles) byClass[v.vehicleClass] = (byClass[v.vehicleClass] ?? 0) + 1;
    const allDrivers = this.drivers.list().filter((d) => !managerDid || d.managerDid === managerDid);
    const byStatus: Record<string, number> = {};
    for (const d of allDrivers) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    const onShift = new Set(activeSessions.map((a) => a.driverDid)).size;

    return {
      vehicles: { total: allVehicles.length, active: allVehicles.filter((v) => v.status === 'ACTIVE').length, inUse: activeSessions.length, byClass },
      drivers: { total: allDrivers.length, onShift, offShift: allDrivers.length - onShift, byStatus },
      sessions: { active: activeSessions.length, todayHours, list },
      positions: list.filter((s) => s.location).map((s) => ({ plate: s.plate, vehicleClass: s.vehicleClass, driverName: s.driverName, location: s.location!, hoursOnDuty: s.hoursOnDuty })),
    };
  }

  /** Set / change the corridor the active coupling serves. */
  assignCorridor(driverDid: string, corridorId: string): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new BadRequestException('Driver is not currently coupled to a vehicle');
    this.corridors.requireCorridor(corridorId);
    active.corridorId = corridorId;
    return active;
  }

  /** Resolve a scanned badge → the coupled vehicle + capacity/handling, for handover / bag-load. */
  resolveBadge(badgeId: string): ResolvedBadge | undefined {
    const driver = this.drivers.byBadge(badgeId);
    if (!driver || !this.drivers.canOperate(driver.did)) return undefined;
    const active = this.activeForDriver(driver.did);
    if (!active) return undefined;
    const vehicle = this.vehicles.get(active.vehicleId);
    return {
      driverDid: driver.did,
      badgeId,
      vehicle,
      corridorId: active.corridorId,
      vehicleType: CLASS_TO_CORRIDOR_VEHICLE[vehicle.vehicleClass],
      capacityKg: vehicle.capacityKg,
      maxParcelKg: vehicle.maxParcelKg,
      allowsFragile: vehicle.allowsFragile,
    };
  }

  /** The vehicle the driver is currently coupled to (for dispatch capacity + handling rules). */
  vehicleForDriver(driverDid: string) {
    const active = this.activeForDriver(driverDid);
    return active ? this.vehicles.get(active.vehicleId) : undefined;
  }

  activeForDriver(driverDid: string): Assignment | undefined {
    return [...this.assignments.values()].find((a) => a.status === 'active' && a.driverDid === driverDid);
  }

  activeForVehicle(vehicleId: string): Assignment | undefined {
    return [...this.assignments.values()].find((a) => a.status === 'active' && a.vehicleId === vehicleId);
  }

  list(filter: { status?: Assignment['status'] } = {}): Assignment[] {
    return [...this.assignments.values()].filter((a) => !filter.status || a.status === filter.status);
  }

  get(assignmentId: string): Assignment {
    const a = this.assignments.get(assignmentId);
    if (!a) throw new NotFoundException(`Assignment not found: ${assignmentId}`);
    return a;
  }
}
