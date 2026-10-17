import { clockOf, planDay, type PlanDock, type PlanOrder, type PlanParams, type PlanPoint, type PlanTruck } from './day-plan';

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

  /**
   * DELIVERY WINDOWS. The user, 2026-10-06: an order that cannot make its window is planned all the same, and said to
   * be late. So a window never refuses an order; it makes a late door dearer than an on-time one, and an early truck
   * wait. Minutes are counted from the start of the day, as everywhere on this sheet.
   */
  describe('delivery windows', () => {
    const windowed = (id: string, drop: PlanPoint, window: { fromMin?: number; toMin?: number }, kg = 1000): PlanOrder => ({ ...order(id, kg, drop), window });

    it('waits at a door that is not open yet — and the waiting is part of the truck’s day', () => {
      const r = plan([windowed('a', at(20), { fromMin: 100 })], [truck('T1', 5000)]);
      // At the door after 30 minutes (10 to the yard, 10 loading, 10 on); it opens at 100.
      expect(r.routes[0].trips[0].stops[0]).toEqual({ orderId: 'a', km: 10, arriveMin: 100, waitMin: 70 });
      // 100 + 10 handing over + 20 home.
      expect(r.routes[0].minutes).toBe(130);
    });

    it('hands over before the window opens, and says so, when the day has no room to wait — rather than not deliver', () => {
      const a = windowed('a', at(20), { fromMin: 500 });
      // A ten-hour day holds the wait: at the door at 30, handed over at 500.
      expect(plan([a], [truck('T1', 5000)]).routes[0].trips[0].stops[0]).toEqual({ orderId: 'a', km: 10, arriveMin: 500, waitMin: 470 });
      // A day of 200 minutes does not. It is delivered when the truck gets there, 470 minutes early, and nothing is left out.
      const short = plan([a], [truck('T1', 5000)], { dayMin: 200 });
      expect(short.unplanned).toEqual([]);
      expect(short.routes[0].trips[0].stops[0]).toEqual({ orderId: 'a', km: 10, arriveMin: 30, earlyMin: 470 });
      expect(short.routes[0].minutes).toBe(60);
      // An order that has no room in the day with or without its window is left for the reason it always was.
      expect(plan([windowed('far', at(300), { fromMin: 500 })], [truck('T1', 5000)], { dayMin: 200 }).unplanned).toEqual([{ orderId: 'far', reason: 'no_time' }]);
    });

    it('when it must go in early, it goes in as near its window as the same day’s driving allows', () => {
      // 'a' opens long after this short day is over. The road's order reaches it first; the other way round reaches
      // it 40 minutes nearer its window, for the same kilometres — so that is the way round.
      const r = plan([windowed('a', at(15), { fromMin: 500 }), order('b', 1000, at(30))], [truck('T1', 5000)], { dayMin: 200 });
      const stops = r.routes[0].trips.flatMap((t) => t.stops);
      expect(stops.map((s) => s.orderId)).toEqual(['b', 'a']);
      // Taken first, as the road runs, it would be handed over at minute 35: 465 early.
      expect(stops[1].earlyMin).toBeLessThan(465 - 30);
      expect(stops[1].arriveMin + stops[1].earlyMin!).toBe(500);
      expect(r.routes[0].minutes).toBeLessThanOrEqual(200);
    });

    it('goes to the door with a window first, when the order the road runs would reach it late', () => {
      const free = plan([order('a', 1000, at(15)), order('b', 1000, at(30))], [truck('T1', 5000)]);
      expect(free.routes[0].trips[0].stops.map((s) => s.orderId)).toEqual(['a', 'b']);
      // b must be reached by minute 55. The road's order gets there at 60; the other way round, at 50 — for the same day's driving.
      const r = plan([order('a', 1000, at(15)), windowed('b', at(30), { toMin: 55 })], [truck('T1', 5000)]);
      expect(r.routes[0].trips[0].stops).toEqual([
        { orderId: 'b', km: 20, arriveMin: 50 },
        { orderId: 'a', km: 15, arriveMin: 75 },
      ]);
      expect(r.routes[0].minutes).toBe(free.routes[0].minutes);
    });

    it('plans an order that cannot make its window all the same, and says by how much it is late', () => {
      // A hundred kilometres out, wanted within the hour: no plan can do it.
      const r = plan([windowed('a', at(100), { toMin: 60 })], [truck('T1', 5000)]);
      expect(r.unplanned).toEqual([]);
      expect(r.routes[0].trips[0].stops[0]).toEqual({ orderId: 'a', km: 90, arriveMin: 110, lateMin: 50 });
    });

    it('sends a second truck out rather than be very late — but not to save a few minutes', () => {
      // One east, one west, both wanted early: one truck reaches the second 105 minutes late.
      const tight = [windowed('a', at(60), { toMin: 85 }), windowed('b', at(-40), { toMin: 85 })];
      const two = plan(tight, [truck('T1', 5000), truck('T2', 5000)]);
      expect(two.routes).toHaveLength(2);
      expect(two.routes.flatMap((x) => x.trips.flatMap((t) => t.stops)).every((s) => s.lateMin === undefined)).toBe(true);
      // With only the one truck it is still delivered — late, and said to be.
      const one = plan(tight, [truck('T1', 5000)]);
      expect(one.unplanned).toEqual([]);
      const late = one.routes[0].trips.flatMap((t) => t.stops.map((s) => s.lateMin ?? 0)).sort((x, y) => x - y);
      expect(late).toHaveLength(2);
      expect(late[0]).toBe(0);
      expect(late[1]).toBeGreaterThan(60);
      // Five minutes late is not worth a truck and a driver (an hour, on this sheet): it stays one round.
      const slack = plan([windowed('a', at(60), { toMin: 85 }), windowed('b', at(-40), { toMin: 185 })], [truck('T1', 5000), truck('T2', 5000)]);
      expect(slack.routes).toHaveLength(1);
      // (Whether the truck loads both at once or comes back past the yard for the second is the same road: the yard is on the way.)
      expect(slack.routes[0].trips.flatMap((t) => t.stops.map((s) => [s.orderId, s.lateMin ?? 0]))).toEqual([
        ['a', 0],
        ['b', 5],
      ]);
    });

    it('holds to a window what it holds to everything: never early through a closed door, lateness counted true, the shift never overrun', () => {
      let seed = 11;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      let early = 0;
      let waited = 0;
      for (let run = 0; run < 12; run++) {
        const orders = Array.from({ length: 14 }, (_, i): PlanOrder => {
          // Some windows open after the shift is over: those cannot be waited for.
          const from = Math.floor(rnd() * 620);
          const kind = rnd();
          return { ...order(`o${String(i).padStart(2, '0')}`, 500 + Math.floor(rnd() * 3000), at(rnd() * 60 - 20, rnd() * 30)), ...(kind < 0.3 ? {} : { window: kind < 0.5 ? { toMin: from + 60 } : kind < 0.7 ? { fromMin: from } : { fromMin: from, toMin: from + 90 } }) };
        });
        const byId = new Map(orders.map((o) => [o.id, o]));
        const r = plan(orders, [truck('T1', 8000), truck('T2', 5000)], { dayMin: 480 });
        const stops = r.routes.flatMap((x) => x.trips.flatMap((t) => t.stops));
        expect([...stops.map((s) => s.orderId), ...r.unplanned.map((u) => u.orderId)].sort()).toEqual(orders.map((o) => o.id).sort());
        for (const s of stops) {
          const w = byId.get(s.orderId)!.window;
          // Through a door before it opens only when said: handed over at or after the opening, or marked early by exactly the gap.
          if (w?.fromMin !== undefined) expect(s.arriveMin + (s.earlyMin ?? 0)).toBe(Math.max(s.arriveMin, w.fromMin));
          else expect(s.earlyMin).toBeUndefined();
          // Nobody both waits for a window and goes in before it.
          expect(Boolean(s.waitMin) && Boolean(s.earlyMin)).toBe(false);
          expect(s.lateMin ?? 0).toBe(w?.toMin !== undefined ? Math.max(0, s.arriveMin - w.toMin) : 0);
          if (!w) expect([s.waitMin, s.lateMin]).toEqual([undefined, undefined]);
        }
        early += stops.filter((s) => s.earlyMin).length;
        waited += stops.filter((s) => s.waitMin).length;
        for (const route of r.routes) expect(route.minutes).toBeLessThanOrEqual(480);
        // And nobody is left out for being late: what is left wanted for room, like any other order.
        expect(r.unplanned.every((u) => ['no_time', 'no_driver'].includes(u.reason))).toBe(true);
      }
      // The days above really did hold both kinds: a guard that met neither would have proved nothing.
      expect(early).toBeGreaterThan(0);
      expect(waited).toBeGreaterThan(0);
    });
  });

  /**
   * GIVING ONE UP. One truck, a 450-minute day. The far load alone is 420 minutes (10 to the yard, 10 loading, 190 out,
   * 10 at the door, 200 home), and being the heaviest it is placed first — after which nothing else fits beside it.
   * The three near loads together are 100 minutes. A plan that never asks "would the day carry more without this
   * one?" delivers one order where it could deliver three.
   */
  describe('giving one order up', () => {
    const far = order('far', 6000, at(200));
    const near = ['a', 'b', 'c'].map((id) => order(id, 2500, at(20)));
    const day = { dayMin: 450 };

    it('lets go of the one order that was holding the truck three others would fill', () => {
      const first = plan([far, ...near], [truck('T1', 8000)], { ...day, polish: false });
      expect(first.routes[0].trips.flatMap((t) => t.stops.map((s) => s.orderId))).toEqual(['far']);
      const r = plan([far, ...near], [truck('T1', 8000)], day);
      expect(r.routes[0].trips.flatMap((t) => t.stops.map((s) => s.orderId)).sort()).toEqual(['a', 'b', 'c']);
      expect(r.routes[0].minutes).toBe(100);
      // What was given up is handed back like anything else that found no room — and priced in trucks to hire.
      expect(r.unplanned).toEqual([{ orderId: 'far', reason: 'no_time' }]);
      expect(r.hire).toMatchObject({ trucks: 1, orders: 1, kg: 6000 });
    });

    it('gives nobody’s delivery up for a tidier day: one order for one is not an exchange', () => {
      // Asked for one exchange and for many: a swap of one for one made twelve times over would end where it began,
      // and look like no swap at all.
      for (const maxGiveUps of [1, undefined]) {
        const r = plan([far, near[0]], [truck('T1', 8000)], { ...day, maxGiveUps });
        expect(r.routes[0].trips.flatMap((t) => t.stops.map((s) => s.orderId))).toEqual(['far']);
        expect(r.unplanned).toEqual([{ orderId: 'a', reason: 'no_time' }]);
      }
    });

    it('makes the exchange that puts the most orders on a truck first', () => {
      // Two trucks, each held by a far load only it can carry. T1's is in the way of three near orders, T2's of two.
      const far1 = order('far1', 6000, at(200));
      const far2 = order('far2', 6000, at(200));
      const two = [order('d', 2500, at(20)), order('e', 2500, at(20))];
      const trucks = [truck('T1', 8000, ['far2', 'd', 'e']), truck('T2', 8000, ['far1', 'a', 'b', 'c'])];
      const one = plan([far1, far2, ...near, ...two], trucks, { ...day, maxGiveUps: 1 });
      expect(one.unplanned.map((u) => u.orderId).sort()).toEqual(['d', 'e', 'far1']);
      // Left to finish, both are made.
      const all = plan([far1, far2, ...near, ...two], trucks, day);
      expect(all.unplanned.map((u) => u.orderId).sort()).toEqual(['far1', 'far2']);
    });

    it('gives nothing up when a second truck has the room', () => {
      // A second truck, free for the near ones: nothing needs giving up at all.
      const r = plan([far, ...near], [truck('T1', 8000), truck('T2', 8000)], day);
      expect(r.unplanned).toEqual([]);
      expect(r.routes.map((x) => x.trips.flatMap((t) => t.stops.map((s) => s.orderId)).sort())).toEqual([['far'], ['a', 'b', 'c']]);
    });

    it('sends a truck home when its one order was keeping the only driver from two that another truck can take', () => {
      // One driver. T1 alone can carry the far load; only T2 can carry the near ones.
      const r = plan([far, near[0], near[1]], [truck('T1', 8000, ['a', 'b']), truck('T2', 8000, ['far'])], { ...day, maxTrucks: 1 });
      expect(r.routes.map((x) => [x.truckId, x.trips.flatMap((t) => t.stops.map((s) => s.orderId)).sort()])).toEqual([['T2', ['a', 'b']]]);
      // And the reason it is left is the true one now: a truck stands free for it, with nobody to drive.
      expect(r.unplanned).toEqual([{ orderId: 'far', reason: 'no_driver' }]);
    });

    it('does not give up an order to make room for one that no room would help', () => {
      // 'huge' is heavier than the truck: taking 'far' off does nothing for it, so 'far' stays.
      const r = plan([far, order('huge', 9000, at(20))], [truck('T1', 8000)], day);
      expect(r.routes[0].trips.flatMap((t) => t.stops.map((s) => s.orderId))).toEqual(['far']);
      expect(r.unplanned).toEqual([{ orderId: 'huge', reason: 'too_heavy' }]);
    });

    it('still never overloads a truck or a day by it', () => {
      const r = plan([far, ...near, order('d', 2500, at(20)), order('e', 2500, at(25))], [truck('T1', 8000)], day);
      for (const route of r.routes) {
        expect(route.minutes).toBeLessThanOrEqual(450);
        for (const trip of route.trips) expect(trip.kg).toBeLessThanOrEqual(8000);
      }
      const seen = [...r.routes.flatMap((x) => x.trips.flatMap((t) => t.stops.map((s) => s.orderId))), ...r.unplanned.map((u) => u.orderId)].sort();
      expect(seen).toEqual(['a', 'b', 'c', 'd', 'e', 'far']);
      expect(r.unplanned.map((u) => u.orderId)).toContain('far');
    });
  });

  describe('at the fleet’s own sites', () => {
    // The fleet's own yard, at the depot: goods are collected there too.
    const site = (more: Partial<PlanDock> = {}): PlanDock => ({ id: 'yard', ...more });
    const atYard = (id: string, kg: number, drop: PlanPoint): PlanOrder => ({ ...order(id, kg, drop, DEPOT), dock: 'yard' });
    const withDocks = (orders: PlanOrder[], trucks: PlanTruck[], docks: PlanDock[], params: Partial<PlanParams> = {}) => planDay({ orders, trucks, depot: DEPOT, km, params: { ...P, ...params }, docks });
    // Two loads that each fill a truck, on a day too short for one truck to carry both.
    const two = [atYard('a', 4000, at(100)), atYard('b', 4000, at(-100))];

    it('loads while the site is open: early, the truck stands at the gate; still loading at closing, it is planned and said', () => {
      const r = withDocks([atYard('a', 1000, at(20))], [truck('T1', 5000)], [site({ open: { fromMin: 30, toMin: 600 } })]);
      expect(r.routes[0].trips[0]).toMatchObject({ dock: 'yard', openWaitMin: 30, startMin: 30 });
      // Stood 30, loaded 10, drove 20; handed over 10, home 20.
      expect(r.routes[0].trips[0].stops[0].arriveMin).toBe(60);
      expect(r.routes[0].minutes).toBe(90);
      const late = withDocks([atYard('a', 1000, at(20))], [truck('T1', 5000)], [site({ open: { fromMin: 0, toMin: 4 } })]);
      expect(late.unplanned).toEqual([]);
      expect(late.routes[0].trips[0]).toMatchObject({ dock: 'yard', afterCloseMin: 6 });
      // Collected anywhere else, the site's hours are nothing to it.
      const elsewhere = withDocks([order('b', 1000, at(20))], [truck('T1', 5000)], [site({ open: { fromMin: 300, toMin: 400 } })]);
      expect(elsewhere.routes[0].trips[0]).not.toHaveProperty('dock');
      expect(elsewhere.routes[0].trips[0].startMin).toBe(10);
    });

    it('collects nothing at a site closed all day, says why, and prices no hire for it', () => {
      const r = withDocks([atYard('a', 1000, at(20)), order('b', 1000, at(20))], [truck('T1', 5000)], [site({ open: null })]);
      expect(r.unplanned).toEqual([{ orderId: 'a', reason: 'site_closed' }]);
      expect(r.routes[0].trips.flatMap((t) => t.stops.map((s) => s.orderId))).toEqual(['b']);
      expect(r.hire).toBeUndefined();
    });

    it('loads no more trucks at once than the site has bays: the next waits for one to come free, and a day it takes past its shift is said', () => {
      const trucks = [truck('T1', 5000), truck('T2', 5000)];
      const r = withDocks(two, trucks, [site({ bays: 1 })], { dayMin: 250 });
      expect(r.routes.map((x) => [x.truckId, x.trips[0].startMin, x.trips[0].bayWaitMin])).toEqual([
        ['T1', 0, undefined],
        ['T2', 10, 10],
      ]);
      // T2 waited 10 for the bay: loaded 10, drove 100, handed over 10, home 100.
      expect(r.routes[1].minutes).toBe(230);
      expect(r.routes.map((x) => x.overMin)).toEqual([undefined, undefined]);
      // Two bays, or bays nobody counted: both load at once.
      expect(withDocks(two, trucks, [site({ bays: 2 })], { dayMin: 250 }).routes.map((x) => x.trips[0].startMin)).toEqual([0, 0]);
      expect(withDocks(two, trucks, [site()], { dayMin: 250 }).routes.map((x) => x.trips[0].startMin)).toEqual([0, 0]);
      // The bays are handed out after the day is planned: where waiting takes a day past its shift, by how much.
      expect(withDocks(two, trucks, [site({ bays: 1 })], { dayMin: 225 }).routes.map((x) => x.overMin)).toEqual([undefined, 5]);
    });

    it('gives a bay to the truck that comes for it first, not to the one listed first', () => {
      // T1's shift starts five minutes after T2's.
      const trucks: PlanTruck[] = [{ ...truck('T1', 5000), startMin: 5 }, truck('T2', 5000)];
      const r = withDocks(two, trucks, [site({ bays: 1 })], { dayMin: 250 });
      const first = Object.fromEntries(r.routes.map((x) => [x.truckId, x.trips[0]]));
      expect(first.T2.startMin).toBe(0);
      expect(first.T2).not.toHaveProperty('bayWaitMin');
      expect(first.T1).toMatchObject({ startMin: 10, bayWaitMin: 5 });
    });
  });

  it('reads minutes into the day as a clock', () => {
    expect(clockOf('07:00', 45)).toBe('07:45');
    expect(clockOf('06:30', 600)).toBe('16:30');
    expect(clockOf('nonsense', 90)).toBe('01:30');
  });
});
