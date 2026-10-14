import type { GeoPoint } from './geo';

/**
 * Deep links into the device's maps app — mobile-first, so a driver can hand a pickup coordinate
 * straight to turn-by-turn navigation. The Google Maps universal URLs open the native Maps app on
 * Android/iOS (and the web on desktop) and need no API key, SDK or map library — a plain link the OS
 * resolves. Both return null for a missing / non-finite point so a caller renders nothing rather than a
 * broken link.
 */

function coord(point: GeoPoint | null | undefined): string | null {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return `${point.lat},${point.lng}`;
}

/** A link that SHOWS the point on a map (drops a pin). */
export function mapsSearchUrl(point: GeoPoint | null | undefined): string | null {
  const q = coord(point);
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/** A link that opens turn-by-turn DIRECTIONS to the point (from the device's current location). */
export function mapsNavUrl(point: GeoPoint | null | undefined): string | null {
  const q = coord(point);
  return q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null;
}
