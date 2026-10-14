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
  /**
   * The settlement day this covers, `YYYY-MM-DD`.
   *
   * The idempotency key, with the payee: a run that fires twice — a retry, two operators, a cron that
   * overlaps itself — must not pay the same day's work twice. Same-day settlement is a promise about
   * WHEN, so the day is the natural unit rather than a batch id nobody can reason about.
   */
  day: string;
  requestedAt: string;
  submittedAt?: string;
  settledAt?: string;
  failedAt?: string;
  reversedAt?: string;
  /** The rail's own reference. The thing you quote when somebody says they were not paid. */
  providerRef?: string;
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
}

/**
 * A payment rail.
 *
 * The seam every external dependency in this system sits behind — geocoding, routing, and now money out.
 * A real one is a mobile-money B2C call whose result arrives later on a callback; the sandbox one answers
 * immediately. Either way the ANSWER comes back through the same confirmation path, so nothing downstream
 * can tell the difference and nothing learns to trust a synchronous reply.
 */
export interface PayoutRail {
  /** Hand it over. Returns the provider's reference for the attempt, never a settlement. */
  submit(instruction: PayoutInstruction): { providerRef: string };
}

export const PAYOUT_RAIL = 'PAYOUT_RAIL';
