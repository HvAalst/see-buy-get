import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { LegDecompositionService } from './leg-decomposition.service';
import { LabelService } from './label/label.service';
import { AnchoringService } from './anchoring/anchoring.service';
import { LegAccessService } from './legs/leg-access.service';
import { RouteTemplateService } from './legs/route-template.service';
import { SchemaValidator } from './schema/schema-validator.service';
import { NamespaceRegistry } from './schema/namespace-registry.service';
import { HsCodeService } from './schema/hs-code.service';
import { CommodityTaggingService } from './constraints/commodity-tagging.service';
import { DangerousGoodsService } from './constraints/dangerous-goods.service';
import { CredentialService } from '../../foundation/credentials/credential.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { FabricLedgerAdapter } from '../../foundation/ledger/fabric-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';

describe('M2 §5.2.4–5.2.6 (labels, Fabric anchoring, leg isolation)', () => {
  let shipments: ShipmentService;
  let legs: LegDecompositionService;
  let labels: LabelService;
  let anchoring: AnchoringService;
  let legAccess: LegAccessService;
  let dids: DidService;
  let credentials: CredentialService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShipmentService, LegDecompositionService, LabelService, AnchoringService, LegAccessService, RouteTemplateService,
        SchemaValidator, NamespaceRegistry, HsCodeService, CommodityTaggingService, DangerousGoodsService,
        CredentialService, LedgerService, DidService, EventBus,
        { provide: LEDGER_ADAPTER, useClass: FabricLedgerAdapter }, // exercise the Fabric adapter
      ],
    }).compile();
    shipments = moduleRef.get(ShipmentService);
    legs = moduleRef.get(LegDecompositionService);
    labels = moduleRef.get(LabelService);
    anchoring = moduleRef.get(AnchoringService);
    legAccess = moduleRef.get(LegAccessService);
    dids = moduleRef.get(DidService);
    credentials = moduleRef.get(CredentialService);
  });

  const ship = (over = {}) => shipments.create({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 100, packageCount: 2, mode: 'ocean', handlingCodes: ['TEMP_2_8C', 'FRAGILE'], ...over });

  it('generates a signed smart label with pictograms, neutral description, and printer formats (M2-040/042/043)', () => {
    const s = ship();
    const label = labels.generate(s.glosShipmentId);
    expect(label.humanReadable).toBe(s.glosShipmentId);
    expect(label.pictograms).toEqual(expect.arrayContaining(['❄️', '🥚']));
    expect(label.neutralDescription).not.toContain('Singapore'); // neutral — no route/commercial leak in the text body
    expect(labels.verifySignature(s.glosShipmentId)).toBe(true);
    expect(labels.render(s.glosShipmentId, 'zpl')).toContain('^XA');
    // Overlay keeps the GLOS id primary (M2-041).
    expect(labels.addOverlay(s.glosShipmentId, { barcode: 'FEDEX-123' }).overlays).toHaveLength(1);
  });

  it('anchors genesis to Hyperledger Fabric and verifies it lightweightly (M2-050/052)', () => {
    const s = ship();
    const v = anchoring.verify(s.glosShipmentId);
    expect(v.verified).toBe(true);
    expect(v.network.network).toBe('hyperledger-fabric');
    expect(v.txId).toMatch(/^[0-9a-f]{64}$/);
    // Still verifiable after an amendment.
    shipments.enrich(s.glosShipmentId, { references: { 'eu:eori': 'NL1' } });
    expect(anchoring.verify(s.glosShipmentId).verified).toBe(true);
  });

  it('proves an attribute by selective disclosure without revealing the payload (M2-053)', () => {
    const s = ship();
    expect(anchoring.disclose(s.glosShipmentId, 'TEMP_2_8C').present).toBe(true);
    const absent = anchoring.disclose(s.glosShipmentId, 'DG_CLASS_1');
    expect(absent.present).toBe(false);
    expect(absent.proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('isolates leg data between actors and supports per-leg negotiation (M2-062 + §5.3)', () => {
    const shipperDid = dids.generate('shipper').id;
    const carrierDid = 'did:glos:carrier-leg0';
    const s = ship({ parties: [{ role: 'shipper', did: shipperDid }] });
    legs.decompose(s.glosShipmentId); // ocean → 3 legs (constraints: TEMP_2_8C, FRAGILE)

    // §5.5: VC requirements verified against the identity vault — a carrier lacking the leg's
    // required VCs (cold-chain, fragile-handling) is rejected.
    expect(() => legAccess.assignCarrier(s.glosShipmentId, 0, carrierDid)).toThrow(BadRequestException);
    credentials.issue({ subject: carrierDid, type: 'cold-chain' });
    credentials.issue({ subject: carrierDid, type: 'fragile-handling' });
    legAccess.assignCarrier(s.glosShipmentId, 0, carrierDid);

    // The shipper (owner) sees any leg; the leg-0 carrier sees only leg 0.
    expect(legAccess.view(s.glosShipmentId, 1, shipperDid).leg.index).toBe(1);
    expect(legAccess.view(s.glosShipmentId, 0, carrierDid).leg.index).toBe(0);
    // The leg-0 carrier cannot see leg 1, and a stranger cannot see any leg.
    expect(() => legAccess.view(s.glosShipmentId, 1, carrierDid)).toThrow(ForbiddenException);
    expect(() => legAccess.view(s.glosShipmentId, 0, 'did:glos:stranger')).toThrow(ForbiddenException);

    // Negotiate leg-0 terms within the isolated scope.
    legAccess.propose(s.glosShipmentId, 0, shipperDid, { price: 500, currency: 'USD', note: 'first mile' });
    const view = legAccess.view(s.glosShipmentId, 0, carrierDid);
    const accepted = legAccess.accept(s.glosShipmentId, 0, carrierDid, view.leg.negotiation.proposals[0].id);
    expect(accepted.leg.negotiation.agreed?.price).toBe(500);
  });
});
