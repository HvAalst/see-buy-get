import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * 2026-11-20 — THE PAYMENT HUB (the payments plan, step 4; the owner: "the system might have to ingest a variety of payment
 * API's … the best option would be a software that combines PSP's and becomes actually a payment hub"). One door for every
 * provider: money asked of a payer's phone, money sent to a payee's phone, money given back — each provider an adapter
 * behind it. The stand-in first, so the whole loop is tried with no partner and no real money; a real provider's adapter
 * (telebirr, M-PESA Ethiopia, Chapa…) comes when a chosen partner uses it, with its keys and the two-person switch to live.
 */
export const HUB_PROVIDERS = ['stand-in', 'telebirr', 'mpesa-et', 'chapa'] as const;
export type HubProviderId = (typeof HUB_PROVIDERS)[number];

/** What a provider answers about one request: asked (waiting on the phone or the provider), paid, or failed and why. */
export interface ProviderAnswer {
  state: 'asked' | 'paid' | 'failed';
  /** The provider's own handle for the request: what its callback carries, and what its support desk is quoted. */
  providerRef?: string;
  /** Why it failed, in the provider's terms, for staff and the log — never shown to a payer as it came. */
  why?: string;
}

/** An account the hub drives, its keys opened for this one call and never kept open. */
export interface OpenedAccount {
  accountId: string;
  currency: string;
  keys: Record<string, string>;
  /** True on a real provider's live keys; the stand-in never is. */
  live: boolean;
}

export interface CollectRequest {
  /** Our own reference for this one request — what a provider is asked by when its answer was lost on the way. */
  ourRef: string;
  amount: number;
  currency: string;
  /** The number the payment prompt goes to. */
  payerPhone: string;
  description: string;
}

export interface PayoutRequest {
  ourRef: string;
  amount: number;
  currency: string;
  payeePhone: string;
  description: string;
}

export interface RefundRequest {
  ourRef: string;
  amount: number;
  currency: string;
  description: string;
  /** The provider's own handle for the payment given back. */
  paidRef: string;
}

/** A provider behind the hub. Every answer about money comes from it — never from a screen, never assumed. */
export interface HubProvider {
  readonly id: HubProviderId;
  /** Ask the payer's phone for the money: a payment prompt. */
  collect(account: OpenedAccount, req: CollectRequest, now?: number): Promise<ProviderAnswer>;
  /** Where a request stands now, asked of the provider — by its handle, or by ours where its answer never came. */
  status(account: OpenedAccount, ref: { providerRef?: string; ourRef: string }, now?: number): Promise<ProviderAnswer>;
  /** Send money from the account to a phone. */
  payout(account: OpenedAccount, req: PayoutRequest, now?: number): Promise<ProviderAnswer>;
  /** Give a payment back to the phone it came from — named by the provider's own handle for it, never by a number. */
  refund(account: OpenedAccount, req: RefundRequest, now?: number): Promise<ProviderAnswer>;
  /** What the account holds, where the provider says. */
  balance(account: OpenedAccount, now?: number): Promise<{ amount: number; currency: string } | undefined>;
}

/** One movement of money through the hub, kept: in from a payer, out to a payee, or back to a payer. */
export interface HubPayment {
  paymentId: string;
  kind: 'in' | 'out' | 'refund';
  /** Whose account: a partner company. */
  ownerEntityId: string;
  provider: HubProviderId;
  /** What it is for: a parcel, a payout, a refund — or a try of the account by our staff. */
  reference: string;
  amount: number;
  currency: string;
  /** The last three digits of the phone, so a counter can say which phone; the number itself is never kept here. */
  phoneEnds: string;
  phoneHash: string;
  state: 'asked' | 'paid' | 'failed';
  providerRef?: string;
  why?: string;
  /** Test money: the stand-in, or a provider's test keys. */
  test: boolean;
  askedAt: string;
  settledAt?: string;
  /** A try asked by our staff: who, by name. */
  askedBy?: string;
  /** The counter that asked it: a shop's id. Only that counter reads it, and only for its own take-in. */
  siteId?: string;
  /** The parcel it paid for, once taken in: one payment, one parcel. */
  usedFor?: string;
  /** Our fee on it (P4-c): the partner's percentage of the payment, counted when it is paid. Owed by the partner. */
  fee?: { pct: number; amount: number };
  /** A refund: the payment it gives back. */
  refundOf?: string;
}

/** A company's settings in the hub: our fee on its payments (P4-c), set by our staff by name. */
export interface HubAccountRecord {
  ownerEntityId: string;
  feePct?: number;
  feeSetBy?: string;
  feeSetAt?: string;
}

/** Why a payment did not go, in a word each screen says in its own language. */
export const HUB_WHY = ['declined', 'expired', 'unreachable', 'insufficient'] as const;
export type HubWhy = (typeof HUB_WHY)[number];

export class HubPaymentView {
  @ApiProperty() paymentId: string;
  @ApiProperty({ enum: ['in', 'out', 'refund'] }) kind: 'in' | 'out' | 'refund';
  @ApiProperty() reference: string;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty({ description: 'The last three digits of the phone.' }) phoneEnds: string;
  @ApiProperty({ enum: ['asked', 'paid', 'failed'] }) state: 'asked' | 'paid' | 'failed';
  @ApiPropertyOptional({ enum: HUB_WHY, description: 'Why it did not go. Absent where the provider gave a reason of its own.' }) why?: HubWhy;
  @ApiProperty() test: boolean;
  @ApiProperty() askedAt: string;
  @ApiPropertyOptional() settledAt?: string;
  @ApiPropertyOptional({ description: 'A try of the account: the member of staff who asked it.' }) askedBy?: string;
  @ApiPropertyOptional({ description: 'The parcel it paid for, once taken in.' }) usedFor?: string;
  @ApiPropertyOptional({ description: 'Our fee on it: the partner’s percentage, counted when it was paid.' }) fee?: number;
  @ApiPropertyOptional({ description: 'A refund: the payment it gives back.' }) refundOf?: string;
}

export class PaymentAccountView {
  @ApiProperty({ enum: HUB_PROVIDERS }) provider: HubProviderId;
  @ApiProperty({ description: 'Test money only: the stand-in, until the partner’s own provider is set and switched live.' }) test: boolean;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: HUB_PROVIDERS, isArray: true, description: 'The providers whose adapter is ready.' }) ready: HubProviderId[];
  @ApiPropertyOptional({ description: 'What the account holds, where the provider says. Absent when it did not answer.' }) balance?: number;
  @ApiPropertyOptional({ description: 'Our fee, a percentage of every payment into the account (P4-c). Absent until set.' }) feePct?: number;
  @ApiPropertyOptional({ description: 'Who set the fee, by name, and when.' }) feeSetBy?: string;
  @ApiPropertyOptional() feeSetAt?: string;
  @ApiProperty({ description: 'Our fee counted so far on payments kept, less any given back: owed by the partner, as a loan until a company of ours can invoice it.' }) feeOwed: number;
}

