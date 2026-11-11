import { GeoPoint } from './pudo.types';
import { haversineKm } from './geo';

/**
 * Offline gazetteer — REAL coordinates for the places this network actually runs in: Nairobi and its
 * neighbourhoods, the metro towns, and Kenya's major towns (the corridor endpoints). It exists so a
 * free-text address or zone resolves to a TRUE location without a live geocoder, which the sandbox
 * cannot reach — the same constraint that makes push delivery a stub. A production HttpGeocoder
 * (Nominatim/commercial) is the swap for full street-level coverage; this covers the named places the
 * product already knows about.
 *
 * Coordinates are town / neighbourhood centroids (accurate to within a couple of km) — enough for
 * relative positioning, nearest-PUDO ranking and leg distance, not for turn-by-turn navigation.
 */
export interface GazetteerEntry {
  name: string;
  location: GeoPoint;
  aliases?: string[];
  /** A broad container (a whole city) — a more specific place inside it wins when both are named. */
  broad?: boolean;
  /**
   * 2026-11-11 — THE COUNTRY IT IS IN (ISO 3166 alpha-2). Names cross borders — a Busia on each side of Kenya and Uganda, a
   * Moyale on each side of Kenya and Ethiopia — so a lookup that knows the reader's country keeps to it.
   */
  country: string;
}

/** As each country's list writes a place: its country is the list's. */
type PlaceEntry = Omit<GazetteerEntry, 'country'>;

const KENYA: PlaceEntry[] = [
  // --- Nairobi + neighbourhoods ---
  { name: 'Nairobi', location: { lat: -1.2864, lng: 36.8172 }, aliases: ['nairobi cbd', 'cbd', 'nairobi city', 'biashara street', 'city centre'], broad: true },
  { name: 'Westlands', location: { lat: -1.2673, lng: 36.8065 } },
  { name: 'Parklands', location: { lat: -1.262, lng: 36.818 } },
  { name: 'Riverside', location: { lat: -1.273, lng: 36.805 } },
  { name: 'Kilimani', location: { lat: -1.2906, lng: 36.7856 } },
  { name: 'Lavington', location: { lat: -1.2793, lng: 36.7684 } },
  { name: 'Karen', location: { lat: -1.3197, lng: 36.7085 } },
  { name: 'Langata', location: { lat: -1.326, lng: 36.75 } },
  { name: 'Kibera', location: { lat: -1.3133, lng: 36.7892 } },
  { name: 'Ngara', location: { lat: -1.2757, lng: 36.83 } },
  { name: 'Eastleigh', location: { lat: -1.2733, lng: 36.847 } },
  { name: 'Gikomba', location: { lat: -1.283, lng: 36.835 } },
  { name: 'South B', location: { lat: -1.308, lng: 36.837 } },
  { name: 'South C', location: { lat: -1.32, lng: 36.828 } },
  { name: 'Embakasi', location: { lat: -1.32, lng: 36.894 } },
  { name: 'Donholm', location: { lat: -1.292, lng: 36.888 } },
  { name: 'Buruburu', location: { lat: -1.285, lng: 36.872 } },
  { name: 'Kasarani', location: { lat: -1.221, lng: 36.898 } },
  { name: 'Roysambu', location: { lat: -1.219, lng: 36.888 } },
  { name: 'Ruaraka', location: { lat: -1.247, lng: 36.872 } },
  // --- Nairobi metro towns ---
  { name: 'Thika', location: { lat: -1.0333, lng: 37.0693 } },
  { name: 'Ruiru', location: { lat: -1.145, lng: 36.958 } },
  { name: 'Kiambu', location: { lat: -1.1714, lng: 36.8356 } },
  { name: 'Kikuyu', location: { lat: -1.247, lng: 36.663 } },
  { name: 'Limuru', location: { lat: -1.1, lng: 36.642 } },
  { name: 'Ngong', location: { lat: -1.3536, lng: 36.6543 } },
  { name: 'Athi River', location: { lat: -1.456, lng: 36.978 }, aliases: ['mavoko'] },
  { name: 'Machakos', location: { lat: -1.5177, lng: 37.2634 } },
  { name: 'Kajiado', location: { lat: -1.8523, lng: 36.7767 } },
  // --- major towns / corridor endpoints ---
  { name: 'Mombasa', location: { lat: -4.0435, lng: 39.6682 } },
  { name: 'Kisumu', location: { lat: -0.0917, lng: 34.768 } },
  { name: 'Nakuru', location: { lat: -0.3031, lng: 36.08 } },
  { name: 'Eldoret', location: { lat: 0.5143, lng: 35.2698 } },
  { name: 'Nyeri', location: { lat: -0.4169, lng: 36.9514 } },
  { name: 'Meru', location: { lat: 0.05, lng: 37.65 } },
  { name: 'Embu', location: { lat: -0.531, lng: 37.4575 } },
  { name: 'Nanyuki', location: { lat: 0.0167, lng: 37.0725 } },
  { name: 'Naivasha', location: { lat: -0.7167, lng: 36.431 } },
  { name: 'Kericho', location: { lat: -0.3689, lng: 35.2831 } },
  { name: 'Kakamega', location: { lat: 0.2827, lng: 34.7519 } },
  { name: 'Kisii', location: { lat: -0.6817, lng: 34.768 } },
  { name: 'Bungoma', location: { lat: 0.5635, lng: 34.5606 } },
  { name: 'Kitale', location: { lat: 1.0157, lng: 35.0062 } },
  { name: 'Malindi', location: { lat: -3.2199, lng: 40.1169 } },
  { name: 'Kilifi', location: { lat: -3.6305, lng: 39.8499 } },
  { name: 'Voi', location: { lat: -3.3967, lng: 38.5561 } },
  { name: 'Garissa', location: { lat: -0.4536, lng: 39.6401 } },
  { name: 'Isiolo', location: { lat: 0.3546, lng: 37.5822 } },
  { name: 'Kitui', location: { lat: -1.3745, lng: 38.0106 } },
  { name: 'Lamu', location: { lat: -2.2717, lng: 40.902 } },
  { name: 'Moyale', location: { lat: 3.5231, lng: 39.0553 }, aliases: ['moyale border'] },
];

