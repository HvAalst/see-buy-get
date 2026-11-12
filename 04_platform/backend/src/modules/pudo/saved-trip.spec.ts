import { daysWords, nextRuns, weekdayOf } from './saved-trip';
import { SavedTripService } from './saved-trip.service';
import type { SavedTripDto, StoredTrip } from './saved-trip.types';

/*
 * 2026-11-12 — SAVED TRIPS, LIKE AN ALARM (the owner: "driving route a to b monday to saturday from 5:30 AM and from b to a
 * monday to saturday from 16:00 PM"). What is pinned: runs on its days at its time on its own clock, never a skipped day or
 * while paused; the bell 30 minutes before, once, saying the loads on the way; the evening before a morning run, only when
 * there are loads; a fleet's driver cannot save their own, nor change one their fleet set.
 */
const H = 3_600_000;
// Thursday 12 November 2026, 13:00 in Nairobi (10:00 UTC).
const THU_1300_EAT = Date.parse('2026-11-12T10:00:00Z');

describe('when a saved trip runs', () => {
  const trip = { days: [1, 2, 3, 4, 5, 6], startTime: '05:30', zone: 'Africa/Nairobi', skips: [] as string[] };
  it('reads the weekday off the date: Sunday 0 to Saturday 6', () => {
    expect(weekdayOf('2026-11-12')).toBe(4);
    expect(weekdayOf('2026-11-15')).toBe(0);
    expect(weekdayOf('2026-11-14')).toBe(6);
  });
  it('runs Monday to Saturday at 05:30 Nairobi time, never Sunday, never a skipped day, never while paused', () => {
    const runs = nextRuns(trip, THU_1300_EAT, 3);
    expect(runs.map((r) => r.day)).toEqual(['2026-11-13', '2026-11-14', '2026-11-16']);
    expect(new Date(runs[0].at).toISOString()).toBe('2026-11-13T02:30:00.000Z');
    expect(nextRuns({ ...trip, skips: ['2026-11-14'] }, THU_1300_EAT, 2).map((r) => r.day)).toEqual(['2026-11-13', '2026-11-16']);
    expect(nextRuns({ ...trip, paused: true }, THU_1300_EAT, 2)).toEqual([]);
    // Today's run at 16:00 has not started yet at 13:00: it is the next one.
    expect(nextRuns({ ...trip, startTime: '16:00' }, THU_1300_EAT, 1)[0].day).toBe('2026-11-12');
    // On another clock: 05:30 in Amsterdam (UTC+1 in November).
    expect(new Date(nextRuns({ ...trip, zone: 'Europe/Amsterdam' }, THU_1300_EAT, 1)[0].at).toISOString()).toBe('2026-11-13T04:30:00.000Z');
  });
  it('says its days short', () => {
    expect(daysWords([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
    expect(daysWords([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(daysWords([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(daysWords([0, 1, 2, 6])).toBe('Sun–Tue, Sat');
  });
});

describe('a driver’s saved trips', () => {
  const drivers: Record<string, { managerDid?: string; jurisdiction?: string }> = { 'did:own': { jurisdiction: 'KE' }, 'did:fleet': { managerDid: 'did:mgr', jurisdiction: 'KE' } };
  let loads = 3;
  const bells: Array<{ did: string; title: string; body: string; tag: string; link: string }> = [];
  const make = () =>
    new SavedTripService(
      { get: (did: string) => drivers[did] ?? (() => { throw new Error('No driver'); })() } as never,
      { countAlong: () => loads } as never,
      { list: () => [] } as never,
      { vehicleForDriver: () => undefined } as never,
      { notify: async (did: string, n: { title: string; body: string; tag: string; link: string }) => void bells.push({ did, ...n }) } as never,
    );
  const dto = (over: Partial<SavedTripDto> = {}): SavedTripDto => ({ fromLabel: 'Nairobi', fromLat: -1.286, fromLng: 36.817, toLabel: 'Nakuru', toLat: -0.303, toLng: 36.08, days: [1, 2, 3, 4, 5, 6], startTime: '05:30', ...over });
  beforeEach(() => {
    bells.length = 0;
    loads = 3;
  });

  it('saves several, there and back, on the country’s clock or the phone’s; never for a fleet’s driver', () => {
    const trips = make();
    const there = trips.saveForDriver('did:own', dto(), THU_1300_EAT);
    expect(there).toMatchObject({ setBy: 'driver', mine: true, zone: 'Africa/Nairobi', days: [1, 2, 3, 4, 5, 6], next: { day: '2026-11-13', clock: '05:30' } });
    trips.saveForDriver('did:own', dto({ fromLabel: 'Nakuru', fromLat: -0.303, fromLng: 36.08, toLabel: 'Nairobi', toLat: -1.286, toLng: 36.817, startTime: '16:00' }), THU_1300_EAT);
    expect(trips.listForDriver('did:own', THU_1300_EAT).map((t) => `${t.from.label}→${t.to.label} ${t.next?.day}`)).toEqual(['Nakuru→Nairobi 2026-11-12', 'Nairobi→Nakuru 2026-11-13']);
    expect(trips.saveForDriver('did:own', dto({ zone: 'Europe/Amsterdam' }), THU_1300_EAT).zone).toBe('Europe/Amsterdam');
    expect(trips.saveForDriver('did:own', dto({ zone: 'Mars/Base' }), THU_1300_EAT).zone).toBe('Africa/Nairobi');
    expect(() => trips.saveForDriver('did:fleet', dto(), THU_1300_EAT)).toThrow(/Your fleet sets your trips/);
    expect(() => trips.saveForDriver('did:own', dto({ toLat: -1.286, toLng: 36.817 }), THU_1300_EAT)).toThrow(/two ends are the same place/);
    expect(() => trips.saveForDriver('did:own', dto({ days: [9] }), THU_1300_EAT)).toThrow(/at least one day/);
  });

  it('rings 30 minutes before each run, once, with the loads on the way — and opens on the trip', () => {
    const trips = make();
    const t = trips.saveForDriver('did:own', dto(), THU_1300_EAT);
    const run = Date.parse(t.next!.at);
    expect(trips.sweep(run - 45 * 60_000)).toBe(0);
    expect(trips.sweep(run - 25 * 60_000)).toBe(1);
    expect(bells[0]).toMatchObject({ did: 'did:own', title: 'Your 05:30 trip: Nairobi → Nakuru', body: '3 loads on your way. Tap to see them.', link: `/?trip=${t.tripId}`, tag: `trip:${t.tripId}:2026-11-13:before` });
    expect(trips.sweep(run - 10 * 60_000)).toBe(0);
    // No loads yet: still rung, saying so.
    loads = 0;
    const later = trips.saveForDriver('did:own', dto({ startTime: '16:00' }), THU_1300_EAT);
    trips.sweep(Date.parse(later.next!.at) - 20 * 60_000);
    expect(bells[bells.length - 1].body).toBe('No loads on your way yet. Tap to look when you set off.');
  });

  it('the evening before a morning run, says the loads already there — only when there are some', () => {
    const trips = make();
    const t = trips.saveForDriver('did:own', dto(), THU_1300_EAT);
    // Thursday 19:30 in Nairobi: Friday's 05:30 run is tomorrow morning.
    const evening = Date.parse('2026-11-12T16:30:00Z');
    expect(trips.sweep(Date.parse('2026-11-12T15:30:00Z'))).toBe(0); // 18:30: not yet evening
    expect(trips.sweep(evening)).toBe(1);
    expect(bells[0]).toMatchObject({ title: 'Tomorrow 05:30: Nairobi → Nakuru', body: '3 loads on your way already — take them on ahead tonight.', tag: `trip:${t.tripId}:2026-11-13:evening` });
    expect(trips.sweep(evening + H)).toBe(0);
    // None there: nothing said that evening — and the morning bell still rings.
    loads = 0;
    const other = make();
    const u = other.saveForDriver('did:own', dto(), THU_1300_EAT);
    expect(other.sweep(evening)).toBe(0);
    expect(other.sweep(Date.parse(u.next!.at) - 20 * 60_000)).toBe(1);
    // An afternoon run is not said the evening before.
    const pm = make();
    pm.saveForDriver('did:own', dto({ startTime: '16:00', days: [5] }), THU_1300_EAT);
    loads = 5;
    expect(pm.sweep(evening)).toBe(0);
  });

  it('skips a day and drives it after all; pauses and resumes; never a past day; never one the fleet set', () => {
    const trips = make();
    const t = trips.saveForDriver('did:own', dto(), THU_1300_EAT);
    expect(trips.skip('did:own', t.tripId, '2026-11-13', true, THU_1300_EAT).next?.day).toBe('2026-11-14');
    expect(trips.skip('did:own', t.tripId, '2026-11-13', false, THU_1300_EAT).next?.day).toBe('2026-11-13');
    expect(() => trips.skip('did:own', t.tripId, '2026-11-11', true, THU_1300_EAT)).toThrow(/from today on/);
    expect(trips.setPaused('did:own', t.tripId, true, THU_1300_EAT)).toMatchObject({ paused: true });
    expect(trips.listForDriver('did:own', THU_1300_EAT)[0].next).toBeUndefined();
    expect(trips.sweep(Date.parse('2026-11-13T02:10:00Z'))).toBe(0);
    trips.setPaused('did:own', t.tripId, false, THU_1300_EAT);
    expect(() => trips.update('did:other', t.tripId, dto())).toThrow(/No such trip/);
    // One the fleet set: the driver sees it, never changes it.
    const fleetTrip: StoredTrip = { tripId: 'trip_fleet', driverDid: 'did:fleet', setBy: 'fleet', managerDid: 'did:mgr', from: { label: 'A', lat: 0, lng: 37 }, to: { label: 'B', lat: 1, lng: 37 }, days: [1], startTime: '06:00', zone: 'Africa/Nairobi', skips: [], createdAt: '', updatedAt: '' };
    (trips as unknown as { store: Map<string, StoredTrip> }).store.set(fleetTrip.tripId, fleetTrip);
    expect(trips.listForDriver('did:fleet', THU_1300_EAT)[0]).toMatchObject({ setBy: 'fleet', mine: false });
    expect(() => trips.setPaused('did:fleet', 'trip_fleet', true)).toThrow(/Your fleet set this trip/);
    expect(() => trips.remove('did:fleet', 'trip_fleet')).toThrow(/Your fleet set this trip/);
    trips.remove('did:own', t.tripId);
    expect(trips.listForDriver('did:own', THU_1300_EAT)).toEqual([]);
  });
});

describe('a fleet’s trips (part 2): set for its drivers, each run posted a week ahead, any single run taken back', () => {
  const drivers: Record<string, { managerDid?: string; displayName: string }> = { 'did:amos': { managerDid: 'did:fleet', displayName: 'Amos' }, 'did:else': { managerDid: 'did:other', displayName: 'Else' } };
  const vehicles: Record<string, { managerDid?: string; plate: string }> = { veh_1: { managerDid: 'did:fleet', plate: 'KDA 001A' }, veh_x: { managerDid: 'did:other', plate: 'KDX 999X' } };
  let declared: Array<{ leavesAt: string; corridorId: string; capacityKg?: number; basis: string; amount: number }> = [];
  const departures: Record<string, { status: string; bookings: Array<{ status: string }> }> = {};
  const called: string[] = [];
  let failWith: string | null = null;
  const make = () =>
    new SavedTripService(
      { get: (did: string) => drivers[did] ?? (() => { throw new Error('No driver'); })() } as never,
      { countAlong: () => 2 } as never,
      { list: () => [], get: (id: string) => vehicles[id] ?? (() => { throw new Error('No vehicle'); })() } as never,
      { vehicleForDriver: () => undefined } as never,
      { notify: async () => undefined } as never,
      {
        declare: (input: { leavesAt: string; corridorId: string; capacityKg?: number; basis: string; amount: number }) => {
          if (failWith) throw new Error(failWith);
          declared.push(input);
          const id = `dep_${declared.length}`;
          departures[id] = { status: 'open', bookings: [] };
          return { departureId: id };
        },
        require: (id: string) => departures[id],
        setStatus: (id: string, status: string) => {
          called.push(id);
          departures[id].status = status;
        },
      } as never,
      { clockOf: () => ({ timeZone: 'Africa/Nairobi' }) } as never,
    );
  const fleetDto = (over: Record<string, unknown> = {}) => ({ driverDid: 'did:amos', vehicleId: 'veh_1', fromLabel: 'Nairobi', fromLat: -1.286, fromLng: 36.817, toLabel: 'Nakuru', toLat: -0.303, toLng: 36.08, days: [1, 2, 3, 4, 5, 6], startTime: '05:30', sell: { corridorId: 'cor_1', capacityKg: 2000, basis: 'per_kg' as const, amount: 12 }, ...over });
  beforeEach(() => {
    declared = [];
    called.length = 0;
    failWith = null;
    for (const k of Object.keys(departures)) delete departures[k];
  });

  it('sets a trip for its own driver in its own vehicle; never another fleet’s; space is sold in a vehicle', () => {
    const trips = make();
    const t = trips.saveForFleet('did:fleet', fleetDto() as never, THU_1300_EAT);
    expect(t).toMatchObject({ setBy: 'fleet', mine: false, driverDid: 'did:amos', driverName: 'Amos', plate: 'KDA 001A', zone: 'Africa/Nairobi', sale: { corridorId: 'cor_1', capacityKg: 2000, basis: 'per_kg', amount: 12 } });
    expect(() => trips.saveForFleet('did:fleet', fleetDto({ driverDid: 'did:else' }) as never, THU_1300_EAT)).toThrow(/does not drive for your fleet/);
    expect(() => trips.saveForFleet('did:fleet', fleetDto({ vehicleId: 'veh_x' }) as never, THU_1300_EAT)).toThrow(/not one of your fleet’s/);
    expect(() => trips.saveForFleet('did:fleet', fleetDto({ vehicleId: undefined }) as never, THU_1300_EAT)).toThrow(/Space is sold in a vehicle/);
    // The driver sees it, and cannot change it.
    expect(trips.listForDriver('did:amos', THU_1300_EAT)[0]).toMatchObject({ setBy: 'fleet', mine: false });
    expect(() => trips.setPaused('did:amos', t.tripId, true)).toThrow(/Your fleet set this trip/);
    // Another fleet does not see it.
    expect(trips.listForFleet('did:other', THU_1300_EAT)).toEqual([]);
  });

  it('posts each run in the next seven days as a departure, once; a run that cannot be posted is said, and tried again', () => {
    const trips = make();
    const t = trips.saveForFleet('did:fleet', fleetDto() as never, THU_1300_EAT);
    // Fri, Sat, Mon, Tue, Wed, Thu — six runs Mon–Sat in the seven days from Thursday afternoon.
    expect(declared.map((d) => d.leavesAt.slice(0, 10))).toEqual(['2026-11-13', '2026-11-14', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    expect(declared[0]).toMatchObject({ corridorId: 'cor_1', capacityKg: 2000, basis: 'per_kg', amount: 12, leavesAt: '2026-11-13T02:30:00.000Z' });
    expect(trips.listForFleet('did:fleet', THU_1300_EAT)[0].posted).toHaveLength(6);
    expect(trips.post(trips.get(t.tripId), THU_1300_EAT)).toBe(0);
    // A day on, the next run joins; a line that cannot sell is said on the trip.
    failWith = 'Nairobi–Nakuru is proposed. Space can only be sold on a published line';
    expect(trips.post(trips.get(t.tripId), THU_1300_EAT + 24 * H)).toBe(0);
    expect(trips.listForFleet('did:fleet', THU_1300_EAT + 24 * H)[0].postError).toMatch(/published line/);
    failWith = null;
    expect(trips.sweep(THU_1300_EAT + 24 * H)).toBeGreaterThanOrEqual(0);
    expect(declared.map((d) => d.leavesAt.slice(0, 10))).toContain('2026-11-20');
    expect(trips.listForFleet('did:fleet', THU_1300_EAT + 24 * H)[0].postError).toBeUndefined();
    // A trip that sells nothing posts nothing.
    declared = [];
    make().saveForFleet('did:fleet', fleetDto({ sell: undefined }) as never, THU_1300_EAT);
    expect(declared).toEqual([]);
  });

  it('takes a single run back while nothing is booked on it; a booked one is refused; paused or deleted, the unbooked ones go', () => {
    const trips = make();
    const t = trips.saveForFleet('did:fleet', fleetDto() as never, THU_1300_EAT);
    // Friday's run: nothing booked — taken back and skipped.
    const fri = trips.skipForFleet('did:fleet', t.tripId, '2026-11-13', true, THU_1300_EAT);
    expect(called).toEqual(['dep_1']);
    expect(fri.skips).toEqual(['2026-11-13']);
    expect(fri.posted!.map((p) => p.day)).not.toContain('2026-11-13');
    // Saturday's run: a shipper booked — refused, nothing taken back.
    departures.dep_2.bookings = [{ status: 'booked' }];
    expect(() => trips.skipForFleet('did:fleet', t.tripId, '2026-11-14', true, THU_1300_EAT)).toThrow(/1 booking on that run: cancel it under Runs first/);
    expect(called).toEqual(['dep_1']);
    // Paused: the unbooked runs to come go; the booked one stays.
    trips.pauseForFleet('did:fleet', t.tripId, true, THU_1300_EAT);
    expect(called.sort()).toEqual(['dep_1', 'dep_3', 'dep_4', 'dep_5', 'dep_6']);
    expect(departures.dep_2.status).toBe('open');
    // Deleted: what is left unbooked goes; the booked run is kept, and counted.
    expect(trips.removeForFleet('did:fleet', t.tripId, THU_1300_EAT)).toEqual({ removed: true, kept: 1 });
    expect(() => trips.removeForFleet('did:other', t.tripId, THU_1300_EAT)).toThrow(/No such trip/);
  });
});
