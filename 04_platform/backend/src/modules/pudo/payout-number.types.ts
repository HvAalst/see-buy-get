import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAYOUT_WAYS, type PayoutWay } from '../../foundation/payouts/payout-ways';

/**
 * A PAYEE'S OWN PAYOUT NUMBER (the user, 2026-10-18: "for the countries where it does work; a number they set").
 *
 * Where the payee's country pays by M-Pesa, money goes to a number the payee set and confirmed itself, with a code
 * texted to that number. A courier sets its own; a fleet's office sets the fleet's; a hub sets the hub's. Staff never
 * type one: money sent to a wrong number does not come back, and a number staff could change is one somebody could
 * talk them into changing.
 *
 * A CHANGE PAUSES PAYOUTS FOR A DAY, and the old number is texted that it was replaced. Somebody who took an account
 * and put their own number on it is then caught by the one person who would notice — before anything is paid to it.
 */
export const PAYOUT_NUMBER_HOLD_MS = 24 * 60 * 60 * 1000;

export type PayoutNumberAct = 'set' | 'changed';

export class PayoutNumberEvent {
  at: string;
  act: PayoutNumberAct;
  /** The number it was set to, masked. */
  masked: string;
  /** Who did it, by the name the account carries. */
  by: string;
}

export class PayoutNumberRecord {
  /** Who is paid: a courier's or a fleet's DID, or a hub's id — the counterparty the books owe. */
  payeeId: string;
  country: string;
  /** `2547XXXXXXXX` — as Daraja takes it. Never shown, never on a payout. */
  msisdn: string;
  /** Changes with every number: a payout raised to one is never sent to another. */
  numberId: string;
  confirmedAt: string;
  /** A changed number is not paid to before this. Absent on a first number. */
  heldUntil?: string;
  history: PayoutNumberEvent[];
}

/** What the payee's own Settings shows. */
export class PayoutNumberView {
  @ApiProperty({ enum: PAYOUT_WAYS, description: 'How payees in this country are paid.' }) way: PayoutWay;
  @ApiProperty() country: string;
  @ApiPropertyOptional({ description: 'Why this account has no payout number of its own (a fleet driver, a shop).' }) notPayee?: string;
  @ApiPropertyOptional() masked?: string;
  @ApiPropertyOptional() confirmedAt?: string;
  @ApiPropertyOptional({ description: 'Paused after a change: nothing is paid to it before this.' }) heldUntil?: string;
}

/** A code was texted to the new number. In a sandbox the code itself comes back, as every sandbox code does. */
export class PayoutCodeSent {
  @ApiProperty() sent: boolean;
  @ApiProperty() masked: string;
  @ApiProperty() minutes: number;
  @ApiPropertyOptional() code?: string;
}

/** The number was saved; whether the old one was told. */
export class PayoutNumberSaved extends PayoutNumberView {
  @ApiPropertyOptional({ enum: ['texted', 'kept', 'not_sent'], description: 'The old number, told it was replaced: texted · kept (a sandbox texts nobody) · not_sent.' })
  oldNumber?: 'texted' | 'kept' | 'not_sent';
}
