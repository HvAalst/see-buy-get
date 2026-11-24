import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DispatchService } from './dispatch.service';
import { FleetService } from './fleet.service';
import { countryNear } from './geo-gazetteer';
import { insideRomania, kmFromRomania } from './romania-border';
import {
  RO_OUTSIDE_READINGS,
  RO_PING_GAP_MIN,
  RO_REACH_KM,
  RO_SIGNAL_LOST_MIN,
  TELEMATICS_PROVIDERS,
  TELEMETRY_KEEP_DAYS,
  TELEMETRY_MAX_PINGS,
  type TelematicsProvider,
  type TelemetryClosedBy,
  type TelemetryDriverView,
  type TelemetryPing,
  type TelemetryUit,
  type TransportTelemetrySession,
} from './telemetry.types';
import { VehicleService } from './vehicle.service';

const MIN = 60_000;
const DAY = 86_400_000;
const plateKey = (plate: string) => plate.replace(/[\s-]/g, '').toUpperCase();

/** What a watched vehicle carries that the watch reads: its UIT codes, whether it crosses countries, whether it ends in Romania. */
interface Cargo {
  uitCodes: TelemetryUit[];
  crossesCountries: boolean;
  deliversInRomania: boolean;
  empty: boolean;
}

/**
 * 2026-11-24 — THE GPS WATCH OF RO e-TRANSPORT (the owner's brief, feature 4; the owner's answer: "Watch, carrier transmits"). A
 * vehicle on a shift carrying a load with a UIT, or anything between two countries, is watched: its positions, from our Driver
 * app or the fleet's own system, are kept with the country they fall in; entering Romania starts the strict part, where a
 * silence of 15 minutes alerts the driver and the office; three readings outside, with nothing left to deliver in Romania, end it.
 * The positions are ready to hand to the carrier's registered GPS provider; SeeBuyGet sends nothing to ANAF itself.
 */
@Injectable()
export class TelemetryService {
  private readonly sessions = new PersistentMap<string, TransportTelemetrySession>('pudo-telemetry-sessions');
  private readonly pingLog = new PersistentMap<string, TelemetryPing[]>('pudo-telemetry-pings');
  /** Which system sends each fleet's positions; a fleet that never said sends through our Driver app. */
  private readonly providers = new PersistentMap<string, TelematicsProvider>('pudo-telemetry-providers');

  constructor(
    private readonly dispatch: DispatchService,
    private readonly fleet: FleetService,
    private readonly vehicles: VehicleService,
    private readonly events: EventBus,
  ) {}

  /* ------------------------------------------------------------------ the fleet's choice -- */

  providerOf(fleetDid: string | undefined): TelematicsProvider {
    return (fleetDid && this.providers.get(fleetDid)) || 'DRIVER_APP_GPS';
  }

  setProvider(fleetDid: string, provider: string): TelematicsProvider {
    if (!(TELEMATICS_PROVIDERS as readonly string[]).includes(provider)) throw new GlosError('VALIDATION_FAILED', `Which system sends your positions is one of ${TELEMATICS_PROVIDERS.join(', ')}`, { field: 'provider' });
    this.providers.set(fleetDid, provider as TelematicsProvider);
    for (const s of this.sessions.values()) if (s.fleetDid === fleetDid && !s.closedAt) this.sessions.set(s.sessionId, { ...s, provider: provider as TelematicsProvider });
    return provider as TelematicsProvider;
  }

  /* ------------------------------------------------------------------------ the watch -- */

  /** The open watch of a driver, if any. */
  openFor(driverDid: string): TransportTelemetrySession | undefined {
    return [...this.sessions.values()].find((s) => s.driverDid === driverDid && !s.closedAt);
  }

