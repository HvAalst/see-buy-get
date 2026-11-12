import type { DensityCoverage, DensityReach } from './hub-density.types';
import { VEHICLE_SPEED_KMH } from './pudo.config';

/**
 * 2026-11-12 — WHERE HUBS ARE NEEDED, the arithmetic (the plan "Hubs on the Road", step 3; D6 as recommended: shops and parcels,
 * distance judged by the zone's group). Plain functions, tested without the services.
 */

/** How far a zone's shops may be from a hub, by group, per country (D6); each country's staff change theirs. */
export const DENSITY_REACH: Readonly<Record<string, DensityReach>> = {
  KE: { urban: 15, rural: 60, remote: 150 },
  UG: { urban: 15, rural: 60, remote: 150 },
  ET: { urban: 20, rural: 80, remote: 200 },
  NL: { urban: 5, rural: 15, remote: 40 },
};
/** A country with no figures of its own yet. */
export const DENSITY_REACH_ELSE: DensityReach = { urban: 15, rural: 60, remote: 150 };

export function reachStartOf(country: string | undefined): DensityReach {
  return (country ? DENSITY_REACH[country] : undefined) ?? DENSITY_REACH_ELSE;
}

/** The reach of a zone's group; a group a country added itself is judged as rural. */
export function reachOfGroup(reach: DensityReach, group: string): number {
  return group === 'urban' ? reach.urban : group === 'remote' ? reach.remote : reach.rural;
}

/** Near within the reach; far within twice it; too far beyond. */
export function coverageOf(km: number | undefined, reach: number): DensityCoverage {
  if (km === undefined || !Number.isFinite(km)) return 'too_far';
  return km <= reach ? 'near' : km <= 2 * reach ? 'far' : 'too_far';
}

/** "An extra hub is needed": full on this many of the last DENSITY_DAYS days, or more parcels a day than it says it sorts. */
export const EXTRA_HUB_FULL_DAYS = 5;
export const DENSITY_DAYS = 14;

/** "A gap on the road": two neighbouring stops more than a day's drive apart — eight hours at a truck's speed. */
export const ROAD_GAP_KM = 8 * VEHICLE_SPEED_KMH.truck;

/** A suggestion set aside comes back after this many days, or sooner once its score doubles. */
export const ASIDE_DAYS = 90;

export function stillAside(aside: { at: string; score: number } | undefined, score: number, now: number): boolean {
  if (!aside) return false;
  return now - Date.parse(aside.at) < ASIDE_DAYS * 86_400_000 && score < 2 * aside.score;
}

/** How strongly a place needs a hub: its shops count ten times a parcel. */
export function needScore(shops: number, parcels: number): number {
  return shops * 10 + parcels;
}

/**
 * Zones that need a hub, gathered: the strongest first, and every other within its reach of it counted with it — so one
 * suggestion stands for a town and its neighbouring zones, not one for each.
 */
export function gatherNeeds<Z extends { code: string; centre: { lat: number; lng: number }; score: number; reach: number }>(zones: readonly Z[], km: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number): Z[][] {
  const left = [...zones].sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  const out: Z[][] = [];
  while (left.length) {
    const top = left.shift()!;
    const group = [top];
    for (let i = left.length - 1; i >= 0; i--) {
      if (km(top.centre, left[i].centre) <= top.reach) group.push(left.splice(i, 1)[0]);
    }
    out.push(group);
  }
  return out;
}

/** The weighted middle of points: where a suggested hub would serve them best, before it is put at a known town. */
export function middleOf(points: ReadonlyArray<{ lat: number; lng: number; weight: number }>): { lat: number; lng: number } {
  const total = points.reduce((n, p) => n + Math.max(p.weight, 1), 0);
  return {
    lat: points.reduce((n, p) => n + p.lat * Math.max(p.weight, 1), 0) / total,
    lng: points.reduce((n, p) => n + p.lng * Math.max(p.weight, 1), 0) / total,
  };
}
