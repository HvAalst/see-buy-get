import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { FleetService } from './fleet.service';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isDay } from './carriage-contract.service';
import { DEFAULT_PLAN_PARAMS, clockOf, planDay, type PlanOrder, type PlanTruck } from './day-plan';
import { windowOf, windowWords, type DayWindow } from './delivery-window';
import { DispatchService } from './dispatch.service';
import { Freight } from './dispatch.types';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetRosterService } from './fleet-roster.service';
import { DEFAULT_DAY_START, DayPlanState, DayPlanView, PlanLeftView, PlanRouteView, PlanRuleView, PlanSendResult, PlanSendTruck, PlanSettings, PlannedOn } from './fleet-plan.types';
import { ROAD_MATRIX, type RoadDistances, type RoadMatrix } from './road-matrix';
import { ROUTER, Router } from './router';
import { VehicleService } from './vehicle.service';

/** A fleet's own planning day starts at DEFAULT_DAY_START where it has not said otherwise. The solver's defaults for the rest. */
export const DEFAULT_DAY_HOURS = 10;
/** No plan asks a driver for more than this, whatever the office types: the shift limit is the law's, not the plan's. */
export const MAX_DAY_HOURS = 13;

export interface PlanAsk {
  day: string;
  /** Vehicles the office leaves out of this plan: in the workshop, promised elsewhere. */
  excludeVehicleIds?: string[];
  dayStart?: string;
  dayHours?: number;
  speedKmh?: number;
  loadMin?: number;
  unloadMin?: number;
  /** P5 — keep this order off this vehicle. */
  keepOff?: PlanPair[];
  /** P5 — this order goes on this vehicle, or on none. */
  putOn?: PlanPair[];
}

export interface PlanPair {
  freightId: string;
  vehicleId: string;
}

/** The most rules one plan carries. A day's exceptions, not a second plan written by hand. */
export const MAX_PLAN_RULES = 200;

/**
 * P3 — A FLEET'S PLAN FOR A DAY: the orders it must deliver, on the trucks it has.
 *
 * The user, 2026-10-05: the manager plans tomorrow from around midday, to know "whether they need to hire external
 * drivers/trucks", and to send "trucks that have unloaded" on to their next goods. This gathers what the math needs —
 * the day's orders still without a truck, the fleet's trucks that are fit to go out, how many drivers there are to
 * send, where the depot is — runs it, and puts names back on the answer.
 *
 * A PROPOSAL is worked out fresh each time it is asked for and changes nothing. ACCEPTING one works it out again on
 * the server (what is accepted is never what a screen sent back), keeps it as the day's plan — a record from then on,
 * not recomputed — and writes on each order which truck and which trip it is planned on.
 *
 * SENDING IT OUT (P3b). An order goes on a truck while its driver is on a shift, and a truck is given ONE trip at a
 * time — what it can carry at once. So on its own day the plan is sent trip by trip: a truck's first trip when its
 * driver starts a shift in it, its next when the driver has handed over the last of the one before. Each order goes
 * through the same door a dispatcher uses, with every check that door has; one that is refused stays in the queue,
 * marked with the refusal in its own words. The office can also send the next trips by hand.
 */
@Injectable()
export class FleetPlanService implements OnModuleInit {
  private readonly accepted = new PersistentMap<string, DayPlanView>('fleet-day-plans');

  constructor(
    private readonly dispatch: DispatchService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    @Inject(ROUTER) private readonly router: Router,
    private readonly fleet: FleetService,
    private readonly events: EventBus,
    // Where real road distances come from, when the operator has a routing server. Without one a plan is the estimate it always was.
    @Optional() @Inject(ROAD_MATRIX) private readonly roads?: RoadMatrix,
    // Who drives on the day, where the office has said. Without it a plan counts every active driver, as it always did.
    @Optional() private readonly roster?: FleetRosterService,
  ) {}

