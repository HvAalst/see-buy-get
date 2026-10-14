import { Injectable } from '@nestjs/common';
import { PriceBreakdown, ServiceTier } from './matching.types';

/** Service-tier price multipliers (M3-044). White-Glove also carries matching constraints. */
const TIER_MULTIPLIER: Record<ServiceTier, number> = { economy: 0.85, standard: 1, express: 1.4, white_glove: 2.2 };
const BINDING_WINDOW_MS = 60 * 1000; // spot prices binding for 60s (M3-042)

/**
 * PricingService (M3-040/041/042/044). Real-time dynamic pricing: base lane rate × scarcity surge ×
 * service-tier multiplier, bounded by a configurable cap, with a transparent breakdown. Spot prices
 * are binding for a short window; indicative (batch / pre-booked) prices carry a confidence band and
 * bind only on confirmation.
 */
@Injectable()
export class PricingService {
  private readonly surgeCap = 3;

  /**
   * @param totalWeightKg shipment weight
   * @param legCount number of legs
   * @param availableCount eligible carriers in the pool (scarcity signal)
   * @param opts tier, currency, and whether the quote is indicative (batch/pre-book)
   */
  price(totalWeightKg: number, legCount: number, availableCount: number, opts: { currency?: string; tier?: ServiceTier; indicative?: boolean } = {}): PriceBreakdown {
    const currency = opts.currency ?? 'USD';
    const tier = opts.tier ?? 'standard';
    const tierMultiplier = TIER_MULTIPLIER[tier];

    const baseRate = Math.round((50 * Math.max(1, legCount) + totalWeightKg * 2) * 100) / 100;
    const surgeMultiplier = this.surge(availableCount);
    const total = Math.round(baseRate * surgeMultiplier * tierMultiplier * 100) / 100;

    const breakdown: PriceBreakdown = { baseRate, surgeMultiplier, tier, tierMultiplier, total, currency, binding: !opts.indicative };
    if (opts.indicative) {
      // Batch / pre-booked: not yet binding, quoted as a ±12% confidence band (M3-042).
      breakdown.confidence = { low: Math.round(total * 0.88 * 100) / 100, high: Math.round(total * 1.12 * 100) / 100 };
    } else {
      breakdown.bindingUntil = new Date(Date.now() + BINDING_WINDOW_MS).toISOString();
    }
    return breakdown;
  }

  /** Fewer available carriers → higher surge, capped. */
  private surge(availableCount: number): number {
    if (availableCount <= 1) return Math.min(this.surgeCap, 1.5);
    if (availableCount === 2) return 1.2;
    return 1;
  }
}
