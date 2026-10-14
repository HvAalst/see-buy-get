import { Test } from '@nestjs/testing';
import { LegDecompositionService } from './leg-decomposition.service';
import { ShipmentService } from './shipment.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { SchemaValidator } from './schema/schema-validator.service';
import { NamespaceRegistry } from './schema/namespace-registry.service';
import { HsCodeService } from './schema/hs-code.service';
import { CommodityTaggingService } from './constraints/commodity-tagging.service';
import { DangerousGoodsService } from './constraints/dangerous-goods.service';

const M2_SUPPORT = [SchemaValidator, NamespaceRegistry, HsCodeService, CommodityTaggingService, DangerousGoodsService];

describe('LegDecompositionService (M2-060/061/032)', () => {
  let shipments: ShipmentService;
  let legs: LegDecompositionService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LegDecompositionService,
        ShipmentService,
        LedgerService,
        DidService,
        EventBus,
        ...M2_SUPPORT,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    shipments = moduleRef.get(ShipmentService);
    legs = moduleRef.get(LegDecompositionService);
    events = moduleRef.get(EventBus);
  });

  it('splits a line-haul (ocean) shipment into first/main/last legs with handover geofences', () => {
    const s = shipments.create({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 1000, packageCount: 10, mode: 'ocean' });
    const decomposed = legs.decompose(s.glosShipmentId);

    expect(decomposed.status).toBe('decomposed');
    expect(decomposed.legs.map((l) => l.mode)).toEqual(['road', 'ocean', 'courier']);
    // Each leg has a standardized handover point with a geofence (M2-061).
    for (const leg of decomposed.legs) {
      expect(leg.handover.locationId).toMatch(/^LOC-/);
      expect(leg.handover.geofence?.id).toMatch(/^GEO-/);
    }
    // Milestones: pickup → handovers → delivery.
    expect(decomposed.milestones[0].name).toBe('PICKUP');
    expect(decomposed.milestones[decomposed.milestones.length - 1].name).toBe('DELIVERY');

    const types = events.getLog().map((e) => e.type);
    expect(types).toContain(GlosEvent.Shipment.LegDecomposed);
    expect(types).toContain(GlosEvent.Shipment.JobRequirementVectorReady);
  });

  it('keeps a courier shipment as a single signature-verified leg', () => {
    const s = shipments.create({ origin: 'Berlin', destination: 'Berlin', totalWeightKg: 5, packageCount: 1, mode: 'courier' });
    const decomposed = legs.decompose(s.glosShipmentId);
    expect(decomposed.legs).toHaveLength(1);
    expect(decomposed.legs[0].handover.verification).toBe('signature');
  });

  it('derives mandatory VCs + equipment in the Job Requirement Vector from handling codes (M2-032)', () => {
    const s = shipments.create({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 1000, packageCount: 10, mode: 'ocean', handlingCodes: ['TEMP_2_8C'] });
    const jrv = legs.buildJobRequirementVector(legs.decompose(s.glosShipmentId));
    expect(jrv.perLeg[0].mandatoryVCs).toContain('cold-chain');
    expect(jrv.perLeg[0].equipment).toContain('reefer');
    expect(jrv.perLeg[0].maxWeightKg).toBe(1000);
  });
});
