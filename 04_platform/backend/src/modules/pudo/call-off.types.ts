import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * A STORE CALLS ONE OF ITS PARCELS OFF (the user, 2026-10-26 "Refund and take back"; 2026-10-27 "Comes back, store pays",
 * "let the store pick", "As a load to its door"). Before it has left the shop it was handed in at — or before it was handed in
 * at all — it is withdrawn and the store's money comes back in full. At a hub it is turned round there: to the shop it was
 * handed in at, as a new parcel the store pays for; or, not handed in at a shop, to where the store picks — a shop, or its own
 * door as a load. What was carried is not given back, and the goods never sit nowhere. Anywhere else it cannot be called off.
 */
export const CALL_OFF_OUTCOMES = ['refund', 'bring_back', 'pick', 'to_door', 'no'] as const;
export type CallOffOutcome = (typeof CALL_OFF_OUTCOMES)[number];

/** What calling it off would do now — said before the store asks, in the money it would be done in. */
export class CallOffView {
  parcelId!: string;
  /**
   * `refund`: withdrawn, its price given back. `bring_back`: turned round at the hub, a new parcel to a shop, at `amount`.
   * `pick`: not handed in at a shop — the store says where it comes back to (a shop, or `door`) and is told the price then.
   * `to_door`: to the store's own door as a load, at the driver's price, at most what the store allows. `no`: it cannot be.
   */
  outcome!: CallOffOutcome;
  /** refund: what comes back to the store's balance (nothing for one never paid). bring_back: what bringing it back costs. */
  amount?: number;
  currency?: string;
  /** bring_back: the shop it comes back to. to_door: the store's door. And the hub it is turned round at. */
  backTo?: string;
  atHub?: string;
  /** pick: the store's own door, where it has one on the map — a place it can come back to besides a shop. */
  door?: string;
  /** to_door: the most we suggest allowing a driver. A suggestion: each driver's own price decides, at most what is allowed. */
  suggestedMax?: number;
  /** no: why, in a sentence. */
  why?: string;
}

/** What calling it off did. */
export class CalledOffView {
  parcelId!: string;
  /** Voided (withdrawn) or Returned (on its way back as another parcel, or as a load to the store's door). */
  status!: string;
  outcome!: 'refund' | 'bring_back' | 'to_door';
  /** refund: what came back. bring_back: what bringing it back cost. to_door: the most the store allows a driver. */
  amount!: number;
  currency!: string;
  /** bring_back: the parcel bringing it back. to_door: the load bringing it to the store's door. */
  returnParcelId?: string;
  returnLoadId?: string;
  returnLoadCode?: string;
  backTo?: string;
  atHub?: string;
}

export class CallOffDto {
  /** Why, in the store's words — kept on the parcel's history. */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  /** Where it comes back to, for a parcel not handed in at a shop: a shop's id, or `door` — the store's own. */
  @IsOptional() @IsString() @MaxLength(120) backTo?: string;
  /** To its door: the most the store pays a driver for it. */
  @IsOptional() @IsNumber() @Min(0.01) maxSpend?: number;
}

/** The load bringing a parcel called off at a hub to its store's door, as the hub's counter reads it. */
export class HubHandoverLoad {
  freightId!: string;
  code!: string;
  status!: string;
  /** The driver who took it, once one has: the one the hub hands the box to, by their pass. */
  driverName?: string;
}

/** A box called off at this hub, waiting for the driver of the load that takes it to its store's door. */
export class HubHandoverView {
  parcelId!: string;
  size!: string;
  calledOffAt!: string;
  load!: HubHandoverLoad;
}

export class HandToDriverDto {
  /** The pass of the driver who took the load: scanned at the counter. */
  @IsString() @MaxLength(64) badge!: string;
}

export class RaiseMaxSpendDto {
  @IsNumber() @Min(0.01) maxSpend!: number;
}

/** The load's new most, as the store reads it. */
export class MaxSpendView {
  freightId!: string;
  code!: string;
  maxSpend!: number;
}
