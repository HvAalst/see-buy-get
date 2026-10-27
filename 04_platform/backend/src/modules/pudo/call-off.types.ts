import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A STORE CALLS ONE OF ITS PARCELS OFF (the user, 2026-10-26 "Refund and take back"; 2026-10-27 "Comes back, store pays").
 * Before it has left the shop it was handed in at — or before it was handed in at all — it is withdrawn and the store's money
 * comes back in full. At a hub it is turned round there, to the shop it was handed in at, as a new parcel the store pays for:
 * what was carried is not given back, and the goods never sit nowhere. Anywhere else it cannot be called off.
 */
export const CALL_OFF_OUTCOMES = ['refund', 'bring_back', 'no'] as const;
export type CallOffOutcome = (typeof CALL_OFF_OUTCOMES)[number];

/** What calling it off would do now — said before the store asks, in the money it would be done in. */
export class CallOffView {
  parcelId!: string;
  /** `refund`: withdrawn, its price given back. `bring_back`: turned round at the hub, a new parcel the store pays for. `no`: it cannot be. */
  outcome!: CallOffOutcome;
  /** refund: what comes back to the store's balance (nothing for one never paid). bring_back: what bringing it back costs. */
  amount?: number;
  currency?: string;
  /** bring_back: the shop it comes back to — the one it was handed in at — and the hub it is turned round at. */
  backTo?: string;
  atHub?: string;
  /** no: why, in a sentence. */
  why?: string;
}

/** What calling it off did. */
export class CalledOffView {
  parcelId!: string;
  /** Voided (withdrawn) or Returned (on its way back as another parcel). */
  status!: string;
  outcome!: Exclude<CallOffOutcome, 'no'>;
  /** refund: what came back. bring_back: what bringing it back cost. */
  amount!: number;
  currency!: string;
  /** bring_back: the parcel bringing it back, the shop it comes back to and the hub it was turned round at. */
  returnParcelId?: string;
  backTo?: string;
  atHub?: string;
}

export class CallOffDto {
  /** Why, in the store's words — kept on the parcel's history. */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
