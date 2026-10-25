import { Injectable, Optional } from '@nestjs/common';
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
import { BreakdownCause, BreakdownHandover, BreakdownLoad, BreakdownTaker, BreakdownToTakeOver, TakeOverResult, VehicleBreakdown } from './vehicle-care.types';
import { whenSeen } from './observed-at';
import { ToteService } from './tote.service';
import { ParcelService } from './parcel.service';
import { WalletGateService } from './wallet-gate.service';
import { roadPartAt } from './pricing';
import { haversineKm } from './geo';

/**
 * How near a courier on a shift must be to be told another courier broke down with bags and parcels to take over, and
 * to see it among theirs to take: a ride across town, not across the country.
 */
export const TAKEOVER_NEAR_KM = 25;

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
  /**
   * A courier's vehicle broke down with bags or parcels aboard: the couriers on a shift near it, told so one of them can
   * come and take them over — and what there is to take.
   */
  nearby?: Array<{ driverDid: string; km: number }>;
  toTakeOver?: { bags: number; parcels: number };
}

/**
 * A breakdown's loads taken over, for the notices: the office, the two drivers, and the shippers of what moved. No fleet
 * where a courier's bags and parcels went on with another courier.
 */
export interface VehicleLoadsHandedOver {
  fleetDid?: string;
  /** Loads moved while aboard, and runs that went on: their notes are frozen with the reload on them. */
  reloadedFreightIds: string[];
  reloadedDepartureIds: string[];
  carrier: string;
  fromPlate: string;
  breakdownId: string;
  /** The driver the loads were with, and the driver and truck that took them. */
  fromDriverDid: string;
  toDriverDid: string;
  toVehicleId: string;
  fromDriverName?: string;
  handover: BreakdownHandover;
  tell: BreakdownTell[];
}

/**
 * A load as a breakdown reads it: what to tell about it, and what it weighs. A bag, or a parcel a shop handed the driver,
 * has no shipper to tell here — its receiver hears by the parcel's own running-late rule — and moves the same way.
 */
type Load = Omit<BreakdownTell, 'kind' | 'shipperDid'> & { kind: BreakdownLoad['kind']; id: string; shipperDid?: string; weightKg: number };

