import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { customsUnionOf } from '../countries/customs-union';

/**
 * 2026-11-20 — THE PAYMENT HUB (the payments plan, step 4; the owner: "the system might have to ingest a variety of payment
 * API's … the best option would be a software that combines PSP's and becomes actually a payment hub"). One door for every
 * provider: money asked of a payer's phone, money sent to a payee's phone, money given back — each provider an adapter
 * behind it. The stand-in first, so the whole loop is tried with no partner and no real money; a real provider's adapter
 * (telebirr, M-PESA Ethiopia, Chapa…) comes when a chosen partner uses it, with its keys and the two-person switch to live.
 */
export const HUB_PROVIDERS = ['stand-in', 'telebirr', 'mpesa-et', 'chapa', 'revolut', 'mollie'] as const;
export type HubProviderId = (typeof HUB_PROVIDERS)[number];

/** 2026-11-25 (route plan part 4) — what a provider pays money out to: a phone, or a bank account. */
export const PROVIDER_PAYS_TO: Record<HubProviderId, 'phone' | 'bank'> = { 'stand-in': 'phone', telebirr: 'phone', 'mpesa-et': 'phone', chapa: 'phone', revolut: 'bank', mollie: 'bank' };

/**
 * 2026-11-26 — HOW A PROVIDER ASKS A PAYER FOR MONEY: a prompt rung on the payer's phone (mobile money, and the stand-in), or a page
 * the payer opens from a QR code on the counter's screen (Mollie) — where no phone number is asked at all.
 */
export const PROVIDER_ASKS_BY: Record<HubProviderId, 'phone' | 'qr'> = { 'stand-in': 'phone', telebirr: 'phone', 'mpesa-et': 'phone', chapa: 'phone', revolut: 'phone', mollie: 'qr' };

/**
 * 2026-11-26 — the provider the money a partner's counters take goes through, by the partner's country: its own Mollie account in the
 * European Union (Mollie takes businesses in every EEA country), once the partner has connected it. None elsewhere yet: the stand-in.
 */
export function collectProviderFor(country: string | undefined): HubProviderId | undefined {
  return customsUnionOf(country) === 'EU' ? 'mollie' : undefined;
}

/**
 * Where a partner pays a hand in this country: to its bank account in the European Union (a SEPA transfer, in euros: mobile money
 * is not how people there are paid), to its phone elsewhere. By the country alone — nobody chooses it (the owner: "the system will
 * choose the right method depending on the country without the user noticing it").
 */
export function payeeKindIn(country: string | undefined): 'phone' | 'bank' {
  return customsUnionOf(country) === 'EU' ? 'bank' : 'phone';
}

/**
 * The provider a partner's hands are paid through, by the partner's country: Revolut Business in the European Union (the owner:
 * "Provider we connect"; the partner's own account). None elsewhere until a partner's own is built (telebirr, M-PESA, Chapa):
 * there the stand-in pays, on test money.
 */
export function payoutProviderFor(country: string | undefined): HubProviderId | undefined {
  return payeeKindIn(country) === 'bank' ? 'revolut' : undefined;
}

/** A bank account a payout goes to, opened for the one call that sends it and never kept here. */
export interface PayeeAccount {
  /** The IBAN, as the bank writes it, no spaces. */
  account: string;
  /** The account holder's name, as the bank has it: the receiving bank checks it (Verification of Payee). */
  holder: string;
  bic?: string;
  /** A person (a courier) rather than a business (a shop, a hub, a fleet): their name goes as a first and a last name. */
  person?: boolean;
}

/** What a provider answers about one request: asked (waiting on the phone or the provider), paid, or failed and why. */
export interface ProviderAnswer {
  state: 'asked' | 'paid' | 'failed';
  /** The provider's own handle for the request: what its callback carries, and what its support desk is quoted. */
  providerRef?: string;
  /** Why it failed, in the provider's terms, for staff and the log — never shown to a payer as it came. */
  why?: string;
  /** 2026-11-26 — a payment page the payer opens (Mollie's checkout), while it can still be paid: shown as a QR code. */
  link?: string;
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
  /** The number the payment prompt goes to — none where the provider asks by a page (a QR code) instead. */
  payerPhone?: string;
  description: string;
}

