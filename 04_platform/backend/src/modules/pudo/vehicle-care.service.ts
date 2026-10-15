import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isDay } from './carriage-contract.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { Vehicle } from './fleet.types';
import { VehicleService } from './vehicle.service';
import { EndReadingResult, OdometerReading, OffRoadReason, OffRoadSpell, ReadingSource, VehicleCareView } from './vehicle-care.types';

/** The most a vehicle drives in a day, for telling a doubtful reading from a likely one. */
export const MAX_KM_PER_DAY = 1500;
/** How many readings a vehicle's sheet lists. */
const READINGS_SHOWN = 10;

/** How far ahead a vehicle may be booked off the road. */
export const OFF_ROAD_DAYS_AHEAD = 365;

/** What a spell is, as the start of the line a driver and an office read. */
const REASON_WORDS: Record<OffRoadReason, string> = {
  repair: 'In the workshop',
  service: 'In for a service',
  accident: 'Off the road after an accident',
  breakdown: 'Broken down',
  other: 'Off the road',
};

/**
 * A VEHICLE'S UPKEEP (see vehicle-care.types). This part: OFF THE ROAD, AND BACK.
 *
 * Grounding had no way back: once grounded, a vehicle stayed grounded, and the office's only way to keep a truck in the
 * workshop out of a plan was to leave it out of each day's plan by hand. A spell has a reason, a first day and a last
 * one (or none, until it is put back), and the vehicle is back the day after — or the moment somebody says so. It is
 * read where every other reason is (VehicleService.offRoadReasons): a shift does not start in it, a plan for one of its
 * days does not use it, a run is not booked on it, and the driver's list of vehicles says why.
 */
@Injectable()
export class VehicleCareService {
  private readonly spells = new PersistentMap<string, OffRoadSpell>('vehicle-off-road');
  private readonly readings = new PersistentMap<string, OdometerReading>('vehicle-readings');

  constructor(
    private readonly vehicles: VehicleService,
    private readonly managers: FleetManagerService,
    private readonly fleet: FleetService,
  ) {
    // Registered here rather than on module start, so a service built by hand in a test reads the same gate.
    this.vehicles.addOffRoadSource((v, at) => this.spellsOn(v.vehicleId, at.day ?? this.todayOf(v, at.now)).map(spellLine));
  }

  /** A vehicle's upkeep, as its owner reads it. */
  view(vehicleId: string, now: number = Date.now()): VehicleCareView {
    const v = this.vehicles.get(vehicleId);
    const today = this.todayOf(v, now);
    return {
      vehicleId: v.vehicleId,
      plate: v.plate,
      usable: this.vehicles.isUsable(v.vehicleId, now),
      offRoad: [...(v.status === 'GROUNDED' ? ['Grounded'] : []), ...this.vehicles.offRoadReasons(v.vehicleId, now)],
      ...(v.status === 'GROUNDED' ? { grounded: true } : {}),
      spells: this.liveSpellsOf(v.vehicleId).filter((s) => !s.untilDay || s.untilDay >= today),
      inUse: Boolean(this.fleet.activeForVehicle(v.vehicleId)),
      ...(this.latestReading(v.vehicleId) ? { odometer: this.latestReading(v.vehicleId) } : {}),
      readings: this.readingsOf(v.vehicleId).slice(0, READINGS_SHOWN),
    };
  }

  /* ---------------------------------------------------------------------------------------- readings -- */

  /**
   * Is this reading one that can be kept? Asked BEFORE a shift starts on it, so a slip is refused with nothing written.
   * Lower than the last is refused — unless the office records a new meter.
   */
  checkReading(vehicleId: string, km: number, newMeter = false): void {
    const v = this.vehicles.get(vehicleId);
    if (!Number.isInteger(km) || km < 0) throw new GlosError('INVALID_INPUT', 'An odometer reading is whole kilometres', { field: 'odometerKm' });
    const last = this.latestReading(vehicleId);
    if (last && km < last.km && !newMeter) {
      throw new GlosError('INVALID_INPUT', `${v.plate}'s last reading was ${last.km.toLocaleString('en-GB')} km: a reading cannot go back. If the meter was changed, the office records the new one.`, { field: 'odometerKm' });
    }
  }

