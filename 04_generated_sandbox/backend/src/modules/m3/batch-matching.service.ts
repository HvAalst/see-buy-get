import { Injectable } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { BatchAssignment, BatchResult, DemandInput } from './matching.types';

/**
 * BatchMatchingService (M3-031). Context-aware batch matching: instead of greedily filling each job
 * in isolation, it quotes every demand in the window, then solves a global assignment that maximises
 * total match quality while keeping every carrier to one job. Best for line-haul where a short batch
 * window beats instant-but-locally-optimal assignment. Falls through to MatchingService to materialise
 * each chosen offer (so accept/cascade/escrow all work unchanged).
 */
@Injectable()
export class BatchMatchingService {
  constructor(private readonly matching: MatchingService) {}

  /** Solve a set of demands jointly; assign distinct carriers to maximise aggregate score. */
  solve(demands: DemandInput[], window: 'instant' | 'batch' = 'batch'): BatchResult {
    // 1) Quote every demand (side-effect-free) to get its ranked eligible carriers.
    const quotes = demands.map((d) => ({ demand: d, ranked: this.safeQuote(d) }));

    // 2) Greedy global assignment: take the highest-scoring (demand, carrier) pairs first, never
    //    double-booking a carrier or a demand. Greedy on a sorted edge list is a strong, fast
    //    approximation of the optimal bipartite assignment for this scale.
    const edges = quotes
      .flatMap(({ demand, ranked }, di) => ranked.map((c) => ({ di, glosShipmentId: demand.glosShipmentId, carrierDid: c.did, score: c.score })))
      .sort((a, b) => b.score - a.score || a.carrierDid.localeCompare(b.carrierDid));

    const usedDemand = new Set<number>();
    const usedCarrier = new Set<string>();
    const chosen = new Map<number, { carrierDid: string; score: number }>();
    for (const e of edges) {
      if (usedDemand.has(e.di) || usedCarrier.has(e.carrierDid)) continue;
      usedDemand.add(e.di);
      usedCarrier.add(e.carrierDid);
      chosen.set(e.di, { carrierDid: e.carrierDid, score: e.score });
    }

    // 3) Materialise each chosen pairing as a directed offer.
    const assignments: BatchAssignment[] = quotes.map(({ demand }, di) => {
      const pick = chosen.get(di);
      if (!pick) return { glosShipmentId: demand.glosShipmentId, status: 'unmatched', reason: 'no_distinct_carrier' };
      const view = this.matching.offerDirected(demand, pick.carrierDid);
      return { glosShipmentId: demand.glosShipmentId, matchId: view.matchId, carrierDid: pick.carrierDid, score: pick.score, total: view.price.total, status: 'assigned' };
    });

    const assigned = assignments.filter((a) => a.status === 'assigned');
    return { window, demands: demands.length, assigned: assigned.length, totalScore: Math.round(assigned.reduce((s, a) => s + (a.score ?? 0), 0) * 1000) / 1000, assignments };
  }

  private safeQuote(demand: DemandInput) {
    try {
      return this.matching.quote(demand).ranked;
    } catch {
      return [];
    }
  }
}
