import { GlosError } from '../http/glos-error';
import { MOLLIE_SCOPES, type MollieConfig, type MollieOnboarding, type MollieOrganization, type MollieTokens } from './mollie.types';

/**
 * MOLLIE'S OWN API, AS FEW CALLS AS THE WORK NEEDS (docs.mollie.com, read 19 November 2026). The Connect app's sign-in on
 * my.mollie.com, its tokens on api.mollie.com/oauth2/tokens (the app's id and secret as HTTP Basic), and the account's
 * profiles, company and readiness on /v2. A stand-in host replaces both addresses on a laptop or in a test.
 *
 * Mollie's answer to a refusal is kept whole in a MollieError, so the caller can tell a refused refresh (the carrier took
 * the app's access away) from a Mollie that did not answer. No token is ever written into an error or a log.
 */

export const MOLLIE_API = 'https://api.mollie.com';
export const MOLLIE_AUTHORIZE = 'https://my.mollie.com/oauth2/authorize';
/** Where Mollie sends a carrier back after its sign-in: registered as the Connect app's redirect URL, exactly this. */
export const MOLLIE_CALLBACK_PATH = '/v1/sbg/mollie/oauth/callback';
const TIMEOUT_MS = 15_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class MollieError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
    /** OAuth's own error code where the token endpoint answered (`invalid_grant`: the access was taken away). */
    readonly code?: string,
    readonly field?: string,
  ) {
    super(`Mollie answered ${status}: ${detail || title}`);
  }
}

export interface MollieProfile {
  id: string;
  name: string;
  status: string;
}

