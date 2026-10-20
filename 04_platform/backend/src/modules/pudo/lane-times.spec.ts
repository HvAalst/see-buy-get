import type { BorderRuleService } from './border-rules.service';
import type { Freight } from './dispatch.types';
import { LANE_WINDOW_DAYS, MIN_LANE_TRIPS, laneDrive, lanesOf, tripKmh, type LaneTrip } from './lane-times';
import { LoadPassageService } from './load-passage.service';
import { BORDER_DWELL_H, VEHICLE_SPEED_KMH } from './pudo.config';
import { HeuristicRouter } from './router';

const NAIROBI = { lat: -1.2864, lng: 36.8172 };
const KISUMU = { lat: -0.0917, lng: 34.768 };
const KAMPALA = { lat: 0.347, lng: 32.582 };
const LILONGWE = { lat: -13.963, lng: 33.787 };
const t0 = Date.parse('2026-10-20T06:00:00.000Z');
const H = 3_600_000;
const DAY = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();
const truck = { carriage: { vehicleClass: 'truck' } } as Partial<Freight>;

describe('the promise learns the road (round 21)', () => {
  it('names a lane by its towns where the gazetteer names both — else by its countries', () => {
    expect(lanesOf({ pickupLocation: NAIROBI, destLocation: KISUMU, pickupCountry: 'KE', destCountry: 'KE' } as Freight)).toEqual({ towns: 'Nairobi → Kisumu', countries: 'KE → KE' });
    expect(lanesOf({ pickupLocation: NAIROBI, destLocation: LILONGWE, pickupCountry: 'ke', destCountry: 'mw' } as Freight)).toEqual({ countries: 'KE → MW' });
    expect(lanesOf({ pickupLocation: NAIROBI } as Freight)).toEqual({});
  });

  it('reads the pace of a finished trip door to door, its border waits taken out — and leaves out a trip that cannot say it', () => {
    const done = { status: 'delivered', pickedUpAt: iso(t0), deliveredAt: iso(t0 + 6 * H) } as Freight;
    expect(tripKmh(done, 60, 345)).toBe(69); // 345 km in 6 h, one of them at a post
    expect(tripKmh({ ...done, deliveryAttempts: [{}] } as unknown as Freight, 0, 345)).toBeUndefined();
    expect(tripKmh({ ...done, reloads: [{}] } as unknown as Freight, 0, 345)).toBeUndefined();
    // Across town in half an hour — a plausible 24 km/h, but the gate is most of a trip that short.
    expect(tripKmh({ ...done, deliveredAt: iso(t0 + H / 2) } as Freight, 0, 12)).toBeUndefined();
    expect(tripKmh({ ...done, deliveredAt: iso(t0 + 60_000) } as Freight, 0, 345)).toBeUndefined(); // no road gives 345 km a minute
    expect(tripKmh({ ...done, deliveredAt: iso(t0 + 30 * DAY) } as Freight, 0, 345)).toBeUndefined(); // a load forgotten
    expect(tripKmh({ ...done, status: 'in_transit' } as Freight, 0, 345)).toBeUndefined();
  });

  it('promises a lane at the middle of its last ninety days’ trips once there are five — the town pair first, then the country pair, else the standard', () => {
    const kisumuLoad = { ...truck, pickupLocation: NAIROBI, destLocation: KISUMU, pickupCountry: 'KE', destCountry: 'KE' } as unknown as Freight;
    const trip = (kmh: number, ago: number, over: Partial<LaneTrip> = {}): LaneTrip => ({ group: 'truck', towns: 'Nairobi → Kisumu', countries: 'KE → KE', kmh, deliveredAt: iso(t0 - ago * DAY), ...over });
    const four = [trip(30, 1), trip(34, 2), trip(36, 3), trip(80, 4)];
    // Four on the town pair, none else: the standard holds, and says so.
    expect(laneDrive(kisumuLoad, four, VEHICLE_SPEED_KMH.truck, t0)).toEqual({ kmh: VEHICLE_SPEED_KMH.truck, basis: 'standard' });
    // A fifth: the middle of them, robust to the one wrong.
    expect(laneDrive(kisumuLoad, [...four, trip(32, 5)], VEHICLE_SPEED_KMH.truck, t0)).toEqual({ kmh: 34, basis: 'measured', trips: MIN_LANE_TRIPS, lane: 'Nairobi → Kisumu', level: 'towns' });
    // Too old, another kind of vehicle, or not yet delivered at `now`: none of them count.
    const stale = [...four, trip(32, LANE_WINDOW_DAYS + 1), trip(32, 1, { group: 'other' }), trip(32, -1)];
    expect(laneDrive(kisumuLoad, stale, VEHICLE_SPEED_KMH.truck, t0).basis).toBe('standard');
    // The town pair thin, the country pair has five: the country pair stands in.
    const elsewhere = trip(40, 2, { towns: 'Nairobi → Eldoret' });
    expect(laneDrive(kisumuLoad, [...four, elsewhere], VEHICLE_SPEED_KMH.truck, t0)).toEqual({ kmh: 36, basis: 'measured', trips: 5, lane: 'KE → KE', level: 'countries' });
  });

  it('a crossing load is expected at its lane’s measured pace — and says what that pace rests on', () => {
    const borders = { ruleFor: () => ({ crossings: [{ name: 'Malaba' }] }) } as unknown as BorderRuleService;
    const router = new HeuristicRouter();
    const svc = new LoadPassageService(router, borders);
    const f = { freightId: 'frt_x', code: 'FRT-1', status: 'in_transit', claimedBy: 'd', pickupCountry: 'KE', destCountry: 'UG', pickupLocation: NAIROBI, destLocation: KAMPALA, pickedUpAt: iso(t0), carriage: { vehicleClass: 'truck' } } as unknown as Freight;
    const measured = { kmh: 30, basis: 'measured' as const, trips: 7, lane: 'KE → UG', level: 'countries' as const };
    const c = svc.crossingOf(f, t0 + H, measured)!;
    expect(Date.parse(c.expectedAt!)).toBeCloseTo(t0 + (router.roadKm(NAIROBI, KAMPALA) / 30 + BORDER_DWELL_H) * H, -3);
    expect(c.drive).toEqual(measured);
    // Not given one: the standard, said as such — as every crossing load was promised before.
    expect(svc.crossingOf(f, t0 + H)!.drive).toEqual({ kmh: VEHICLE_SPEED_KMH.truck, basis: 'standard' });
    // Delivered: no promise, so no pace.
    expect(svc.crossingOf({ ...f, status: 'delivered' } as Freight, t0 + H, measured)!.drive).toBeUndefined();
  });

  it('takes a trip’s border waits out of its pace: every clearing its driver said, and nothing else', () => {
    const svc = new LoadPassageService(new HeuristicRouter(), { ruleFor: () => ({ crossings: [{ name: 'Malaba' }, { name: 'Busia' }] }) } as unknown as BorderRuleService);
    const f = { freightId: 'frt_w', code: 'FRT-9', status: 'in_transit', claimedBy: 'd', pickupCountry: 'KE', destCountry: 'UG', pickupLocation: NAIROBI, destLocation: KAMPALA, pickedUpAt: iso(t0), carriage: { vehicleClass: 'truck' } } as unknown as Freight;
    expect(svc.waitedMinOf('frt_w')).toBe(0);
    svc.record(f, 'd', { kind: 'at_border', post: 'Malaba', observedAt: iso(t0 + 6 * H) }, t0 + 6 * H);
    svc.record(f, 'd', { kind: 'cleared_border', observedAt: iso(t0 + 9 * H) }, t0 + 9 * H);
    svc.record(f, 'd', { kind: 'at_hub', hub: 'Kampala ICD', observedAt: iso(t0 + 13 * H) }, t0 + 13 * H);
    expect(svc.waitedMinOf('frt_w')).toBe(180);
  });
});