  /**
   * The watch of a driver's vehicle, opened where its cargo asks for one, its UIT codes brought up to date (the fleet's system
   * is told when they change), and closed where nothing aboard asks for it any more.
   */
  ensure(driverDid: string, now: number = Date.now()): TransportTelemetrySession | undefined {
    const shift = this.fleet.activeForDriver(driverDid);
    const v = this.fleet.vehicleForDriver(driverDid);
    const open = this.openFor(driverDid);
    if (!shift || !v) {
      if (open) this.close(open, 'shift_ended', now);
      return undefined;
    }
    const cargo = this.cargoOf(driverDid, v.vehicleId);
    const watched = cargo.uitCodes.length > 0 || cargo.crossesCountries;
    if (!watched) {
      if (open) this.close(open, open.enteredRoAt ? 'delivered' : 'never_entered', now);
      return undefined;
    }
    if (open) {
      if (JSON.stringify(open.uitCodes) !== JSON.stringify(cargo.uitCodes)) {
        const next = { ...open, uitCodes: cargo.uitCodes };
        this.sessions.set(open.sessionId, next);
        this.publish(GlosEvent.Pudo.TelematicsUitChanged, next);
        return next;
      }
      return open;
    }
    const s: TransportTelemetrySession = {
      sessionId: `tel_${randomBytes(6).toString('hex')}`,
      driverDid,
      vehicleId: v.vehicleId,
      plate: v.plate,
      ...(v.towing?.plate ? { trailerPlate: v.towing.plate } : {}),
      ...(v.managerDid ? { fleetDid: v.managerDid } : {}),
      uitCodes: cargo.uitCodes,
      provider: this.providerOf(v.managerDid),
      roStatus: 'PENDING_BORDER',
      startedAt: new Date(now).toISOString(),
      outsideStreak: 0,
      gaps: [],
      pings: 0,
    };
    this.sessions.set(s.sessionId, s);
    if (s.uitCodes.length) this.publish(GlosEvent.Pudo.TelematicsUitChanged, s);
    return s;
  }

  /**
   * A position of a watched vehicle, from the Driver app or the fleet's system: kept with its country, and the watch moved on —
   * into Romania, back from a silence, or out of Romania after three readings outside with nothing left to deliver there.
   */
  ping(driverDid: string, point: { lat: number; lng: number; speedKmh?: number; heading?: number; recordedAt?: string }, source: TelematicsProvider, now: number = Date.now()): TransportTelemetrySession | undefined {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw new GlosError('VALIDATION_FAILED', 'A position is a latitude between -90 and 90 and a longitude between -180 and 180', { field: 'lat' });
    const s = this.ensure(driverDid, now);
    if (!s) return undefined;
    const at = this.momentOf(point.recordedAt, now);
    const inRo = insideRomania(point);
    const country = inRo ? 'RO' : countryNear(point);
    const ping: TelemetryPing = { lat: point.lat, lng: point.lng, ...(point.speedKmh !== undefined ? { speedKmh: point.speedKmh } : {}), ...(point.heading !== undefined ? { heading: point.heading } : {}), ...(country ? { country } : {}), recordedAt: at, source };
    const log = this.pingLog.get(s.sessionId) ?? [];
    log.push(ping);
    this.pingLog.set(s.sessionId, log.length > TELEMETRY_MAX_PINGS ? log.slice(-TELEMETRY_MAX_PINGS) : log);
    const next: TransportTelemetrySession = { ...s, pings: s.pings + 1, ...(country ? { lastCountry: country } : {}), gaps: [...s.gaps] };
    const last = s.lastPingAt ? Date.parse(s.lastPingAt) : undefined;
    // A silence in Romania longer than ANAF's 2 minutes is kept as a gap; one the sweep already opened is closed here.
    if (last !== undefined && Date.parse(at) > last) {
      const minutes = Math.round((Date.parse(at) - last) / MIN);
      const openGap = next.gaps.findIndex((g) => !g.to);
      if (openGap >= 0) next.gaps[openGap] = { ...next.gaps[openGap], to: at, minutes };
      else if (s.roStatus === 'ACTIVE_IN_RO' && minutes > RO_PING_GAP_MIN) next.gaps.push({ from: s.lastPingAt!, to: at, minutes });
      if ((s.roStatus === 'ACTIVE_IN_RO' || s.roStatus === 'SIGNAL_LOST') && minutes > (next.longestGapMin ?? 0)) next.longestGapMin = minutes;
    }
    if (last === undefined || Date.parse(at) > last) next.lastPingAt = at;
    // Heard again after a silence, wherever it is now: the silence is over.
    if (s.roStatus === 'SIGNAL_LOST') {
      next.roStatus = 'ACTIVE_IN_RO';
      this.publish(GlosEvent.Pudo.TelematicsSignalBack, next);
    }
    if (inRo) {
      next.outsideStreak = 0;
      if (s.roStatus === 'PENDING_BORDER') next.enteredRoAt = at;
      next.roStatus = 'ACTIVE_IN_RO';
    } else if (s.enteredRoAt) {
      next.outsideStreak = s.outsideStreak + 1;
      const v = this.fleet.vehicleForDriver(driverDid);
      const cargo = v ? this.cargoOf(driverDid, v.vehicleId) : undefined;
      if (next.outsideStreak >= RO_OUTSIDE_READINGS && !cargo?.deliversInRomania) {
        this.sessions.set(next.sessionId, next);
        return this.close(next, 'left_romania', now, at);
      }
    }
    this.sessions.set(next.sessionId, next);
    return next;
  }

