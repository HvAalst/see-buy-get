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
  // The free window has run out. STILL COLLECTABLE — this changes the terms, never the door.
  | 'Unclaimed'
  | 'Delivered'
  | 'Disputed'
  | 'Voided';

export interface ShippingPolicy {
  mode: 'full' | 'capped';
  freeOverSubtotal: number;
  buyerContributionCap: number;
  maxTransportSpend?: number; // S34c — the store's per-shipment dedicated-freight spend cap (undefined = no cap)
  /** The store's insurer: every damage claim report on one of its orders is emailed there as a link. */
  insurer?: { name: string; email: string };
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
  /** Whether the ready_for_pickup callback carries the collection code (default true — see the store screen). */
  callbackCarriesCode?: boolean;
  location?: { lat: number; lng: number };
  address?: string;
  /** Their own dock, if they have asked for one. Absent = they drop off at a PUDO like everyone else. */
  collection?: CollectionPointView;
  country: string;
  /** Null where the store stands in a country we only match: it keeps no till with us. */
  balance: number | null;
  /** The money the balance, the bills and the shipping policy are in: the store’s company’s. Absent where it keeps
   *  no till with us. */
  currency?: string;
  shippingPolicy: ShippingPolicy;
  createdAt: string;
  /** When the signing secret was last changed; absent if never, since the store was made. */
  secretRotatedAt?: string;
  /** The store has an account of its own (an email and a password). False: it still signs in with its secret, and is asked to set one up. */
  hasAccount?: boolean;
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
  /** The account's address, where the sign-in was by account. */
  email?: string;
}

/** vendors/register → shown ONCE: the record still carrying the signing secret. */
export interface VendorRegisteredView extends VendorView {
  secret: string;
  /** The account made with the store, and a sign-in for this device. */
  email?: string;
  token?: { access_token: string; expires_in?: number };
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
  /** The damage claim report made when a problem was reported on this order. */
  damageReport?: { number: string };
  destAgentDid?: string;
  originAgentDid?: string;
  buyerMobile?: string;
  contentPhotoRef?: string;
  items?: Array<{ name: string; qty: number }>;
  scans?: Array<{ at: string; status: string; note?: string }>;
  subtotal?: number;
  /** The platform fee inside what was charged, and the rate it was charged at. Never the split inside it. */
  platformFee?: number;
  platformFeePct?: number;
  /** The tax inside what was charged, and what the authority calls it where this sale happened. */
  shipmentTax?: number;
  taxLabel?: string;
  /** The cover this shipment carries, and what was paid for any part of it that was bought. */
  declaredValue?: number;
  coverLimit?: number;
  shipmentPremium?: number;
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
  type: 'TOP_UP' | 'TOP_UP_FEE' | 'BILLING' | 'REBATE';
  sign: '+' | '-';
  amount: number;
  /** The money of the books the line was posted to. */
  currency?: string;
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
  /** Null where the store stands in a country we only match: it keeps no till with us. */
  balance: number | null;
  /** The one money every line in the view is in. */
  currency?: string;
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
  /** False: no new parcel can name this shop — it is not offered as a place to hand one in. */
  takesNew?: boolean;
  pricePerParcel: number;
  /** The money that price is in: the shop’s company’s. */
  currency?: string;
  rating?: { count: number; average: number } | null;
  freeSlots?: number;
}

/**
 * A return waiting on this store's decision.
 *
 * Carries BOTH numbers the decision is made between — what the goods are worth and what the journey home
 * costs — because "pay to get it back" is not a question anybody can answer without them.
 */
export interface ReturnOfferView {
  offerId: string;
  parcelId: string;
  declaredValue: number;
  returnCost: number;
  /**
   * What the shop is owed for holding the slot since the window closed — a METER, not a held price.
   *
   * The transport half is fixed and billed at exactly the figure shown. This one grows while the store
   * thinks about it, and rendering it as though it were fixed would be the single dishonest number on
   * the screen. It is also the truest pressure this feature has: a merchant watching the cost of
   * deciding nothing go up is being told something real.
   */
  holdingCost?: number;
  currency: string;
  offeredAt: string;
  expiresAt: string;
}

export interface QuoteLegPrice {
  transport: number;
  base: number;
  /** What the network EARNS on this shipment: the cost base plus its own fee. NOT what is billed. */
  total: number;
  /**
   * The platform fee inside `total` — the one line a merchant is owed.
   *
   * A business partner reconciling their books sees our take; Stripe and Shopify show theirs, and hiding
   * it reads as evasive. What stays ours is what the fee is MADE OF: cost of risk, profit on risk, margin.
   */
  fee?: number;
  /** Tax on the whole sale, charged on top of `total`. Zero — and absent — until a sister sets a rate. */
  tax?: number;
  /** WHAT THE STORE IS ACTUALLY BILLED: total + tax. Absent on a quote taken before tax existed. */
  gross?: number;
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
  /** The money every figure of the quote is in: the selling company’s. */
  currency?: string;
}

/** quote/options → one price per drop-off candidate (or the reason there is none). */
export interface OriginOption {
  did: string;
  quote?: QuoteView;
  error?: string;
}

/**
 * A prepayment the store has asked to make, and is waiting on.
 *
 * Not a movement: `reference` is what the store quotes when it pays, and the prepaid balance changes when
 * the payment provider confirms the payment — see `foundation/funding` on the server, and the shop app's
 * twin of this type. The amount the books move by is the amount the provider confirms, not this one.
 */
export interface VendorFundingView {
  fundingId: string;
  amount: number;
  currency: string;
  status: 'awaiting' | 'confirmed' | 'failed' | 'expired' | 'reversed';
  reference: string;
  instructions: string;
  /** Whether a payment prompt went to a phone — see the shop app's twin of this type. */
  pushed?: boolean;
  railRef?: string;
  /** Why it will not be paid, in the provider's own words ("Request cancelled by user"). */
  failureReason?: string;
  openedAt: string;
  confirmedAmount?: number;
  confirmedAt?: string;
}

/** One damage claim report on an order of this store's, as the store's list reports it. */
export interface DamageReportRow {
  parcelId: string;
  number: string;
  madeAt: string;
  origin: 'buyer' | 'counter';
  reason: string;
  from: string;
  to: string;
  store?: string;
  heldBy?: string;
  links: number;
  opened: number;
  /** Where it was emailed the moment it was made: the insurer on the shipping policy. */
  insurer?: { insurer: string; sentTo: string; at: string };
}
