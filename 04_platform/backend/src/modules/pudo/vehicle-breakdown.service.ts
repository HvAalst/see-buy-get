import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DepartureService } from './departure.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { clockAt } from './fleet-clock';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { Vehicle } from './fleet.types';
import { MediaService } from './media.service';
import { dayWords } from './upkeep-words';
import { VehicleService } from './vehicle.service';
import { BreakdownCause, BreakdownLoad, VehicleBreakdown } from './vehicle-care.types';

/** What broke, as the line every refusal, notice and screen says. */
export const CAUSE_WORDS: Record<BreakdownCause, string> = {
  engine: 'Engine',
  tyre: 'A tyre',
  electrical: 'Electrics',
  brakes: 'Brakes',
  fuel: 'Fuel',
  accident: 'An accident',
  other: 'Something else',
};

/** How long a resolved breakdown stays on the vehicle's sheet. */
const RESOLVED_SHOWN_DAYS = 30;

/** One party to tell about a load on a broken-down vehicle — never by the vehicle's plate. */
export interface BreakdownTell {
  shipperDid: string;
  kind: 'freight' | 'booking';
  /** The order's code, or the booking's description. */
  label: string;
  state: 'aboard' | 'to_collect';
  /** The run, for a booking. */
  lineName?: string;
  departureId?: string;
  freightId?: string;
}

/** A breakdown reported, for the notices (NotificationDispatcher). */
export interface VehicleBrokeDown {
  fleetDid?: string;
  /** Who carries the goods, as their shippers know them: the fleet, or the courier. */
  carrier: string;
  plate: string;
  breakdown: VehicleBreakdown;
  /** "16 Oct 2026 at 14:05", on the fleet's clock. */
  when: string;
  tell: BreakdownTell[];
}

/** A breakdown resolved, for the notices: the driver who reported it, and the shippers of what is still aboard. */
export interface VehicleBreakdownResolved {
  fleetDid?: string;
  carrier: string;
  plate: string;
  breakdown: VehicleBreakdown;
  tell: BreakdownTell[];
}

/**
 * A VEHICLE BROKEN DOWN ON THE ROAD. A defect is something wrong with a vehicle that can still be driven to the yard,
 * or not; a breakdown is a vehicle that has STOPPED, somewhere, with a driver beside it and perhaps goods aboard. So it
 * is told at once, with where: to the office, and to the shippers of every load aboard it or on its way to be collected
 * by it — never by the plate, which a shipper is not shown. Today's planned orders that were waiting for it are held, so
 * the plan does not send it another trip, and the office plans the day again. Until the office says how it ended — back
 * on the road, or into the workshop — it is off the road through the same gate as every other reason.
 *
 * Parcels and bags are not told here: a parcel that will be late is told by its own rule, and a receiver is never
 * texted. What was aboard is kept on the breakdown as it was at that moment, so the next word to the shippers goes to
 * the same people.
 */
@Injectable()
export class VehicleBreakdownService {
  private readonly breakdowns = new PersistentMap<string, VehicleBreakdown & { photoRef?: string }>('vehicle-breakdowns');

  constructor(
    private readonly vehicles: VehicleService,
    private readonly managers: FleetManagerService,
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly dispatch: DispatchService,
    private readonly departures: DepartureService,
    private readonly media: MediaService,
    private readonly events: EventBus,
  ) {
    // Registered here rather than on module start, so a service built by hand in a test reads the same gate.
    this.vehicles.addOffRoadSource((v) => this.openOf(v.vehicleId).map((b) => this.line(v, b)));
  }