  /**
   * The two moments a truck is ready for its next trip: a driver has just started a shift in it, and a driver has just
   * handed over a load. Neither may fail the act it follows — a shift starts and a delivery stands whatever the plan
   * can or cannot do next.
   */
  onModuleInit(): void {
    this.events.subscribe<{ driverDid: string; vehicleId: string }>(GlosEvent.Pudo.DriverCoupled, (e) => this.quietly(() => this.onTruckReady(e.payload.vehicleId)));
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightDelivered, (e) => this.quietly(() => this.onTruckReady(this.dispatch.planOf(e.payload.freightId)?.vehicleId)));
  }

  private quietly(fn: () => void): void {
    try {
      fn();
    } catch {
      /* the plan could not move on by itself; the office still can, and is shown why on the orders */
    }
  }

  /** A truck is ready: if today's accepted plan has a trip waiting for it, that trip goes out. */
  private onTruckReady(vehicleId: string | undefined, now: number = Date.now()): void {
    if (!vehicleId) return;
    const managerDid = this.vehicles.get(vehicleId).managerDid;
    if (!managerDid) return;
    // Today on the fleet's own clock: a shift that starts at 01:00 in Nairobi starts on that day's plan, not on yesterday's.
    const today = this.managers.todayOf(managerDid, now);
    const plan = this.accepted.get(keyOf(managerDid, today));
    if (!plan?.routes.some((r) => r.vehicleId === vehicleId)) return;
    this.sendNext(managerDid, today, vehicleId, plan, now);
  }

  /**
   * A PROPOSAL ON ROAD DISTANCES. The same plan as `propose`, with every leg measured by road where the operator has
   * a routing server (the user, 2026-10-06: "OSRM-compatible server"): the day's places — the depot, each collection
   * point, each door that has a point — are asked about ONCE, before the math runs, and the math then looks each leg
   * up. A bad ask is refused before anybody is asked anything. Whatever comes back, there is a plan: where the
   * routing server gives nothing, it is the estimate, and the plan says so and why.
   */
  async proposeRouted(fleetDid: string, ask: PlanAsk, now: number = Date.now()): Promise<DayPlanView> {
    this.checked(fleetDid, ask, now);
    return this.propose(fleetDid, ask, now, await this.distancesFor(fleetDid, ask.day));
  }

  /** Accept a plan made on road distances: worked out again here, on distances asked for again here. */
  async acceptRouted(fleetDid: string, ask: PlanAsk, by: string, now: number = Date.now()): Promise<DayPlanView> {
    this.checked(fleetDid, ask, now);
    return this.accept(fleetDid, ask, by, now, await this.distancesFor(fleetDid, ask.day));
  }

  /** The distances between every place of a fleet's day. Coordinates are all that is asked about. */
  private async distancesFor(fleetDid: string, day: string): Promise<RoadDistances | undefined> {
    if (!this.roads) return undefined;
    const depot = this.managers.get(fleetDid).location;
    const places = this.dispatch.contractOrdersForDay(fleetDid, day).filter((f) => f.destLocation).flatMap((f) => [f.pickupLocation, f.destLocation!]);
    return this.roads.between([depot, ...places]);
  }

  /** What a plan is asked with, checked: its settings within their limits, its day a day that has not gone — on the fleet's own clock. */
  private checked(fleetDid: string, ask: PlanAsk, now: number): PlanSettings {
    const settings = this.settingsOf(ask);
    const today = this.managers.todayOf(fleetDid, now);
    if (!isDay(ask.day)) throw new GlosError('INVALID_INPUT', 'A day is YYYY-MM-DD', { field: 'day' });
    if (ask.day < today) throw new GlosError('INVALID_INPUT', 'That day has gone — a plan is for today or later', { field: 'day' });
    return settings;
  }

  propose(fleetDid: string, ask: PlanAsk, now: number = Date.now(), roads?: RoadDistances): DayPlanView {
    const settings = this.checked(fleetDid, ask, now);
    const manager = this.managers.get(fleetDid);
    const orders = this.dispatch.contractOrdersForDay(fleetDid, ask.day);
    const excluded = new Set(ask.excludeVehicleIds ?? []);

    const fleet = this.vehicles
      .list({ managerDid: fleetDid })
      .sort((a, b) => b.capacityKg - a.capacityKg || a.plate.localeCompare(b.plate))
      .map((v) => {
        // Off the road for a reason of its own. Where the register gives none, it still does not go out — and says so.
        // Asked for the plan's own day: a truck in the workshop tomorrow is not planned for tomorrow.
        const reasons = this.vehicles.isUsable(v.vehicleId, now, ask.day) ? [] : this.vehicles.offRoadReasons(v.vehicleId, now, ask.day);
        const offRoad = this.vehicles.isUsable(v.vehicleId, now, ask.day) ? [] : [...(v.status !== 'ACTIVE' ? [`Marked ${v.status.toLowerCase()}`] : []), ...reasons];
        return { v, excluded: excluded.has(v.vehicleId), offRoad };
      });
    const going = fleet.filter((x) => !x.excluded && x.offRoad.length === 0);
    // WHO DRIVES THAT DAY: the office's roster where it set one, else every active driver. The plan sends out no more
    // trucks than that — it says which it counted, so a plan for a day nobody rostered is not mistaken for one that was.
    const crew = this.roster?.driversFor(fleetDid, ask.day) ?? { source: 'everyone' as const, drivers: this.drivers.list({ managerDid: fleetDid }).filter((d) => d.status === 'ACTIVE') };
    const driverCount = crew.drivers.length;

    const rules = this.rulesOf(fleetDid, ask, orders, new Map(fleet.map((x) => [x.v.vehicleId, x.v.plate])));
    // What a rule means to the math: a vehicle this order may not go on. "Put it on that one" is every other one.
    const barred = (vehicleId: string, freightId: string) => rules.some((r) => r.freightId === freightId && (r.kind === 'keep_off' ? r.vehicleId === vehicleId : r.vehicleId !== vehicleId));
    const pinned = orders.filter((f) => f.destLocation);
    // THE WINDOW each shipper asked for, read where it can be read. The math counts from when the day starts, so a
    // window on the clock is moved onto the day's own minutes. Words that are not a time are not planned to — and are
    // said to be unread, on the order, rather than planned to a guess.
    const [startH, startM] = settings.dayStart.split(':').map(Number);
    const dayStartMin = startH * 60 + startM;
    const windows = new Map<string, DayWindow>();
    const unread = new Set<string>();
    for (const f of pinned) {
      const words = this.dispatch.deliveryWindowOf(f);
      const w = windowOf(words);
      if (w) windows.set(f.freightId, w);
      else if (words?.trim()) unread.add(f.freightId);
    }
    const onTheDay = (w: DayWindow) => ({ ...(w.fromMin !== undefined ? { fromMin: w.fromMin - dayStartMin } : {}), ...(w.toMin !== undefined ? { toMin: w.toMin - dayStartMin } : {}) });
    const planOrders: PlanOrder[] = pinned.map((f) => ({ id: f.freightId, kg: f.weightKg, pickup: f.pickupLocation, drop: f.destLocation!, ...(windows.has(f.freightId) ? { window: onTheDay(windows.get(f.freightId)!) } : {}) }));
    const trucks: PlanTruck[] = going.map(({ v }) => ({ id: v.vehicleId, capacityKg: v.capacityKg, cannot: new Set(pinned.filter((f) => barred(v.vehicleId, f.freightId) || !this.dispatch.vehicleCanCarryFreight(v, f.freightId)).map((f) => f.freightId)) }));
    const result = planDay({
      orders: planOrders,
      trucks,
      depot: manager.location,
      km: roads ? (a, b) => roads.km(a, b) : (a, b) => this.router.roadKm(a, b),
      params: { speedKmh: settings.speedKmh, loadMin: settings.loadMin, unloadMin: settings.unloadMin, dayMin: settings.dayHours * 60, maxTrucks: driverCount },
    });

    const byId = new Map(orders.map((f) => [f.freightId, f]));
    const vehicleOf = new Map(fleet.map((x) => [x.v.vehicleId, x.v]));
    const largestKg = going.reduce((m, x) => Math.max(m, x.v.capacityKg), 0);
    const clock = (min: number) => clockOf(settings.dayStart, min);
    const routes: PlanRouteView[] = result.routes.map((r) => {
      const v = vehicleOf.get(r.truckId)!;
      return {
        vehicleId: v.vehicleId,
        plate: v.plate,
        vehicleClass: v.vehicleClass,
        capacityKg: v.capacityKg,
        trips: r.trips.map((t) => ({
          no: t.no,
          pickupLabel: byId.get(t.stops[0].orderId)!.pickupLabel,
          emptyKm: t.emptyKm,
          start: clock(t.startMin),
          end: clock(t.endMin),
          weightKg: t.kg,
          stops: t.stops.map((s) => {
            const f = byId.get(s.orderId)!;
            return {
              ...this.orderWords(f),
              km: s.km,
              arrive: clock(s.arriveMin),
              ...(this.dispatch.deliveryWindowOf(f) ? { deliveryWindow: this.dispatch.deliveryWindowOf(f) } : {}),
              ...(windows.has(f.freightId) ? { window: windowWords(windows.get(f.freightId)!) } : {}),
              ...(unread.has(f.freightId) ? { windowUnread: true } : {}),
              ...(s.lateMin ? { lateMin: s.lateMin } : {}),
              ...(s.earlyMin ? { earlyMin: s.earlyMin } : {}),
              ...(s.waitMin ? { waitMin: s.waitMin } : {}),
            };
          }),
        })),
        km: r.km,
        emptyKm: r.emptyKm,
        minutes: r.minutes,
        home: clock(r.minutes),
        weightKg: r.kg,
        fullestPct: Math.round((Math.max(...r.trips.map((t) => t.kg)) / v.capacityKg) * 100),
      };
    });
    const unplanned: PlanLeftView[] = [
      ...orders.filter((f) => !f.destLocation).map((f) => ({ ...this.orderWords(f), reason: 'no_pin' as const })),
      ...result.unplanned.map((u) => {
        const f = byId.get(u.orderId)!;
        // Heavier than anything going out: it can still be carried, in several loads — where it is this fleet's to split.
        const split = u.reason === 'too_heavy' && largestKg > 0 && this.dispatch.maySplit(fleetDid, f) ? { splitInto: Math.ceil(f.weightKg / largestKg), loadKg: largestKg } : {};
        return { ...this.orderWords(f), reason: u.reason, ...split };
      }),
    ];
    const plannedIds = routes.flatMap((r) => r.trips.flatMap((t) => t.stops.map((s) => s.freightId)));
    const sumKg = (list: Freight[]) => Math.round(list.reduce((s, f) => s + f.weightKg, 0));
    return {
      day: ask.day,
      madeAt: new Date(now).toISOString(),
      routes,
      unplanned,
      ...(result.hire ? { hire: { trucks: result.hire.trucks, orders: result.hire.orders, weightKg: result.hire.kg, capacityKg: result.hire.capacityKg } } : {}),
      totals: {
        orders: orders.length,
        planned: plannedIds.length,
        weightKg: sumKg(orders),
        plannedKg: sumKg(plannedIds.map((id) => byId.get(id)!)),
        km: Math.round(routes.reduce((s, r) => s + r.km, 0) * 10) / 10,
        emptyKm: Math.round(routes.reduce((s, r) => s + r.emptyKm, 0) * 10) / 10,
        trucksUsed: routes.length,
        trucksAvailable: going.length,
        drivers: driverCount,
        outsideWindow: routes.reduce((n, r) => n + r.trips.reduce((m, t) => m + t.stops.filter((s) => s.lateMin || s.earlyMin).length, 0), 0),
        unreadWindows: plannedIds.filter((id) => unread.has(id)).length,
      },
      settings,
      vehicles: fleet.map(({ v, excluded: out, offRoad }) => ({ vehicleId: v.vehicleId, plate: v.plate, vehicleClass: v.vehicleClass, capacityKg: v.capacityKg, excluded: out, ...(offRoad.length ? { offRoad } : {}) })),
      rules,
      roster: { source: crew.source, names: crew.drivers.map((d) => d.displayName) },
      ...(this.managers.zoneOf(fleetDid) ? { timeZone: this.managers.zoneOf(fleetDid) } : {}),
      distances: { source: roads?.source ?? 'estimate', ...(roads?.why ? { why: roads.why } : {}), ...(roads?.gaps ? { gaps: roads.gaps } : {}) },
    };
  }

  /**
   * Accept a plan for the day. Worked out again here, from the same asks: what is kept is what the server made, and
   * every order in it is told which truck and trip it is on. Accepting again replaces the day's plan, and an order the
   * new plan left out loses the truck the old one gave it.
   */
  accept(fleetDid: string, ask: PlanAsk, by: string, now: number = Date.now(), roads?: RoadDistances): DayPlanView {
    const plan = this.propose(fleetDid, ask, now, roads);
    if (plan.totals.planned === 0) throw new GlosError('INVALID_STATE', 'There is nothing in this plan to accept — no order for the day could be put on a truck');
    const at = new Date(now).toISOString();
    const stamps = new Map<string, PlannedOn>();
    for (const r of plan.routes) {
      for (const t of r.trips) {
        t.stops.forEach((s, i) => stamps.set(s.freightId, { day: plan.day, vehicleId: r.vehicleId, plate: r.plate, tripNo: t.no, seq: i + 1, arrive: s.arrive, ...(s.window ? { window: s.window } : {}), ...(s.lateMin ? { lateMin: s.lateMin } : {}), ...(s.earlyMin ? { earlyMin: s.earlyMin } : {}), at }));
      }
    }
    // What the plan left out goes with it: an order on no vehicle is as much the plan's word as one on a vehicle.
    this.dispatch.stampPlan(fleetDid, plan.day, stamps, now, new Map(plan.unplanned.map((u) => [u.freightId, u.reason])));
    const kept: DayPlanView = { ...plan, accepted: { at, by } };
    this.accepted.set(keyOf(fleetDid, plan.day), kept);
    return kept;
  }

