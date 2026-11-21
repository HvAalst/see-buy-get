/**
 * 2026-11-21 — A PLATE CLAIMED BY WHOEVER BOUGHT THE VEHICLE (the owner: "add the check and consider that a vehicle may be sold
 * and no longer belongs to a driver as well"). A plate names one vehicle in use; somebody who bought one whose seller never took
 * it off asks that seller, who answers with one tap. Not answered in fourteen days, network staff decide.
 */

/** asked: waiting for its owner · sold: its owner took it off · kept: its owner says it is still theirs · lapsed: no answer, with
 *  staff · released: staff took it off · left: staff left it · freed: it came off another way (its owner, another claim). */
export type PlateClaimState = 'asked' | 'sold' | 'kept' | 'lapsed' | 'released' | 'left' | 'freed';

/** Who asks, or whose vehicle it is: a driver (by their own sign-in) or a fleet's office. */
export class PlateClaimParty {
  kind: 'driver' | 'fleet';
  did: string;
  name: string;
}

export class PlateClaim {
  claimId: string;
  plate: string;
  /** The vehicle that carried the plate when it was asked about. */
  vehicleId: string;
  vehicleClass: string;
  claimant: PlateClaimParty;
  /** Whose vehicle it is: absent where nobody can be asked (then staff look at it at once). */
  holder?: PlateClaimParty;
  /** In whose country it is looked at: the claimant's. */
  country?: string;
  askedAt: string;
  state: PlateClaimState;
  lapsedAt?: string;
  closedAt?: string;
  /** The member of staff who decided, and why — said to both. */
  decidedBy?: string;
  reason?: string;
}

/** One claim as a driver or a fleet reads it: never who owns a plate they asked about, only what happened. */
export class PlateClaimView {
  claimId: string;
  plate: string;
  vehicleClass: string;
  state: PlateClaimState;
  askedAt: string;
  closedAt?: string;
  /** Staff's words, where staff decided. */
  reason?: string;
  /** To the owner only: who says they bought it, by name — the seller knows whom they sold to. */
  askedBy?: string;
}

/** What a driver or a fleet's office reads: what is asked of them, and what they asked. */
export class PlateClaimsView {
  forMe: PlateClaimView[];
  asked: PlateClaimView[];
}

/** For staff: a claim nobody answered, with what tells whether the vehicle is still in use. */
export class LapsedPlateClaimView {
  claimId: string;
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  claimant: PlateClaimParty;
  holder?: PlateClaimParty;
  askedAt: string;
  lapsedAt: string;
  /** When a shift last ran on the vehicle: one since it was asked about says somebody still drives it. */
  lastShiftAt?: string;
}
