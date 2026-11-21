/**
 * 2026-11-21 — A SEND-APP BOOKING PAID ONLINE WHEN BOOKED (the payments plan, step 5; P5-a "netherlands first", P5-b "it stays
 * optional"). By iDEAL through Mollie into our own company's account; the label appears once Mollie confirms it.
 */
export type BookingPayStatus = 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed';
export const BOOKING_PAY_FINAL: readonly BookingPayStatus[] = ['paid', 'canceled', 'expired', 'failed'];

/** Why a booking cannot be paid online now. */
export type BookingPayWhyNot = 'not_booking' | 'paid' | 'handed_in' | 'not_here' | 'not_eur' | 'no_account';

export class BookingPayment {
  paymentId: string;
  parcelId: string;
  /** The sender whose money it is until the parcel is handed in. */
  personDid: string;
  /** The company of ours whose account it was paid into. */
  entityId: string;
  amount: number;
  currency: string;
  testmode: boolean;
  status: BookingPayStatus;
  checkoutUrl?: string;
  createdAt: string;
  expiresAt?: string;
  checkedAt?: string;
  paidAt?: string;
  /** Paid, but the booking could no longer take it (handed in for cash meanwhile, or ended): it is owed back. */
  unapplied?: string;
}

/** What the Send app shows for one booking: whether it can be paid online now, and the latest payment. */
export class BookingPayView {
  offered: boolean;
  why?: BookingPayWhyNot;
  amount?: number;
  currency?: string;
  testmode?: boolean;
  /** The latest payment asked for: where it stands, and where to pay while it is open. */
  status?: BookingPayStatus;
  checkoutUrl?: string;
  paidAt?: string;
}
