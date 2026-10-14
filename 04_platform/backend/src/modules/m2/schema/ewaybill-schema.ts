// Universal e-waybill schema reference (M2-020/025). Aligned in spirit with UN/CEFACT MMT,
// IATA e-AWB and FIATA FWB; published as an open JSON-Schema descriptor (NFR-M2-06).

// Incoterms 2020 rules (M2-025).
export const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export function isValidIncoterm(value: string): value is Incoterm {
  return (INCOTERMS as readonly string[]).includes(value);
}

// HS code: 6, 8 or 10 digits (M2-024).
export const HS_CODE_RE = /^\d{6}(\d{2})?(\d{2})?$/;

/** The published open schema for the e-waybill core (served at GET /v1/shipments/schema). */
export const EWAYBILL_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://api.glos.network/schemas/ewaybill/v1',
  title: 'GLOS Universal E-Waybill',
  type: 'object',
  standardsAlignment: ['UN/CEFACT MMT', 'IATA e-AWB / ONE Record', 'FIATA FWB', 'WCO Data Model 4.0'],
  required: ['identifiers', 'parties', 'transport', 'goods', 'packaging', 'handling', 'references'],
  properties: {
    identifiers: { type: 'object', required: ['glosShipmentId'], properties: { glosShipmentId: { type: 'string' }, shipperRef: { type: 'string' } } },
    parties: { type: 'array', items: { type: 'object', required: ['role', 'did'], properties: { role: { enum: ['shipper', 'consignee', 'carrier', 'notify'] }, did: { type: 'string' } } } },
    transport: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { enum: ['road', 'rail', 'air', 'ocean', 'courier', 'multimodal'] },
        ocean: { type: 'object', properties: { vessel: { type: 'string' }, voyage: { type: 'string' }, containerNumber: { type: 'string' }, bookingRef: { type: 'string' } } },
        air: { type: 'object', properties: { flightNumber: { type: 'string' }, mawb: { type: 'string' } } },
        road: { type: 'object', properties: { licensePlate: { type: 'string' }, vehicleId: { type: 'string' } } },
        rail: { type: 'object', properties: { trainNumber: { type: 'string' }, wagonNumber: { type: 'string' } } },
      },
    },
    goods: { type: 'object', properties: { description: { type: 'string' }, hsCode: { type: 'string', pattern: HS_CODE_RE.source }, incoterms: { enum: INCOTERMS }, commercialValue: { type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' } } } } },
    packaging: { type: 'object', required: ['count', 'totalWeightKg', 'packages'], properties: { count: { type: 'integer', minimum: 1 }, totalWeightKg: { type: 'number', exclusiveMinimum: 0 }, packages: { type: 'array', minItems: 1 } } },
    handling: { type: 'object', required: ['codes'], properties: { codes: { type: 'array', items: { type: 'string' } } } },
    customs: { type: 'object' },
    references: { type: 'object', description: 'Namespaced key/value tags, e.g. "eu:eori"' },
  },
} as const;