/**
   * Send the next trip to every truck in today's accepted plan that is ready for one. By hand: the office's own
   * "now", for a plan accepted after shifts had started, or a truck the plan was waiting on.
   */
  send(fleetDid: string, day: string, now: number = Date.now()): PlanSendResult {
    if (!isDay(day)) throw new GlosError('INVALID_INPUT', 'A day is YYYY-MM-DD', { field: 'day' });
    const today = this.managers.todayOf(fleetDid, now);
    if (day !== today) throw new GlosError('INVALID_STATE', day > today ? 'That day has not come — its trips go out on the day itself' : 'That day has gone', { field: 'day' });
    const plan = this.accepted.get(keyOf(fleetDid, day));
    if (!plan) throw new GlosError('INVALID_STATE', 'No plan has been accepted for today');
    return { day, trucks: plan.routes.map((r) => this.sendNext(fleetDid, day, r.vehicleId, plan, now)) };
  }

  /** One truck, its next trip. Says what happened, whatever happened. */
  private sendNext(fleetDid: string, day: string, vehicleId: string, plan: DayPlanView, now: number): PlanSendTruck {
    const plate = plan.routes.find((r) => r.vehicleId === vehicleId)?.plate ?? this.vehicles.get(vehicleId).plate;
    const base = { vehicleId, plate, sent: [], held: [] };
    const waiting = this.dispatch.plannedOrdersOn(fleetDid, day, vehicleId);
    if (waiting.length === 0) return { ...base, state: 'nothing_left' };
    // A truck off the road gets no trip — broken down, in the workshop, a lapsed paper: what waits for it is held, in
    // the gate's own words, until the office plans the day again. Its driver may well still be on the shift.
    if (!this.vehicles.isUsable(vehicleId, now)) {
      const why = `${plate} is off the road: ${this.vehicles.offRoadReasons(vehicleId, now).join('; ') || 'grounded'}`;
      for (const f of waiting) this.dispatch.holdPlanned(f.freightId, why, now);
      return { ...base, state: 'off_road', held: waiting.map((f) => ({ code: f.code, why })) };
    }
    const shift = this.fleet.activeForVehicle(vehicleId);
    const driver = shift ? this.drivers.list({ managerDid: fleetDid }).find((d) => d.did === shift.driverDid) : undefined;
    // Somebody else's driver in the truck is nobody the plan can give this fleet's work to.
    if (!shift || !driver) return { ...base, state: 'no_driver' };
    if (this.dispatch.loadsAboard(driver.did) > 0) return { ...base, state: 'carrying', driverName: driver.displayName };
    const tripNo = waiting[0].planned!.tripNo;
    const sent: string[] = [];
    const held: Array<{ code: string; why: string }> = [];
    for (const f of waiting.filter((x) => x.planned!.tripNo === tripNo)) {
      try {
        this.dispatch.assign(f.freightId, driver.did, { managerDid: fleetDid, name: plan.accepted ? `${plan.accepted.by} (the day’s plan)` : 'The day’s plan' }, now);
        // On its truck now: whatever stopped it an hour ago no longer describes it.
        this.dispatch.holdPlanned(f.freightId, undefined, now);
        sent.push(f.code);
      } catch (e) {
        const why = e instanceof Error ? e.message : 'It could not be put on the truck';
        this.dispatch.holdPlanned(f.freightId, why, now);
        held.push({ code: f.code, why });
      }
    }
    return { ...base, state: 'sent', driverName: driver.displayName, tripNo, sent, held };
  }

  /** The day's accepted plan — as accepted — and what has changed under it since. */
  state(fleetDid: string, day: string): DayPlanState {
    if (!isDay(day)) throw new GlosError('INVALID_INPUT', 'A day is YYYY-MM-DD', { field: 'day' });
    const plan = this.accepted.get(keyOf(fleetDid, day));
    const waiting = this.dispatch.contractOrdersForDay(fleetDid, day);
    const inPlan = new Set(plan?.routes.flatMap((r) => r.trips.flatMap((t) => t.stops.map((s) => s.freightId))) ?? []);
    // What the plan itself handed back is not news: it said so when it was accepted.
    const handedBack = new Set(plan?.unplanned.map((u) => u.freightId) ?? []);
    return {
      day,
      ...(plan ? { plan } : {}),
      leftOut: plan ? waiting.filter((f) => handedBack.has(f.freightId)).length : 0,
      // Still without a truck, and the plan has never seen it: it arrived after.
      newSince: plan ? waiting.filter((f) => !inPlan.has(f.freightId) && !handedBack.has(f.freightId)).length : 0,
      withdrawnSince: plan ? [...inPlan].filter((id) => this.dispatch.freightStatusOf(id) === 'cancelled').length : 0,
    };
  }

