/**
 * 2026-11-19 — A CARRIER'S OWN MOLLIE ACCOUNT, in its Settings (the payments plan, part 2; the owner: "Netherlands: Mollie").
 * A shipper who pays the carrier directly can then pay at the handover, from a QR code; the money goes into the carrier's
 * Mollie account, never through SeeBuyGet, and Mollie tells us when it is paid. A courier connects its own; a fleet driver's
 * fleet is paid, so its office connects the fleet's.
 */

export interface MollieConnectedView {
  via: 'oauth' | 'test_key';
  organizationName?: string;
  profileName?: string;
  testmode: boolean;
  connectedAt: string;
  lostAt?: string;
  canReceivePayments?: boolean;
  onboarding?: 'needs-data' | 'in-review' | 'completed';
  dashboardUrl?: string;
}

export interface MollieView {
  available: boolean;
  /** 2026-11-25 — a load a sender paid upfront is paid into the connected account once its pay is released (route plan part 9b). */
  paysLoads?: boolean;
  /** `country`: not the Netherlands; `fleet`: a fleet driver, whose office connects it; `off`: not set up on this server yet. */
  why?: 'country' | 'fleet' | 'off';
  via?: 'oauth' | 'test_key';
  connected?: MollieConnectedView;
}

export type MollieBack = { outcome: 'connected' } | { outcome: 'failed'; why: 'expired' | 'denied' | 'no_profile' | 'failed' };

/** 2026-11-20 — a month's invoice for our fee (part 2c): already paid, Mollie took it from the payments. */
export interface MollieInvoiceRow {
  invoiceId: string;
  number: string;
  test: boolean;
  month: string;
  issuedAt: string;
  currency: string;
  gross: number;
  payments: number;
}

/** The month invoiced, in the reader's own words: "October 2026". */
export function invoiceMonthWords(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Settings shows Mollie to a carrier it is for — and to a fleet driver in the Netherlands, to say its office connects it. */
export function showsMollie(v: MollieView | null): v is MollieView {
  return Boolean(v && (v.available || v.why === 'fleet'));
}

/** The line under "Mollie" in Settings. */
export function mollieSub(v: MollieView, t: T): string {
  if (!v.available) return t('account.mollie.subFleet');
  const c = v.connected;
  if (!c) return t('account.mollie.subNone');
  if (c.lostAt) return t('account.mollie.subLost');
  if (c.via === 'test_key') return t('account.mollie.subTestKey');
  const name = c.organizationName || c.profileName || t('account.mollie.title');
  if (c.canReceivePayments === false) return t('account.mollie.subChecking', { name });
  return c.testmode ? t('account.mollie.subTest', { name }) : name;
}

/** Back from Mollie's sign-in: how it ended, read off the address (`?mollie=…&why=…`), or nothing when it is not a return. */
export function mollieBackOf(search: string): MollieBack | null {
  const q = new URLSearchParams(search);
  const outcome = q.get('mollie');
  if (outcome === 'connected') return { outcome };
  if (outcome !== 'failed') return null;
  const why = q.get('why');
  return { outcome, why: why === 'expired' || why === 'denied' || why === 'no_profile' ? why : 'failed' };
}

/** The address without the return's own words, so a reload does not say it again. */
export function withoutMollieBack(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('mollie');
  url.searchParams.delete('why');
  return url.pathname + (url.search === '?' ? '' : url.search) + url.hash;
}

/** What a return says, in a sentence. */
export function mollieBackSays(b: MollieBack, t: T): { tone: 'ok' | 'warn'; title: string } {
  if (b.outcome === 'connected') return { tone: 'ok', title: t('account.mollie.backConnected') };
  return { tone: 'warn', title: t(b.why === 'expired' ? 'account.mollie.backExpired' : b.why === 'denied' ? 'account.mollie.backDenied' : b.why === 'no_profile' ? 'account.mollie.backNoProfile' : 'account.mollie.backFailed') };
}
