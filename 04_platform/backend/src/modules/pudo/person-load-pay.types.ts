import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * 2026-11-13 — A PERSON PAYS FOR THEIR LOAD, HELD UNTIL DELIVERY (unusual loads, part 3b; the owner: "It should normally be kept in
 * escrow until delivery is accomplished" — "go ahead"). Where a company of ours takes the money, a person accepting a driver's
 * price pays that company by mobile money; the money is held for that one load. Paid within the time, the load is the driver's;
 * the driver is paid only after it is delivered with the code the person gave whoever receives it. Unpaid, the prices open again;
 * handed back, or not delivered, it all goes back to the number it came from.
 */
export const LOAD_PAYMENT_STATES = ['awaiting', 'paid', 'lapsed', 'refunded', 'delivered', 'reversed'] as const;
export type LoadPaymentState = (typeof LOAD_PAYMENT_STATES)[number];

/** The record, kept here — never on the load, which every driver on the board reads. */
export interface LoadPayment {
  payId: string;
  freightId: string;
  loadCode: string;
  proposalId: string;
  personDid: string;
  entityId: string;
  currency: string;
  /** The driver's price agreed (their earning) — and what the person pays, all in. */
  price: number;
  amount: number;
  /** The number M-Pesa rings; none where the payment hub's rail for this money needs none (Mollie's page, 2026-11-24). */
  phone?: string;
  phoneMasked?: string;
  fundingId?: string;
  /** 2026-11-24 — the page the person pays on, where the rail has one (iDEAL through Mollie). */
  link?: string;
  reference?: string;
  instructions?: string;
  pushed?: boolean;
  openedAt: string;
  until: string;
  state: LoadPaymentState;
  paid?: number;
  billed?: number;
  owedBack?: number;
  why?: string;
}

/** What the person reads of their payment. Their number only masked. */
export class LoadPaymentView {
  @ApiProperty({ enum: LOAD_PAYMENT_STATES }) state: LoadPaymentState;
  amount: number;
  currency: string;
  /** The driver's price the person accepted. */
  price: number;
  until: string;
  @ApiPropertyOptional() phoneMasked?: string;
  /** 2026-11-24 — the page to pay on, where the payment hub's rail for this country has one: the app opens it. */
  @ApiPropertyOptional() link?: string;
  @ApiPropertyOptional() instructions?: string;
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional() pushed?: boolean;
  @ApiPropertyOptional() owedBack?: number;
  @ApiPropertyOptional() why?: string;
}

export class LoadPayDto {
  @IsString() @Length(4, 40) proposalId!: string;
  /** The number M-Pesa asks to pay from — where the payment hub's rail for this country rings one (2026-11-24). */
  @IsOptional() @IsString() @Length(7, 20) phone?: string;
}
