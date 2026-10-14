// M4 exception domain (VTT-040/041/042). Each detected exception is a persistent case with a
// lifecycle and an immutable action log.

export type ExceptionType =
  | 'route_deviation'
  | 'prolonged_stationary'
  | 'temperature_breach'
  | 'shock_breach'
  | 'handover_delay'
  | 'delivery_without_acceptance'
  | 'missed_window';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type CaseStatus = 'open' | 'acknowledged' | 'resolving' | 'resolved' | 'false_alarm';

export interface CaseAction {
  at: string;
  action: string;
  by?: string;
  detail?: string;
}

export interface ExceptionCase {
  id: string;
  glosShipmentId: string;
  type: ExceptionType;
  severity: Severity;
  status: CaseStatus;
  detectedAt: string;
  reason: string;
  affectedMilestones: string[];
  metrics: Record<string, number>;
  anchorTxId?: string;
  actions: CaseAction[];
}