/** A partner's payment account, as our staff read it: the account, and its payments, newest first. */
export class PaymentAccountRead {
  @ApiProperty({ type: PaymentAccountView }) account: PaymentAccountView;
  @ApiProperty({ type: [HubPaymentView] }) payments: HubPaymentView[];
}

/** A try of the account by our staff: a payment prompt to a phone, for an amount. */
export class TryPaymentDto {
  @ApiProperty({ description: 'The phone the prompt goes to, with its country code (+251…).', example: '+251911000123' })
  @IsString()
  @Matches(/^\+\d{9,15}$/, { message: 'Give the whole phone number with its country code, starting with +' })
  phone: string;

  @ApiProperty({ description: 'How much, in the account’s money.', example: 250 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100_000)
  amount: number;
}

/** Our fee on a partner's payments (P4-c): a percentage of each, set by our staff. */
export class PartnerFeeDto {
  @ApiProperty({ description: 'The percentage of every payment into the partner’s account, from 0 to 50.', example: 3 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  pct: number;
}

/** A payment prompt asked by a counter for a walk-up it is taking in (4b): the parcel's number and the payer's phone. */
export class PhonePaymentDto {
  @ApiPropertyOptional({ description: 'The shop asking; taken from the sign-in for a shop.' })
  @IsOptional()
  @IsString()
  agentDid?: string;

  @ApiProperty({ description: 'The number on the parcel’s sticker.' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{3,40}$/)
  parcelId: string;

  @ApiProperty({ description: 'The phone the prompt goes to, with its country code.' })
  @IsString()
  @Matches(/^\+\d{9,15}$/, { message: 'Give the whole phone number with its country code, starting with +' })
  phone: string;
}