/** What of a breakdown's loads a courier takes over from another courier: bags and loose parcels. A load stays with its carrier. */
const ROAD_GOODS: ReadonlySet<BreakdownLoad['kind']> = new Set(['bag', 'parcel']);

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
    // Bags and loose parcels move in a takeover, and a bag's road is paid in parts (the user, 2026-10-25: "Split by the
    // road"). Optional so a service built by hand for its loads alone keeps compiling; without them, loads move alone.
    @Optional() private readonly totes?: ToteService,
    @Optional() private readonly parcels?: ParcelService,
    @Optional() private readonly gate?: WalletGateService,
  ) {
    // Registered here rather than on module start, so a service built by hand in a test reads the same gate.
    this.vehicles.addOffRoadSource((v) => this.openOf(v.vehicleId).map((b) => this.line(v, b)));
  }

  /**
   * REPORTED BROKEN DOWN — by the driver out in it, or by the office the driver rang. What happened, in words; where,
   * from the phone now, or else the shift's last known position. Refused before anything is kept when it says nothing,
   * it is already reported broken down, a position is half a position, or a photograph is not the reporter's own.
   */
  report(vehicleId: string, who: { by: string; byDid?: string }, input: { cause: BreakdownCause; note: string; photoRef?: string; lat?: number; lng?: number; observedAt?: string }, now: number = Date.now()): VehicleBreakdown {
    // Dated when it happened, not when the phone found a signal (observed-at.ts).
    const seen = whenSeen(input.observedAt, now);
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
    const locatedAt = fromPhone ? new Date(seen.at).toISOString() : shift?.lastLocatedAt;
    const loads = shift ? this.loadsOf(v, shift.driverDid) : [];
    // A COURIER'S vehicle with bags or parcels aboard: the couriers on a shift near it are told, so that one of them can
    // come and take them on (a fleet's go to another of its own vehicles, which its office arranges).
    const goods = loads.filter((l) => ROAD_GOODS.has(l.kind));
    const nearby = !v.managerDid && goods.length && location && shift ? this.couriersNear(location, shift.driverDid) : [];
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
      reportedAt: new Date(seen.at).toISOString(),
      ...(seen.receivedAt ? { receivedAt: seen.receivedAt } : {}),
      ...(location ? { location: { lat: location.lat, lng: location.lng }, locationFrom: fromPhone ? 'phone' : 'last_known' } : {}),
      ...(location && locatedAt ? { locatedAt } : {}),
      aboard: loads.map((l) => ({ kind: l.kind, id: l.id, label: l.label, state: l.state, ...(l.departureId ? { departureId: l.departureId } : {}), shipperTold: Boolean(l.shipperDid) })),
      held: this.holdTodaysTrips(v, seen.at),
      stillAboard: [],
      handovers: [],
      status: 'open',
      ...(!v.managerDid && goods.length ? { couriersTold: nearby.length } : {}),
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
      ...(nearby.length ? { nearby } : {}),
      ...(!v.managerDid && goods.length ? { toTakeOver: { bags: goods.filter((l) => l.kind === 'bag').length, parcels: goods.filter((l) => l.kind === 'parcel').length } } : {}),
    };
    void this.events.publish(GlosEvent.Pudo.VehicleBrokeDown, told, { source: 'pudo' }).catch(() => undefined);
    return this.view(breakdown);
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
    const told: VehicleBreakdownResolved = { ...(v.managerDid ? { fleetDid: v.managerDid } : {}), carrier: this.carrierOf(v, b.driverName), plate: v.plate, breakdown: publicBreakdown(done), tell: tellsOf(this.stillWith(v, b)) };
    void this.events.publish(GlosEvent.Pudo.VehicleBreakdownResolved, told, { source: 'pudo' }).catch(() => undefined);
    return this.view(done);
  }

  /**
   * WHAT THE DRIVER COMING FOR THE LOADS SEES: the broken-down vehicles of their own fleet that still have loads with
   * the driver they broke down under — never the one they are out in themselves. Nothing while they are not on a shift.
   */
  toTakeOver(takerDid: string): BreakdownToTakeOver[] {
    const shift = this.fleet.activeForDriver(takerDid);
    const mine = shift ? this.vehicles.get(shift.vehicleId) : undefined;
    if (mine && !mine.managerDid) return this.courierTakeOvers(takerDid, mine.vehicleId, shift!.location);
    if (!mine?.managerDid) return [];
    return this.all()
      .filter((b) => b.vehicleId !== mine.vehicleId && b.driverDid && b.driverDid !== takerDid)
      .map((b) => ({ b, v: this.vehicles.get(b.vehicleId) }))
      .filter(({ v }) => v.managerDid === mine.managerDid)
      .map(({ b, v }) => ({ b, v, loads: this.stillWith(v, b) }))
      .filter(({ loads }) => loads.length > 0)
      .map(({ b, v, loads }) => ({
        breakdownId: b.breakdownId,
        vehicleId: v.vehicleId,
        plate: v.plate,
        ...(b.driverName ? { driverName: b.driverName } : {}),
        reportedAt: b.reportedAt,
        ...(b.location ? { location: { ...b.location } } : {}),
        loads: loads.map((l) => ({ kind: l.kind, label: l.label, state: l.state, weightKg: l.weightKg })),
        totalKg: Math.round(loads.reduce((n, l) => n + l.weightKg, 0) * 100) / 100,
      }));
  }

  /**
   * WHAT A COURIER COMING FOR ANOTHER'S BAGS SEES (the user, 2026-10-25: "Split by the road"): couriers' vehicles broken
   * down within TAKEOVER_NEAR_KM of where this courier's phone last said it was, with bags or parcels still with the
   * courier they broke down under — nearest first, and how far. Only what is still to be done: not one back on the road.
   * Nothing while this courier's phone has not said where it is: "near" needs a where.
   */
  private courierTakeOvers(takerDid: string, ownVehicleId: string, at: { lat: number; lng: number } | undefined): BreakdownToTakeOver[] {
    if (!at) return [];
    return this.all()
      .filter((b) => (b.status === 'open' || b.outcome === 'workshop') && b.vehicleId !== ownVehicleId && b.driverDid && b.driverDid !== takerDid && b.location)
      .map((b) => ({ b, v: this.vehicles.get(b.vehicleId), km: Math.round(haversineKm(at, b.location!) * 10) / 10 }))
      .filter(({ v, km }) => !v.managerDid && km <= TAKEOVER_NEAR_KM)
      .map(({ b, v, km }) => ({ b, v, km, loads: this.stillWith(v, b).filter((l) => ROAD_GOODS.has(l.kind)) }))
      .filter(({ loads }) => loads.length > 0)
      .sort((x, y) => x.km - y.km)
      .map(({ b, v, km, loads }) => ({
        breakdownId: b.breakdownId,
        vehicleId: v.vehicleId,
        plate: v.plate,
        ...(b.driverName ? { driverName: b.driverName } : {}),
        reportedAt: b.reportedAt,
        location: { ...b.location! },
        km,
        loads: loads.map((l) => ({ kind: l.kind, label: l.label, state: l.state, weightKg: l.weightKg })),
        totalKg: Math.round(loads.reduce((n, l) => n + l.weightKg, 0) * 100) / 100,
      }));
  }

  /** The couriers on a shift near a place, out in a vehicle fit for the road — not the one asking — nearest first. */
  private couriersNear(point: { lat: number; lng: number }, exceptDid: string): Array<{ driverDid: string; km: number }> {
    return this.fleet
      .onShiftNear(point, TAKEOVER_NEAR_KM)
      .map((vehicleId) => ({ vehicleId, shift: this.fleet.activeForVehicle(vehicleId) }))
      .filter(({ vehicleId, shift }) => shift && shift.location && shift.driverDid !== exceptDid && !this.vehicles.get(vehicleId).managerDid && this.vehicles.isUsable(vehicleId))
      .map(({ shift }) => ({ driverDid: shift!.driverDid, km: Math.round(haversineKm(shift!.location!, point) * 10) / 10 }))
      .sort((x, y) => x.km - y.km);
  }

  /** The fleet's drivers out in another vehicle now that is on the road, who could take a breakdown's loads — and the room each has. */
  takersFor(vehicleId: string, breakdownId: string): BreakdownTaker[] {
    const b = this.find(vehicleId, breakdownId);
    const v = this.vehicles.get(b.vehicleId);
    if (!v.managerDid) return [];
    return this.drivers
      .list({ managerDid: v.managerDid })
      .filter((d) => d.did !== b.driverDid)
      .map((d) => ({ d, shift: this.fleet.activeForDriver(d.did) }))
      .filter(({ shift }) => shift && shift.vehicleId !== v.vehicleId && this.vehicles.isUsable(shift.vehicleId))
      .map(({ d, shift }) => ({ driverDid: d.did, driverName: d.displayName, vehicleId: shift!.vehicleId, plate: this.vehicles.get(shift!.vehicleId).plate, roomKg: this.dispatch.remainingCapacity(d.did) }));
  }

  /**
   * TAKEN OVER AT THE VEHICLE: the driver who came for the loads, with the pass of the driver handing them over — the six
   * digits under "Show my badge", which only the two of them together have. Every load still with that driver moves, or
   * none does.
   */
  takeOverByPass(breakdownId: string, takerDid: string, input: { pass: string; lat?: number; lng?: number }, now: number = Date.now()): TakeOverResult {
    const b = this.breakdowns.get(breakdownId);
    if (!b) throw new GlosError('NOT_FOUND', 'No such breakdown');
    if ((input.lat === undefined) !== (input.lng === undefined)) throw new GlosError('INVALID_INPUT', 'A position is a latitude and a longitude together', { field: 'lat' });
    const plan = this.planHandover(b, takerDid, 'You are not on a shift: the loads go onto the vehicle you are out in');
    this.assertPass(b, input.pass);
    const location = input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : b.location;
    return this.carryOut(b, plan, { proof: 'pass', by: plan.taker.displayName, ...(location ? { location } : {}) }, now);
  }

  /**
   * MOVED BY THE OFFICE, to a driver of the fleet out in another vehicle — when the driver the loads are with can no
   * longer show a pass (their shift has ended), or the office arranges it before the other truck arrives. The record
   * says it was the office's word; the driver taking them over is told.
   */
  handOverByOffice(vehicleId: string, breakdownId: string, toDriverDid: string, by: string, now: number = Date.now()): TakeOverResult {
    const b = this.find(vehicleId, breakdownId);
    const plan = this.planHandover(b, toDriverDid, 'That driver is not on a shift: the loads go onto a vehicle somebody is out in');
    return this.carryOut(b, plan, { proof: 'office', by, ...(b.location ? { location: b.location } : {}) }, now);
  }

  /** Everything that can say no, asked before anything moves: who, which vehicle, what is left, room and fitness for it all. */
  private planHandover(b: VehicleBreakdown, takerDid: string, notOnShift: string): { v: Vehicle; to: Vehicle; taker: { did: string; displayName: string }; loads: Load[] } {
    const v = this.vehicles.get(b.vehicleId);
    if (!b.driverDid) throw new GlosError('INVALID_STATE', `Nobody was out in ${v.plate} when it broke down: there is nobody to hand over from`);
    if (takerDid === b.driverDid) throw new GlosError('INVALID_INPUT', `The loads are already with ${b.driverName ?? 'that driver'}`);
    const shift = this.fleet.activeForDriver(takerDid);
    if (!shift) throw new GlosError('INVALID_STATE', notOnShift);
    const to = this.vehicles.get(shift.vehicleId);
    // A fleet's vehicle hands over to another of the same fleet's. A COURIER's own goes on with another courier, out in
    // their own vehicle (the user, 2026-10-25): its bags and parcels — a load stays with the carrier its note names.
    const courier = !v.managerDid;
    if (courier ? Boolean(to.managerDid) : to.managerDid !== v.managerDid) {
      throw new GlosError('FORBIDDEN', courier ? `${v.plate} is a courier's own: its bags and parcels go on with another courier, out in their own vehicle` : `${v.plate} is not one of your fleet's vehicles: its loads stay with the fleet that carries them`);
    }
    if (to.vehicleId === v.vehicleId) throw new GlosError('INVALID_INPUT', `${to.plate} is the vehicle that broke down`);
    if (!this.vehicles.isUsable(to.vehicleId)) throw new GlosError('INVALID_STATE', `${to.plate} is off the road: ${this.vehicles.offRoadReasons(to.vehicleId).join('; ') || to.status}`);
    const loads = this.stillWith(v, b).filter((l) => !courier || ROAD_GOODS.has(l.kind));
    if (!loads.length) throw new GlosError('INVALID_STATE', `Nothing of ${v.plate}'s is left to hand over`);
    const taker = this.drivers.get(takerDid);
    const bookings = loads.filter((l) => l.kind === 'booking');
    const goodsKg = loads.filter((l) => ROAD_GOODS.has(l.kind)).reduce((n, l) => n + l.weightKg, 0);
    this.dispatch.assertCanTakeLoads(loads.filter((l) => l.kind === 'freight').map((l) => l.id), takerDid, bookings.reduce((n, l) => n + l.weightKg, 0) + goodsKg);
    // Bags take a space each in the hold, whatever they weigh.
    const bags = loads.filter((l) => l.kind === 'bag').length;
    const spaces = bags ? this.dispatch.remainingTotes(takerDid) : 0;
    if (bags > spaces) {
      const room = spaces === 0 ? 'no room for another bag' : `room for ${spaces === 1 ? 'one more bag' : `${spaces} more bags`}`;
      throw new GlosError('CAPACITY_EXCEEDED', `${to.plate} has ${room} — there ${bags === 1 ? 'is one' : `are ${bags}`} to take over`);
    }
    for (const departureId of new Set(bookings.map((l) => l.departureId!))) this.departures.continueOn(departureId, to.vehicleId, { did: takerDid, name: taker.displayName });
    return { v, to, taker: { did: taker.did, displayName: taker.displayName }, loads };
  }

  /** The handover itself, once nothing can say no: the loads move, it is recorded, and everybody concerned is told. */
  private carryOut(b: VehicleBreakdown & { photoRef?: string }, plan: { v: Vehicle; to: Vehicle; taker: { did: string; displayName: string }; loads: Load[] }, how: { proof: 'pass' | 'office'; by: string; location?: { lat: number; lng: number } }, now: number): TakeOverResult {
    const { v, to, taker, loads } = plan;
    const location = how.location ? { lat: how.location.lat, lng: how.location.lng } : undefined;
    // The reload is written where the consignment notes read it — on each load, and on each run — and nowhere else.
    this.dispatch.moveLoads(loads.filter((l) => l.kind === 'freight').map((l) => l.id), taker.did, { fromPlate: v.plate, toDriverName: taker.displayName, breakdownId: b.breakdownId, proof: how.proof, by: how.by, ...(location ? { location } : {}) }, now);
    const runs = [...new Set(loads.filter((l) => l.kind === 'booking').map((l) => l.departureId!))];
    for (const departureId of runs) this.departures.continueOn(departureId, to.vehicleId, { did: taker.did, name: taker.displayName }, { breakdownId: b.breakdownId, proof: how.proof, by: how.by, ...(location ? { location } : {}), at: new Date(now).toISOString() });
    this.moveRoadGoods(b, v, taker.did, loads, location, now);
    const handover: BreakdownHandover = {
      at: new Date(now).toISOString(),
      toDriverName: taker.displayName,
      toPlate: to.plate,
      loads: loads.map((l) => l.label),
      proof: how.proof,
      by: how.by,
      ...(how.location ? { location: { lat: how.location.lat, lng: how.location.lng } } : {}),
    };
    const told: VehicleLoadsHandedOver = {
      ...(v.managerDid ? { fleetDid: v.managerDid } : {}),
      reloadedFreightIds: loads.filter((l) => l.kind === 'freight' && l.state === 'aboard').map((l) => l.id),
      reloadedDepartureIds: runs,
      carrier: this.carrierOf(v, b.driverName),
      fromPlate: v.plate,
      breakdownId: b.breakdownId,
      fromDriverDid: b.driverDid!,
      toDriverDid: taker.did,
      toVehicleId: to.vehicleId,
      ...(b.driverName ? { fromDriverName: b.driverName } : {}),
      handover,
      tell: tellsOf(loads),
    };
    void this.events.publish(GlosEvent.Pudo.VehicleLoadsHandedOver, told, { source: 'pudo' }).catch(() => undefined);
    return { breakdownId: b.breakdownId, fromPlate: v.plate, toPlate: to.plate, moved: handover.loads };
  }

  /**
   * BAGS AND LOOSE PARCELS GO ON with the driver who took them over. Each bag is the other's now — on their vehicle, or
   * theirs to collect — and every parcel in it, and every parcel a shop handed the first driver, changes hands in its
   * chain of custody, saying how. THE ROAD IS PAID ONCE (the user, 2026-10-25: "Split by the road"): for a bag on the
   * vehicle with a road to pay, the stretch the first driver drove — the trip less what is left from where it was taken
   * over — is paid them now, and kept on the bag; whoever arrives with it is paid the rest. Where nobody's phone said
   * where, that stretch is not measured and not paid, and the bag says so.
   */
  private moveRoadGoods(b: VehicleBreakdown, v: Vehicle, takerDid: string, loads: Load[], location: { lat: number; lng: number } | undefined, now: number): void {
    const goods = loads.filter((l) => ROAD_GOODS.has(l.kind));
    if (!goods.length || !this.totes || !this.parcels) return;
    const giverDid = b.driverDid!;
    const giver = b.driverName ?? 'the driver';
    const badgeId = this.drivers.get(takerDid).badgeId;
    const at = new Date(now).toISOString();
    const codes = new Set(goods.filter((l) => l.kind === 'bag').map((l) => l.id));
    for (const tote of this.dispatch.bagsWith(giverDid).filter((t) => codes.has(t.code))) {
      const owed = tote.status === 'in_transit' && tote.haul && tote.haul.road > 0 ? roadPartAt(tote.haul, location ? this.dispatch.bagRoadLeftKm(tote, location) : undefined) : undefined;
      const part = owed ? { driverDid: giverDid, amount: owed.amount, leftKm: owed.leftKm, at, breakdownId: b.breakdownId, basis: owed.basis } : undefined;
      this.totes.takeOver(tote.code, takerDid, badgeId, part);
      if (part && part.amount > 0) this.gate?.driverPayout(giverDid, part.amount);
      this.parcels.takenOverOnTheRoad(tote.parcels, { driverDid: takerDid }, `taken over in ${tote.code} from ${giver}, after ${v.plate} broke down`);
    }
    const loose = goods.filter((l) => l.kind === 'parcel').map((l) => l.id);
    if (loose.length) this.parcels.takenOverOnTheRoad(loose, { driverDid: takerDid, ...(badgeId ? { badgeId } : {}) }, `taken over from ${giver}, after ${v.plate} broke down`);
  }

  /**
   * The pass of the driver the loads are with: the six digits they read out, or the whole pass. Checked by the one door
   * every counter uses (FleetService.badgeShown), so wrong codes are counted and the fifth replaces it.
   */
  private assertPass(b: VehicleBreakdown, pass: string): void {
    const giver = this.drivers.get(b.driverDid!);
    if (!this.fleet.activeForDriver(giver.did)) throw new GlosError('INVALID_STATE', `${giver.displayName} has ended their shift, so their pass is gone: the office can move the loads to you`);
    const said = (pass ?? '').replace(/\s/g, '');
    const shown = /^\d{6}$/.test(said) && giver.badgeId ? `${giver.badgeId}-${said}` : said;
    const badge = this.fleet.badgeShown(shown);
    if (!giver.badgeId || badge !== giver.badgeId.toUpperCase()) throw new GlosError('INVALID_INPUT', `That is not ${giver.displayName}'s code: ask them to open “Show my badge” and read you the six digits under it`, { field: 'pass' });
  }

  /** What was aboard when it broke down and is still with the driver it broke down under: what a handover moves. */
  private stillWith(v: Vehicle, b: VehicleBreakdown): Load[] {
    if (!b.driverDid) return [];
    const was = new Set(b.aboard.map((l) => `${l.kind}:${l.id}`));
    return this.loadsOf(v, b.driverDid).filter((l) => was.has(`${l.kind}:${l.id}`));
  }

  private find(vehicleId: string, breakdownId: string): VehicleBreakdown & { photoRef?: string } {
    const b = this.breakdowns.get(breakdownId);
    if (!b || b.vehicleId !== vehicleId) throw new GlosError('NOT_FOUND', 'No such breakdown on this vehicle');
    return b;
  }

  /**
   * A breakdown as its owner reads it: what is still aboard, and who took what over — both worked out now. The
   * handovers are read back from the loads and runs that moved, where their consignment notes write them; the breakdown
   * keeps no copy.
   */
  private view(b: VehicleBreakdown & { photoRef?: string }): VehicleBreakdown {
    const v = this.vehicles.get(b.vehicleId);
    return { ...publicBreakdown(b), stillAboard: this.stillWith(v, b).map((l) => l.label), handovers: this.handoversOf(b) };
  }

  /** Who took what over, grouped by the moment and the truck, from the reloads written on the loads and runs it carried. */
  private handoversOf(b: VehicleBreakdown): BreakdownHandover[] {
    const moves: Array<{ at: string; toPlate: string; toDriverName: string; proof: 'pass' | 'office'; by: string; location?: { lat: number; lng: number }; label: string }> = [];
    for (const l of b.aboard.filter((x) => x.kind === 'freight')) for (const r of this.dispatch.reloadsAfter(l.id, b.breakdownId)) moves.push({ ...r, label: l.label });
    for (const departureId of new Set(b.aboard.filter((x) => x.kind === 'booking').map((x) => x.departureId!))) {
      const labels = b.aboard.filter((x) => x.departureId === departureId).map((x) => x.label);
      for (const r of this.departures.reloadsAfter(departureId, b.breakdownId)) for (const label of labels) moves.push({ ...r, label });
    }
    const byMoment = new Map<string, BreakdownHandover>();
    for (const m of moves.sort((x, y) => x.at.localeCompare(y.at))) {
      const key = `${m.at}|${m.toPlate}`;
      const h = byMoment.get(key) ?? { at: m.at, toDriverName: m.toDriverName, toPlate: m.toPlate, loads: [], proof: m.proof, by: m.by, ...(m.location ? { location: { ...m.location } } : {}) };
      h.loads.push(m.label);
      byMoment.set(key, h);
    }
    return [...byMoment.values()];
  }

  /** A vehicle's breakdowns for its sheet: the open one, and those resolved in the last month, newest first. */
  of(vehicleId: string, now: number = Date.now()): VehicleBreakdown[] {
    const since = new Date(now - RESOLVED_SHOWN_DAYS * 86_400_000).toISOString();
    return this.all()
      .filter((b) => b.vehicleId === vehicleId && (b.status === 'open' || (b.resolvedAt ?? '') >= since))
      .map((b) => this.view(b));
  }

  /** One breakdown as its owner reads it, whenever it was: what a fleet's own system is told (fleet-hooks.service.ts). */
  viewOf(breakdownId: string): VehicleBreakdown | undefined {
    const b = this.breakdowns.get(breakdownId);
    return b ? this.view(b) : undefined;
  }

  /** A fleet's vehicles broken down now — or resolved with loads still waiting to be taken over: for the top of its office's screen. */
  openForFleet(fleetDid: string): VehicleBreakdown[] {
    const mine = new Set(this.vehicles.list({ managerDid: fleetDid }).map((v) => v.vehicleId));
    return this.all()
      .filter((b) => mine.has(b.vehicleId))
      .map((b) => this.view(b))
      .filter((b) => b.status === 'open' || b.stillAboard.length > 0);
  }

  /** When a vehicle was broken down: from the report to how it ended, or still. */
  spansOf(vehicleId: string): Array<{ from: string; until?: string }> {
    return this.all()
      .filter((b) => b.vehicleId === vehicleId)
      .map((b) => ({ from: b.reportedAt, ...(b.resolvedAt ? { until: b.resolvedAt } : {}) }));
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
  private loadsOf(v: Vehicle, driverDid: string): Load[] {
    const freight = this.dispatch.loadsOnVehicle(driverDid, v.vehicleId).map((f) => ({
      kind: 'freight' as const,
      id: f.freightId,
      freightId: f.freightId,
      label: f.code,
      state: f.state,
      weightKg: f.weightKg,
      ...(f.shipperDid ? { shipperDid: f.shipperDid } : {}),
    }));
    const bookings = this.departures.bookingsAboard(v.vehicleId).map((b) => ({
      kind: 'booking' as const,
      id: b.bookingId,
      label: b.description,
      state: 'aboard' as const,
      lineName: b.lineName,
      departureId: b.departureId,
      weightKg: b.weightKg,
      ...(b.shipperDid ? { shipperDid: b.shipperDid } : {}),
    }));
    // The driver's bags — on the vehicle, or claimed and still to collect — and the parcels a shop handed them loose.
    // Nobody is told about these here: each parcel's receiver hears by its own running-late rule.
    const bags = this.dispatch.bagsWith(driverDid).map((t) => ({
      kind: 'bag' as const,
      id: t.code,
      label: t.code,
      state: t.status === 'claimed' ? ('to_collect' as const) : ('aboard' as const),
      weightKg: t.weightKg,
    }));
    const loose = (this.parcels?.onBusWith(this.drivers.get(driverDid).badgeId) ?? []).map((p) => ({ kind: 'parcel' as const, id: p.parcelId, label: p.parcelId, state: 'aboard' as const, weightKg: p.weightKg }));
    return [...freight, ...bookings, ...bags, ...loose] as Load[];
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
function tellsOf(loads: Load[]): BreakdownTell[] {
  return loads
    .filter((l): l is Load & { kind: BreakdownTell['kind'] } => Boolean(l.shipperDid) && (l.kind === 'freight' || l.kind === 'booking'))
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
  // What is still aboard and who took what over are read afresh by view(); nothing of them is kept here.
  return { ...rest, aboard: rest.aboard.map((l: BreakdownLoad) => ({ ...l })), stillAboard: [], handovers: [] };
}
