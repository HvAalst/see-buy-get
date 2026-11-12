import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { DispatchService } from './dispatch.service';
import { VehicleService } from './vehicle.service';
import { FleetService } from './fleet.service';
import { NotificationService } from './notification.service';
import { clockAt, clocksOfCountry, isTimeZone } from './fleet-clock';
import { dayAfter, daysWords, nextRuns } from './saved-trip';
import { EVENING_FROM_MIN, MORNING_ENDS_MIN, TRIP_NOTICE_MIN, TRIP_SKIP_DAYS_AHEAD, type SavedTripDto, type SavedTripView, type StoredTrip } from './saved-trip.types';
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
  ) {}

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
    const today = clockAt(now, trip.zone).day;
    if (day < today || day > dayAfter(today, TRIP_SKIP_DAYS_AHEAD)) throw new GlosError('INVALID_INPUT', 'Skip a day from today on, at most two months ahead', { field: 'day' });
    trip.skips = skip ? [...new Set([...trip.skips, day])].sort() : trip.skips.filter((d) => d !== day);
    trip.updatedAt = new Date(now).toISOString();
    this.store.set(tripId, trip);
    return this.view(trip, now);
  }

  /**
   * THE BELLS (every few minutes): before each run, how many loads are on the way, opened in one tap; the evening before a
   * morning run, the same — said only when there are loads already, to take on ahead. Each once; past skips forgotten.
   */
  sweep(now: number = Date.now()): number {
    let sent = 0;
    for (const trip of [...this.store.values()]) {
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
