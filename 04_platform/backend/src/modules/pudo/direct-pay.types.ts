import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MollieVia } from '../../foundation/mollie/mollie.types';

/** Mollie's statuses; paid, canceled, expired and failed are final. */
export type DirectPayStatus = 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed';
export const DIRECT_PAY_FINAL: readonly DirectPayStatus[] = ['paid', 'canceled', 'expired', 'failed'];

/**
 * 2026-11-19 — A PAYMENT AT THE HANDOVER, MADE ON THE CARRIER'S OWN MOLLIE ACCOUNT (the payments plan, part 2b). Kept here so
 * Mollie's notice can be matched to its load, and so the page the payer comes back to can say how it went: by our own
 * random reference, never the load's code.
 */
export interface DirectPayment {
  /** Mollie's id for it (tr_…). */
  paymentId: string;
  /** Ours, random: in the address the payer comes back to after paying. */
  ref: string;
  freightId: string;
  code: string;
  /** Whose Mollie account it was made on: the courier's, or its fleet's. */
  payeeId: string;
  via: MollieVia;
  testmode: boolean;
  amount: number;
  currency: string;
  /** Our fee for server costs, taken by Mollie from the payment (the owner's P2-a), where one was set. */
  fee?: number;
  status: DirectPayStatus;
  checkoutUrl?: string;
  createdAt: string;
  expiresAt?: string;
  paidAt?: string;
  /** When Mollie was last asked about it. */
  checkedAt?: string;
  askedBy: string;
}

export class DirectPayPaymentView {
  @ApiProperty() paymentId: string;
  @ApiProperty({ enum: ['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed'] }) status: DirectPayStatus;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiPropertyOptional() fee?: number;
  /** Test money only: our test key, or the Connect app before the owner says live. */
  @ApiProperty() testmode: boolean;
  /** Mollie's own payment page — what the QR code opens. Only while it can still be paid. */
  @ApiPropertyOptional() checkoutUrl?: string;
  /** The QR code of that page, drawn here: shown on the driver's phone for the payer to scan. */
  @ApiPropertyOptional() qrSvg?: string;
  @ApiPropertyOptional() expiresAt?: string;
  @ApiPropertyOptional() paidAt?: string;
}

/**
 * Whether the payer can pay this load by Mollie now, and if not why, as a short code the app says in words:
 * `not_direct` SeeBuyGet pays the carrier · `paid` it is paid already · `no_price` no price agreed · `not_mollie` not where
 * Mollie is used, or not set up · `not_eur` not in euros · `not_connected` the carrier has not connected Mollie ·
 * `office_connects` the fleet is paid, and its office has not connected Mollie.
 */
export class DirectPayView {
  @ApiProperty() available: boolean;
  @ApiPropertyOptional({ enum: ['not_direct', 'paid', 'no_price', 'not_mollie', 'not_eur', 'not_connected', 'office_connects'] }) why?: 'not_direct' | 'paid' | 'no_price' | 'not_mollie' | 'not_eur' | 'not_connected' | 'office_connects';
  @ApiPropertyOptional() amount?: number;
  @ApiPropertyOptional() currency?: string;
  /** Our fee Mollie would take from it, said before the payment is asked for. */
  @ApiPropertyOptional() fee?: number;
  @ApiPropertyOptional() testmode?: boolean;
  /** The latest payment asked for on this load. */
  @ApiPropertyOptional({ type: DirectPayPaymentView }) payment?: DirectPayPaymentView;
}