  /** What the Driver app is told with each position: where the watch stands, and whether to send every minute. */
  driverView(driverDid: string, at?: { lat: number; lng: number }): TelemetryDriverView | undefined {
    const s = this.openFor(driverDid);
    if (!s) return undefined;
    const near = s.roStatus !== 'PENDING_BORDER' || (at !== undefined && kmFromRomania(at) <= RO_REACH_KM);
    return { roStatus: s.roStatus, provider: s.provider, everyMinute: near, ...(s.lastPingAt ? { lastPingAt: s.lastPingAt } : {}), ...(s.enteredRoAt ? { enteredRoAt: s.enteredRoAt } : {}) };
  }

  /** Every minute: a silence of 15 minutes in Romania is told; a watch whose shift ended or cargo left is closed; old positions go. */
  sweep(now: number = Date.now()): { silent: number; closed: number; deleted: number } {
    let silent = 0;
    let closed = 0;
    let deleted = 0;
    for (const s of [...this.sessions.values()]) {
      if (s.closedAt) {
        if (now - Date.parse(s.closedAt) > TELEMETRY_KEEP_DAYS * DAY && this.pingLog.has(s.sessionId)) {
          this.pingLog.delete(s.sessionId);
          deleted += 1;
        }
        continue;
      }
      const still = this.ensure(s.driverDid, now);
      if (!still) {
        closed += 1;
        continue;
      }
      if (still.roStatus === 'ACTIVE_IN_RO' && still.lastPingAt && now - Date.parse(still.lastPingAt) >= RO_SIGNAL_LOST_MIN * MIN) {
        const next: TransportTelemetrySession = { ...still, roStatus: 'SIGNAL_LOST', gaps: [...still.gaps, { from: still.lastPingAt }] };
        this.sessions.set(next.sessionId, next);
        this.publish(GlosEvent.Pudo.TelematicsSignalLost, next, { minutes: Math.round((now - Date.parse(still.lastPingAt)) / MIN), lastPoint: this.lastPoint(next.sessionId) });
        silent += 1;
      }
    }
    return { silent, closed, deleted };
  }

  /** The watch closed by a hand-over at a hub (slice 4), where nothing aboard asks for it any more. */
  handedOver(driverDid: string, now: number = Date.now()): TransportTelemetrySession | undefined {
    const s = this.openFor(driverDid);
    if (!s) return undefined;
    const v = this.fleet.vehicleForDriver(driverDid);
    const cargo = v ? this.cargoOf(driverDid, v.vehicleId) : undefined;
    if (cargo && (cargo.uitCodes.length || cargo.crossesCountries)) return s;
    return this.close(s, 'handed_over', now);
  }

