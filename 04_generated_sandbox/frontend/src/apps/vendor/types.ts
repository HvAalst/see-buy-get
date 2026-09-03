/**
 * Local view types for the vendor console. Same contract stance as every other app: honest
 * view types declared once, `narrow()` in api.ts as the single cast site. Field names
 * mirror pudo.types.ts (Vendor, CheckoutHandoff, Parcel) and vendor.service.ts.
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

export interface ShippingPolicy {
  mode: 'full' | 'capped';
  freeOverSubtotal: number;
  buyerContributionCap: number;
  maxTransportSpend?: number; // S34c — the store's per-shipment dedicated-freight spend cap (undefined = no cap)
}

/**
 * The store's own dock — a place the network collects FROM.
 *
 * Outbound only, and deliberately not a PUDO: no shelf, no release, never somewhere a parcel is sent, and
 * no intake fee, because nobody takes in a box its own owner packed. It is a place on the route, never a
 * stop in the fee stack, which is why enabling one does not change a single price.
 */
export interface CollectionPointView {
  label: string; // what a driver reads on the offer: "Njiro warehouse, gate 2"
  zone: string;
  country?: string; // absent = the store's own; a warehouse abroad says so
  location: { lat: number; lng: number }; // the loading door, which is not always the storefront pin
  bays: number; // floor room for sealed bags waiting to be collected
  enabledAt: string;
}

export interface VendorView {
  vendorId: string;
  did: string;
  name: string;
  callbackUrl?: string;
  location?: { lat: number; lng: number };
  address?: string;
  /** Their own dock, if they have asked for one. Absent = they drop off at a PUDO like everyone else. */
  collection?: CollectionPointView;
  country: string;
  balance: number;
  shippingPolicy: ShippingPolicy;
  createdAt: string;
}

/** What the dock should be bagging right now: paid parcels grouped by where they are going, the bags
 *  already open, and how much floor is left. Mirrors DockService.plan(). */
export interface DockPlan {
  groups: Array<{ key: string; label: string; parcelIds: string[]; openBagCode?: string }>;
  bags: Array<{ code: string; destinationLabel?: string; parcelIds: string[]; parcels: number; fillPct: number; status: string }>;
  staging: { capacity: number; used: number; free: number };
}

/** vendors/login → the public record plus the actor token the console carries. */
export interface VendorLoginView extends VendorView {
  token: { access_token: string; expires_in?: number };
}

/** vendors/register → shown ONCE: the record still carrying the signing secret. */
export interface VendorRegisteredView extends VendorView {
  secret: string;
}

export interface OrderRow {
  parcelId: string;
  did?: string; // DT — the shipment's stable GLOS identity (the digital twin)
  externalOrderId?: string;
  status: ParcelStatus;
  paidStatus: 'ParcelPaid' | 'Unpaid' | string;
  buyer?: string; // R2 — the buyer's mobile (this store's own customer)
  buyerEmail?: string;
  products?: string; // R2 — item names, human-readable ("Ankara shirt ×2, Kitenge scarf")
  collectionCode?: string;
  trackingKey?: string;
  binSlot?: string;
  destZone: string;
  destAgentDid?: string; // R2 — the collection PUDO (the per-PUDO filter value)
  size: ParcelSize;
  shipmentCost?: number;
  buyerCharge?: number;
  /** What those two amounts ARE — the money this store's own sister sells in, stamped on the parcel.
   *  Optional because rows served before parcels named their unit carry none. */
  currency?: string;
  routeMode?: 'flexible' | 'locked';
  createdAt?: string;
}

/** Store-wide shipment counts for the console header + spoken summary — over the WHOLE store, never a page. */
export interface OrderStats {
  total: number;
  unpaid: number;
  active: number;
}

export interface OrderDetail extends OrderRow {
  destAgentDid?: string;
  originAgentDid?: string;
  buyerMobile?: string;
  contentPhotoRef?: string;
  items?: Array<{ name: string; qty: number }>;
  scans?: Array<{ at: string; status: string; note?: string }>;
}

/**
 * A merchant API key, as its owner may see it.
 *
 * `value` is present for a PUBLISHABLE key only — it lives in a page in plain sight and gets pasted into a
 * template again every time one is rebuilt. A secret key shows four characters and no more, because we do
 * not have the rest of it: it existed in exactly one response, at creation.
 */
export interface ApiKeyRow {
  keyId: string;
  kind: 'publishable' | 'secret';
  mode: 'test' | 'live';
  label?: string;
  hint: string;
  value?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

/** A key the moment it was minted — the one and only time a secret is on screen. */
export interface IssuedKey extends ApiKeyRow {
  secret: string;
}

export interface CheckoutRow {
  id: string;
  vendorId: string;
  destAgentDid: string;
  buyerEmail: string;
  buyerMobile?: string;
  externalOrderId?: string;
  items?: Array<{ name: string; qty: number }>;
  subtotal?: number;
  source: 'node' | 'webhook' | 'manual';
  consumed: boolean;
  at: string;
}

export interface MintView {
  parcel: OrderDetail;
  label: { parcelId: string; qrPayload: string; svg: string } | null;
  paid: boolean;
}

export interface SettlementRow {
  id: string;
  type: 'TOP_UP' | 'BILLING' | 'REBATE';
  sign: '+' | '-';
  amount: number;
  parcelId?: string;
  note?: string;
  at: string;
}

/** R3 — the bookkeeping register's running totals for the CURRENT filtered view, plus the always-current
 *  store balance (which never depends on the filter). */
export interface LedgerSummary {
  in: number;
  out: number;
  net: number;
  count: number;
  balance: number;
}

export interface CallbackRow {
  id: string;
  event: string;
  url: string;
  at: string;
}

/** The public directory row (same shape the Send app reads). */
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

export interface QuoteLegPrice {
  transport: number;
  base: number;
  total: number;
}

export interface QuoteView {
  hops: Array<{ type: 'pudo' | 'mdp'; id: string; label: string }>;
  /** Whether the transport was priced on the box the store MEASURED or on the tier it was declared as.
   *  Absent from a quote taken before this existed, which reads as the tier — the honest answer for it. */
  factorBasis?: 'measured' | 'band';
  totalKm: number;
  nodeFees: number;
  size: ParcelSize;
  flexible: QuoteLegPrice;
  locked: QuoteLegPrice;
}

/** quote/options → one price per drop-off candidate (or the reason there is none). */
export interface OriginOption {
  did: string;
  quote?: QuoteView;
  error?: string;
}
