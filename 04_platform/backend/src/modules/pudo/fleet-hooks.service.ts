import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { MailService } from '../../foundation/mail/mail.service';
import { tryDelivery, type HookMessage } from '../../foundation/outbound/hook-delivery';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DepartureService } from './departure.service';
import type { Departure, DepartureBooking } from './departure.types';
import { DispatchService, fleetJobRowOf, type FleetJobRow } from './dispatch.service';
import type { FleetOrderRow, Freight } from './dispatch.types';
import { DriverService } from './driver.service';
import { FLEET_HOOK_EVENTS, FLEET_POSITION_EVENT, FLEET_POSITION_EVERY, type FleetHookEvent, type FleetPositionEvery, type FleetSystemCounts, type FleetSystemView, type PositionsToFleetSystem } from './fleet-hook.types';
import { CompanyKeyService } from './company-key.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetPlanService } from './fleet-plan.service';
import { FleetService } from './fleet.service';
import { PASSAGE_HOOK_EVENTS, type LoadPassageView } from './load-passage.types';
import { NotificationService } from './notification.service';
import { VehicleBreakdownService } from './vehicle-breakdown.service';
import { VehicleService } from './vehicle.service';

/** How often waiting messages are sent. A system waiting on "picked up" wants seconds, not minutes. */
const DRAIN_MS = Number(process.env.GLOS_CALLBACK_DRAIN_MS ?? 15_000);
/** At most once a day a fleet is told its system is not taking our messages (round 10, for every company: "The company, once a day"). */
const TELL_EVERY_MS = 24 * 3_600_000;

/** The manager acting for the fleet: its DID, and the name the act is recorded under. */
export interface ActingManager {
  fleetDid: string;
  name: string;
}

interface Positions {
  everyMin: FleetPositionEvery;
  setAt: string;
  setBy: string;
  delivered: number;
  notDelivered: number;
  lastDeliveredAt?: string;
  lastError?: string;
  lastErrorAt?: string;
}

interface SystemSettings {
  fleetDid: string;
  url?: string;
  setAt?: string;
  setBy?: string;
  secret: string;
  secretTurnedAt: string;
  secretTurnedBy?: string;
  /** Absent: where its vehicles are is not sent. */
  positions?: Positions;
}

interface FleetHookMessage extends HookMessage {
  fleetDid: string;
  /** When the last of its tries failed: what the once-a-day notice counts. */
  givenUpAt?: string;
}

/** Which of our events is which step of a load the fleet carries, and where the load is in it. */
const LOAD_TOPICS: ReadonlyArray<[string, FleetHookEvent, (p: Record<string, unknown>) => string | undefined]> = [
  [GlosEvent.Pudo.LoadClaimed, 'load.taken', (p) => (p.kind === 'freight' ? String(p.ref ?? '') : undefined)],
  [GlosEvent.Pudo.FreightAssigned, 'load.assigned', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightHandedBack, 'load.handed_back', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightPickedUp, 'load.picked_up', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightDeliveryFailed, 'load.delivery_failed', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightDelivered, 'load.delivered', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightCancelled, 'load.cancelled', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightClaimOpened, 'load.claim_opened', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightClaimDecided, 'load.claim_decided', (p) => String(p.freightId ?? '')],
];

/**
 * A FLEET'S OWN SYSTEM, TOLD OF ITS WORK (the user, round 11: the events recommended; the money on each load we pay it
 * for, "for the rest leave it out"; where its vehicles are is the fleet's own choice — "the decision is with them, we
 * facilitate" — and the driver is told; any manager sets it up, under their own name).
 *
 * WHAT IT HEARS: an order came in, changed, left its Orders, was cancelled; a load was put on a driver or taken, given
 * back, picked up, not handed over, delivered, withdrawn, a problem reported and decided; a vehicle broke down, how that
 * ended, its loads moved to another vehicle; a run booked, a booking given back, a run called off; the day's plan
 * accepted. Nothing about its drivers as people (scope-boundary-no-payroll): who is on the roster, who joined, who left.
 *
 * WHAT A MESSAGE CARRIES: exactly what the fleet's own app shows, and nothing more — an order as its Orders screen reads
 * it (DispatchService.ordersForFleet), a load as its Earnings screen reads it (fleetJobRowOf) with the money only where
 * we pay the fleet: an order or a run priced between a shipper and the fleet carries no price, because we never handle
 * that money (rule-quotations-not-payments). An order message is sent only when what the fleet sees of it changed.
 *
 * WHERE ITS VEHICLES ARE, only once a manager turns it on, at most every 1, 5 or 15 minutes a vehicle, only while a
 * driver is on a shift in it (as its map shows), and the driver is told in their app. A position is tried once and the
 * next replaces it: one two days late is no use to anybody. Counted, never listed.
 *
 * HOW: signed with the fleet's own secret (made with the first address, shown once, made again by any manager), tried
 * eight times over about two days (hook-delivery.ts), read back, sent again, a test. When some are given up the fleet
 * hears it in its bell and at its contact email, at most once a day. Network staff see counts and act in nobody's name.
 */