  /**
   * REPORTED BROKEN DOWN — by the driver out in it, or by the office the driver rang. What happened, in words; where,
   * from the phone now, or else the shift's last known position. Refused before anything is kept when it says nothing,
   * it is already reported broken down, a position is half a position, or a photograph is not the reporter's own.
   */
  report(vehicleId: string, who: { by: string; byDid?: string }, input: { cause: BreakdownCause; note: string; photoRef?: string; lat?: number; lng?: number }, now: number = Date.now()): VehicleBreakdown {
    const v = this.vehicles.get(vehicleId);
    if (v.status === 'RETIRED') throw new GlosError('INVALID_STATE', `${v.plate} is retired: it is not on the road`);
    const note = input.note?.trim();
    if (!note) throw new GlosError('INVALID_INPUT', 'Say what happened', { field: 'note' });
    if ((input.lat === undefined) !== (input.lng === undefined)) throw new GlosError('INVALID_INPUT', 'A position is a latitude and a longitude together', { field: 'lat' });
    const open = this.openOf(vehicleId)[0];
    if (open) throw new GlosError('INVALID_STATE', `${v.plate} is already reported broken down (${open.reportedBy}, ${this.when(v, open.reportedAt)}): the office has it`);
    if (input.photoRef && who.byDid) this.assertOwnPhoto(input.photoRef, who.byDid);

    const shift = this.fleet.activeForVehicle(vehicleId);
    const driver = shift ? this.drivers.get(shift.driverDid) : undefined;
    const fromPhone = input.lat !== undefined && input.lng !== undefined;
    const location = fromPhone ? { lat: input.lat!, lng: input.lng! } : shift?.location;
    const locatedAt = fromPhone ? new Date(now).toISOString() : shift?.lastLocatedAt;
    const loads = shift ? this.loadsOf(v, shift.driverDid) : [];
    const breakdown: VehicleBreakdown & { photoRef?: string } = {
      breakdownId: `brk_${randomBytes(6).toString('hex')}`,
      vehicleId,
      plate: v.plate,
      cause: input.cause,
      note,
      reportedBy: who.by,
      ...(who.byDid ? { reportedByDid: who.byDid } : {}),
      ...(shift ? { driverDid: shift.driverDid } : {}),
      ...(driver ? { driverName: driver.displayName } : {}),
      reportedAt: new Date(now).toISOString(),
      ...(location ? { location: { lat: location.lat, lng: location.lng }, locationFrom: fromPhone ? 'phone' : 'last_known' } : {}),
      ...(location && locatedAt ? { locatedAt } : {}),
      aboard: loads.map((l) => ({ kind: l.kind, id: l.id, label: l.label, state: l.state, ...(l.departureId ? { departureId: l.departureId } : {}), shipperTold: Boolean(l.shipperDid) })),
      held: this.holdTodaysTrips(v, now),
      status: 'open',
    };
    // The photograph becomes the vehicle's record, as a defect's does.
    if (input.photoRef && who.byDid && this.media.adopt(input.photoRef, who.byDid, { type: 'vehicle', id: vehicleId }, 'defect')) {
      breakdown.photoRef = input.photoRef;
      breakdown.hasPhoto = true;
    }
    this.breakdowns.set(breakdown.breakdownId, breakdown);
    const told: VehicleBrokeDown = {
      ...(v.managerDid ? { fleetDid: v.managerDid } : {}),
      carrier: this.carrierOf(v, driver?.displayName),
      plate: v.plate,
      breakdown: publicBreakdown(breakdown),
      when: this.when(v, breakdown.reportedAt),
      tell: tellsOf(loads),
    };
    void this.events.publish(GlosEvent.Pudo.VehicleBrokeDown, told, { source: 'pudo' }).catch(() => undefined);
    return publicBreakdown(breakdown);
  }

  /** Whether a breakdown can be resolved, asked before anything is written — the workshop's spell is written first. */
  assertResolvable(vehicleId: string, breakdownId: string, note: string): void {
    const b = this.breakdowns.get(breakdownId);
    if (!b || b.vehicleId !== vehicleId) throw new GlosError('NOT_FOUND', 'No such breakdown on this vehicle');
    if (b.status !== 'open') throw new GlosError('INVALID_STATE', 'That breakdown has already been resolved');
    if (!note?.trim()) throw new GlosError('INVALID_INPUT', 'Say what was done', { field: 'note' });
  }

  /**
   * HOW IT ENDED, in the office's words: back on the road, or into the workshop. The driver who reported it is told,
   * and so are the shippers of whatever is still aboard — that it moves again, or that it waits for another vehicle.
   */
  resolve(vehicleId: string, breakdownId: string, outcome: 'back_on_road' | 'workshop', note: string, by: string, now: number = Date.now()): VehicleBreakdown {
    this.assertResolvable(vehicleId, breakdownId, note);
    const b = this.breakdowns.get(breakdownId)!;
    const v = this.vehicles.get(vehicleId);
    const done: VehicleBreakdown & { photoRef?: string } = { ...b, status: 'resolved', outcome, resolvedBy: by, resolvedAt: new Date(now).toISOString(), resolutionNote: note.trim() };
    this.breakdowns.set(breakdownId, done);
    // Still aboard: what was aboard then, and has not since been delivered, given back, or moved to another vehicle.
    const current = b.driverDid ? this.loadsOf(v, b.driverDid) : [];
    const was = new Set(b.aboard.map((l) => `${l.kind}:${l.id}`));
    const still = current.filter((l) => was.has(`${l.kind}:${l.id}`));
    const driverName = b.driverName;
    const told: VehicleBreakdownResolved = { ...(v.managerDid ? { fleetDid: v.managerDid } : {}), carrier: this.carrierOf(v, driverName), plate: v.plate, breakdown: publicBreakdown(done), tell: tellsOf(still) };
    void this.events.publish(GlosEvent.Pudo.VehicleBreakdownResolved, told, { source: 'pudo' }).catch(() => undefined);
    return publicBreakdown(done);
  }

  /** A vehicle's breakdowns for its sheet: the open one, and those resolved in the last month, newest first. */
  of(vehicleId: string, now: number = Date.now()): VehicleBreakdown[] {
    const since = new Date(now - RESOLVED_SHOWN_DAYS * 86_400_000).toISOString();
    return this.all()
      .filter((b) => b.vehicleId === vehicleId && (b.status === 'open' || (b.resolvedAt ?? '') >= since))
      .map(publicBreakdown);
  }

