import { BadRequestException, Injectable } from '@nestjs/common';
import { NamespaceRegistry } from './namespace-registry.service';
import { HsCodeService } from './hs-code.service';
import { isValidIncoterm } from './ewaybill-schema';
import { EWaybillCore, TransportBlock } from '../shipment.types';

const MODE_BLOCK: Record<string, keyof Omit<TransportBlock, 'mode'>> = { ocean: 'ocean', air: 'air', road: 'road', rail: 'rail' };

/**
 * SchemaValidator (M2-020). Validates an e-waybill core against the published schema: mandatory
 * blocks, mode-consistent transport detail (M2-022), Incoterms enum (M2-025), HS-code format
 * (M2-024), and namespaced tags (M2-021). Throws on the first violation.
 */
@Injectable()
export class SchemaValidator {
  constructor(
    private readonly namespaces: NamespaceRegistry,
    private readonly hsCode: HsCodeService,
  ) {}

  validate(core: EWaybillCore): void {
    if (!core.identifiers?.glosShipmentId) throw new BadRequestException('identifiers.glosShipmentId is required');

    for (const party of core.parties) {
      if (!party.role || !party.did) throw new BadRequestException('each party needs a role and a did');
    }

    this.validateTransport(core.transport);

    if (core.goods.incoterms && !isValidIncoterm(core.goods.incoterms)) {
      throw new BadRequestException(`Invalid Incoterm "${core.goods.incoterms}"`);
    }
    if (core.goods.hsCode && !this.hsCode.isValid(core.goods.hsCode)) {
      throw new BadRequestException(`Invalid HS code "${core.goods.hsCode}" (expect 6/8/10 digits)`);
    }

    const p = core.packaging;
    if (!(p.count > 0) || !(p.totalWeightKg > 0) || !p.packages?.length) {
      throw new BadRequestException('packaging requires count, totalWeightKg and at least one package');
    }

    this.namespaces.validateTags(core.references);
  }

  private validateTransport(transport: TransportBlock): void {
    const modes = ['road', 'rail', 'air', 'ocean', 'courier', 'multimodal'];
    if (!modes.includes(transport.mode)) throw new BadRequestException(`Invalid transport mode "${transport.mode}"`);
    if (transport.mode === 'multimodal') return; // any combination allowed
    for (const [blockMode, key] of Object.entries(MODE_BLOCK)) {
      if (transport[key] && transport.mode !== blockMode) {
        throw new BadRequestException(`${key} transport details require mode "${blockMode}", not "${transport.mode}"`);
      }
    }
  }
}
