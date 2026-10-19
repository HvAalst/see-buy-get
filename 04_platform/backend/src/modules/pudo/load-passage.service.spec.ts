import type { BorderRuleService } from './border-rules.service';
import type { Freight } from './dispatch.types';
import { LoadPassageService } from './load-passage.service';
import { BORDER_DWELL_H, VEHICLE_SPEED_KMH } from './pudo.config';
import { HeuristicRouter } from './router';

const NAIROBI = { lat: -1.286, lng: 36.817 };
const KAMPALA = { lat: 0.347, lng: 32.582 };
const MALABA = { lat: 0.636, lng: 34.28 };
const KIGALI = { lat: -1.944, lng: 30.062 };
const driver = 'did:glos:driver-otieno';
const t0 = Date.parse('2026-10-19T06:00:00.000Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
const load = (over: Partial<Freight> = {}): Freight =>
  ({
    freightId: `frt_${(seq += 1)}`,
    code: `FRT-${seq}`,
    status: 'in_transit',
    claimedBy: driver,
    pickupCountry: 'KE',
    destCountry: 'UG',
    pickupLocation: NAIROBI,
    destLocation: KAMPALA,
    pickedUpAt: iso(t0),
    carriage: { vehicleId: 'veh_1', plate: 'KDA 123T', vehicleClass: 'truck', driverDid: driver, at: iso(t0) },
    ...over,
  }) as unknown as Freight;

/** The crossings on record: Kenya into Uganda at the posts named. */
const borders = (posts: string[]) => ({ ruleFor: (from?: string, to?: string) => (from === 'KE' && to === 'UG' ? { crossings: posts.map((name) => ({ name })) } : undefined) }) as unknown as BorderRuleService;

const router = new HeuristicRouter();
const truckHours = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => router.roadKm(a, b) / VEHICLE_SPEED_KMH.truck;

/** One load that crossed at `post` and waited `hours` there, cleared by `at`. */
function crossed(svc: LoadPassageService, post: string, hours: number, at: number = t0, over: Partial<Freight> = {}): Freight {
  const f = load({ pickedUpAt: iso(at - hours * H - H), ...over });
  svc.record(f, driver, { kind: 'at_border', post, observedAt: iso(at - hours * H) }, at);
  svc.record(f, driver, { kind: 'cleared_border', observedAt: iso(at) }, at);
  return f;
}

describe('a load at a border or a hub, said by its driver (round 14)', () => {
  it('the driver carrying it says where it is, in order — and is told in words when it cannot be so', () => {
    const svc = new LoadPassageService(router, borders(['Malaba', 'Busia']));
    const f = load();
    expect(() => svc.record(f, 'did:glos:someone-else', { kind: 'at_border', post: 'Malaba' }, t0 + H)).toThrow(/claimed by another driver/);
    expect(() => svc.record(load({ status: 'claimed' }), driver, { kind: 'at_hub', hub: 'Naivasha ICD' }, t0 + H)).toThrow(/while it is on the road/);
    expect(() => svc.record(load({ destCountry: 'KE' }), driver, { kind: 'at_border', post: 'Malaba' }, t0 + H)).toThrow(/stays in one country/);
    expect(() => svc.record(f, driver, { kind: 'cleared_border' }, t0 + H)).toThrow(/not at a border/);
    expect(() => svc.record(f, driver, { kind: 'at_border', post: '  ' }, t0 + H)).toThrow(/which border post/);
    expect(() => svc.record(f, driver, { kind: 'at_hub' }, t0 + H)).toThrow(/Name the hub/);
    expect(() => svc.record(f, driver, { kind: 'at_border', post: 'Malaba', location: { lat: 200, lng: 0 } }, t0 + H)).toThrow(/not a place on the map/);
    expect(svc.of(f.freightId)).toHaveLength(0);

    // At Malaba, with where the phone was; the same tap sent again is the same step.
    const at = svc.record(f, driver, { kind: 'at_border', post: 'Malaba', location: MALABA, observedAt: iso(t0 + 5 * H) }, t0 + 5 * H);
    expect(at).toMatchObject({ replayed: false, passage: { kind: 'at_border', post: 'Malaba', from: 'KE', to: 'UG', at: iso(t0 + 5 * H), by: driver, location: MALABA } });
    expect(svc.record(f, driver, { kind: 'at_border', post: ' malaba ', observedAt: iso(t0 + 5 * H) }, t0 + 5 * H + 60_000).replayed).toBe(true);
    // Not at a second post before the first is cleared.
    expect(() => svc.record(f, driver, { kind: 'at_border', post: 'Busia' }, t0 + 6 * H)).toThrow(/at Malaba already/);

    // Cleared: how long it was there, from its arrival.
    const cleared = svc.record(f, driver, { kind: 'cleared_border', observedAt: iso(t0 + 12 * H) }, t0 + 12 * H);
    expect(cleared.passage).toMatchObject({ kind: 'cleared_border', post: 'Malaba', waitedMin: 7 * 60 });
    expect(svc.record(f, driver, { kind: 'cleared_border' }, t0 + 12 * H + 60_000).replayed).toBe(true);

    // Sent late, dated by the phone — but never before what was already said of it.
    const hub = svc.record(f, driver, { kind: 'at_hub', hub: 'Kampala ICD', observedAt: iso(t0 + 2 * H) }, t0 + 14 * H);
    expect(hub.passage.at).toBe(iso(t0 + 12 * H));
    // A clock running ahead reads as now.
    const ahead = svc.record(load(), driver, { kind: 'at_hub', hub: 'Naivasha ICD', observedAt: iso(t0 + 40 * H) }, t0 + 3 * H);
    expect(ahead.passage.at).toBe(iso(t0 + 3 * H));

    // What anybody but the driver reads: the steps, without the driver and without the phone's position.
    expect(svc.views(f.freightId)).toEqual([
      { kind: 'at_border', post: 'Malaba', at: iso(t0 + 5 * H) },
      { kind: 'cleared_border', post: 'Malaba', at: iso(t0 + 12 * H), waitedMin: 420 },
      { kind: 'at_hub', hub: 'Kampala ICD', at: iso(t0 + 12 * H) },
    ]);
  });

  it('a post’s wait is measured from the loads that cleared it, and said as the standard four hours until there are enough', () => {
    const svc = new LoadPassageService(router, borders(['Malaba', 'Busia']));
    expect(svc.waitFor('KE', 'UG', 'Malaba', t0)).toEqual({ from: 'KE', to: 'UG', post: 'Malaba', hours: BORDER_DWELL_H, basis: 'standard' });
    for (const h of [2, 3, 10, 5]) crossed(svc, 'Malaba', h);
    expect(svc.waitFor('KE', 'UG', 'Malaba', t0)).toMatchObject({ basis: 'standard', hours: BORDER_DWELL_H });
    crossed(svc, ' MALABA ', 6);
    expect(svc.waitFor('KE', 'UG', 'Malaba', t0)).toEqual({ from: 'KE', to: 'UG', post: 'Malaba', hours: 5, basis: 'measured', crossings: 5 });
    // Another post has its own wait; its own count is not Malaba's.
    crossed(svc, 'Busia', 1);
    expect(svc.waitFor('KE', 'UG', 'Busia', t0)).toMatchObject({ basis: 'standard', hours: BORDER_DWELL_H });
    // The crossing as a whole, before a load is at one of its posts: every post's crossings together, the posts named.
    // The post on record keeps its own name, however a driver spelt it.
    expect(svc.waitFor('KE', 'UG', undefined, t0)).toMatchObject({ basis: 'measured', crossings: 6, posts: ['Busia', 'Malaba'] });
    // A load through to Rwanda at Malaba is in transit, not entering Uganda: counted under its own crossing.
    crossed(svc, 'Malaba', 30, t0, { destCountry: 'RW', destLocation: KIGALI });
    expect(svc.waitFor('KE', 'UG', 'Malaba', t0)).toMatchObject({ crossings: 5 });
    // Ninety days on, today's crossings no longer count.
    expect(svc.waitFor('KE', 'UG', 'Malaba', t0 + 91 * 24 * H)).toMatchObject({ basis: 'standard' });

    expect(svc.board(t0)).toEqual([
      { from: 'KE', to: 'RW', post: 'Malaba', hours: 30, crossings: 1, measured: false, longestHours: 30, lastClearedAt: iso(t0) },
      { from: 'KE', to: 'UG', post: 'Busia', hours: 1, crossings: 1, measured: false, longestHours: 1, lastClearedAt: iso(t0) },
      { from: 'KE', to: 'UG', post: 'Malaba', hours: 5, crossings: 5, measured: true, longestHours: 10, lastClearedAt: iso(t0) },
    ]);
  });

  it('a crossing with one post on record is promised that post’s wait before the load gets there', () => {
    const svc = new LoadPassageService(router, borders(['Malaba']));
    for (const h of [6, 6, 7, 8, 9]) crossed(svc, 'Malaba', h);
    expect(svc.crossingOf(load(), t0)).toMatchObject({ state: 'ahead', post: 'Malaba', wait: { post: 'Malaba', hours: 7, basis: 'measured', crossings: 5 } });
  });

  it('when a crossing load is expected moves with what the driver says, never with the clock', () => {
    const svc = new LoadPassageService(router, borders(['Malaba']));
    const f = load();
    // Picked up: the whole drive and the whole wait ahead.
    const ahead = svc.crossingOf(f, t0 + H)!;
    expect(ahead).toMatchObject({ state: 'ahead', from: 'KE', to: 'UG', post: 'Malaba', wait: { hours: BORDER_DWELL_H, basis: 'standard' } });
    expect(Date.parse(ahead.expectedAt!)).toBeCloseTo(t0 + (truckHours(NAIROBI, KAMPALA) + BORDER_DWELL_H) * H, -3);
    expect(svc.crossingOf(f, t0 + 9 * H)!.expectedAt).toBe(ahead.expectedAt);

    // At the post: from there, the wait and the rest of the drive.
    svc.record(f, driver, { kind: 'at_border', post: 'Malaba', location: MALABA, observedAt: iso(t0 + 6 * H) }, t0 + 6 * H);
    const at = svc.crossingOf(f, t0 + 7 * H)!;
    expect(at).toMatchObject({ state: 'at_post', post: 'Malaba', since: iso(t0 + 6 * H) });
    expect(Date.parse(at.expectedAt!)).toBeCloseTo(t0 + (6 + BORDER_DWELL_H + truckHours(MALABA, KAMPALA)) * H, -3);

    // Across after three hours: the rest of the drive only.
    svc.record(f, driver, { kind: 'cleared_border', location: MALABA, observedAt: iso(t0 + 9 * H) }, t0 + 9 * H);
    const across = svc.crossingOf(f, t0 + 10 * H)!;
    expect(across).toMatchObject({ state: 'cleared', post: 'Malaba', clearedAt: iso(t0 + 9 * H), waitedMin: 180 });
    expect(Date.parse(across.expectedAt!)).toBeCloseTo(t0 + (9 + truckHours(MALABA, KAMPALA)) * H, -3);

    // Delivered: no expectation left. Staying in one country: no crossing at all.
    expect(svc.crossingOf({ ...f, status: 'delivered' } as Freight, t0 + 20 * H)!.expectedAt).toBeUndefined();
    expect(svc.crossingOf(load({ destCountry: 'KE', destLocation: NAIROBI }), t0)).toBeUndefined();
  });

  it('the driver’s app is told whether the load crosses, the posts on record, and how long it usually takes where it is', () => {
    const svc = new LoadPassageService(router, borders(['Malaba', 'Busia']));
    const f = load();
    expect(svc.forDriver(f, t0)).toEqual({ crosses: true, from: 'KE', to: 'UG', posts: ['Malaba', 'Busia'] });
    svc.record(f, driver, { kind: 'at_border', post: 'Busia', observedAt: iso(t0 + 4 * H) }, t0 + 4 * H);
    expect(svc.forDriver(f, t0 + 5 * H)).toMatchObject({ atPost: { post: 'Busia', since: iso(t0 + 4 * H), wait: { hours: BORDER_DWELL_H, basis: 'standard' } }, last: { kind: 'at_border', post: 'Busia' } });
    expect(svc.forDriver(load({ destCountry: 'KE' }), t0)).toEqual({ crosses: false, posts: [] });
    // No crossing on record: the driver names the post.
    expect(new LoadPassageService(router).forDriver(load(), t0)).toMatchObject({ crosses: true, posts: [] });
  });
});
