// M7-041 — optimal network design. Aggregates accumulated flow across the live network (lanes, hub
// throughput, mode mix) and recommends structural changes: hub capacity, direct lanes, modal shift.

export interface HubLoad {
  location: string;
  throughput: number; // shipments routed through this hub
  weightKg: number;
}

export interface LaneStat {
  lane: string; // "origin → destination"
  origin: string;
  destination: string;
  count: number;
  weightKg: number;
  modes: string[];
  legsPerShipment: number;
}

export type DesignType = 'expand_hub' | 'consolidate_hub' | 'direct_lane' | 'mode_shift';

export interface DesignRecommendation {
  id: string;
  type: DesignType;
  subject: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  estBenefit: string;
  metrics: Record<string, number>;
}

export interface NetworkDesignReport {
  shipments: number;
  hubs: HubLoad[];
  lanes: LaneStat[];
  recommendations: DesignRecommendation[];
  at: string;
}
