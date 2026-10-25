import type { UnitHold } from '../../shared/tamper';

/**
 * Local view types for the hub app. Same contract stance as the driver/agent apps: the
 * generated schema leaves these responses untyped, so the boundary is declared here once
 * and `narrow()` in api.ts is the single cast site. Field names mirror
 * backend/src/modules/pudo/pudo.types.ts and mdp.service.ts.
 */

export type ToteStatus = 'free' | 'filling' | 'available' | 'claimed' | 'in_transit';
export type ParcelSize = 'S' | 'M' | 'L' | 'HEAVY';

export interface MdpView {
  mdpId: string;
  did: string;
  name: string;
  zones: string[];
  location?: { lat: number; lng: number };
  pricePerParcel: number;
  /** The country it stands in. Absent on a hub registered before hubs said one: the network's home country. */
  country?: string;
  /** The money the fee is in: the company’s that contracts the hub. Merged in by the controller. */
  currency?: string;
  /** Merged in by the controller: totes currently at this hub. */
  totes?: number;
  /**
   * Where it stands with SeeBuyGet (the ISO 28000 check: "hubs are vetted"), shown to the hub itself and to staff. A hub
   * that signed itself up works once staff have seen its papers. Absent: not vetted.
   */
  vetting?: { state: 'draft' | 'pending' | 'approved'; refusal?: { reason: string } };
}

export interface ToteView {
  toteId: string;
  code: string;
  status: ToteStatus;
  locationId: string;
  destinationNodeId?: string;
  destinationLabel?: string;
  parcels: string[];
  unitsUsed: number;
  weightKg: number;
  /** Round 36 — how it is closed for the road; absent while it is open. */
  closedWith?: 'seal' | 'photo';
  /** Round 36 — held under the tamper protocol. */
  held?: UnitHold;
}

export interface ParcelRow {
  parcelId: string;
  size: ParcelSize;
  status: string;
  destZone: string;
  toteId?: string;
  atMdpId?: string;
  /** Round 35 — held under the tamper protocol: set apart here, sorted once operations releases it. */
  held?: UnitHold;
}

export interface NextHop {
  type: 'pudo' | 'mdp';
  id: string;
  label: string;
  zone: string;
}

export interface SortView {
  parcelId: string;
  nextDestination: NextHop;
  toteCode: string;
  toteId: string;
  fillPct: number;
}

export interface DropView {
  mdpId: string;
  emptied: string[];
}

export interface LoadView {
  tote: ToteView;
  moved: string[];
}

export interface NewToteView {
  toteId: string;
  code: string;
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
}

export interface RatesView {
  benchmark?: Benchmark;
  pins: RatePin[];
  radiusKm?: number;
  /** The money every fee here is in — only hubs in this hub’s own money are set beside it. Absent: none are. */
  currency?: string;
}
