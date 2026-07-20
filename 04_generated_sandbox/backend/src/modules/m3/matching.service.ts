import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { CredentialService } from '../../foundation/credentials/credential.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { ShipmentService } from '../m2/shipment.service';
import { LegDecompositionService } from '../m2/leg-decomposition.service';
import { AvailabilityService } from './availability.service';
import { PricingService } from './pricing.service';
import { CarrierProfileService } from './carrier-profile.service';
import { FairnessService } from './fairness.service';
import { AuditEntry, Candidate, DemandInput, Match, MatchMilestoneTerm, MatchView, Quote, ServiceTier } from './matching.types';

const REPUTATION_PRIOR = 3.0; // Bayesian prior until M5 sets a real score
const COLD_START_BOOST = 0.05; // small nudge so new carriers win some low-risk work (M3-034)
const TIER_MIN_REPUTATION: Record<ServiceTier, number> = { economy: 0, standard: 0, express: 0, white_glove: 4.8 }; // M3-044

/**
 * MatchingService (M3-021/030/033/034/040/044/050/051/054/060/062). Pulls the M2 Job Requirement
 * Vector, filters the supply pool by capability VCs + equipment + reputation (with a service-tier
 * floor), applies cold-start handling, scores candidates on a weighted objective, prices dynamically,
 * and runs the offer/accept/cascade loop. `quote()` is a side-effect-free preview (deterministic
 * ranking, NFR-M3-06); `match()`/`offerDirected()` materialise an offer; `forceAssign`/`block` are the
 * governed manual overrides. On confirmation it emits `match.confirmed` → SSE escrow + M4 tracking.
 */
@Injectable()
export class MatchingService {
  private readonly matches = new Map<string, Match>();

  constructor(
    private readonly shipments: ShipmentService,
    private readonly legs: LegDecompositionService,
    private readonly credentials: CredentialService,
    private readonly core: OperationalStore,
    private readonly availability: AvailabilityService,
    private readonly pricing: PricingService,
    private readonly profiles: CarrierProfileService,
    private readonly fairness: FairnessService,
    private readonly events: EventBus,
  ) {}

  /** Side-effect-free preview: eligible carriers, ranked, with the price + explanation (M3-060). */
  quote(demand: DemandInput): Quote {
    const shipment = this.shipments.require(demand.glosShipmentId);
    if (shipment.legs.length === 0) throw new BadRequestException('Shipment must be decomposed first (M2)');

    const jrv = this.legs.buildJobRequirementVector(shipment);
    const requiredVCs = unique(jrv.perLeg.flatMap((l) => l.mandatoryVCs));
    const requiredEquipment = unique(jrv.perLeg.flatMap((l) => l.equipment));
    const slo = demand.slo ?? {};
    const tier = slo.tier ?? 'standard';
    const minReputation = Math.max(slo.minReputation ?? 0, TIER_MIN_REPUTATION[tier]);

    const baseEligible = this.availability.available().filter(
      (c) =>
        requiredVCs.every((vc) => this.credentials.hasValid(c.did, vc)) &&
        requiredEquipment.every((eq) => c.equipment.includes(eq)) &&
        this.reputationOf(c.did) >= minReputation,
    );

    const currency = demand.currency ?? 'USD';
    const price = this.pricing.price(shipment.ewaybill.packaging.totalWeightKg, shipment.legs.length, baseEligible.length, { currency, tier });

    // Cold-start value cap: keep new carriers off very-high-value jobs when an established carrier
    // is available, but never strand a job that only new carriers can cover (M3-033/034).
    const hasEstablished = baseEligible.some((c) => !this.profiles.isColdStart(c.did));
    const eligible = baseEligible.filter((c) => this.profiles.eligibleForValue(c.did, price.total, hasEstablished));
    const ranked = this.score(eligible.map((e) => e.did), demand);

    return { glosShipmentId: demand.glosShipmentId, tier, price, ranked, eligibleCount: eligible.length, explanation: ranked.length ? this.explain(ranked, price, tier) : undefined };
  }

  /** Submit demand → offer to the top-ranked carrier (M3-010/021/030/040). */
  match(demand: DemandInput): MatchView {
    return this.materialize(demand, this.quote(demand), 0);
  }

  /** Offer to a specific carrier chosen externally (used by batch optimisation, M3-031). */
  offerDirected(demand: DemandInput, carrierDid: string): MatchView {
    const quote = this.quote(demand);
    const index = quote.ranked.findIndex((c) => c.did === carrierDid);
    if (index < 0) throw new BadRequestException(`Carrier ${carrierDid} is not eligible for ${demand.glosShipmentId}`);
    return this.materialize(demand, quote, index);
  }

