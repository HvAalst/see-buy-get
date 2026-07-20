import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { TransactionRegistry } from './transaction-registry.service';
import { ReputationStore } from './reputation-store.service';
import { FraudService } from './fraud.service';
import { CarrierDimension, Rating, ReputationView, ShipperDimension, SubjectRole } from './reputation.types';

export interface SubmitRatingInput {
  glosShipmentId: string;
  raterDid: string;
  // carrier dimensions
  onTime?: 'yes' | 'late';
  cargoCare?: 'pristine' | 'damaged';
  communication?: number; // 1–5
  documentation?: 'accurate' | 'issues';
  equipment?: 'compliant' | 'noncompliant';
  // shipper dimensions
  paymentPromptness?: 'prompt' | 'late';
  loadReadiness?: 'ready' | 'delayed';
  informationAccuracy?: 'accurate' | 'inaccurate';
  facilityAccessibility?: number; // 1–5
  comment?: string;
  private?: boolean;
  forceMajeure?: boolean;
  weight?: number;
}

const TOXIC = ['idiot', 'scam', 'hate', 'stupid', 'trash'];

/**
 * RatingService (M5-020/021/022/024). Structured mutual ratings, verification-anchored to a
 * completed M4 transaction by a verified participant (no double rating), with sentiment hiding
 * and collusion down-weighting, then routed through the scoring engine.
 */
@Injectable()
export class RatingService {
  constructor(
    private readonly registry: TransactionRegistry,
    private readonly store: ReputationStore,
    private readonly fraud: FraudService,
    private readonly events: EventBus,
  ) {}

  submit(input: SubmitRatingInput): ReputationView {
    // Verification anchor (M5-021): rater must be a participant in a known transaction.
    const txn = this.registry.counterparty(input.glosShipmentId, input.raterDid);
    if (!txn) throw new BadRequestException('Unknown transaction, or rater is not a participant');
    if (!this.registry.isComplete(input.glosShipmentId)) throw new BadRequestException('Transaction is not complete yet');
    if (this.registry.hasRated(input.glosShipmentId, input.raterDid)) throw new BadRequestException('You already rated this transaction');

    const scores = this.mapScores(input, txn.role);
    if (Object.keys(scores).length === 0) throw new BadRequestException('At least one rating dimension is required');

    // Sentiment / anomaly (M5-024).
    const hidden = input.comment ? TOXIC.some((w) => input.comment!.toLowerCase().includes(w)) : false;

    const positive = average(Object.values(scores)) >= 80;
    const weight = (input.weight ?? 1) * this.fraud.collusionFactor(input.raterDid, txn.did);

    const rating: Rating = {
      id: `rat_${randomBytes(8).toString('hex')}`,
      glosShipmentId: input.glosShipmentId,
      raterDid: input.raterDid,
      subjectDid: txn.did,
      subjectRole: txn.role,
      scores,
      comment: hidden ? undefined : input.comment,
      commentHidden: hidden,
      private: input.private,
      forceMajeure: input.forceMajeure,
      weight,
      at: new Date().toISOString(),
    };

    this.fraud.recordRating(input.raterDid, txn.did, positive);
    this.registry.markRated(input.glosShipmentId, input.raterDid);
    this.store.applyRating(rating);

    void this.events.publish(GlosEvent.Reputation.RatingSubmitted, { glosShipmentId: input.glosShipmentId, subjectDid: txn.did }, { source: 'm5' }).catch(() => undefined);
    return this.store.view(txn.did);
  }

  private mapScores(input: SubmitRatingInput, role: SubjectRole): Partial<Record<CarrierDimension | ShipperDimension, number>> {
    const s: Partial<Record<CarrierDimension | ShipperDimension, number>> = {};
    if (role === 'carrier') {
      if (input.onTime) s.onTime = input.onTime === 'yes' ? 100 : 0;
      if (input.cargoCare) s.cargoCare = input.cargoCare === 'pristine' ? 100 : 0;
      if (input.communication != null) s.communication = scale1to5(input.communication);
      if (input.documentation) s.documentation = input.documentation === 'accurate' ? 100 : 0;
      if (input.equipment) s.equipment = input.equipment === 'compliant' ? 100 : 0;
    } else {
      if (input.paymentPromptness) s.paymentPromptness = input.paymentPromptness === 'prompt' ? 100 : 0;
      if (input.loadReadiness) s.loadReadiness = input.loadReadiness === 'ready' ? 100 : 0;
      if (input.informationAccuracy) s.informationAccuracy = input.informationAccuracy === 'accurate' ? 100 : 0;
      if (input.facilityAccessibility != null) s.facilityAccessibility = scale1to5(input.facilityAccessibility);
    }
    return s;
  }
}

function scale1to5(v: number): number {
  return Math.round(((Math.min(5, Math.max(1, v)) - 1) / 4) * 100);
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