  /* --------------------------------------------------------------- the fleet's own system -- */

  /** A fleet's vehicle by plate: the driver on a shift with it. */
  private driverByPlate(fleetDid: string, plate: string): { driverDid: string; vehicleId: string; plate: string } {
    const v = this.vehicles.list({ managerDid: fleetDid }).find((x) => plateKey(x.plate) === plateKey(plate));
    if (!v) throw new GlosError('NOT_FOUND', `No vehicle of yours has the plate ${plate}`);
    const a = this.fleet.list({ status: 'active' }).find((x) => x.vehicleId === v.vehicleId);
    if (!a) throw new GlosError('NOT_COUPLED', `${v.plate} is on no shift now: positions are kept for a vehicle on a shift`);
    return { driverDid: a.driverDid, vehicleId: v.vehicleId, plate: v.plate };
  }

  /** The UIT codes a fleet's system pulls for one of its vehicles (the brief's "active-uit"), and where its watch stands. */
  activeUit(fleetDid: string, plate: string, now: number = Date.now()): { plate: string; sessionId?: string; roStatus?: RoTransitStatusOrNone; uitCodes: TelemetryUit[] } {
    const { driverDid, plate: own } = this.driverByPlate(fleetDid, plate);
    const s = this.ensure(driverDid, now);
    return s ? { plate: own, sessionId: s.sessionId, roStatus: s.roStatus, uitCodes: s.uitCodes } : { plate: own, uitCodes: [] };
  }

