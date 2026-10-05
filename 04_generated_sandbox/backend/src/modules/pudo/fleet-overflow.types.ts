import { ApiProperty } from '@nestjs/swagger';

/* P4 — what offering or releasing a batch of orders answers with, and the event that tells the other fleet. */

export class HandOnRefused {
  freightId: string;
  why: string;
}

export class HandOnBatchResult {
  /** The orders it was done for, by code. */
  @ApiProperty({ type: [String] }) done: string[];
  /** The ones it could not be done for, each with why. */
  @ApiProperty({ type: [HandOnRefused] }) refused: HandOnRefused[];
  /** For an offer: the partner fleets it went to, by name. Empty for a release to the board. */
  @ApiProperty({ type: [String] }) to: string[];
}

/**
 * Published when orders move between a fleet and its partners.
 *
 * `offered` to its partners, as one batch · `withdrawn` the offer taken back · `taken` a partner took one · `ran_out`
 * the last partner left it · `handed_back` a partner that had taken it gave it back, with a reason.
 */
export interface OrderHandedOn {
  what: 'offered' | 'withdrawn' | 'taken' | 'ran_out' | 'handed_back';
  fromFleetDid: string;
  fromFleetName: string;
  /** The partners being told, for `offered` and `withdrawn`. */
  toFleetDids?: string[];
  /** The partner that acted, for `taken`, `ran_out` and `handed_back`. */
  partnerName?: string;
  count: number;
  weightKg: number;
  days: string[];
  /** The order's code, when it is one order. */
  code?: string;
  reason?: string;
}
