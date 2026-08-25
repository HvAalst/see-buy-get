/**
 * Pure geometry shared by every map surface — no DOM, no fetch, unit-tested.
 *
 * The apps draw dependency-free relative plots (the fleet console proved the pattern):
 * fit a bounding box around the points, project into a 0–100 square with padding, and
 * clamp so a pin never clips the frame. `unproject` inverts the same box so a tap on the
 * surface becomes a lat/lng — which is what makes drop-a-pin possible without tiles.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** The sandbox network's home box — used when there is nothing to fit yet. */
export const DEFAULT_BOUNDS: GeoBounds = { minLat: -1.4, maxLat: -1.1, minLng: 36.6, maxLng: 37.0 };

/** Where a pin came from: looked up FROM a typed name, or dropped on the map by hand. */
export type PinSource = 'name' | 'map' | null;

/**
 * What happens to a pin when the name beside it is edited.
 *
 * A pin the geocoder found IS the name: the moment the name changes it points at a place nobody asked for.
 * A pin dropped by hand is the person's own answer about where somewhere is, and correcting a spelling must
 * not throw it away. Shared because every "name it and pin it" surface in the network has this same rule —
 * a consolidation lot's two ends, a driver's road.
 */
export function pinAfterRename(pin: GeoPoint | null, from: PinSource): GeoPoint | null {
  return from === 'name' ? null : pin;
}

/**
 * A box around the points with breathing room. One point (or a degenerate cluster) gets a
 * minimum span instead of a divide-by-zero; no points falls back to the network box.
 */
export function fitBounds(points: Array<GeoPoint | undefined | null>, pad = 0.05, minSpan = 0.08): GeoBounds {
  const pts = points.filter((p): p is GeoPoint => Boolean(p));
  if (pts.length === 0) return DEFAULT_BOUNDS;
  let minLat = Math.min(...pts.map((p) => p.lat)) - pad;
  let maxLat = Math.max(...pts.map((p) => p.lat)) + pad;
  let minLng = Math.min(...pts.map((p) => p.lng)) - pad;
  let maxLng = Math.max(...pts.map((p) => p.lng)) + pad;
  if (maxLat - minLat < minSpan) {
    const c = (maxLat + minLat) / 2;
    minLat = c - minSpan / 2;
    maxLat = c + minSpan / 2;
  }
  if (maxLng - minLng < minSpan) {
    const c = (maxLng + minLng) / 2;
    minLng = c - minSpan / 2;
    maxLng = c + minSpan / 2;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Project into the 0–100 plot square, clamped to 4–96 / 6–94 so pins never clip. */
export function project(p: GeoPoint, b: GeoBounds): { x: number; y: number } {
  const spanLat = b.maxLat - b.minLat || 1;
  const spanLng = b.maxLng - b.minLng || 1;
  return {
    x: Math.max(4, Math.min(96, ((p.lng - b.minLng) / spanLng) * 100)),
    y: Math.max(6, Math.min(94, ((b.maxLat - p.lat) / spanLat) * 100)),
  };
}

/** Invert the projection: a tap at (x%, y%) of the surface becomes a lat/lng. */
export function unproject(x: number, y: number, b: GeoBounds): GeoPoint {
  const spanLat = b.maxLat - b.minLat || 1;
  const spanLng = b.maxLng - b.minLng || 1;
  return {
    lat: b.maxLat - (Math.max(0, Math.min(100, y)) / 100) * spanLat,
    lng: b.minLng + (Math.max(0, Math.min(100, x)) / 100) * spanLng,
  };
}

/** Great-circle distance in km — good enough at city scale, tested against a known pair. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** "400 m away" / "2.3 km away" — never a bare number, never false precision. */
export function distanceLabel(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}
