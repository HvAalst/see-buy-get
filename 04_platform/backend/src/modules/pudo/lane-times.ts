import { nearestPlace } from './geo-gazetteer';
import type { Freight } from './dispatch.types';

/**
 * THE PROMISE LEARNS THE ROAD (round 21, the user: "The promise learns lanes"; "Five in 90 days").
 *
 * A load's expected arrival drove every road at one standard speed (pudo.config VEHICLE_SPEED_KMH: a truck 55 km/h, all
 * else 40). It now drives each lane at the pace its own finished trips kept: the road distance over the time from pickup
 * to delivery, the border waits taken out (they are promised on their own, round 14) — rests, queues at the gate and the
 * road itself left in, because the promise is about the door, not the engine. The middle of the last ninety days' trips,
 * once there are five; fewer, and the standard holds and says so. Thin data never makes a promise worse than before.
 *
 * A LANE is the town pair the market already names lanes by (geo-gazetteer: within 60 km of a named town). Where a town is
 * not named — anywhere the gazetteer does not reach yet — or a town pair has too few trips, the country pair stands in.
 * Trucks and everything else are measured apart, as the standard sets them apart.
 *
 * A TRIP that cannot say the pace of the road is left out: a delivery tried and failed first, a load moved to another
 * vehicle after a breakdown, a trip shorter than 20 km (the gate is most of it), or a pace no road gives (under 3 km/h —
 * a load forgotten; over 120 — stamps that are not the trip). The middle of the rest is robust to the odd one wrong.
 */

export const LANE_WINDOW_DAYS = 90;
export const MIN_LANE_TRIPS = 5;
export const LANE_MIN_KM = 20;
export const LANE_KMH_MIN = 3;
export const LANE_KMH_MAX = 120;

const HOUR_MS = 3_600_000;

export type LaneLevel = 'towns' | 'countries';

/** The pace a load's lane is driven at in its promise, and what that rests on. */
export interface LaneDrive {
  kmh: number;
  basis: 'measured' | 'standard';
  /** Measured: over how many trips, on which lane, at which level. */
  trips?: number;
  lane?: string;
  level?: LaneLevel;
}

/** Trucks, and everything else: measured apart, as the standard speeds are set apart. */
export type VehicleGroup = 'truck' | 'other';

export function groupOf(f: Pick<Freight, 'carriage' | 'carriedBy'>): VehicleGroup {
  return (f.carriage?.vehicleClass ?? f.carriedBy?.vehicleClass) === 'truck' ? 'truck' : 'other';
}

/** The lanes a load runs on: its town pair where both ends are named, and its country pair where both are known. */
export function lanesOf(f: Pick<Freight, 'pickupLocation' | 'destLocation' | 'pickupCountry' | 'destCountry'>): { towns?: string; countries?: string } {
  const from = nearestPlace(f.pickupLocation)?.name;
  const to = f.destLocation ? nearestPlace(f.destLocation)?.name : undefined;
  const a = f.pickupCountry?.toUpperCase();
  const b = f.destCountry?.toUpperCase();
  return {
    ...(from && to ? { towns: `${from} → ${to}` } : {}),
    ...(a && b ? { countries: `${a} → ${b}` } : {}),
  };
}

/**
 * The pace one finished trip kept, in km/h door to door — or nothing, where the trip cannot say it.
 * `waitedMin`: the minutes its driver said it waited at border posts; `roadKm`: pickup to destination by road.
 */
export function tripKmh(f: Pick<Freight, 'status' | 'pickedUpAt' | 'deliveredAt' | 'deliveryAttempts' | 'reloads'>, waitedMin: number, roadKm: number): number | undefined {
  if (f.status !== 'delivered' || !f.pickedUpAt || !f.deliveredAt) return undefined;
  if (f.deliveryAttempts?.length || f.reloads?.length) return undefined;
  if (!Number.isFinite(roadKm) || roadKm < LANE_MIN_KM) return undefined;
  const hours = (Date.parse(f.deliveredAt) - Date.parse(f.pickedUpAt)) / HOUR_MS - waitedMin / 60;
  if (!Number.isFinite(hours) || hours <= 0) return undefined;
  const kmh = roadKm / hours;
  return kmh >= LANE_KMH_MIN && kmh <= LANE_KMH_MAX ? kmh : undefined;
}

/** One finished trip, as the lanes read it. */
export interface LaneTrip {
  group: VehicleGroup;
  towns?: string;
  countries?: string;
  kmh: number;
  deliveredAt: string;
}

/**
 * The pace a load's lane is promised at: its town pair's trips, once there are five in ninety days; else its country
 * pair's; else the standard for its kind of vehicle.
 */
export function laneDrive(f: Parameters<typeof lanesOf>[0] & Parameters<typeof groupOf>[0], trips: LaneTrip[], standardKmh: number, now: number): LaneDrive {
  const since = now - LANE_WINDOW_DAYS * 86_400_000;
  const group = groupOf(f);
  const recent = trips.filter((t) => t.group === group && Date.parse(t.deliveredAt) >= since && Date.parse(t.deliveredAt) <= now);
  const lanes = lanesOf(f);
  for (const level of ['towns', 'countries'] as const) {
    const lane = lanes[level];
    if (!lane) continue;
    const on = recent.filter((t) => t[level] === lane);
    if (on.length >= MIN_LANE_TRIPS) return { kmh: Math.round(median(on.map((t) => t.kmh))), basis: 'measured', trips: on.length, lane, level };
  }
  return { kmh: standardKmh, basis: 'standard' };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
