import { Injectable } from '@nestjs/common';
import { EWaybillCore } from '../shipment.types';
import { STANDARDS, STANDARDS_CROSSWALK } from './standards';

export interface ConformanceCheck {
  element: string;
  level: 'mandatory' | 'recommended';
  ok: boolean;
}

export interface ConformanceReport {
  glosShipmentId: string;
  conformant: boolean; // all mandatory elements present
  standards: typeof STANDARDS;
  checks: ConformanceCheck[];
  missingMandatory: string[];
  missingRecommended: string[];
}

/**
 * StandardsService (NFR-M2-05). Exposes the standards crosswalk and checks an e-waybill's
 * conformance to the mandatory business elements of UN/CEFACT MMT / WCO Data Model / IATA ONE
 * Record (the annual external audit is a process control on top of this).
 */
@Injectable()
export class StandardsService {
  crosswalk() {
    return { standards: STANDARDS, crosswalk: STANDARDS_CROSSWALK };
  }

  conformance(core: EWaybillCore): ConformanceReport {
    const checks: ConformanceCheck[] = [
      { element: 'Consignment ID (Identifiers)', level: 'mandatory', ok: Boolean(core.identifiers.glosShipmentId) },
      { element: 'Transport mode', level: 'mandatory', ok: Boolean(core.transport.mode) },
      { element: 'Gross mass', level: 'mandatory', ok: core.packaging.totalWeightKg > 0 },
      { element: 'Package quantity', level: 'mandatory', ok: core.packaging.count > 0 },
      { element: 'Goods classification (HS code or description)', level: 'recommended', ok: Boolean(core.goods.hsCode || core.goods.description) },
      { element: 'Consignor party (shipper) by DID', level: 'recommended', ok: core.parties.some((p) => p.role === 'shipper') },
      { element: 'Incoterms', level: 'recommended', ok: Boolean(core.goods.incoterms) },
      { element: 'Customs value', level: 'recommended', ok: Boolean(core.goods.commercialValue) },
    ];
    const missingMandatory = checks.filter((c) => c.level === 'mandatory' && !c.ok).map((c) => c.element);
    const missingRecommended = checks.filter((c) => c.level === 'recommended' && !c.ok).map((c) => c.element);
    return {
      glosShipmentId: core.identifiers.glosShipmentId,
      conformant: missingMandatory.length === 0,
      standards: STANDARDS,
      checks,
      missingMandatory,
      missingRecommended,
    };
  }
}
