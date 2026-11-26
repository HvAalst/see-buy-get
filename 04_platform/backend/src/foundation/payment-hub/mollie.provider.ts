import { MollieError, type MollieClient } from '../mollie/mollie-client';
import type { CollectRequest, HubProvider, OpenedAccount, PayoutRequest, ProviderAnswer, RefundRequest } from './hub.types';

/**
 * 2026-11-26 — MONEY IN THROUGH THE PARTNER'S OWN MOLLIE ACCOUNT (the weakness after route plan part 4b, fixed as recommended; the
 * owner: "the system will choose the right method depending on the country without the user noticing it"). Revolut Business pays
 * out only, so in a country of the European Union the money a counter takes goes into the partner's own Mollie account, connected
 * by the partner itself through our Connect app (Mollie takes businesses in every EEA country; in Bulgaria since 3 June 2026). The
 * payment is a Mollie checkout page the payer opens from a QR code on the counter's screen — no phone number is asked — paid by
 * card, Apple Pay, Google Pay or whatever Mollie offers there. Mollie's answer, asked of Mollie by its id on the partner's own
 * token, is what counts; never the counter's word.
 *
 * Our own reference rides on every request (its metadata, and its idempotency key), so an answer lost on the way is found again
 * by it and a retry never makes a second payment or a second refund. It pays out nothing: the partner pays its hands through the
 * provider its country pays by (Revolut Business in the EU).
 */

/** What the adapter needs of the Mollie connection: the partner's token, the client, and the site's own address. */
export interface MollieHubSource {
  readonly cfg: { publicBase?: string };
  tokenFor(accountId: string, now?: number): Promise<{ bearer: string; via: 'oauth' | 'test_key'; testmode: boolean; profileId?: string }>;
  api(): Pick<MollieClient, 'createPayment' | 'getPayment' | 'createRefund' | 'listRefunds' | 'listPayments'>;
}

/** 2026-11-26 — where Mollie's notices about payments arrive (MollieController.webhook): the one address for all of ours. */
export const MOLLIE_NOTICE_PATH = '/v1/sbg/mollie/webhook';

/** Where the payer lands after Mollie's checkout: a page saying how the payment went (PaymentHubController). */
export const HUB_PAID_PAGE_PATH = '/v1/sbg/payment-hub/paid';

/** A Mollie payment's own words, as the hub keeps them. */
function paymentAnswer(made: Record<string, unknown>): ProviderAnswer {
  const id = typeof made.id === 'string' ? made.id : undefined;
  const link = ((made._links as Record<string, { href?: string }> | undefined)?.checkout?.href ?? undefined) as string | undefined;
  const ref = id ? { providerRef: id } : {};
  switch (made.status) {
    case 'paid':
      return { state: 'paid', ...ref };
    case 'expired':
      return { state: 'failed', ...ref, why: 'expired' };
    case 'canceled':
    case 'failed':
      return { state: 'failed', ...ref, why: 'declined' };
    default:
      // open, pending, authorized: still on its way — the page shown again while it is open.
      return { state: 'asked', ...ref, ...(link ? { link } : {}) };
  }
}

/** A refund's own words. Its handle carries the payment's: a refund is only found under the payment it gives back. */
function refundAnswer(paidRef: string, r: Record<string, unknown>): ProviderAnswer {
  const id = typeof r.id === 'string' ? r.id : undefined;
  const ref = id ? { providerRef: `${paidRef}/${id}` } : {};
  if (r.status === 'refunded') return { state: 'paid', ...ref };
  if (r.status === 'failed' || r.status === 'canceled') return { state: 'failed', ...ref, why: 'declined' };
  return { state: 'asked', ...ref };
}

/** Mollie refused the request itself (a 4xx other than "slow down" or "already being done"): a definite no. */
function refused(err: unknown): boolean {
  return err instanceof MollieError && err.status >= 400 && err.status < 500 && err.status !== 409 && err.status !== 429;
}

const testFlag = (t: { via: string; testmode: boolean }) => (t.via === 'oauth' && t.testmode ? { testmode: true } : {});

export class MollieHubProvider implements HubProvider {
  readonly id = 'mollie' as const;

