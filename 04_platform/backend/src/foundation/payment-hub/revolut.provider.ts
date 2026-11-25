import { createHash } from 'crypto';
import { PersistentMap } from '../store/persistent-map';
import type { CollectRequest, HubProvider, OpenedAccount, PayoutRequest, ProviderAnswer, RefundRequest } from './hub.types';

/** Revolut Business's API: its test (sandbox) address, and the live one (developer.revolut.com, Business API, read 2026-11-24). */
export const REVOLUT_SANDBOX = 'https://sandbox-b2b.revolut.com/api/1.0';
export const REVOLUT_LIVE = 'https://b2b.revolut.com/api/1.0';

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** A request_id Revolut has seen already (its code 3020): the transfer exists, and is asked about, never sent again. */
const DUPLICATE_REQUEST = 3020;
/** Revolut finds a transfer by our request_id only within 14 days of the date it is asked from. */
const LOOK_BACK_MS = 13 * 24 * 60 * 60_000;

/**
 * Revolut's states for a transfer (TransactionState: created, pending, completed, declined, failed, reverted), as the hub says
 * them: done, still on its way, or failed.
 */
function answerOf(state: unknown, id?: string): ProviderAnswer {
  const s = typeof state === 'string' ? state : '';
  if (s === 'completed') return { state: 'paid', ...(id ? { providerRef: id } : {}) };
  if (s === 'pending' || s === 'created') return { state: 'asked', ...(id ? { providerRef: id } : {}) };
  return { state: 'failed', ...(id ? { providerRef: id } : {}), why: s || 'unknown' };
}

/**
 * 2026-11-24 — REVOLUT BUSINESS, THE PAYMENT HUB'S WAY TO PAY BULGARIAN HANDS (route plan part 4; the owner: "Provider we connect",
 * and "the system will choose the right method depending on the country without the user noticing it"). The partner's own Revolut
 * Business account pays its shops, hubs and drivers by bank transfer (SEPA, in euros): each payee added once by its bank account
 * (a counterparty), each payout sent with our own reference as Revolut's idempotency key (request_id), so a retry is never a second
 * payment; where it stands asked again by that reference. It pays out only: nobody pays in, or is refunded, through it.
 *
 * The partner makes an API key in its Revolut Business settings (Revolut's current way: a key sent as a Bearer token; read from
 * Revolut's published OpenAPI file, revolut-engineering/revolut-openapi, 2026-11-25), WITHOUT request signing — our staff enter
 * it, it is kept sealed, and a second member of staff switches it live. Its test (sandbox) key is tried at once, on test money.
 */
export class RevolutProvider implements HubProvider {
  readonly id = 'revolut' as const;
  /**
   * Each payee's counterparty at the partner's Revolut account, by the key it was added with and the account it pays to (both
   * hashed): added once. A test key's payees are never used with a live one, nor one key's with another's.
   */
  private readonly counterparties = new PersistentMap<string, { counterpartyId: string; accountId: string }>('revolut-counterparties');

  constructor(private readonly http: Fetch = (url, init) => fetch(url, init) as never) {}

  async collect(_account: OpenedAccount, _req: CollectRequest): Promise<ProviderAnswer> {
    return { state: 'failed', why: 'not_offered' };
  }

  async refund(_account: OpenedAccount, _req: RefundRequest): Promise<ProviderAnswer> {
    return { state: 'failed', why: 'not_offered' };
  }

  async payout(account: OpenedAccount, req: PayoutRequest, _now?: number): Promise<ProviderAnswer> {
    const to = req.payeeAccount;
    if (!to) return { state: 'failed', why: 'no_bank_account' };
    const from = await this.euroAccount(account);
    if (!from) return { state: 'failed', why: 'no_euro_account' };
    const payee = await this.counterpartyFor(account, to);
    if ('why' in payee) return { state: 'failed', why: payee.why };
    const paid = await this.call(account, 'POST', '/pay', {
      request_id: req.ourRef.slice(0, 40),
      account_id: from,
      receiver: { counterparty_id: payee.counterpartyId, account_id: payee.accountId },
      amount: req.amount,
      currency: req.currency,
      reference: req.description.slice(0, 140),
    });
    // No answer, or Revolut's own fault, or a request it has already: the transfer may exist. It is asked about by our reference
    // until Revolut says — never taken for failed, so never sent a second time under a new one.
    if (!paid.ok && (paid.status === 0 || paid.status >= 500 || paid.code === DUPLICATE_REQUEST)) return { state: 'asked' };
    if (!paid.ok) {
      // Refused, and nothing sent: the payee is added afresh at the next try, should Revolut no longer know it.
      this.counterparties.delete(this.payeeKey(account, to));
      return { state: 'failed', why: paid.message ?? `revolut_${paid.status}` };
    }
    const body = paid.body as { id?: string; state?: string };
    return answerOf(body.state, body.id);
  }

