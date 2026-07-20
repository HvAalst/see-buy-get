import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ScoringService } from './scoring.service';
import { BadgeService } from './badge.service';
import { FraudService } from './fraud.service';
import {
  CarrierDimension,
  DisputeTag,
  PRIOR_WEIGHT,
  Rating,
  REPUTATION_PRIOR,
  ReputationRecord,
  ReputationView,
  SanctionLevel,
  ShipperDimension,
  SubjectRole,
} from './reputation.types';

const DISPUTE_DIMENSION: Record<DisputeTag, CarrierDimension | ShipperDimension> = {
  damage: 'cargoCare',
  delay: 'onTime',
  documentation: 'documentation',
  payment: 'paymentPromptness',
};

/**
 * ReputationStore (M5 state). Holds each DID's reputation record, applies ratings + dispute
 * adjustments through the scoring engine, evaluates badges, and WRITES the composite back to the
 * Operational Core so M3's reputation-aware matching uses the real score. Also serves the public
 * view (M5-063), personal dashboard (M5-060), challenge (M5-062), and network health (M5-044).
 */
@Injectable()
export class ReputationStore {
  private readonly records = new Map<string, ReputationRecord>();
  private readonly challenges: Array<{ did: string; ratingId: string; at: string }> = [];

  constructor(
    private readonly scoring: ScoringService,
    private readonly badges: BadgeService,
    private readonly fraud: FraudService,
    private readonly core: OperationalStore,
    private readonly events: EventBus,
  ) {}

  getOrCreate(did: string, role: SubjectRole): ReputationRecord {
    let record = this.records.get(did);
    if (!record) {
      record = {
        did,
        role,
        ratings: [],
        dimensions: {},
        composite: REPUTATION_PRIOR,
        confidenceInterval: Math.round((1 / Math.sqrt(PRIOR_WEIGHT)) * 100) / 100,
        samples: 0,
        badges: [],
        disputes: [],
        sanction: 'none',
      };
      this.records.set(did, record);
    }
    return record;
  }

  applyRating(rating: Rating): ReputationRecord {
    const record = this.getOrCreate(rating.subjectDid, rating.subjectRole);
    record.ratings.push(rating);
    this.scoring.recompute(record);
    this.writeBack(record);
    this.badges.evaluate(record);
    void this.events.publish(GlosEvent.Reputation.ScoreUpdated, { did: record.did, composite: record.composite }, { source: 'm5' }).catch(() => undefined);
    return record;
  }

  /** Dispute outcome → adjust the correct dimension + escalate sanctions (M5-050/051/053). */
  applyDispute(subjectDid: string, tag: DisputeTag, atFault: boolean, note?: string): ReputationRecord {
    const role: SubjectRole = tag === 'payment' ? 'shipper' : 'carrier';
    const record = this.getOrCreate(subjectDid, role);
    record.disputes.push({ at: new Date().toISOString(), tag, atFault, note });

    if (atFault) {
      // Feed a penalty into the mapped dimension via the normal scoring path (M5-051).
      record.ratings.push({
        id: `dispute_${randomBytes(6).toString('hex')}`,
        glosShipmentId: 'dispute',
        raterDid: 'did:glos:system',
        subjectDid,
        subjectRole: role,
        scores: { [DISPUTE_DIMENSION[tag]]: 0 },
        weight: 1,
        at: new Date().toISOString(),
      });
      this.scoring.recompute(record);
      record.sanction = this.escalate(record.disputes.filter((d) => d.atFault).length);
      this.writeBack(record);
      this.badges.evaluate(record);
    }
    return record;
  }

  view(did: string): ReputationView {
    const record = this.records.get(did) ?? this.getOrCreate(did, 'carrier');
    return {
      did,
      composite: record.composite,
      confidenceInterval: record.confidenceInterval,
      samples: record.samples,
      dimensions: record.dimensions,
      badges: record.badges.map((b) => b.name),
      disputeSummary: { total: record.disputes.length, atFault: record.disputes.filter((d) => d.atFault).length },
      sanction: record.sanction,
      explanation: this.scoring.explain(record),
    };
  }

  /** Personal dashboard (M5-060): scores + own rating history (PII-free) + What-If. */
  dashboard(did: string): {
    view: ReputationView;
    history: Array<{ at: string; glosShipmentId: string; scores: Rating['scores']; comment?: string }>;
  } {
    const record = this.getOrCreate(did, 'carrier');
    return {
      view: this.view(did),
      history: record.ratings.map((r) => ({
        at: r.at,
        glosShipmentId: r.glosShipmentId,
        scores: r.scores,
        comment: r.private || r.commentHidden ? undefined : r.comment,
      })),
    };
  }

  /** What-If simulator (M5-060): preview the composite if a rating were added. */
  whatIf(did: string, simulated: Rating): number {
    const record = this.getOrCreate(did, simulated.subjectRole);
    const clone: ReputationRecord = { ...record, ratings: [...record.ratings, simulated], dimensions: {} };
    this.scoring.recompute(clone);
    return clone.composite;
  }

  /** Right to challenge (M5-062): flag a rating for review. */
  challenge(did: string, ratingId: string): { filed: boolean } {
    this.challenges.push({ did, ratingId, at: new Date().toISOString() });
    return { filed: true };
  }

  /** Operator network-health dashboard (M5-044). */
  networkHealth(): Record<string, unknown> {
    const all = [...this.records.values()];
    const buckets = [0, 0, 0, 0, 0];
    for (const r of all) buckets[Math.min(4, Math.floor(r.composite))] += 1;
    const sanctions = all.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.sanction]: (acc[r.sanction] ?? 0) + 1 }), {});
    return {
      participants: all.length,
      distribution: { '0-1': buckets[0], '1-2': buckets[1], '2-3': buckets[2], '3-4': buckets[3], '4-5': buckets[4] },
      sanctions,
      collusionPairs: this.fraud.detectCollusionPairs().length,
      sybilClusters: this.fraud.detectSybilClusters().length,
    };
  }

  private writeBack(record: ReputationRecord): void {
    this.core.updateReputation(record.did, record.composite); // → M3 reputation-aware matching
  }

  private escalate(atFaultCount: number): SanctionLevel {
    if (atFaultCount >= 4) return 'deplatformed';
    if (atFaultCount >= 3) return 'suspended';
    if (atFaultCount >= 2) return 'restricted';
    if (atFaultCount >= 1) return 'training';
    return 'none';
  }
}
