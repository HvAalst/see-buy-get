/**
 * THE GEOMETRY OF A COUNTRY'S ZONES (2026-11-08, the owner: every country "should also determine zones for the entire country
 * so a new booking would lookup in which one the parcel is minted and to which zone it is going").
 *
 * A zone is made of AREAS: the official areas a country is divided into (wards, districts, postcode areas), imported once
 * from a boundary file. Zones never cut an area, so changing a zone (merging two, moving an area from one to another) moves
 * area names between lists and never touches a shape. That keeps the shapes exactly as their source drew them, and a pin
 * always lands in one area of one zone.
 *
 * Pure functions, no service: a shape is rings of [longitude, latitude] (GeoJSON's order), a polygon is its outer ring then
 * its holes, an area is one or more polygons. Coordinates are kept to 5 decimals (about a metre), and travel to the console
 * as encoded polylines (the common precision-5 encoding) so a country of 1,500 areas is a few hundred kilobytes.
 */

export type Ring = Array<[number, number]>;
export type Polygon = Ring[];
export type Shape = Polygon[];
export type Box = [minLng: number, minLat: number, maxLng: number, maxLat: number];

export interface ParsedArea {
  name: string;
  shape: Shape;
}

/** The most areas, and the most corners across them, one file may bring: a country's wards are about 1,500 and 65,000. */
export const MAX_AREAS = 20_000;
export const MAX_CORNERS = 600_000;

/** The fields a boundary file usually names its areas by, tried in this order when the file's own field is not said. */
// 2026-11-08 — and the Netherlands' statistics office's (CBS, through PDOK): the Netherlands is matched in testing, and a
// country's company brings in its own country's official file.
const NAME_FIELDS = ['shapeName', 'name', 'NAME', 'Name', 'NAME_EN', 'name_en', 'ADM3_EN', 'ADM2_EN', 'ADM1_EN', 'WARD', 'ward', 'district', 'DISTRICT', 'statnaam', 'buurtnaam', 'wijknaam', 'gemeentenaam'];

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Why a file cannot be taken, in words the person who chose it can act on. */
export class AreaFileProblem extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * Read a boundary file (GeoJSON: a FeatureCollection of polygons) into named areas, or say why it cannot be read. Every
 * feature must be an area with a name; nothing is left out quietly, because an area left out is a piece of the country
 * with no zone, and a pin there would land nowhere.
 */
export function parseAreaFile(text: string, nameField?: string): ParsedArea[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new AreaFileProblem(`The file is not GeoJSON: ${(e as Error).message}`, 'geojson');
  }
  const root = json as { type?: string; features?: unknown[] };
  const features = root?.type === 'FeatureCollection' && Array.isArray(root.features) ? root.features : root?.type === 'Feature' ? [root] : undefined;
  if (!features) throw new AreaFileProblem('The file is not a GeoJSON FeatureCollection of areas', 'geojson');
  if (!features.length) throw new AreaFileProblem('The file holds no areas', 'geojson');
  if (features.length > MAX_AREAS) throw new AreaFileProblem(`The file holds ${features.length} areas; the most is ${MAX_AREAS}`, 'geojson');
  let corners = 0;
  const areas = features.map((raw, i) => {
    const f = raw as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null };
    const where = `Area ${i + 1}`;
    const props = f?.properties ?? {};
    const name = nameOf(props, nameField);
    if (!name) throw new AreaFileProblem(nameField ? `${where} has no “${nameField}”` : `${where} has no name: say which field of the file holds the names`, 'nameField');
    const g = f?.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) throw new AreaFileProblem(`${where} (${name}) is not an area: it is ${g?.type ? `a ${g.type}` : 'empty'}`, 'geojson');
    const polygons = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as unknown;
    if (!Array.isArray(polygons) || !polygons.length) throw new AreaFileProblem(`${where} (${name}) has no shape`, 'geojson');
    const shape: Shape = polygons.map((p) => {
      if (!Array.isArray(p) || !p.length) throw new AreaFileProblem(`${where} (${name}) has an empty polygon`, 'geojson');
      return (p as unknown[]).map((r) => ringOf(r, `${where} (${name})`));
    });
    corners += shape.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);
    if (corners > MAX_CORNERS) throw new AreaFileProblem(`The shapes have more than ${MAX_CORNERS} corners: simplify the file first`, 'geojson');
    return { name, shape };
  });
  return areas;
}

