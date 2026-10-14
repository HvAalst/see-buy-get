import type { GeoPoint } from '../geo';
import { mapsNavUrl } from '../maps';
import { Icon } from './Icon';

export interface OpenInMapsProps {
  /** Where to navigate. Renders nothing when there is no usable coordinate. */
  point?: GeoPoint | null;
  label?: string;
}

/**
 * A deep link that opens turn-by-turn DIRECTIONS to `point` in the device's maps app (mobile-first —
 * the OS resolves the Google Maps universal URL to the native app). An anchor, not a button: the OS
 * owns the action, and it needs no map library or API key. Renders nothing when the point is missing,
 * so a caller can drop it in unconditionally.
 */
export function OpenInMaps({ point, label = 'Open in Maps' }: OpenInMapsProps) {
  const href = mapsNavUrl(point);
  if (!href) return null;
  return (
    <a class="openmaps" href={href} target="_blank" rel="noopener noreferrer">
      <Icon name="pin" size={20} />
      <span>{label}</span>
    </a>
  );
}
