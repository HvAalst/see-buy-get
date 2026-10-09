import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { CorridorService } from './corridor.service';
import { DriverService } from './driver.service';
import { VehicleService } from './vehicle.service';
import { CLASS_TO_CORRIDOR_VEHICLE } from './fleet.config';
import { MAX_SNOOZE_MIN, MAX_WORK_RADIUS_KM } from './pudo.config';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { Assignment, DeclaredLeg, DeclaredWork, ResolvedBadge } from './fleet.types';
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
/** …and how many vehicles. A driver has one bus, or swaps between a couple; nobody scrolls their history. */
const VEHICLE_HISTORY = 5;

/**
 * FP8 — hours of service. Two limits, network-wide until a jurisdiction says otherwise: how long one shift may
 * run before no new load is taken, and how long a driver rests after a real working day before the next
 * shift starts. The numbers sit between the EU's daily driving limit and its reduced daily rest; they are
 * deliberately not a claim about any country's law, and the console can move them when it is.
 */
export const MAX_ON_DUTY_HOURS = 13;
export const MIN_REST_HOURS = 9;
/** A coupling shorter than this was not a working day — a wrong scan, a five-minute move — so no rest is owed after it. */
export const REST_OWED_AFTER_HOURS = 4;
/** How long before the limit a driver is told it is coming: time to finish, and to stop looking for more. */
export const HOURS_NEAR_LIMIT_H = 1;
/**
 * "Your rest is over" is worth saying at the minute it is true, and not much later. If the server was not looking
 * then — a restart, a long night — a driver told half a day afterwards is being told nothing; they have long since
 * seen it on their own screen, or started.
 */
export const REST_NOTICE_LATE_MS = 30 * 60 * 1000;

/**
 * Something to tell a driver about their hours, by the clock and not because they tried something.
 *
 *   near    an hour before the shift limit: nothing changes yet, and it is the last moment the news is of any use
 *   over    the limit is passed: what is aboard is delivered, nothing new is offered or taken
 *   rested  the rest they were waiting for is over — told only to somebody who ASKED (see askRestNotice)
 */
export interface HoursNotice {
  kind: 'near' | 'over' | 'rested';
  driverDid: string;
  driverName: string;
  /** The fleet whose driver this is, where there is one: its office hears when the limit is passed. */
  managerDid?: string;
  plate?: string;
  /** Whole hours on this shift, for the words. Absent for `rested`. */
  onDuty?: number;
}

