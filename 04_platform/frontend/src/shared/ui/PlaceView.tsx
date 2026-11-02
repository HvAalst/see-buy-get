import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { GeoPoint } from '../geo';
import { useConnectivity } from '../connectivity';
import { useT } from '../i18n';
import { useMapOrWords } from '../mapOrWords';
import { toPlaceWords } from '../placewords';
import { Button } from './Button';
import { Icon } from './Icon';
import { OpenInMaps } from './OpenInMaps';
import { ReadAloud } from './ReadAloud';
import { StaticMap } from './StaticMap';

export interface PlaceWordsProps {
  point: GeoPoint;
  /** The sentence said aloud, given the three words with commas between them, so a voice pauses after each. */
  aloud: (words: string) => string;
  aloudLabel: string;
  /** A line under the words: what they are for ("Say these three words and anyone can find you"). */
  note?: string;
  /** Under a map that already shows the place: a step smaller, the map being the first thing read. */
  under?: boolean;
  /** Further actions beside the say-aloud. */
  children?: ComponentChildren;
}

/**
 * A PLACE'S THREE WORDS, AND THE WAY TO HEAR THEM — the one place they are drawn (2026-11-02). Shown alone only where a
 * map is already on the screen above them, to set the pin with (the sign-up's where step, the Shop's and the Store's own
 * pin); everywhere a place is only SHOWN, PlaceView decides between a map and the words first. A guard holds every screen
 * to that (PlaceView.test.tsx).
 */
export function PlaceWords({ point, aloud, aloudLabel, note, under, children }: PlaceWordsProps) {
  const words = toPlaceWords(point);
  return (
    <>
      <p class={`words${under ? ' words--under' : ''}`}>{words}</p>
      {note ? <p class="card__note">{note}</p> : null}
      <div class="placewords__acts">
        <ReadAloud text={() => aloud(words.split(' ').join(', '))} label={aloudLabel} />
        {children}
      </div>
    </>
  );
}

export interface PlaceViewProps extends Omit<PlaceWordsProps, 'under' | 'children'> {
  /** The place's country — which, where the browser measures nothing, decides (shared/mapOrWords.ts). Else the person's. */
  country?: string | null;
  /** What the map shows, for a screen reader. */
  mapLabel: string;
  /**
   * "Open in maps" under the map: the maps app's own map of the place. Off where the screen already has its way there
   * (the Send app's "Show me the way").
   */
  openInMaps?: boolean;
}

/**
 * A PLACE SHOWN — a small map of it first where the connection can spare one, else its three words first with the map one
 * tap away (the owner, 2026-11-02: "I get the three words for my location but I prefer the map if the connection is good.
 * That could be country specific: developed nations map by default, otherwise based on connectivity"). The rule is
 * shared/mapOrWords.ts. Under a map the words stay, a step smaller, with their say-aloud: they are still what a person
 * says to a driver and paints on the sign. No signal: the words alone, and no offer of a map that cannot load.
 */
export function PlaceView({ point, country, mapLabel, openInMaps = true, ...words }: PlaceViewProps) {
  const t = useT();
  const first = useMapOrWords(country);
  const { online } = useConnectivity();
  const [asked, setAsked] = useState(false);
  // A map once on screen stays while the screen is open: the browser measuring the connection again a little slower is
  // no reason to take away what has already been downloaded.
  useEffect(() => {
    if (first === 'map') setAsked(true);
  }, [first]);
  const showMap = online && (first === 'map' || asked);

  return (
    <div class="placeview">
      {showMap ? <StaticMap point={point} label={mapLabel} /> : null}
      <PlaceWords {...words} point={point} under={showMap}>
        {showMap && openInMaps ? <OpenInMaps point={point} label={t('common.place.openInMaps')} show /> : null}
        {!showMap && online ? (
          <Button variant="link" full={false} onClick={() => setAsked(true)}>
            <span class="btn__row">
              <Icon name="pin" size={20} />
              {t('common.place.showMap')}
            </span>
          </Button>
        ) : null}
      </PlaceWords>
    </div>
  );
}
