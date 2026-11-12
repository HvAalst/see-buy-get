import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { DispatchService } from './dispatch.service';
import { VehicleService } from './vehicle.service';
import { FleetService } from './fleet.service';
import { NotificationService } from './notification.service';
import { DepartureService } from './departure.service';
import { FleetManagerService } from './fleet-manager.service';
import { clockAt, clocksOfCountry, isTimeZone, minutesOf, momentAt } from './fleet-clock';
import { dayAfter, daysWords, nextRuns } from './saved-trip';
import { EVENING_FROM_MIN, MORNING_ENDS_MIN, TRIP_NOTICE_MIN, TRIP_POST_DAYS, TRIP_SKIP_DAYS_AHEAD, type FleetTripDto, type SavedTripDto, type SavedTripView, type StoredTrip } from './saved-trip.types';
import type { Vehicle } from './fleet.types';

/** How many trips one driver keeps — enough for every run of a working week, there and back. */
const MAX_TRIPS = 20;

/**
 * 2026-11-12 — SAVED TRIPS (the owner: "much like an alarm driving route a to b monday to saturday from 5:30 AM … or several
 * trips selecting the specific day and start time"; answers: a notice before each run with the loads on the way, the evening
 * before a morning run too; a fleet sets its drivers' trips and they see them). Each trip is one direction: there and back
 * are two trips. It reminds and shows; it never starts a shift or takes a load.
 */
@Injectable()
export class SavedTripService {
  private readonly store = new PersistentMap<string, StoredTrip>('pudo-saved-trips');

  constructor(
    private readonly drivers: DriverService,
    private readonly dispatch: DispatchService,
    private readonly vehicles: VehicleService,
    private readonly fleet: FleetService,
    @Optional() private readonly notifications?: NotificationService,
    // 2026-11-12 — a fleet's trips (part 2): its clock, and each run posted as a departure a week ahead.
    @Optional() private readonly departures?: DepartureService,
    @Optional() private readonly managers?: FleetManagerService,
  ) {}

  /* ---------------------------------------------------------------- a fleet's trips (part 2) -- */

  /** A fleet's trips, for all its drivers, the next to run first. */
  listForFleet(managerDid: string, now: number = Date.now()): SavedTripView[] {
    return [...this.store.values()]
      .filter((t) => t.setBy === 'fleet' && t.managerDid === managerDid)
      .map((t) => this.fleetView(t, now))
      .sort((a, b) => (a.next?.at ?? '9').localeCompare(b.next?.at ?? '9') || a.startTime.localeCompare(b.startTime));
  }

