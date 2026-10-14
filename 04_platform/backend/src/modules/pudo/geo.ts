import { createHash } from 'crypto';

// Network centroid for the light edition (single corridor / country). Address-only agents are placed
// deterministically NEAR this point so the coverage heatmap clusters sensibly. Swap this stub for a
// real geocoder (or require the map pin) in production.
const BASE = { lat: -1.28, lng: 36.82 }; // Nairobi-ish
const SPREAD = 0.6; // ± degrees around the centroid

/** Deterministic geocode of a free-text physical address → a stable point near the network centroid. */
export function geocodeAddress(address: string): { lat: number; lng: number } {
  const hash = createHash('sha256').update(address.trim().toLowerCase()).digest();
  const lat = BASE.lat + ((hash.readUInt16BE(0) / 65535) * SPREAD - SPREAD / 2);
  const lng = BASE.lng + ((hash.readUInt16BE(2) / 65535) * SPREAD - SPREAD / 2);
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Extra distance a driver going a→b would travel to pick up at p: dist(a,p)+dist(p,b) − dist(a,b).
 * ~0 means p is right on the route; a large value means a big backtrack. Used to suggest only the
 * loads that are genuinely "on the way".
 */
export function detourKm(a: { lat: number; lng: number }, p: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const d = haversineKm(a, p) + haversineKm(p, b) - haversineKm(a, b);
  return Math.max(0, Math.round(d * 10) / 10);
}
