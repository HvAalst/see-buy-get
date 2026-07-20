// M5 Trust & Reputation domain (Compendium §8). Pseudonymous: keyed by DID, no PII.

export type SubjectRole = 'carrier' | 'shipper';

export type CarrierDimension = 'onTime' | 'cargoCare' | 'communication' | 'documentation' | 'equipment';
export type ShipperDimension = 'paymentPromptness' | 'loadReadiness' | 'informationAccuracy' | 'facilityAccessibility';

// Default, PUBLICLY-DOCUMENTED weight profiles (M5-011). Sum to 1.
export const CARRIER_WEIGHTS: Record<CarrierDimension, number> = {
  onTime: 0.3,
  cargoCare: 0.25,
  communication: 0.15,
  documentation: 0.15,
  equipment: 0.15,
};
export const SHIPPER_WEIGHTS: Record<ShipperDimension, number> = {
  paymentPromptness: 0.4,
  loadReadiness: 0.25,
  informationAccuracy: 0.2,
  facilityAccessibility: 0.15,
};

// Bayesian + decay constants (M5-012/013).
export const REPUTATION_PRIOR = 3.0; // neutral 0–5 prior
export const PRIOR_WEIGHT = 5; // pseudo-samples of prior
export const HALFLIFE_DAYS = 90;

/** A submitted rating. `scores` holds the mapped 0–100 value per dimension present. */
export interface Rating {
  id: string;
  glosShipmentId: string;
  raterDid: string;
  subjectDid: string;
  subjectRole: SubjectRole;
  scores: Partial<Record<CarrierDimension | ShipperDimension, number>>;
  comment?: string;
  commentHidden?: boolean; // hidden by sentiment analysis (M5-024)
  private?: boolean; // blinded (M5-022)
  forceMajeure?: boolean; // root-cause exclusion of on-time (M5-014)
  weight: number; // volume/value weight (M5-012)
  at: string;
}

export interface DimensionScore {
  value: number; // 0–100, decayed weighted avg
  samples: number;
}

export type DisputeTag = 'damage' | 'delay' | 'documentation' | 'payment';
export type SanctionLevel = 'none' | 'training' | 'restricted' | 'suspended' | 'deplatformed';

export interface DisputeRecord {
  at: string;
  tag: DisputeTag;
  atFault: boolean;
  note?: string;
}

export interface BadgeRef {
  name: string;
  vcId: string;
}

export interface ReputationRecord {
  did: string;
  role: SubjectRole;
  ratings: Rating[];
  dimensions: Partial<Record<CarrierDimension | ShipperDimension, DimensionScore>>;
  composite: number; // 0–5
  confidenceInterval: number;
  samples: number;
  badges: BadgeRef[];
  disputes: DisputeRecord[];
  sanction: SanctionLevel;
}

// Badge thresholds (M5-030). Sandbox sample counts are small.
export interface BadgeThreshold {
  name: string;
  dimension: CarrierDimension | ShipperDimension;
  min: number;
  minSamples: number;
}
export const BADGE_THRESHOLDS: BadgeThreshold[] = [
  { name: 'Elite On-Time', dimension: 'onTime', min: 95, minSamples: 3 },
  { name: 'Zero Damage', dimension: 'cargoCare', min: 98, minSamples: 3 },
  { name: 'Top Communicator', dimension: 'communication', min: 90, minSamples: 3 },
  { name: 'Prompt Payer', dimension: 'paymentPromptness', min: 95, minSamples: 3 },
];

export interface ReputationView {
  did: string;
  composite: number;
  confidenceInterval: number;
  samples: number;
  dimensions: Partial<Record<string, DimensionScore>>;
  badges: string[];
  disputeSummary: { total: number; atFault: number };
  sanction: SanctionLevel;
  explanation: string;
}
