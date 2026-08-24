import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { CorridorService } from './corridor.service';
import { DriverService } from './driver.service';
import { VehicleService } from './vehicle.service';
import { CLASS_TO_CORRIDOR_VEHICLE } from './fleet.config';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { Assignment, DeclaredLeg, ResolvedBadge } from './fleet.types';
import { GeoPoint } from './pudo.types';

/** What a caller declares: the two ends, each named and pinned. */
export interface LegInput {
  fromLabel: string;
  from: GeoPoint;
  toLabel: string;
  to: GeoPoint;
}

/** How many past legs a driver is offered to re-pick from. A working driver runs a handful of roads. */
const LEG_HISTORY = 5;

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
  /**
   * The roads each driver has declared before, most recent first — durable, unlike the coupling itself.
   * A shift ends every evening and the app may be reinstalled, but "Hawassa → Addis" is still the road this
   * driver runs, and re-typing it every morning is exactly the friction that makes a driver skip declaring
   * at all — which is how the network stops knowing where anyone is going.
   */
  private readonly legHistory = new PersistentMap<string, DeclaredLeg[]>('pudo-driver-legs');

  constructor(
    private readonly drivers: DriverService,
    private readonly vehicles: VehicleService,
    private readonly corridors: CorridorService,
    private readonly events: EventBus,
  ) {}

  /** Couple a driver to a vehicle (the flexible bond), optionally declaring the leg they are running. */
  couple(driverDid: string, vehicleId: string, corridorId?: string, leg?: LegInput): Assignment {
    const driver = this.drivers.get(driverDid);
    const vehicle = this.vehicles.get(vehicleId);
    if (!this.drivers.canOperate(driverDid)) throw new GlosError('CANNOT_COUPLE', `Driver is ${driver.status} (or licence expired) — cannot be coupled`);
    if (!this.vehicles.isUsable(vehicleId)) throw new GlosError('CANNOT_COUPLE', `Vehicle is ${vehicle.status} — cannot be coupled`);
    if (!this.drivers.clearedFor(driverDid, vehicle.vehicleClass)) throw new GlosError('CANNOT_COUPLE', `Driver is not licence-cleared for a ${vehicle.vehicleClass}`);
    if (this.activeForDriver(driverDid)) throw new GlosError('ALREADY_COUPLED', 'Driver is already coupled to a vehicle — uncouple first');
    if (this.activeForVehicle(vehicleId)) throw new GlosError('ALREADY_COUPLED', 'Vehicle is already coupled to a driver — uncouple first');
    if (corridorId) this.corridors.requireCorridor(corridorId);

    const assignment: Assignment = {
      assignmentId: `asg_${randomBytes(6).toString('hex')}`,
      driverDid,
      vehicleId,
      corridorId,
      leg: leg ? this.normalizeLeg(leg) : undefined,
      status: 'active',
      startedAt: new Date().toISOString(),
    };
    this.assignments.set(assignment.assignmentId, assignment);
    if (assignment.leg) this.rememberLeg(driverDid, assignment.leg);
    this.drivers.setAssignedVehicle(driverDid, vehicleId);
    void this.events.publish(GlosEvent.Pudo.DriverCoupled, { assignmentId: assignment.assignmentId, driverDid, vehicleId, vehicleClass: vehicle.vehicleClass, corridorId }, { source: 'pudo' }).catch(() => undefined);
    return assignment;
  }

  /**
   * Start a work shift: the driver scans the vehicle's dashboard QR → couples to it. This is how both
   * the driver and the vehicle are "activated" for the day; closing the session decouples them.
   */
  startSession(driverDid: string, vehicleScan: string, leg?: LegInput): Assignment {
    const vehicle = this.vehicles.byQr(vehicleScan);
    if (!vehicle) throw new GlosError('NOT_FOUND', 'Unknown vehicle QR — scan the sticker on the dashboard');
    return this.couple(driverDid, vehicle.vehicleId, undefined, leg);
  }

  /* --- the declared leg: where this driver is actually going --- */

  /**
   * Declare (or re-declare) the leg for the current shift. Re-declaring is the normal case, not an edit of a
   * mistake: a driver who has reached Addis turns round, and the road they are on now is the opposite of the
   * one they named this morning. Refused off shift — a leg belongs to a coupling, and there is nothing to
   * feed shipments into when nobody is driving.
   */
  declareLeg(driverDid: string, leg: LegInput): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new GlosError('NOT_COUPLED', 'Start a shift before saying where you are going');
    active.leg = this.normalizeLeg(leg);
    this.rememberLeg(driverDid, active.leg);
    return active;
  }

  /** The leg this driver declared for the shift they are on, if any. */
  legFor(driverDid: string): DeclaredLeg | undefined {
    return this.activeForDriver(driverDid)?.leg;
  }

  /** The roads this driver has run before, most recent first — what the app offers instead of re-typing. */
  recentLegs(driverDid: string): DeclaredLeg[] {
    return [...(this.legHistory.get(driverDid) ?? [])];
  }

  private normalizeLeg(leg: LegInput): DeclaredLeg {
    const fromLabel = leg?.fromLabel?.trim();
    const toLabel = leg?.toLabel?.trim();
    if (!fromLabel || !toLabel) throw new GlosError('FIELD_REQUIRED', 'A leg needs a start and an end, both named');
    for (const p of [leg.from, leg.to]) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
        throw new GlosError('INVALID_INPUT', 'A leg needs a point for each end — name it and place it on the map');
      }
    }
    return { fromLabel, from: { lat: leg.from.lat, lng: leg.from.lng }, toLabel, to: { lat: leg.to.lat, lng: leg.to.lng }, declaredAt: new Date().toISOString() };
  }

  /** Keep the leg at the head of this driver's history, deduped by its two ends (the same road, re-run). */
  private rememberLeg(driverDid: string, leg: DeclaredLeg): void {
    const key = (l: DeclaredLeg) => `${l.fromLabel.toLowerCase()}→${l.toLabel.toLowerCase()}`;
    const rest = (this.legHistory.get(driverDid) ?? []).filter((l) => key(l) !== key(leg));
    this.legHistory.set(driverDid, [leg, ...rest].slice(0, LEG_HISTORY));
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
    if (!active) throw new GlosError('NOT_COUPLED', 'Driver is not currently coupled to a vehicle');
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
    if (!active) throw new GlosError('NOT_COUPLED', 'Driver is not currently coupled to a vehicle');
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
    if (!a) throw new GlosError('NOT_FOUND', `Assignment not found: ${assignmentId}`);
    return a;
  }
}
