/**
 * 2026-11-12 — A ROAD MAP OF HUBS (the owner, 2026-11-11: "i would go for next hub on the road. but that also needs sbg staff
 * to check that hubs sit around strategic locations and not too close to each other or still the system should plan the
 * journey skipping hubs that are on the route but really nearby"; the plan "Hubs on the Road", D1–D7 as recommended).
 *
 * Plain functions, so the proposal and the paths over it are tested without the services:
 *  - a hub nearer than the country's minimum distance to a stop already chosen is LOCAL ONLY — it serves its own zones and
 *    shops, and parcels passing through do not stop there; of a too-close pair the one with more bag places is the stop;
 *  - two stops are NEIGHBOURS when no other stop lies on the way between them: going through it adds no more than a tenth;
 *  - a map in pieces is joined at its closest pair, so every stop reaches every other;
 *  - a path is the shortest by road over the neighbours, around any hub that may not be used.
 */

export interface RoadHub {
  mdpId: string;
  /** How many bags can stand on its floor; absent counts as none (the stop of a too-close pair is the one with more). */
  bagPlaces?: number;
}

export type Km = (a: string, b: string) => number;

/** "On the way": going through a third stop adds no more than this share to the drive (the plan's detour test). */
export const ON_THE_WAY = 1.1;

/** The minimum distance between two stops, per country (D1, as recommended); each country's staff can change theirs. */
export const ROAD_MAP_MIN_KM: Readonly<Record<string, number>> = { KE: 60, ET: 70, UG: 50, NL: 25 };
/** A country with no figure of its own yet. */
export const ROAD_MAP_MIN_KM_ELSE = 50;

export function defaultMinKm(country: string | undefined): number {
  return (country ? ROAD_MAP_MIN_KM[country] : undefined) ?? ROAD_MAP_MIN_KM_ELSE;
}

export interface RoadPlan {
  stops: string[];
  /** A local-only hub → the stop that carries its through parcels: the nearest. */
  local: Record<string, string>;
  /** Neighbouring stops, each pair once, the smaller id first. */
  links: Array<[string, string]>;
}

export const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const keyOf = (a: string, b: string) => pairOf(a, b).join('|');

/** Which hubs are stops, and which are local only (attached to their nearest stop). Larger floors are chosen first. */
export function chooseStops(hubs: readonly RoadHub[], km: Km, minKm: number): { stops: string[]; local: Record<string, string> } {
  const order = [...hubs].sort((a, b) => (b.bagPlaces ?? 0) - (a.bagPlaces ?? 0) || a.mdpId.localeCompare(b.mdpId));
  const stops: string[] = [];
  for (const h of order) if (!stops.some((s) => km(s, h.mdpId) < minKm)) stops.push(h.mdpId);
  const local: Record<string, string> = {};
  for (const h of order) if (!stops.includes(h.mdpId)) local[h.mdpId] = nearest(h.mdpId, stops, km)!;
  return { stops: stops.sort(), local };
}

export function nearest(id: string, among: readonly string[], km: Km): string | undefined {
  return [...among].filter((x) => x !== id).sort((a, b) => km(id, a) - km(id, b) || a.localeCompare(b))[0];
}

/** Neighbouring stops: no other stop on the way between them; then any pieces joined at their closest pair. */
export function linksFor(stops: readonly string[], km: Km): Array<[string, string]> {
  const links: Array<[string, string]> = [];
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const [a, b] = [stops[i], stops[j]];
      const direct = km(a, b);
      const between = stops.some((c) => c !== a && c !== b && km(a, c) + km(c, b) <= ON_THE_WAY * direct);
      if (!between) links.push(pairOf(a, b));
    }
  }
  return joinPieces(stops, links, km);
}

/** The pieces of a map, each a set of stops reaching one another. */
export function piecesOf(stops: readonly string[], links: ReadonlyArray<readonly [string, string]>): string[][] {
  const adj = adjacency(stops, links);
  const seen = new Set<string>();
  const pieces: string[][] = [];
  for (const s of stops) {
    if (seen.has(s)) continue;
    const piece: string[] = [];
    const queue = [s];
    seen.add(s);
    while (queue.length) {
      const x = queue.shift()!;
      piece.push(x);
      for (const y of adj.get(x) ?? []) if (!seen.has(y)) (seen.add(y), queue.push(y));
    }
    pieces.push(piece.sort());
  }
  return pieces;
}

