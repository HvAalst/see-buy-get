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
 * the last partner left it · `handed_back` a partner that had taken it gave it back, with a reason · `passed_on` an
 * order this fleet handed to a partner has been passed on to a fleet of the partner's own, which carries it · `lapsed`
 * a partner's offers to pass orders on were taken back because the fleet they came from no longer allows it.
 */
export interface OrderHandedOn {
  what: 'offered' | 'withdrawn' | 'taken' | 'ran_out' | 'handed_back' | 'passed_on' | 'lapsed';
  fromFleetDid: string;
  fromFleetName: string;
  /** The partners being told, for `offered` and `withdrawn`. */
  toFleetDids?: string[];
  /** The partner that acted, for `taken`, `ran_out` and `handed_back`; the fleet now carrying, for `passed_on`; the fleet that withdrew its leave, for `lapsed`. */
  partnerName?: string;
  /** For `passed_on`: the partner that passed it on. */
  viaName?: string;
  /** The news is about an order a partner was passing on, told to that partner — it cannot go to the open board from there. */
  onward?: boolean;
  count: number;
  weightKg: number;
  days: string[];
  /** The order's code, when it is one order. */
  code?: string;
  /** Which orders: what a fleet's own system is told about each, one by one (fleet-hooks.service.ts). */
  freightIds: string[];
  reason?: string;
}
