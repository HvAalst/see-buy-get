import { Module } from '@nestjs/common';
import { M5Controller } from './m5.controller';
import { ScoringService } from './scoring.service';
import { BadgeService } from './badge.service';
import { FraudService } from './fraud.service';
import { TransactionRegistry } from './transaction-registry.service';
import { ReputationStore } from './reputation-store.service';
import { RatingService } from './rating.service';
import { DisputeAdjustmentService } from './dispute-adjustment.service';

/**
 * M5 — Trust & Reputation Layer (TRL).
 * Epic: 02_epic_domains/epic_m5_trust_reputation.md.
 * Full build: multi-dimensional scoring (M5-010..014), verification-anchored ratings
 * (M5-020..024), trust badges (M5-030..033), fraud/Sybil (M5-040..044), dispute adjustment
 * (M5-050..053), transparency (M5-060..063). Writes the composite back to the Operational Core
 * so M3 matches on real reputation. CredentialService + OperationalStore + EventBus are global.
 */
@Module({
  controllers: [M5Controller],
  providers: [
    ScoringService,
    BadgeService,
    FraudService,
    TransactionRegistry,
    ReputationStore,
    RatingService,
    DisputeAdjustmentService,
  ],
})
export class M5Module {}
