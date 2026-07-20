// M3 Dynamic Matchmaking & Pricing domain (Compendium §6). Pseudonymous: carriers referenced
// by DID; matching uses capability VCs, equipment, reputation, and zone — never PII.

export interface AvailabilityEntry {
  did: string;
  zone: string;
  equipment: string[];
  status: 'available' | 'busy';
  updatedAt: string;
}

export type ServiceTier = 'economy' | 'standard' | 'express' | 'white_glove';

export interface ServiceLevelObjective {
  maxCost?: number;
  minReputation?: number; // 0–5
  deadline?: string;
  tier?: ServiceTier;
  ecoPreference?: boolean;
  /** Optimization weights (sum need not be 1; normalized internally). */
  weights?: { cost?: number; reputation?: number; proximity?: number };
}

export interface DemandInput {
  glosShipmentId: string;
  payerDid: string;
  currency?: string;
  zone?: string;
  slo?: ServiceLevelObjective;
}

export interface PriceBreakdown {
  baseRate: number;
  surgeMultiplier: number;
  tier: ServiceTier;
  tierMultiplier: number;
  total: number;
  currency: string;
  /** Spot prices are binding for a short window; indicative (batch/pre-book) prices carry a band. */
  binding: boolean;
  bindingUntil?: string;
  confidence?: { low: number; high: number };
}

export interface Candidate {
  did: string;
  reputation: number;
  zoneMatch: boolean;
  coldStart: boolean;
  score: number;
  breakdown: { cost: number; reputation: number; proximity: number; coldStartBoost: number };
}

export type MatchStatus = 'offered' | 'confirmed' | 'failed' | 'blocked';

export interface MatchMilestoneTerm {
  name: 'PICKUP' | 'HANDOVER' | 'DELIVERY';
  percent: number;
  payeeDid: string;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface MatchOverride {
  type: 'force_assign' | 'block';
  reason: string;
  reviewFlag: boolean;
  by?: string;
  at: string;
}

export interface Match {
  matchId: string;
  glosShipmentId: string;
  payerDid: string;
  zone?: string;
  currency: string;
  tier: ServiceTier;
  price: PriceBreakdown;
  ranked: Candidate[];
  offerIndex: number;
  status: MatchStatus;
  confirmedCarrierDid?: string;
  explanation?: string;
  override?: MatchOverride;
  milestones: MatchMilestoneTerm[];
  audit: AuditEntry[];
  createdAt: string;
}

export interface MatchView {
  matchId: string;
  glosShipmentId: string;
  status: MatchStatus;
  tier: ServiceTier;
  currentOffer?: { carrierDid: string; reputation: number; score: number };
  price: PriceBreakdown;
  rankedDids: string[];
  confirmedCarrierDid?: string;
  explanation?: string;
}

// --- Sprint 2/3 additions ---

export interface Quote {
  glosShipmentId: string;
  tier: ServiceTier;
  price: PriceBreakdown;
  ranked: Candidate[];
  eligibleCount: number;
  explanation?: string;
}

export interface BatchAssignment {
  glosShipmentId: string;
  matchId?: string;
  carrierDid?: string;
  score?: number;
  total?: number;
  status: 'assigned' | 'unmatched';
  reason?: string;
}

export interface BatchResult {
  window: 'instant' | 'batch';
  demands: number;
  assigned: number;
  totalScore: number;
  assignments: BatchAssignment[];
}

export interface AvailabilityForecast {
  zone: string;
  samples: number;
  expectedAvailable: number;
  probabilityHasCapacity: number; // 0–1
  confidence: 'low' | 'medium' | 'high';
}

export interface PreBooking {
  preBookingId: string;
  glosShipmentId: string;
  zone: string;
  forecast: AvailabilityForecast;
  indicativePrice: PriceBreakdown;
  createdAt: string;
}

export interface SegmentStat {
  segment: string;
  offers: number;
  accepts: number;
  acceptanceRate: number;
  coldStartOffers: number;
}

export interface FairnessReport {
  totalOffers: number;
  totalAccepts: number;
  coldStartOfferShare: number; // 0–1
  byZone: SegmentStat[];
  byTier: SegmentStat[];
  at: string;
}
