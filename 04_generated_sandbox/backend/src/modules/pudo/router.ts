import { Injectable } from '@nestjs/common';
import { GeoPoint } from './pudo.types';
import { haversineKm } from './geo';
import { ROAD_CIRCUITY_FACTOR } from './pudo.config';

/**
 * The routing seam — estimated ROAD distance, travel time and detour between points. It exists so leg
 * distances, ETAs and freight pricing stop measuring the straight-line great circle (which understates
 * a real journey by ~30–40%) and instead use a routed estimate. The sandbox binds it to HeuristicRouter
 * (haversine × a circuity factor — offline, deterministic); a production deployment swaps in an adapter
 * over a real routing engine (OSRM/Valhalla): `GET {GLOS_ROUTER_URL}/route/v1/driving/{lng},{lat};...`
 * → the route's `distance`/`duration`, falling back to the heuristic offline / on error. One provider
 * swap in pudo.module.ts, no call site moves (mirrors the GEOCODER / PUSH_SENDER pattern).
 *
 * Synchronous for the same reason as the geocoder: sandbox resolution is a local calculation, and a
 * network-backed engine that must be async is a documented deployment choice (pre-resolve, or await).
 */
export interface Router {
  /** Estimated road distance between two points (km) — straight-line inflated by the circuity factor. */
  roadKm(a: GeoPoint, b: GeoPoint): number;
  /** Estimated travel time (whole minutes, ≥1) over the road distance at `speedKmh`. */
  etaMinutes(a: GeoPoint, b: GeoPoint, speedKmh: number): number;
  /** Extra road distance to divert through `p` on the way a→b (km, ≥0, rounded to 0.1). */
  detourKm(a: GeoPoint, p: GeoPoint, b: GeoPoint): number;
}

export const ROUTER = Symbol('ROUTER');

/**
 * The sandbox router: road distance = great-circle × ROAD_CIRCUITY_FACTOR. Coarse but honest — it can't
 * know the actual road network offline, but "the crow flies 10 km, so budget ~13.5 km / ~20 min" beats
 * pricing and promising a straight line no vehicle can drive. Detour and ETA derive from the same model,
 * so a driver's "on the way" filter and a shipment's quote agree.
 */
@Injectable()
export class HeuristicRouter implements Router {
  roadKm(a: GeoPoint, b: GeoPoint): number {
    return haversineKm(a, b) * ROAD_CIRCUITY_FACTOR;
  }

  etaMinutes(a: GeoPoint, b: GeoPoint, speedKmh: number): number {
    const kmh = Number.isFinite(speedKmh) && speedKmh > 0 ? speedKmh : 40;
    return Math.max(1, Math.round((this.roadKm(a, b) / kmh) * 60));
  }

  detourKm(a: GeoPoint, p: GeoPoint, b: GeoPoint): number {
    const extra = this.roadKm(a, p) + this.roadKm(p, b) - this.roadKm(a, b);
    return Math.max(0, Math.round(extra * 10) / 10);
  }
}
