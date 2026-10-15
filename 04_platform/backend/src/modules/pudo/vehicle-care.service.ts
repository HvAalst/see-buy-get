import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { MediaService } from './media.service';
import type { VehicleClass } from './fleet.config';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isDay } from './carriage-contract.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { Vehicle } from './fleet.types';
import { VehicleService } from './vehicle.service';
import { CareSettings, CheckItem, CheckResult, CheckSheet, DefectItem, EndReadingResult, OdometerReading, OffRoadReason, OffRoadSpell, ReadingSource, VehicleCareView, VehicleDefect } from './vehicle-care.types';

/** The most a vehicle drives in a day, for telling a doubtful reading from a likely one. */
export const MAX_KM_PER_DAY = 1500;
/** How many readings a vehicle's sheet lists. */
const READINGS_SHOWN = 10;

/** What each class of vehicle is checked for, and which of those are safety-critical. Brakes, tyres and lights always. */
export const CHECKLIST: Record<VehicleClass, Array<{ item: CheckItem; safety: boolean }>> = {
  bike: [{ item: 'tyres', safety: true }, { item: 'brakes', safety: true }, { item: 'lights', safety: true }, { item: 'chain', safety: false }],
  motorcycle: [{ item: 'tyres', safety: true }, { item: 'brakes', safety: true }, { item: 'lights', safety: true }, { item: 'mirrors', safety: false }, { item: 'horn', safety: false }, { item: 'chain', safety: false }, { item: 'leaks', safety: false }],
  tuktuk: [{ item: 'tyres', safety: true }, { item: 'brakes', safety: true }, { item: 'lights', safety: true }, { item: 'mirrors', safety: false }, { item: 'horn', safety: false }, { item: 'leaks', safety: false }, { item: 'body', safety: false }],
  car: [{ item: 'tyres', safety: true }, { item: 'brakes', safety: true }, { item: 'lights', safety: true }, { item: 'mirrors', safety: false }, { item: 'wipers', safety: false }, { item: 'leaks', safety: false }, { item: 'body', safety: false }],
  van: [{ item: 'tyres', safety: true }, { item: 'brakes', safety: true }, { item: 'lights', safety: true }, { item: 'mirrors', safety: false }, { item: 'wipers', safety: false }, { item: 'horn', safety: false }, { item: 'leaks', safety: false }, { item: 'load_gear', safety: false }, { item: 'body', safety: false }],
  bus: [{ item: 'tyres', safety: true }, { item: 'brakes', safety: true }, { item: 'lights', safety: true }, { item: 'mirrors', safety: false }, { item: 'wipers', safety: false }, { item: 'horn', safety: false }, { item: 'leaks', safety: false }, { item: 'load_gear', safety: false }, { item: 'body', safety: false }],
  truck: [{ item: 'tyres', safety: true }, { item: 'brakes', safety: true }, { item: 'lights', safety: true }, { item: 'mirrors', safety: false }, { item: 'wipers', safety: false }, { item: 'horn', safety: false }, { item: 'leaks', safety: false }, { item: 'load_gear', safety: false }, { item: 'body', safety: false }],
};

/** What a defect is about, as the line every refusal, notice and screen says. */
export const ITEM_WORDS: Record<DefectItem, string> = {
  tyres: 'Tyres',
  brakes: 'Brakes',
  lights: 'Lights',
  mirrors: 'Mirrors',
  horn: 'Horn',
  wipers: 'Wipers',
  leaks: 'A leak',
  chain: 'Chain',
  load_gear: 'Straps and load gear',
  body: 'Body and doors',
  other: 'Something else',
};

/** How many decided defects a vehicle's sheet lists. */
const DECIDED_SHOWN = 5;

