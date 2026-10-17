/**
 * P3 — A DAY'S PLAN, WORKED OUT.
 *
 * The user, 2026-10-05: a fleet with a contract "must deliver"; from around midday the manager plans tomorrow, "so
 * they know whether they need to hire external drivers/trucks", and plans "for trucks that have unloaded to move new
 * goods" — "smart planning", by "ordinary math" where that is enough.
 *
 * This is the ordinary math. It is PURE — orders, trucks, a depot and a way to measure distance in; a plan out — so it
 * can be tested on the days that go wrong, and so the same orders always give the same plan. What it decides:
 *
 *  - Each truck's day is a CHAIN OF TRIPS. A trip collects at one place and delivers to one or more; when the truck
 *    has unloaded it goes on to its next collection from wherever it is, not from the depot.
 *  - An order goes where it adds the least time to the whole fleet's day: into a trip already collecting at the same
 *    place with room for it, or as a new trip on some truck. Opening a truck that is still in the yard costs extra,
 *    so trucks are filled before more are sent out.
 *  - Nothing is planned that cannot be done: more than the truck carries at once, goods the truck cannot handle, or a
 *    day longer than a driver's. An order that fits nowhere is NOT squeezed in — it is returned with the reason.
 *  - What is left over is priced in trucks: the same math is run on copies of the fleet's largest truck, and the
 *    number it needs is how many to hire.
 *  - At the fleet's OWN SITES a truck loads while the site is open — early, it stands at the gate — and no more load
 *    there at once than it has bays. Orders are placed first, each truck's day on its own; the bays are handed out
 *    after, in the order trucks come for them, and a wait that takes a day past its shift is said, never hidden.
 *
 * It is a heuristic (cheapest insertion, each trip's drops re-ordered by 2-opt, every order offered the whole day
 * again, and then each planned order given up in turn to see whether the day carries more orders without it), not a
 * proof of the best possible plan. It is honest about its inputs: the distances are whatever `km` says, and the
 * times are those distances at one speed plus fixed minutes at each stop.
 */

export interface PlanPoint {
  lat: number;
  lng: number;
}

export interface PlanOrder {
  id: string;
  kg: number;
  pickup: PlanPoint;
  drop: PlanPoint;
  /**
   * When the door expects it, in minutes after the day starts: not before `fromMin`, not after `toMin`. Either end
   * may be absent. A truck that is early WAITS for the window to open; one that cannot make it is planned all the
   * same and marked late (the user, 2026-10-06: "plan it late, say so") — lateness is a cost, never a refusal. And
   * where the day is too short to wait for a door to open, the order is delivered BEFORE its window and marked early:
   * nothing is left undelivered because of a window.
   */
  window?: { fromMin?: number; toMin?: number };
  /** Collected at one of the fleet's own sites (PlanDock.id). Absent: somewhere else — a shipper's yard. */
  dock?: string;
}

/**
 * ONE OF THE FLEET'S OWN SITES, where it loads: an order collected there loads while the site is open, and no more
 * trucks load there at once than it has bays. (A shipper's dock is not one of these: what it keeps is the shipper's.)
 */
export interface PlanDock {
  id: string;
  /** How many trucks load there at once. Absent: as many as come. */
  bays?: number;
  /** Open for loading, in minutes after the day starts. Absent: always. Null: closed all that day — nothing is collected there. */
  open?: { fromMin: number; toMin: number } | null;
}

export interface PlanTruck {
  id: string;
  capacityKg: number;
  /** The orders this truck cannot carry whatever its room: wrong equipment, wrong body. Ids. */
  cannot?: ReadonlySet<string>;
  /** Where its day starts and ends — the site it works from. Absent: the plan's depot. */
  home?: PlanPoint;
  /** When its day starts, in minutes after the plan's day starts — its shift. Absent: 0. */
  startMin?: number;
  /** The longest its day may be, in minutes — its shift. Absent: the plan's dayMin. */
  dayMin?: number;
  /** Who may drive it out: trucks of one group share that group's drivers (PlanParams.maxPerGroup). */
  group?: string;
  /**
   * The vehicle itself, where one vehicle is offered as several trucks — one per shift. Two of them may both go out
   * only when their days do not overlap: a vehicle is in one place at a time. Absent: the truck is its own vehicle.
   */
  physical?: string;
}