  /** M3-050: the current offered carrier accepts → confirmed → match.confirmed. */
  accept(matchId: string): MatchView {
    const match = this.require(matchId);
    if (match.status !== 'offered') throw new BadRequestException(`Match is ${match.status}, not offered`);
    const carrierDid = match.ranked[match.offerIndex].did;

    match.status = 'confirmed';
    match.confirmedCarrierDid = carrierDid;
    match.milestones = match.milestones.map((m) => ({ ...m, payeeDid: carrierDid }));
    this.availability.setStatus(carrierDid, 'busy');
    match.audit.push(entry('offer_accepted', { carrierDid }));
    this.fairness.recordAccept({ zone: match.zone ?? '', tier: match.tier });

    this.publishConfirmed(match, carrierDid);
    return this.view(match);
  }

  /** M3-051: current offer rejected/timed out → cascade to the next-best, no re-submission. */
  reject(matchId: string): MatchView {
    const match = this.require(matchId);
    if (match.status !== 'offered') throw new BadRequestException(`Match is ${match.status}, not offered`);
    match.offerIndex += 1;
    if (match.offerIndex >= match.ranked.length) {
      match.status = 'failed';
      match.audit.push(entry('cascade_exhausted', {}));
    } else {
      const next = match.ranked[match.offerIndex];
      match.audit.push(entry('fallback_cascaded', { carrierDid: next.did }));
      this.fairness.recordOffer({ zone: match.zone ?? '', tier: match.tier, coldStart: next.coldStart });
      void this.events.publish(GlosEvent.Match.FallbackCascaded, { matchId, carrierDid: next.did }, { source: 'm3' }).catch(() => undefined);
    }
    return this.view(match);
  }

  /** M3-062: authorized ops force-assign a carrier (VIP/humanitarian); logged + flagged for review. */
  forceAssign(matchId: string, carrierDid: string, reason: string, by?: string): MatchView {
    if (!reason?.trim()) throw new BadRequestException('An override reason is mandatory');
    const match = this.require(matchId);
    if (match.status === 'confirmed') throw new BadRequestException('Match already confirmed');

    match.status = 'confirmed';
    match.confirmedCarrierDid = carrierDid;
    match.milestones = match.milestones.map((m) => ({ ...m, payeeDid: carrierDid }));
    match.override = { type: 'force_assign', reason, reviewFlag: true, by, at: new Date().toISOString() };
    this.availability.setStatus(carrierDid, 'busy');
    match.audit.push(entry('override_force_assign', { carrierDid, reason, by }));
    this.fairness.recordAccept({ zone: match.zone ?? '', tier: match.tier });

    this.publishConfirmed(match, carrierDid);
    return this.view(match);
  }

  /** M3-062: authorized ops block a match; logged + flagged for review. */
  block(matchId: string, reason: string, by?: string): MatchView {
    if (!reason?.trim()) throw new BadRequestException('An override reason is mandatory');
    const match = this.require(matchId);
    if (match.status === 'confirmed') throw new BadRequestException('Match already confirmed');
    match.status = 'blocked';
    match.override = { type: 'block', reason, reviewFlag: true, by, at: new Date().toISOString() };
    match.audit.push(entry('override_block', { reason, by }));
    return this.view(match);
  }

  get(matchId: string): Match {
    return this.require(matchId);
  }

  // --- internals ---

  private materialize(demand: DemandInput, quote: Quote, offerIndex: number): MatchView {
    const slo = demand.slo ?? {};
    const affordable = !slo.maxCost || quote.price.total <= slo.maxCost;
    const hasOffer = quote.ranked.length > offerIndex && affordable;

    const match: Match = {
      matchId: `match_${randomBytes(10).toString('hex')}`,
      glosShipmentId: demand.glosShipmentId,
      payerDid: demand.payerDid,
      zone: demand.zone,
      currency: quote.price.currency,
      tier: quote.tier,
      price: quote.price,
      ranked: quote.ranked,
      offerIndex,
      status: hasOffer ? 'offered' : 'failed',
      explanation: hasOffer ? quote.explanation : undefined,
      milestones: this.milestoneTemplate(this.shipments.require(demand.glosShipmentId).milestones.map((m) => m.name)),
      audit: [
        entry('demand_received', { glosShipmentId: demand.glosShipmentId, tier: quote.tier }),
        entry('candidates_filtered', { eligible: quote.ranked.map((c) => c.did) }),
        entry('priced', { ...quote.price }),
      ],
      createdAt: new Date().toISOString(),
    };
    this.matches.set(match.matchId, match);

    if (hasOffer) {
      const carrier = quote.ranked[offerIndex];
      match.audit.push(entry('offer_sent', { carrierDid: carrier.did }));
      this.fairness.recordOffer({ zone: demand.zone ?? '', tier: quote.tier, coldStart: carrier.coldStart });
      void this.events.publish(GlosEvent.Match.OfferSent, { matchId: match.matchId, carrierDid: carrier.did }, { source: 'm3' }).catch(() => undefined);
    } else {
      match.audit.push(entry('no_match', { reason: quote.ranked.length === 0 ? 'no_eligible_carrier' : 'over_budget' }));
    }
    return this.view(match);
  }

