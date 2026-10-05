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
 *
 * It is a heuristic (cheapest insertion, each trip's drops re-ordered by 2-opt, then every order offered the whole
 * day again), not a proof of the best possible plan. It is honest about its inputs: the distances are whatever `km` says, and the times are those
 * distances at one speed plus fixed minutes at each stop.
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
}

export interface PlanTruck {
  id: string;
  capacityKg: number;
  /** The orders this truck cannot carry whatever its room: wrong equipment, wrong body. Ids. */
  cannot?: ReadonlySet<string>;
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
  /** Second thoughts after the first pass (see solve). On unless a test wants the first pass alone. */
  polish?: boolean;
}

export const DEFAULT_PLAN_PARAMS: PlanParams = { speedKmh: 30, loadMin: 15, unloadMin: 20, dayMin: 600, openTruckMin: 90, samePickupKm: 0.3 };

/**
 * `too_heavy` heavier than the fleet's largest truck · `no_truck_can_carry` no truck that could handle it is big enough
 * · `no_time` it fits a truck, and every truck's day is full · `no_driver` a truck stands free for it, and nobody is
 * left to drive one · `no_trucks` the fleet has no truck to plan with.
 */
export type UnplannedReason = 'too_heavy' | 'no_truck_can_carry' | 'no_time' | 'no_driver' | 'no_trucks';

export interface PlanStop {
  orderId: string;
  /** Kilometres driven from the previous point (the collection, or the stop before). */
  km: number;
  /** Minutes after the day starts that the truck is at this door. */
  arriveMin: number;
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
}

export interface PlanRoute {
  truckId: string;
  trips: PlanTrip[];
  /** Everything the truck drives, the return to the depot included. */
  km: number;
  /** Of which empty: to each collection, and home. */
  emptyKm: number;
  /** Depot to depot. */
  minutes: number;
  kg: number;
}

export interface PlanResult {
  routes: PlanRoute[];
  unplanned: Array<{ orderId: string; reason: UnplannedReason }>;
  /** What the leftovers would take in trucks like the fleet's largest. Absent when nothing is left over, or nothing could be hired for it. */
  hire?: { trucks: number; orders: number; kg: number; capacityKg: number };
}

type Km = (a: PlanPoint, b: PlanPoint) => number;

interface Draft {
  pickup: PlanPoint;
  orders: PlanOrder[];
}

/* ------------------------------------------------------------ one truck's day -- */

