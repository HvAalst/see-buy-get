import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { haversineKm, type GeoPoint } from '../geo';
import { PlaceMapPlot } from './PlaceMapPlot';
import { Icon } from './Icon';

export interface PlaceMapPin {
  id: string;
  label: string;
  point: GeoPoint;
  /**
   * A warning — something reported on a road — drawn as a red diamond, so it is told from a place without colour. A
   * stop — the place a line ends, somebody's next stop — drawn as a ring, under everything else, so a vehicle or a
   * warning standing on top of it keeps its tap.
   */
  tone?: 'warn' | 'stop';
}

/**
 * A PAIR OF PLACES, DRAWN AS A LINE — a lane, a corridor, a leg between two known ends.
 *
 * IT IS NOT A ROUTE AND MUST NEVER BE LABELLED AS ONE. We know where something starts and where it
 * finishes; we do not know the road it takes, and a straight line drawn across a map reads as a road to
 * anybody who is not thinking about it. Whatever renders this has to say what it is. (The honest way to
 * draw a real road is from the GPS trail of legs that were actually driven, which is a different
 * feature with a different claim behind it.)
 *
 * A weight of 0..1 scales the stroke, so a busy pair reads heavier than a quiet one without needing a
 * second colour, and the tone marks the one the reader has singled out.
 */
export interface PlaceMapLine {
  id: string;
  label: string;
  from: GeoPoint;
  to: GeoPoint;
  weight?: number;
  tone?: 'plain' | 'warn';
}

export interface PlaceMapProps {
  /** Tappable places (pick mode) — rendered as blue dots with name chips. */
  pins?: PlaceMapPin[];
  /** Pairs of places drawn as lines. See PlaceMapLine: a pair of ends, never a route. */
  lines?: PlaceMapLine[];
  selectedId?: string | null;
  onPick?: (id: string) => void;
  /** The person's own position (typed place words, the store pin) — the orange locator dot. */
  reference?: GeoPoint | null;
  /** Drop mode: tapping the surface calls back with the lat/lng under the finger. */
  onDrop?: (p: GeoPoint) => void;
  /** The current dropped pin (drop mode). */
  dropped?: GeoPoint | null;
  /** AT description of the whole surface. */
  label: string;
  /**
   * Render at full height, for a map opened deliberately rather than one embedded in a card.
   *
   * A 220px strip is right for "where is this shop" beside the thing it describes, and wrong for a map
   * somebody opened ON PURPOSE to read — which is every reason to open one at all.
   */
  tall?: boolean;
  /**
   * With a marked place (`reference`): frame it and this many of the pins nearest to it, rather than every pin. For a
   * picker of shops near a place, where the person has to SEE that the place is theirs (the user, 2026-10-25: a
   * newcomer "has no way to confirm" a place on a map of the whole network). Unset, every pin is framed, as before.
   */
  nearest?: number;
}

/** How far a pin may be and still be framed with a marked place: past this, the place is shown alone, close up. */
export const FRAME_NEAR_KM = 50;

/**
 * What the map's view is fitted to: every pin, the marked place and a dropped pin — or, with `nearest` and a marked
 * place, that place and its `nearest` closest pins within FRAME_NEAR_KM. Pure, for the test; the markers drawn are
 * all of them either way.
 */
export function framedPoints({ pins = [], reference, dropped, nearest }: Pick<PlaceMapProps, 'pins' | 'reference' | 'dropped' | 'nearest'>): GeoPoint[] {
  if (reference && nearest && nearest > 0) {
    const close = pins
      .map((pin) => ({ point: pin.point, km: haversineKm(reference, pin.point) }))
      .filter((p) => p.km <= FRAME_NEAR_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, nearest)
      .map((p) => p.point);
    return [reference, ...close, ...(dropped ? [dropped] : [])];
  }
  return [...pins.map((p) => p.point), ...(reference ? [reference] : []), ...(dropped ? [dropped] : [])];
}

export type MapMode = 'map' | 'plot';
const STORE_KEY = 'sbg:mapmode';

/**
 * Which view to show first. A stored choice always wins (the user's toggle is remembered); otherwise
 * default to the real map when online, and the offline-first dot-plot when not. Pure + exported for the
 * unit test.
 */
export function initialMapMode(online: boolean, stored: string | null): MapMode {
  if (stored === 'map' || stored === 'plot') return stored;
  return online ? 'map' : 'plot';
}

function readMode(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORE_KEY) ?? null;
  } catch {
    return null;
  }
}
function writeMode(mode: MapMode): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, mode);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}

type MapComponent = (props: PlaceMapProps) => JSX.Element;

/**
 * The location picker (G3a). A real OpenStreetMap tile map when the user wants it and is online, and the
 * dependency-free dot-plot otherwise — with a toggle to switch, remembered across sessions. Leaflet is
 * LAZY-loaded only when the map is actually shown, so an offline session or an app that never opens the
 * map pays nothing for it. Falls back to the plot (with a note) when offline or if the map fails to load.
 */
export function PlaceMap(props: PlaceMapProps) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [mode, setMode] = useState<MapMode>(() => initialMapMode(typeof navigator === 'undefined' ? true : navigator.onLine, readMode()));
  const [MapComp, setMapComp] = useState<MapComponent | null>(null);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const wantMap = mode === 'map' && online && !mapError;

  // Lazy-load the Leaflet map only when it is actually wanted.
  useEffect(() => {
    if (!wantMap || MapComp) return;
    let live = true;
    void import('./PlaceMapLeaflet')
      .then((m) => {
        if (live) setMapComp(() => m.PlaceMapLeaflet);
      })
      .catch(() => {
        if (live) setMapError(true);
      });
    return () => {
      live = false;
    };
  }, [wantMap, MapComp]);

  const choose = (m: MapMode) => {
    setMode(m);
    writeMode(m);
    // Re-tapping "Map" clears a prior load failure so a transient chunk-load blip isn't a permanent latch.
    if (m === 'map') setMapError(false);
  };

  const showMap = wantMap && MapComp;

  return (
    <div class={`pmap-wrap${props.tall ? ' pmap-wrap--tall' : ''}`}>
      <div class="pmap-toggle" role="group" aria-label="Map view">
        <button type="button" class={`pmap-toggle__btn${mode === 'map' ? ' is-on' : ''}`} aria-pressed={mode === 'map'} onClick={() => choose('map')}>
          <Icon name="pin" size={18} /> Map
        </button>
        <button type="button" class={`pmap-toggle__btn${mode === 'plot' ? ' is-on' : ''}`} aria-pressed={mode === 'plot'} onClick={() => choose('plot')}>
          <Icon name="grid" size={18} /> Simple
        </button>
      </div>

      {showMap ? <MapComp {...props} /> : <PlaceMapPlot {...props} />}

      {/* One reason at a time: offline is the recoverable case; a load failure is the terminal one. */}
      {mode === 'map' && !online ? (
        <p class="pmap-note">Map needs a connection — showing the simple view.</p>
      ) : mapError ? (
        <p class="pmap-note">Map unavailable — showing the simple view.</p>
      ) : null}
    </div>
  );
}
