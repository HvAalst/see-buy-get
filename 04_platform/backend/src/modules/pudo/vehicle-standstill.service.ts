import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { FleetSiteService } from './fleet-site.service';
import { FleetService } from './fleet.service';
import { haversineKm } from './geo';
import { MdpService } from './mdp.service';
import type { GeoPoint } from './pudo.types';
import { VehicleBreakdownService } from './vehicle-breakdown.service';
import { VehicleService } from './vehicle.service';
import {
  DARK_AFTER_MIN,
  STANDSTILL_DEFAULT_MIN,
  STANDSTILL_KEEP_HOURS,
  STANDSTILL_MAX_MIN,
  STANDSTILL_MIN_MIN,
  STANDSTILL_OUTCOMES,
  STILL_RADIUS_KM,
  STOP_RADIUS_KM,
  type StandstillAnchor,
  type StandstillCase,
  type StandstillCaseView,
  type StandstillOutcome,
  type StandstillSettings,
  type StandstillSettingsView,
} from './vehicle-standstill.types';

/** How often vehicles standing still are looked at. */
const SWEEP_MS = Number(process.env.GLOS_STANDSTILL_SWEEP_MS ?? 60_000);
const MIN = 60_000;

/**
 * A VEHICLE STANDING STILL (vehicle-standstill.types.ts; round 16).
 *
 * Every fix a phone on a shift sends (DriverMoved) is held against where the vehicle last stopped: within a few hundred
 * metres it is still standing there; further, it has moved on — and any case about the stop is over. Once a minute the
 * stops are looked at: one longer than its fleet allows, with the phone still heard from, not at any place the vehicle
 * had reason to be, not waiting at a border post its driver said it is at, and with no breakdown already reported, opens
 * a case — once per stop — and its fleet's managers are told.
 */
@Injectable()
export class VehicleStandstillService implements OnModuleInit, OnModuleDestroy {
  private readonly settings = new PersistentMap<string, StandstillSettings>('fleet-standstill-settings');
  private readonly anchors = new PersistentMap<string, StandstillAnchor>('vehicle-standstill-anchors');
  private readonly cases = new PersistentMap<string, StandstillCase>('vehicle-standstill-cases');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly events: EventBus,
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly vehicles: VehicleService,
    private readonly dispatch: DispatchService,
    private readonly sites: FleetSiteService,
    private readonly mdps: MdpService,
    private readonly agents: AgentService,
    @Optional() private readonly breakdowns?: VehicleBreakdownService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<{ driverDid?: string; location?: GeoPoint }>(GlosEvent.Pudo.DriverMoved, (e) => {
      if (e.payload?.driverDid && e.payload.location) this.track(e.payload.driverDid, e.payload.location);
    });
    this.events.subscribe<{ assignmentId?: string }>(GlosEvent.Pudo.DriverUncoupled, (e) => {
      if (e.payload?.assignmentId) this.shiftEnded(e.payload.assignmentId);
    });
    this.events.subscribe<{ vehicleId?: string; breakdown?: { vehicleId?: string } }>(GlosEvent.Pudo.VehicleBrokeDown, (e) => {
      const vehicleId = e.payload?.breakdown?.vehicleId ?? e.payload?.vehicleId;
      if (vehicleId) this.endCases((c) => c.vehicleId === vehicleId, 'breakdown');
    });
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* -------------------------------------------------------------- the fleet's own setting -- */

  settingsOf(fleetDid: string): StandstillSettingsView {
    const s = this.settings.get(fleetDid);
    return s ? { on: s.on, afterMin: s.afterMin, asStarted: false, setAt: s.setAt, setBy: s.setBy } : { on: true, afterMin: STANDSTILL_DEFAULT_MIN, asStarted: true };
  }

  setSettings(fleetDid: string, input: { on: boolean; afterMin: number }, by: string, now: number = Date.now()): StandstillSettingsView {
    if (typeof input.on !== 'boolean') throw new GlosError('FIELD_REQUIRED', 'Say whether the watch is on', { field: 'on' });
    if (!Number.isInteger(input.afterMin) || input.afterMin < STANDSTILL_MIN_MIN || input.afterMin > STANDSTILL_MAX_MIN) {
      throw new GlosError('VALIDATION_FAILED', `Between ${STANDSTILL_MIN_MIN} minutes and ${STANDSTILL_MAX_MIN / 60} hours`, { field: 'afterMin' });
    }
    this.settings.set(fleetDid, { fleetDid, on: input.on, afterMin: input.afterMin, setAt: new Date(now).toISOString(), setBy: by });
    return this.settingsOf(fleetDid);
  }

