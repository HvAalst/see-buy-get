import { Injectable } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GeoPoint } from './pudo.types';
import { MARKET_CELL_DP, MARKET_RAW_MAX, MARKET_RAW_MIN } from './pudo.config';

/** The computed supply/demand pulse for one market cell (a ~0.1° geo bucket). Ephemeral — recomputed. */
export interface MarketCellPulse {
  cell: string; // "lat,lng" bucket key
  label: string; // nearest PUDO zone, for a human-readable watchtower
  supply: number; // live vehicles reporting a recent position in the cell
  demand: number; // open freight jobs whose pickup is in the cell
  pressure: number; // demand / max(1, supply)
  organicFactor: number; // the supply/demand-derived factor (before any admin rule), 1.0 = neutral
  factor: number; // the APPLIED factor (an active admin rule overrides the organic one)
  ruleApplied: boolean;
  sampledAt: string;
}

/** An operator's manual surge override for a cell — a known event ("stadium tonight"), clamped like any factor. */
export interface SurgeRule {
  cell: string;
  factor: number;
  reason: string;
  by: string;
  setAt: string;
  expiresAt?: string;
}

/**
 * MarketPulseStore — the dependency-free read-model the freight-pricing market pulse writes to and the
 * dispatch pricing path reads from. It exists to BREAK a dependency cycle: DispatchService needs the market
 * factor at price time, and the MarketPulseService that computes it needs DispatchService's open freight — so
 * neither can inject the other. This leaf holds the computed snapshot (ephemeral — recomputed on a timer) plus
 * the durable operator surge rules; DispatchService injects only this store, MarketPulseService writes it.
 */
@Injectable()
export class MarketPulseStore {
  // Durable: an operator's surge rule is an operational decision that must survive a restart (the computed
  // cells are not — they are re-derived every couple of minutes from live supply/demand).
  private readonly rules = new PersistentMap<string, SurgeRule>('pudo-surge-rules');
  private cells = new Map<string, MarketCellPulse>();
  private sampledAt = '';

  /** The market-zone bucket for a coordinate — a coarse geo-cell, mirroring the monitor heatmap's density key. */
  static cellFor(geo: GeoPoint): string {
    return `${geo.lat.toFixed(MARKET_CELL_DP)},${geo.lng.toFixed(MARKET_CELL_DP)}`;
  }

  /** Clamp a raw factor to the engine's own sane band — never NaN, never a runaway surge. */
  static clampRaw(factor: number): number {
    if (!Number.isFinite(factor)) return 1;
    return Math.min(MARKET_RAW_MAX, Math.max(MARKET_RAW_MIN, Math.round(factor * 100) / 100));
  }

  /**
   * The market factor for a location RIGHT NOW: an active operator surge rule wins (applied live, so a rule set
   * between recomputes takes effect immediately); otherwise the last snapshot's organic supply/demand factor;
   * otherwise a neutral 1.0 (no geo, an unsampled cell, or a thin market). Always finite.
   */
  factorFor(geo: GeoPoint | undefined, now: number = Date.now()): number {
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return 1;
    const cell = MarketPulseStore.cellFor(geo);
    const rule = this.activeRule(cell, now);
    if (rule) return MarketPulseStore.clampRaw(rule.factor);
    return this.cells.get(cell)?.organicFactor ?? 1;
  }

  /** Replace the computed snapshot (called by MarketPulseService.recompute). */
  writeSnapshot(cells: MarketCellPulse[], now: number = Date.now()): void {
    this.cells = new Map(cells.map((c) => [c.cell, c]));
    this.sampledAt = new Date(now).toISOString();
  }

  snapshot(): { cells: MarketCellPulse[]; sampledAt: string } {
    return { cells: [...this.cells.values()], sampledAt: this.sampledAt };
  }

  setRule(rule: SurgeRule): SurgeRule {
    const stored: SurgeRule = { ...rule, factor: MarketPulseStore.clampRaw(rule.factor) };
    this.rules.set(rule.cell, stored);
    return stored;
  }

  clearRule(cell: string): void {
    this.rules.delete(cell);
  }

  /**
   * A rule is lapsed once past its expiry — AND a rule whose expiresAt is unparseable is treated as lapsed too.
   * Both the price-time read (activeRule → factorFor) and the watchtower read (activeRules → insight) go through
   * this ONE predicate, so a malformed date can never diverge them into a permanent, operator-invisible surge:
   * an unparseable expiry fails safe (the rule stops applying and shows as gone), never "active forever".
   */
  private isLapsed(rule: SurgeRule, now: number): boolean {
    if (!rule.expiresAt) return false;
    const t = new Date(rule.expiresAt).getTime();
    return !Number.isFinite(t) || t <= now;
  }

  activeRule(cell: string, now: number = Date.now()): SurgeRule | undefined {
    const rule = this.rules.get(cell);
    return rule && !this.isLapsed(rule, now) ? rule : undefined;
  }

  activeRules(now: number = Date.now()): SurgeRule[] {
    return [...this.rules.values()].filter((r) => !this.isLapsed(r, now));
  }
}
