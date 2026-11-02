import type { GeoPoint } from '../geo';
import { mapsNavUrl, mapsSearchUrl } from '../maps';
import { Icon } from './Icon';

export interface OpenInMapsProps {
  /** Where to navigate. Renders nothing when there is no usable coordinate. */
  point?: GeoPoint | null;
  label?: string;
  /**
   * Show the place on the maps app's own map rather than the way to it — for a place that is the person's own (their
   * hub, their shop), where directions from where they stand to where they stand are no use (2026-11-02).
   */
  show?: boolean;
}

/**
 * A deep link that opens turn-by-turn DIRECTIONS to `point` in the device's maps app (mobile-first —
 * the OS resolves the Google Maps universal URL to the native app). An anchor, not a button: the OS
 * owns the action, and it needs no map library or API key. Renders nothing when the point is missing,
 * so a caller can drop it in unconditionally.
 */
export function OpenInMaps({ point, label = 'Open in Maps', show }: OpenInMapsProps) {
  const href = show ? mapsSearchUrl(point) : mapsNavUrl(point);
  if (!href) return null;
  return (
    <a class="openmaps" href={href} target="_blank" rel="noopener noreferrer">
      <Icon name="pin" size={20} />
      <span>{label}</span>
    </a>
  );
}