  /** Positions a fleet's system pushes for one of its vehicles, by plate or by the watch's id: each kept as the app's are. */
  pushPings(fleetDid: string, body: { plate?: string; sessionId?: string; pings: Array<{ lat: number; lng: number; speedKmh?: number; heading?: number; recordedAt?: string }> }, now: number = Date.now()): { kept: number; sessionId?: string; roStatus?: RoTransitStatusOrNone } {
    let driverDid: string;
    if (body.sessionId) {
      const s = this.sessions.get(body.sessionId);
      if (!s || s.fleetDid !== fleetDid) throw new GlosError('NOT_FOUND', 'No watch of yours has that id');
      driverDid = s.driverDid;
    } else if (body.plate?.trim()) {
      driverDid = this.driverByPlate(fleetDid, body.plate).driverDid;
    } else {
      throw new GlosError('FIELD_REQUIRED', 'Say which vehicle: its plate, or the id of its watch', { field: 'plate' });
    }
    const provider = this.providerOf(fleetDid);
    const source: TelematicsProvider = provider === 'DRIVER_APP_GPS' ? 'CUSTOM_WEBHOOK' : provider;
    let last: TransportTelemetrySession | undefined;
    const sorted = [...body.pings].sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? ''));
    for (const p of sorted) last = this.ping(driverDid, p, source, now) ?? last;
    return { kept: last ? sorted.length : 0, ...(last ? { sessionId: last.sessionId, roStatus: last.roStatus } : {}) };
  }

  /**
   * The positions of a watch, for the carrier's registered GPS provider, in our own plain form: SeeBuyGet does not write ANAF's
   * fields until it has read ANAF's interface document (the formatter waits for it).
   */
  positions(driverDid: string, sessionId?: string): { format: 'sbg-telemetry-1'; session: TransportTelemetrySession; positions: Array<TelemetryPing & { plate: string; trailerPlate?: string; uitCodes: string[] }> } {
    const s = sessionId ? this.sessions.get(sessionId) : this.openFor(driverDid) ?? this.lastFor(driverDid);
    if (!s || s.driverDid !== driverDid) throw new GlosError('NOT_FOUND', 'No watch of this driver');
    const codes = s.uitCodes.map((c) => c.code);
    return { format: 'sbg-telemetry-1', session: s, positions: (this.pingLog.get(s.sessionId) ?? []).map((p) => ({ ...p, plate: s.plate, ...(s.trailerPlate ? { trailerPlate: s.trailerPlate } : {}), uitCodes: codes })) };
  }

  /** A watch by its id (the manifest names it; the note reads it). */
  get(sessionId: string): TransportTelemetrySession | undefined {
    return this.sessions.get(sessionId);
  }

  /** The watches that carried a load, newest first: for its consignment note's custody chain (slice 4). */
  forFreight(freightId: string): TransportTelemetrySession[] {
    return [...this.sessions.values()].filter((s) => s.uitCodes.some((c) => c.freightId === freightId)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /* ------------------------------------------------------------------------------ inside -- */

  private lastFor(driverDid: string): TransportTelemetrySession | undefined {
    return [...this.sessions.values()].filter((s) => s.driverDid === driverDid).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  }

  private lastPoint(sessionId: string): { lat: number; lng: number } | undefined {
    const log = this.pingLog.get(sessionId);
    const p = log?.[log.length - 1];
    return p ? { lat: p.lat, lng: p.lng } : undefined;
  }

  private close(s: TransportTelemetrySession, by: TelemetryClosedBy, now: number, at?: string): TransportTelemetrySession {
    const when = at ?? new Date(now).toISOString();
    const next: TransportTelemetrySession = { ...s, roStatus: 'COMPLETED', closedAt: when, closedBy: by, ...(by === 'left_romania' ? { leftRoAt: when } : {}), gaps: s.gaps.map((g) => (g.to ? g : { ...g, to: when, minutes: Math.round((Date.parse(when) - Date.parse(g.from)) / MIN) })) };
    this.sessions.set(s.sessionId, next);
    this.publish(GlosEvent.Pudo.TelematicsSessionClosed, next);
    return next;
  }

  /** A moment a position names, or now: never in the future, never before a day ago. */
  private momentOf(recordedAt: string | undefined, now: number): string {
    const t = recordedAt ? Date.parse(recordedAt) : NaN;
    if (Number.isNaN(t)) return new Date(now).toISOString();
    if (t > now + 5 * MIN) throw new GlosError('VALIDATION_FAILED', 'A position cannot be recorded in the future', { field: 'recordedAt' });
    if (t < now - DAY) throw new GlosError('VALIDATION_FAILED', 'A position older than a day is not kept', { field: 'recordedAt' });
    return new Date(t).toISOString();
  }

  /** What the vehicle carries, as the watch reads it: its loads' UIT codes, whether anything crosses countries or ends in Romania. */
  private cargoOf(driverDid: string, vehicleId: string): Cargo {
    const uitCodes: TelemetryUit[] = [];
    let crossesCountries = false;
    let deliversInRomania = false;
    const loads = this.dispatch.loadsOnVehicle(driverDid, vehicleId);
    for (const l of loads) {
      const f = this.dispatch.requireFreightPublic(l.freightId);
      if (f.pickupCountry && f.destCountry && f.pickupCountry !== f.destCountry) crossesCountries = true;
      if (f.destCountry === 'RO') deliversInRomania = true;
      for (const c of f.fiscalCodes ?? []) if (c.country === 'RO' && c.code) uitCodes.push({ code: c.code, freightId: f.freightId, freightCode: f.code, ...(c.validThrough ? { validThrough: c.validThrough } : {}) });
    }
    const bags = this.dispatch.bagsWith(driverDid);
    for (const b of bags) {
      const facts = this.dispatch.bagFacts(b.code);
      if (facts?.from && facts.to && facts.from !== facts.to) crossesCountries = true;
      if (facts?.to === 'RO') deliversInRomania = true;
    }
    return { uitCodes, crossesCountries, deliversInRomania, empty: loads.length === 0 && bags.length === 0 };
  }

  private publish(topic: string, s: TransportTelemetrySession, extra: Record<string, unknown> = {}): void {
    void this.events.publish(topic, { session: s, ...extra }, { source: 'pudo' }).catch(() => undefined);
  }
}

/** A watch's state, or none where no watch is open. */
type RoTransitStatusOrNone = TransportTelemetrySession['roStatus'];
