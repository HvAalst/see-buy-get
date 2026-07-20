import { AnchorReceipt } from '../../foundation/ledger/ledger.types';

// M2 Universal Shipment Digitization — the digital twin (Compendium §5).
// Operational + pseudonymous: parties are referenced by DID (M2-023), commercial PII stays
// out of the twin (only declared value + incoterms for customs). No names/addresses here.

export type TransportMode = 'road' | 'rail' | 'air' | 'ocean' | 'courier' | 'multimodal';
export type PartyRole = 'shipper' | 'consignee' | 'carrier' | 'notify';
export type HandoverVerification = 'signature' | 'geofence' | 'photo';

// Mode-specific transport detail blocks (M2-022).
export interface OceanTransport {
  vessel?: string;
  voyage?: string;
  containerNumber?: string;
  bookingRef?: string;
}
export interface AirTransport {
  flightNumber?: string;
  mawb?: string; // master air waybill
}
export interface RoadTransport {
  licensePlate?: string;
  vehicleId?: string;
}
export interface RailTransport {
  trainNumber?: string;
  wagonNumber?: string;
}
export interface TransportBlock {
  mode: TransportMode;
  ocean?: OceanTransport;
  air?: AirTransport;
  road?: RoadTransport;
  rail?: RailTransport;
}
export type TransportDetails = Omit<TransportBlock, 'mode'>;

export interface Party {
  role: PartyRole;
  did: string; // GLOS DID reference (M2-023)
}

export interface PackageItem {
  id: string;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  description?: string;
}

export interface CommercialValue {
  amount: number;
  currency: string;
}

/** Universal e-waybill core schema (M2-020) — mandatory blocks. */
export interface EWaybillCore {
  identifiers: { glosShipmentId: string; shipperRef?: string };
  parties: Party[];
  transport: TransportBlock;
  goods: { description?: string; hsCode?: string; commercialValue?: CommercialValue; incoterms?: string };
  packaging: { count: number; totalWeightKg: number; packages: PackageItem[] };
  handling: { codes: string[] };
  customs?: Record<string, unknown>;
  /** Extensible namespaced tags (M2-021), e.g. { 'eu:eori': '...' }. */
  references: Record<string, string>;
}

export interface Geofence {
  id: string;
  center: { lat: number; lng: number };
  radiusM: number;
}

export interface HandoverPoint {
  locationId: string; // GLOS Location ID
  timeWindow?: { from: string; to: string };
  geofence?: Geofence;
  responsibleDid?: string;
  verification: HandoverVerification;
}

export interface Milestone {
  id: string;
  name: string;
  legIndex: number;
}

export interface LegProposal {
  id: string;
  fromDid: string;
  price: number;
  currency: string;
  note?: string;
  at: string;
}
export interface LegAgreedTerms {
  proposalId: string;
  price: number;
  currency: string;
  byDid: string;
  at: string;
}
export interface LegNegotiation {
  proposals: LegProposal[];
  agreed?: LegAgreedTerms;
}

export interface Leg {
  index: number;
  mode: TransportMode;
  origin: string;
  destination: string;
  handover: HandoverPoint;
  constraints: string[]; // inherited master constraints
  legConstraints: string[]; // leg-specific additions (M2-062)
  assignedCarrierDid?: string;
  negotiation: LegNegotiation; // per-leg term negotiation (M2-062)
}

export interface ShipmentVersion {
  version: number;
  anchor: AnchorReceipt;
  at: string;
  note: string;
}

export interface Shipment {
  glosShipmentId: string;
  status: 'created' | 'enriched' | 'decomposed';
  origin: string;
  destination: string;
  deliveryWindow?: { from: string; to: string };
  ewaybill: EWaybillCore;
  legs: Leg[];
  milestones: Milestone[];
  versions: ShipmentVersion[]; // versions[0] = genesis (M2-050); subsequent = amendments (M2-051)
  createdAt: string;
}

/** Job Requirement Vector — the query M3 uses to find capacity (M2-032). */
export interface JobRequirementVector {
  glosShipmentId: string;
  perLeg: Array<{
    legIndex: number;
    mode: TransportMode;
    mandatoryVCs: string[];
    equipment: string[];
    maxWeightKg: number;
  }>;
}
