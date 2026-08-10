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
  rating?: { count: number; average: number; isNew?: boolean } | null;
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

/** A destination PUDO the counter can pick from the public directory (Map/Address intake picker). */
export interface NetworkPoint {
  did: string;
  shopName: string;
  zone: string;
  location?: { lat: number; lng: number };
  landmark?: string;
  openState: 'open' | 'closed';
  pricePerParcel: number;
  rating?: { count: number; average: number; isNew?: boolean } | null;
  freeSlots?: number;
}

/** GET /sbg/geocode — a typed area/place resolved to a point (the Address intake mode). */
export interface GeocodeView {
  location: { lat: number; lng: number };
  confidence: 'exact' | 'approx' | 'fallback';
  matched?: string;
}

/** POST /sbg/size/classify — the derived tier + cargo class for measured dims (shown live at the counter). */
export interface ClassifyView {
  size: ParcelSize;
  cargoClass: string;
  dedicated: boolean;
}

/** PG4 — what the counter learns about a scanned sticker BEFORE confirming (GET parcels/:id/intake-preview). */
export interface IntakePreview {
  parcelId: string;
  kind: 'peer_send' | 'vendor_order' | 'walk_up';
  status: ParcelStatus;
  intakeReady: boolean;
  size: ParcelSize;
  weightKg: number;
  fragile: boolean;
  destZone: string;
  destShopName?: string;
  /** The locked price the shop collects in cash — 0 for a prepaid store order. */
  cashDue: number;
}

export interface HandoverView {
  handed: string[];
  vehicle?: string;
  /** S25 completeness gate: every parcel that belonged on this bus, and any knowingly left behind. */
  expected?: string[];
  missed?: string[];
  shortShipped?: boolean;
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

/* ------------------------------------------------------------- registers (R4) -- */

/** One row of the shop's parcel-history register — the shop's OWN handling, no buyer PII, no collection code. */
export interface AgentParcelRow {
  parcelId: string;
  did?: string;
  status: ParcelStatus;
  role: 'origin' | 'dest'; // took it in (drop-off) vs handed it out (collection)
  originZone: string;
  destZone: string;
  size: ParcelSize;
  trackingKey?: string;
  createdAt: string;
}

/** One row of the shop's earnings ledger. */
export interface AgentLedgerRow {
  id: string;
  type: 'TOP_UP' | 'FEE' | 'LABOR_PAYOUT' | 'REFUND' | 'OVERDRAFT' | string;
  sign: '+' | '-';
  amount: number;
  reference: string;
  refType?: string;
  at: string;
}

/** The earnings register's running totals for the CURRENT filtered view, plus the always-current wallet balance. */
export interface LedgerSummary {
  in: number;
  out: number;
  net: number;
  count: number;
  balance: number;
}
