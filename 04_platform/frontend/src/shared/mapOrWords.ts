import { useEffect, useState } from 'preact/hooks';
import { useConnectivity } from './connectivity';
import { deviceCountry, rememberedCountry } from './phone/dial';

/**
 * A PLACE SHOWN: A MAP FIRST, OR ITS THREE WORDS FIRST — ONE RULE FOR EVERY SCREEN (the owner, 2026-11-02: "I get the
 * three words for my location but I prefer the map if the connection is good. That could be country specific:
 * developed nations map by default, otherwise based on connectivity").
 *
 * A map costs data: a small one is six map tiles from OpenStreetMap, about 60–200 KB. Where a gigabyte costs a sliver of
 * a month's income and 4G reaches nearly everyone, nobody notices that; on a pay-as-you-go bundle on a weak signal, it is
 * the most expensive thing on the screen and tells a person less than the three words do. So:
 *
 *  1. No signal: the words. A map cannot load.
 *  2. The phone asks to save data (`navigator.connection.saveData`, the browser's Data Saver / Lite mode): the words,
 *     wherever it is. The person said so.
 *  3. A good connection now — the browser measures it as 4G, and not slower than MIN_DOWNLINK_MBPS where it says the
 *     speed: the map, in any country.
 *  4. A country where data is cheap and fast (MAP_FIRST_COUNTRIES) — the place's, else the person's: the map, whatever
 *     the measure says. "Developed nations map by default".
 *  5. Anything else: the words, with "Show the map" one tap away.
 *
 * Only Chrome-family browsers say anything about the connection; an iPhone's Safari says nothing at all, and then the
 * country decides (rule 4, else 5). Where the map shows, the three words stay beneath it, smaller: they are still what a
 * person says to a driver and paints on the sign.
 */
export type PlaceFirst = 'map' | 'words';

/** What the browser says about the connection (the Network Information API) — all of it optional, most of it absent. */
export interface ConnectionInfo {
  saveData?: boolean;
  /** 'slow-2g' | '2g' | '3g' | '4g' — the browser's own measure of round trips and speed, not the radio's name. */
  effectiveType?: string;
  /** Megabits a second, as measured (Chrome rounds it, and caps it at 10). */
  downlink?: number;
}

/**
 * WHERE DATA IS CHEAP AND FAST: the map by default (2026-11-02). High-income countries whose mobile networks reach nearly
 * everybody at 4G or better and where a gigabyte of mobile data costs far less than the UN Broadband Commission's
 * affordability line (1 GB for at most 2% of a month's income) — the line much of East Africa is still above. Named,
 * short and on purpose: a country missing from it loses nothing, because a good connection there brings the map anyway
 * (rule 3), and one wrongly on it would spend somebody's bundle.
 *
 * The European Union (27), the rest of the European Economic Area (Iceland, Liechtenstein, Norway), Switzerland, the
 * United Kingdom, the United States, Canada, Australia, New Zealand, Japan, South Korea, Singapore, and the six Gulf
 * states (the United Arab Emirates, Bahrain, Kuwait, Oman, Qatar, Saudi Arabia).
 */
export const MAP_FIRST_COUNTRIES: readonly string[] = [
  // The European Union
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // The rest of the European Economic Area, Switzerland and the United Kingdom
  'IS', 'LI', 'NO', 'CH', 'GB',
  // North America, Oceania, East Asia
  'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG',
  // The Gulf
  'AE', 'BH', 'KW', 'OM', 'QA', 'SA',
];
const MAP_FIRST = new Set(MAP_FIRST_COUNTRIES);

/**
 * The slowest measured speed a map is shown at unasked. The browser calls anything from about 0.7 Mbit/s "4g"; a small
 * map and its tiles (up to ~200 KB) take about a second at 1.5, and two or more below it — long enough to watch a grey
 * box fill in, on data somebody paid for.
 */
export const MIN_DOWNLINK_MBPS = 1.5;

/** Is this a country where the map comes first? ISO 3166 alpha-2, any case. */
export function isMapFirstCountry(country: string | null | undefined): boolean {
  return Boolean(country) && MAP_FIRST.has(country!.toUpperCase());
}

/** The browser measures a good connection now: 4G, and (where it says the speed) not slower than MIN_DOWNLINK_MBPS. */
function goodNow(c: ConnectionInfo | null): boolean {
  if (!c || c.effectiveType !== '4g') return false;
  return typeof c.downlink !== 'number' || c.downlink >= MIN_DOWNLINK_MBPS;
}

/** THE RULE — pure, for the test: a map first, or the three words first. See the module's comment for why each step. */
export function mapOrWords({ country, online, connection }: { country?: string | null; online: boolean; connection: ConnectionInfo | null }): PlaceFirst {
  if (!online) return 'words';
  if (connection?.saveData) return 'words';
  if (goodNow(connection)) return 'map';
  if (isMapFirstCountry(country)) return 'map';
  return 'words';
}

type NetworkInformation = ConnectionInfo & { addEventListener?: (type: 'change', fn: () => void) => void; removeEventListener?: (type: 'change', fn: () => void) => void };

function connectionObject(): NetworkInformation | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { connection?: NetworkInformation }).connection ?? null;
}

/** What this browser says about the connection now — null where it says nothing (Safari, Firefox). */
export function readConnection(): ConnectionInfo | null {
  const c = connectionObject();
  if (!c) return null;
  return { saveData: c.saveData, effectiveType: c.effectiveType, downlink: c.downlink };
}

/** The person's own country, where the place says none: the one they chose for a number before, else the phone's. */
export function personCountry(): string | undefined {
  return rememberedCountry() ?? deviceCountry();
}

/**
 * The rule, live: answered again when the signal comes or goes, and when the browser measures the connection anew. The
 * place's country, else the person's.
 */
export function useMapOrWords(country?: string | null): PlaceFirst {
  const { online } = useConnectivity();
  const [connection, setConnection] = useState<ConnectionInfo | null>(() => readConnection());
  useEffect(() => {
    const c = connectionObject();
    if (!c?.addEventListener) return;
    const changed = () => setConnection(readConnection());
    c.addEventListener('change', changed);
    return () => c.removeEventListener?.('change', changed);
  }, []);
  return mapOrWords({ country: country || personCountry(), online, connection });
}
