/**
 * Local view types for the agent app.
 *
 * The generated schema leaves most sbg responses untyped (`Record<string, never>`) and
 * erases the enum fields on the rest, so — exactly as in the driver app — the boundary is
 * declared here once and `narrow()` in api.ts is the single sanctioned place the casts
 * happen. Field names mirror backend/src/modules/pudo/pudo.types.ts.
 */

export type AgentStatus = 'DRAFT' | 'KYC_PENDING' | 'APPROVED_UNFUNDED' | 'ACTIVE' | 'LOCKED';
export type OpenState = 'open' | 'closed';
export type ParcelSize = 'S' | 'M' | 'L' | 'HEAVY';
export type ParcelStatus =
  | 'Created'
  | 'At_PUDO'
  | 'On_Bus'
  | 'At_MDP'
  | 'Ready_For_Pickup'
  | 'Delivered'
  | 'Disputed'
  | 'Voided';

export interface AgentView {
  agentId: string;
  did: string;
  shopName: string;
  zone: string;
  location?: { lat: number; lng: number };
  landmark?: string;
  openState: OpenState;
  pricePerParcel: number;
  status: AgentStatus;
  /** Merged in by the controller alongside the record. */
  balance: number;
  rating?: { count: number; average: number } | null;
}

/** GET /agents/{did}/can-transact — the 'no money, no scan' gate as readable state. */
export interface GateView {
  ok: boolean;
  canTransact?: boolean;
  code?: 'WALLET_INSUFFICIENT' | 'AGENT_LOCKED' | string;
  balance: number;
  shortfall?: number;
}

export interface CorridorRow {
  corridorId: string;
  name: string;
  originZone: string;
  destZone: string;
  status: string;
}

export interface ParcelView {
  parcelId: string;
  size: ParcelSize;
  status: ParcelStatus;
  destZone: string;
  destAgentDid?: string;
  senderMobile?: string;
  receiverMobile?: string;
  binSlot?: string;
  toteId?: string;
  items?: Array<{ name: string; qty: number }>;
  collectionCode?: string;
  /** ISO time the parcel was accepted — drives the 5-minute void window countdown. */
  acceptedAt?: string;
}

export interface HandoverView {
  handed: string[];
  vehicle?: string;
}

export interface ArriveView {
  /** Sandbox: the OTP that was "sent" to the customer, surfaced for the demo. */
  otp?: string;
}

export interface CollectView {
  parcel: ParcelView;
  binSlot?: string;
}

export interface ReceiveBagView {
  delivered: string[];
}

export interface Benchmark {
  count: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
}

export interface RatePin {
  id: string;
  label: string;
  price: number;
  km?: number;
  location?: { lat: number; lng: number };
}

export interface RatesView {
  benchmark?: Benchmark;
  pins: RatePin[];
  radiusKm?: number;
}
