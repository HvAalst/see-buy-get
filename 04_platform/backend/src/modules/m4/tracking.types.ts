import { ShipmentState, TrackingEventType } from './event-vocabulary';

// M4 tracking domain (Compendium §7). M4 consumes M2's planned route structurally via the
// `shipment.leg_decomposed` event payload — kept as local shapes so M4 stays decoupled from M2.

export type EventSource = 'api' | 'mobile' | 'manual';

export interface RawTrackingEvent {
  glosShipmentId: string;
  type: TrackingEventType;
  occurredAt?: string;
  location?: { lat: number; lng: number };
  carrierDid?: string;
  source?: EventSource;
  /** Whether a manual event is backed by photo/proof (raises confidence). */
  proof?: boolean;
  payload?: Record<string, unknown>;
}

export type ProofOfDeliveryType = 'signature' | 'photo' | 'pin';

export interface ProofOfDelivery {
  type: ProofOfDeliveryType;
  ref: string; // signature/photo blob ref or PIN hash
  capturedAt: string;
  location?: { lat: number; lng: number };
}

export interface TrackingEvent {
  id: string;
  glosShipmentId: string;
  type: TrackingEventType;
  occurredAt: string;
  location?: { lat: number; lng: number };
  carrierDid?: string;
  source: EventSource;
  /** Data-quality confidence 0–100 (VTT-024). */
  confidence: number;
  eventHash: string;
  anchorTxId: string;
  anomaly?: boolean;
  pod?: ProofOfDelivery;
}

// --- planned route (from M2 leg_decomposed), kept structurally ---

export interface PlannedLeg {
  index: number;
  mode: string;
  origin: string;
  destination: string;
  handover: { locationId: string; geofence?: { id: string; center: { lat: number; lng: number }; radiusM: number }; verification: string };
}

export interface PlannedMilestone {
  id: string;
  name: string;
  legIndex: number;
}

export interface TrackingContext {
  glosShipmentId: string;
  legs: PlannedLeg[];
  milestones: PlannedMilestone[];
  registeredAt: string;
}

export interface Timeline {
  glosShipmentId: string;
  currentState: ShipmentState;
  events: TrackingEvent[];
  conflictsPreserved: number;
  milestoneProgress: { total: number; reached: number };
  hasContext: boolean;
}
