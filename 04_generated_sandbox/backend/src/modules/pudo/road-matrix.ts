import { Inject, Injectable, Logger } from '@nestjs/common';
import { GeoPoint } from './pudo.types';
import { ROUTER, Router } from './router';

/**
 * ROAD DISTANCES FOR A DAY'S PLAN — every place to every other, by road, asked for once.
 *
 * A plan measures thousands of legs, and until now each was a straight line times a road factor: honest about being
 * an estimate, and blind to a river with one bridge. The user, 2026-10-06, asked how real road distances should be
 * had: "OSRM-compatible server" — an open protocol on open map data, at a URL the operator sets. Protocols, not
 * vendors: the same adapter talks to a routing engine the operator hosts or to anybody's that speaks it.
 *
 * So this asks the routing server's TABLE service for the whole day at once — depot, collection points, doors — and
 * hands the plan a way to look any leg up. It is the one place the plan's distances leave the building, and what
 * leaves is coordinates only: no order, no name, no address.
 *
 * IT FALLS BACK, AND SAYS SO. No URL configured, a server that does not answer in time, answers with an error or with
 * something that is not a table, or more places than it takes in one request: the plan is made on the estimate it was
 * always made on, and is told which it got (`source`) and why (`why`), so the board can say it. A pair of places the
 * map has no road between is estimated on its own, and counted (`gaps`).
 *
 * Only distance is taken. How long a leg takes is still the office's own speed over that distance: a routing
 * engine's travel times are a car's, and the office knows its trucks and its roads better than a car profile does.
 */
export interface RoadDistances {
  /** `roads` — from the routing server · `estimate` — straight lines times the road factor, as before. */
  source: 'roads' | 'estimate';
  /** Why it is an estimate, when a routing server was configured and could not be used. */
  why?: string;
  /** Pairs of places the routing server knows no road between; each is estimated instead. */
  gaps?: number;
  km(a: GeoPoint, b: GeoPoint): number;
}

export interface RoadMatrix {
  between(points: GeoPoint[]): Promise<RoadDistances>;
}

export const ROAD_MATRIX = Symbol('ROAD_MATRIX');

/** How long the routing server is given. A dispatcher is waiting at a screen; the estimate is always there. */
export const ROAD_TIMEOUT_MS = 4000;
/** The places one table request carries where the operator has not said otherwise — the protocol's usual limit. */
export const ROAD_MAX_POINTS = 100;
/** A table is kept this long: the same day is planned again and again while the office tunes it. */
const KEEP_MS = 10 * 60_000;
const KEEP_TABLES = 40;

/** A place, to five decimals — about a metre. Two orders for the same door are one place. */
export const placeKey = (p: GeoPoint) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** The table request, as the protocol writes it: longitude first, places separated by semicolons. */
export function tableUrl(base: string, profile: string, points: GeoPoint[]): string {
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  return `${base.replace(/\/+$/, '')}/table/v1/${encodeURIComponent(profile)}/${coords}?annotations=distance`;
}

/**
 * The answer, read: `n` rows of `n` distances in metres, or null where there is no road. Anything else — another
 * code, a table of the wrong size, a distance that is not a number — is not a table, and is not half-used.
 */
export function readTable(body: unknown, n: number): Array<Array<number | null>> | undefined {
  const b = body as { code?: unknown; distances?: unknown } | null;
  if (!b || b.code !== 'Ok' || !Array.isArray(b.distances) || b.distances.length !== n) return undefined;
  const rows: Array<Array<number | null>> = [];
  for (const row of b.distances as unknown[]) {
    if (!Array.isArray(row) || row.length !== n) return undefined;
    const cells: Array<number | null> = [];
    for (const cell of row as unknown[]) {
      if (cell === null) cells.push(null);
      else if (typeof cell === 'number' && Number.isFinite(cell) && cell >= 0) cells.push(cell);
      else return undefined;
    }
    rows.push(cells);
  }
  return rows;
}

@Injectable()
export class OsrmRoadMatrix implements RoadMatrix {
  private readonly logger = new Logger(OsrmRoadMatrix.name);
  private readonly kept = new Map<string, { at: number; table: Array<Array<number | null>>; places: string[] }>();
  /** The platform's fetch; a test puts its own here. */
  fetcher: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> = (url, init) => fetch(url, init);

  constructor(@Inject(ROUTER) private readonly estimate: Router) {}

  /** Whether a routing server is configured at all. */
  configured(): boolean {
    return Boolean((process.env.GLOS_ROUTER_URL ?? '').trim());
  }

  async between(points: GeoPoint[], now: number = Date.now()): Promise<RoadDistances> {
    const estimated = (why?: string): RoadDistances => ({ source: 'estimate', ...(why ? { why } : {}), km: (a, b) => this.estimate.roadKm(a, b) });
    const base = (process.env.GLOS_ROUTER_URL ?? '').trim();
    if (!base) return estimated();
    const places = new Map<string, GeoPoint>();
    for (const p of points) if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) places.set(placeKey(p), p);
    // One place or none: there is no leg to measure.
    if (places.size < 2) return estimated();
    const most = Number(process.env.GLOS_ROUTER_MAX_POINTS) > 1 ? Math.floor(Number(process.env.GLOS_ROUTER_MAX_POINTS)) : ROAD_MAX_POINTS;
    if (places.size > most) return estimated(`${places.size} places are more than the routing server takes in one request (${most})`);

    const keys = [...places.keys()].sort();
    const id = `${base}|${keys.join('|')}`;
    let table = this.kept.get(id);
    if (!table || now - table.at > KEEP_MS) {
      try {
        const res = await this.fetcher(tableUrl(base, (process.env.GLOS_ROUTER_PROFILE ?? '').trim() || 'driving', keys.map((k) => places.get(k)!)), { signal: AbortSignal.timeout(ROAD_TIMEOUT_MS), headers: { accept: 'application/json' } });
        if (!res.ok) return this.failed(estimated, `the routing server answered ${res.status}`);
        const read = readTable(await res.json(), keys.length);
        if (!read) return this.failed(estimated, 'the routing server sent something that is not a table of distances');
        table = { at: now, table: read, places: keys };
        this.kept.set(id, table);
        // Oldest out: a table is cheap to ask for again.
        while (this.kept.size > KEEP_TABLES) this.kept.delete(this.kept.keys().next().value as string);
      } catch (e) {
        const name = (e as { name?: string } | null)?.name;
        if (name === 'SyntaxError') return this.failed(estimated, 'the routing server sent something that is not a table of distances');
        return this.failed(estimated, name === 'TimeoutError' || name === 'AbortError' ? 'the routing server did not answer in time' : 'the routing server could not be reached');
      }
    }
    const at = new Map(table.places.map((k, i) => [k, i]));
    const grid = table.table;
    const gaps = grid.reduce((n, row, i) => n + row.filter((cell, j) => cell === null && i !== j).length, 0);
    return {
      source: 'roads',
      ...(gaps ? { gaps } : {}),
      km: (a, b) => {
        const i = at.get(placeKey(a));
        const j = at.get(placeKey(b));
        const metres = i !== undefined && j !== undefined ? grid[i][j] : null;
        // No road known between these two (or a place the table was not asked about): that leg alone is estimated.
        return metres === null ? this.estimate.roadKm(a, b) : metres / 1000;
      },
    };
  }

  private failed(estimated: (why?: string) => RoadDistances, why: string): RoadDistances {
    this.logger.warn(`Road distances fell back to the estimate: ${why}`);
    return estimated(why);
  }
}
