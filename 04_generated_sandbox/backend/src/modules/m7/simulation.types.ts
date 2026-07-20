// M7-040 — what-if scenario simulation (Phase 4). Replays hypothetical disruptions against the live
// digital twin to project impact + autonomous response, WITHOUT mutating any real state.

import { DisruptionType, PrescriptiveOption, ShipmentState } from './twin.types';

export interface ScenarioDisruption {
  type?: DisruptionType;
  zone: string;
  center?: { lat: number; lng: number };
  radiusKm?: number;
  severity?: 'low' | 'medium' | 'high';
}

export interface ScenarioInput {
  label?: string;
  disruptions: ScenarioDisruption[];
}

export interface SimulatedShipment {
  glosShipmentId: string;
  state: ShipmentState;
  criticality: number;
  baselineHours: number;
  projectedHours: number;
  deltaHours: number;
  recommended: PrescriptiveOption | null;
  /** Whether a registered shipper policy would fire under this scenario. */
  policyWouldFire: boolean;
  policyAction?: PrescriptiveOption['action'];
  /** How a firing policy would be handled: auto-execute, queue for approval, or anomaly-freeze. */
  disposition?: 'auto' | 'approval' | 'frozen';
}

export interface ScenarioReport {
  label: string;
  disruptions: ScenarioDisruption[];
  impacted: SimulatedShipment[];
  totals: {
    impacted: number;
    addedHours: number;
    autonomousActions: number;
    approvalsRequired: number;
    frozen: number;
    /** Spend of would-fire autonomous/approval actions. */
    autonomousCost: number;
    /** Spend if an operator accepted the top recommendation for every impacted shipment. */
    recommendedCost: number;
    /** Impacted shipments with no policy that would fire (need a human). */
    unprotected: number;
  };
  at: string;
}
