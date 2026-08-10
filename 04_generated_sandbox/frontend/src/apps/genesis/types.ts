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
  // REP1 — the PII-free public reputation: the aggregate + a cold-start flag (a mean of one review is noise,
  // so below the backend's floor `isNew` is true and the UI shows "New" instead of a headline average).
  rating?: { count: number; average: number; isNew?: boolean } | null;
  freeSlots?: number;
  since?: string; // REP1 — "serving since" (the shop's onboarding date; a public trust signal, not PII)
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

/* ------------------------------------------------- booking (PG3) -- */

/** The derived tier + cargo class for typed dims + weight (POST /size/classify, @Public). */
export interface ClassifyView {
  size: ParcelSize;
  cargoClass: string;
  /** True = too big for the parcel network — a person's send is refused (dedicated freight is vendor-only for now). */
  dedicated: boolean;
}

/** The locked price a mint returns — what the sender pays in cash at the drop-off shop. */
export interface MintPrice {
  routeMode: 'locked' | 'flexible';
  total: number;
  transport?: number;
  nodeFees?: number;
  platformFee?: number;
  km?: number;
  ceiling?: number;
}

/** POST /identity/parcels — the sender's authenticated twin + their drop-off credential + the locked price. */
export interface MintResult {
  parcel: ConsumerParcelView;
  label: { parcelId: string; qrPayload: string; svg: string };
  price: MintPrice;
  journey?: { hops: string[]; mdpRouted: boolean; pickupReadyAt: string };
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
  /** Self profile (S29) — the person's own display name (revealed from the vault) + avatar mediaId.
   *  Self-view only: these are never present on any counterparty projection. */
  displayName?: string;
  avatarMediaId?: string;
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
  did?: string; // DT — the shipment's stable GLOS identity (the digital twin)
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

/** S32d — a diverted dedicated-freight job the buyer is a party to (the freight analogue of a parcel twin).
 *  Shown in a "Dedicated freight" section of "my parcels" so an order too big for the network stays visible. */
export interface FreightShipmentView {
  freightId: string;
  code: string; // human FRT-NNN reference
  status: 'available' | 'claimed' | 'in_transit' | 'delivered';
  cargoClass: string;
  destLabel: string;
  weightKg: number;
  trackingKey?: string;
  externalOrderId?: string;
  equipmentGaps: Array<'origin' | 'dest'>;
  createdAt: string;
  timeline: Array<{ status: string; at: string }>;
}

export interface MyParcels {
  sent: ConsumerParcelView[];
  received: ConsumerParcelView[];
  freights: FreightShipmentView[];
}

/* ------------------------------------------------- invites (S24) -- */

export interface InviteView {
  inviteId: string;
  token: string;
  channels?: string[];
  joined: number; // distinct people who joined through this link
  createdAt: string;
}

export interface InviteSummary {
  invites: InviteView[]; // the person's one reusable link (or empty)
  joined: number; // total joins it drove
}