export class MollieClient {
  constructor(
    private readonly cfg: MollieConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private get api(): string {
    return this.cfg.host ?? MOLLIE_API;
  }

  get redirectUri(): string | undefined {
    return this.cfg.publicBase ? `${this.cfg.publicBase}${MOLLIE_CALLBACK_PATH}` : undefined;
  }

  /** Mollie's sign-in for the carrier, carrying a state only this server knows. */
  authorizeUrl(state: string): string {
    const base = this.cfg.host ? `${this.cfg.host}/oauth2/authorize` : MOLLIE_AUTHORIZE;
    const q = new URLSearchParams({ client_id: this.cfg.clientId ?? '', state, scope: MOLLIE_SCOPES.join(' '), response_type: 'code', approval_prompt: 'auto' });
    if (this.redirectUri) q.set('redirect_uri', this.redirectUri);
    return `${base}?${q.toString()}`;
  }

  exchangeCode(code: string): Promise<MollieTokens> {
    return this.token({ grant_type: 'authorization_code', code, ...(this.redirectUri ? { redirect_uri: this.redirectUri } : {}) });
  }

  refresh(refreshToken: string): Promise<MollieTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Taking a refresh token away takes every access token made from it with it. */
  async revoke(token: string, hint: 'access_token' | 'refresh_token'): Promise<void> {
    await this.call('DELETE', '/oauth2/tokens', { basic: true, form: { token_type_hint: hint, token } });
  }

  async profiles(bearer: string): Promise<MollieProfile[]> {
    const body = await this.call('GET', '/v2/profiles?limit=50', { bearer });
    const list = ((body._embedded as { profiles?: unknown[] } | undefined)?.profiles ?? []) as Array<Record<string, unknown>>;
    return list.map((p) => ({ id: String(p.id ?? ''), name: String(p.name ?? ''), status: String(p.status ?? '') })).filter((p) => p.id);
  }

  async organization(bearer: string): Promise<MollieOrganization> {
    const o = await this.call('GET', '/v2/organizations/me', { bearer });
    const a = (o.address ?? {}) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return {
      id: String(o.id ?? ''),
      name: String(o.name ?? ''),
      ...(text(o.registrationNumber) ? { registrationNumber: text(o.registrationNumber) } : {}),
      ...(text(o.vatNumber) ? { vatNumber: text(o.vatNumber) } : {}),
      address: { streetAndNumber: text(a.streetAndNumber), postalCode: text(a.postalCode), city: text(a.city), country: text(a.country) },
    };
  }

  async onboarding(bearer: string): Promise<{ status?: MollieOnboarding; canReceivePayments?: boolean; dashboardUrl?: string }> {
    const o = await this.call('GET', '/v2/onboarding/me', { bearer });
    const status = o.status === 'needs-data' || o.status === 'in-review' || o.status === 'completed' ? o.status : undefined;
    const dashboard = ((o._links as Record<string, { href?: string }> | undefined)?.dashboard?.href ?? undefined) as string | undefined;
    return { ...(status ? { status } : {}), ...(typeof o.canReceivePayments === 'boolean' ? { canReceivePayments: o.canReceivePayments } : {}), ...(dashboard ? { dashboardUrl: dashboard } : {}) };
  }

  /** A payment, created on the account the bearer stands for; the same key twice within the hour is the same payment. */
  createPayment(bearer: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.call('POST', '/v2/payments', { bearer, json: body, idempotencyKey });
  }

  /** 2026-11-21 — money back on a payment (the payments plan, 5c): the whole or a part, once per key. */
  createRefund(bearer: string, paymentId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.call('POST', `/v2/payments/${encodeURIComponent(paymentId)}/refunds`, { bearer, json: body, idempotencyKey });
  }

  /** 2026-11-25 — the refunds already made on a payment: what a retry asks first, so one refund is never made twice. */
  async listRefunds(bearer: string, paymentId: string): Promise<Array<Record<string, unknown>>> {
    const got = await this.call('GET', `/v2/payments/${encodeURIComponent(paymentId)}/refunds?limit=250`, { bearer });
    const list = (got._embedded as { refunds?: unknown } | undefined)?.refunds;
    return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  }

  /**
   * 2026-11-25 — DELAYED ROUTING (route plan part 9b, step 2; docs.mollie.com, Delayed routing): part of a payment paid on our own
   * account moved to a connected organization's balance — the carrier's — once its work is done. Within 90 days of the payment;
   * euros only; switched on for our account by Mollie on request.
   */
  createRoute(bearer: string, paymentId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.call('POST', `/v2/payments/${encodeURIComponent(paymentId)}/routes`, { bearer, json: body, idempotencyKey });
  }

  /** The routes already made on a payment: what a retry asks first, so a carrier is never routed twice. */
  async listRoutes(bearer: string, paymentId: string): Promise<Array<Record<string, unknown>>> {
    const got = await this.call('GET', `/v2/payments/${encodeURIComponent(paymentId)}/routes`, { bearer });
    const list = (got._embedded as { routes?: unknown } | undefined)?.routes;
    return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  }

  /** A test payment is only found when asked for as one. */
  getPayment(bearer: string, paymentId: string, testmode: boolean): Promise<Record<string, unknown>> {
    return this.call('GET', `/v2/payments/${encodeURIComponent(paymentId)}${testmode ? '?testmode=true' : ''}`, { bearer });
  }

  private async token(form: Record<string, string>): Promise<MollieTokens> {
    const t = await this.call('POST', '/oauth2/tokens', { basic: true, form });
    const access = typeof t.access_token === 'string' ? t.access_token : '';
    if (!access) throw new MollieError(502, 'No token', 'Mollie answered without an access token');
    return {
      accessToken: access,
      ...(typeof t.refresh_token === 'string' && t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      expiresIn: typeof t.expires_in === 'number' && t.expires_in > 0 ? t.expires_in : 3600,
      ...(typeof t.scope === 'string' ? { scope: t.scope } : {}),
    };
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { bearer?: string; basic?: boolean; form?: Record<string, string>; json?: unknown; idempotencyKey?: string },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.basic) headers.authorization = `Basic ${Buffer.from(`${this.cfg.clientId ?? ''}:${this.cfg.clientSecret ?? ''}`).toString('base64')}`;
    else if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    let body: string | undefined;
    if (opts.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.api}${path}`, { method, headers, body, signal: abort.signal });
    } catch {
      throw new GlosError('PROVIDER_UNAVAILABLE', 'Mollie did not answer: try again in a moment');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return {};
    const text = await res.text().catch(() => '');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    if (!res.ok) {
      // The token endpoint answers in OAuth's own shape (error, error_description); the API in its own (title, detail, field).
      const code = typeof parsed.error === 'string' ? parsed.error : undefined;
      const detail = typeof parsed.detail === 'string' ? parsed.detail : typeof parsed.error_description === 'string' ? parsed.error_description : '';
      const title = typeof parsed.title === 'string' ? parsed.title : (code ?? `HTTP ${res.status}`);
      throw new MollieError(res.status, title, detail, code, typeof parsed.field === 'string' ? parsed.field : undefined);
    }
    return parsed;
  }
}