const ETHIOPIA: PlaceEntry[] = [
  // --- Ethiopia: the second country the network operates in ---
  // Added when a buyer could first TYPE where they are rather than pick an area from a list. A gazetteer
  // that only knows one country is not a limitation of the geocoder, it is a limitation of the answer:
  // "we could not place that" for every Ethiopian address, on a network that quotes and ships to Ethiopia.
  { name: 'Addis Ababa', location: { lat: 9.03, lng: 38.74 }, aliases: ['addis', 'addis abeba', 'finfinne'], broad: true },
  { name: 'Bole', location: { lat: 8.995, lng: 38.789 } },
  { name: 'Merkato', location: { lat: 9.0333, lng: 38.7333 }, aliases: ['mercato', 'addis ketema'] },
  { name: 'Piassa', location: { lat: 9.0356, lng: 38.7519 }, aliases: ['piazza'] },
  { name: 'Kirkos', location: { lat: 9.01, lng: 38.76 } },
  { name: 'Yeka', location: { lat: 9.05, lng: 38.8 } },
  { name: 'Kolfe', location: { lat: 9.02, lng: 38.69 }, aliases: ['kolfe keranio'] },
  { name: 'Adama', location: { lat: 8.54, lng: 39.27 }, aliases: ['nazret', 'nazareth'] },
  { name: 'Bishoftu', location: { lat: 8.75, lng: 38.98 }, aliases: ['debre zeit'] },
  { name: 'Hawassa', location: { lat: 7.062, lng: 38.476 }, aliases: ['awassa'] },
  { name: 'Shashamane', location: { lat: 7.2, lng: 38.6 } },
  { name: 'Bahir Dar', location: { lat: 11.594, lng: 37.39 } },
  { name: 'Gondar', location: { lat: 12.61, lng: 37.46 }, aliases: ['gonder'] },
  { name: 'Mekelle', location: { lat: 13.4967, lng: 39.4753 }, aliases: ['mekele'] },
  { name: 'Dire Dawa', location: { lat: 9.593, lng: 41.866 } },
  { name: 'Jimma', location: { lat: 7.67, lng: 36.83 } },
  { name: 'Dessie', location: { lat: 11.133, lng: 39.633 } },
  { name: 'Debre Birhan', location: { lat: 9.68, lng: 39.53 } },
];

