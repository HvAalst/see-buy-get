import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { SchemaValidator } from './schema/schema-validator.service';
import { NamespaceRegistry } from './schema/namespace-registry.service';
import { HsCodeService } from './schema/hs-code.service';
import { CommodityTaggingService } from './constraints/commodity-tagging.service';
import { DangerousGoodsService } from './constraints/dangerous-goods.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';

describe('M2 schema + constraints (M2-020..033)', () => {
  let shipments: ShipmentService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShipmentService, SchemaValidator, NamespaceRegistry, HsCodeService, CommodityTaggingService, DangerousGoodsService,
        LedgerService, DidService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    shipments = moduleRef.get(ShipmentService);
  });

  const base = { origin: 'A', destination: 'B', totalWeightKg: 10, packageCount: 1 } as const;

  it('attaches mode-specific transport detail and rejects a mode mismatch (M2-022)', () => {
    const s = shipments.create({ ...base, mode: 'ocean', transportDetails: { ocean: { vessel: 'Ever Given', voyage: 'V1' } } });
    expect(s.ewaybill.transport.ocean?.vessel).toBe('Ever Given');
    expect(() => shipments.create({ ...base, mode: 'road', transportDetails: { ocean: { vessel: 'X' } } })).toThrow(BadRequestException);
  });

  it('enforces namespaced tags (M2-021)', () => {
    expect(shipments.create({ ...base, references: { 'eu:eori': 'NL123' } }).ewaybill.references['eu:eori']).toBe('NL123');
    expect(() => shipments.create({ ...base, references: { 'foo:bar': 'x' } })).toThrow(BadRequestException);
    expect(() => shipments.create({ ...base, references: { plain: 'x' } })).toThrow(BadRequestException);
  });

  it('validates the Incoterm enum (M2-025)', () => {
    expect(shipments.create({ ...base, goods: { incoterms: 'FOB' } }).ewaybill.goods.incoterms).toBe('FOB');
    expect(() => shipments.create({ ...base, goods: { incoterms: 'ZZZ' } })).toThrow(BadRequestException);
  });

  it('never fills in an HS code from a description, and rejects a malformed one typed (M2-024)', () => {
    expect(shipments.create({ ...base, goods: { description: 'Roasted coffee beans' } }).ewaybill.goods.hsCode).toBeUndefined();
    expect(shipments.create({ ...base, goods: { description: 'Roasted coffee beans', hsCode: '090121' } }).ewaybill.goods.hsCode).toBe('090121');
    expect(() => shipments.create({ ...base, goods: { hsCode: 'abc' } })).toThrow(BadRequestException);
  });

  it('never guesses a UN number from a description: dangerous goods are what the shipper declares (M2-033)', () => {
    const s = shipments.create({ ...base, handlingCodes: ['DG_CLASS_3'], goods: { description: 'petrol in drums' } });
    expect(s.ewaybill.customs?.dangerousGoods).toBeUndefined();
  });

  it('auto-tags handling codes from the commodity (M2-031)', () => {
    const s = shipments.create({ ...base, goods: { description: 'frozen seafood' } });
    expect(s.ewaybill.handling.codes).toEqual(expect.arrayContaining(['TEMP_FROZEN', 'PERISHABLE']));
  });

  it('classifies dangerous goods and enforces the DGR quantity ceiling (M2-033)', () => {
    const s = shipments.create({ ...base, dangerousGoods: { unNumber: 'UN1203' } });
    expect((s.ewaybill.customs?.dangerousGoods as { class: string }).class).toBe('3');
    // Class 1 explosives over the 100kg net ceiling are rejected.
    expect(() => shipments.create({ ...base, totalWeightKg: 200, handlingCodes: ['DG_CLASS_1'], dangerousGoods: { unNumber: 'UN0004' } })).toThrow(BadRequestException);
  });
});
