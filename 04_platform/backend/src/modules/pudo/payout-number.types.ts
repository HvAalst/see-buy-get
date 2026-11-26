import { CODE_WAYS, CodeWay } from '../../foundation/sms/code-routes.types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PAYOUT_WAYS, type PayoutWay } from '../../foundation/payouts/payout-ways';

/**
 * 2026-11-20 — how a payee's own number is used: M-Pesa where we pay (Kenya), by hand elsewhere — and, in a country where a
 * partner contracts and pays (Partnered), the partner pays every hand to the number it set (the payments plan, 4c).
 */
export const NUMBER_WAYS = [...PAYOUT_WAYS, 'partner'] as const;
export type NumberWay = (typeof NUMBER_WAYS)[number];

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
  @ApiProperty({ enum: NUMBER_WAYS, description: 'How payees in this country are paid: by M-Pesa, by hand, or by the partner to this number.' }) way: NumberWay;
  @ApiPropertyOptional({ description: 'Who pays to this number, where a partner does: its name.' }) paidBy?: string;
  @ApiPropertyOptional({ enum: ['phone', 'bank'], description: 'Route plan part 4 — where the partner pays: a phone number, or a bank account (the European Union). Absent where no partner pays.' }) paysTo?: 'phone' | 'bank';
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
  /** 2026-11-16 — the way the code went: by text, or the app the payee chose. */
  @ApiPropertyOptional({ enum: CODE_WAYS }) via?: CodeWay;
}

/** The number was saved; whether the old one was told. */
export class PayoutNumberSaved extends PayoutNumberView {
  @ApiPropertyOptional({ enum: ['texted', 'kept', 'not_sent'], description: 'The old number, told it was replaced: texted · kept (a sandbox texts nobody) · not_sent.' })
  oldNumber?: 'texted' | 'kept' | 'not_sent';
}

/**
 * 2026-11-25 (route plan part 4) — A PAYEE'S OWN BANK ACCOUNT, where its partner pays to bank accounts (the European Union: the
 * owner, "the system will choose the right method depending on the country"). Set by the payee itself, signed in — never by
 * staff; the account, its holder's name and its BIC kept encrypted together, opened only by the payout that sends to it; shown
 * by its country and last four characters. A change pauses payouts for a day, as a changed number does, and the partner's money
 * checks flag a payout to an account changed in the last days.
 */
export class PayoutBankRecord {
  payeeId: string;
  country: string;
  /** The account, holder and BIC, encrypted ('enc:…'): never shown, never on a payout record. */
  sealed: string;
  /** Its country and last four characters, as screens show it. */
  masked: string;
  /** Changes with every account: a payout raised to one is never sent to another. */
  bankId: string;
  confirmedAt: string;
  heldUntil?: string;
  history: PayoutNumberEvent[];
}

/** A payee's bank account, as it types it in its own Settings. */
export class PayoutBankDto {
  @ApiProperty({ description: 'The IBAN, as the bank writes it; spaces are fine.', example: 'BG80 BNBG 9661 1020 3456 78' })
  @IsString()
  @MaxLength(42)
  account: string;

  @ApiProperty({ description: 'The account holder’s name, exactly as the bank has it: the receiving bank checks it.' })
  @IsString()
  @Length(2, 70)
  holder: string;

  @ApiPropertyOptional({ description: 'The bank’s BIC, where the bank gives one. Not needed for a transfer in euros within SEPA.' })
  @IsOptional()
  @IsString()
  @MaxLength(14)
  bic?: string;

  /** 2026-11-26 — the PIN of the person signed in (the Driver and Fleet apps), asked again before the account is kept. */
  @ApiPropertyOptional({ description: 'The PIN of the person signed in (the Driver and Fleet apps): asked again before the account is kept.' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  pin?: string;

  /** …or the password of the shop or hub signed in (the Shop and Hub apps), in its place. */
  @ApiPropertyOptional({ description: 'The password of the shop or hub signed in (the Shop and Hub apps), in place of a PIN.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