const UGANDA: PlaceEntry[] = [
  // --- Uganda (2026-11-11): its cities and large towns, at their centres (Wikipedia's coordinates). Busia is left out: a
  // town of that name stands across the border in Kenya, and an address naming it must never be placed in the wrong country.
  { name: "Kampala", location: { lat: 0.3136, lng: 32.5811 }, aliases: ["kla","kampala city"], broad: true },
  { name: "Entebbe", location: { lat: 0.05, lng: 32.46 } },
  { name: "Wakiso", location: { lat: 0.3981, lng: 32.4781 } },
  { name: "Nansana", location: { lat: 0.3639, lng: 32.5286 } },
  { name: "Kira", location: { lat: 0.3972, lng: 32.6389 }, aliases: ["kira town"] },
  { name: "Makindye-Ssabagabo", location: { lat: 0.2428, lng: 32.56 }, aliases: ["ssabagabo","sabagabo"] },
  { name: "Mukono", location: { lat: 0.3533, lng: 32.7553 } },
  { name: "Njeru", location: { lat: 0.4311, lng: 33.1478 } },
  { name: "Lugazi", location: { lat: 0.3833, lng: 32.9242 } },
  { name: "Jinja", location: { lat: 0.4233, lng: 33.2039 } },
  { name: "Iganga", location: { lat: 0.615, lng: 33.485 } },
  { name: "Tororo", location: { lat: 0.6928, lng: 34.1811 } },
  { name: "Mbale", location: { lat: 1.0806, lng: 34.175 } },
  { name: "Soroti", location: { lat: 1.715, lng: 33.6111 } },
  { name: "Lira", location: { lat: 2.2472, lng: 32.9 } },
  { name: "Gulu", location: { lat: 2.7817, lng: 32.2992 } },
  { name: "Kitgum", location: { lat: 3.2889, lng: 32.8778 } },
  { name: "Arua", location: { lat: 3.0353, lng: 30.9108 } },
  { name: "Hoima", location: { lat: 1.4319, lng: 31.3525 } },
  { name: "Masindi", location: { lat: 1.6836, lng: 31.7222 } },
  { name: "Nakasongola", location: { lat: 1.315, lng: 32.465 } },
  { name: "Mityana", location: { lat: 0.4006, lng: 32.0422 } },
  { name: "Mubende", location: { lat: 0.5575, lng: 31.395 } },
  { name: "Fort Portal", location: { lat: 0.6544, lng: 30.2744 }, aliases: ["fortportal","fort-portal"] },
  { name: "Kasese", location: { lat: 0.1867, lng: 30.0881 } },
  { name: "Mbarara", location: { lat: -0.6133, lng: 30.6583 } },
  { name: "Masaka", location: { lat: -0.3411, lng: 31.7361 } },
  { name: "Kabale", location: { lat: -1.25, lng: 29.99 } },
  { name: "Moroto", location: { lat: 2.53, lng: 34.67 } },
];