  /** A fleet's vehicles broken down now: for the top of its office's screen. */
  openForFleet(fleetDid: string): VehicleBreakdown[] {
    const mine = new Set(this.vehicles.list({ managerDid: fleetDid }).map((v) => v.vehicleId));
    return this.all()
      .filter((b) => b.status === 'open' && mine.has(b.vehicleId))
      .map(publicBreakdown);
  }

  /** A breakdown's photograph, for the vehicle's owner — the upkeep routes decide who that is. */
  photo(vehicleId: string, breakdownId: string, variant: 'full' | 'thumb'): { bytes: Buffer; contentType: string } {
    const b = this.breakdowns.get(breakdownId);
    if (!b || b.vehicleId !== vehicleId || !b.photoRef) throw new GlosError('NOT_FOUND', 'No photograph for this breakdown');
    return this.media.blob(b.photoRef, variant);
  }

  /**
   * What is on the vehicle, or coming to it, and who to tell: the loads its driver has taken on and not delivered — in
   * it now, or still to be collected — and the bookings on a run of it that has left. The fleet's own bookings and its
   * own orders are told to nobody: the office is the one telling.
   */
  private loadsOf(v: Vehicle, driverDid: string): Array<BreakdownTell & { id: string; shipperDid?: string }> {
    const freight = this.dispatch.loadsOnVehicle(driverDid, v.vehicleId).map((f) => ({
      kind: 'freight' as const,
      id: f.freightId,
      freightId: f.freightId,
      label: f.code,
      state: f.state,
      ...(f.shipperDid ? { shipperDid: f.shipperDid } : {}),
    }));
    const bookings = this.departures.bookingsAboard(v.vehicleId).map((b) => ({
      kind: 'booking' as const,
      id: b.bookingId,
      label: b.description,
      state: 'aboard' as const,
      lineName: b.lineName,
      departureId: b.departureId,
      ...(b.shipperDid ? { shipperDid: b.shipperDid } : {}),
    }));
    return [...freight, ...bookings] as Array<BreakdownTell & { id: string; shipperDid?: string }>;
  }

  /** Today's planned orders that were waiting for this vehicle, held in the plan's own words: their codes. */
  private holdTodaysTrips(v: Vehicle, now: number): string[] {
    if (!v.managerDid) return [];
    const today = this.managers.todayOf(v.managerDid, now);
    const waiting = this.dispatch.plannedOrdersOn(v.managerDid, today, v.vehicleId);
    for (const f of waiting) this.dispatch.holdPlanned(f.freightId, `${v.plate} broke down on the road: plan the day again to put it on another truck`, now);
    return waiting.map((f) => f.code);
  }

  private line(v: Vehicle, b: VehicleBreakdown): string {
    return `Broken down (${CAUSE_WORDS[b.cause].toLowerCase()}), reported by ${b.reportedBy} on ${this.when(v, b.reportedAt)}: ${b.note}`;
  }

  /** "16 Oct 2026 at 14:05" — on the owner's clock. */
  private when(v: Vehicle, iso: string): string {
    const at = clockAt(Date.parse(iso), this.managers.zoneOf(v.managerDid, Date.parse(iso)) ?? 'UTC');
    return `${dayWords(at.day)} at ${at.clock}`;
  }

  /** Who carries the goods, as their shippers know them. */
  private carrierOf(v: Vehicle, driverName?: string): string {
    return v.managerDid ? this.managers.get(v.managerDid).companyName : (driverName ?? 'The courier');
  }

  private assertOwnPhoto(photoRef: string, ownerDid: string): void {
    const ref = this.media.get(photoRef);
    if (!ref || ref.ownerDid !== ownerDid || ref.status !== 'active' || (ref.link && ref.link.type !== 'vehicle')) throw new GlosError('INVALID_INPUT', 'That photograph is not one you took', { field: 'photoRef' });
  }

  private openOf(vehicleId: string): VehicleBreakdown[] {
    return this.all().filter((b) => b.vehicleId === vehicleId && b.status === 'open');
  }

  /** Newest first. */
  private all(): Array<VehicleBreakdown & { photoRef?: string }> {
    return [...this.breakdowns.values()].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  }
}

/** The parties to tell, each load once: only those somebody here can be told about. */
function tellsOf(loads: Array<BreakdownTell & { id: string; shipperDid?: string }>): BreakdownTell[] {
  return loads
    .filter((l) => l.shipperDid)
    .map((l) => ({
      shipperDid: l.shipperDid!,
      kind: l.kind,
      label: l.label,
      state: l.state,
      ...(l.lineName ? { lineName: l.lineName } : {}),
      ...(l.departureId ? { departureId: l.departureId } : {}),
      ...(l.freightId ? { freightId: l.freightId } : {}),
    }));
}

/** A breakdown as it is shown: never the photograph's id, only that there is one. */
function publicBreakdown(b: VehicleBreakdown & { photoRef?: string }): VehicleBreakdown {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { photoRef, ...rest } = b;
  return { ...rest, aboard: rest.aboard.map((l: BreakdownLoad) => ({ ...l })) };
}