export interface PayoutRequest {
  ourRef: string;
  amount: number;
  currency: string;
  /** The phone it goes to — or, with a provider that pays bank accounts, the account (`payeeAccount`). One of the two. */
  payeePhone?: string;
  payeeAccount?: PayeeAccount;
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
  /**
   * Where a request stands now, asked of the provider — by its handle, or by ours where its answer never came. A refund also names the
   * payment it gives back (`paidRef`): some providers find a refund only under it.
   */
  status(account: OpenedAccount, ref: { providerRef?: string; ourRef: string; paidRef?: string }, now?: number): Promise<ProviderAnswer>;
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
  /** The last three digits of the phone — or of the bank account paid to — so a counter can say which; the number itself is never kept here. */
  phoneEnds: string;
  /** The phone's hash: absent on a payout to a bank account. */
  phoneHash?: string;
  /** 4b — paid to a bank account rather than a phone. */
  toBank?: boolean;
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
  /** 2026-11-26 — asked by a page the payer opens from a QR code (Mollie): no phone was asked, and `phoneEnds` is empty. */
  byQr?: boolean;
  /** …and that page, while it can still be paid. */
  link?: string;
}

/** A company's settings in the hub: our fee on its payments (P4-c), set by our staff by name. */
export interface HubAccountRecord {
  ownerEntityId: string;
  feePct?: number;
  feeSetBy?: string;
  feeSetAt?: string;
  /**
   * 2026-11-25 (route plan part 4) — THE PARTNER'S OWN ACCOUNT FOR ITS PAYOUTS, at the provider its country uses: its key entered
   * by our staff by name, kept sealed, never shown or sent anywhere but that provider. A test key pays test money at once; a live
   * one pays real money only once a second member of staff switches it on — and a new key needs switching on again.
   */
  provider?: HubProviderId;
  keySealed?: string;
  /** The key's last four characters, so staff can tell which key is kept. */
  keyEnds?: string;
  keyTest?: boolean;
  keyBy?: string;
  /** Who entered it, as their sign-in knows them: the second person is never this one. */
  keyByKey?: string;
  keyAt?: string;
  liveBy?: string;
  liveAt?: string;
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
  @ApiProperty({ description: 'The last three digits of the phone, or of the bank account paid to.' }) phoneEnds: string;
  @ApiPropertyOptional({ description: 'Paid to a bank account rather than a phone.' }) toBank?: boolean;
  @ApiProperty({ enum: ['asked', 'paid', 'failed'] }) state: 'asked' | 'paid' | 'failed';
  @ApiPropertyOptional({ enum: HUB_WHY, description: 'Why it did not go. Absent where the provider gave a reason of its own.' }) why?: HubWhy;
  @ApiProperty() test: boolean;
  @ApiProperty() askedAt: string;
  @ApiPropertyOptional() settledAt?: string;
  @ApiPropertyOptional({ description: 'A try of the account: the member of staff who asked it.' }) askedBy?: string;
  @ApiPropertyOptional({ description: 'The parcel it paid for, once taken in.' }) usedFor?: string;
  @ApiPropertyOptional({ description: 'Our fee on it: the partner’s percentage, counted when it was paid.' }) fee?: number;
  @ApiPropertyOptional({ description: 'A refund: the payment it gives back.' }) refundOf?: string;
  @ApiPropertyOptional({ description: '2026-11-26 — asked by a page the payer opens from a QR code: no phone was asked.' }) byQr?: boolean;
  @ApiPropertyOptional({ description: '…that page, while it can still be paid.' }) link?: string;
  @ApiPropertyOptional({ description: '…and the same page as a QR code, an SVG image for the counter’s screen.' }) qrSvg?: string;
}