  /** A fleet sets a trip for one of its drivers, in one of its vehicles; selling space on one of its lines, each run is posted a week ahead. */
  saveForFleet(managerDid: string, dto: FleetTripDto, now: number = Date.now()): SavedTripView {
    const own = this.fleetFields(managerDid, dto);
    if ([...this.store.values()].filter((t) => t.managerDid === managerDid).length >= MAX_TRIPS * 20) throw new GlosError('INVALID_STATE', 'Too many trips: delete ones nobody drives first');
    const zone = dto.zone && isTimeZone(dto.zone) ? dto.zone : (this.managers?.clockOf(managerDid, now).timeZone ?? 'UTC');
    const trip: StoredTrip = { tripId: `trip_${randomBytes(6).toString('hex')}`, setBy: 'fleet', managerDid, ...this.fields(dto), ...own, zone, skips: [], createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    this.store.set(trip.tripId, trip);
    this.post(trip, now);
    return this.fleetView(this.get(trip.tripId), now);
  }

  updateForFleet(managerDid: string, tripId: string, dto: FleetTripDto, now: number = Date.now()): SavedTripView {
    const trip = this.fleets(managerDid, tripId);
    const own = this.fleetFields(managerDid, dto);
    // A run already posted keeps its departure; what is posted from now follows the trip as changed.
    Object.assign(trip, this.fields(dto), own, { ...(dto.zone && isTimeZone(dto.zone) ? { zone: dto.zone } : {}), updatedAt: new Date(now).toISOString() });
    if (!own.sale) delete trip.sale;
    if (!own.vehicleId) delete trip.vehicleId;
    this.store.set(tripId, trip);
    this.post(trip, now);
    return this.fleetView(this.get(tripId), now);
  }

  /** A fleet's trip deleted: its runs posted and still unbooked are taken back; one booked stays, said. */
  removeForFleet(managerDid: string, tripId: string, now: number = Date.now()): { removed: true; kept: number } {
    const trip = this.fleets(managerDid, tripId);
    let kept = 0;
    for (const [day, departureId] of Object.entries(trip.posted ?? {})) {
      if (day < clockAt(now, trip.zone).day) continue;
      if (!this.takeBack(trip, departureId)) kept++;
    }
    this.store.delete(tripId);
    return { removed: true, kept };
  }

  /** The fleet takes one run back (or puts it back): its departure taken back while nothing is booked on it. */
  skipForFleet(managerDid: string, tripId: string, day: string, skip = true, now: number = Date.now()): SavedTripView {
    const trip = this.fleets(managerDid, tripId);
    const posted = trip.posted?.[day];
    if (skip && posted) {
      const booked = this.bookedOn(posted);
      if (booked > 0) throw new GlosError('INVALID_STATE', `${booked} booking${booked === 1 ? '' : 's'} on that run: cancel ${booked === 1 ? 'it' : 'them'} under Runs first`);
      this.takeBack(trip, posted);
      delete trip.posted![day];
    }
    this.store.set(tripId, trip);
    this.skipDay(trip, day, skip, now);
    if (!skip) this.post(trip, now);
    return this.fleetView(this.get(tripId), now);
  }

  pauseForFleet(managerDid: string, tripId: string, paused: boolean, now: number = Date.now()): SavedTripView {
    const trip = this.fleets(managerDid, tripId);
    if (paused) {
      trip.paused = true;
      // Unbooked runs to come are taken back; a booked one stays — it is a promise to a shipper.
      for (const [day, departureId] of Object.entries(trip.posted ?? {})) {
        if (day >= clockAt(now, trip.zone).day && this.takeBack(trip, departureId)) delete trip.posted![day];
      }
    } else delete trip.paused;
    trip.updatedAt = new Date(now).toISOString();
    this.store.set(tripId, trip);
    if (!paused) this.post(trip, now);
    return this.fleetView(trip, now);
  }

  /**
   * EACH RUN POSTED A WEEK AHEAD (the owner's answer): a fleet's trip selling space, in a vehicle, has every run in the next
   * seven days on sale as a departure on its line — once. Why one could not be (a line not published, the vehicle off the
   * road), said on the trip, and tried again at the next sweep.
   */
  post(trip: StoredTrip, now: number = Date.now()): number {
    if (trip.setBy !== 'fleet' || !trip.sale || !trip.vehicleId || !trip.managerDid || !this.departures) return 0;
    let made = 0;
    for (const run of nextRuns(trip, now, TRIP_POST_DAYS + 1, TRIP_POST_DAYS)) {
      if (trip.posted?.[run.day]) continue;
      try {
        const d = this.departures.declare({ managerDid: trip.managerDid, corridorId: trip.sale.corridorId, vehicleId: trip.vehicleId, leavesAt: new Date(run.at).toISOString(), ...(trip.sale.capacityKg ? { capacityKg: trip.sale.capacityKg } : {}), basis: trip.sale.basis, amount: trip.sale.amount, note: `Saved trip: ${this.line(trip)}` });
        trip.posted = { ...(trip.posted ?? {}), [run.day]: d.departureId };
        delete trip.postError;
        made++;
      } catch (err) {
        trip.postError = (err as Error).message;
        break;
      }
    }
    this.store.set(trip.tripId, trip);
    return made;
  }

  private fleetFields(managerDid: string, dto: FleetTripDto): Pick<StoredTrip, 'driverDid'> & Partial<Pick<StoredTrip, 'vehicleId' | 'sale'>> {
    const driver = this.drivers.get(dto.driverDid);
    if (driver.managerDid !== managerDid) throw new GlosError('FORBIDDEN', 'That driver does not drive for your fleet');
    if (dto.vehicleId) {
      const vehicle = this.vehicles.get(dto.vehicleId);
      if (vehicle.managerDid !== managerDid) throw new GlosError('FORBIDDEN', 'That vehicle is not one of your fleet’s');
    }
    if (dto.sell && !dto.vehicleId) throw new GlosError('INVALID_INPUT', 'Space is sold in a vehicle: say which one', { field: 'vehicleId' });
    return {
      driverDid: dto.driverDid,
      ...(dto.vehicleId ? { vehicleId: dto.vehicleId } : {}),
      ...(dto.sell ? { sale: { corridorId: dto.sell.corridorId, ...(dto.sell.capacityKg ? { capacityKg: Math.round(dto.sell.capacityKg) } : {}), basis: dto.sell.basis, amount: Math.round(dto.sell.amount * 100) / 100 } } : {}),
    };
  }

  private fleets(managerDid: string, tripId: string): StoredTrip {
    const trip = this.get(tripId);
    if (trip.setBy !== 'fleet' || trip.managerDid !== managerDid) throw new GlosError('NOT_FOUND', 'No such trip');
    return trip;
  }

  /** Live bookings on a departure. */
  private bookedOn(departureId: string): number {
    try {
      return this.departures?.require(departureId).bookings.filter((b) => b.status !== 'cancelled').length ?? 0;
    } catch {
      return 0;
    }
  }

  /** A posted run taken back while nothing is booked on it. True when it is gone (or was already). */
  private takeBack(trip: StoredTrip, departureId: string): boolean {
    if (!this.departures || !trip.managerDid) return true;
    try {
      const d = this.departures.require(departureId);
      if (d.status === 'cancelled') return true;
      if (d.status !== 'open' || this.bookedOn(departureId) > 0) return false;
      this.departures.setStatus(departureId, 'cancelled', trip.managerDid, { reason: 'other', note: 'Taken back from a saved trip' });
      return true;
    } catch {
      return false;
    }
  }

  private fleetView(trip: StoredTrip, now: number): SavedTripView {
    const today = clockAt(now, trip.zone).day;
    const name = (() => {
      try {
        return this.drivers.get(trip.driverDid).displayName;
      } catch {
        return undefined;
      }
    })();
    const plate = (() => {
      try {
        return trip.vehicleId ? this.vehicles.get(trip.vehicleId).plate : undefined;
      } catch {
        return undefined;
      }
    })();
    const posted = Object.entries(trip.posted ?? {})
      .filter(([day]) => day >= today)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day]) => ({ day, clock: trip.startTime, at: new Date(momentAt(day, minutesOf(trip.startTime) ?? 0, trip.zone)).toISOString() }));
    return {
      ...this.view(trip, now),
      driverDid: trip.driverDid,
      ...(name ? { driverName: name } : {}),
      ...(trip.vehicleId ? { vehicleId: trip.vehicleId } : {}),
      ...(plate ? { plate } : {}),
      ...(trip.sale ? { sale: trip.sale } : {}),
      posted,
      ...(trip.postError ? { postError: trip.postError } : {}),
    };
  }

  /** A driver's trips: their own and the ones their fleet set, the next to run first. */
  listForDriver(driverDid: string, now: number = Date.now()): SavedTripView[] {
    this.drivers.get(driverDid);
    return [...this.store.values()]
      .filter((t) => t.driverDid === driverDid)
      .map((t) => this.view(t, now))
      .sort((a, b) => (a.next?.at ?? '9').localeCompare(b.next?.at ?? '9') || a.startTime.localeCompare(b.startTime));
  }

  get(tripId: string): StoredTrip {
    const t = this.store.get(tripId);
    if (!t) throw new GlosError('NOT_FOUND', 'No such trip');
    return t;
  }

  /** The driver saves a trip of their own. A fleet's driver is refused: their fleet sets their trips. */
  saveForDriver(driverDid: string, dto: SavedTripDto, now: number = Date.now()): SavedTripView {
    const driver = this.drivers.get(driverDid);
    if (driver.managerDid) throw new GlosError('FORBIDDEN', 'Your fleet sets your trips: ask it to add this one');
    if ([...this.store.values()].filter((t) => t.driverDid === driverDid).length >= MAX_TRIPS) throw new GlosError('INVALID_STATE', `At most ${MAX_TRIPS} trips: delete one you no longer drive first`);
    const zone = dto.zone && isTimeZone(dto.zone) ? dto.zone : (clocksOfCountry(driver.jurisdiction, now)[0] ?? 'UTC');
    const trip: StoredTrip = {
      tripId: `trip_${randomBytes(6).toString('hex')}`,
      driverDid,
      setBy: 'driver',
      ...this.fields(dto),
      zone,
      skips: [],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    this.store.set(trip.tripId, trip);
    return this.view(trip, now);
  }

  /** The driver changes their own trip — never one their fleet set. */
  update(driverDid: string, tripId: string, dto: SavedTripDto, now: number = Date.now()): SavedTripView {
    const trip = this.mine(driverDid, tripId);
    Object.assign(trip, this.fields(dto), { ...(dto.zone && isTimeZone(dto.zone) ? { zone: dto.zone } : {}), updatedAt: new Date(now).toISOString() });
    this.store.set(tripId, trip);
    return this.view(trip, now);
  }

  remove(driverDid: string, tripId: string): void {
    this.mine(driverDid, tripId);
    this.store.delete(tripId);
  }

  setPaused(driverDid: string, tripId: string, paused: boolean, now: number = Date.now()): SavedTripView {
    const trip = this.mine(driverDid, tripId);
    if (paused) trip.paused = true;
    else delete trip.paused;
    trip.updatedAt = new Date(now).toISOString();
    this.store.set(tripId, trip);
    return this.view(trip, now);
  }

  /** One day not driven (or driven after all). A day in the past, or too far ahead, is not one to skip. */
  skip(driverDid: string, tripId: string, day: string, skip = true, now: number = Date.now()): SavedTripView {
    const trip = this.mine(driverDid, tripId);
    this.skipDay(trip, day, skip, now);
    return this.view(trip, now);
  }

  private skipDay(trip: StoredTrip, day: string, skip: boolean, now: number): void {
    const tripId = trip.tripId;
    const today = clockAt(now, trip.zone).day;
    if (day < today || day > dayAfter(today, TRIP_SKIP_DAYS_AHEAD)) throw new GlosError('INVALID_INPUT', 'Skip a day from today on, at most two months ahead', { field: 'day' });
    trip.skips = skip ? [...new Set([...trip.skips, day])].sort() : trip.skips.filter((d) => d !== day);
    trip.updatedAt = new Date(now).toISOString();
    this.store.set(tripId, trip);
  }

  /**
   * THE BELLS (every few minutes): before each run, how many loads are on the way, opened in one tap; the evening before a
   * morning run, the same — said only when there are loads already, to take on ahead. Each once; past skips forgotten.
   */
  sweep(now: number = Date.now()): number {
    let sent = 0;
    for (const trip of [...this.store.values()]) {
      // 2026-11-12 — a fleet's runs a week ahead, on sale (part 2).
      if (trip.setBy === 'fleet' && trip.sale) this.post(trip, now);
      let changed = false;
      for (const run of nextRuns(trip, now, 2, 2)) {
        const said = trip.noticed?.[run.day] ?? {};
        const minutesTo = (run.at - now) / 60_000;
        if (!said.before && minutesTo <= TRIP_NOTICE_MIN) {
          const n = this.loadsAlong(trip);
          this.bell(trip, run.day, 'before', `Your ${run.clock} trip: ${trip.from.label} → ${trip.to.label}`, n > 0 ? `${n} load${n === 1 ? '' : 's'} on your way. Tap to see them.` : 'No loads on your way yet. Tap to look when you set off.');
          trip.noticed = { ...(trip.noticed ?? {}), [run.day]: { ...said, before: new Date(now).toISOString() } };
          changed = true;
          sent++;
          continue;
        }
        if (!said.evening && run.minutes < MORNING_ENDS_MIN) {
          const local = clockAt(now, trip.zone);
          if (local.day === dayAfter(run.day, -1) && local.minutes >= EVENING_FROM_MIN) {
            const n = this.loadsAlong(trip);
            if (n > 0) {
              this.bell(trip, run.day, 'evening', `Tomorrow ${run.clock}: ${trip.from.label} → ${trip.to.label}`, `${n} load${n === 1 ? '' : 's'} on your way already — take them on ahead tonight.`);
              sent++;
            }
            trip.noticed = { ...(trip.noticed ?? {}), [run.day]: { ...said, evening: new Date(now).toISOString() } };
            changed = true;
          }
        }
      }
      // What was said for runs three days gone, and skips gone by, are forgotten.
      const today = clockAt(now, trip.zone).day;
      const old = Object.keys(trip.noticed ?? {}).filter((d) => d < dayAfter(today, -3));
      if (old.length) {
        for (const d of old) delete trip.noticed![d];
        changed = true;
      }
      if (trip.skips.some((d) => d < today)) {
        trip.skips = trip.skips.filter((d) => d >= today);
        changed = true;
      }
      if (changed) this.store.set(trip.tripId, trip);
    }
    return sent;
  }

  /** How many loads are on a trip's way now, for the vehicle it would go in — counted, never offered. */
  loadsAlong(trip: StoredTrip): number {
    return this.dispatch.countAlong({ from: { lat: trip.from.lat, lng: trip.from.lng }, to: { lat: trip.to.lat, lng: trip.to.lng } }, this.vehicleOf(trip.driverDid));
  }

  view(trip: StoredTrip, now: number = Date.now()): SavedTripView {
    const next = nextRuns(trip, now, 1)[0];
    return {
      tripId: trip.tripId,
      setBy: trip.setBy,
      ...(trip.name ? { name: trip.name } : {}),
      from: trip.from,
      to: trip.to,
      days: [...trip.days],
      startTime: trip.startTime,
      zone: trip.zone,
      ...(trip.minEarn != null ? { minEarn: trip.minEarn } : {}),
      paused: Boolean(trip.paused),
      skips: [...trip.skips],
      ...(next ? { next: { day: next.day, clock: next.clock, at: new Date(next.at).toISOString() } } : {}),
      mine: trip.setBy === 'driver',
    };
  }

  /** "Mon–Sat 05:30, Nairobi → Nakuru": a trip in a line. */
  line(trip: Pick<StoredTrip, 'days' | 'startTime' | 'from' | 'to'>): string {
    return `${daysWords(trip.days)} ${trip.startTime}, ${trip.from.label} → ${trip.to.label}`;
  }

  private fields(dto: SavedTripDto): Pick<StoredTrip, 'from' | 'to' | 'days' | 'startTime'> & Partial<Pick<StoredTrip, 'name' | 'minEarn'>> {
    const days = [...new Set(dto.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (!days.length) throw new GlosError('INVALID_INPUT', 'Choose at least one day', { field: 'days' });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.startTime)) throw new GlosError('INVALID_INPUT', 'Say the time it starts, as HH:MM', { field: 'startTime' });
    const from = { label: dto.fromLabel.trim(), lat: dto.fromLat, lng: dto.fromLng };
    const to = { label: dto.toLabel.trim(), lat: dto.toLat, lng: dto.toLng };
    if (!from.label || !to.label) throw new GlosError('INVALID_INPUT', 'Name where it starts and where it goes');
    if (Math.abs(from.lat - to.lat) < 1e-6 && Math.abs(from.lng - to.lng) < 1e-6) throw new GlosError('INVALID_INPUT', 'A trip goes somewhere: its two ends are the same place');
    return { from, to, days, startTime: dto.startTime, ...(dto.name?.trim() ? { name: dto.name.trim() } : {}), ...(dto.minEarn != null && dto.minEarn > 0 ? { minEarn: dto.minEarn } : {}) };
  }

  private mine(driverDid: string, tripId: string): StoredTrip {
    const trip = this.get(tripId);
    if (trip.driverDid !== driverDid) throw new GlosError('NOT_FOUND', 'No such trip');
    if (trip.setBy === 'fleet') throw new GlosError('FORBIDDEN', 'Your fleet set this trip: ask it to change it');
    return trip;
  }

  /** The vehicle a trip's loads are counted for: the one on shift, else the driver's own; none — counted without. */
  private vehicleOf(driverDid: string): Vehicle | undefined {
    return this.fleet.vehicleForDriver(driverDid) ?? this.vehicles.list().find((v) => v.ownerDriverDid === driverDid && v.status === 'ACTIVE');
  }

  private bell(trip: StoredTrip, day: string, which: 'before' | 'evening', title: string, body: string): void {
    void this.notifications?.notify(trip.driverDid, { kind: 'trip', title, body, link: `/?trip=${trip.tripId}`, tag: `trip:${trip.tripId}:${day}:${which}`, data: { tripId: trip.tripId, day } }).catch(() => undefined);
  }
}
