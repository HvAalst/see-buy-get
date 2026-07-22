import type { GeoPoint } from '../geo';
import { fitBounds, project, unproject } from '../geo';

export interface PlaceMapPin {
  id: string;
  label: string;
  point: GeoPoint;
}

export interface PlaceMapProps {
  /** Tappable places (pick mode) — rendered as blue dots with name chips. */
  pins?: PlaceMapPin[];
  selectedId?: string | null;
  onPick?: (id: string) => void;
  /** The person's own position (typed place words, the store pin) — the orange locator dot. */
  reference?: GeoPoint | null;
  /** Drop mode: tapping empty surface calls back with the lat/lng under the finger. */
  onDrop?: (p: GeoPoint) => void;
  /** The current dropped pin (drop mode). */
  dropped?: GeoPoint | null;
  /** AT description of the whole surface. */
  label: string;
}

/**
 * The dependency-free map every picker shares: a bounded relative plot (the fleet console
 * proved the pattern) — no tiles, no network, works offline on the cheapest phone. Pins
 * are real buttons (the row list beside it remains the screen-reader path); in drop mode
 * a tap anywhere becomes a lat/lng via the same projection, inverted.
 *
 * This is a PICTURE of relative positions, not cartography — and that is the point: where
 * this network runs, "which dot is nearest the reference dot" answers what a street
 * address cannot.
 */
export function PlaceMap({ pins = [], selectedId, onPick, reference, onDrop, dropped, label }: PlaceMapProps) {
  const bounds = fitBounds([...pins.map((p) => p.point), reference ?? null, dropped ?? null]);

  const drop = (e: MouseEvent) => {
    if (!onDrop) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    onDrop(unproject(x, y, bounds));
  };

  return (
    <div
      class={`pmap${onDrop ? ' pmap--drop' : ''}`}
      role={onDrop ? 'button' : 'img'}
      aria-label={label}
      onClick={onDrop ? (drop as unknown as (e: Event) => void) : undefined}
    >
      {pins.length === 0 && !reference && !dropped ? <p class="pmap__empty">Nothing to show here yet.</p> : null}

      {pins.map((pin) => {
        const { x, y } = project(pin.point, bounds);
        const on = pin.id === selectedId;
        return (
          <button
            key={pin.id}
            type="button"
            class={`pmap__pin${on ? ' pmap__pin--on' : ''}`}
            style={`left:${x}%;top:${y}%`}
            aria-pressed={on}
            aria-label={pin.label}
            onClick={(e) => {
              e.stopPropagation();
              onPick?.(pin.id);
            }}
          >
            <span class="pmap__dot" aria-hidden="true" />
            <span class="pmap__lbl" aria-hidden="true">
              {pin.label}
            </span>
          </button>
        );
      })}

      {dropped ? <Marker point={dropped} bounds={bounds} kind="dropped" /> : null}
      {reference ? <Marker point={reference} bounds={bounds} kind="ref" /> : null}
    </div>
  );
}

function Marker({ point, bounds, kind }: { point: GeoPoint; bounds: ReturnType<typeof fitBounds>; kind: 'ref' | 'dropped' }) {
  const { x, y } = project(point, bounds);
  return (
    <span class={`pmap__mark pmap__mark--${kind}`} style={`left:${x}%;top:${y}%`} aria-hidden="true">
      <span class="pmap__mark-dot" />
      <span class="pmap__mark-lbl">{kind === 'ref' ? 'here' : 'your pin'}</span>
    </span>
  );
}