function joinPieces(stops: readonly string[], links: Array<[string, string]>, km: Km): Array<[string, string]> {
  const out = [...links];
  for (;;) {
    const pieces = piecesOf(stops, out);
    if (pieces.length < 2) return out;
    // The closest pair between the first piece and any other: joined, and again until one piece is left.
    let best: { a: string; b: string; d: number } | undefined;
    for (const a of pieces[0]) for (const piece of pieces.slice(1)) for (const b of piece) {
      const d = km(a, b);
      if (!best || d < best.d) best = { a, b, d };
    }
    out.push(pairOf(best!.a, best!.b));
  }
}

/** The proposal for a country: stops, local-only hubs, neighbours. */
export function proposeRoadPlan(hubs: readonly RoadHub[], km: Km, minKm: number): RoadPlan {
  const { stops, local } = chooseStops(hubs, km, minKm);
  return { stops, local, links: linksFor(stops, km) };
}

export function adjacency(stops: readonly string[], links: ReadonlyArray<readonly [string, string]>): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>(stops.map((s) => [s, new Set<string>()]));
  for (const [a, b] of links) {
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  return adj;
}

/**
 * A stop that may not be used now (down, no longer approved) taken out: its neighbours become each other's (the plan: "Its two
 * neighbours become each other's next stop"), and its local hubs go to their nearest remaining stop.
 */
export function without(plan: RoadPlan, out: ReadonlySet<string>, km: Km): RoadPlan {
  if (!out.size) return plan;
  const stops = plan.stops.filter((s) => !out.has(s));
  const keys = new Set<string>();
  const links: Array<[string, string]> = [];
  const add = (a: string, b: string) => {
    if (a === b || out.has(a) || out.has(b) || keys.has(keyOf(a, b))) return;
    keys.add(keyOf(a, b));
    links.push(pairOf(a, b));
  };
  for (const [a, b] of plan.links) add(a, b);
  for (const gone of plan.stops.filter((s) => out.has(s))) {
    const around = plan.links.filter(([a, b]) => a === gone || b === gone).map(([a, b]) => (a === gone ? b : a)).filter((x) => !out.has(x));
    for (let i = 0; i < around.length; i++) for (let j = i + 1; j < around.length; j++) add(around[i], around[j]);
  }
  const local: Record<string, string> = {};
  for (const [hub, stop] of Object.entries(plan.local)) {
    if (out.has(hub)) continue;
    local[hub] = out.has(stop) ? (nearest(hub, stops, km) ?? stop) : stop;
  }
  return { stops, local, links: joinPieces(stops, links, km) };
}

/** The shortest path by road between two stops over the neighbours, both ends included; nothing where none is. */
export function pathBetween(plan: RoadPlan, from: string, to: string, km: Km): string[] | undefined {
  if (from === to) return [from];
  const adj = adjacency(plan.stops, plan.links);
  if (!adj.has(from) || !adj.has(to)) return undefined;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([from]);
  while (open.size) {
    const x = [...open].sort((a, b) => dist.get(a)! - dist.get(b)! || a.localeCompare(b))[0];
    open.delete(x);
    if (x === to) break;
    for (const y of adj.get(x) ?? []) {
      const d = dist.get(x)! + km(x, y);
      if (d < (dist.get(y) ?? Infinity)) {
        dist.set(y, d);
        prev.set(y, x);
        open.add(y);
      }
    }
  }
  if (!dist.has(to)) return undefined;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

/** The stop a hub's through parcels go from or to: itself where it is a stop, else the stop it is attached to. */
export function stopOf(plan: RoadPlan, mdpId: string): string | undefined {
  return plan.stops.includes(mdpId) ? mdpId : plan.local[mdpId];
}

/** Two stops nearer than the minimum distance (staff kept both as stops, or the minimum changed since). */
export function tooClose(plan: RoadPlan, km: Km, minKm: number): Array<{ a: string; b: string; km: number }> {
  const out: Array<{ a: string; b: string; km: number }> = [];
  for (let i = 0; i < plan.stops.length; i++) for (let j = i + 1; j < plan.stops.length; j++) {
    const d = km(plan.stops[i], plan.stops[j]);
    if (d < minKm) out.push({ a: plan.stops[i], b: plan.stops[j], km: Math.round(d * 10) / 10 });
  }
  return out;
}
