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
  /** 2026-11-11 — down, as the hub or staff said (ISO 28000 gap 12): nothing is sent to it until it opens again. */
  down?: { since: string; until?: string; reason: string; note?: string; by: string; byRole: 'hub' | 'staff'; confirmedAt?: string; collectable?: { since: string; by: string; byRole: 'hub' | 'staff' } };
  did: string;
  name: string;
  zones: string[];
  /** 2026-11-08 — the zone its pin lies in, on its country's map in force; absent where the country keeps none yet. */
  priceZone?: { code: string; name: string; group: string; groupName: string; version: number };
  /** 2026-11-09 — the GS1 location number SeeBuyGet gave this hub, under its own prefix; absent until given. */
  gln?: string;
  location?: { lat: number; lng: number };
  pricePerParcel: number;
  /** 2026-11-12 — what a whole bag passed on unopened pays it (its own fee, else its country's list figure). */
  passOnFee?: number;
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
  /** 2026-11-02 — how many bags its floor holds at once, and how many parcels it sorts a day: its owner's word. */
  bagPlaces?: number;
  sortPerDay?: number;
  /** Merged in by the controller for the hub itself: what its floor holds now, against that. */
  space?: HubSpaceView;
}

/**
 * 2026-11-02 — WHAT A HUB'S FLOOR HOLDS NOW, against what its owner said (backend pudo.types.ts HubSpaceView; the owner:
 * "shouldn't a hub also declare its space?"). A hub that has not said is never full, and is asked.
 */
export interface HubSpaceView {
  mdpId: string;
  name: string;
  declared: boolean;
  bagPlaces?: number;
  sortPerDay?: number;
  saidAt?: string;
  /** Bags emptied here whose parcels are not all sorted yet. */
  inbound: number;
  /** Bags being filled, waiting for a driver, or claimed. A flat empty bag takes no place. */
  outbound: number;
  onFloor: number;
  free?: number;
  /** Bags past its places: taken all the same. */
  overBy?: number;
  /** Bags on their way to it. */
  comingIn: number;
  /** Bags elsewhere held for room here. */
  waiting: number;
  sortedToday: number;
  day: string;
  floorFull: boolean;
  dayFull: boolean;
  noRoom: boolean;
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
  /** 2026-11-02 — held here for room at the hub it goes to; it goes on by itself. */
  waitsForRoom?: { hubId: string; hubName: string; since: string };
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
  /** 2026-10-27 — called off here by its store: the box it is, under its old label. Its new label goes over that one. */
  returnOf?: { parcelId: string; atMdpId: string; at: string };
  /** 2026-11-06 — against the time it was promised, while on its way under a plan: late, or on time. */
  due?: 'late' | 'on_time';
}

/** A box called off here, going to its store's door as a load: kept aside for that load's driver (2026-10-27). */
export interface HubHandover {
  parcelId: string;
  size: string;
  calledOffAt: string;
  load: { freightId: string; code: string; status: string; driverName?: string };
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
  /** 2026-11-09 — for this hub's own counter: put on its shelf by hand, in this slot; no bag (toteCode empty). */
  counterSlot?: string;
}

/** 2026-11-09 — what a hub does (backend HubCounterView): sort only, or sort and hand out at its counter. */
export interface HubCounterView {
  mdpId: string;
  mode: 'sort' | 'sort_and_hand_out';
  hoursSet: boolean;
  counter?: { did: string; shopName: string; open: boolean; pricePerParcel: number; currency: string; rows: number; cols: number; status: string; signIn?: string };
}

export interface DropView {
  mdpId: string;
  emptied: string[];
  /** 2026-11-06 — those its plan did not have coming here, nobody having said why: the stop each was planned to go to. */
  offPlan?: Array<{ parcelId: string; planned: string }>;
  /** 2026-11-12 — a whole bag for a hub further on: received on its seal, not opened, on its way again. */
  passedOn?: { code: string; next: string; final: string };
}

export interface LoadView {
  tote: ToteView;
  moved: string[];
}

/** 2026-11-09 — a zone, as the hub reads it on its own screen (backend HubZoneLine). */
export interface HubZoneLine {
  code: string;
  name: string;
  km?: number;
  how?: 'stands' | 'added' | 'hub' | 'proposed' | 'inherited';
}
/** 2026-11-09 — what a hub serves (backend HubZonesView): absent mapVersion where its country keeps no zones yet. */
export interface HubZonesView {
  mdpId: string;
  mapVersion?: number;
  standsIn?: HubZoneLine;
  serves: HubZoneLine[];
  taken: HubZoneLine[];
  nearby: HubZoneLine[];
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
