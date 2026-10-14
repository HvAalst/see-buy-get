import { Test } from '@nestjs/testing';
import { IngestionService } from './ingestion/ingestion.service';
import { MagentoPlugin, PluginRegistry, ShopifyPlugin } from './ingestion/plugins';
import { TemplateService } from './templates/template.service';
import { ShipmentService } from './shipment.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { SchemaValidator } from './schema/schema-validator.service';
import { NamespaceRegistry } from './schema/namespace-registry.service';
import { HsCodeService } from './schema/hs-code.service';
import { CommodityTaggingService } from './constraints/commodity-tagging.service';
import { DangerousGoodsService } from './constraints/dangerous-goods.service';

const M2_SUPPORT = [SchemaValidator, NamespaceRegistry, HsCodeService, CommodityTaggingService, DangerousGoodsService];

describe('M2 ingestion & creation channels (M2-010/013)', () => {
  let ingestion: IngestionService;
  let templates: TemplateService;
  let shipments: ShipmentService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestionService, TemplateService, ShipmentService, ShopifyPlugin, MagentoPlugin, PluginRegistry,
        LedgerService, DidService, EventBus, ...M2_SUPPORT, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    ingestion = moduleRef.get(IngestionService);
    templates = moduleRef.get(TemplateService);
    shipments = moduleRef.get(ShipmentService);
  });

  it('ingests a JSON batch, reporting per-row success/failure (M2-010)', () => {
    const result = ingestion.ingestJsonBatch([
      { origin: 'A', destination: 'B', totalWeightKg: 10, packageCount: 1 },
      { origin: 'C', destination: 'D', totalWeightKg: 5, packageCount: 2 },
      { origin: 'E', destination: 'F', totalWeightKg: 0, packageCount: 1 } as never, // invalid weight
    ]);
    expect(result.total).toBe(3);
    expect(result.created).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.created[0].glosShipmentId).toMatch(/^GLOS-/);
  });

  it('ingests a CSV batch (M2-010)', () => {
    const csv = ['origin,destination,totalWeightKg,packageCount,mode', 'Rotterdam,Berlin,12,1,road', 'Hamburg,Zurich,800,4,ocean'].join('\n');
    const result = ingestion.ingestCsvBatch(csv);
    expect(result.created).toHaveLength(2);
    expect(shipments.require(result.created[1].glosShipmentId).ewaybill.transport.mode).toBe('ocean');
  });

  it('maps a Shopify order into the canonical twin (M2-010)', () => {
    const s = ingestion.ingestViaPlugin('shopify', { id: 1001, shipping_address: { city: 'Paris' }, line_items: [{ grams: 500, quantity: 2 }, { grams: 250, quantity: 1 }] });
    expect(s.destination).toBe('Paris');
    expect(s.ewaybill.packaging.totalWeightKg).toBe(1.25); // (500*2 + 250)/1000
    expect(s.ewaybill.references['shopify:orderId']).toBe('1001');
  });

  it('maps a Magento order into the canonical twin (M2-010)', () => {
    const s = ingestion.ingestViaPlugin('magento', { increment_id: 'M-9', shipping: { city: 'Madrid' }, items: [{ weight: 3, qty: 2 }] });
    expect(s.destination).toBe('Madrid');
    expect(s.ewaybill.packaging.totalWeightKg).toBe(6);
  });

  it('saves a template and creates a shipment from it with overrides (M2-013)', () => {
    const tpl = templates.save('Standard EU Export', { origin: 'Rotterdam', mode: 'ocean', totalWeightKg: 500, packageCount: 5, handlingCodes: ['FRAGILE'] });
    expect(templates.list()).toHaveLength(1);

    const merged = templates.merge(tpl.id, { destination: 'Singapore' });
    const s = shipments.create(merged);
    expect(s.origin).toBe('Rotterdam'); // from template
    expect(s.destination).toBe('Singapore'); // override
    expect(s.ewaybill.transport.mode).toBe('ocean');
    expect(s.ewaybill.handling.codes).toContain('FRAGILE');
  });
});
