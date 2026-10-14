import { Injectable } from '@nestjs/common';
import {
  CARRIER_WEIGHTS,
  CarrierDimension,
  DimensionScore,
  HALFLIFE_DAYS,
  PRIOR_WEIGHT,
  Rating,
  REPUTATION_PRIOR,
  ReputationRecord,
  SHIPPER_WEIGHTS,
  ShipperDimension,
  SubjectRole,
} from './reputation.types';

type Dimension = CarrierDimension | ShipperDimension;

/**
 * ScoringService (M5-010/011/012/013/014). Pure reputation math:
 * - per-dimension time-decayed + volume-weighted averages (0–100),
 * - publicly-weighted composite (0–5),
 * - Bayesian blend with a neutral prior + a confidence interval that narrows with samples,
 * - root-cause (force-majeure) exclusion of on-time,
 * - plain-language explanation (no black box).
 */
@Injectable()
export class ScoringService {
  weightsFor(role: SubjectRole): Record<string, number> {
    return role === 'carrier' ? CARRIER_WEIGHTS : SHIPPER_WEIGHTS;
  }

  /** Recompute dimensions + composite + confidence from the full rating history. */
  recompute(record: ReputationRecord, now: number = Date.now()): void {
    const dimensions = this.computeDimensions(record.ratings, now);
    const rawComposite = this.compositeFromDimensions(dimensions, record.role); // 0–5
    const samples = record.ratings.length;

    record.dimensions = dimensions;
    record.samples = samples;
    record.composite = this.bayesian(rawComposite, samples);
    record.confidenceInterval = Math.round((1.0 / Math.sqrt(PRIOR_WEIGHT + samples)) * 100) / 100;
  }

  private computeDimensions(ratings: Rating[], now: number): Partial<Record<Dimension, DimensionScore>> {
    const acc = new Map<Dimension, { wsum: number; vsum: number; samples: number }>();

    for (const rating of ratings) {
      const decay = this.decayWeight(rating.at, now);
      const weight = decay * (rating.weight || 1);
      for (const [dim, value] of Object.entries(rating.scores) as [Dimension, number][]) {
        // Root-cause: skip on-time contributions for force-majeure transactions (M5-014).
        if (dim === 'onTime' && rating.forceMajeure) continue;
        const cur = acc.get(dim) ?? { wsum: 0, vsum: 0, samples: 0 };
        cur.wsum += weight;
        cur.vsum += weight * value;
        cur.samples += 1;
        acc.set(dim, cur);
      }
    }

    const out: Partial<Record<Dimension, DimensionScore>> = {};
    for (const [dim, a] of acc) {
      out[dim] = { value: a.wsum > 0 ? Math.round((a.vsum / a.wsum) * 10) / 10 : 0, samples: a.samples };
    }
    return out;
  }

  /** Weighted 0–100 over present dimensions (renormalized) → 0–5. */
  private compositeFromDimensions(dimensions: Partial<Record<Dimension, DimensionScore>>, role: SubjectRole): number {
    const weights = this.weightsFor(role);
    let wsum = 0;
    let vsum = 0;
    for (const [dim, score] of Object.entries(dimensions) as [Dimension, DimensionScore][]) {
      const w = weights[dim] ?? 0;
      wsum += w;
      vsum += w * score.value;
    }
    if (wsum === 0) return REPUTATION_PRIOR;
    return vsum / wsum / 20; // 0–100 → 0–5
  }

  /** Bayesian blend with the neutral prior (M5-013). */
  private bayesian(raw0to5: number, samples: number): number {
    const blended = (PRIOR_WEIGHT * REPUTATION_PRIOR + samples * raw0to5) / (PRIOR_WEIGHT + samples);
    return Math.round(blended * 100) / 100;
  }

  private decayWeight(at: string, now: number): number {
    const ageDays = Math.max(0, (now - new Date(at).getTime()) / 86_400_000);
    return Math.pow(0.5, ageDays / HALFLIFE_DAYS);
  }

  /** Plain-language explanation (M5-061). */
  explain(record: ReputationRecord): string {
    if (record.samples === 0) {
      return `Trust Score ${record.composite.toFixed(1)} (neutral starting score, no ratings yet).`;
    }
    const weights = this.weightsFor(record.role);
    const parts = (Object.entries(record.dimensions) as [Dimension, DimensionScore][])
      .map(([dim, s]) => `${dim} ${Math.round(s.value)}/100 (${Math.round((weights[dim] ?? 0) * 100)}%)`)
      .join(', ');
    return `Trust Score ${record.composite.toFixed(1)} ±${record.confidenceInterval.toFixed(2)} from ${record.samples} rating(s). Based on ${parts}.`;
  }
}
