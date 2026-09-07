import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { GeoPoint } from '../geo';
import { PlaceMapPlot } from './PlaceMapPlot';
import { Icon } from './Icon';

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