/** A truck's day, driven: every leg, every stop, in order. The one place distance and time are worked out. */
function drive(trips: Draft[], depot: PlanPoint, p: PlanParams, km: Km): { trips: PlanTrip[]; km: number; emptyKm: number; minutes: number; kg: number } {
  const travel = (d: number) => (d / p.speedKmh) * 60;
  let at = depot;
  let clock = 0;
  let total = 0;
  let empty = 0;
  let kgAll = 0;
  const out: PlanTrip[] = trips.map((trip, i) => {
    const toPickup = km(at, trip.pickup);
    clock += travel(toPickup);
    total += toPickup;
    empty += toPickup;
    const startMin = clock;
    clock += p.loadMin * trip.orders.length;
    at = trip.pickup;
    const stops = trip.orders.map((o): PlanStop => {
      const leg = km(at, o.drop);
      clock += travel(leg);
      total += leg;
      const arriveMin = clock;
      clock += p.unloadMin;
      at = o.drop;
      return { orderId: o.id, km: round1(leg), arriveMin: Math.round(arriveMin) };
    });
    const kg = trip.orders.reduce((s, o) => s + o.kg, 0);
    kgAll += kg;
    return { no: i + 1, pickup: trip.pickup, emptyKm: round1(toPickup), startMin: Math.round(startMin), endMin: Math.round(clock), kg: round1(kg), stops };
  });
  if (trips.length) {
    const home = km(at, depot);
    clock += travel(home);
    total += home;
    empty += home;
  }
  return { trips: out, km: total, emptyKm: empty, minutes: clock, kg: kgAll };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How a day is judged: how long it is, and — between two days of the same length — how soon the doors are reached.
 * On an out-and-back road a truck can deliver on the way out or on the way home for the same day's work; the customer
 * is better off with the first, and so is the truck, which runs lighter sooner.
 */
function measure(trips: Draft[], depot: PlanPoint, p: PlanParams, km: Km): { minutes: number; waiting: number } {
  const d = drive(trips, depot, p, km);
  return { minutes: d.minutes, waiting: d.trips.reduce((s, t) => s + t.stops.reduce((x, stop) => x + stop.arriveMin, 0), 0) };
}
const EPS = 1e-6;

/** Each trip's drops in a better order: reverse a stretch whenever the whole day gets shorter. Stops when nothing does. */
function untangle(trips: Draft[], depot: PlanPoint, p: PlanParams, km: Km): Draft[] {
  let best = trips;
  let bestIs = measure(best, depot, p, km);
  let improved = true;
  while (improved) {
    improved = false;
    for (let t = 0; t < best.length; t++) {
      const n = best[t].orders.length;
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const orders = [...best[t].orders.slice(0, i), ...best[t].orders.slice(i, j + 1).reverse(), ...best[t].orders.slice(j + 1)];
          const next = best.map((trip, k) => (k === t ? { ...trip, orders } : trip));
          const m = measure(next, depot, p, km);
          if (m.minutes < bestIs.minutes - EPS || (m.minutes < bestIs.minutes + EPS && m.waiting < bestIs.waiting - EPS)) {
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

/**
 * WHERE AN ORDER GOES: the place in the whole fleet's day where it adds least. Into a trip already collecting at the
 * same place with room for it (wherever in that round its door fits best), or as a trip of its own anywhere in some
 * truck's day. Nothing is offered that overloads a truck or overruns its day. When nowhere will take it, the answer
 * is why.
 */
function place(o: PlanOrder, days: Days, trucks: PlanTruck[], depot: PlanPoint, p: PlanParams, km: Km): { truckId: string; trips: Draft[]; cost: number } | { reason: Reason } {
  if (trucks.length === 0) return { reason: 'no_trucks' };
  const able = trucks.filter((t) => !t.cannot?.has(o.id));
  if (able.length === 0) return { reason: 'no_truck_can_carry' };
  if (!able.some((t) => t.capacityKg >= o.kg)) {
    // Heavier than every truck in the yard — or only than the ones that could handle it.
    return { reason: o.kg > Math.max(...trucks.map((t) => t.capacityKg)) ? 'too_heavy' : 'no_truck_can_carry' };
  }
  const out = [...days.values()].filter((d) => d.length > 0).length;
  let best: { truckId: string; trips: Draft[]; cost: number; waiting: number } | null = null;
  let heldBack = false;
  for (const t of able) {
    if (t.capacityKg < o.kg) continue;
    const day = days.get(t.id)!;
    const opening = day.length === 0;
    if (opening && p.maxTrucks != null && out >= p.maxTrucks) {
      heldBack = true;
      continue;
    }
    const was = measure(day, depot, p, km);
    const candidates: Draft[][] = [];
    day.forEach((trip, i) => {
      if (km(trip.pickup, o.pickup) > p.samePickupKm) return;
      if (trip.orders.reduce((sum, x) => sum + x.kg, 0) + o.kg > t.capacityKg + EPS) return;
      for (let at = 0; at <= trip.orders.length; at++) candidates.push(day.map((x, k) => (k === i ? { ...x, orders: [...x.orders.slice(0, at), o, ...x.orders.slice(at)] } : x)));
    });
    for (let at = 0; at <= day.length; at++) candidates.push([...day.slice(0, at), { pickup: o.pickup, orders: [o] }, ...day.slice(at)]);
    for (const trips of candidates) {
      const after = measure(trips, depot, p, km);
      if (after.minutes > p.dayMin + EPS) continue;
      const cost = after.minutes - was.minutes + (opening ? p.openTruckMin : 0);
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
  let left: Array<{ order: PlanOrder; reason: Reason }> = [];
  // The hardest to place first: a heavy order has the fewest trucks it can go on. Then by id, so a plan is repeatable.
  const queue = [...orders].sort((a, b) => b.kg - a.kg || a.id.localeCompare(b.id));
  for (const o of queue) {
    const at = place(o, days, trucks, depot, p, km);
    if ('reason' in at) left.push({ order: o, reason: at.reason });
    else days.set(at.truckId, at.trips);
  }
  const tidy = () => {
    for (const [id, day] of days) days.set(id, untangle(day, depot, p, km));
  };
  tidy();
  if (!polish) return { days, left };

  // SECOND THOUGHTS. The first pass places each order knowing only the ones before it. Now every order is taken out
  // in turn and offered the whole day again: it moves only if the fleet's day gets shorter for it (a truck that is
  // emptied by the move and can stay in the yard counts for what sending it out was worth). Then whatever was left
  // over is offered the room that made. A few rounds; it stops as soon as a round changes nothing.
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const o of queue) {
      const home = [...days.entries()].find(([, day]) => day.some((trip) => trip.orders.some((x) => x.id === o.id)));
      if (!home) continue;
      const [truckId, day] = home;
      const rest = without(day, o.id);
      const saved = measure(day, depot, p, km).minutes - measure(rest, depot, p, km).minutes + (rest.length === 0 ? p.openTruckMin : 0);
      const trial: Days = new Map(days);
      trial.set(truckId, rest);
      const at = place(o, trial, trucks, depot, p, km);
      if ('reason' in at || at.cost > saved - 0.01) continue;
      trial.set(at.truckId, at.trips);
      for (const [id, d] of trial) days.set(id, d);
      changed = true;
    }
    tidy();
    const still: typeof left = [];
    for (const l of left) {
      const at = place(l.order, days, trucks, depot, p, km);
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
  return { days, left };
}

/**
 * Plan a day. `trucks` in the order the fleet lists them: a tie between two trucks goes to the first.
 */
export function planDay(input: { orders: PlanOrder[]; trucks: PlanTruck[]; depot: PlanPoint; km: Km; params?: Partial<PlanParams> }): PlanResult {
  const p: PlanParams = { ...DEFAULT_PLAN_PARAMS, ...input.params };
  const { days, left } = solve(input.orders, input.trucks, input.depot, p, input.km, p.polish !== false);
  const routes: PlanRoute[] = [];
  for (const t of input.trucks) {
    const day = days.get(t.id)!;
    if (day.length === 0) continue;
    const d = drive(day, input.depot, p, input.km);
    routes.push({ truckId: t.id, trips: d.trips, km: round1(d.km), emptyKm: round1(d.emptyKm), minutes: Math.round(d.minutes), kg: round1(d.kg) });
  }
  const result: PlanResult = { routes, unplanned: left.map((l) => ({ orderId: l.order.id, reason: l.reason })) };

  // WHAT TO HIRE. The leftovers that only wanted for time, trucks or drivers, run on copies of the fleet's largest truck — as
  // many copies as there are leftovers, so the answer is how many the math actually uses, not how many it was given.
  const model = [...input.trucks].sort((a, b) => b.capacityKg - a.capacityKg)[0];
  const wanting = left.filter((l) => (l.reason === 'no_time' || l.reason === 'no_driver') && model && l.order.kg <= model.capacityKg && !model.cannot?.has(l.order.id)).map((l) => l.order);
  if (model && wanting.length) {
    const hired = wanting.map((_, i): PlanTruck => ({ id: `hire-${String(i + 1).padStart(3, '0')}`, capacityKg: model.capacityKg, ...(model.cannot ? { cannot: model.cannot } : {}) }));
    const extra = solve(wanting, hired, input.depot, { ...p, maxTrucks: undefined }, input.km, p.polish !== false);
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
