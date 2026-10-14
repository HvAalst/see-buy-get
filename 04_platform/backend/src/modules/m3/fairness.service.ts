import { Injectable } from '@nestjs/common';
import { FairnessReport, SegmentStat, ServiceTier } from './matching.types';

interface Counter {
  offers: number;
  accepts: number;
  coldStartOffers: number;
}

/**
 * FairnessService (M3-035/061). Records offer/accept outcomes by segment (zone, tier, cold-start
 * status) so the matching engine's distribution can be audited for bias — the data behind the
 * algorithmic-fairness dashboard. Pseudonymous: segments are zones/tiers, never provider identities.
 */
@Injectable()
export class FairnessService {
  private readonly byZone = new Map<string, Counter>();
  private readonly byTier = new Map<string, Counter>();
  private totalOffers = 0;
  private totalAccepts = 0;
  private coldStartOffers = 0;

  recordOffer(input: { zone: string; tier: ServiceTier; coldStart: boolean }): void {
    this.totalOffers += 1;
    if (input.coldStart) this.coldStartOffers += 1;
    const z = this.counter(this.byZone, input.zone || 'unknown');
    z.offers += 1;
    if (input.coldStart) z.coldStartOffers += 1;
    this.counter(this.byTier, input.tier).offers += 1;
  }

  recordAccept(input: { zone: string; tier: ServiceTier }): void {
    this.totalAccepts += 1;
    this.counter(this.byZone, input.zone || 'unknown').accepts += 1;
    this.counter(this.byTier, input.tier).accepts += 1;
  }

  report(): FairnessReport {
    return {
      totalOffers: this.totalOffers,
      totalAccepts: this.totalAccepts,
      coldStartOfferShare: this.totalOffers ? Math.round((this.coldStartOffers / this.totalOffers) * 100) / 100 : 0,
      byZone: this.segments(this.byZone),
      byTier: this.segments(this.byTier),
      at: new Date().toISOString(),
    };
  }

  private segments(map: Map<string, Counter>): SegmentStat[] {
    return [...map.entries()]
      .map(([segment, c]) => ({ segment, offers: c.offers, accepts: c.accepts, acceptanceRate: c.offers ? Math.round((c.accepts / c.offers) * 100) / 100 : 0, coldStartOffers: c.coldStartOffers }))
      .sort((a, b) => b.offers - a.offers);
  }

  private counter(map: Map<string, Counter>, key: string): Counter {
    let c = map.get(key);
    if (!c) {
      c = { offers: 0, accepts: 0, coldStartOffers: 0 };
      map.set(key, c);
    }
    return c;
  }
}
