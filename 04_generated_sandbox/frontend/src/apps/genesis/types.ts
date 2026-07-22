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
