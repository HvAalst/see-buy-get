import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 2026-11-19 — MOLLIE: A PAYMENT STRAIGHT TO THE CARRIER, WATCHED (the payments plan, part 2; the owner: "Netherlands:
 * Mollie"). On a load the shipper pays directly, the carrier connects its own Mollie account; at the handover SeeBuyGet
 * makes the payment on that account, and Mollie says when it is paid. The money goes into the carrier's balance and never
 * through ours — except the small fee for server costs the owner chose, which Mollie moves to our balance (L60, answered).
 */

/**
 * What the Connect app asks of a carrier's Mollie account: make payments into it and read them, read its profiles (one is
 * named on each payment), whether it can take payments yet, and the company's own details, for the fee invoices.
 */
export const MOLLIE_SCOPES = ['payments.read', 'payments.write', 'profiles.read', 'onboarding.read', 'organizations.read'] as const;

/** How a payment straight to the carrier is watched, one way per country: Mollie in the Netherlands (the owner's D2). */
export type DirectPayWay = 'mollie';
const BY_COUNTRY: Readonly<Record<string, DirectPayWay>> = { NL: 'mollie' };

export function directPayWayOf(country?: string): DirectPayWay | undefined {
  return BY_COUNTRY[(country ?? '').trim().toUpperCase()];
}

export interface MollieConfig {
  /**
   * 2026-11-21 — OUR OWN COMPANY'S MOLLIE ACCOUNT, by its API key (the payments plan, 5a: a sender pays us when booking).
   * `live_…` or `test_…`, set by the owner in the server's settings (GLOS_MOLLIE_API_KEY); a live key is never taken in a sandbox.
   * Absent, the test key stands in, for test money only.
   */
  ownKey?: string;
  /** The Connect app (app_…): a carrier connects its own Mollie account through it. Set by the owner, in the server's settings. */
  clientId?: string;
  clientSecret?: string;
  /**
   * A plain test key of our own (test_…), for trying a handover before the Connect app exists: payments go to SeeBuyGet's
   * own test account, in test money. Never a live key — one is not taken.
   */
  testKey?: string;
  /** Payments through the Connect app are test payments until the owner says live. */
  testmode: boolean;
  /** The site's address: where Mollie sends the carrier back after connecting, and posts payment updates. */
  publicBase?: string;
  /** A stand-in for Mollie on a laptop or in a test. Never taken outside a sandbox. */
  host?: string;
}

/** How a carrier is connected: its own account through the Connect app, or our test key (test money only). */
export type MollieVia = 'oauth' | 'test_key';

export interface MollieTokens {
  accessToken: string;
  /** Mollie's refresh token does not expire; a refresh may hand back a new one, and then that one is kept. */
  refreshToken?: string;
  /** Seconds. An access token lasts an hour. */
  expiresIn: number;
  scope?: string;
}

export interface MollieAddress {
  streetAndNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

/** The carrier's company as Mollie knows it: what a fee invoice is made out to. */
export interface MollieOrganization {
  id: string;
  name: string;
  registrationNumber?: string;
  vatNumber?: string;
  address?: MollieAddress;
}

export type MollieOnboarding = 'needs-data' | 'in-review' | 'completed';

export interface MollieConnection {
  payeeId: string;
  via: MollieVia;
  organization?: MollieOrganization;
  /** The profile (pfl_…) every payment names: with the Connect app, Mollie asks which of the account's profiles takes it. */
  profileId?: string;
  profileName?: string;
  /** Sealed under the vault key, like every other secret this server must read back. */
  accessToken?: string;
  refreshToken?: string;
  accessExpiresAt?: string;
  scope?: string;
  /** Payments on this connection are test payments: our test key, or the Connect app before the owner says live. */
  testmode: boolean;
  connectedAt: string;
  /** Who connected it: the courier, or the fleet's office. */
  connectedBy: string;
  /** The carrier took the app's access away on Mollie's side (a refresh was refused): it is connected again from Settings. */
  lostAt?: string;
  /** What Mollie last said of the account: whether it can take payments yet, and where its owner finishes Mollie's checks. */
  canReceivePayments?: boolean;
  onboarding?: MollieOnboarding;
  dashboardUrl?: string;
  checkedAt?: string;
}

/** The payee asking: a courier is paid itself, a fleet driver is not (its fleet is), a fleet's office stands for its fleet. */
export type MolliePayee = { payeeId: string; country: string; by: string; back: 'driver' | 'fleet' } | { notPayee: string; country: string };

export class MollieConnectedView {
  @ApiProperty({ enum: ['oauth', 'test_key'] }) via: MollieVia;
  @ApiPropertyOptional() organizationName?: string;
  @ApiPropertyOptional() profileName?: string;
  /** Test payments only: our test key, or the Connect app before the owner says live. */
  @ApiProperty() testmode: boolean;
  @ApiProperty() connectedAt: string;
  @ApiPropertyOptional() lostAt?: string;
  @ApiPropertyOptional() canReceivePayments?: boolean;
  @ApiPropertyOptional({ enum: ['needs-data', 'in-review', 'completed'] }) onboarding?: MollieOnboarding;
  @ApiPropertyOptional() dashboardUrl?: string;
}

/** What a carrier sees in Settings: whether Mollie is for it, and if so whether it is connected. */
export class MollieConnectionView {
  @ApiProperty() available: boolean;
  /** Why not, as a short code the app says in words: `country` (not the Netherlands), `fleet` (its office connects), `off` (not set up here yet). */
  @ApiPropertyOptional({ enum: ['country', 'fleet', 'off'] }) why?: 'country' | 'fleet' | 'off';
  @ApiPropertyOptional({ enum: ['oauth', 'test_key'] }) via?: MollieVia;
  @ApiPropertyOptional({ type: MollieConnectedView }) connected?: MollieConnectedView;
}

/** Connecting: through the Connect app, the address of Mollie's own sign-in; with our test key, connected at once. */
export class MollieConnectStarted {
  @ApiPropertyOptional() url?: string;
  @ApiPropertyOptional({ type: MollieConnectedView }) connected?: MollieConnectedView;
}

/** How a return from Mollie's sign-in ended, as the app says it: connected, or why not. */
export type MollieReturn = { back: 'driver' | 'fleet'; outcome: 'connected' } | { back: 'driver' | 'fleet'; outcome: 'failed'; why: 'expired' | 'denied' | 'no_profile' | 'failed' };