const NETHERLANDS: PlaceEntry[] = [
  // --- The Netherlands (2026-11-11), where SeeBuyGet is tested: its large cities and the logistics towns loads run between.
  { name: "Amsterdam", location: { lat: 52.3728, lng: 4.8936 }, broad: true },
  { name: "Rotterdam", location: { lat: 51.9225, lng: 4.4792 }, broad: true },
  { name: "Den Haag", location: { lat: 52.0705, lng: 4.3007 }, aliases: ["the hague","s gravenhage","den haag centrum"], broad: true },
  { name: "Utrecht", location: { lat: 52.0907, lng: 5.1214 }, broad: true },
  { name: "Eindhoven", location: { lat: 51.4416, lng: 5.4697 } },
  { name: "Groningen", location: { lat: 53.2194, lng: 6.5665 } },
  { name: "Tilburg", location: { lat: 51.5555, lng: 5.0913 } },
  { name: "Almere", location: { lat: 52.3508, lng: 5.2647 } },
  { name: "Breda", location: { lat: 51.5719, lng: 4.7683 } },
  { name: "Nijmegen", location: { lat: 51.8426, lng: 5.8546 } },
  { name: "Apeldoorn", location: { lat: 52.2112, lng: 5.9699 } },
  { name: "Haarlem", location: { lat: 52.3874, lng: 4.6462 } },
  { name: "Arnhem", location: { lat: 51.9851, lng: 5.8987 } },
  { name: "Enschede", location: { lat: 52.2215, lng: 6.8937 } },
  { name: "Amersfoort", location: { lat: 52.1561, lng: 5.3878 } },
  { name: "Zaandam", location: { lat: 52.442, lng: 4.8292 }, aliases: ["zaanstad"] },
  { name: "'s-Hertogenbosch", location: { lat: 51.6978, lng: 5.3037 }, aliases: ["den bosch","hertogenbosch"] },
  { name: "Zwolle", location: { lat: 52.5168, lng: 6.083 } },
  { name: "Leiden", location: { lat: 52.1601, lng: 4.497 } },
  { name: "Maastricht", location: { lat: 50.8514, lng: 5.691 } },
  { name: "Dordrecht", location: { lat: 51.8133, lng: 4.6901 } },
  { name: "Leeuwarden", location: { lat: 53.2012, lng: 5.7999 } },
  { name: "Hoofddorp", location: { lat: 52.3061, lng: 4.6907 }, aliases: ["haarlemmermeer"] },
  { name: "Schiphol", location: { lat: 52.3105, lng: 4.7683 }, aliases: ["schiphol airport"] },
  { name: "Venlo", location: { lat: 51.3704, lng: 6.1724 } },
  { name: "Moerdijk", location: { lat: 51.701, lng: 4.626 } },
  { name: "Waalwijk", location: { lat: 51.6826, lng: 5.0703 } },
];

const inCountry = (country: string, list: PlaceEntry[]): GazetteerEntry[] => list.map((e) => ({ ...e, country }));

export const GAZETTEER: GazetteerEntry[] = [...inCountry('KE', KENYA), ...inCountry('ET', ETHIOPIA), ...inCountry('UG', UGANDA), ...inCountry('NL', NETHERLANDS)];

/** The places of the countries given (ISO 3166 alpha-2), or every place where none is. */
function placesIn(countries?: readonly (string | undefined)[]): GazetteerEntry[] {
  const codes = (countries ?? []).filter((c): c is string => Boolean(c)).map((c) => c.toUpperCase());
  return codes.length ? GAZETTEER.filter((e) => codes.includes(e.country)) : GAZETTEER;
}

/** Normalise a query for matching: lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizePlace(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface GazetteerMatch {
  entry: GazetteerEntry;
  kind: 'exact' | 'contains';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Road-type words. A gazetteer place immediately followed by one of these is a STREET named after that
 * place, not the locality — "Mombasa Road, Nairobi" is in Nairobi, not Mombasa. These tokens are how
 * Kenyan addresses embed a far-away town's name as an arterial qualifier, which naive substring matching
 * mistakes for the destination.
 */
const ROAD_WORDS = new Set([
  'road', 'rd', 'street', 'st', 'avenue', 'ave', 'av', 'lane', 'ln', 'highway', 'hwy', 'drive', 'dr',
  'way', 'close', 'crescent', 'cres', 'roundabout', 'bypass', 'parade', 'walk', 'superhighway',
]);

/** The start index of the LAST whole-word occurrence of `name` in `q`, or -1 if absent. */
function lastWordIndex(q: string, name: string): number {
  if (!name) return -1;
  const re = new RegExp(`(^|\\s)${escapeRe(name)}(\\s|$)`, 'g');
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    idx = m.index + m[1].length; // position of `name` itself (after the leading boundary)
    re.lastIndex = idx + 1; // allow overlapping-adjacent scans
  }
  return idx;
}

/** Is the word immediately after `name` (at `pos`) a road-type word → `name` is a street, not a place? */
function followedByRoadWord(q: string, pos: number, name: string): boolean {
  const rest = q.slice(pos + name.length).trim();
  if (!rest) return false;
  return ROAD_WORDS.has(rest.split(' ')[0]);
}