/** 2026-11-26 — the partner's own Mollie account, where its counters' payments go in its country: whether connected, and to what. */
export class CollectConnectionView {
  @ApiProperty() connected: boolean;
  @ApiPropertyOptional({ description: 'The Mollie organization it is connected to, by its name.' }) organizationName?: string;
  @ApiPropertyOptional() testmode?: boolean;
  @ApiPropertyOptional({ description: 'Mollie still checks the account: payments wait until it can take them.' }) canReceivePayments?: boolean;
  @ApiPropertyOptional({ description: 'Mollie took the access back: connected again in the Partner app.' }) lostAt?: string;
  @ApiPropertyOptional() connectedBy?: string;
  @ApiPropertyOptional() connectedAt?: string;
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
  @ApiPropertyOptional({ enum: HUB_PROVIDERS, description: 'Route plan part 4 — the provider the partner’s hands are paid through, chosen by its country. Absent where its country has none yet: the stand-in pays them, on test money.' }) payoutProvider?: HubProviderId;
  @ApiProperty({ enum: ['phone', 'bank'], description: 'Where its hands are paid: their phone, or their bank account (the European Union).' }) paysTo: 'phone' | 'bank';
  @ApiProperty({ description: 'The hands’ payouts are test money: no key, a test key, or a live key not switched on yet.' }) payoutTest: boolean;
  @ApiPropertyOptional({ description: 'What the payout account holds, where its provider says.' }) payoutBalance?: number;
  @ApiPropertyOptional({ description: 'The last four characters of the key kept. Absent until one is entered.' }) keyEnds?: string;
  @ApiPropertyOptional({ description: 'The key kept is a test key.' }) keyTest?: boolean;
  @ApiPropertyOptional({ description: 'Who entered the key, by name, and when.' }) keyBy?: string;
  @ApiPropertyOptional() keyAt?: string;
  @ApiPropertyOptional({ description: 'Who switched the live key on — never the person who entered it — and when.' }) liveBy?: string;
  @ApiPropertyOptional() liveAt?: string;
  @ApiPropertyOptional({ enum: HUB_PROVIDERS, description: '2026-11-26 — the provider the counters’ payments go through in the partner’s country, once connected (Mollie in the European Union). Absent where its country has none yet.' }) collectProvider?: HubProviderId;
  @ApiPropertyOptional({ type: CollectConnectionView }) collect?: CollectConnectionView;
}

/** Route plan part 4 — the partner's key at its payout provider, entered by our staff by name. */
export class PayoutKeyDto {
  @ApiProperty({ description: 'The key, as the provider shows it once when it is made. Kept sealed; never shown again.' })
  @IsString()
  @Matches(/^\S{16,400}$/, { message: 'Paste the whole key, with no spaces' })
  key: string;

  @ApiProperty({ description: 'A test (sandbox) key: tried at once, on test money. A live key pays real money only once a second member of staff switches it on.' })
  @IsBoolean()
  test: boolean;
}

/** 4e — what came in, went back and went out of the account, paid. */
export class PaymentTotalsView {
  @ApiProperty({ description: 'Senders’ payments, paid: never a try by our staff.' }) paidIn: number;
  @ApiProperty() givenBack: number;
  @ApiProperty() paidOut: number;
}

/** A partner's payment account, as our staff read it: the account, and its payments, newest first. */
export class PaymentAccountRead {
  @ApiProperty({ type: PaymentAccountView }) account: PaymentAccountView;
  @ApiProperty({ type: PaymentTotalsView }) totals: PaymentTotalsView;
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

  @ApiPropertyOptional({ description: 'The phone the prompt goes to, with its country code. None where the sender pays from a QR code on the counter’s screen (2026-11-26).' })
  @IsOptional()
  @IsString()
  @Matches(/^\+\d{9,15}$/, { message: 'Give the whole phone number with its country code, starting with +' })
  phone?: string;
}