/**
   * The rules a plan is asked with, checked and named. A rule about an order that is not this day's, or a vehicle that
   * is not this fleet's, is refused rather than dropped: a rule that silently does nothing is worse than none. An order
   * that has since gone on a truck or been withdrawn takes its rules with it — those are simply no longer rules.
   */
  private rulesOf(fleetDid: string, ask: PlanAsk, orders: Freight[], plateOf: Map<string, string>): PlanRuleView[] {
    const asked = [...(ask.keepOff ?? []).map((p) => ({ kind: 'keep_off' as const, ...p })), ...(ask.putOn ?? []).map((p) => ({ kind: 'put_on' as const, ...p }))];
    if (asked.length > MAX_PLAN_RULES) throw new GlosError('INVALID_INPUT', `A plan carries ${MAX_PLAN_RULES} rules at most`);
    const byId = new Map(orders.map((f) => [f.freightId, f]));
    const rules: PlanRuleView[] = [];
    for (const r of asked) {
      const plate = plateOf.get(r.vehicleId);
      if (!plate) throw new GlosError('INVALID_INPUT', 'A rule names a vehicle that is not in this fleet', { field: r.kind === 'keep_off' ? 'keepOff' : 'putOn' });
      const f = byId.get(r.freightId);
      if (!f) {
        // Gone from the day's waiting orders. If it was never an order of this fleet at all, that is a mistake to say.
        if (this.dispatch.carrierOfOrderId(r.freightId) !== fleetDid) throw new GlosError('INVALID_INPUT', 'A rule names an order that is not yours for this day', { field: r.kind === 'keep_off' ? 'keepOff' : 'putOn' });
        continue;
      }
      if (rules.some((x) => x.kind === r.kind && x.freightId === r.freightId && x.vehicleId === r.vehicleId)) continue;
      rules.push({ kind: r.kind, freightId: f.freightId, code: f.code, vehicleId: r.vehicleId, plate });
    }
    for (const r of rules.filter((x) => x.kind === 'put_on')) {
      if (rules.some((x) => x.kind === 'put_on' && x.freightId === r.freightId && x.vehicleId !== r.vehicleId)) throw new GlosError('INVALID_INPUT', `${r.code} cannot be put on two vehicles`, { field: 'putOn' });
      if (rules.some((x) => x.kind === 'keep_off' && x.freightId === r.freightId && x.vehicleId === r.vehicleId)) throw new GlosError('INVALID_INPUT', `${r.code} is both put on ${r.plate} and kept off it`, { field: 'putOn' });
    }
    return rules;
  }

  private orderWords(f: Freight) {
    return { freightId: f.freightId, code: f.code, ...(f.orderRef ? { orderRef: f.orderRef } : {}), description: f.description, shipperName: f.contract?.shipperName ?? '', destLabel: f.destLabel, weightKg: f.weightKg };
  }

  private settingsOf(ask: PlanAsk): PlanSettings {
    const dayStart = ask.dayStart ?? DEFAULT_DAY_START;
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(dayStart)) throw new GlosError('INVALID_INPUT', 'A start time is HH:MM', { field: 'dayStart' });
    const within = (value: number | undefined, fallback: number, min: number, max: number, field: string, what: string) => {
      if (value == null) return fallback;
      if (!Number.isFinite(value) || value < min || value > max) throw new GlosError('INVALID_INPUT', `${what} is between ${min} and ${max}`, { field });
      return value;
    };
    return {
      dayStart,
      dayHours: within(ask.dayHours, DEFAULT_DAY_HOURS, 1, MAX_DAY_HOURS, 'dayHours', 'A day in hours'),
      speedKmh: within(ask.speedKmh, DEFAULT_PLAN_PARAMS.speedKmh, 5, 110, 'speedKmh', 'A speed in km/h'),
      loadMin: within(ask.loadMin, DEFAULT_PLAN_PARAMS.loadMin, 0, 240, 'loadMin', 'Minutes to load an order'),
      unloadMin: within(ask.unloadMin, DEFAULT_PLAN_PARAMS.unloadMin, 0, 240, 'unloadMin', 'Minutes to hand an order over'),
    };
  }
}

const keyOf = (fleetDid: string, day: string) => `${fleetDid}|${day}`;