  /** What the driver is told: their fleet hears when the vehicle stands still this long away from a stop. */
  watchedFor(driverDid: string): number | undefined {
    const fleetDid = this.fleetOf(driverDid);
    if (!fleetDid) return undefined;
    const s = this.settingsOf(fleetDid);
    return s.on ? s.afterMin : undefined;
  }

  /* ---------------------------------------------------------------------------- the watch -- */

  /** A fix from a phone on a shift: still where it stopped, or moved on (and any case about the stop is over). */
  track(driverDid: string, location: GeoPoint, now: number = Date.now()): void {
    const shift = this.fleet.activeForDriver(driverDid);
    if (!shift) return;
    const at = new Date(now).toISOString();
    const anchor = this.anchors.get(shift.assignmentId);
    if (anchor && haversineKm(anchor.location, location) <= STILL_RADIUS_KM) {
      this.anchors.set(shift.assignmentId, { ...anchor, lastFixAt: at });
      return;
    }
    if (anchor) this.endCases((c) => c.assignmentId === shift.assignmentId && c.since === anchor.since, 'moved', now);
    this.anchors.set(shift.assignmentId, { assignmentId: shift.assignmentId, driverDid, vehicleId: shift.vehicleId, location, since: at, lastFixAt: at });
  }

  /** Once a minute: every stop longer than its fleet allows, away from any reason to be there, opens its case. */
  sweep(now: number = Date.now()): StandstillCase[] {
    const opened: StandstillCase[] = [];
    for (const anchor of [...this.anchors.values()]) {
      const shift = this.fleet.activeForDriver(anchor.driverDid);
      if (!shift || shift.assignmentId !== anchor.assignmentId) {
        this.shiftEnded(anchor.assignmentId, now);
        continue;
      }
      const fleetDid = this.fleetOf(anchor.driverDid);
      if (!fleetDid) continue;
      const settings = this.settingsOf(fleetDid);
      if (!settings.on) continue;
      if (now - Date.parse(anchor.since) < settings.afterMin * MIN) continue;
      // A phone not heard from is dark, not standing still: the fleet's map says that apart.
      if (now - Date.parse(anchor.lastFixAt) > DARK_AFTER_MIN * MIN) continue;
      if (this.caseFor(anchor)) continue;
      if (this.hasReasonToStand(fleetDid, anchor, now)) continue;
      if (this.breakdowns?.openForFleet(fleetDid).some((b) => b.vehicleId === anchor.vehicleId && b.status === 'open')) continue;
      const c = this.open(fleetDid, anchor, settings.afterMin, now);
      opened.push(c);
    }
    return opened;
  }

  /* ---------------------------------------------------------------------------- the cases -- */

  /** The fleet's cases: those still standing or answered, and those over in the last day. */
  casesFor(fleetDid: string, now: number = Date.now()): StandstillCaseView[] {
    const keepFrom = now - STANDSTILL_KEEP_HOURS * 3_600_000;
    return [...this.cases.values()]
      .filter((c) => c.fleetDid === fleetDid && (!c.over || Date.parse(c.over.at) >= keepFrom))
      .sort((a, b) => Number(Boolean(a.over)) - Number(Boolean(b.over)) || b.openedAt.localeCompare(a.openedAt))
      .map((c) => viewOf(c, now));
  }