/** One vehicle a driver could start today on — projected for the picker, with whether it is free right now. */
export interface RecentVehicle {
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  truckSubtype?: string;
  capacityKg: number;
  verified: boolean;
  /** Someone else is on shift with it — shown, not hidden, so "where is my bus?" has an answer. */
  busy: boolean;
  /** FP4 — the papers that have lapsed, in words. Non-empty: listed, marked, and refused at the coupling. */
  offRoad: string[];
  /**
   * THE DASHBOARD STICKER — only for a vehicle NO FLEET OWNS.
   *
   * A shift starts by scanning the sticker on the dashboard, and a fleet prints those for its own
   * vehicles. An independent courier who registered their own van at signup had nowhere to get one: the
   * code existed on the record and appeared on no screen they could reach, which is what the user asked.
   *
   * Withheld where a fleet DOES own the vehicle, and that is not squeamishness. The sticker is a physical
   * thing on a dashboard, and handing its code to somebody's phone is handing them a coupling they could
   * do from anywhere — for a fleet's van that is the fleet's decision to make, not ours.
   */
  qr?: string;
}

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
  // Durable: a running shift is what a counter hands parcels to. Kept in a plain Map, every restart ended
  // every shift in the network silently — found in the browser pass, when the fleet app said "0 on shift"
  // minutes after the demo had put a driver on the road. (Corridors had the same flaw, fixed in F1.)
  private readonly assignments = new PersistentMap<string, Assignment>('pudo-fleet-assignments');
  /**
   * The roads each driver has declared before, most recent first — durable, unlike the coupling itself.
   * A shift ends every evening and the app may be reinstalled, but "Hawassa → Addis" is still the road this
   * driver runs, and re-typing it every morning is exactly the friction that makes a driver skip declaring
   * at all — which is how the network stops knowing where anyone is going.
   */
  private readonly legHistory = new PersistentMap<string, DeclaredLeg[]>('pudo-driver-legs');
  /**
   * The vehicles each driver has actually driven, most recent first. Durable for the same reason the legs
   * are: a driver opens the app at a coffee table, not at the vehicle, and the honest answer to "which one
   * today?" is the one they drove yesterday. Scanning the dashboard QR stays the way a NEW vehicle enters
   * this list — the list is a shortcut for vehicles already known to this driver, not a way to name any
   * vehicle in the network.
   */
  private readonly vehicleHistory = new PersistentMap<string, string[]>('pudo-driver-vehicles');
  /**
   * What each shift's driver has already been told about its hours — kept beside the shifts, not on one: it is this
   * service's bookkeeping, and a shift is read by the driver, their office and the counter. By assignment id.
   */
  private readonly hoursTold = new PersistentMap<string, { near?: string; over?: string }>('pudo-fleet-hours-told');
  /**
   * The drivers WAITING for their rest to end, and when it does. Somebody is here because they asked — by pressing
   * "tell me when", or by trying to start and being turned away. Nobody else is told: nine hours after most working
   * days is the middle of the night, and a driver asleep has no use for the news. By driver.
   */
  private readonly restAsks = new PersistentMap<string, { askedAt: string; until: string }>('pudo-fleet-rest-asks');

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
    // FP4 — a refusal names the paper: "off the road: Insurance lapsed 3 Sep 2026" is something a driver can act on
    // at six in the morning; "cannot be coupled" is not.
    if (!this.drivers.canOperate(driverDid)) {
      const why = this.drivers.offRoadReasons(driverDid);
      throw new GlosError('CANNOT_COUPLE', why.length ? `Driver cannot start a shift: ${why.join('; ')}` : `Driver is ${driver.status} — cannot be coupled`);
    }
    if (!this.vehicles.isUsable(vehicleId)) {
      const why = this.vehicles.offRoadReasons(vehicleId);
      throw new GlosError('CANNOT_COUPLE', why.length ? `Vehicle ${vehicle.plate} is off the road: ${why.join('; ')}` : `Vehicle is ${vehicle.status} — cannot be coupled`);
    }
    if (!this.drivers.clearedFor(driverDid, vehicle.vehicleClass)) throw new GlosError('CANNOT_COUPLE', `Driver is not licence-cleared for a ${vehicle.vehicleClass}`);
    /*
     * WHOSE VEHICLE IT IS decides who may drive it.
     *
     * Nothing asked. Any driver who scanned a dashboard sticker — or typed a vehicle id, which is the same act —
     * started a shift on it, and every load that followed was recorded against their own fleet: a fleet's truck,
     * its insurance, under somebody else's name. Taking a driver off a fleet meant nothing while they could still
     * scan its stickers. A fleet's vehicle is for that fleet's drivers; a courier's own van is for that courier.
     */
    if (vehicle.managerDid && vehicle.managerDid !== driver.managerDid) {
      throw new GlosError('CANNOT_COUPLE', `${vehicle.plate} is not one of your fleet's vehicles — only its own fleet's drivers can start a shift on it`);
    }
    if (vehicle.ownerDriverDid && vehicle.ownerDriverDid !== driverDid) {
      throw new GlosError('CANNOT_COUPLE', `${vehicle.plate} is another courier's own vehicle — only they can start a shift on it`);
    }
    if (this.activeForDriver(driverDid)) throw new GlosError('ALREADY_COUPLED', 'Driver is already coupled to a vehicle — uncouple first');
    if (this.activeForVehicle(vehicleId)) throw new GlosError('ALREADY_COUPLED', 'Vehicle is already coupled to a driver — uncouple first');
    if (corridorId) this.corridors.requireUsableBy(corridorId, driver.managerDid);
    // FP8 — rest after a working day, before the next one starts. A short coupling owes none.
    const rest = this.restHoursSince(driverDid);
    if (rest != null && rest < MIN_REST_HOURS) {
      // Somebody turned away for rest has said, by trying, that they are waiting to start: they are told when they can.
      this.askRestNotice(driverDid);
      throw new GlosError('HOURS_EXCEEDED', `Rest first: ${rest.toFixed(1)} h since the last shift ended, ${MIN_REST_HOURS} h needed before the next. We will tell you when you can start.`);
    }
    // On shift again: whatever they were waiting to hear, they no longer are.
    this.restAsks.delete(driverDid);

    const assignment: Assignment = {
      assignmentId: `asg_${randomBytes(6).toString('hex')}`,
      driverDid,
      vehicleId,
      corridorId,
      work: leg ? this.normalizeLeg(leg) : undefined,
      status: 'active',
      startedAt: new Date().toISOString(),
    };
    this.assignments.set(assignment.assignmentId, assignment);
    this.rememberVehicle(driverDid, vehicleId);
    if (assignment.work?.kind === 'leg') this.rememberLeg(driverDid, assignment.work);
    this.drivers.setAssignedVehicle(driverDid, vehicleId);
    void this.events.publish(GlosEvent.Pudo.DriverCoupled, { assignmentId: assignment.assignmentId, driverDid, vehicleId, vehicleClass: vehicle.vehicleClass, corridorId }, { source: 'pudo' }).catch(() => undefined);
    return assignment;
  }

  /**
   * THE OFFICE SAYS WHICH VEHICLE — AND STARTS NOTHING.
   *
   * It used to couple a driver from the office, which is a shift started for somebody who may not be there: the
   * load that follows is on that driver's name, and the user's view (2026-10-01) is that this is not fair to the
   * driver — "the driver is responsible for his load", so nobody else says they are at the wheel. The office keeps
   * what is its own to decide, the vehicle: it goes to the head of the driver's "which vehicle today?" list, and
   * the shift begins when the DRIVER starts it, with their PIN.
   */
  suggestVehicle(driverDid: string, vehicleId: string): { driverDid: string; vehicleId: string; plate: string } {
    const driver = this.drivers.get(driverDid);
    const vehicle = this.vehicles.get(vehicleId);
    if (!driver.managerDid || vehicle.managerDid !== driver.managerDid) {
      throw new GlosError('CANNOT_COUPLE', `${vehicle.plate} and ${driver.displayName} are not in the same fleet`);
    }
    if (!this.drivers.clearedFor(driverDid, vehicle.vehicleClass)) throw new GlosError('CANNOT_COUPLE', `${driver.displayName} is not licence-cleared for a ${vehicle.vehicleClass}`);
    this.rememberVehicle(driverDid, vehicleId);
    void this.events.publish(GlosEvent.Pudo.DriverVehicleSuggested, { driverDid, vehicleId, plate: vehicle.plate, vehicleClass: vehicle.vehicleClass }, { source: 'pudo' }).catch(() => undefined);
    return { driverDid, vehicleId, plate: vehicle.plate };
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

  /**
   * The vehicles this driver could start on today: the ones they have driven before, newest first.
   *
   * A driver opens the app over a coffee, not at the vehicle, so requiring the dashboard QR to begin the
   * day made the first act of every morning "walk to the bus first". A vehicle someone ELSE is on shift with
   * is listed and marked, not hidden: "where is my bus?" deserves an answer, and the coupling rule refuses
   * it anyway. Unknown/retired ids simply fall out — a scrapped vehicle stops being offered.
   */
  recentVehicles(driverDid: string): RecentVehicle[] {
    const known = this.vehicles.list();
    return (this.vehicleHistory.get(driverDid) ?? [])
      .map((id) => known.find((v) => v.vehicleId === id))
      .filter((v): v is NonNullable<typeof v> => !!v && v.status !== 'RETIRED')
      .map((v) => ({
        vehicleId: v.vehicleId,
        plate: v.plate,
        vehicleClass: v.vehicleClass,
        truckSubtype: v.truckSubtype,
        capacityKg: v.capacityKg,
        verified: v.verified,
        busy: !!this.activeForVehicle(v.vehicleId),
        offRoad: this.vehicles.offRoadReasons(v.vehicleId),
        ...(v.managerDid ? {} : { qr: v.qr }),
      }));
  }

  /**
   * AN OWNER-DRIVER'S OWN VEHICLE, KNOWN BEFORE THEY HAVE EVER DRIVEN IT.
   *
   * `recentVehicles` is a history, so it is empty on somebody's first morning — which was fine while
   * every vehicle belonged to a fleet that had already put drivers in it, and wrong the moment a courier
   * could register their own van at signup. Without this they would open the app, be told to scan the
   * sticker on the dashboard, and find no sticker: the vehicle they had just declared existed in the
   * network and not on their screen.
   *
   * Seeding the history is the honest way to say it. It is their vehicle; the list is what they may start
   * on; and the first real coupling moves it to the head the same way any other would.
   */
  claimOwnVehicle(driverDid: string, vehicleId: string): void {
    this.rememberVehicle(driverDid, vehicleId);
  }

  /** Keep the vehicle at the head of this driver's history (the same road-re-run rule as the legs). */
  private rememberVehicle(driverDid: string, vehicleId: string): void {
    const rest = (this.vehicleHistory.get(driverDid) ?? []).filter((id) => id !== vehicleId);
    this.vehicleHistory.set(driverDid, [vehicleId, ...rest].slice(0, VEHICLE_HISTORY));
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
    const declared = this.normalizeLeg(leg);
    active.work = declared;
    this.rememberLeg(driverDid, declared);
    return active;
  }

  /**
   * Declare a PATCH instead of a road: "I take work within this many km of me". The radius is the whole
   * declaration — there is no centre, because the centre is wherever the rider currently is.
   */
  declareArea(driverDid: string, radiusKm: number): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new GlosError('NOT_COUPLED', 'Start a shift before saying where you are working');
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > MAX_WORK_RADIUS_KM) {
      throw new GlosError('INVALID_INPUT', `Pick a distance between 1 and ${MAX_WORK_RADIUS_KM} km`);
    }
    active.work = { kind: 'area', radiusKm: Math.round(radiusKm), declaredAt: new Date().toISOString() };
    return active;
  }

  /**
   * Take the road implied by a load the driver just accepted — but only where they have not said one
   * themselves, and only if they have not switched this off.
   *
   * Claiming a load is a statement about where you are going, and the network used to discard it: a driver
   * who had just committed to carry a bag to Karen went on being matched against nothing, and the loads
   * sitting on that same road stayed invisible. This is the inference, and it is deliberately timid.
   *
   * It NEVER overrides a declaration. A driver who said "Nakuru" this morning and then carries a bag two
   * streets has not changed their mind, and quietly rewriting their road with something we worked out would
   * be the app arguing with the person driving. Same restraint for an area: a rider working a patch has
   * chosen a shape this cannot improve on.
   *
   * Returns whether it took, so the caller can tell the driver what just happened.
   */
  deriveLegFromLoad(driverDid: string, leg: LegInput): boolean {
    const active = this.activeForDriver(driverDid);
    if (!active || active.derivedLegOff) return false;
    if (active.work) return false; // they have already said — theirs wins, always
    active.work = { ...this.normalizeLeg(leg), source: 'derived' };
    // Deliberately NOT remembered in the leg history: that list is roads a driver chose and may want to
    // re-run, and seeding it with our own guesses would make their own history less useful every trip.
    return true;
  }

  /**
   * Switch off a road we worked out (or let it back on).
   *
   * Off also clears the derived road itself — leaving it in place while promising it is off would be the
   * worst of both. A road the DRIVER declared is untouched: this is not the control for that.
   */
  setDerivedLeg(driverDid: string, on: boolean): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new GlosError('NOT_COUPLED', 'You are not on shift');
    active.derivedLegOff = !on;
    if (!on && active.work?.kind === 'leg' && active.work.source === 'derived') active.work = undefined;
    return active;
  }

  /** How this driver takes work on the shift they are on, if they have said. */
  workFor(driverDid: string): DeclaredWork | undefined {
    return this.activeForDriver(driverDid)?.work;
  }

  /* --- snoozing new offers --- */

  /**
   * Hold new offers for a while. `minutes` undefined means "until I say" — the driver comes back to it.
   *
   * The duration is chosen at the moment of snoozing rather than living in a settings screen, because the
   * only time anyone knows how long they need is when they are stopping. A snooze a tired driver forgets is
   * a driver who gets no work all afternoon and blames the app, so most of them expire on their own.
   */
  snooze(driverDid: string, minutes?: number): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new GlosError('NOT_COUPLED', 'You are not on shift');
    if (minutes != null && (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_SNOOZE_MIN)) {
      throw new GlosError('INVALID_INPUT', `Snooze for up to ${MAX_SNOOZE_MIN} minutes, or until you resume`);
    }
    // No duration = the far end of this shift. It cannot outlive the coupling either way (uncouple drops it).
    active.snoozedUntil = new Date(Date.now() + (minutes ?? MAX_SNOOZE_MIN) * 60_000).toISOString();
    return active;
  }

  /** Take work again, now. Always available — a snooze must never be a state you cannot leave. */
  resume(driverDid: string): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new GlosError('NOT_COUPLED', 'You are not on shift');
    active.snoozedUntil = undefined;
    return active;
  }

  /**
   * Is this driver taking new work right now? False only while a snooze is live — and an expired snooze is
   * cleared as it is read, so the driver's own screen and the matcher can never disagree about whether it
   * has run out.
   */
  acceptingWork(driverDid: string, now: number = Date.now()): boolean {
    const active = this.activeForDriver(driverDid);
    if (!active?.snoozedUntil) return true;
    if (new Date(active.snoozedUntil).getTime() > now) return false;
    active.snoozedUntil = undefined;
    return true;
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
    // 'declared' unless a caller overrides it — the safe default, because a road nobody marked is a road
    // somebody said, and the app must never present its own guess as the driver's word.
    return { kind: 'leg', fromLabel, from: { lat: leg.from.lat, lng: leg.from.lng }, toLabel, to: { lat: leg.to.lat, lng: leg.to.lng }, declaredAt: new Date().toISOString(), source: 'declared' };
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

  /* ------------------------------------------------------------ FP8: hours of service -- */

  /** Hours on the current shift; 0 off duty. */
  hoursOnDuty(driverDid: string, now: number = Date.now()): number {
    const a = this.activeForDriver(driverDid);
    if (!a) return 0;
    return Math.round(((now - new Date(a.startedAt).getTime()) / 3_600_000) * 100) / 100;
  }

  /** Hours since the last REAL working day ended (a shift of at least REST_OWED_AFTER_HOURS); null when there was none. */
  restHoursSince(driverDid: string, now: number = Date.now()): number | null {
    const ended = [...this.assignments.values()]
      .filter((a) => a.driverDid === driverDid && a.status === 'ended' && a.endedAt && new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime() >= REST_OWED_AFTER_HOURS * 3_600_000)
      .sort((x, y) => new Date(y.endedAt!).getTime() - new Date(x.endedAt!).getTime());
    if (!ended.length) return null;
    return Math.round(((now - new Date(ended[0].endedAt!).getTime()) / 3_600_000) * 100) / 100;
  }

  /** Over the shift limit: no new load, though the ones already aboard are delivered. */
  overHours(driverDid: string, now: number = Date.now()): boolean {
    return this.hoursOnDuty(driverDid, now) > MAX_ON_DUTY_HOURS;
  }

  /**
   * The driver's hours as their app says them: on duty, the limit, and whether it is passed — and, off duty after a
   * working day, until when they rest, so that the answer to "when can I start?" is on the screen and not behind a
   * refused attempt. `tellWhenRested`: they have asked to be told at that moment.
   */
  hoursFor(driverDid: string, now: number = Date.now()): { onDuty: number; limit: number; over: boolean; near?: boolean; restOwed?: boolean; restHours: number; restUntil?: string; tellWhenRested?: boolean } {
    const onDuty = this.hoursOnDuty(driverDid, now);
    const restUntil = this.restUntil(driverDid, now);
    const over = onDuty > MAX_ON_DUTY_HOURS;
    return {
      onDuty,
      limit: MAX_ON_DUTY_HOURS,
      over,
      // The last hour before the limit — the same hour the notice is sent in, said by the one place that decides it.
      ...(!over && onDuty >= MAX_ON_DUTY_HOURS - HOURS_NEAR_LIMIT_H ? { near: true } : {}),
      // This shift is already a working day: ending it now owes the rest. Said to the sheet that ends it, which used
      // to promise "you can start a new shift any time".
      ...(onDuty >= REST_OWED_AFTER_HOURS ? { restOwed: true } : {}),
      restHours: MIN_REST_HOURS,
      ...(restUntil ? { restUntil, ...(this.restAsks.get(driverDid)?.until === restUntil ? { tellWhenRested: true } : {}) } : {}),
    };
  }

  /** When the rest owed after the last working day ends — only while it is still running, and the driver is off duty. */
  restUntil(driverDid: string, now: number = Date.now()): string | undefined {
    if (this.activeForDriver(driverDid)) return undefined;
    const rested = this.restHoursSince(driverDid, now);
    if (rested == null || rested >= MIN_REST_HOURS) return undefined;
    const ended = [...this.assignments.values()]
      .filter((a) => a.driverDid === driverDid && a.status === 'ended' && a.endedAt && new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime() >= REST_OWED_AFTER_HOURS * 3_600_000)
      .map((a) => new Date(a.endedAt as string).getTime())
      .sort((x, y) => y - x)[0];
    return new Date(ended + MIN_REST_HOURS * 3_600_000).toISOString();
  }

  /**
   * "TELL ME WHEN I CAN START." A driver who is resting asks to be told the moment the rest is over. Asked for, never
   * assumed: for most working days that moment is in the small hours, and only somebody waiting for it wants it.
   * Asking twice is asking once. Refused for somebody who is not resting — there is nothing to wait for.
   */
  askRestNotice(driverDid: string, now: number = Date.now()): { restUntil: string; tellWhenRested: true } {
    const until = this.restUntil(driverDid, now);
    if (!until) throw new GlosError('INVALID_STATE', this.activeForDriver(driverDid) ? 'You are on shift: there is no rest to wait for' : 'You are not resting: you can start a shift now');
    if (this.restAsks.get(driverDid)?.until !== until) this.restAsks.set(driverDid, { askedAt: new Date(now).toISOString(), until });
    return { restUntil: until, tellWhenRested: true };
  }

  /**
   * WHAT IS DUE TO BE SAID ABOUT HOURS, RIGHT NOW — taken: each is returned once, and noted as said before it is
   * handed over, so a sweep that runs twice, or fails half-way, never says a thing twice.
   *
   * Everything else about the limit waits to be asked: the home screen shows a line, the board marks a row, a claim is
   * refused. A driver who is DRIVING — the whole point of the limit — learned of it by being turned away, or by the
   * offers going quiet, which looks exactly like a slow afternoon. This is the half that speaks first.
   */
  takeHoursNotices(now: number = Date.now()): HoursNotice[] {
    const due: HoursNotice[] = [];
    const who = (driverDid: string, vehicleId?: string): Pick<HoursNotice, 'driverDid' | 'driverName' | 'managerDid' | 'plate'> => {
      let driverName = 'A driver';
      let managerDid: string | undefined;
      let plate: string | undefined;
      try {
        const d = this.drivers.get(driverDid);
        driverName = d.displayName;
        managerDid = d.managerDid;
      } catch {
        /* a shift whose driver record cannot be read is still a shift somebody is on */
      }
      try {
        if (vehicleId) plate = this.vehicles.get(vehicleId).plate;
      } catch {
        /* the same for its vehicle */
      }
      return { driverDid, driverName, ...(managerDid ? { managerDid } : {}), ...(plate ? { plate } : {}) };
    };
    for (const a of this.assignments.values()) {
      if (a.status !== 'active') continue;
      const hours = (now - new Date(a.startedAt).getTime()) / 3_600_000;
      const told = this.hoursTold.get(a.assignmentId) ?? {};
      // Past the limit says everything the hour before it would have: one notice, the one that is true.
      const kind = hours > MAX_ON_DUTY_HOURS ? 'over' : hours >= MAX_ON_DUTY_HOURS - HOURS_NEAR_LIMIT_H ? 'near' : undefined;
      if (!kind || told[kind]) continue;
      this.hoursTold.set(a.assignmentId, { ...told, [kind]: new Date(now).toISOString() });
      due.push({ kind, ...who(a.driverDid, a.vehicleId), onDuty: Math.floor(hours) });
    }
    for (const [driverDid, ask] of [...this.restAsks.entries()]) {
      const until = new Date(ask.until).getTime();
      if (until > now) continue;
      this.restAsks.delete(driverDid);
      // The moment is long past: there is nothing left to tell. (Somebody back on shift is not here at all — starting
      // a shift is what ends the waiting.)
      if (now - until > REST_NOTICE_LATE_MS) continue;
      due.push({ kind: 'rested', ...who(driverDid) });
    }
    return due;
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
    // "The driver moved" is a fact worth publishing: it is the trigger for telling them about a load they
    // are about to drive past. Everything that decides whether that is worth an interruption — how far they
    // actually moved, their heading, the cooldown — lives with the rule, not here.
    void this.events.publish(GlosEvent.Pudo.DriverMoved, { driverDid, location }, { source: 'pudo' }).catch(() => undefined);
    return active;
  }

  /**
   * Fleet-manager dashboard rollup: vehicle/driver/session counts, on-duty working hours, and live
   * vehicle positions (active sessions that have reported GPS).
   */
  overview(managerDid?: string, now: number = Date.now()): {
    vehicles: { total: number; active: number; inUse: number; byClass: Record<string, number> };
    drivers: { total: number; onShift: number; offShift: number; byStatus: Record<string, number> };
    sessions: { active: number; todayHours: number; list: Array<{ driverDid: string; driverName: string; plate: string; vehicleClass: string; startedAt: string; hoursOnDuty: number; overLimit: boolean; location?: { lat: number; lng: number }; lastLocatedAt?: string }> };
    /** FP8 — the limits every hours figure above is read against. */
    hours: { limit: number; rest: number };
    /** A position carries WHEN it was reported: a vehicle that went dark an hour ago must not read as moving. */
    positions: Array<{ plate: string; vehicleClass: string; driverName: string; location: { lat: number; lng: number }; hoursOnDuty: number; lastLocatedAt?: string }>;
  } {
    const ownsDriver = (driverDid: string) => !managerDid || this.drivers.get(driverDid).managerDid === managerDid;
    const all = [...this.assignments.values()].filter((a) => ownsDriver(a.driverDid));
    const dayStart = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
    const hoursOf = (a: Assignment) => Math.round((((a.status === 'active' ? now : new Date(a.endedAt!).getTime()) - new Date(a.startedAt).getTime()) / 3_600_000) * 100) / 100;

    const activeSessions = all.filter((a) => a.status === 'active');
    const list = activeSessions.map((a) => {
      const d = this.drivers.get(a.driverDid);
      const v = this.vehicles.get(a.vehicleId);
      return { driverDid: a.driverDid, driverName: d.displayName, plate: v.plate, vehicleClass: v.vehicleClass, startedAt: a.startedAt, hoursOnDuty: hoursOf(a), overLimit: hoursOf(a) > MAX_ON_DUTY_HOURS, location: a.location, ...(a.lastLocatedAt ? { lastLocatedAt: a.lastLocatedAt } : {}) };
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
      hours: { limit: MAX_ON_DUTY_HOURS, rest: MIN_REST_HOURS },
      positions: list.filter((s) => s.location).map((s) => ({ plate: s.plate, vehicleClass: s.vehicleClass, driverName: s.driverName, location: s.location!, hoursOnDuty: s.hoursOnDuty, ...(s.lastLocatedAt ? { lastLocatedAt: s.lastLocatedAt } : {}) })),
    };
  }

  /** Set / change the corridor the active coupling serves. */
  assignCorridor(driverDid: string, corridorId: string): Assignment {
    const active = this.activeForDriver(driverDid);
    if (!active) throw new GlosError('NOT_COUPLED', 'Driver is not currently coupled to a vehicle');
    // A fleet's own line carries only that fleet's drivers, and a proposal carries nobody yet.
    this.corridors.requireUsableBy(corridorId, this.drivers.get(driverDid).managerDid);
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
