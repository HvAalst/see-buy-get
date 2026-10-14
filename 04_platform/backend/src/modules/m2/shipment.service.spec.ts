import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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

describe('ShipmentService (M2 twin)', () => {
  let shipments: ShipmentService;
  let dids: DidService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShipmentService,
        LedgerService,
        DidService,
        EventBus,
        ...M2_SUPPORT,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    shipments = moduleRef.get(ShipmentService);
    dids = moduleRef.get(DidService);
    events = moduleRef.get(EventBus);
  });

  const minimal = { origin: 'Rotterdam', destination: 'Zurich', totalWeightKg: 30, packageCount: 3 };

  it('creates a minimal-viable, genesis-anchored shipment (M2-011/050)', () => {
    const s = shipments.create(minimal);
    expect(s.glosShipmentId).toMatch(/^GLOS-/);
    expect(s.status).toBe('created');
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0].note).toBe('genesis');
    expect(s.versions[0].anchor.txId).toContain('glostx_');
    // Multi-package: 3 packages auto-split (M2-014).
    expect(s.ewaybill.packaging.packages).toHaveLength(3);
    expect(events.getLog().some((e) => e.type === GlosEvent.Shipment.Created)).toBe(true);
  });

  it('links parties to DIDs and rejects an unknown DID (M2-023)', () => {
    const did = dids.generate('shipper-ctrl').id;
    const s = shipments.create({ ...minimal, parties: [{ role: 'shipper', did }] });
    expect(s.ewaybill.parties[0].did).toBe(did);
    expect(() => shipments.create({ ...minimal, parties: [{ role: 'shipper', did: 'did:glos:nope' }] })).toThrow(BadRequestException);
  });

  it('rejects unknown handling codes', () => {
    expect(() => shipments.create({ ...minimal, handlingCodes: ['NONSENSE'] })).toThrow(BadRequestException);
  });

  it('enriches with an appended anchored amendment (M2-012/051)', () => {
    const s = shipments.create(minimal);
    const enriched = shipments.enrich(s.glosShipmentId, { handlingCodes: ['TEMP_2_8C'], goods: { hsCode: '300490' } });
    expect(enriched.status).toBe('enriched');
    expect(enriched.ewaybill.handling.codes).toContain('TEMP_2_8C');
    expect(enriched.ewaybill.goods.hsCode).toBe('300490');
    expect(enriched.versions).toHaveLength(2);
    expect(enriched.versions[1].note).toBe('enrichment');
    expect(events.getLog().some((e) => e.type === GlosEvent.Shipment.Enriched)).toBe(true);
  });

  it('validates minimal-record requirements', () => {
    expect(() => shipments.create({ ...minimal, totalWeightKg: 0 })).toThrow(BadRequestException);
    expect(() => shipments.create({ ...minimal, packageCount: 0 })).toThrow(BadRequestException);
  });
});
