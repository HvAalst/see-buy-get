import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { haversineKm, type GeoPoint } from '../geo';
import { useT } from '../i18n';
import { canLocate, currentPosition } from '../position';
import { PlaceMapPlot } from './PlaceMapPlot';
import { Icon } from './Icon';

export interface PlaceMapPin {
  id: string;
  label: string;
  point: GeoPoint;
  /**
   * A warning — something reported on a road — drawn as a red diamond, so it is told from a place without colour. A
   * stop — the place a line ends, somebody's next stop — drawn as a ring, under everything else, so a vehicle or a
   * warning standing on top of it keeps its tap. A vehicle that broke down — `down` — a dot like any vehicle, in the
   * danger red: told from a hazard by its shape and from a vehicle on the move by its colour (2026-10-25).
   */
  tone?: 'warn' | 'stop' | 'down';
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
  /**
   * The closest the map frames itself — a map of countries is read at a country's scale, never a street's (the logistics
   * directory, 2026-10-30). Unset: a street's, as for a shop.
   */
  maxZoom?: number;
  /**
   * Where the map looks while it has nothing to frame — no pin, no marked place, nothing dropped (2026-10-30: a Dutch
   * number signing up was shown Nairobi). A point and how close: a country's middle at 6.
   */
  start?: { point: GeoPoint; zoom: number };
  /**
   * 2026-11-19 — Ask the phone where it is as the map opens, and look there (see `asksWhereYouAre`). Unset: a map a pin is
   * put on (`onDrop`) asks; `false` for a screen that finds the phone itself.
   */
  findHere?: boolean;
}

/** The whole world: where a map looks when nothing better is known — never one country's city for everybody. */
export const WORLD_VIEW = { point: { lat: 15, lng: 15 }, zoom: 2 };
/** How close a map opened where the phone is looks: the streets around it. */
export const HERE_ZOOM = 14;

/**
 * 2026-11-19 — A MAP A PIN IS PUT ON OPENS WHERE THE PHONE IS (the owner, in the Business app's "Save a new place": "the map
 * opens nairobi, but I am in the Netherlands. It could open somewhat around my current location or else it can ask me to turn
 * it on"). Asked once, as the map opens, when there is nothing on it to look at yet — no pin, no place marked, no line. A map
 * with something on it frames that instead, and asks nothing. Pure, for the test.
 */
export function asksWhereYouAre(p: Pick<PlaceMapProps, 'findHere' | 'onDrop' | 'pins' | 'lines' | 'reference' | 'dropped'>): boolean {
  if (!(p.findHere ?? Boolean(p.onDrop))) return false;
  return !(p.pins?.length || p.lines?.length || p.reference || p.dropped);
}

/** Ask where the phone is: the point, or `off` — refused, not to be had in time, or no way to ask at all. */
export async function whereYouAre(can: () => boolean = canLocate, ask: (timeoutMs: number) => Promise<GeoPoint | null> = currentPosition): Promise<{ state: 'idle' | 'off'; point?: GeoPoint }> {
  if (!can()) return { state: 'off' };
  const point = await ask(10_000);
  return point ? { state: 'idle', point } : { state: 'off' };
}

/**
 * The line under the map about where the phone is: finding it, or how to turn location on — until a pin is down, also one
 * tapped before the phone answered; after that it is noise.
 */
export function hereNote(state: 'idle' | 'asking' | 'off', dropped: GeoPoint | null | undefined): 'locating' | 'off' | null {
  if (dropped) return null;
  return state === 'asking' ? 'locating' : state === 'off' ? 'off' : null;
}

/** Where a map with nothing to frame looks: where the phone is, else where its screen said, else the whole world. */
export function viewWithNothingToFrame(here: GeoPoint | null | undefined, start: PlaceMapProps['start']): { point: GeoPoint; zoom: number } {
  return here ? { point: here, zoom: HERE_ZOOM } : (start ?? WORLD_VIEW);
}

/** How far a pin may be and still be framed with a marked place: past this, the place is shown alone, close up. */
export const FRAME_NEAR_KM = 50;

/**
 * What the map's view is fitted to: every pin, the marked place and a dropped pin — or, with `nearest` and a marked
 * place, that place and its `nearest` closest pins within FRAME_NEAR_KM. Pure, for the test; the markers drawn are
 * all of them either way.
 */
export function framedPoints({ pins = [], reference, dropped, nearest }: Pick<PlaceMapProps, 'pins' | 'reference' | 'dropped' | 'nearest'>): GeoPoint[] {
  // 2026-11-12 — with no marked place, a dropped pin anchors it: a sign-up framed on the pin and the shops nearest it.
  const anchor = reference ?? dropped;
  if (anchor && nearest && nearest > 0) {
    const close = pins
      .map((pin) => ({ point: pin.point, km: haversineKm(anchor, pin.point) }))
      .filter((p) => p.km <= FRAME_NEAR_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, nearest)
      .map((p) => p.point);
    return [...(reference ? [reference] : []), ...close, ...(dropped ? [dropped] : [])];
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
  const t = useT();
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

  // Where the phone is, asked once as the map opens with nothing on it; refused or not to be had, how to turn it on.
  const [here, setHere] = useState<{ state: 'idle' | 'asking' | 'off'; point?: GeoPoint }>(() => ({ state: asksWhereYouAre(props) ? 'asking' : 'idle' }));
  const alive = useRef(true);
  const findHere = useCallback(() => {
    setHere({ state: 'asking' });
    void whereYouAre().then((found) => {
      if (alive.current) setHere(found);
    });
  }, []);
  useEffect(() => {
    alive.current = true;
    if (here.state === 'asking') findHere();
    return () => {
      alive.current = false;
    };
  }, []);
  const shown: PlaceMapProps = { ...props, start: viewWithNothingToFrame(here.point, props.start) };
  const note = hereNote(here.state, props.dropped);

  const wantMap = mode === 'map' && online && !mapError;

  // Lazy-load the Leaflet map only when it is actually wanted.
  useEffect(() => {
    if (!wantMap || MapComp) return;
    let live = true;
    // 2026-11-03 — asked once more before giving up (the owner: "the map is unavailable"): a blip in the signal, or a page
    // opened before the last release asking for the map as that release had it. Still not there: the note offers a reload.
    const load = () => import('./PlaceMapLeaflet');
    void load()
      .catch(() => new Promise<Awaited<ReturnType<typeof load>>>((resolve, reject) => setTimeout(() => load().then(resolve, reject), 1500)))
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

      {showMap ? <MapComp {...shown} /> : <PlaceMapPlot {...shown} />}

      {/* One reason at a time: offline is the recoverable case; a load failure is the terminal one. */}
      {mode === 'map' && !online ? (
        <p class="pmap-note">Map needs a connection — showing the simple view.</p>
      ) : mapError ? (
        <p class="pmap-note">
          Map unavailable — showing the simple view.{' '}
          <button type="button" class="linkbtn" onClick={() => globalThis.location?.reload()}>
            Reload to try the map again
          </button>
        </p>
      ) : null}
      {/* Until a pin is down: finding where the phone is, or how to let it say. */}
      {note === 'locating' ? (
        <p class="pmap-note" role="status">
          {t('place.sheet.locating')}
        </p>
      ) : null}
      {note === 'off' ? (
        <p class="pmap-note">
          {t('place.sheet.locOff')}{' '}
          <button type="button" class="linkbtn" onClick={findHere}>
            {t('place.map.locShow')}
          </button>
        </p>
      ) : null}
    </div>
  );
}
