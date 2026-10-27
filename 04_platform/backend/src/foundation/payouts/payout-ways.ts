import { ApiProperty } from '@nestjs/swagger';

/**
 * HOW A COUNTRY'S PAYEES ARE PAID (the user, 2026-10-18: "payout differs per country turned on, remember that. M-Pesa
 * does not work in many nations, so for the countries where it does work; a number they set").
 *
 * One way per country, said here and nowhere else:
 *
 *   - `mpesa` — M-Pesa through Safaricom's Daraja API, to a number the payee set and confirmed itself. Daraja is Kenya's:
 *     M-Pesa elsewhere (Tanzania, the DRC, Mozambique, Ethiopia…) is another operator with another API, and is not
 *     "M-Pesa works there" for this code until somebody builds it.
 *   - `by_hand` — every other country: staff pay outside SeeBuyGet and record the reference, as the payout run always
 *     has. Said in those words on the console, so nobody mistakes it for a rail.
 */
export const PAYOUT_WAYS = ['mpesa', 'by_hand'] as const;
export type PayoutWay = (typeof PAYOUT_WAYS)[number];

const BY_COUNTRY: Readonly<Record<string, PayoutWay>> = { KE: 'mpesa' };

/** The way payees in this country are paid. */
export function payoutWayOf(country?: string): PayoutWay {
  return BY_COUNTRY[(country ?? '').toUpperCase()] ?? 'by_hand';
}

/**
 * WHERE A PAYOUT GOES, as the payee set it. `numberId` changes every time the number does: a payout raised to one
 * number is never sent to another. The number itself never leaves the payee's record — a payout keeps the mask.
 */
export class PayoutDestination {
  @ApiProperty() numberId: string;
  /** `254712***678`: enough to recognise your own. */
  @ApiProperty() masked: string;
}

/** Why a payee cannot be paid this way right now: no number yet, or one changed less than a day ago. */
export interface PayoutDestinationRefusal {
  reason: string;
}

/**
 * Told by whoever keeps payees' payout numbers (registered at boot, as the payee gate is): where this payee is paid
 * in a country of this way, or why not — or nothing, for a payee whose number it does not keep (a person owed back what
 * their load to their door did not use is paid to the number they paid from, kept beside that load: 2026-10-27).
 * `full` is asked only by the rail, at the moment it sends.
 */
export interface PayoutDestinations {
  of(payeeId: string, way: PayoutWay, now: number): PayoutDestination | PayoutDestinationRefusal | undefined;
  full(payeeId: string, numberId: string): string | undefined;
}

export function isRefusal(d: PayoutDestination | PayoutDestinationRefusal): d is PayoutDestinationRefusal {
  return 'reason' in d;
}
