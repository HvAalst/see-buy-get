// M7 digital-twin domain (Compendium §11). A live property graph of the network.

export type NodeType = 'shipment' | 'carrier' | 'location' | 'leg';
export type ShipmentState = 'created' | 'planned' | 'assigned' | 'picked_up' | 'in_transit' | 'handed_over' | 'out_for_delivery' | 'delivered' | 'exception';

export interface TwinNode {
  id: string;
  type: NodeType;
  label?: string;
  state?: ShipmentState;
  location?: { lat: number; lng: number };
  props: Record<string, unknown>;
  updatedAt: string;
}

export type EdgeType = 'has-leg' | 'assigned-to' | 'at-location' | 'handover';

export interface TwinEdge {
  from: string;
  to: string;
  type: EdgeType;
  props?: Record<string, unknown>;
}

export interface EtaPrediction {
  glosShipmentId: string;
  hoursRemaining: number;
  eta: string;
  confidence: { low: string; high: string; level: number };
  basis: string;
}

export type DisruptionType = 'port_strike' | 'weather' | 'unrest' | 'congestion' | 'carrier_failure';

export interface Disruption {
  id: string;
  type: DisruptionType;
  zone: string;
  center?: { lat: number; lng: number };
  radiusKm: number;
  severity: 'low' | 'medium' | 'high';
  detectedAt: string;
}

export interface ImpactedShipment {
  glosShipmentId: string;
  state: ShipmentState;
  reason: string;
  criticality: number; // 0–100
}

export interface PrescriptiveOption {
  id: string;
  action: 'reroute' | 'wait' | 'split_air' | 'rebook_fastest';
  label: string;
  deltaCost: number;
  deltaHours: number;
  reliability: number; // 0–1
  justification: string;
}

export interface OrchestrationPolicy {
  id: string;
  shipperDid: string;
  ifDelayHoursGt: number;
  ifExtraCostLt: number;
  thenAction: PrescriptiveOption['action'];
}

export type ActionStatus = 'pending_approval' | 'executed' | 'rejected' | 'rolled_back' | 'frozen';

export interface AutonomousAction {
  id: string;
  glosShipmentId: string;
  option: PrescriptiveOption;
  policyId?: string;
  status: ActionStatus;
  approvalDeadline?: string;
  rollbackUntil?: string;
  anchorTxId?: string;
  rematchId?: string;
  at: string;
}
