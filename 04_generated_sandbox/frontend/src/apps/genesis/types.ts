/**
 * Local view types for the Send app. All four surfaces this app touches are @Public
 * (S13): the network directory, the two quote endpoints and track-and-trace. Field names
 * mirror pudo.controller.ts (networkPoints), routing.service.ts (ShipmentQuote) and
 * parcel.service.ts (track).
 */

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

/** One row of the public network directory — the sanitized slice a sender may see. */
export interface NetworkPoint {
  did: string;
  shopName: string;
  zone: string;
  location?: { lat: number; lng: number };
  landmark?: string;
  openState: 'open' | 'closed';
  pricePerParcel: number;
  rating?: { count: number; average: number } | null;
  freeSlots?: number;
}

export interface QuoteHop {
  type: 'pudo' | 'mdp';
  id: string;
  label: string;
}

export interface QuoteLegPrice {
  transport: number;
  base: number;
  total: number;
}

export interface QuoteView {
  hops: QuoteHop[];
  nodes: Array<{ type: string; id: string; label: string; fee: number }>;
  legs: Array<{ from: string; to: string; km: number }>;
  totalKm: number;
  nodeFees: number;
  size: ParcelSize;
  perKm: { min: number; max: number };
  platformFeePct: number;
  /** Any carrier takes it — priced at the top of the per-km market. */
  flexible: QuoteLegPrice;
  /** Waits for the cheapest carrier — priced at the bottom of the market. */
  locked: QuoteLegPrice;
}

export interface TrackStep {
  status: string;
  at: string;
  note?: string;
}

export interface TrackView {
  ref: string;
  status: ParcelStatus;
  size: ParcelSize;
  destination: string;
  destZone: string;
  steps: TrackStep[];
  binSlot?: string;
  /** The collect card (rev 5): where the shop is, in words and as a pin. */
  destinationLandmark?: string;
  destinationLocation?: { lat: number; lng: number };
}

/* ------------------------------------------------- identity (S20/S21) -- */

/** The person-facing roles a consumer may hold (mirrors backend PersonRole / lib/sbg). */
export type PersonRole = 'consumer' | 'driver' | 'agent' | 'mdp' | 'fleet_manager' | 'vendor';

export interface RoleLinkView {
  role: PersonRole;
  entityDid: string;
  status: 'active' | 'pending' | 'suspended';
}

/** The bearer an enroll/login returns (shape of the backend AccessToken). */
export interface AccessTokenView {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** The signed-in person + roles (GET /identity/me, and the enroll/login envelope minus the token). */
export interface PersonView {
  personId: string;
  roles: RoleLinkView[];
  hasPin: boolean;
  createdAt: string;
}

/** enroll/login response = a PersonView + isNew + the actor token to seed. */
export interface AuthResult extends PersonView {
  isNew?: boolean;
  token: AccessTokenView;
}

/** The role-switch response — a NEW actor token for the target role, bound to its entity. */
export interface SwitchResult {
  role: PersonRole;
  entityDid: string;
  token: AccessTokenView;
}

/** One authenticated parcel twin the consumer is a party to (PII-free; mirrors backend ConsumerParcelView). */
export interface ConsumerParcelView {
  parcelId: string;
  relation: 'sent' | 'received';
  direction: 'inbound' | 'outbound';
  status: ParcelStatus;
  originZone: string;
  destZone: string;
  size: ParcelSize;
  fragile?: boolean;
  items?: Array<{ name: string; qty: number }>;
  trackingKey?: string;
  vendorOrder: boolean;
  createdAt: string;
  updatedAt: string;
  timeline: Array<{ at: string; status: ParcelStatus | 'CREATED'; note?: string }>;
  /** The in-app collection token (S22) — only on the single-parcel detail, for the receiver, when ready. */
  collectToken?: { code: string; qrPayload: string };
  /** S23: the receiver's own photos + reason (present only on their own — received — view). */
  podPhotoRef?: string;
  disputePhotoRef?: string;
  disputeReason?: string;
}

export interface MyParcels {
  sent: ConsumerParcelView[];
  received: ConsumerParcelView[];
}
