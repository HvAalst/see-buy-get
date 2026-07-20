import { Injectable } from '@nestjs/common';

// Dangerous goods auto-classification (M2-033). Guides UN number / packing group / proper
// shipping name and validates packaging+quantity against (a sandbox subset of) ADR/IMDG/IATA DGR.

export interface DgClassification {
  unNumber: string;
  properShippingName: string;
  class: string;
  packingGroup: 'I' | 'II' | 'III';
}

export interface DgValidation {
  ok: boolean;
  reason?: string;
}

const DG_TABLE: Record<string, DgClassification> = {
  UN1203: { unNumber: 'UN1203', properShippingName: 'Gasoline', class: '3', packingGroup: 'II' },
  UN1170: { unNumber: 'UN1170', properShippingName: 'Ethanol', class: '3', packingGroup: 'II' },
  UN1090: { unNumber: 'UN1090', properShippingName: 'Acetone', class: '3', packingGroup: 'II' },
  UN3480: { unNumber: 'UN3480', properShippingName: 'Lithium-ion batteries', class: '9', packingGroup: 'II' },
  UN0004: { unNumber: 'UN0004', properShippingName: 'Ammonium picrate, dry', class: '1', packingGroup: 'I' },
  UN1978: { unNumber: 'UN1978', properShippingName: 'Propane', class: '2', packingGroup: 'II' },
};

const KEYWORD_UN: Array<{ match: RegExp; un: string }> = [
  { match: /(gasoline|petrol)/i, un: 'UN1203' },
  { match: /(ethanol|alcohol)/i, un: 'UN1170' },
  { match: /(acetone)/i, un: 'UN1090' },
  { match: /(lithium|battery|batteries)/i, un: 'UN3480' },
  { match: /(propane|lpg)/i, un: 'UN1978' },
  { match: /(explosive|picrate)/i, un: 'UN0004' },
];

// Net-quantity ceiling per class for the sandbox DGR check (kg).
const CLASS_MAX_KG: Record<string, number> = { '1': 100, '7': 500 };

@Injectable()
export class DangerousGoodsService {
  classify(input: { unNumber?: string; description?: string }): DgClassification | null {
    if (input.unNumber) {
      const key = input.unNumber.toUpperCase().replace(/\s/g, '');
      return DG_TABLE[key] ?? null;
    }
    if (input.description) {
      const hit = KEYWORD_UN.find((k) => k.match.test(input.description!));
      return hit ? DG_TABLE[hit.un] : null;
    }
    return null;
  }

  /** Validate packaging/quantity against the DGR ceiling for the class (M2-033). */
  validate(classification: DgClassification, totalWeightKg: number): DgValidation {
    const max = CLASS_MAX_KG[classification.class];
    if (max != null && totalWeightKg > max) {
      return { ok: false, reason: `Class ${classification.class} limited to ${max}kg net (got ${totalWeightKg}kg)` };
    }
    return { ok: true };
  }
}
