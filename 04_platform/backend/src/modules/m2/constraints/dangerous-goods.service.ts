import { Injectable } from '@nestjs/common';

// Dangerous goods (M2-033): a DECLARED UN number is looked up for its class, packing group and proper shipping name,
// and the quantity checked against (a sandbox subset of) the ADR/IMDG/IATA DGR ceilings. Nothing is guessed from a
// description: the user, 2026-10-18, removed that — a UN number is the shipper's declaration, never ours.

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

// Net-quantity ceiling per class for the sandbox DGR check (kg).
const CLASS_MAX_KG: Record<string, number> = { '1': 100, '7': 500 };

@Injectable()
export class DangerousGoodsService {
  classify(input: { unNumber?: string }): DgClassification | null {
    if (!input.unNumber) return null;
    const key = input.unNumber.toUpperCase().replace(/\s/g, '');
    return DG_TABLE[key] ?? null;
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