function nameOf(props: Record<string, unknown>, field?: string): string | undefined {
  const pick = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : typeof v === 'number' ? String(v) : undefined);
  if (field) return pick(props[field]);
  for (const f of NAME_FIELDS) {
    const v = pick(props[f]);
    if (v) return v;
  }
  return undefined;
}

/** One ring: corners rounded to 5 decimals, repeated corners dropped, closed. Fewer than three distinct corners is no ring. */
function ringOf(raw: unknown, where: string): Ring {
  if (!Array.isArray(raw)) throw new AreaFileProblem(`${where} has a ring that is not a list of corners`, 'geojson');
  const ring: Ring = [];
  for (const c of raw) {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number' || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) throw new AreaFileProblem(`${where} has a corner that is not a pair of numbers`, 'geojson');
    const lng = round5(c[0]);
    const lat = round5(c[1]);
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) throw new AreaFileProblem(`${where} has a corner outside the earth (${c[0]}, ${c[1]}): the file must use longitude and latitude`, 'geojson');
    const last = ring[ring.length - 1];
    if (!last || last[0] !== lng || last[1] !== lat) ring.push([lng, lat]);
  }
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([ring[0][0], ring[0][1]]);
  if (ring.length < 4) throw new AreaFileProblem(`${where} has a ring of fewer than three corners`, 'geojson');
  return ring;
}

/* ------------------------------------------------------------------ measures -- */

export function boxOf(shape: Shape): Box {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of shape)
    for (const [lng, lat] of p[0]) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  return [minLng, minLat, maxLng, maxLat];
}

/** Kilometres per degree, east-west at this latitude and north-south: an equirectangular view around the area itself. */
const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat: number): number => 111.32 * Math.cos((lat * Math.PI) / 180);

function ringArea(ring: Ring, lat0: number): number {
  const kx = kmPerDegLng(lat0);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * kx * (y2 * KM_PER_DEG_LAT) - x2 * kx * (y1 * KM_PER_DEG_LAT);
  }
  return sum / 2;
}

/** An area in km² (holes taken out), and its centre of mass. Good to well under a percent for areas the size of a district. */
export function measure(shape: Shape): { areaKm2: number; centre: { lat: number; lng: number } } {
  const box = boxOf(shape);
  const lat0 = (box[1] + box[3]) / 2;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const p of shape) {
    p.forEach((ring, i) => {
      const a = Math.abs(ringArea(ring, lat0)) * (i === 0 ? 1 : -1);
      // The centre of the ring's corners, weighted by the ring's area: close enough for a label and a distance.
      const n = ring.length - 1 || 1;
      let sx = 0;
      let sy = 0;
      for (let k = 0; k < n; k++) {
        sx += ring[k][0];
        sy += ring[k][1];
      }
      area += a;
      cx += (sx / n) * a;
      cy += (sy / n) * a;
    });
  }
  const centre = area > 0 ? { lat: round5(cy / area), lng: round5(cx / area) } : { lat: round5(lat0), lng: round5((box[0] + box[2]) / 2) };
  return { areaKm2: Math.round(area * 100) / 100, centre };
}

/* ------------------------------------------------------------- where a pin is -- */

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point lies in an area: inside an outer ring and in none of that polygon's holes. */
export function contains(shape: Shape, point: { lat: number; lng: number }): boolean {
  for (const p of shape) {
    if (!inRing(point.lng, point.lat, p[0])) continue;
    if (p.slice(1).some((hole) => inRing(point.lng, point.lat, hole))) continue;
    return true;
  }
  return false;
}

