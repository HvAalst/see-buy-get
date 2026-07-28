import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { ToteService } from './tote.service';
import { AgentService } from './agent.service';
import { MarketCellPulse, MarketPulseStore, SurgeRule } from './market-pulse.store';
import { haversineKm } from './geo';
import { GeoPoint } from './pudo.types';
import { MARKET_MIN_DEMAND, MARKET_RECOMPUTE_MS, MARKET_SUPPLY_STALE_MIN, MARKET_SURGE_K } from './pudo.config';

/**
 * MarketPulseService — the freight-pricing "market pulse" (S34b). It periodically buckets the live map into
 * ~0.1° cells and, per cell, measures SUPPLY (vehicles on the ground reporting a fresh position) against
 * DEMAND (open freight jobs), deriving a factor = 1 + K·(demand/supply − 1) that flexes the freight price. A
 * thin cell (fewer than MARKET_MIN_DEMAND open loads) stays neutral — no surge on a lone order. An operator can
 * override a cell with a surge rule. The result is written to the dependency-free MarketPulseStore, which
 * DispatchService reads at price time; the per-vehicle [min,max] corridor still clamps the final multiplier, so
 * the driver always owns their floor and ceiling. This service REPLACES S34a's time-of-day-only stub; the
 * seasonal factor now multiplies this market factor inside freightMultiplier.
 *
 * The recompute is a MediaService-style tick: run once on boot, then on a self-unref'ing interval, and also
 * callable directly (an operator "recompute now" endpoint + deterministic tests with an injected clock).
 */
@Injectable()
export class MarketPulseService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly totes: ToteService,
    private readonly agents: AgentService,
    private readonly store: MarketPulseStore,
  ) {}

  onApplicationBootstrap(): void {
    this.recompute();
    this.timer = setInterval(() => this.recompute(), MARKET_RECOMPUTE_MS);
    this.timer.unref?.(); // never hold the process open just for the market pulse
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Recompute the whole-map pulse from the current live state and write it to the store. Pure of wall-clock
   * (takes `now`) so it is deterministic under test. Only cells with open freight demand are stored — a cell
   * with no demand has nothing to price. Returns the cells (for the operator insight + tests).
   */
  recompute(now: number = Date.now()): MarketCellPulse[] {
    // SUPPLY: active driver↔vehicle couplings reporting a FRESH GPS position, bucketed by cell. A coupling with
    // no recent location is not counted — a driver we cannot locate is not dependable supply for a zone.
    const supply = new Map<string, number>();
    for (const a of this.fleet.list({ status: 'active' })) {
      if (!a.location || !a.lastLocatedAt) continue;
      if (now - new Date(a.lastLocatedAt).getTime() > MARKET_SUPPLY_STALE_MIN * 60_000) continue;
      const cell = MarketPulseStore.cellFor(a.location);
      supply.set(cell, (supply.get(cell) ?? 0) + 1);
    }

    // DEMAND: open freight jobs, bucketed by their pickup cell. (Totes settle on the pre-paid parcel model, not
    // the freight market, so they are not counted here — noted for a later refinement.)
    const demand = new Map<string, number>();
    for (const f of this.dispatch.listFreight({ status: 'available' })) {
      const cell = MarketPulseStore.cellFor(f.pickupLocation);
      demand.set(cell, (demand.get(cell) ?? 0) + 1);
    }

    const sampledAt = new Date(now).toISOString();
    const cells: MarketCellPulse[] = [];
    for (const [cell, d] of demand) {
      const s = supply.get(cell) ?? 0;
      const pressure = Math.round((d / Math.max(1, s)) * 100) / 100;
      // A thin market (few open loads) carries no reliable signal → stay neutral. Above the threshold, flex by
      // pressure; clampRaw keeps it in the engine's own sane band before the per-vehicle corridor clamp.
      const organicFactor = d < MARKET_MIN_DEMAND ? 1 : MarketPulseStore.clampRaw(1 + MARKET_SURGE_K * (pressure - 1));
      const rule = this.store.activeRule(cell, now);
      const factor = rule ? MarketPulseStore.clampRaw(rule.factor) : organicFactor;
      cells.push({ cell, label: this.labelForCell(cell), supply: s, demand: d, pressure, organicFactor, factor, ruleApplied: !!rule, sampledAt });
    }
    this.store.writeSnapshot(cells, now);
    return cells;
  }

  /** The operator watchtower roll-up: every priced cell (hottest first) + the active surge rules. */
  insight(now: number = Date.now()): { sampledAt: string; cells: MarketCellPulse[]; rules: SurgeRule[] } {
    const snap = this.store.snapshot();
    // Re-derive each cell's APPLIED factor from the LIVE rule, so a rule that lapsed since the last recompute is
    // reflected at once (its cell reverts to the organic factor) — the watchtower never shows, or sorts by, a
    // surge that pricing (which reads the same live rule via factorFor) is no longer charging.
    const cells = snap.cells
      .map((c) => {
        const rule = this.store.activeRule(c.cell, now);
        return { ...c, factor: rule ? MarketPulseStore.clampRaw(rule.factor) : c.organicFactor, ruleApplied: !!rule };
      })
      .sort((a, b) => b.factor - a.factor || b.demand - a.demand);
    return { sampledAt: snap.sampledAt, cells, rules: this.store.activeRules(now) };
  }

  /** Set (or replace) an operator surge rule for a cell, then recompute so the insight reflects it at once. */
  setSurgeRule(input: { cell: string; factor: number; reason: string; by: string; expiresAt?: string }, now: number = Date.now()): SurgeRule {
    const rule = this.store.setRule({ ...input, setAt: new Date(now).toISOString() });
    this.recompute(now);
    return rule;
  }

  clearSurgeRule(cell: string, now: number = Date.now()): { cell: string; cleared: boolean } {
    this.store.clearRule(cell);
    this.recompute(now);
    return { cell, cleared: true };
  }

  /** The bucket key for a coordinate (exposed for the operator surge-rule setter, which accepts a lat/lng). */
  cellFor(geo: GeoPoint): string {
    return MarketPulseStore.cellFor(geo);
  }

  /** Resolve a cell's centroid to the nearest PUDO's zone, so the watchtower shows "NorthTown", not "-1.2,36.8". */
  private labelForCell(cell: string): string {
    const [lat, lng] = cell.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return cell;
    const centroid = { lat, lng };
    let best: { label: string; km: number } | undefined;
    for (const agent of this.agents.list()) {
      if (!agent.location) continue;
      const km = haversineKm(centroid, agent.location);
      if (!best || km < best.km) best = { label: agent.zone || agent.shopName, km };
    }
    return best?.label ?? cell;
  }
}
