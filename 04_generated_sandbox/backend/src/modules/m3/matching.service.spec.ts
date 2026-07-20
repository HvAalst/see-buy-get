import { Test } from '@nestjs/testing';
import { MatchingService } from './matching.service';
import { AvailabilityService } from './availability.service';
import { PricingService } from './pricing.service';
import { CarrierProfileService } from './carrier-profile.service';
import { FairnessService } from './fairness.service';
import { PredictionService } from './prediction.service';
import { BatchMatchingService } from './batch-matching.service';
import { ShipmentService } from '../m2/shipment.service';
import { LegDecompositionService } from '../m2/leg-decomposition.service';
import { CredentialService } from '../../foundation/credentials/credential.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { SchemaValidator } from '../m2/schema/schema-validator.service';
import { NamespaceRegistry } from '../m2/schema/namespace-registry.service';
import { HsCodeService } from '../m2/schema/hs-code.service';
import { CommodityTaggingService } from '../m2/constraints/commodity-tagging.service';
import { DangerousGoodsService } from '../m2/constraints/dangerous-goods.service';

const M2_SUPPORT = [SchemaValidator, NamespaceRegistry, HsCodeService, CommodityTaggingService, DangerousGoodsService];

describe('MatchingService (M3)', () => {
  let matching: MatchingService;
  let availability: AvailabilityService;
  let shipments: ShipmentService;
  let legs: LegDecompositionService;
  let credentials: CredentialService;
  let core: OperationalStore;
  let events: EventBus;
  let profiles: CarrierProfileService;
  let fairness: FairnessService;
  let prediction: PredictionService;
  let batch: BatchMatchingService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchingService,
        AvailabilityService,
        PricingService,
        CarrierProfileService,
        FairnessService,
        PredictionService,
        BatchMatchingService,
        ShipmentService,
        LegDecompositionService,
        CredentialService,
        OperationalStore,
        LedgerService,
        DidService,
        EventBus,
        ...M2_SUPPORT,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    matching = moduleRef.get(MatchingService);
    availability = moduleRef.get(AvailabilityService);
    shipments = moduleRef.get(ShipmentService);
    legs = moduleRef.get(LegDecompositionService);
    credentials = moduleRef.get(CredentialService);
    core = moduleRef.get(OperationalStore);
    events = moduleRef.get(EventBus);
    profiles = moduleRef.get(CarrierProfileService);
    fairness = moduleRef.get(FairnessService);
    prediction = moduleRef.get(PredictionService);
    batch = moduleRef.get(BatchMatchingService);
  });

  function coldChainShipment() {
    const s = shipments.create({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 1000, packageCount: 10, mode: 'ocean', handlingCodes: ['TEMP_2_8C'] });
    legs.decompose(s.glosShipmentId);
    return s;
  }

  it('only matches carriers whose VCs + equipment satisfy the JRV (M3-021)', () => {
    const s = coldChainShipment(); // requires cold-chain VC + reefer equipment

    availability.broadcast({ did: 'did:glos:plain', zone: 'EU', equipment: [] }); // missing both
    availability.broadcast({ did: 'did:glos:reefer-only', zone: 'EU', equipment: ['reefer'] }); // missing VC
    availability.broadcast({ did: 'did:glos:qualified', zone: 'EU', equipment: ['reefer'] });
    credentials.issue({ subject: 'did:glos:qualified', type: 'cold-chain' });

    const view = matching.match({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });
    expect(view.status).toBe('offered');
    expect(view.rankedDids).toEqual(['did:glos:qualified']);
    expect(view.price.total).toBeGreaterThan(0);
  });

  it('ranks by reputation and confirms the accepted offer, emitting match.confirmed', async () => {
    const s = shipments.create({ origin: 'A', destination: 'B', totalWeightKg: 10, packageCount: 1, mode: 'road' });
    legs.decompose(s.glosShipmentId);

    availability.broadcast({ did: 'did:glos:low', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:high', zone: 'EU' });
    core.upsert({ did: 'did:glos:low', tier: 2, status: 'active', capabilities: [], reputationScore: 3.5 });
    core.upsert({ did: 'did:glos:high', tier: 2, status: 'active', capabilities: [], reputationScore: 4.8 });

    const view = matching.match({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper', currency: 'USD' });
    expect(view.rankedDids[0]).toBe('did:glos:high'); // higher reputation ranks first
    expect(view.currentOffer?.carrierDid).toBe('did:glos:high');

    const confirmed = matching.accept(view.matchId);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedCarrierDid).toBe('did:glos:high');
    const ev = events.getLog().find((e) => e.type === GlosEvent.Match.Confirmed);
    expect(ev).toBeDefined();
    expect((ev?.payload as { milestones: Array<{ payeeDid: string }> }).milestones.every((m) => m.payeeDid === 'did:glos:high')).toBe(true);
  });

  it('cascades to the next carrier on rejection (M3-051)', () => {
    const s = shipments.create({ origin: 'A', destination: 'B', totalWeightKg: 10, packageCount: 1, mode: 'road' });
    legs.decompose(s.glosShipmentId);
    availability.broadcast({ did: 'did:glos:a', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:b', zone: 'EU' });

    const view = matching.match({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });
    const firstOffer = view.currentOffer?.carrierDid;
    const after = matching.reject(view.matchId);
    expect(after.status).toBe('offered');
    expect(after.currentOffer?.carrierDid).not.toBe(firstOffer);
    expect(events.getLog().some((e) => e.type === GlosEvent.Match.FallbackCascaded)).toBe(true);
  });

  it('excludes carriers below the SLO minimum reputation (M3-033)', () => {
    const s = shipments.create({ origin: 'A', destination: 'B', totalWeightKg: 10, packageCount: 1, mode: 'road' });
    legs.decompose(s.glosShipmentId);
    availability.broadcast({ did: 'did:glos:weak', zone: 'EU' });
    core.upsert({ did: 'did:glos:weak', tier: 2, status: 'active', capabilities: [], reputationScore: 2.0 });

    const view = matching.match({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper', slo: { minReputation: 4.0 } });
    expect(view.status).toBe('failed');
    expect(view.rankedDids).toHaveLength(0);
  });

  // --- Sprint 2/3 ---

  function roadShipment(weightKg = 10) {
    const s = shipments.create({ origin: 'A', destination: 'B', totalWeightKg: weightKg, packageCount: 1, mode: 'road' });
    legs.decompose(s.glosShipmentId);
    return s;
  }
  /** Drive a carrier to "established" (≥3 completions) via the event stream. */
  async function establish(did: string) {
    profiles.onModuleInit();
    for (let i = 0; i < 3; i += 1) {
      await events.publish(GlosEvent.Match.Confirmed, { glosShipmentId: `est-${did}-${i}`, carrierDid: did });
      await events.publish(GlosEvent.Tracking.Delivered, { glosShipmentId: `est-${did}-${i}` });
    }
  }

  it('quote() is side-effect-free and deterministic for the same snapshot (NFR-M3-06)', () => {
    const s = roadShipment();
    availability.broadcast({ did: 'did:glos:a', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:b', zone: 'EU' });
    const q1 = matching.quote({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });
    const q2 = matching.quote({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });
    expect(q1.ranked.map((c) => c.did)).toEqual(q2.ranked.map((c) => c.did)); // identical ranking
    expect(q1.explanation).toContain('Chose'); // human-readable (M3-060)
  });

  it('White-Glove tier enforces a ≥4.8 reputation floor and a premium price (M3-044)', () => {
    const s = roadShipment();
    availability.broadcast({ did: 'did:glos:elite', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:mid', zone: 'EU' });
    core.upsert({ did: 'did:glos:elite', tier: 3, status: 'active', capabilities: [], reputationScore: 4.9 });
    core.upsert({ did: 'did:glos:mid', tier: 2, status: 'active', capabilities: [], reputationScore: 4.0 });

    const q = matching.quote({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper', slo: { tier: 'white_glove' } });
    expect(q.ranked.map((c) => c.did)).toEqual(['did:glos:elite']); // only ≥4.8 qualifies
    expect(q.price.tier).toBe('white_glove');
    expect(q.price.tierMultiplier).toBe(2.2);
  });

  it('keeps a cold-start carrier off a high-value job when an established one is available (M3-034)', async () => {
    await establish('did:glos:veteran');
    const s = roadShipment(1000); // base 2050 × surge → well over the cold-start value cap
    availability.broadcast({ did: 'did:glos:veteran', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:newbie', zone: 'EU' });

    const q = matching.quote({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });
    expect(q.price.total).toBeGreaterThan(1500);
    expect(q.ranked.map((c) => c.did)).toEqual(['did:glos:veteran']); // newbie capped out
    expect(profiles.isColdStart('did:glos:veteran')).toBe(false);
    expect(profiles.isColdStart('did:glos:newbie')).toBe(true);
  });

  it('still offers a high-value job to new carriers when no established one exists (bootstrap)', () => {
    const s = roadShipment(1000);
    availability.broadcast({ did: 'did:glos:new1', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:new2', zone: 'EU' });
    const q = matching.quote({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });
    expect(q.ranked).toHaveLength(2); // no established alternative → new carriers are not stranded
  });

  it('batch-matches many demands to distinct carriers (M3-031)', () => {
    const s1 = roadShipment();
    const s2 = roadShipment();
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:c2', zone: 'EU' });

    const result = batch.solve([
      { glosShipmentId: s1.glosShipmentId, payerDid: 'did:glos:shipper' },
      { glosShipmentId: s2.glosShipmentId, payerDid: 'did:glos:shipper' },
    ]);
    expect(result.assigned).toBe(2);
    const carriers = result.assignments.map((a) => a.carrierDid);
    expect(new Set(carriers).size).toBe(2); // distinct carriers, no double-booking
  });

  it('governed override: force-assign requires a reason, confirms + flags for review (M3-062)', () => {
    const s = roadShipment();
    availability.broadcast({ did: 'did:glos:reg', zone: 'EU' });
    const view = matching.match({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });

    expect(() => matching.forceAssign(view.matchId, 'did:glos:vip', '')).toThrow();
    const forced = matching.forceAssign(view.matchId, 'did:glos:vip', 'humanitarian priority', 'ops:jane');
    expect(forced.status).toBe('confirmed');
    expect(forced.confirmedCarrierDid).toBe('did:glos:vip');
    const full = matching.get(view.matchId);
    expect(full.override).toMatchObject({ type: 'force_assign', reviewFlag: true, reason: 'humanitarian priority' });
    expect(events.getLog().some((e) => e.type === GlosEvent.Match.Confirmed)).toBe(true);
  });

  it('governed override: block stops a match (M3-062)', () => {
    const s = roadShipment();
    availability.broadcast({ did: 'did:glos:reg', zone: 'EU' });
    const view = matching.match({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper' });
    const blocked = matching.block(view.matchId, 'sanctioned routing', 'ops:jane');
    expect(blocked.status).toBe('blocked');
    expect(matching.get(view.matchId).override?.reviewFlag).toBe(true);
  });

  it('records the offer/accept distribution for the fairness dashboard (M3-035/061)', () => {
    const s = roadShipment();
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    const view = matching.match({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper', zone: 'EU' });
    matching.accept(view.matchId);
    const report = fairness.report();
    expect(report.totalOffers).toBeGreaterThanOrEqual(1);
    expect(report.totalAccepts).toBeGreaterThanOrEqual(1);
    expect(report.byZone.find((z) => z.segment === 'EU')?.acceptanceRate).toBeGreaterThan(0);
    expect(report.coldStartOfferShare).toBeGreaterThan(0); // the new carrier's offer is tracked
  });

  it('forecasts zone capacity and pre-books at an indicative price (M3-022/042)', () => {
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:c2', zone: 'EU' });
    for (let i = 0; i < 5; i += 1) prediction.observe();

    const forecast = prediction.forecast('EU');
    expect(forecast.expectedAvailable).toBeGreaterThan(0);
    expect(forecast.probabilityHasCapacity).toBeGreaterThan(0);

    const s = roadShipment();
    const pb = prediction.preBook({ glosShipmentId: s.glosShipmentId, payerDid: 'did:glos:shipper', zone: 'EU' });
    expect(pb.indicativePrice.binding).toBe(false);
    expect(pb.indicativePrice.confidence?.high).toBeGreaterThan(pb.indicativePrice.confidence!.low);
    expect(pb.forecast.zone).toBe('EU');
  });
});