@Injectable()
export class FleetHookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FleetHookService.name);
  private readonly settings = new PersistentMap<string, SystemSettings>('fleet-hook-settings');
  private readonly outbox = new PersistentMap<string, FleetHookMessage>('fleet-hook-outbox');
  /** When each fleet was last told its system is down. */
  private readonly told = new PersistentMap<string, { at: string }>('fleet-hook-told');
  /** What each fleet's system was last told of an order, by order: so a change is said once, and an order that left is said to have. */
  private readonly seen = new PersistentMap<string, Record<string, string>>('fleet-hook-seen');
  /** The newest position of each vehicle, waiting for the next round; and when one was last queued. Neither outlives a restart. */
  private readonly positionsDue = new Map<string, FleetHookMessage>();
  private readonly lastQueued = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    private readonly events: EventBus,
    private readonly dispatch: DispatchService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly fleet: FleetService,
    private readonly vehicles: VehicleService,
    private readonly breakdowns: VehicleBreakdownService,
    private readonly departures: DepartureService,
    private readonly plans: FleetPlanService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly keyring?: CompanyKeyService,
  ) {}

  onModuleInit(): void {
    for (const [topic, event, freightOf] of LOAD_TOPICS) {
      this.events.subscribe<Record<string, unknown>>(topic, (e) => {
        const freightId = freightOf(e.payload ?? {});
        if (freightId) this.relayLoad(event, freightId, e.payload ?? {});
      });
    }
    // Round 14 — its driver said the load is at a border post, cleared it, or at a hub: the step goes with the load.
    this.events.subscribe<{ freightId?: string; passage?: LoadPassageView }>(GlosEvent.Pudo.FreightPassed, (e) => {
      const passage = e.payload?.passage;
      if (passage?.kind && PASSAGE_HOOK_EVENTS[passage.kind] && e.payload?.freightId) this.relayLoad(PASSAGE_HOOK_EVENTS[passage.kind], String(e.payload.freightId), { passage });
    });
    // Round 16 — one of its vehicles standing still away from any stop: the case, as its dashboard shows it.
    this.events.subscribe<{ fleetDid?: string; case?: Record<string, unknown> }>(GlosEvent.Pudo.VehicleStandingStill, (e) => {
      if (e.payload?.fleetDid && e.payload.case && this.settings.get(e.payload.fleetDid)?.url) this.enqueue(e.payload.fleetDid, 'vehicle.standing_still', { case: e.payload.case });
    });
    // Round 17 — the phone on one of its vehicles gone silent: the case, with where it was last heard.
    this.events.subscribe<{ fleetDid?: string; case?: Record<string, unknown> }>(GlosEvent.Pudo.VehicleGoneSilent, (e) => {
      if (e.payload?.fleetDid && e.payload.case && this.settings.get(e.payload.fleetDid)?.url) this.enqueue(e.payload.fleetDid, 'vehicle.gone_silent', { case: e.payload.case });
    });
    // Round 15 — a seal on a load it carries found broken on the road: the seal goes with the load.
    // Held by an authority on the road, as its driver said — and let go.
    this.events.subscribe<{ freightId?: string; held?: Record<string, unknown> }>(GlosEvent.Pudo.FreightHeld, (e) => {
      if (e.payload?.freightId) this.relayLoad('load.held', String(e.payload.freightId), { held: e.payload.held });
    });
    this.events.subscribe<{ freightId?: string; held?: Record<string, unknown> }>(GlosEvent.Pudo.FreightLetGo, (e) => {
      if (e.payload?.freightId) this.relayLoad('load.let_go', String(e.payload.freightId), { held: e.payload.held });
    });
    this.events.subscribe<{ freightId?: string; seal?: Record<string, unknown> }>(GlosEvent.Pudo.FreightSealBroken, (e) => {
      if (e.payload?.freightId) this.relayLoad('load.seal_broken', String(e.payload.freightId), { seal: e.payload.seal });
    });
    // Round 25 — a load it carries whose cold chain broke on the road: the reading goes with the load.
    this.events.subscribe<{ freightId?: string; reading?: Record<string, unknown> }>(GlosEvent.Pudo.FreightTempBreach, (e) => {
      if (e.payload?.freightId) this.relayLoad('load.cold_chain_broken', String(e.payload.freightId), { reading: e.payload.reading });
    });
    const orders =(ids: unknown) => this.syncOrders((Array.isArray(ids) ? ids : [ids]).filter((x): x is string => typeof x === 'string' && Boolean(x)));
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.OrderPlaced, (e) => orders(e.payload?.freightId));
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.OrderChanged, (e) => orders(e.payload?.freightId));
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightInstructed, (e) => orders(e.payload?.freightId));
    // Released to the open board: the order is no longer the office's to plan.
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightPosted, (e) => orders(e.payload?.freightId));
    this.events.subscribe<{ freightIds?: string[] }>(GlosEvent.Pudo.OrderHandedOn, (e) => orders(e.payload?.freightIds ?? []));
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.OrderSplit, (e) => orders(this.loadsOfOrder(e.payload?.freightId)));
    this.events.subscribe<{ fleetDid: string; day: string }>(GlosEvent.Pudo.DayPlanAccepted, (e) => this.relayPlan(e.payload?.fleetDid, e.payload?.day));
    this.events.subscribe<{ fleetDid?: string; breakdown?: { breakdownId?: string } }>(GlosEvent.Pudo.VehicleBrokeDown, (e) => this.relayBreakdown('vehicle.broke_down', e.payload?.fleetDid, e.payload?.breakdown?.breakdownId));
    this.events.subscribe<{ fleetDid?: string; breakdown?: { breakdownId?: string } }>(GlosEvent.Pudo.VehicleBreakdownResolved, (e) => this.relayBreakdown('vehicle.breakdown_ended', e.payload?.fleetDid, e.payload?.breakdown?.breakdownId));
    this.events.subscribe<{ fleetDid?: string; breakdownId?: string; reloadedFreightIds?: string[] }>(GlosEvent.Pudo.VehicleLoadsHandedOver, (e) => {
      this.relayBreakdown('vehicle.loads_moved', e.payload?.fleetDid, e.payload?.breakdownId);
      // Its orders are on another truck, with another driver, now.
      orders(e.payload?.reloadedFreightIds ?? []);
    });
    this.events.subscribe<{ departureId: string; bookingId: string; managerDid: string }>(GlosEvent.Pudo.DepartureBooked, (e) => this.relayRun('run.booked', e.payload?.managerDid, e.payload?.departureId, e.payload?.bookingId));
    this.events.subscribe<{ departureId: string; bookingId: string; managerDid: string }>(GlosEvent.Pudo.DepartureBookingCancelled, (e) => this.relayRun('run.booking_cancelled', e.payload?.managerDid, e.payload?.departureId, e.payload?.bookingId));
    this.events.subscribe<{ departureId: string; managerDid: string }>(GlosEvent.Pudo.DepartureCancelled, (e) => this.relayRun('run.cancelled', e.payload?.managerDid, e.payload?.departureId));
    this.events.subscribe<{ driverDid: string; location: { lat: number; lng: number } }>(GlosEvent.Pudo.DriverMoved, (e) => this.queuePosition(e.payload?.driverDid, e.payload?.location));
    this.timer = setInterval(() => void this.drain(), DRAIN_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ---------------------------------------------------------- what is sent -- */

  /**
   * One step of a load, to each fleet that sees it: as an order under its contracts, or as a load taken for it. A load
   * the office put on a driver is said once, as put on a driver — not also as taken. A load withdrawn that is one of its
   * orders is an order cancelled. One given back is told to the fleet it was given back for, which no longer carries it.
   */
  relayLoad(event: FleetHookEvent, freightId: string, payload: Record<string, unknown> = {}): void {
    const f = this.freight(freightId);
    if (!f) return;
    if (event === 'load.taken' && f.assignedBy && f.assignedBy.at === f.claimedAt) return;
    const backFor = event === 'load.handed_back' ? f.handBacks?.[f.handBacks.length - 1] : undefined;
    for (const fleetDid of this.fleetsOf(f, backFor?.carrierDid)) {
      if (!this.settings.get(fleetDid)?.url) continue;
      const order = this.orderOf(fleetDid, freightId);
      const load = this.loadOf(fleetDid, f);
      const handBack =
        backFor && backFor.carrierDid === fleetDid
          ? { freightId, code: f.code, driverDid: backFor.driverDid, ...(typeof payload.driverName === 'string' ? { driverName: payload.driverName } : {}), reason: backFor.reason, at: backFor.at }
          : undefined;
      if (!order && !load && !handBack) continue;
      const passage = payload.passage && typeof payload.passage === 'object' ? payload.passage : undefined;
      const seal = payload.seal && typeof payload.seal === 'object' ? payload.seal : undefined;
      const reading = payload.reading && typeof payload.reading === 'object' ? payload.reading : undefined;
      this.enqueue(fleetDid, event === 'load.cancelled' && order ? 'order.cancelled' : event, { ...(order ? { order } : {}), ...(load ? { load } : {}), ...(handBack ? { handBack } : {}), ...(passage ? { passage } : {}), ...(seal ? { seal } : {}), ...(reading ? { reading } : {}) });
      if (order) this.remember(freightId, fleetDid, order);
    }
  }

  /**
   * Orders whose row may have changed: each fleet that sees one hears it came in (the first its system hears of it),
   * that what it shows changed, or — a fleet that saw it and no longer does — that it left its Orders.
   */
  syncOrders(freightIds: string[]): void {
    for (const freightId of new Set(freightIds)) {
      const f = this.freight(freightId);
      if (!f) continue;
      for (const fleetDid of this.fleetsOf(f)) {
        if (!this.settings.get(fleetDid)?.url) continue;
        const before = this.seen.get(freightId)?.[fleetDid];
        const order = this.orderOf(fleetDid, freightId);
        if (!order) {
          if (before !== undefined) {
            this.enqueue(fleetDid, 'order.removed', { order: { freightId, code: f.code } });
            this.forget(freightId, fleetDid);
          }
          continue;
        }
        if (before === undefined) this.enqueue(fleetDid, 'order.received', { order });
        else if (before !== hashOf(order)) this.enqueue(fleetDid, 'order.changed', { order });
        this.remember(freightId, fleetDid, order);
      }
    }
  }

  /** The day's plan as the office accepted it. Its orders' rows now carry their trucks; the plan said so, so they are not said again. */
  relayPlan(fleetDid: string | undefined, day: string | undefined): void {
    if (!fleetDid || !day || !this.settings.get(fleetDid)?.url) return;
    const plan = this.plans.state(fleetDid, day).plan;
    if (!plan) return;
    this.enqueue(fleetDid, 'plan.accepted', { plan });
    const placed = [...plan.routes.flatMap((r) => r.trips.flatMap((t) => t.stops.map((s) => s.freightId))), ...plan.unplanned.map((u) => u.freightId)];
    for (const freightId of placed) {
      if (this.seen.get(freightId)?.[fleetDid] === undefined) continue;
      const order = this.orderOf(fleetDid, freightId);
      if (order) this.remember(freightId, fleetDid, order);
    }
  }

  /** A breakdown of one of its vehicles, as its own screen reads it: what was aboard, who took what over, how it ended. */
  relayBreakdown(event: FleetHookEvent, fleetDid: string | undefined, breakdownId: string | undefined): void {
    if (!fleetDid || !breakdownId || !this.settings.get(fleetDid)?.url) return;
    const breakdown = this.breakdowns.viewOf(breakdownId);
    if (!breakdown || this.vehicleFleet(breakdown.vehicleId) !== fleetDid) return;
    this.enqueue(fleetDid, event, { breakdown });
  }

  /**
   * One of its runs, and the booking concerned: what, how much, for whom, where it stands. Never the price: a run is the
   * fleet's own price, settled between it and the shipper, and we never hold that money.
   */
  relayRun(event: FleetHookEvent, fleetDid: string | undefined, departureId: string | undefined, bookingId?: string): void {
    if (!fleetDid || !departureId || !this.settings.get(fleetDid)?.url) return;
    const run = this.departures.forFleet(fleetDid).find((d) => d.departureId === departureId);
    if (!run) return;
    const booking = bookingId ? run.bookings.find((b) => b.bookingId === bookingId) : undefined;
    this.enqueue(fleetDid, event, { run: runOf(run), ...(booking ? { booking: bookingOf(booking) } : {}) });
  }

  /**
   * Where a vehicle is, for a fleet that turned it on: while a driver is on a shift in it, at most once in the minutes the
   * fleet chose. Only the newest waits to be sent.
   */
  queuePosition(driverDid: string | undefined, location: { lat: number; lng: number } | undefined, now: number = Date.now()): void {
    if (!driverDid || !location) return;
    const driver = this.driver(driverDid);
    const fleetDid = driver?.managerDid;
    if (!driver || !fleetDid) return;
    const s = this.settings.get(fleetDid);
    if (!s?.url || !s.positions) return;
    const shift = this.fleet.activeForDriver(driverDid);
    if (!shift) return;
    const key = `${fleetDid}|${shift.vehicleId}`;
    const last = this.lastQueued.get(key);
    if (last !== undefined && now - last < s.positions.everyMin * 60_000) return;
    let v;
    try {
      v = this.vehicles.get(shift.vehicleId);
    } catch {
      return;
    }
    this.lastQueued.set(key, now);
    const at = new Date(now).toISOString();
    const message = this.message(fleetDid, s, FLEET_POSITION_EVENT, { position: { plate: v.plate, vehicleClass: v.vehicleClass, driverName: driver.displayName, location: { lat: location.lat, lng: location.lng }, at } }, now, 'fp');
    this.positionsDue.set(key, message);
  }

  private enqueue(fleetDid: string, event: string, data: Record<string, unknown>, now: number = Date.now()): FleetHookMessage | undefined {
    const s = this.settings.get(fleetDid);
    if (!s?.url) return undefined;
    const message = this.message(fleetDid, s, event, data, now, 'fh');
    this.outbox.set(message.id, message);
    return message;
  }

  private message(fleetDid: string, s: SystemSettings, event: string, data: Record<string, unknown>, now: number, prefix: string): FleetHookMessage {
    const at = new Date(now).toISOString();
    const body = JSON.stringify({ event, data, at });
    return { id: `${prefix}_${randomBytes(6).toString('hex')}`, fleetDid, url: s.url!, event, signature: sign(s.secret, body), body, at, state: 'pending', attempts: 0, nextTryAt: at };
  }

  /** Send what is due, and the newest positions; then tell a fleet whose system has stopped taking them. Serial, and never throws. */
  async drain(now: number = Date.now()): Promise<{ sent: number; failed: number }> {
    if (this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    let sent = 0;
    let failed = 0;
    try {
      const due = [...this.outbox.values()].filter((m) => m.state === 'pending' && Date.parse(m.nextTryAt) <= now);
      for (const message of due) {
        const after = await tryDelivery(message, now);
        if (after.state === 'delivered') sent += 1;
        if (after.state === 'failed') {
          after.givenUpAt = new Date(now).toISOString();
          failed += 1;
        }
        this.outbox.set(after.id, after);
      }
      await this.sendPositions(now);
      await this.tellWhenDown(now);
    } catch (err) {
      this.logger.warn(`fleet messages: ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
    return { sent, failed };
  }

  /** Each waiting position, tried once: the next one replaces one that did not arrive. */
  private async sendPositions(now: number): Promise<void> {
    const due = [...this.positionsDue.entries()];
    this.positionsDue.clear();
    for (const [, message] of due) {
      const after = await tryDelivery(message, now);
      const s = this.settings.get(message.fleetDid);
      if (!s?.positions) continue;
      const p = { ...s.positions };
      if (after.state === 'delivered') {
        p.delivered += 1;
        p.lastDeliveredAt = new Date(now).toISOString();
      } else {
        p.notDelivered += 1;
        p.lastError = after.lastError;
        p.lastErrorAt = new Date(now).toISOString();
      }
      this.settings.set(message.fleetDid, { ...s, positions: p });
    }
  }

  /**
   * ONCE A DAY AT MOST: a fleet with messages given up since it was last told hears it in its bell, and at its contact
   * email, with where to send them again. Positions are not counted: each is tried once by design.
   */
  async tellWhenDown(now: number = Date.now()): Promise<number> {
    const byFleet = new Map<string, FleetHookMessage[]>();
    for (const m of this.outbox.values()) {
      if (m.state !== 'failed' || !m.givenUpAt) continue;
      const last = this.told.get(m.fleetDid)?.at;
      if (last && m.givenUpAt <= last) continue;
      byFleet.set(m.fleetDid, [...(byFleet.get(m.fleetDid) ?? []), m]);
    }
    let told = 0;
    for (const [fleetDid, given] of byFleet) {
      const last = this.told.get(fleetDid)?.at;
      if (last && now - Date.parse(last) < TELL_EVERY_MS) continue;
      const fleet = this.fleetRecord(fleetDid);
      if (!fleet) continue;
      this.told.set(fleetDid, { at: new Date(now).toISOString() });
      told += 1;
      const since = given.map((m) => m.at).sort()[0];
      const count = given.length;
      try {
        await this.notifications?.notify(fleetDid, {
          kind: 'system_down',
          title: 'Your system is not taking our messages',
          body: `${count === 1 ? 'A message' : `${count} messages`} about your work ${count === 1 ? 'was' : 'were'} given up after two days of tries. Put your system right, then send ${count === 1 ? 'it' : 'them'} again under Your system.`,
          link: '/',
          data: { count, since },
        });
      } catch (err) {
        this.logger.warn(`system_down notice failed for ${fleetDid}: ${(err as Error).message}`);
      }
      if (fleet.contactEmail) void this.mail?.send('fleet-system-down', { address: fleet.contactEmail, name: fleet.companyName }, { fleet: fleet.companyName, count, since });
    }
    return told;
  }

  /* ------------------------------------------------------- what the fleet does -- */

  /** What its system is told, and what became of each message — any manager reads it. */
  view(fleetDid: string, extra: { secret?: string } = {}): FleetSystemView {
    const s = this.settings.get(fleetDid);
    return {
      ...(s?.url ? { url: s.url, setAt: s.setAt, ...(s.setBy ? { setBy: s.setBy } : {}) } : {}),
      hasSecret: Boolean(s?.secret),
      ...(s?.secretTurnedAt ? { secretTurnedAt: s.secretTurnedAt } : {}),
      ...(s?.secretTurnedBy ? { secretTurnedBy: s.secretTurnedBy } : {}),
      ...extra,
      events: [...FLEET_HOOK_EVENTS, ...(s?.positions ? [FLEET_POSITION_EVENT] : [])],
      ...(s?.positions ? { positions: { ...s.positions } } : {}),
      messages: [...this.outbox.values()]
        .filter((m) => m.fleetDid === fleetDid)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100)
        .map(({ id, event, at, state, attempts, nextTryAt, deliveredAt, lastError, resent, body }) => ({ id, event, at, state, attempts, nextTryAt, body, ...(deliveredAt ? { deliveredAt } : {}), ...(lastError ? { lastError } : {}), ...(resent ? { resent } : {}) })),
    };
  }

  /**
   * Where its system is told — any manager's act, recorded under their name. The first address makes the fleet's signing
   * secret, shown in this answer and never again. Empty stops the messages; the secret stays.
   */
  setAddress(acting: ActingManager, raw: string, now: number = Date.now()): FleetSystemView {
    const url = String(raw ?? '').trim();
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new GlosError('INVALID_INPUT', 'Give the full address of your system, starting with https://', { field: 'url' });
    const at = new Date(now).toISOString();
    const before = this.settings.get(acting.fleetDid);
    const secret = before?.secret ?? newSecret();
    const next: SystemSettings = {
      fleetDid: acting.fleetDid,
      secret,
      secretTurnedAt: before?.secretTurnedAt ?? at,
      ...(before?.secretTurnedBy ? { secretTurnedBy: before.secretTurnedBy } : before ? {} : { secretTurnedBy: acting.name }),
      ...(url ? { url, setAt: at, setBy: acting.name } : {}),
      // Stopping the messages stops the positions with them; giving an address again does not turn them back on by itself.
      ...(url && before?.positions ? { positions: before.positions } : {}),
    };
    this.settings.set(acting.fleetDid, next);
    return this.view(acting.fleetDid, before ? {} : { secret });
  }

  /** A new signing secret, shown in this answer and never again — any manager's, under their name. */
  turnSecret(acting: ActingManager, now: number = Date.now()): FleetSystemView {
    const before = this.settings.get(acting.fleetDid);
    const secret = newSecret();
    this.settings.set(acting.fleetDid, { ...(before ?? { fleetDid: acting.fleetDid }), fleetDid: acting.fleetDid, secret, secretTurnedAt: new Date(now).toISOString(), secretTurnedBy: acting.name });
    return this.view(acting.fleetDid, { secret });
  }

  /** Where its vehicles are: off (0), or at most every 1, 5 or 15 minutes a vehicle. The fleet's own choice, under the manager's name. */
  setPositions(acting: ActingManager, everyMin: number, now: number = Date.now()): FleetSystemView {
    const s = this.settings.get(acting.fleetDid);
    if (everyMin !== 0 && !(FLEET_POSITION_EVERY as readonly number[]).includes(everyMin)) throw new GlosError('INVALID_INPUT', `Every ${FLEET_POSITION_EVERY.join(', ')} minutes, or 0 for off`, { field: 'everyMin' });
    if (everyMin && !s?.url) throw new GlosError('INVALID_STATE', 'Give your system’s address first');
    if (!s) return this.view(acting.fleetDid);
    const next: SystemSettings = { ...s };
    if (!everyMin) delete next.positions;
    else next.positions = { ...(s.positions ?? { delivered: 0, notDelivered: 0 }), everyMin: everyMin as FleetPositionEvery, setAt: new Date(now).toISOString(), setBy: acting.name };
    this.settings.set(acting.fleetDid, next);
    if (!everyMin) for (const key of [...this.positionsDue.keys()]) if (key.startsWith(`${acting.fleetDid}|`)) this.positionsDue.delete(key);
    return this.view(acting.fleetDid);
  }

  /** A message that says only that it is a test. */
  async test(acting: ActingManager): Promise<FleetSystemView['messages'][number]> {
    const sent = this.enqueue(acting.fleetDid, 'test', { message: 'A test message from SeeBuyGet. Verify its signature with your secret; then your system can read ours.' });
    if (!sent) throw new GlosError('INVALID_STATE', 'Give your system’s address first');
    await this.drain();
    return this.messageView(acting.fleetDid, sent.id);
  }

  /** One sent again: the SAME message (its id, its body) to the address and with the secret the fleet has now, with a fresh round of tries. */
  async resend(acting: ActingManager, messageId: string, now: number = Date.now()): Promise<FleetSystemView['messages'][number]> {
    const message = this.outbox.get(messageId);
    if (!message || message.fleetDid !== acting.fleetDid) throw new GlosError('NOT_FOUND', 'No such message');
    const s = this.settings.get(acting.fleetDid);
    if (!s?.url) throw new GlosError('INVALID_STATE', 'Give your system’s address first');
    const again: FleetHookMessage = { ...message, url: s.url, signature: sign(s.secret, message.body), state: 'pending', attempts: 0, nextTryAt: new Date(now).toISOString(), resent: (message.resent ?? 0) + 1 };
    delete again.lastError;
    delete again.givenUpAt;
    this.outbox.set(again.id, again);
    await this.drain();
    return this.messageView(acting.fleetDid, messageId);
  }

  /** For network staff: how its messages stand, counted. */
  counts(fleetDid: string): FleetSystemCounts {
    const mine = [...this.outbox.values()].filter((m) => m.fleetDid === fleetDid);
    const s = this.settings.get(fleetDid);
    return {
      hasAddress: Boolean(s?.url),
      delivered: mine.filter((m) => m.state === 'delivered').length,
      waiting: mine.filter((m) => m.state === 'pending').length,
      givenUp: mine.filter((m) => m.state === 'failed').length,
      positions: Boolean(s?.url && s.positions),
      ...(this.keyring ? { keys: this.keyring.counts({ kind: 'fleet', id: fleetDid }) } : {}),
    };
  }

  /** For the driver on a shift: their fleet's own system is told where they are, and how often. Absent otherwise. */
  positionsTo(driverDid: string): PositionsToFleetSystem | undefined {
    const fleetDid = this.driver(driverDid)?.managerDid;
    const s = fleetDid ? this.settings.get(fleetDid) : undefined;
    if (!fleetDid || !s?.url || !s.positions || !this.fleet.activeForDriver(driverDid)) return undefined;
    return { fleetName: this.fleetRecord(fleetDid)?.companyName ?? '', everyMin: s.positions.everyMin };
  }

  /* --------------------------------------------------------------- reading -- */

  /** Every fleet that may see this load: the one it was ordered from, its partners on it, the one carrying it, any that saw it. */
  private fleetsOf(f: Freight, alsoDid?: string): Set<string> {
    const h = f.handOn;
    const dids = [
      f.contract?.fleetDid,
      h?.partner?.fleetDid,
      h?.via?.fleetDid,
      ...(h?.offeredTo ?? []).map((p) => p.fleetDid),
      ...(h?.onward?.offeredTo ?? []).map((p) => p.fleetDid),
      this.dispatch.carrierOf(f),
      alsoDid,
      ...Object.keys(this.seen.get(f.freightId) ?? {}),
    ];
    return new Set(dids.filter((d): d is string => Boolean(d)));
  }

  /** The order exactly as this fleet's Orders screen reads it, or nothing when it is not there. */
  private orderOf(fleetDid: string, freightId: string): FleetOrderRow | undefined {
    return this.dispatch.ordersForFleet(fleetDid).find((r) => r.freightId === freightId);
  }

  /**
   * The load as this fleet's Earnings screen reads it, where it was taken for this fleet. The money stays on it only where
   * we pay the fleet; on a load settled between the shipper and the fleet it is left out (round 11).
   */
  private loadOf(fleetDid: string, f: Freight): Partial<FleetJobRow> | undefined {
    if (!f.claimedBy || this.dispatch.carrierOf(f) !== fleetDid) return undefined;
    return earningsRowFor(f, (did) => this.driver(did)?.displayName ?? '');
  }

  /** Whether the fleet sends where its vehicles are to its own system: its choice, and so what its key may read of them too. */
  positionsOn(fleetDid: string): boolean {
    const s = this.settings.get(fleetDid);
    return Boolean(s?.url && s.positions);
  }

  /** Every load of the order this one belongs to, and any load of it put back together that a fleet's system was told of. */
  private loadsOfOrder(freightId: string | undefined): string[] {
    if (!freightId) return [];
    const loads = this.dispatch.loadsOf(freightId).map((f) => f.freightId);
    const root = this.freight(freightId)?.partOf?.rootId ?? freightId;
    const rejoined = [...this.seen.keys()].filter((id) => this.freight(id)?.rejoinedInto === root);
    return [...loads, ...rejoined];
  }

  private remember(freightId: string, fleetDid: string, order: FleetOrderRow): void {
    this.seen.set(freightId, { ...(this.seen.get(freightId) ?? {}), [fleetDid]: hashOf(order) });
  }

  private forget(freightId: string, fleetDid: string): void {
    const rest = { ...(this.seen.get(freightId) ?? {}) };
    delete rest[fleetDid];
    if (Object.keys(rest).length) this.seen.set(freightId, rest);
    else this.seen.delete(freightId);
  }

  private freight(freightId: string): Freight | undefined {
    try {
      return this.dispatch.requireFreightPublic(freightId);
    } catch {
      return undefined;
    }
  }

  private driver(did: string): { displayName: string; managerDid?: string } | undefined {
    try {
      return this.drivers.get(did);
    } catch {
      return undefined;
    }
  }

  private fleetRecord(fleetDid: string): { companyName: string; contactEmail?: string } | undefined {
    try {
      return this.managers.get(fleetDid);
    } catch {
      return undefined;
    }
  }

  private vehicleFleet(vehicleId: string): string | undefined {
    try {
      return this.vehicles.get(vehicleId).managerDid;
    } catch {
      return undefined;
    }
  }

  private messageView(fleetDid: string, id: string): FleetSystemView['messages'][number] {
    const found = this.view(fleetDid).messages.find((m) => m.id === id);
    if (!found) throw new GlosError('NOT_FOUND', 'No such message');
    return found;
  }
}

/**
 * A load as the fleet's Earnings screen reads it, with the money only where we pay the fleet: on a load settled between the
 * shipper and the fleet it is left out (round 11). What its system is told, and what its key reads back (round 12).
 */
export function earningsRowFor(f: Freight, nameOf: (did: string) => string): Partial<FleetJobRow> {
  const row: Partial<FleetJobRow> = fleetJobRowOf(f, nameOf);
  if (row.direct) {
    delete row.earning;
    delete row.currency;
    delete row.paid;
    delete row.clawback;
  }
  return row;
}

/** A run as its Runs screen reads it, without the money: the price is the fleet's own, between it and the shipper. */
function runOf(d: Departure): Record<string, unknown> {
  const booked = d.bookings.filter((b) => b.status !== 'cancelled');
  return {
    departureId: d.departureId,
    lineName: d.lineName,
    originZone: d.originZone,
    destZone: d.destZone,
    leavesAt: d.leavesAt,
    status: d.status,
    plate: d.plate,
    vehicleClass: d.vehicleClass,
    ...(d.driverName ? { driverName: d.driverName } : {}),
    capacityKg: d.capacityKg,
    bookedKg: Math.round(booked.reduce((s, b) => s + b.weightKg, 0) * 100) / 100,
    ...(d.departedAt ? { departedAt: d.departedAt } : {}),
    ...(d.cancellation ? { cancellation: { reason: d.cancellation.reason, ...(d.cancellation.note ? { note: d.cancellation.note } : {}), at: d.cancellation.at } } : {}),
  };
}

/** One booking on a run as the fleet reads it, without its price. */
function bookingOf(b: DepartureBooking): Record<string, unknown> {
  return {
    bookingId: b.bookingId,
    kind: b.kind,
    status: b.status,
    description: b.description,
    weightKg: b.weightKg,
    units: b.units,
    at: b.at,
    ...(b.bookedByName ? { bookedByName: b.bookedByName } : {}),
    ...(b.onBehalfOf ? { onBehalfOf: b.onBehalfOf } : {}),
    ...(b.customer ? { customer: b.customer } : {}),
    ...(b.freightId ? { freightId: b.freightId } : {}),
    ...(b.cancellation ? { cancellation: { ...b.cancellation } } : {}),
    ...(b.deliveredAt ? { deliveredAt: b.deliveredAt } : {}),
  };
}

function hashOf(order: FleetOrderRow): string {
  return createHash('sha256').update(JSON.stringify(order)).digest('hex').slice(0, 20);
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}