  /** Keep a reading, checked first. A jump bigger than the vehicle could have driven since the last is kept, and said to be doubtful. */
  recordReading(vehicleId: string, km: number, who: { by: string; byDid?: string; source: ReadingSource; newMeter?: boolean }, now: number = Date.now()): OdometerReading {
    this.checkReading(vehicleId, km, who.newMeter);
    const last = this.latestReading(vehicleId);
    const doubtful = !who.newMeter && last ? jumpWords(last, km, now) : undefined;
    const reading: OdometerReading = {
      readingId: `odo_${randomBytes(6).toString('hex')}`,
      vehicleId,
      km,
      at: new Date(now).toISOString(),
      source: who.source,
      by: who.by,
      ...(who.byDid ? { byDid: who.byDid } : {}),
      ...(who.newMeter ? { newMeter: true } : {}),
      ...(doubtful ? { doubtful } : {}),
    };
    this.readings.set(reading.readingId, reading);
    return reading;
  }

  /**
   * A reading given as a shift ENDED. Never in the way of ending it — an end can be sent from an outbox long after the
   * phone lost signal, and a shift that would not end over a typing slip is a driver who cannot go home. A reading that
   * cannot be kept is not kept, and the answer says why.
   */
  recordEndReading(vehicleId: string, km: number, who: { by: string; byDid?: string }, now: number = Date.now()): EndReadingResult {
    try {
      const r = this.recordReading(vehicleId, km, { ...who, source: 'shift_end' }, now);
      return { kept: true, ...(r.doubtful ? { doubtful: r.doubtful } : {}) };
    } catch (err) {
      return { kept: false, why: (err as Error).message };
    }
  }

  /** The latest reading of a vehicle: what service intervals count from. */
  latestReading(vehicleId: string): OdometerReading | undefined {
    return this.readingsOf(vehicleId)[0];
  }

  private readingsOf(vehicleId: string): OdometerReading[] {
    return [...this.readings.values()].filter((r) => r.vehicleId === vehicleId).sort((a, b) => b.at.localeCompare(a.at) || b.km - a.km);
  }

  /**
   * Take it off the road: why, from which day (today unless said), until which day (or until put back). Refused before
   * anything is kept when the days are wrong, or it is already off the road for any of those days — that spell is the
   * one to end first, so two reasons never argue about the same day.
   */
  takeOffRoad(vehicleId: string, input: { reason: OffRoadReason; note?: string; fromDay?: string; untilDay?: string }, by: string, now: number = Date.now()): VehicleCareView {
    const v = this.vehicles.get(vehicleId);
    if (v.status === 'RETIRED') throw new GlosError('INVALID_STATE', `${v.plate} is retired: it does not go on the road again`);
    const today = this.todayOf(v, now);
    const fromDay = input.fromDay ?? today;
    if (!isDay(fromDay) || (input.untilDay !== undefined && !isDay(input.untilDay))) throw new GlosError('INVALID_INPUT', 'A day is YYYY-MM-DD');
    if (fromDay < today) throw new GlosError('INVALID_INPUT', 'A spell off the road starts today or later', { field: 'fromDay' });
    if (input.untilDay !== undefined && input.untilDay < fromDay) throw new GlosError('INVALID_INPUT', 'The last day off the road comes on or after the first', { field: 'untilDay' });
    if ((input.untilDay ?? fromDay) > addDays(today, OFF_ROAD_DAYS_AHEAD)) throw new GlosError('INVALID_INPUT', `A spell off the road is for the next ${OFF_ROAD_DAYS_AHEAD} days at most`, { field: 'untilDay' });
    const clash = this.liveSpellsOf(vehicleId).find((s) => overlaps(s, fromDay, input.untilDay));
    if (clash) throw new GlosError('INVALID_STATE', `${v.plate} is already off the road ${spanWords(clash)} (${REASON_WORDS[clash.reason].toLowerCase()}): end that first, or choose other days`);
    const note = input.note?.trim();
    const spell: OffRoadSpell = {
      spellId: `ofr_${randomBytes(6).toString('hex')}`,
      vehicleId,
      reason: input.reason,
      ...(note ? { note } : {}),
      fromDay,
      ...(input.untilDay ? { untilDay: input.untilDay } : {}),
      setBy: by,
      setAt: new Date(now).toISOString(),
    };
    this.spells.set(spell.spellId, spell);
    return this.view(vehicleId, now);
  }

