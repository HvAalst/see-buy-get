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
}

export interface VendorView {
  vendorId: string;
  did: string;
  name: string;
  callbackUrl?: string;
  location?: { lat: number; lng: number };
  address?: string;
  country: string;
  balance: number;
  shippingPolicy: ShippingPolicy;
  createdAt: string;
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
  externalOrderId?: string;
  status: ParcelStatus;
  paidStatus: 'ParcelPaid' | 'Unpaid' | string;
  collectionCode?: string;
  trackingKey?: string;
  binSlot?: string;
  destZone: string;
  size: ParcelSize;
  shipmentCost?: number;
  buyerCharge?: number;
  routeMode?: 'flexible' | 'locked';
  createdAt?: string;
}

export interface OrderDetail extends OrderRow {
  destAgentDid?: string;
  originAgentDid?: string;
  buyerMobile?: string;
  contentPhotoRef?: string;
  items?: Array<{ name: string; qty: number }>;
  scans?: Array<{ at: string; status: string; note?: string }>;
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
