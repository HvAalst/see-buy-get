import { clockOf, planDay, type PlanOrder, type PlanParams, type PlanPoint, type PlanTruck } from './day-plan';

/**
 * P3 — A DAY'S PLAN, WORKED OUT. On a flat sheet of paper: a "degree" is a kilometre and distance is the straight
 * line, so every figure below can be checked by hand. What is pinned is what a dispatcher would hold the plan to —
 * a truck is never loaded past what it carries, a day is never longer than a driver's, an unloaded truck goes on from
 * where it is, an order that fits nowhere is handed back with the reason, and the same orders make the same plan.
 */
describe('planning a day', () => {
  const km = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.lat - b.lat, a.lng - b.lng);
  const at = (x: number, y = 0): PlanPoint => ({ lat: y, lng: x });
  const DEPOT = at(0);
  const YARD = at(10);
  // 60 km/h makes a kilometre a minute; ten minutes to load an order and ten to hand it over.
  const P: Partial<PlanParams> = { speedKmh: 60, loadMin: 10, unloadMin: 10, dayMin: 600, openTruckMin: 60, samePickupKm: 0.3 };
  const order = (id: string, kg: number, drop: PlanPoint, pickup: PlanPoint = YARD): PlanOrder => ({ id, kg, pickup, drop });
  const truck = (id: string, capacityKg: number, cannot?: string[]): PlanTruck => ({ id, capacityKg, ...(cannot ? { cannot: new Set(cannot) } : {}) });
  const plan = (orders: PlanOrder[], trucks: PlanTruck[], params: Partial<PlanParams> = {}) => planDay({ orders, trucks, depot: DEPOT, km, params: { ...P, ...params } });

  it('drives one round in the order the road runs, and counts every kilometre and minute of it', () => {
    const r = plan([order('a', 1000, at(20)), order('b', 1000, at(30)), order('c', 1000, at(15))], [truck('T1', 5000)]);
    expect(r.unplanned).toEqual([]);
    expect(r.routes).toHaveLength(1);
    const [route] = r.routes;
    expect(route.trips).toHaveLength(1);
    expect(route.trips[0].stops.map((s) => s.orderId)).toEqual(['c', 'a', 'b']);
    // Depot→yard 10 empty, 5 + 5 + 10 loaded, 30 home empty.
    expect(route).toMatchObject({ km: 60, emptyKm: 40, kg: 3000 });
    // 60 minutes on the road, 30 loading three orders, 30 handing them over.
    expect(route.minutes).toBe(120);
    expect(route.trips[0]).toMatchObject({ emptyKm: 10, startMin: 10, kg: 3000 });
    // At the first door: 10 to the yard, 30 loading, 5 to the door.
    expect(route.trips[0].stops[0]).toMatchObject({ km: 5, arriveMin: 45 });
    expect(route.trips[0].endMin).toBe(90);
  });

  it('never loads a truck past what it carries: three loads that do not share a truck are three trips', () => {
    const r = plan([order('a', 3000, at(20)), order('b', 3000, at(20)), order('c', 3000, at(20))], [truck('T1', 5000)]);
    expect(r.unplanned).toEqual([]);
    const [route] = r.routes;
    expect(route.trips.map((t) => [t.kg, t.stops.length])).toEqual([
      [3000, 1],
      [3000, 1],
      [3000, 1],
    ]);
    // After the first drop the truck goes back to the yard from the DOOR (10 km), not from the depot.
    expect(route.trips.map((t) => t.emptyKm)).toEqual([10, 10, 10]);
  });

  it('sends a truck that has unloaded on to its next collection from where it stands', () => {
    const far = at(55);
    const r = plan([order('a', 1000, at(50)), order('b', 1000, at(90), far)], [truck('T1', 5000), truck('T2', 5000)]);
    expect(r.routes).toHaveLength(1);
    const [route] = r.routes;
    expect(route.trips.map((t) => t.stops[0].orderId)).toEqual(['a', 'b']);
    // The second collection is 5 km from the first door — from the depot it would have been 55.
    expect(route.trips[1].emptyKm).toBe(5);
    expect(route.km).toBe(10 + 40 + 5 + 35 + 90);
  });

  it('fills a truck that is already out before sending another — unless the day is too short for one', () => {
    const orders = [order('a', 1000, at(20)), order('b', 1000, at(21)), order('c', 1000, at(22))];
    expect(plan(orders, [truck('T1', 5000), truck('T2', 5000)]).routes.map((x) => x.truckId)).toEqual(['T1']);
    // One truck's round is 10 + 10 + 1 + 1 + 22 = 44 km and 60 minutes of handling: 104 minutes. Too long a day → two.
    const tight = plan(orders, [truck('T1', 5000), truck('T2', 5000)], { dayMin: 100 });
    expect(tight.unplanned).toEqual([]);
    expect(tight.routes.map((x) => x.truckId)).toEqual(['T1', 'T2']);
    for (const route of tight.routes) expect(route.minutes).toBeLessThanOrEqual(100);
  });

  it('hands back what does not fit the day, and says how many trucks like the largest would carry it', () => {
    // Each order alone is a 80 km, 100-minute round. A 150-minute day takes one.
    const orders = [order('a', 4000, at(40)), order('b', 4000, at(40)), order('c', 4000, at(40))];
    const r = plan(orders, [truck('T1', 5000)], { dayMin: 150 });
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].trips).toHaveLength(1);
    expect(r.unplanned).toEqual([
      { orderId: 'b', reason: 'no_time' },
      { orderId: 'c', reason: 'no_time' },
    ]);
    expect(r.hire).toEqual({ trucks: 2, orders: 2, kg: 8000, capacityKg: 5000 });
  });

  it('does not send a second truck out when it would save nobody any driving', () => {
    // One job west of the depot, one east. A second truck drives exactly as far as the first one going on from its
    // last door — the depot is on the way — and would only get there sooner. A truck in the yard is worth more.
    const r = plan([order('west', 1000, at(-20), at(-10)), order('east', 1000, at(20), at(10))], [truck('T1', 5000), truck('T2', 5000)]);
    expect(r.routes.map((x) => x.truckId)).toEqual(['T1']);
    expect(r.routes[0].trips).toHaveLength(2);
    // Unless a truck in the yard is worth nothing: then sooner wins.
    expect(plan([order('west', 1000, at(-20), at(-10)), order('east', 1000, at(20), at(10))], [truck('T1', 5000), truck('T2', 5000)], { openTruckMin: 0 }).routes).toHaveLength(2);
  });

  it('prices the leftovers in the trucks they would actually take — two small orders are one truck, not two', () => {
    // A round with one order is 10 + 10 + 20 = 40 km and 20 minutes of handling: 60. A second order on it is 80.
    const orders = [order('a', 1000, at(20)), order('b', 1000, at(20)), order('c', 1000, at(20)), order('d', 1000, at(20))];
    const r = plan(orders, [truck('T1', 5000)], { dayMin: 85 });
    expect(r.routes[0].trips[0].stops).toHaveLength(2);
    expect(r.unplanned.map((u) => u.reason)).toEqual(['no_time', 'no_time']);
    expect(r.hire).toEqual({ trucks: 1, orders: 2, kg: 2000, capacityKg: 5000 });
  });

  it('counts the drivers: a truck standing free with nobody to drive it is said as that', () => {
    const orders = [order('a', 4000, at(40)), order('b', 4000, at(40))];
    const r = plan(orders, [truck('T1', 5000), truck('T2', 5000)], { dayMin: 150, maxTrucks: 1 });
    expect(r.routes.map((x) => x.truckId)).toEqual(['T1']);
    expect(r.unplanned).toEqual([{ orderId: 'b', reason: 'no_driver' }]);
    expect(r.hire).toMatchObject({ trucks: 1, orders: 1 });
  });

  it('puts goods only on a truck that can handle them, whatever would have been nearer or emptier', () => {
    const r = plan([order('crane-job', 1000, at(20))], [truck('T1', 5000, ['crane-job']), truck('T2', 5000)]);
    expect(r.routes.map((x) => x.truckId)).toEqual(['T2']);
    expect(plan([order('crane-job', 1000, at(20))], [truck('T1', 5000, ['crane-job'])]).unplanned).toEqual([{ orderId: 'crane-job', reason: 'no_truck_can_carry' }]);
  });

  it('says heavier-than-any-truck apart from no-truck-that-could-handle-it-is-big-enough', () => {
    const trucks = [truck('small', 5000), truck('big', 8000, ['pallets'])];
    const r = plan([order('giant', 12000, at(20)), order('pallets', 7000, at(20))], trucks);
    expect(r.unplanned).toEqual([
      { orderId: 'giant', reason: 'too_heavy' },
      { orderId: 'pallets', reason: 'no_truck_can_carry' },
    ]);
    // Neither is something more of the same trucks would fix, so there is nothing to hire for.
    expect(r.hire).toBeUndefined();
  });

  it('plans nothing, and prices nothing, for a fleet with no truck', () => {
    const r = plan([order('a', 100, at(20))], []);
    expect(r).toEqual({ routes: [], unplanned: [{ orderId: 'a', reason: 'no_trucks' }] });
  });

  it('treats collection points a few steps apart as one yard, and ones across town as two', () => {
    const near = plan([order('a', 1000, at(20)), order('b', 1000, at(21), at(10.1))], [truck('T1', 5000)]);
    expect(near.routes[0].trips).toHaveLength(1);
    const apart = plan([order('a', 1000, at(20)), order('b', 1000, at(21), at(15))], [truck('T1', 5000)]);
    expect(apart.routes[0].trips).toHaveLength(2);
  });

  it('makes the same plan from the same orders, in whatever order they arrive', () => {
    const orders = [order('a', 2000, at(20)), order('b', 2000, at(35, 5)), order('c', 3000, at(12, -8)), order('d', 500, at(40)), order('e', 2000, at(22, 3))];
    const trucks = [truck('T1', 5000), truck('T2', 5000)];
    const first = plan(orders, trucks);
    expect(plan(orders, trucks)).toEqual(first);
    expect(plan([...orders].reverse(), trucks)).toEqual(first);
  });

  it('holds on a busy day what it holds on a quiet one: no truck overloaded, no day too long, every order accounted for once', () => {
    // A repeatable scatter of 70 orders round three yards, on five trucks of three sizes.
    let seed = 20261006;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const yards = [at(10), at(-15, 20), at(30, -25)];
    const orders = Array.from({ length: 70 }, (_, i) => order(`o${String(i).padStart(2, '0')}`, 200 + Math.round(rnd() * 3800), at(Math.round(rnd() * 120 - 60), Math.round(rnd() * 120 - 60)), yards[i % 3]));
    const trucks = [truck('T1', 8000), truck('T2', 5000), truck('T3', 5000), truck('T4', 3000), truck('T5', 3000)];
    const r = plan(orders, trucks, { dayMin: 540 });
    const cap = new Map(trucks.map((t) => [t.id, t.capacityKg]));
    const seen: string[] = [];
    for (const route of r.routes) {
      expect(route.minutes).toBeLessThanOrEqual(540);
      for (const trip of route.trips) {
        expect(trip.kg).toBeLessThanOrEqual(cap.get(route.truckId)!);
        expect(trip.stops.length).toBeGreaterThan(0);
        seen.push(...trip.stops.map((s) => s.orderId));
      }
    }
    seen.push(...r.unplanned.map((u) => u.orderId));
    expect([...seen].sort()).toEqual(orders.map((o) => o.id).sort());
    // And it is a busy day: something is left over, with a number of trucks to hire for it.
    expect(r.unplanned.length).toBeGreaterThan(0);
    expect(r.hire!.trucks).toBeGreaterThan(0);
    expect(r.hire!.orders).toBeLessThanOrEqual(r.unplanned.length);
  });

  it('thinks again after the first pass, and is never the worse for it: at least as many orders, and no longer a day', () => {
    // Several scatters, each planned twice: the first pass alone, and with second thoughts.
    let better = 0;
    for (let trial = 0; trial < 8; trial++) {
      let seed = 7919 * (trial + 1);
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const yards = [at(10), at(-20, 15)];
      const orders = Array.from({ length: 36 }, (_, i) => order(`o${String(i).padStart(2, '0')}`, 300 + Math.round(rnd() * 3200), at(Math.round(rnd() * 100 - 50), Math.round(rnd() * 100 - 50)), yards[i % 2]));
      const trucks = [truck('T1', 8000), truck('T2', 5000), truck('T3', 5000), truck('T4', 3000)];
      const first = plan(orders, trucks, { dayMin: 520, polish: false });
      const second = plan(orders, trucks, { dayMin: 520 });
      const placed = (r: typeof first) => r.routes.reduce((n, route) => n + route.trips.reduce((m, t) => m + t.stops.length, 0), 0);
      const minutes = (r: typeof first) => r.routes.reduce((n, route) => n + route.minutes, 0);
      expect(placed(second)).toBeGreaterThanOrEqual(placed(first));
      if (placed(second) === placed(first)) expect(minutes(second)).toBeLessThanOrEqual(minutes(first) + 1);
      if (placed(second) > placed(first) || minutes(second) < minutes(first) - 1) better += 1;
      // And second thoughts keep every promise the first pass keeps.
      const cap = new Map(trucks.map((t) => [t.id, t.capacityKg]));
      for (const route of second.routes) {
        expect(route.minutes).toBeLessThanOrEqual(520);
        for (const trip of route.trips) expect(trip.kg).toBeLessThanOrEqual(cap.get(route.truckId)!);
      }
      expect(placed(second) + second.unplanned.length).toBe(orders.length);
    }
    // It is worth having: on these days it finds something better more often than not.
    expect(better).toBeGreaterThanOrEqual(4);
  });

  it('reads minutes into the day as a clock', () => {
    expect(clockOf('07:00', 45)).toBe('07:45');
    expect(clockOf('06:30', 600)).toBe('16:30');
    expect(clockOf('nonsense', 90)).toBe('01:30');
  });
});