  /**
   * Where a transfer stands: by Revolut's own id where its answer came, else by our request_id among the last 13 days' transfers
   * (GET /transactions; its id_type lookup is deprecated). Not found, or not answered: still asked — a transfer is never taken
   * for failed because a question about it went unanswered.
   */
  async status(account: OpenedAccount, ref: { providerRef?: string; ourRef: string }, now: number = Date.now()): Promise<ProviderAnswer> {
    if (ref.providerRef) {
      const got = await this.call(account, 'GET', `/transaction/${encodeURIComponent(ref.providerRef)}`);
      if (!got.ok) return { state: 'asked', providerRef: ref.providerRef };
      const body = got.body as { id?: string; state?: string };
      return answerOf(body.state, body.id ?? ref.providerRef);
    }
    const from = new Date(now - LOOK_BACK_MS).toISOString();
    const got = await this.call(account, 'GET', `/transactions?request_id=${encodeURIComponent(ref.ourRef.slice(0, 40))}&from=${encodeURIComponent(from)}`);
    const found = got.ok && Array.isArray(got.body) ? (got.body as Array<{ id?: string; state?: string; request_id?: string }>).find((t) => !t.request_id || t.request_id === ref.ourRef.slice(0, 40)) : undefined;
    return found ? answerOf(found.state, found.id) : { state: 'asked' };
  }

  async balance(account: OpenedAccount): Promise<{ amount: number; currency: string } | undefined> {
    const got = await this.call(account, 'GET', '/accounts');
    if (!got.ok || !Array.isArray(got.body)) return undefined;
    const eur = (got.body as Array<{ currency?: string; balance?: number; state?: string }>).find((a) => a.currency === account.currency && a.state === 'active');
    return eur && typeof eur.balance === 'number' ? { amount: eur.balance, currency: account.currency } : undefined;
  }

  private async euroAccount(account: OpenedAccount): Promise<string | undefined> {
    const got = await this.call(account, 'GET', '/accounts');
    if (!got.ok || !Array.isArray(got.body)) return undefined;
    return (got.body as Array<{ id?: string; currency?: string; state?: string }>).find((a) => a.currency === account.currency && a.state === 'active')?.id;
  }

  private async counterpartyFor(account: OpenedAccount, to: NonNullable<PayoutRequest['payeeAccount']>): Promise<{ counterpartyId: string; accountId: string } | { why: string }> {
    const key = this.payeeKey(account, to);
    const known = this.counterparties.get(key);
    if (known) return known;
    const [first, ...rest] = to.holder.trim().split(/\s+/);
    const made = await this.call(account, 'POST', '/counterparty', {
      ...(to.person && rest.length ? { individual_name: { first_name: first, last_name: rest.join(' ') } } : { company_name: to.holder.trim().slice(0, 80) }),
      bank_country: to.account.slice(0, 2),
      currency: account.currency,
      iban: to.account,
      ...(to.bic ? { bic: to.bic } : {}),
    });
    if (!made.ok) return { why: made.message ?? `revolut_${made.status}` };
    const body = made.body as { id?: string; accounts?: Array<{ id?: string; currency?: string }> };
    const accountId = body.accounts?.find((a) => a.currency === account.currency)?.id ?? body.accounts?.[0]?.id;
    if (!body.id || !accountId) return { why: 'counterparty_unclear' };
    const kept = { counterpartyId: body.id, accountId };
    this.counterparties.set(key, kept);
    return kept;
  }

  private payeeKey(account: OpenedAccount, to: NonNullable<PayoutRequest['payeeAccount']>): string {
    const hash = (x: string): string => createHash('sha256').update(x).digest('hex').slice(0, 24);
    return `${account.accountId}:${hash(`${account.live ? 'live' : 'test'}:${account.keys.apiKey ?? ''}`)}:${hash(to.account)}`;
  }

  private async call(account: OpenedAccount, method: string, path: string, json?: unknown): Promise<{ ok: boolean; status: number; body: unknown; message?: string; code?: number }> {
    const base = account.live ? REVOLUT_LIVE : REVOLUT_SANDBOX;
    const key = account.keys.apiKey ?? '';
    try {
      const res = await this.http(`${base}${path}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(json !== undefined ? { body: JSON.stringify(json) } : {}) });
      const body = await res.json().catch(() => undefined);
      const said = !res.ok && body && typeof body === 'object' ? (body as { message?: unknown; code?: unknown }) : undefined;
      const message = typeof said?.message === 'string' ? said.message : undefined;
      const code = typeof said?.code === 'number' ? said.code : undefined;
      return { ok: res.ok, status: res.status, body, ...(message ? { message } : {}), ...(code != null ? { code } : {}) };
    } catch (err) {
      return { ok: false, status: 0, body: undefined, message: (err as Error).message };
    }
  }
}