  constructor(private readonly source: MollieHubSource) {}

  /** A checkout page on the partner's account, for the payer to open from the counter's QR code. */
  async collect(account: OpenedAccount, req: CollectRequest, now: number = Date.now()): Promise<ProviderAnswer> {
    const token = await this.source.tokenFor(account.accountId, now);
    const base = this.source.cfg.publicBase ?? '';
    const body: Record<string, unknown> = {
      amount: { currency: req.currency.toUpperCase(), value: req.amount.toFixed(2) },
      description: req.description.slice(0, 255),
      redirectUrl: `${base}${HUB_PAID_PAGE_PATH}/${encodeURIComponent(req.ourRef)}`,
      // 2026-11-26 — Mollie tells us when the payment changes, on the site's own address (never a laptop's, which it cannot reach).
      ...(base && !/\/\/(localhost|127\.|\[::1\])/.test(base) ? { webhookUrl: `${base}${MOLLIE_NOTICE_PATH}` } : {}),
      metadata: { ourRef: req.ourRef },
      ...(token.via === 'oauth' ? { profileId: token.profileId } : {}),
      ...testFlag(token),
    };
    try {
      return paymentAnswer(await this.source.api().createPayment(token.bearer, body, `hub-${req.ourRef}`));
    } catch (err) {
      if (refused(err)) return { state: 'failed', why: 'declined' };
      throw err;
    }
  }

  /**
   * Where it stands, asked of Mollie: a payment by its id, a refund under the payment it gives back — or, where the answer to the
   * request never came, found by our own reference among the account's latest.
   */
  async status(account: OpenedAccount, ref: { providerRef?: string; ourRef: string; paidRef?: string }, now: number = Date.now()): Promise<ProviderAnswer> {
    const token = await this.source.tokenFor(account.accountId, now);
    const testmode = token.via === 'oauth' && token.testmode;
    const api = this.source.api();
    const [paidRef, refundId] = (ref.providerRef ?? '').split('/');
    if (refundId) {
      const r = (await api.listRefunds(token.bearer, paidRef, testmode)).find((x) => x.id === refundId);
      return r ? refundAnswer(paidRef, r) : { state: 'asked', providerRef: ref.providerRef };
    }
    if (paidRef) return paymentAnswer(await api.getPayment(token.bearer, paidRef, testmode));
    const mine = (x: Record<string, unknown>) => (x.metadata as { ourRef?: string } | undefined)?.ourRef === ref.ourRef;
    if (ref.paidRef) {
      const r = (await api.listRefunds(token.bearer, ref.paidRef, testmode)).find(mine);
      return r ? refundAnswer(ref.paidRef, r) : { state: 'asked' };
    }
    const p = (await api.listPayments(token.bearer, { ...(token.via === 'oauth' && token.profileId ? { profileId: token.profileId } : {}), testmode })).find(mine);
    return p ? paymentAnswer(p) : { state: 'asked' };
  }

  /** The partner pays its hands through the provider its country pays by, never through Mollie. */
  async payout(_account: OpenedAccount, _req: PayoutRequest): Promise<ProviderAnswer> {
    return { state: 'failed', why: 'not_offered' };
  }

  /** Given back to the card or account it was paid from, once per payment given back (its own key). */
  async refund(account: OpenedAccount, req: RefundRequest, now: number = Date.now()): Promise<ProviderAnswer> {
    if (!req.paidRef.startsWith('tr_')) return { state: 'failed', why: 'declined' };
    const token = await this.source.tokenFor(account.accountId, now);
    const body: Record<string, unknown> = {
      amount: { currency: req.currency.toUpperCase(), value: req.amount.toFixed(2) },
      description: req.description.slice(0, 140),
      metadata: { ourRef: req.ourRef },
      ...testFlag(token),
    };
    try {
      return refundAnswer(req.paidRef, await this.source.api().createRefund(token.bearer, req.paidRef, body, `hub-refund-${req.ourRef}`));
    } catch (err) {
      if (refused(err)) return { state: 'failed', why: 'declined' };
      throw err;
    }
  }

  /** What the account holds is the partner's to read in Mollie: not asked for. */
  async balance(): Promise<undefined> {
    return undefined;
  }
}