  /** The office says how it was when it called: all well, no answer, or something wrong — with its words. */
  answer(fleetDid: string, caseId: string, input: { outcome: StandstillOutcome; note?: string }, by: string, now: number = Date.now()): StandstillCaseView {
    const c = this.cases.get(caseId);
    if (!c || c.fleetDid !== fleetDid) throw new GlosError('NOT_FOUND', 'No such case for this fleet');
    if (!STANDSTILL_OUTCOMES.includes(input.outcome)) throw new GlosError('FIELD_REQUIRED', 'Say how it was: all well, no answer, or something wrong', { field: 'outcome' });
    const note = input.note?.trim().slice(0, 500);
    if (input.outcome === 'problem' && !note) throw new GlosError('FIELD_REQUIRED', 'Say what is wrong: the next person on the case reads it', { field: 'note' });
    const answered: StandstillCase = { ...c, answer: { outcome: input.outcome, ...(note ? { note } : {}), by, at: new Date(now).toISOString() } };
    this.cases.set(caseId, answered);
    return viewOf(answered, now);
  }

  /* ------------------------------------------------------------------------------ inside -- */

  private open(fleetDid: string, anchor: StandstillAnchor, afterMin: number, now: number): StandstillCase {
    let plate = '';
    try {
      plate = this.vehicles.get(anchor.vehicleId).plate;
    } catch {
      /* a vehicle gone from the register still stood where it stood */
    }
    let driverName: string | undefined;
    try {
      driverName = this.drivers.get(anchor.driverDid).displayName;
    } catch {
      driverName = undefined;
    }
    const c: StandstillCase = {
      caseId: `still_${randomBytes(6).toString('hex')}`,
      fleetDid,
      driverDid: anchor.driverDid,
      vehicleId: anchor.vehicleId,
      plate,
      ...(driverName ? { driverName } : {}),
      assignmentId: anchor.assignmentId,
      location: anchor.location,
      since: anchor.since,
      openedAt: new Date(now).toISOString(),
      afterMin,
    };
    this.cases.set(c.caseId, c);
    void this.events.publish(GlosEvent.Pudo.VehicleStandingStill, { fleetDid, case: viewOf(c, now) }, { source: 'pudo' }).catch(() => undefined);
    return c;
  }

  /** A place it had reason to be: its loads' stops, the fleet's own sites, the network's hubs and shops — or a border post. */
  private hasReasonToStand(fleetDid: string, anchor: StandstillAnchor, now: number): boolean {
    const near = (p: GeoPoint | undefined) => Boolean(p) && haversineKm(p!, anchor.location) <= STOP_RADIUS_KM;
    const reasons = this.dispatch.reasonsToStand(anchor.driverDid, now);
    if (reasons.atBorder) return true;
    if (reasons.places.some(near)) return true;
    if (this.sites.sitesOf(fleetDid).some((s) => near(s.location))) return true;
    if (this.mdps.list().some((m) => near(m.location))) return true;
    return this.agents.list().some((a) => near(a.location));
  }

  private caseFor(anchor: StandstillAnchor): StandstillCase | undefined {
    return [...this.cases.values()].find((c) => c.assignmentId === anchor.assignmentId && c.since === anchor.since);
  }

  private shiftEnded(assignmentId: string, now: number = Date.now()): void {
    this.anchors.delete(assignmentId);
    this.endCases((c) => c.assignmentId === assignmentId, 'shift_ended', now);
  }

  private endCases(which: (c: StandstillCase) => boolean, why: 'moved' | 'shift_ended' | 'breakdown', now: number = Date.now()): void {
    for (const c of this.cases.values()) {
      if (c.over || !which(c)) continue;
      this.cases.set(c.caseId, { ...c, over: { why, at: new Date(now).toISOString() } });
    }
  }

  /** The fleet a driver drives for; an owner-driver has none to tell. */
  private fleetOf(driverDid: string): string | undefined {
    try {
      return this.drivers.get(driverDid).managerDid ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function viewOf(c: StandstillCase, now: number): StandstillCaseView {
  const until = c.over ? Date.parse(c.over.at) : now;
  return {
    caseId: c.caseId,
    plate: c.plate,
    ...(c.driverName ? { driverName: c.driverName } : {}),
    location: c.location,
    since: c.since,
    openedAt: c.openedAt,
    minutes: Math.max(0, Math.round((until - Date.parse(c.since)) / MIN)),
    afterMin: c.afterMin,
    state: c.over ? 'over' : c.answer ? 'answered' : 'open',
    ...(c.answer ? { answer: c.answer } : {}),
    ...(c.over ? { over: c.over } : {}),
  };
}