/** What a defect's report and decision tell, for the notices (NotificationDispatcher). */
export interface VehicleDefectReported {
  fleetDid?: string;
  plate: string;
  defect: VehicleDefect;
}
export interface VehicleDefectDecided {
  plate: string;
  defect: VehicleDefect;
}

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
  private readonly defects = new PersistentMap<string, VehicleDefect & { photoRef?: string }>('vehicle-defects');
  /** One check per vehicle per day is what a fleet can ask for: vehicleId|day → who, when, and whether it was clean. */
  private readonly checks = new PersistentMap<string, { vehicleId: string; day: string; by: string; byDid: string; at: string; clean: boolean }>('vehicle-checks');
  private readonly settings = new PersistentMap<string, CareSettings>('fleet-care-settings');

  constructor(
    private readonly vehicles: VehicleService,
    private readonly managers: FleetManagerService,
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly media: MediaService,
    private readonly events: EventBus,
  ) {
    // Registered here rather than on module start, so a service built by hand in a test reads the same gate.
    this.vehicles.addOffRoadSource((v, at) => this.spellsOn(v.vehicleId, at.day ?? this.todayOf(v, at.now)).map(spellLine));
    // An open safety defect keeps it off the road until the office says otherwise — whatever day is asked about.
    this.vehicles.addOffRoadSource((v) => this.openDefectsOf(v.vehicleId).filter((d) => d.safety).map(defectLine));
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
      defects: this.openDefectsOf(v.vehicleId).map(publicDefect),
      decided: this.defectsOf(v.vehicleId).filter((d) => d.status !== 'open').sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')).slice(0, DECIDED_SHOWN).map(publicDefect),
      ...this.lastCheckOf(v.vehicleId),
    };
  }

  /* -------------------------------------------------------------------------- the daily check, defects -- */

  /** A fleet's own rules for its vehicles' upkeep. */
  settingsOf(fleetDid: string): CareSettings {
    this.managers.get(fleetDid);
    return this.settings.get(fleetDid) ?? { requireDailyCheck: false };
  }

  setSettings(fleetDid: string, next: CareSettings): CareSettings {
    this.managers.get(fleetDid);
    this.settings.set(fleetDid, { requireDailyCheck: next.requireDailyCheck });
    return this.settingsOf(fleetDid);
  }

  /** What the driver is asked before a shift in this vehicle — named as picked, or by the QR on its dashboard. */
  checkSheet(driverDid: string, pick: { vehicleId?: string; vehicleQr?: string }, now: number = Date.now()): CheckSheet {
    const v = this.vehicleFor(driverDid, pick);
    const done = this.checks.get(`${v.vehicleId}|${this.todayOf(v, now)}`);
    return {
      vehicleId: v.vehicleId,
      plate: v.plate,
      vehicleClass: v.vehicleClass,
      items: CHECKLIST[v.vehicleClass].map((c) => ({ ...c })),
      ...(done ? { checkedTodayBy: done.by, checkedTodayAt: done.at } : {}),
      required: this.requiresCheck(v),
    };
  }

  /**
   * A DAILY CHECK: every item of the vehicle's class answered, fine or not. A problem says what is wrong, in words or
   * a photograph. Each new problem becomes a defect (one already open for that item is not reported twice); a
   * safety-critical one takes the vehicle off the road. Refused whole, before anything is kept, when an item is missing
   * or answered twice, a problem says nothing, or a photograph is not the driver's own.
   */
  submitCheck(driverDid: string, pick: { vehicleId?: string; vehicleQr?: string }, answers: Array<{ item: CheckItem; ok: boolean; note?: string; photoRef?: string }>, now: number = Date.now()): CheckResult {
    const v = this.vehicleFor(driverDid, pick);
    const list = CHECKLIST[v.vehicleClass];
    const asked = new Set(list.map((c) => c.item));
    const seen = new Set<CheckItem>();
    for (const a of answers) {
      if (!asked.has(a.item)) throw new GlosError('INVALID_INPUT', `A ${v.vehicleClass} is not checked for ${ITEM_WORDS[a.item].toLowerCase()}`, { field: 'answers' });
      if (seen.has(a.item)) throw new GlosError('INVALID_INPUT', `${ITEM_WORDS[a.item]} is answered twice`, { field: 'answers' });
      seen.add(a.item);
      if (!a.ok && !a.note?.trim() && !a.photoRef) throw new GlosError('INVALID_INPUT', `Say what is wrong with the ${ITEM_WORDS[a.item].toLowerCase()}, or add a photo`, { field: 'answers' });
      if (a.photoRef) this.assertOwnPhoto(a.photoRef, driverDid);
    }
    const missing = list.find((c) => !seen.has(c.item));
    if (missing) throw new GlosError('INVALID_INPUT', `Answer every item: ${ITEM_WORDS[missing.item].toLowerCase()} is not answered`, { field: 'answers' });

    const by = this.drivers.get(driverDid).displayName;
    const open = this.openDefectsOf(v.vehicleId);
    const found: VehicleDefect[] = [];
    const alreadyOpen: VehicleDefect[] = [];
    for (const a of answers.filter((x) => !x.ok)) {
      const existing = open.find((d) => d.item === a.item);
      if (existing) {
        alreadyOpen.push(publicDefect(existing));
        continue;
      }
      const safety = list.find((c) => c.item === a.item)!.safety;
      found.push(this.keepDefect(v, { item: a.item, note: a.note, photoRef: a.photoRef, safety, by, byDid: driverDid, found: 'check' }, now));
    }
    const checkId = `${v.vehicleId}|${this.todayOf(v, now)}`;
    this.checks.set(checkId, { vehicleId: v.vehicleId, day: this.todayOf(v, now), by, byDid: driverDid, at: new Date(now).toISOString(), clean: found.length === 0 && alreadyOpen.length === 0 });
    return { checkId, clean: found.length === 0 && alreadyOpen.length === 0, found, alreadyOpen, usable: this.vehicles.isUsable(v.vehicleId, now), offRoad: this.vehicles.offRoadReasons(v.vehicleId, now) };
  }

  /**
   * A DEFECT REPORTED AT ANY TIME — on the road, at the end of a day — by a driver of the vehicle or its office. The
   * one who reports it says whether it is safe to drive: not safe takes the vehicle off the road. The same item already
   * open is not reported twice.
   */
  reportDefect(vehicleId: string, who: { by: string; byDid?: string }, input: { item: DefectItem; note: string; photoRef?: string; safe: boolean }, now: number = Date.now()): VehicleDefect {
    const v = this.vehicles.get(vehicleId);
    if (!input.note?.trim()) throw new GlosError('INVALID_INPUT', 'Say what is wrong', { field: 'note' });
    if (input.photoRef && who.byDid) this.assertOwnPhoto(input.photoRef, who.byDid);
    const existing = this.openDefectsOf(vehicleId).find((d) => d.item === input.item && input.item !== 'other');
    if (existing) throw new GlosError('INVALID_STATE', `${ITEM_WORDS[input.item]} on ${v.plate} is already reported (${existing.reportedBy}, ${dayWords(existing.reportedAt.slice(0, 10))}): the office has it`);
    return this.keepDefect(v, { item: input.item, note: input.note, photoRef: input.photoRef, safety: !input.safe, by: who.by, byDid: who.byDid, found: 'report' }, now);
  }

  /**
   * The office's word on a defect: FIXED, or CLEARED — safe to drive as it is. Either takes it off the list of what
   * keeps the vehicle off the road, and either needs a reason in words. The driver who reported it is told.
   */
  decideDefect(vehicleId: string, defectId: string, decision: 'fixed' | 'cleared', note: string, by: string, now: number = Date.now()): VehicleCareView {
    const d = this.defects.get(defectId);
    if (!d || d.vehicleId !== vehicleId) throw new GlosError('NOT_FOUND', 'No such defect on this vehicle');
    if (d.status !== 'open') throw new GlosError('INVALID_STATE', 'That defect has already been decided');
    if (!note?.trim()) throw new GlosError('INVALID_INPUT', decision === 'fixed' ? 'Say what was done' : 'Say why it is safe to drive as it is', { field: 'note' });
    const decided = { ...d, status: decision, decidedBy: by, decidedAt: new Date(now).toISOString(), decisionNote: note.trim() } as VehicleDefect & { photoRef?: string };
    this.defects.set(defectId, decided);
    const v = this.vehicles.get(vehicleId);
    void this.events.publish(GlosEvent.Pudo.VehicleDefectDecided, { plate: v.plate, defect: publicDefect(decided) } satisfies VehicleDefectDecided, { source: 'pudo' }).catch(() => undefined);
    return this.view(vehicleId, now);
  }

  /**
   * Whether this driver may start a shift in this vehicle as far as its check goes: a fleet that asks for a daily
   * check, and none today, is a refusal in words. Nothing for a vehicle whose fleet does not ask, or a courier's own.
   */
  checkBlocker(vehicleId: string, now: number = Date.now()): string | undefined {
    const v = this.vehicles.get(vehicleId);
    if (!this.requiresCheck(v)) return undefined;
    if (this.checks.get(`${v.vehicleId}|${this.todayOf(v, now)}`)) return undefined;
    return `Check ${v.plate} first: ${this.managers.get(v.managerDid!).companyName} asks for a daily check before a shift`;
  }

  /** The photograph of a defect, for the vehicle's owner — the upkeep routes decide who that is. */
  defectPhoto(vehicleId: string, defectId: string, variant: 'full' | 'thumb'): { bytes: Buffer; contentType: string } {
    const d = this.defects.get(defectId);
    if (!d || d.vehicleId !== vehicleId || !d.photoRef) throw new GlosError('NOT_FOUND', 'No photograph for this defect');
    return this.media.blob(d.photoRef, variant);
  }

  /** The vehicle a driver may check or report on: their fleet's, or their own. */
  private vehicleFor(driverDid: string, pick: { vehicleId?: string; vehicleQr?: string }): Vehicle {
    const v = pick.vehicleId ? this.vehicles.get(pick.vehicleId) : pick.vehicleQr ? this.vehicles.byQr(pick.vehicleQr) : undefined;
    if (!v) throw new GlosError('NOT_FOUND', pick.vehicleQr ? 'No vehicle has that QR' : 'Name the vehicle: pick it, or scan its QR');
    const driver = this.drivers.get(driverDid);
    const theirs = (v.managerDid && driver.managerDid === v.managerDid) || v.ownerDriverDid === driverDid;
    if (!theirs) throw new GlosError('FORBIDDEN', `${v.plate} is not a vehicle you drive`);
    return v;
  }

  private requiresCheck(v: Vehicle): boolean {
    return Boolean(v.managerDid && this.settings.get(v.managerDid)?.requireDailyCheck);
  }

  private assertOwnPhoto(photoRef: string, ownerDid: string): void {
    const ref = this.media.get(photoRef);
    if (!ref || ref.ownerDid !== ownerDid || ref.status !== 'active' || (ref.link && ref.link.type !== 'vehicle')) throw new GlosError('INVALID_INPUT', 'That photograph is not one you took', { field: 'photoRef' });
  }

  private keepDefect(v: Vehicle, d: { item: DefectItem; note?: string; photoRef?: string; safety: boolean; by: string; byDid?: string; found: 'check' | 'report' }, now: number): VehicleDefect {
    const note = d.note?.trim();
    const defect: VehicleDefect & { photoRef?: string } = {
      defectId: `dft_${randomBytes(6).toString('hex')}`,
      vehicleId: v.vehicleId,
      item: d.item,
      ...(note ? { note } : {}),
      safety: d.safety,
      reportedBy: d.by,
      ...(d.byDid ? { reportedByDid: d.byDid } : {}),
      reportedAt: new Date(now).toISOString(),
      found: d.found,
      status: 'open',
    };
    // The photograph becomes the vehicle's record: attached to it, kept with it, no longer the uploader's to delete.
    if (d.photoRef && d.byDid && this.media.adopt(d.photoRef, d.byDid, { type: 'vehicle', id: v.vehicleId }, 'defect')) {
      defect.photoRef = d.photoRef;
      defect.hasPhoto = true;
    }
    this.defects.set(defect.defectId, defect);
    void this.events.publish(GlosEvent.Pudo.VehicleDefectReported, { ...(v.managerDid ? { fleetDid: v.managerDid } : {}), plate: v.plate, defect: publicDefect(defect) } satisfies VehicleDefectReported, { source: 'pudo' }).catch(() => undefined);
    return publicDefect(defect);
  }

  private defectsOf(vehicleId: string): Array<VehicleDefect & { photoRef?: string }> {
    return [...this.defects.values()].filter((d) => d.vehicleId === vehicleId);
  }

  private openDefectsOf(vehicleId: string): Array<VehicleDefect & { photoRef?: string }> {
    return this.defectsOf(vehicleId)
      .filter((d) => d.status === 'open')
      .sort((a, b) => Number(b.safety) - Number(a.safety) || a.reportedAt.localeCompare(b.reportedAt));
  }

  private lastCheckOf(vehicleId: string): { lastCheckBy?: string; lastCheckAt?: string; lastCheckClean?: boolean } {
    const last = [...this.checks.values()].filter((c) => c.vehicleId === vehicleId).sort((a, b) => b.at.localeCompare(a.at))[0];
    return last ? { lastCheckBy: last.by, lastCheckAt: last.at, lastCheckClean: last.clean } : {};
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

/** A defect as it is shown: never the photograph's id, only that there is one. */
function publicDefect(d: VehicleDefect & { photoRef?: string }): VehicleDefect {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { photoRef, ...rest } = d;
  return rest;
}

/** An open safety defect, as the line every refusal and screen says: "Brakes reported unsafe by Amos K. on 15 Oct 2026: pulling left". */
export function defectLine(d: Pick<VehicleDefect, 'item' | 'reportedBy' | 'reportedAt' | 'note'>): string {
  return `${ITEM_WORDS[d.item]} reported unsafe by ${d.reportedBy} on ${dayWords(d.reportedAt.slice(0, 10))}${d.note ? `: ${d.note}` : ''}`;
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