/** How far a point lies from an area's edge, in km (0 inside it). */
export function distanceKm(shape: Shape, point: { lat: number; lng: number }): number {
  if (contains(shape, point)) return 0;
  const kx = kmPerDegLng(point.lat);
  let best = Infinity;
  for (const p of shape)
    for (const ring of p)
      for (let i = 0; i < ring.length - 1; i++) {
        const ax = (ring[i][0] - point.lng) * kx;
        const ay = (ring[i][1] - point.lat) * KM_PER_DEG_LAT;
        const bx = (ring[i + 1][0] - point.lng) * kx;
        const by = (ring[i + 1][1] - point.lat) * KM_PER_DEG_LAT;
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best) best = d;
      }
  return best;
}

/**
 * A pin → the area it lies in. Areas are looked for through a grid of quarter-degree cells, so a country of thousands of
 * areas answers in a handful of checks. A pin in no area — in the hair's breadth a simplified file leaves between two
 * neighbours, or just over a coastline — takes the nearest area within `nearKm`; further out it lies in none.
 */
export class AreaIndex {
  private readonly cells = new Map<string, number[]>();
  private static readonly CELL = 0.25;

  constructor(private readonly areas: ReadonlyArray<{ id: string; shape: Shape; box: Box }>) {
    areas.forEach((a, i) => {
      for (const key of AreaIndex.cellsOf(a.box)) {
        const list = this.cells.get(key);
        if (list) list.push(i);
        else this.cells.set(key, [i]);
      }
    });
  }

  private static cellsOf(box: Box): string[] {
    const c = AreaIndex.CELL;
    const keys: string[] = [];
    for (let x = Math.floor(box[0] / c); x <= Math.floor(box[2] / c); x++) for (let y = Math.floor(box[1] / c); y <= Math.floor(box[3] / c); y++) keys.push(`${x}:${y}`);
    return keys;
  }

  find(point: { lat: number; lng: number }, nearKm = 2): string | undefined {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return undefined;
    const c = AreaIndex.CELL;
    const x = Math.floor(point.lng / c);
    const y = Math.floor(point.lat / c);
    for (const i of this.cells.get(`${x}:${y}`) ?? []) {
      const a = this.areas[i];
      if (point.lng >= a.box[0] && point.lng <= a.box[2] && point.lat >= a.box[1] && point.lat <= a.box[3] && contains(a.shape, point)) return a.id;
    }
    // Not inside any: the nearest edge in this cell and the eight around it, if it is near enough.
    let best: { id: string; d: number } | undefined;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of this.cells.get(`${x + dx}:${y + dy}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const d = distanceKm(this.areas[i].shape, point);
          if (d <= nearKm && (!best || d < best.d)) best = { id: this.areas[i].id, d };
        }
    return best?.id;
  }
}

/* ------------------------------------------------------------ the compact form -- */

function encodeNumber(n: number): string {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** A ring as an encoded polyline (latitude first, as the encoding has it; precision 5). */
export function encodeRing(ring: Ring): string {
  let lat = 0;
  let lng = 0;
  let out = '';
  for (const [x, y] of ring) {
    const ilat = Math.round(y * 1e5);
    const ilng = Math.round(x * 1e5);
    out += encodeNumber(ilat - lat) + encodeNumber(ilng - lng);
    lat = ilat;
    lng = ilng;
  }
  return out;
}

export function decodeRing(text: string): Ring {
  const ring: Ring = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = text.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < text.length + 1);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < text.length) {
    lat += next();
    lng += next();
    ring.push([lng / 1e5, lat / 1e5]);
  }
  return ring;
}

/** A polygon as one string: its rings encoded, outer first, separated by a space (a character the encoding never uses). */
export function encodePolygon(p: Polygon): string {
  return p.map(encodeRing).join(' ');
}

export function decodePolygon(text: string): Polygon {
  return text.split(' ').filter(Boolean).map(decodeRing);
}