/**
 * Resolve a place / address against the gazetteer.
 *
 * An EXACT name-or-alias match wins outright. Otherwise we take the localities NAMED inside the query,
 * with two rules that make free-text Kenyan addresses resolve to the right town:
 *   1. A place used as a ROAD qualifier ("Mombasa Road", "Thika Road") is a street, not a locality — drop it.
 *   2. Addresses run specific→general and END with the town, so among the surviving SPECIFIC places the
 *      RIGHTMOST wins ("Riverside Estate, Nakuru" → Nakuru), and a specific place beats the broad city
 *      container ("Karen, Nairobi" → Karen). If only the broad container survives, use it ("Mombasa
 *      Road, Nairobi" → Nairobi). Returns null if nothing matches.
 */
export function lookupPlace(query: string, countries?: readonly (string | undefined)[]): GazetteerMatch | null {
  const q = normalizePlace(query);
  if (!q) return null;

  const flat: Array<{ name: string; entry: GazetteerEntry; broad: boolean }> = [];
  for (const entry of placesIn(countries)) {
    flat.push({ name: normalizePlace(entry.name), entry, broad: entry.broad ?? false });
    for (const a of entry.aliases ?? []) flat.push({ name: normalizePlace(a), entry, broad: entry.broad ?? false });
  }

  for (const c of flat) if (c.name === q) return { entry: c.entry, kind: 'exact' };

  const hits: Array<{ entry: GazetteerEntry; broad: boolean; pos: number }> = [];
  for (const c of flat) {
    const pos = lastWordIndex(q, c.name);
    if (pos < 0 || followedByRoadWord(q, pos, c.name)) continue;
    hits.push({ entry: c.entry, broad: c.broad, pos });
  }
  if (hits.length === 0) return null;

  const specifics = hits.filter((h) => !h.broad);
  const pool = specifics.length ? specifics : hits;
  pool.sort((a, b) => b.pos - a.pos); // rightmost token = the address's town
  return { entry: pool[0].entry, kind: 'contains' };
}

/**
 * FB3b — the coarse name for a point: the nearest gazetteer place, if one is near enough to mean anything.
 *
 * The public market board names WHERE a load is without publishing where it is. A shop's own label is an
 * address and a business name; "near Thika" is a market fact. The distinction matters because the public
 * list is a standing, anonymous inventory of valuable goods with dates against them, and a town is all an
 * operator sizing up a corridor ever needed.
 *
 * Returns null beyond `withinKm` rather than reaching for a far-off name: "near Nairobi" said of a load 140
 * km away is worse than saying nothing, because it reads as precision and is not.
 */
/**
 * The same answer as `nearestPlace`, with the gazetteer's own coordinate for the place it names.
 *
 * WHICH COORDINATE THIS IS, because a map will be drawn from it: the CENTROID of the named town or
 * neighbourhood, not the point that was passed in. That is the point of the coarsening — the public
 * market names where a load is without publishing where it is — so a lane end plotted from this is
 * accurate to the place and deliberately inaccurate to the load. Anything reading it has to say so.
 */
export function nearestPlaceAt(point: GeoPoint, withinKm = 60, country?: string): { name: string; km: number; location: GeoPoint } | null {
  const found = nearestEntry(point, withinKm, country);
  return found ? { name: found.name, km: found.km, location: found.location } : null;
}

/** `country` — the point's country, where the caller knows it: a place across a border is never its name. */
export function nearestPlace(point: GeoPoint, withinKm = 60, country?: string): { name: string; km: number } | null {
  const found = nearestEntry(point, withinKm, country);
  return found ? { name: found.name, km: found.km } : null;
}

function nearestEntry(point: GeoPoint, withinKm: number, country?: string): { name: string; km: number; location: GeoPoint } | null {
  let best: { name: string; km: number; broad: boolean; location: GeoPoint } | null = null;
  for (const entry of placesIn(country ? [country] : undefined)) {
    const km = haversineKm(point, entry.location);
    if (km > withinKm) continue;
    const broad = entry.broad ?? false;
    // Nearest wins, and an equally-near BROAD container beats the neighbourhood inside it: at the same
    // distance "Nairobi" is the safer word to publish than the estate, and coarser is the whole point here.
    if (!best || km < best.km || (km === best.km && broad && !best.broad)) best = { name: entry.name, km, broad, location: entry.location };
  }
  return best ? { name: best.name, km: best.km, location: best.location } : null;
}
