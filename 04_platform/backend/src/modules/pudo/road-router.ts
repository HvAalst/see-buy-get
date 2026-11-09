import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { GeoPoint } from './pudo.types';
import { HeuristicRouter, type Router } from './router';
import { MAX_SNAP_M, OsrmRoadMatrix, placeKey } from './road-matrix';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';

/** How many of the network's places the table holds: every one of them to every other, 8 bytes a pair. */
export const ROAD_TABLE_MAX_PLACES = 1000;
/** How often the network's places are measured again: new shops join, and the map changes every week. */
export const ROAD_TABLE_REFRESH_MS = 6 * 3_600_000;

/** What staff are shown of the table: how many places it holds, and since when. */
export interface RoadTableState {
  places: number;
  at: string;
}

/**
 * DISTANCES BY ROAD BETWEEN THE NETWORK'S OWN PLACES (2026-11-09 — zone pricing step 4: "plans keep real km and minutes",
 * and the owner: "make sure optimization would work there as well" — the Netherlands beside Kenya).
 *
 * Every shop and hub to every other, by road, from the routing server (RoadTableWarmer keeps it fresh); any other pair — a
 * driver's position, a door, a place joined since the last measuring, a pair the map knows no road between — the
 * estimate, exactly as before. Synchronous, like the router it stands in for: a quote never waits on a network. With no
 * routing server the table stays empty and every distance is the estimate it always was. A journey's legs, its arrival
 * times, a bag's road pay and a driver's detour all read it; a price card never does — its distances are its own.
 */
@Injectable()
export class RoadRouter implements Router {
  private index = new Map<string, number>();
  private km: Float64Array = new Float64Array(0);
  private n = 0;
  private at?: string;

  constructor(private readonly estimate: HeuristicRouter) {}

  /** A new table: its places, and the km from each to each, row by row — NaN where the map knows no road. */
  load(places: GeoPoint[], km: Float64Array, at: string): void {
    if (km.length !== places.length * places.length) throw new Error(`A road table of ${places.length} places has ${places.length ** 2} cells, not ${km.length}`);
    this.index = new Map(places.map((p, i) => [placeKey(p), i]));
    this.km = km;
    this.n = places.length;
    this.at = at;
  }

  state(): RoadTableState | undefined {
    return this.at ? { places: this.n, at: this.at } : undefined;
  }

  roadKm(a: GeoPoint, b: GeoPoint): number {
    const i = this.index.get(placeKey(a));
    const j = this.index.get(placeKey(b));
    if (i !== undefined && j !== undefined && i !== j) {
      const v = this.km[i * this.n + j];
      if (Number.isFinite(v)) return v;
    }
    return this.estimate.roadKm(a, b);
  }

  etaMinutes(a: GeoPoint, b: GeoPoint, speedKmh: number): number {
    const kmh = Number.isFinite(speedKmh) && speedKmh > 0 ? speedKmh : 40;
    return Math.max(1, Math.round((this.roadKm(a, b) / kmh) * 60));
  }

  detourKm(a: GeoPoint, p: GeoPoint, b: GeoPoint): number {
    const extra = this.roadKm(a, p) + this.roadKm(p, b) - this.roadKm(a, b);
    return Math.max(0, Math.round(extra * 10) / 10);
  }
}

/**
 * KEEPS THE NETWORK'S ROAD TABLE FRESH: when the API starts, and every six hours, every shop and hub is asked of the routing
 * server against every other (in blocks it takes). A server that does not answer leaves the table as it was — the
 * distances never fall back halfway. Nothing is asked where no routing server is set.
 */
@Injectable()
export class RoadTableWarmer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RoadTableWarmer.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly roads: OsrmRoadMatrix,
    private readonly router: RoadRouter,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.roads.configured()) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), ROAD_TABLE_REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Measure the network's places again (one measuring at a time: a second ask joins the first). */
  refresh(now: number = Date.now()): Promise<void> {
    this.running ??= this.measure(now).finally(() => (this.running = undefined));
    return this.running;
  }

  private async measure(now: number): Promise<void> {
    if (!this.roads.configured()) return;
    const seen = new Map<string, GeoPoint>();
    const add = (p: GeoPoint | undefined) => {
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) seen.set(placeKey(p), p);
    };
    for (const a of this.agents.list()) add(a.location);
    for (const h of this.mdps.list()) add(h.location);
    const all = [...seen.values()];
    if (all.length < 2) return;
    const places = all.slice(0, ROAD_TABLE_MAX_PLACES);
    if (all.length > places.length) this.logger.warn(`The road table holds ${places.length} of the network's ${all.length} places; the rest are estimated`);
    const got = await this.roads.allPairs(places, MAX_SNAP_M);
    if ('why' in got) {
      this.logger.warn(`The network's places were not measured by road: ${got.why}. The distances stay as they were.`);
      return;
    }
    const n = places.length;
    const km = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const v = got.km[i][j];
        km[i * n + j] = v == null ? Number.NaN : Math.round(v * 10) / 10;
      }
    }
    this.router.load(places, km, new Date(now).toISOString());
    this.logger.log(`The network's ${n} places measured by road`);
  }
}