  /** End one spell from this moment — or call it off, when it has not begun. */
  endSpell(vehicleId: string, spellId: string, by: string, now: number = Date.now()): VehicleCareView {
    const spell = this.spells.get(spellId);
    if (!spell || spell.vehicleId !== vehicleId) throw new GlosError('NOT_FOUND', 'No such spell off the road for this vehicle');
    if (spell.endedAt) throw new GlosError('INVALID_STATE', 'That spell has already ended');
    this.spells.set(spellId, { ...spell, endedAt: new Date(now).toISOString(), endedBy: by });
    return this.view(vehicleId, now);
  }

  /** Back on the road NOW: every spell covering today ends, and a vehicle grounded the old way is reinstated. Spells to come stay. */
  backOnTheRoad(vehicleId: string, by: string, now: number = Date.now()): VehicleCareView {
    const v = this.vehicles.get(vehicleId);
    const today = this.todayOf(v, now);
    const current = this.spellsOn(vehicleId, today);
    if (!current.length && v.status !== 'GROUNDED') throw new GlosError('INVALID_STATE', `${v.plate} is not off the road for a reason this can end`);
    for (const s of current) this.spells.set(s.spellId, { ...s, endedAt: new Date(now).toISOString(), endedBy: by });
    this.vehicles.reinstate(vehicleId);
    return this.view(vehicleId, now);
  }

  /** The spells that keep it off the road on a day. */
  private spellsOn(vehicleId: string, day: string): OffRoadSpell[] {
    return this.liveSpellsOf(vehicleId).filter((s) => s.fromDay <= day && (!s.untilDay || day <= s.untilDay));
  }

  private liveSpellsOf(vehicleId: string): OffRoadSpell[] {
    return [...this.spells.values()].filter((s) => s.vehicleId === vehicleId && !s.endedAt).sort((a, b) => a.fromDay.localeCompare(b.fromDay));
  }

  /** Today on the owner's clock: the fleet's for a fleet's vehicle. */
  private todayOf(v: Vehicle, now: number): string {
    return this.managers.todayOf(v.managerDid, now);
  }
}

/** A jump past what the vehicle could drive since the last reading, in words; nothing when it is likely. */
function jumpWords(last: OdometerReading, km: number, now: number): string | undefined {
  const days = Math.max(1, Math.ceil((now - Date.parse(last.at)) / 86_400_000));
  const most = MAX_KM_PER_DAY * days;
  if (km - last.km <= most) return undefined;
  return `${(km - last.km).toLocaleString('en-GB')} km since the last reading — more than ${most.toLocaleString('en-GB')} km in ${days === 1 ? 'a day' : `${days} days`}`;
}

/** One spell as the line every refusal and screen says: "In the workshop until 17 Oct 2026: brakes". */
export function spellLine(s: Pick<OffRoadSpell, 'reason' | 'untilDay' | 'note'>): string {
  return `${REASON_WORDS[s.reason]}${s.untilDay ? ` until ${dayWords(s.untilDay)}` : ''}${s.note ? `: ${s.note}` : ''}`;
}

function spanWords(s: OffRoadSpell): string {
  return s.untilDay ? `from ${dayWords(s.fromDay)} to ${dayWords(s.untilDay)}` : `from ${dayWords(s.fromDay)} until put back`;
}

function overlaps(s: OffRoadSpell, fromDay: string, untilDay?: string): boolean {
  const endsBefore = untilDay !== undefined && untilDay < s.fromDay;
  const startsAfter = s.untilDay !== undefined && fromDay > s.untilDay;
  return !endsBefore && !startsAfter;
}

/** "17 Oct 2026": the way papers already say a day. */
function dayWords(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