export interface PlanParams {
  /** One speed for every road. Coarse, and said to be. */
  speedKmh: number;
  /** Minutes to load one order at the collection point. */
  loadMin: number;
  /** Minutes to hand one order over at its door. */
  unloadMin: number;
  /** The longest day a truck may work, depot to depot, in minutes. */
  dayMin: number;
  /** What sending out one more truck is worth in minutes: filling a truck already out is preferred up to this. */
  openTruckMin: number;
  /** Collection points this close (km) are one place: the same yard, typed twice. */
  samePickupKm: number;
  /** At most this many trucks go out (the drivers there are). Absent: every truck may. */
  maxTrucks?: number;
  /** At most this many trucks of a group go out (the drivers who start there). A group not named here: none. Absent: no limit per group. */
  maxPerGroup?: Readonly<Record<string, number>>;
  /** Second thoughts after the first pass (see solve). On unless a test wants the first pass alone. */
  polish?: boolean;
  /** How many orders may be given up for more (see solve), at most. Absent: as many as the work allows. */
  maxGiveUps?: number;
  /**
   * What a minute past a delivery window is worth in minutes of the fleet's day. At 4, the plan drives up to four
   * minutes more to be one minute less late — and sends out another truck (openTruckMin) before being much later.
   */
  lateWeight: number;
}

export const DEFAULT_PLAN_PARAMS: PlanParams = { speedKmh: 30, loadMin: 15, unloadMin: 20, dayMin: 600, openTruckMin: 90, samePickupKm: 0.3, lateWeight: 4 };

/**
 * `too_heavy` heavier than the fleet's largest truck · `no_truck_can_carry` no truck that could handle it is big enough
 * · `no_time` it fits a truck, and every truck's day is full · `no_driver` a truck stands free for it, and nobody is
 * left to drive one · `no_trucks` the fleet has no truck to plan with · `site_closed` it is collected at one of the
 * fleet's own sites, and that site is closed all day.
 */
export type UnplannedReason = 'too_heavy' | 'no_truck_can_carry' | 'no_time' | 'no_driver' | 'no_trucks' | 'site_closed';

export interface PlanStop {
  orderId: string;
  /** Kilometres driven from the previous point (the collection, or the stop before). */
  km: number;
  /** Minutes after the day starts that the goods are handed over at this door: on arrival, or when its window opens. */
  arriveMin: number;
  /** Minutes the truck stands at the door before its window opens. Absent when it does not wait. */
  waitMin?: number;
  /** Minutes after its window closed that the door is reached. Absent when it is on time, or has no window. */
  lateMin?: number;
  /** Minutes before its window opens that the goods are handed over — the day had no room to wait. Absent otherwise. */
  earlyMin?: number;
}

export interface PlanTrip {
  no: number;
  pickup: PlanPoint;
  /** Empty running to reach the collection point: from the depot, or from where the last trip ended. */
  emptyKm: number;
  /** When loading starts and when the last order of the trip is handed over, in minutes after the day starts. */
  startMin: number;
  endMin: number;
  kg: number;
  stops: PlanStop[];
  /** The fleet's own site it loads at (PlanDock.id). Absent: somewhere else — a shipper's yard. */
  dock?: string;
  /** Minutes the truck stands at the site before it opens. */
  openWaitMin?: number;
  /** Minutes it waits there for a bay, every one taken by another truck. */
  bayWaitMin?: number;
  /** Minutes it is still loading after the site has closed. Planned all the same, and said. */
  afterCloseMin?: number;
}

export interface PlanRoute {
  truckId: string;
  /** When its day starts (minutes after the plan's day starts), as the truck was given. */
  startMin: number;
  trips: PlanTrip[];
  /** Everything the truck drives, the return to the depot included. */
  km: number;
  /** Of which empty: to each collection, and home. */
  emptyKm: number;
  /** Site to site: how long its day is. */
  minutes: number;
  kg: number;
  /** Minutes its day runs past its shift — only ever for waiting for a bay, which is handed out after the day is planned. */
  overMin?: number;
}

export interface PlanResult {
  routes: PlanRoute[];
  unplanned: Array<{ orderId: string; reason: UnplannedReason }>;
  /** What the leftovers would take in trucks like the fleet's largest. Absent when nothing is left over, or nothing could be hired for it. */
  hire?: { trucks: number; orders: number; kg: number; capacityKg: number };
}

