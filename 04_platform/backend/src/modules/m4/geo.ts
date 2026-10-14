import { createHash } from 'crypto';

// Shared geo helpers for M4 (ETA distance, geofence intersection, route-deviation). Distances are
// derived from a deterministic geocode of place names — the same stub M2 uses to place geofences,
// so M4's computed distances line up with the planned route.

export function geocode(name: string): { lat: number; lng: number } {
  const hash = createHash('sha256').update(name).digest();
  const lat = (hash.readUInt16BE(0) / 65535) * 120 - 60;
  const lng = (hash.readUInt16BE(2) / 65535) * 360 - 180;
  return { lat, lng };
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Indicative line-haul speed per mode (km/h) for ETA estimation. */
export const MODE_SPEED_KMH: Record<string, number> = { courier: 30, road: 60, rail: 50, air: 700, ocean: 35, multimodal: 45 };
export const DEFAULT_SPEED_KMH = 50;
