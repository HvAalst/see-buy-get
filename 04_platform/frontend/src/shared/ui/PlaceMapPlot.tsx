import { fitBounds, project, unproject, type GeoPoint } from '../geo';
import type { PlaceMapProps } from './PlaceMap';

/**
 * The dependency-free relative plot — the offline-first half of PlaceMap (formerly PlaceMap itself). A
 * bounded projection of real lat/lng into a 0–100 square: pins are buttons, drop mode turns a tap into a
 * lat/lng via the inverse projection. No tiles, no network — works on the cheapest phone. PlaceMap picks
 * between this and the Leaflet tile map (G3a); the props are identical so either can render a picker.
 */
export function PlaceMapPlot({ pins = [], lines = [], selectedId, onPick, reference, onDrop, dropped, label }: PlaceMapProps) {
  const bounds = fitBounds([...pins.map((p) => p.point), ...lines.flatMap((l) => [l.from, l.to]), reference ?? null, dropped ?? null]);

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
      {pins.length === 0 && lines.length === 0 && !reference && !dropped ? <p class="pmap__empty">Nothing to show here yet.</p> : null}

      {/* Under the pins, in the same 0-100 projection. preserveAspectRatio is none because the square
          the projection produces gets stretched to whatever box this is drawn in, and a line has to be
          stretched with it or it will not join the two dots it is between. */}
      {lines.length ? (
        <svg class="pmap__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {lines.map((l) => {
            const a = project(l.from, bounds);
            const b = project(l.to, bounds);
            const on = l.id === selectedId;
            return (
              <line
                key={l.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                class={`pmap__line${on ? ' pmap__line--on' : ''}${l.tone === 'warn' ? ' pmap__line--warn' : ''}`}
                style={`stroke-width:${0.5 + (l.weight ?? 0) * 1.6}`}
              />
            );
          })}
        </svg>
      ) : null}

      {pins.map((pin) => {
        const { x, y } = project(pin.point, bounds);
        const on = pin.id === selectedId;
        return (
          <button
            key={pin.id}
            type="button"
            class={`pmap__pin${on ? ' pmap__pin--on' : ''}${pin.tone === 'warn' ? ' pmap__pin--warn' : ''}${pin.tone === 'stop' ? ' pmap__pin--stop' : ''}`}
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