type Km = (a: PlanPoint, b: PlanPoint) => number;

/**
 * An order as it sits in a truck's day. `noWait`: the day could not hold the wait for its window, so it goes in early.
 * `site`: the fleet's own site it is collected at, and when that is open.
 */
type Placed = PlanOrder & { noWait?: boolean; site?: { id: string; open?: { fromMin: number; toMin: number } } };

interface Draft {
  pickup: PlanPoint;
  orders: Placed[];
}

/* ------------------------------------------------------------ one truck's day -- */

/** Where and when a truck's day starts, and how long it may be. */
interface Start {
  at: PlanPoint;
  min: number;
  dayMin: number;
}

/**
 * When a trip may start loading where more than the truck decides — a bay at one of the fleet's own sites (see
 * loadInTurn): given the trip's place in the day and when the truck is ready, when it loads.
 */
type Gate = (tripIndex: number, readyMin: number) => number;

/** A truck's day, driven: every leg, every stop, in order. The one place distance and time are worked out. */
function drive(trips: Draft[], start: Start, p: PlanParams, km: Km, gate?: Gate): { trips: PlanTrip[]; km: number; emptyKm: number; minutes: number; kg: number; late: number } {
  const travel = (d: number) => (d / p.speedKmh) * 60;
  const depot = start.at;
  let at = depot;
  let clock = start.min;
  let total = 0;
  let empty = 0;
  let kgAll = 0;
  let lateAll = 0;
  const out: PlanTrip[] = trips.map((trip, i) => {
    const toPickup = km(at, trip.pickup);
    clock += travel(toPickup);
    total += toPickup;
    empty += toPickup;
    // AT ONE OF THE FLEET'S OWN SITES: not before it opens — the truck stands at the gate, and that is its day too — and,
    // where its bays are counted, not before one is free.
    const dock = trip.orders[0]?.site;
    const open = dock?.open;
    const openWait = open && clock < open.fromMin ? open.fromMin - clock : 0;
    clock += openWait;
    const ready = clock;
    if (gate) clock = Math.max(clock, gate(i, ready));
    const bayWait = clock - ready;
    const startMin = clock;
    clock += p.loadMin * trip.orders.length;
    // Still loading when it closes: planned all the same, and counted like a door reached after its window.
    const afterClose = open && clock > open.toMin ? clock - open.toMin : 0;
    lateAll += afterClose;
    at = trip.pickup;
    const stops = trip.orders.map((o): PlanStop => {
      const leg = km(at, o.drop);
      clock += travel(leg);
      total += leg;
      // Early for its window: the truck stands at the door until it opens, and that standing is part of its day.
      const before = o.window?.fromMin !== undefined && clock < o.window.fromMin ? o.window.fromMin - clock : 0;
      const wait = o.noWait ? 0 : before;
      const early = o.noWait ? before : 0;
      clock += wait;
      const arriveMin = clock;
      // Past its window: delivered all the same, and counted — what it costs is weighed where plans are compared.
      const late = o.window?.toMin !== undefined && clock > o.window.toMin ? clock - o.window.toMin : 0;
      lateAll += late + early;
      clock += p.unloadMin;
      at = o.drop;
      return { orderId: o.id, km: round1(leg), arriveMin: Math.round(arriveMin), ...(Math.round(wait) > 0 ? { waitMin: Math.round(wait) } : {}), ...(Math.round(late) > 0 ? { lateMin: Math.round(late) } : {}), ...(Math.round(early) > 0 ? { earlyMin: Math.round(early) } : {}) };
    });
    const kg = trip.orders.reduce((s, o) => s + o.kg, 0);
    kgAll += kg;
    return {
      no: i + 1,
      pickup: trip.pickup,
      emptyKm: round1(toPickup),
      startMin: Math.round(startMin),
      endMin: Math.round(clock),
      kg: round1(kg),
      stops,
      ...(dock ? { dock: dock.id } : {}),
      ...(Math.round(openWait) > 0 ? { openWaitMin: Math.round(openWait) } : {}),
      ...(Math.round(bayWait) > 0 ? { bayWaitMin: Math.round(bayWait) } : {}),
      ...(Math.round(afterClose) > 0 ? { afterCloseMin: Math.round(afterClose) } : {}),
    };
  });
  if (trips.length) {
    const home = km(at, depot);
    clock += travel(home);
    total += home;
    empty += home;
  }
  return { trips: out, km: total, emptyKm: empty, minutes: clock - start.min, kg: kgAll, late: lateAll };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How a day is judged: how long it is, and — between two days of the same length — how soon the doors are reached.
 * On an out-and-back road a truck can deliver on the way out or on the way home for the same day's work; the customer
 * is better off with the first, and so is the truck, which runs lighter sooner.
 *
 * `minutes` is the day as the driver lives it — it is what must fit a shift. `cost` is what plans are COMPARED by: the
 * same minutes, plus every minute outside a delivery window — after it closed, or before it opened where the day
 * could not wait — at what the fleet says such a minute is worth. So a door reached outside its window is never
 * forbidden, only dearer than one reached inside it.
 */
function measure(trips: Draft[], start: Start, p: PlanParams, km: Km): { minutes: number; cost: number; waiting: number } {
  const d = drive(trips, start, p, km);
  return { minutes: d.minutes, cost: d.minutes + p.lateWeight * d.late, waiting: d.trips.reduce((s, t) => s + t.stops.reduce((x, stop) => x + stop.arriveMin, 0), 0) };
}
const EPS = 1e-6;

/** Each trip's drops in a better order: reverse a stretch whenever the whole day gets shorter. Stops when nothing does. */
function untangle(trips: Draft[], start: Start, p: PlanParams, km: Km): Draft[] {
  let best = trips;
  let bestIs = measure(best, start, p, km);
  let improved = true;
  while (improved) {
    improved = false;
    for (let t = 0; t < best.length; t++) {
      const n = best[t].orders.length;
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const orders = [...best[t].orders.slice(0, i), ...best[t].orders.slice(i, j + 1).reverse(), ...best[t].orders.slice(j + 1)];
          const next = best.map((trip, k) => (k === t ? { ...trip, orders } : trip));
          const m = measure(next, start, p, km);
          // With windows a cheaper order of stops can be a LONGER day (waiting for a door instead of being late at
          // it), so the shift is asked here too: no re-ordering may take a day past what a driver may work.
          if (m.minutes > start.dayMin + EPS && m.minutes > bestIs.minutes + EPS) continue;
          if (m.cost < bestIs.cost - EPS || (m.cost < bestIs.cost + EPS && m.waiting < bestIs.waiting - EPS)) {
            best = next;
            bestIs = m;
            improved = true;
          }
        }
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ the plan -- */

type Days = Map<string, Draft[]>;
type Reason = UnplannedReason;
/** Each truck's start, by its id. */
type Starts = (truckId: string) => Start;

function startsOf(trucks: PlanTruck[], depot: PlanPoint, p: PlanParams): Starts {
  const by = new Map(trucks.map((t) => [t.id, { at: t.home ?? depot, min: t.startMin ?? 0, dayMin: t.dayMin ?? p.dayMin }]));
  return (id) => by.get(id)!;
}

/** May this truck go out as well as the ones already out: a driver left in its group, and its vehicle not out at the same time. */
function mayOpen(t: PlanTruck, days: Days, trucks: PlanTruck[], start: Starts, p: PlanParams): boolean {
  const out = trucks.filter((x) => (days.get(x.id)?.length ?? 0) > 0);
  if (p.maxTrucks != null && out.length >= p.maxTrucks) return false;
  if (p.maxPerGroup && t.group !== undefined && out.filter((x) => x.group === t.group).length >= (p.maxPerGroup[t.group] ?? 0)) return false;
  if (t.physical !== undefined) {
    const mine = start(t.id);
    const clash = out.some((x) => {
      if (x.physical !== t.physical || x.id === t.id) return false;
      const other = start(x.id);
      return mine.min < other.min + other.dayMin && other.min < mine.min + mine.dayMin;
    });
    if (clash) return false;
  }
  return true;
}

/**
 * WHERE AN ORDER GOES: the place in the whole fleet's day where it adds least. Into a trip already collecting at the
 * same place with room for it (wherever in that round its door fits best), or as a trip of its own anywhere in some
 * truck's day. Nothing is offered that overloads a truck or overruns its day. When nowhere will take it, the answer
 * is why.
 */
function place(o: PlanOrder, days: Days, trucks: PlanTruck[], start: Starts, p: PlanParams, km: Km, only?: string): { truckId: string; trips: Draft[]; cost: number } | { reason: Reason } {
  const waiting = placeAs({ ...o, noWait: false }, days, trucks, start, p, km, only);
  // No room in any day to WAIT for this door to open. Rather than leave it undelivered for its window, it is offered
  // the day again as an order that goes in when the truck gets there — early, and counted as that.
  if ('reason' in waiting && wantsTime(waiting.reason) && o.window?.fromMin !== undefined) return placeAs({ ...o, noWait: true }, days, trucks, start, p, km, only);
  return waiting;
}

const wantsTime = (r: Reason) => r === 'no_time' || r === 'no_driver';

function placeAs(o: Placed, days: Days, trucks: PlanTruck[], start: Starts, p: PlanParams, km: Km, only?: string): { truckId: string; trips: Draft[]; cost: number } | { reason: Reason } {
  if (trucks.length === 0) return { reason: 'no_trucks' };
  const able = trucks.filter((t) => !t.cannot?.has(o.id));
  if (able.length === 0) return { reason: 'no_truck_can_carry' };
  if (!able.some((t) => t.capacityKg >= o.kg)) {
    // Heavier than every truck in the yard — or only than the ones that could handle it.
    return { reason: o.kg > Math.max(...trucks.map((t) => t.capacityKg)) ? 'too_heavy' : 'no_truck_can_carry' };
  }
  let best: { truckId: string; trips: Draft[]; cost: number; waiting: number } | null = null;
  let heldBack = false;
  for (const t of able) {
    // `only`: the one truck whose day has just changed — everything else was asked a moment ago and said no.
    if (only && t.id !== only) continue;
    if (t.capacityKg < o.kg) continue;
    const day = days.get(t.id)!;
    const opening = day.length === 0;
    if (opening && !mayOpen(t, days, trucks, start, p)) {
      heldBack = true;
      continue;
    }
    const s = start(t.id);
    const was = measure(day, s, p, km);
    const candidates: Draft[][] = [];
    day.forEach((trip, i) => {
      if (km(trip.pickup, o.pickup) > p.samePickupKm) return;
      if (trip.orders.reduce((sum, x) => sum + x.kg, 0) + o.kg > t.capacityKg + EPS) return;
      for (let at = 0; at <= trip.orders.length; at++) candidates.push(day.map((x, k) => (k === i ? { ...x, orders: [...x.orders.slice(0, at), o, ...x.orders.slice(at)] } : x)));
    });
    for (let at = 0; at <= day.length; at++) candidates.push([...day.slice(0, at), { pickup: o.pickup, orders: [o] }, ...day.slice(at)]);
    for (const trips of candidates) {
      const after = measure(trips, s, p, km);
      if (after.minutes > s.dayMin + EPS) continue;
      const cost = after.cost - was.cost + (opening ? p.openTruckMin : 0);
      const waiting = after.waiting - was.waiting;
      // Equal cost: the one that reaches its doors sooner. Still equal: the truck named first — the same orders
      // always make the same plan.
      if (!best || cost < best.cost - EPS || (cost < best.cost + EPS && waiting < best.waiting - EPS)) best = { truckId: t.id, trips, cost, waiting };
    }
  }
  return best ?? { reason: heldBack ? 'no_driver' : 'no_time' };
}

/** A truck's day without one order: its trip shortened, or gone if that was all it carried. */
function without(day: Draft[], orderId: string): Draft[] {
  return day.map((trip) => ({ ...trip, orders: trip.orders.filter((x) => x.id !== orderId) })).filter((trip) => trip.orders.length > 0);
}

function solve(orders: PlanOrder[], trucks: PlanTruck[], depot: PlanPoint, p: PlanParams, km: Km, polish: boolean): { days: Days; left: Array<{ order: PlanOrder; reason: Reason }> } {
  const days: Days = new Map(trucks.map((t) => [t.id, []]));
  const start = startsOf(trucks, depot, p);
  let left: Array<{ order: PlanOrder; reason: Reason }> = [];
  // The hardest to place first: a heavy order has the fewest trucks it can go on. Then by id, so a plan is repeatable.
  const queue = [...orders].sort((a, b) => b.kg - a.kg || a.id.localeCompare(b.id));
  for (const o of queue) {
    const at = place(o, days, trucks, start, p, km);
    if ('reason' in at) left.push({ order: o, reason: at.reason });
    else days.set(at.truckId, at.trips);
  }
  const tidy = () => {
    for (const [id, day] of days) days.set(id, untangle(day, start(id), p, km));
  };
  tidy();
  if (!polish) return { days, left };

  // SECOND THOUGHTS. The first pass places each order knowing only the ones before it. Now every order is taken out
  // in turn and offered the whole day again: it moves only if the fleet's day gets shorter for it (a truck that is
  // emptied by the move and can stay in the yard counts for what sending it out was worth). Then whatever was left
  // over is offered the room that made. A few rounds; it stops as soon as a round changes nothing.
  const homeOf = (orderId: string) => [...days.entries()].find(([, day]) => day.some((trip) => trip.orders.some((x) => x.id === orderId)));
  const secondThoughts = () => {
    for (let round = 0; round < 4; round++) {
      let changed = false;
      for (const o of queue) {
        const home = homeOf(o.id);
        if (!home) continue;
        const [truckId, day] = home;
        const rest = without(day, o.id);
        const saved = measure(day, start(truckId), p, km).cost - measure(rest, start(truckId), p, km).cost + (rest.length === 0 ? p.openTruckMin : 0);
        const trial: Days = new Map(days);
        trial.set(truckId, rest);
        const at = place(o, trial, trucks, start, p, km);
        if ('reason' in at || at.cost > saved - 0.01) continue;
        trial.set(at.truckId, at.trips);
        for (const [id, d] of trial) days.set(id, d);
        changed = true;
      }
      tidy();
      const still: typeof left = [];
      for (const l of left) {
        const at = place(l.order, days, trucks, start, p, km);
        if ('reason' in at) still.push({ order: l.order, reason: at.reason });
        else {
          days.set(at.truckId, at.trips);
          changed = true;
        }
      }
      left = still;
      if (!changed) break;
    }
    tidy();
  };
  secondThoughts();

  // GIVING ONE UP. Everything above only ever adds an order or moves one: it never asks whether the day would carry
  // MORE without an order it already has. One far, heavy load placed first can hold a truck that three nearer ones
  // would have filled. So each planned order in turn is taken off, the leftovers that only wanted for room are
  // offered the day without it, and then it is offered what remains. The exchange that leaves the most orders on a
  // truck is kept — more orders first, then more weight, then the shorter day — and only if it is strictly more
  // orders: nobody's delivery is given up for a tidier day. Then second thoughts again, and round once more.
  const order = new Map(queue.map((o, i) => [o.id, i]));
  const wantsRoom = (r: Reason) => r === 'no_time' || r === 'no_driver';
  let spent = 0;
  const giveOneUp = (): boolean => {
    const wanting = left.filter((l) => wantsRoom(l.reason));
    if (wanting.length === 0) return false;
    // The search is as big as the day is over-full. It is counted in work done, not seconds, so that the same orders
    // make the same plan on a slow machine as on a fast one; past the budget the plan stands as it is.
    spent += queue.length * wanting.length;
    if (spent > GIVE_UP_BUDGET) return false;
    let best: { days: Days; left: typeof left; gain: number; kg: number; minutes: number } | null = null;
    for (const x of queue) {
      const home = homeOf(x.id);
      if (!home) continue;
      const trial: Days = new Map(days);
      const rest = without(home[1], x.id);
      trial.set(home[0], rest);
      // Only the truck it came off has more room than a moment ago — unless taking it off sends that truck back to the
      // yard, which frees a driver for any of the others.
      const only = rest.length > 0 ? home[0] : undefined;
      const still: typeof left = [];
      let gain = 0;
      let kg = 0;
      for (const l of left) {
        const at = wantsRoom(l.reason) ? place(l.order, trial, trucks, start, p, km, only) : { reason: l.reason };
        // Asked of one truck only, a "no" says nothing new about why: the reason it had stands until it is asked in full.
        if ('reason' in at) still.push(only ? l : { order: l.order, reason: at.reason });
        else {
          trial.set(at.truckId, at.trips);
          gain += 1;
          kg += l.order.kg;
        }
      }
      if (gain === 0) continue;
      const back = place(x, trial, trucks, start, p, km);
      if ('reason' in back) {
        gain -= 1;
        kg -= x.kg;
        still.push({ order: x, reason: back.reason });
      } else trial.set(back.truckId, back.trips);
      if (gain <= 0) continue;
      const minutes = [...trial.entries()].reduce((s, [id, day]) => s + measure(day, start(id), p, km).cost, 0);
      if (!best || gain > best.gain || (gain === best.gain && (kg > best.kg + EPS || (kg > best.kg - EPS && minutes < best.minutes - EPS)))) best = { days: trial, left: still, gain, kg, minutes };
    }
    if (!best) return false;
    for (const [id, d] of best.days) days.set(id, d);
    left = best.left.sort((a, b) => order.get(a.order.id)! - order.get(b.order.id)!);
    return true;
  };
  // Each exchange puts at least one more order on a truck, so this ends by itself; the bound is for the clock.
  for (let n = 0; n < (p.maxGiveUps ?? MAX_GIVE_UPS) && giveOneUp(); n++) secondThoughts();
  return { days, left };
}

/**
 * THE BAYS, handed out. Orders are placed truck by truck, each day worked out on its own; a site's bays are shared, so
 * they are given out afterwards, in the order trucks come for them — the one ready to load first, the truck listed
 * first on a tie. A truck that finds every bay taken waits for the first to come free, and its day goes on from there.
 * Returns when each trip of each truck loads.
 */
function loadInTurn(trucks: PlanTruck[], days: Days, start: Starts, p: PlanParams, km: Km, docks: PlanDock[]): Map<string, number[]> {
  const bays = new Map(docks.filter((d) => d.bays !== undefined).map((d) => [d.id, d.bays!]));
  const booked = new Map<string, Array<[number, number]>>();
  const decided = new Map<string, number[]>(trucks.map((t) => [t.id, []]));
  const going = trucks.filter((t) => days.get(t.id)!.length > 0);
  // When a truck is next ready to load: its day driven as far as the trip it has come to, with the bays it was given.
  const next = (t: PlanTruck): { trip: number; ready: number } | null => {
    const day = days.get(t.id)!;
    const given = decided.get(t.id)!;
    const k = given.length;
    if (k >= day.length) return null;
    let ready = 0;
    drive(day.slice(0, k + 1), start(t.id), p, km, (i, r) => {
      if (i < k) return given[i];
      ready = r;
      return r;
    });
    return { trip: k, ready };
  };
  const waiting = new Map(going.map((t) => [t.id, next(t)]));
  for (;;) {
    let pick: PlanTruck | undefined;
    for (const t of going) {
      const w = waiting.get(t.id);
      if (w && (!pick || w.ready < waiting.get(pick.id)!.ready - EPS)) pick = t;
    }
    if (!pick) break;
    const w = waiting.get(pick.id)!;
    const trip = days.get(pick.id)![w.trip];
    const dock = trip.orders[0]?.site;
    const n = dock ? bays.get(dock.id) : undefined;
    let at = w.ready;
    if (dock && n !== undefined) {
      const min = p.loadMin * trip.orders.length;
      const list = booked.get(dock.id) ?? [];
      at = firstFree(list, n, w.ready, min);
      list.push([at, at + min]);
      booked.set(dock.id, list);
    }
    decided.get(pick.id)!.push(at);
    waiting.set(pick.id, next(pick));
  }
  return decided;
}

/** The first moment from `from` that one of `n` bays is free for `min` minutes, with these loadings already booked. */
function firstFree(booked: Array<[number, number]>, n: number, from: number, min: number): number {
  const loading = (x: number) => booked.filter(([s, e]) => s <= x + EPS && x < e - EPS).length;
  const candidates = [from, ...booked.map(([, e]) => e).filter((e) => e > from)].sort((a, b) => a - b);
  for (const t of candidates) {
    const points = [t, ...booked.map(([s]) => s).filter((s) => s > t && s < t + min - EPS)];
    if (points.every((x) => loading(x) < n)) return t;
  }
  // After the last loading ends nobody is loading: unreachable, said for the type.
  return candidates[candidates.length - 1];
}

/** How many exchanges one plan may make, and how much searching (planned orders × leftovers, summed) it may do for them. */
const MAX_GIVE_UPS = 12;
const GIVE_UP_BUDGET = 40_000;

/**
 * Plan a day. `trucks` in the order the fleet lists them: a tie between two trucks goes to the first.
 */
export function planDay(input: { orders: PlanOrder[]; trucks: PlanTruck[]; depot: PlanPoint; km: Km; params?: Partial<PlanParams>; sites?: PlanPoint[]; docks?: PlanDock[] }): PlanResult {
  const p: PlanParams = { ...DEFAULT_PLAN_PARAMS, ...input.params };
  // WHERE EACH ORDER LOADS: at one of the fleet's own sites, or not. One closed all day collects nothing.
  const docks = input.docks ?? [];
  const closed: PlanOrder[] = [];
  const orders: Placed[] = [];
  for (const o of input.orders) {
    const d = o.dock !== undefined ? docks.find((x) => x.id === o.dock) : undefined;
    if (d?.open === null) closed.push(o);
    else orders.push(d ? { ...o, site: { id: d.id, ...(d.open ? { open: d.open } : {}) } } : o);
  }
  const { days, left } = solve(orders, input.trucks, input.depot, p, input.km, p.polish !== false);
  const start = startsOf(input.trucks, input.depot, p);
  const given = docks.some((d) => d.bays !== undefined) ? loadInTurn(input.trucks, days, start, p, input.km, docks) : undefined;
  const routes: PlanRoute[] = [];
  for (const t of input.trucks) {
    const day = days.get(t.id)!;
    if (day.length === 0) continue;
    const s = start(t.id);
    const d = drive(day, s, p, input.km, given ? (i, ready) => given.get(t.id)![i] ?? ready : undefined);
    const over = Math.round(d.minutes - s.dayMin);
    routes.push({ truckId: t.id, startMin: s.min, trips: d.trips, km: round1(d.km), emptyKm: round1(d.emptyKm), minutes: Math.round(d.minutes), kg: round1(d.kg), ...(over > 0 ? { overMin: over } : {}) });
  }
  const result: PlanResult = { routes, unplanned: [...left.map((l) => ({ orderId: l.order.id, reason: l.reason })), ...closed.map((o) => ({ orderId: o.id, reason: 'site_closed' as const }))] };

  // WHAT TO HIRE. The leftovers that only wanted for time, trucks or drivers, run on copies of the fleet's largest truck — as
  // many copies as there are leftovers, so the answer is how many the math actually uses, not how many it was given. Each
  // copy starts from the site nearest the collection it was made for, on the plan's own day.
  const model = [...input.trucks].sort((a, b) => b.capacityKg - a.capacityKg)[0];
  const wanting = left.filter((l) => (l.reason === 'no_time' || l.reason === 'no_driver') && model && l.order.kg <= model.capacityKg && !model.cannot?.has(l.order.id)).map((l) => l.order);
  if (model && wanting.length) {
    const homes = input.sites?.length ? input.sites : [input.depot];
    const nearest = (o: PlanOrder) => homes.reduce((best, h) => (input.km(h, o.pickup) < input.km(best, o.pickup) ? h : best), homes[0]);
    const hired = wanting.map((o, i): PlanTruck => ({ id: `hire-${String(i + 1).padStart(3, '0')}`, capacityKg: model.capacityKg, home: nearest(o), ...(model.cannot ? { cannot: model.cannot } : {}) }));
    const extra = solve(wanting, hired, input.depot, { ...p, maxTrucks: undefined, maxPerGroup: undefined }, input.km, p.polish !== false);
    const used = [...extra.days.values()].filter((d) => d.length > 0);
    const carried = used.flatMap((d) => d.flatMap((trip) => trip.orders));
    if (used.length) result.hire = { trucks: used.length, orders: carried.length, kg: round1(carried.reduce((s, o) => s + o.kg, 0)), capacityKg: model.capacityKg };
  }
  return result;
}

/** Minutes after the day starts, as a clock time, given when the day starts ("07:00"). */
export function clockOf(dayStart: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(dayStart);
  const base = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const total = Math.max(0, Math.round(base + minutes));
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
