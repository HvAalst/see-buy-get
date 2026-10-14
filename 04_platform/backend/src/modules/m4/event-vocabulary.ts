// GLOS Standard Tracking event vocabulary + state machine (VTT-011/021).
// Advancing events move the shipment's main state; geofence/exception events are recorded
// but do not advance state. An advancing event that isn't a legal transition is an anomaly
// (e.g. DELIVERED before OUT_FOR_DELIVERY).

export const TRACKING_EVENT_TYPES = [
  'PICKUP',
  'ARRIVED_AT_HUB',
  'DEPARTED',
  'HANDOVER',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
  'GEOFENCE_ENTER',
  'GEOFENCE_EXIT',
] as const;

export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

export type ShipmentState = 'START' | 'PICKUP' | 'ARRIVED_AT_HUB' | 'DEPARTED' | 'HANDOVER' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

const NON_ADVANCING = new Set<TrackingEventType>(['EXCEPTION', 'GEOFENCE_ENTER', 'GEOFENCE_EXIT']);

const TRANSITIONS: Record<ShipmentState, TrackingEventType[]> = {
  START: ['PICKUP'],
  PICKUP: ['ARRIVED_AT_HUB', 'DEPARTED', 'HANDOVER', 'OUT_FOR_DELIVERY'],
  ARRIVED_AT_HUB: ['HANDOVER', 'DEPARTED', 'OUT_FOR_DELIVERY'],
  DEPARTED: ['ARRIVED_AT_HUB', 'HANDOVER', 'OUT_FOR_DELIVERY'],
  HANDOVER: ['DEPARTED', 'ARRIVED_AT_HUB', 'OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
};

export function isKnownEventType(type: string): type is TrackingEventType {
  return (TRACKING_EVENT_TYPES as readonly string[]).includes(type);
}

export function isAdvancing(type: TrackingEventType): boolean {
  return !NON_ADVANCING.has(type);
}

/** Whether an advancing event is a legal transition from the current state. */
export function isLegalTransition(currentState: ShipmentState, type: TrackingEventType): boolean {
  if (!isAdvancing(type)) return true; // non-advancing events allowed any time
  return (TRANSITIONS[currentState] ?? []).includes(type);
}