  private publishConfirmed(match: Match, carrierDid: string): void {
    void this.events.publish(GlosEvent.Match.OfferAccepted, { matchId: match.matchId, carrierDid }, { source: 'm3' }).catch(() => undefined);
    void this.events
      .publish(
        GlosEvent.Match.Confirmed,
        { glosShipmentId: match.glosShipmentId, payerDid: match.payerDid, carrierDid, currency: match.currency, total: match.price.total, milestones: match.milestones },
        { source: 'm3' },
      )
      .catch(() => undefined);
  }

  private score(dids: string[], demand: DemandInput): Candidate[] {
    const w = normalizeWeights(demand.slo?.weights);
    return dids
      .map((did) => {
        const reputation = this.reputationOf(did);
        const zoneMatch = demand.zone ? this.availability.get(did)?.zone === demand.zone : true;
        const coldStart = this.profiles.isColdStart(did);
        const coldStartBoost = coldStart ? COLD_START_BOOST : 0;
        const breakdown = { cost: 1, reputation: reputation / 5, proximity: zoneMatch ? 1 : 0.5, coldStartBoost };
        const sc = w.cost * breakdown.cost + w.reputation * breakdown.reputation + w.proximity * breakdown.proximity + coldStartBoost;
        return { did, reputation, zoneMatch, coldStart, score: Math.round(sc * 1000) / 1000, breakdown };
      })
      .sort((a, b) => b.score - a.score || b.reputation - a.reputation || a.did.localeCompare(b.did));
  }

  /** M3-060: a plain-language reason the winner was chosen. */
  private explain(ranked: Candidate[], price: { total: number; currency: string }, tier: ServiceTier): string {
    const top = ranked[0];
    const tierLabel = tier === 'standard' ? '' : `${tier.replace('_', '-')} `;
    let s = `Chose ${maskDid(top.did)} — reputation ${top.reputation.toFixed(1)}/5 — for this ${tierLabel}job at ${price.currency} ${price.total}`;
    if (ranked.length > 1) s += `, the best of ${ranked.length} eligible carriers (next best ${ranked[1].reputation.toFixed(1)}/5).`;
    else s += ', the only eligible carrier.';
    if (top.coldStart) s += ' New carrier given a boosted low-risk opportunity.';
    return s;
  }

  private reputationOf(did: string): number {
    return this.core.get(did)?.reputationScore ?? REPUTATION_PRIOR;
  }

  private milestoneTemplate(milestoneNames: string[]): MatchMilestoneTerm[] {
    const hasHandover = milestoneNames.includes('HANDOVER');
    const terms = hasHandover
      ? [{ name: 'PICKUP' as const, percent: 20 }, { name: 'HANDOVER' as const, percent: 50 }, { name: 'DELIVERY' as const, percent: 30 }]
      : [{ name: 'PICKUP' as const, percent: 40 }, { name: 'DELIVERY' as const, percent: 60 }];
    return terms.map((t) => ({ ...t, payeeDid: '' })); // payee filled on accept
  }

  private view(match: Match): MatchView {
    const current = match.status === 'offered' ? match.ranked[match.offerIndex] : undefined;
    return {
      matchId: match.matchId,
      glosShipmentId: match.glosShipmentId,
      status: match.status,
      tier: match.tier,
      currentOffer: current ? { carrierDid: current.did, reputation: current.reputation, score: current.score } : undefined,
      price: match.price,
      rankedDids: match.ranked.map((c) => c.did),
      confirmedCarrierDid: match.confirmedCarrierDid,
      explanation: match.explanation,
    };
  }

  private require(matchId: string): Match {
    const match = this.matches.get(matchId);
    if (!match) throw new NotFoundException(`Match not found: ${matchId}`);
    return match;
  }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function maskDid(did: string): string {
  return did.length > 18 ? `${did.slice(0, 12)}…${did.slice(-4)}` : did;
}

function entry(action: string, detail: Record<string, unknown>): AuditEntry {
  return { at: new Date().toISOString(), action, detail };
}

function normalizeWeights(w?: { cost?: number; reputation?: number; proximity?: number }): { cost: number; reputation: number; proximity: number } {
  const cost = w?.cost ?? 0.4;
  const reputation = w?.reputation ?? 0.4;
  const proximity = w?.proximity ?? 0.2;
  const sum = cost + reputation + proximity || 1;
  return { cost: cost / sum, reputation: reputation / sum, proximity: proximity / sum };
}
