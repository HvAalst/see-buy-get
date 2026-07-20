import { Module } from '@nestjs/common';
import { M2Module } from '../m2/m2.module';
import { M3Controller } from './m3.controller';
import { MatchingService } from './matching.service';
import { AvailabilityService } from './availability.service';
import { PricingService } from './pricing.service';
import { CarrierProfileService } from './carrier-profile.service';
import { FairnessService } from './fairness.service';
import { PredictionService } from './prediction.service';
import { BatchMatchingService } from './batch-matching.service';

/**
 * M3 — Dynamic Matchmaking & Pricing Engine (DME).
 * Epic: 02_epic_domains/epic_m3_matching_pricing.md.
 * Sprints 0–1 (marketplace): availability feed, demand intake (pulls M2 JRV), capability-VC +
 * reputation filtering, multi-objective scoring, dynamic pricing, offer/accept/cascade,
 * `match.confirmed` → SSE escrow + M4 tracking. Sprints 2–3: context-aware batch matching,
 * predictive availability + pre-booking, cold-start + fairness dashboard, explainability, governed
 * overrides, and service tiers. Imports M2Module for the JRV; CredentialService + OperationalStore
 * are global.
 */
@Module({
  imports: [M2Module],
  controllers: [M3Controller],
  providers: [MatchingService, AvailabilityService, PricingService, CarrierProfileService, FairnessService, PredictionService, BatchMatchingService],
  exports: [MatchingService],
})
export class M3Module {}
