import { ApiPropertyOptional } from '@nestjs/swagger';
import { PAYOUT_WAYS, PayoutDestination, type PayoutWay } from './payout-ways';

/**
 * Paying providers — the other end of the money model, and the half that never existed.
 *
 * The books accrue what a sister owes a fleet, a courier or a hub, and until now nothing ever drew it
 * down: the payable grew forever. For an independent courier whose cash-flow horizon is measured in hours
 * that is not an accounting detail, it is whether the work was worth taking.
 *
 * TWO RULES SHAPE EVERYTHING HERE.
 *
 * MONEY LEAVES ONLY ON AN OBSERVED EXTERNAL EVENT. The mirror of the rule that money is only CREATED by
 * one. We do not get to decide that a payment happened; a rail does, with a reference we can point at
 * afterwards. So the books move on `settled` and on nothing else — requesting and submitting are promises,
 * and a promise is not a payment. A failure leaves the payable exactly where it was, which is correct: the
 * money is still owed.
 *
 * A PAYOUT HAS A LIFECYCLE. requested → submitted → settled, with failed as an ending from either and
 * reversed for the settled payment that bounces afterwards. Every step is stamped, because "when did we
 * pay you" is the first question anybody asks and an updated-at field cannot answer it.
 */
export type PayoutStatus = 'requested' | 'submitted' | 'settled' | 'failed' | 'reversed';

/** The statuses that mean money may still be on its way — one of these open bars a second payout. */
export const IN_FLIGHT: PayoutStatus[] = ['requested', 'submitted'];

export class Payout {
  payoutId: string;
  /** The sister that owes it. Its books are where the drawdown posts. */
  entityId: string;
  /** WHO IS PAID — the party the network contracts with: a fleet, a courier, a hub. Never a person who
   *  merely did the work; see DriverService.payeeOf. */
  payeeDid: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  /** How it is paid: the way of the paying sister's country (payout-ways.ts). Absent on payouts raised before there were ways. */
  @ApiPropertyOptional({ enum: PAYOUT_WAYS })
  way?: PayoutWay;
  /**
   * WHAT IS PAID: a provider's earnings (`payable.provider`), or what a person is owed back from a load to their door they
   * paid for first (`payable.person`, 2026-10-27). Absent on payouts raised before there were two: a provider's.
   */
  @ApiPropertyOptional({ enum: ['payable.provider', 'payable.person'] })
  owed?: 'payable.provider' | 'payable.person';
  /** Where it goes, where the way needs a number of the payee's: the masked number it was raised to, and which one. */
  @ApiPropertyOptional({ type: PayoutDestination })
  destination?: PayoutDestination;
  /**
   * The settlement day this covers, `YYYY-MM-DD`.
   *
   * The idempotency key, with the payee: a run that fires twice — a retry, two operators, a cron that
   * overlaps itself — must not pay the same day's work twice. Same-day settlement is a promise about
   * WHEN, so the day is the natural unit rather than a batch id nobody can reason about.
   */
  day: string;
  requestedAt: string;
  /** Who raised it, and who approved it to the rail: never the same person (the user, 2026-10-18). */
  requestedBy?: { name: string; key?: string };
  approvedBy?: { name: string; key?: string };
  submittedAt?: string;
  settledAt?: string;
  failedAt?: string;
  reversedAt?: string;
  /** The rail's own reference. The thing you quote when somebody says they were not paid. */
  providerRef?: string;
  /** Our id for the request to a live rail (M-Pesa's OriginatorConversationID): present once it was sent through one. */
  railRef?: string;
  /**
   * What the rail left unsaid: no answer we could read, a queue that timed out, a result we could not take at its word.
   * Said under the payout until it settles or fails.
   */
  railNote?: string;
  failureReason?: string;
  /** The journal entry that moved the money. Present ONLY once settled — before that nothing has moved. */
  entryId?: string;
  /** …and the entry that moved it back, if it bounced. */
  reversalEntryId?: string;
}

/** What a rail is asked to do. Deliberately tiny: everything else is our side of the boundary. */
export interface PayoutInstruction {
  payoutId: string;
  payeeDid: string;
  amount: number;
  currency: string;
  /** The payee's own number, whole, where the way pays to one — read at the moment it is sent, never kept on the payout. */
  msisdn?: string;
}

/**
 * What a rail says when it is handed a payout. Three answers, and only one is a refusal:
 *   taken      — it took the request; nothing has moved yet, its result settles or fails the payout;
 *   refused    — it turned the request down; nothing left, the payout fails;
 *   unknown    — no answer that can be read; it may have gone, so it stays in flight until the rail says.
 */
export type RailOutcome =
  | { taken: true; providerRef?: string; railRef?: string }
  | { taken: false; refused: string }
  | { taken: 'unknown'; railRef?: string; why: string };

/**
 * A payment rail.
 *
 * The seam every external dependency in this system sits behind — geocoding, routing, and now money out.
 * A real one is a mobile-money B2C call whose result arrives later on a callback; the sandbox one answers
 * immediately. Either way the ANSWER comes back through the same confirmation path, so nothing downstream
 * can tell the difference and nothing learns to trust a synchronous reply.
 */
export interface PayoutRail {
  /** Hand it over. Never a settlement: at most the rail's word that it took the request. A live rail answers later. */
  submit(instruction: PayoutInstruction): RailOutcome | Promise<RailOutcome>;
}

export const PAYOUT_RAIL = 'PAYOUT_RAIL';
