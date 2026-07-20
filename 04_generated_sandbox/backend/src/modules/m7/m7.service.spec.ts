import { Test } from '@nestjs/testing';
import { DigitalTwinService } from './digital-twin.service';
import { EtaService } from './eta.service';
import { DisruptionService } from './disruption.service';
import { OrchestrationService } from './orchestration.service';
import { SignalIngestService } from './signal-ingest.service';
import { AutoResponseService } from './auto-response.service';
import { ExceptionResponseService } from './exception-response.service';
import { SimulationService } from './simulation.service';
import { CarbonService } from './carbon.service';
import { NetworkDesignService } from './network-design.service';
import { MatchingService } from '../m3/matching.service';
import { AvailabilityService } from '../m3/availability.service';
import { PricingService } from '../m3/pricing.service';
import { CarrierProfileService } from '../m3/carrier-profile.service';
import { FairnessService } from '../m3/fairness.service';
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
const flush = () => new Promise((r) => setImmediate(r));

describe('M7 — AI Control Tower', () => {
  let twin: DigitalTwinService;
  let eta: EtaService;
  let disruption: DisruptionService;
  let orchestration: OrchestrationService;
  let shipments: ShipmentService;
  let legs: LegDecompositionService;
  let availability: AvailabilityService;
  let matching: MatchingService;
  let signals: SignalIngestService;
  let autoResponse: AutoResponseService;
  let exceptionResponse: ExceptionResponseService;
  let simulation: SimulationService;
  let carbon: CarbonService;
  let networkDesign: NetworkDesignService;
  let events: EventBus;

  const SHIPPER = 'did:glos:shipper';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DigitalTwinService,
        EtaService,
        DisruptionService,
        OrchestrationService,
        SignalIngestService,
        AutoResponseService,
        ExceptionResponseService,
        SimulationService,
        CarbonService,
        NetworkDesignService,
        MatchingService,
        AvailabilityService,
        PricingService,
        CarrierProfileService,
        FairnessService,
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

    twin = moduleRef.get(DigitalTwinService);
    eta = moduleRef.get(EtaService);
    disruption = moduleRef.get(DisruptionService);
    orchestration = moduleRef.get(OrchestrationService);
    shipments = moduleRef.get(ShipmentService);
    legs = moduleRef.get(LegDecompositionService);
    availability = moduleRef.get(AvailabilityService);
    matching = moduleRef.get(MatchingService);
    signals = moduleRef.get(SignalIngestService);
    autoResponse = moduleRef.get(AutoResponseService);
    exceptionResponse = moduleRef.get(ExceptionResponseService);
    simulation = moduleRef.get(SimulationService);
    carbon = moduleRef.get(CarbonService);
    networkDesign = moduleRef.get(NetworkDesignService);
    events = moduleRef.get(EventBus);

    twin.onModuleInit(); // wire the twin's event subscriptions
  });

  /** Create + decompose an ocean shipment and let the twin absorb the M2 events. */
  async function oceanShipment() {
    const s = shipments.create({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 1000, packageCount: 10, mode: 'ocean' });
    legs.decompose(s.glosShipmentId);
    await flush();
    return s.glosShipmentId;
  }

  it('builds the digital twin graph live from M2/M3/M4 events (M7-010)', async () => {
    const id = await oceanShipment();
    const node = twin.shipment(id);
    expect(node?.state).toBe('planned');
    // 3 legs → 3 has-leg edges from the shipment node.
    expect(twin.edgesFrom(`shipment:${id}`).filter((e) => e.type === 'has-leg')).toHaveLength(3);

    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    const view = matching.match({ glosShipmentId: id, payerDid: SHIPPER });
    matching.accept(view.matchId);
    await flush();
    expect(twin.shipment(id)?.state).toBe('assigned');
    expect(twin.shipment(id)?.props.payerDid).toBe(SHIPPER);
    expect(twin.edgesFrom('carrier:did:glos:c1').some((e) => e.type === 'assigned-to')).toBe(true);

    await events.publish(GlosEvent.Tracking.PickupOk, { glosShipmentId: id });
    expect(twin.shipment(id)?.state).toBe('picked_up');
  });

  it('predicts an ETA with a 95% interval that shrinks as the shipment advances (M7-020)', async () => {
    const id = await oceanShipment();
    const before = eta.predict(id);
    expect(before.hoursRemaining).toBeGreaterThan(0);
    expect(before.confidence.level).toBe(0.95);
    expect(new Date(before.confidence.high).getTime()).toBeGreaterThan(new Date(before.confidence.low).getTime());

    await events.publish(GlosEvent.Tracking.HandoverOk, { glosShipmentId: id });
    const after = eta.predict(id);
    expect(after.hoursRemaining).toBeLessThan(before.hoursRemaining); // fewer legs remain
  });

  it('classifies a disruption signal and ranks the blast radius (M7-021/022)', async () => {
    const id = await oceanShipment();
    const d = disruption.ingest({ zone: 'Singapore', keywords: ['port strike', 'walkout'], severity: 'high' });
    expect(d.type).toBe('port_strike');
    expect(events.getLog().some((e) => e.type === GlosEvent.Orchestration.DisruptionDetected)).toBe(true);

    const impacted = disruption.impact(d.id);
    expect(impacted.map((i) => i.glosShipmentId)).toContain(id);
    expect(impacted[0].criticality).toBeGreaterThan(0);
    expect(disruption.isImpacted(id)).toBe(true);
    // ETA stretches under disruption.
    expect(eta.predict(id).basis).toContain('disruption');
  });

  it('recommends ranked prescriptive options, each with a justification (M7-030, NFR-M7-06)', async () => {
    const id = await oceanShipment();
    const d = disruption.ingest({ zone: 'Singapore', keywords: ['storm'], severity: 'medium' });
    const options = orchestration.recommend(id, d.id);
    expect(options.length).toBeGreaterThanOrEqual(4);
    expect(options.every((o) => o.justification.length > 0)).toBe(true);
    expect(events.getLog().some((e) => e.type === GlosEvent.Orchestration.RecommendationGenerated)).toBe(true);
  });

  it('auto-rebooks via M3 when a shipper policy fires (M7-031, A-108)', async () => {
    const id = await oceanShipment();
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:c2', zone: 'EU' }); // a spare for the rebook
    const view = matching.match({ glosShipmentId: id, payerDid: SHIPPER });
    matching.accept(view.matchId);
    await flush();

    const d = disruption.ingest({ zone: 'Singapore', keywords: ['unrest'], severity: 'high' });
    orchestration.registerPolicy({ shipperDid: SHIPPER, ifDelayHoursGt: 6, ifExtraCostLt: 1000, thenAction: 'rebook_fastest' });

    const action = orchestration.evaluate(id, d.id);
    expect(action?.status).toBe('executed');
    expect(action?.rematchId).toBeDefined(); // re-matched through M3
    expect(action?.anchorTxId).toBeDefined(); // immutably anchored
    expect(events.getLog().some((e) => e.type === GlosEvent.Orchestration.AutonomousActionExecuted)).toBe(true);
  });

  it('gates high-cost actions behind human approval and supports rollback (M7-050/052)', async () => {
    const id = await oceanShipment();
    const d = disruption.ingest({ zone: 'Singapore', keywords: ['typhoon'], severity: 'high' });
    const splitAir = orchestration.recommend(id, d.id).find((o) => o.action === 'split_air')!;

    const pending = orchestration.execute(id, splitAir);
    expect(pending.status).toBe('pending_approval'); // $1800 > $1000 threshold
    expect(events.getLog().some((e) => e.type === GlosEvent.Orchestration.ApprovalRequested)).toBe(true);

    const approved = orchestration.approve(pending.id);
    expect(approved.status).toBe('executed');

    const rolledBack = orchestration.rollback(approved.id);
    expect(rolledBack.status).toBe('rolled_back');
    expect(events.getLog().some((e) => e.type === GlosEvent.Orchestration.ActionRolledBack)).toBe(true);
  });

  it('freezes anomalous (wildly expensive) actions instead of executing (M7-053)', async () => {
    const id = await oceanShipment();
    const anomalous = { id: 'o_x', action: 'split_air' as const, label: 'runaway', deltaCost: 999_999, deltaHours: 1, reliability: 0.5, justification: 'glitch' };
    const frozen = orchestration.execute(id, anomalous);
    expect(frozen.status).toBe('frozen');
    expect(frozen.anchorTxId).toBeDefined();
  });

  it('produces a heatmap of shipment density (M7-012)', async () => {
    await oceanShipment();
    const cells = twin.heatmap(0);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.reduce((sum, c) => sum + c.count, 0)).toBeGreaterThanOrEqual(1);
  });

  it('ingests a pushed real-world signal and classifies it into a disruption (M7-021 feed)', async () => {
    const d = signals.submit({ source: 'webhook', zone: 'Singapore', headline: 'Port labor walkout halts handling', severity: 'high' });
    await flush();
    expect(d?.type).toBe('port_strike');
    expect(disruption.active().some((x) => x.id === d?.id)).toBe(true);
    expect(signals.recent()[0].headline).toContain('walkout');
    // Idempotent: the same advisory (by source+headline) is not ingested twice.
    expect(signals.submit({ source: 'webhook', zone: 'Singapore', headline: 'Port labor walkout halts handling' })).toBeNull();
  });

  it('a shipper policy auto-fires on an incoming signal — no operator action (feed→policy loop)', async () => {
    autoResponse.onModuleInit(); // wire the auto-response loop
    const id = await oceanShipment();
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:c2', zone: 'EU' });
    const view = matching.match({ glosShipmentId: id, payerDid: SHIPPER });
    matching.accept(view.matchId);
    await flush();

    orchestration.registerPolicy({ shipperDid: SHIPPER, ifDelayHoursGt: 6, ifExtraCostLt: 1000, thenAction: 'rebook_fastest' });

    // A signal arrives from a feed; the policy executes autonomously via the auto-response loop.
    signals.submit({ source: 'partner', zone: 'Singapore', headline: 'typhoon closes the port', severity: 'high' });
    await flush();

    const actions = orchestration.auditTrail(id);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.status === 'executed' && a.rematchId)).toBe(true);
    expect(events.getLog().some((e) => e.type === GlosEvent.Orchestration.AutoResponseCompleted)).toBe(true);
  });

  it('polls a feed connector and drains it once (dedup on repeat polls)', async () => {
    signals.onModuleInit(); // registers the example PartnerFeedSource
    expect(signals.listSources()).toContain('partner-advisories');
    const first = await signals.pollAll();
    expect(first.length).toBeGreaterThan(0);
    const second = await signals.pollAll();
    expect(second.length).toBe(0); // already seen → no duplicate disruptions
  });

  it('a critical M4 tracking exception drives autonomous policy response (telemetry loop)', async () => {
    exceptionResponse.onModuleInit(); // wire the exception→autonomy loop
    const id = await oceanShipment();
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    availability.broadcast({ did: 'did:glos:c2', zone: 'EU' });
    const view = matching.match({ glosShipmentId: id, payerDid: SHIPPER });
    matching.accept(view.matchId);
    await flush();
    orchestration.registerPolicy({ shipperDid: SHIPPER, ifDelayHoursGt: 6, ifExtraCostLt: 1000, thenAction: 'rebook_fastest' });

    // M4 raises a critical exception for this shipment → policy fires with no operator action.
    await events.publish(GlosEvent.Tracking.ExceptionRaised, { glosShipmentId: id, exceptionType: 'temperature_breach', severity: 'critical' });
    await flush();

    const actions = orchestration.auditTrail(id);
    expect(actions.some((a) => a.status === 'executed' && a.rematchId)).toBe(true);
  });

  it('simulates a what-if scenario: blast radius, ETA hit, policy disposition (M7-040)', async () => {
    const id = await oceanShipment();
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    const view = matching.match({ glosShipmentId: id, payerDid: SHIPPER });
    matching.accept(view.matchId);
    await flush();
    orchestration.registerPolicy({ shipperDid: SHIPPER, ifDelayHoursGt: 6, ifExtraCostLt: 1000, thenAction: 'rebook_fastest' });

    const report = simulation.run({ label: 'SG port strike', disruptions: [{ zone: 'Singapore', type: 'port_strike', severity: 'high' }] });
    expect(report.impacted.map((s) => s.glosShipmentId)).toContain(id);
    const sim = report.impacted.find((s) => s.glosShipmentId === id)!;
    expect(sim.projectedHours).toBeGreaterThan(sim.baselineHours); // disruption stretches the ETA
    expect(sim.deltaHours).toBeGreaterThan(0);
    expect(sim.recommended).not.toBeNull();
    expect(sim.policyWouldFire).toBe(true);
    expect(sim.disposition).toBe('auto'); // rebook ($600) auto-executes under the policy
    expect(report.totals.autonomousActions).toBeGreaterThanOrEqual(1);
    expect(report.totals.addedHours).toBeGreaterThan(0);
  });

  it('estimates a shipment carbon footprint and a greener alternative (M7-042)', async () => {
    // Air shipment → high carbon; shifting air→ocean should save a lot.
    const s = shipments.create({ origin: 'Mumbai', destination: 'Dubai', totalWeightKg: 500, packageCount: 4, mode: 'air' });
    legs.decompose(s.glosShipmentId);
    await flush();

    const fp = carbon.footprint(s.glosShipmentId);
    expect(fp.totalKgCo2).toBeGreaterThan(0);
    expect(fp.legs.length).toBeGreaterThan(0);
    expect(fp.legs.some((l) => l.mode === 'air')).toBe(true);
    expect(fp.greener.savingKgCo2).toBeGreaterThan(0); // air→ocean is much lower carbon
    expect(fp.greener.savingPct).toBeGreaterThan(0);
    expect(fp.intensityGPerTonneKm).toBeGreaterThan(0);
  });

  it('rolls carbon up across the live network (M7-042)', async () => {
    await oceanShipment();
    const s2 = shipments.create({ origin: 'Mumbai', destination: 'Dubai', totalWeightKg: 500, packageCount: 4, mode: 'air' });
    legs.decompose(s2.glosShipmentId);
    await flush();

    const net = carbon.network();
    expect(net.shipments).toBeGreaterThanOrEqual(2);
    expect(net.totalKgCo2).toBeGreaterThan(0);
    expect(Object.keys(net.byMode).length).toBeGreaterThan(0);
    expect(net.potentialSavingKgCo2).toBeGreaterThanOrEqual(0);
    expect(net.topEmitters[0].totalKgCo2).toBeGreaterThanOrEqual(net.topEmitters[net.topEmitters.length - 1].totalKgCo2);
  });

  it('recommends network-design changes from accumulated flow (M7-041)', async () => {
    // Two shipments repeat the same multi-leg ocean corridor; one air lane is high-carbon.
    for (let i = 0; i < 2; i += 1) {
      const s = shipments.create({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 800, packageCount: 5, mode: 'ocean' });
      legs.decompose(s.glosShipmentId);
    }
    const air = shipments.create({ origin: 'Mumbai', destination: 'Dubai', totalWeightKg: 500, packageCount: 4, mode: 'air' });
    legs.decompose(air.glosShipmentId);
    await flush();

    const report = networkDesign.analyze();
    expect(report.shipments).toBe(3);
    expect(report.lanes[0].count).toBe(2); // the repeated corridor ranks first
    expect(report.hubs.some((h) => h.throughput >= 2)).toBe(true);

    const types = report.recommendations.map((r) => r.type);
    expect(types).toContain('direct_lane'); // repeated multi-leg corridor
    expect(types).toContain('expand_hub'); // busy hub
    expect(types).toContain('mode_shift'); // high-carbon air lane
    expect(report.recommendations[0].priority).toBe('high'); // ranked by priority
  });

  it('simulation has zero side effects — no disruption stored, no action executed', async () => {
    autoResponse.onModuleInit();
    const id = await oceanShipment();
    availability.broadcast({ did: 'did:glos:c1', zone: 'EU' });
    const view = matching.match({ glosShipmentId: id, payerDid: SHIPPER });
    matching.accept(view.matchId);
    await flush();
    orchestration.registerPolicy({ shipperDid: SHIPPER, ifDelayHoursGt: 6, ifExtraCostLt: 1000, thenAction: 'rebook_fastest' });

    simulation.run({ disruptions: [{ zone: 'Singapore', type: 'port_strike', severity: 'high' }] });
    await flush();

    expect(disruption.active()).toHaveLength(0); // no real disruption created
    expect(orchestration.auditTrail()).toHaveLength(0); // no real action executed
    expect(events.getLog().some((e) => e.type === GlosEvent.Orchestration.DisruptionDetected)).toBe(false);
  });
});
