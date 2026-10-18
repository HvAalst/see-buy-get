import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ipInCidr, maskMsisdn, normaliseIp } from '../funding/mpesa-funding-rail.adapter';
import { DARAJA_CALLBACK_CIDRS, DARAJA_HOSTS, type DarajaEnv } from '../funding/mpesa.types';
import { GlosError } from '../http/glos-error';
import { isSandbox } from '../runtime/sandbox';
import { PersistentMap } from '../store/persistent-map';
import type { PayoutInstruction, PayoutRail, RailOutcome } from './payout.types';

/**
 * PAYING OUT BY M-PESA — Safaricom's B2C, through Daraja (the user, 2026-10-18: "M-Pesa payouts", "payout differs per
 * country turned on"). Kenya's way (payout-ways.ts); every other country is paid by hand.
 *
 * WHAT IT IS ASKED, AND WHAT IT ANSWERS. A payout raised to a payee's own confirmed number is handed over here; Daraja
 * answers the request at once (taken, or refused) and the PAYMENT later, on the result URL. So `submit` says one of three
 * things, and only one of them is a refusal:
 *
 *   - taken     — Daraja accepted the request. Nothing has moved: the result settles or fails it.
 *   - refused   — Daraja turned the request down (a 4xx, or ResponseCode other than 0). Nothing left; the payout fails.
 *   - unknown   — no answer we can read (a timeout, a 5xx, a dropped line). The request may have been processed, so the
 *                 payout stays in flight until the result arrives — never failed and raised again, which is how one
 *                 day's work is paid twice.
 *
 * WHO A RESULT IS ABOUT. The request carries an OriginatorConversationID we make (random, never shown) and is kept here
 * before it is sent, so a result that comes back before the request's own answer is still ours to match. A result counts
 * only when that id is one of ours — and, where Daraja gave us its ConversationID, that one too. The callback is not
 * signed (it never is: see mpesa_rail.md); it is admitted from Safaricom's addresses only, the loopback in a sandbox.
 *
 * NOT DONE, AND SAID: Safaricom's B2C charge is not in the result, so it is not booked (the same gap the inbound rail
 * names); there is no Transaction Status query, so an answer that never comes is resolved by staff from the M-Pesa portal.
 */

export const MPESA_PAYOUT_RAIL = 'MPESA_PAYOUT_RAIL';

/** B2C, with an OriginatorConversationID of ours (version 3 of the request). */
export const B2C_PATH = '/mpesa/b2c/v3/paymentrequest';
const TOKEN_PATH = '/oauth/v1/generate?grant_type=client_credentials';
const HTTP_TIMEOUT_MS = 20_000;
const TOKEN_SAFETY_MS = 60_000;

/**
 * A payment to a business's supplier — a fleet, a courier, a hub — never `SalaryPayment`: the network pays who it
 * contracts with and employs nobody (scope boundary: no payroll).
 */
const COMMAND_ID = 'BusinessPayment';

export interface MpesaPayoutConfig {
  env: DarajaEnv;
  consumerKey: string;
  consumerSecret: string;
  /** The B2C shortcode the money leaves from. */
  shortcode: string;
  /** The API operator set up on the M-Pesa portal for this shortcode. */
  initiator: string;
  /** The initiator's password, encrypted with Safaricom's certificate — generated on the Daraja portal. */
  securityCredential: string;
  /** Where Safaricom posts results: `${callbackBase}/v1/rails/payouts/mpesa/result`. */
  callbackBase: string;
  allowedCidrs?: string[];
  /** A stand-in for Daraja on a laptop. Refused outside a sandbox. */
  host?: string;
}

/** Enough to pay out by M-Pesa? Absent any of it, Kenya's payouts are refused off a sandbox and stood in for on one. */
export function mpesaPayoutConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MpesaPayoutConfig | null {
  const v = (k: string) => (env[k] ?? '').trim();
  const consumerKey = v('GLOS_MPESA_CONSUMER_KEY');
  const consumerSecret = v('GLOS_MPESA_CONSUMER_SECRET');
  const shortcode = v('GLOS_MPESA_B2C_SHORTCODE');
  const initiator = v('GLOS_MPESA_B2C_INITIATOR');
  const securityCredential = v('GLOS_MPESA_B2C_SECURITY_CREDENTIAL');
  const callbackBase = v('GLOS_MPESA_CALLBACK_BASE').replace(/\/+$/, '');
  if (!consumerKey || !consumerSecret || !shortcode || !initiator || !securityCredential || !callbackBase) return null;
  return {
    env: v('GLOS_MPESA_ENV').toLowerCase() === 'production' ? 'production' : 'sandbox',
    consumerKey,
    consumerSecret,
    shortcode,
    initiator,
    securityCredential,
    callbackBase,
    allowedCidrs: v('GLOS_MPESA_ALLOWED_IPS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    host: v('GLOS_MPESA_HOST') || undefined,
  };
}

/** One request, kept from before it is sent until its result is in. */
export interface B2cRequest {
  originatorId: string;
  conversationId?: string;
  payoutId: string;
  amount: number;
  masked: string;
  sentAt: string;
  /** Set once a result was read: a second one for the same request is a repeat, not news. */
  resultAt?: string;
}

/** What a result says, once it is known to be about one of our requests. */
export type B2cResult =
  | { payoutId: string; paid: true; receipt: string; amount?: number }
  | { payoutId: string; paid: false; reason: string }
  | { payoutId: string; unsure: string }
  | { payoutId: string; repeat: true };

interface DarajaB2cAnswer {
  ConversationID?: string;
  OriginatorConversationID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface DarajaB2cResult {
  Result?: {
    ResultType?: number;
    ResultCode?: number | string;
    ResultDesc?: string;
    OriginatorConversationID?: string;
    ConversationID?: string;
    TransactionID?: string;
    ResultParameters?: { ResultParameter?: Array<{ Key?: string; Value?: unknown }> | { Key?: string; Value?: unknown } };
  };
}

type Fetcher = typeof fetch;

export class MpesaPayoutRail implements PayoutRail {
  readonly provider = 'mpesa';
  private readonly logger = new Logger(MpesaPayoutRail.name);
  private readonly requests = new PersistentMap<string, B2cRequest>('payout-mpesa-requests');
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly config: MpesaPayoutConfig,
    /** Injected so the rail can be driven in a test without a network. */
    private readonly http: Fetcher = fetch,
  ) {
    if (config.host && !isSandbox()) {
      throw new Error('GLOS_MPESA_HOST is set outside a sandbox: payouts would be sent somewhere other than Safaricom');
    }
  }

  private get host(): string {
    return this.config.host || DARAJA_HOSTS[this.config.env];
  }

  async submit(instruction: PayoutInstruction): Promise<RailOutcome> {
    if (instruction.currency.toUpperCase() !== 'KES') return { taken: false, refused: `M-Pesa pays out Kenyan shillings, not ${instruction.currency}` };
    if (!instruction.msisdn) return { taken: false, refused: 'No payout number to send it to' };
    if (!Number.isInteger(instruction.amount) || instruction.amount < 1) return { taken: false, refused: 'M-Pesa pays whole shillings, one or more' };
    const originatorId = randomUUID();
    // Kept BEFORE it is sent: a result that outruns the request's own answer still finds its payout.
    this.requests.set(originatorId, { originatorId, payoutId: instruction.payoutId, amount: instruction.amount, masked: maskMsisdn(instruction.msisdn), sentAt: new Date().toISOString() });
    const body = {
      OriginatorConversationID: originatorId,
      InitiatorName: this.config.initiator,
      SecurityCredential: this.config.securityCredential,
      CommandID: COMMAND_ID,
      Amount: instruction.amount,
      PartyA: this.config.shortcode,
      PartyB: instruction.msisdn,
      Remarks: 'SeeBuyGet payout',
      QueueTimeOutURL: `${this.config.callbackBase}/v1/rails/payouts/${this.provider}/timeout`,
      ResultURL: `${this.config.callbackBase}/v1/rails/payouts/${this.provider}/result`,
      Occasion: instruction.payoutId,
    };
    let res: Response;
    let answer: DarajaB2cAnswer;
    try {
      const token = await this.accessToken();
      res = await this.fetchWithTimeout(`${this.host}${B2C_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      answer = (await res.json().catch(() => ({}))) as DarajaB2cAnswer;
    } catch (err) {
      // No answer we can read. It may have gone: stays in flight until the result says.
      return { taken: 'unknown', railRef: originatorId, why: `M-Pesa did not answer (${(err as Error).message}). The payment may have gone: wait for its result, or check the M-Pesa portal.` };
    }
    if (res.status >= 500) {
      return { taken: 'unknown', railRef: originatorId, why: `M-Pesa answered ${res.status}. The payment may have gone: wait for its result, or check the M-Pesa portal.` };
    }
    if (!res.ok || answer.errorCode || String(answer.ResponseCode ?? '') !== '0') {
      this.requests.delete(originatorId);
      return { taken: false, refused: answer.errorMessage?.trim() || answer.ResponseDescription?.trim() || `M-Pesa refused the request (${res.status})` };
    }
    const conversationId = String(answer.ConversationID ?? '').trim();
    if (conversationId) this.requests.set(originatorId, { ...this.requests.get(originatorId)!, conversationId });
    return { taken: true, railRef: originatorId, ...(conversationId ? { providerRef: conversationId } : {}) };
  }

  /** Safaricom's result for a request of ours: paid (with its receipt), or not (with why). */
  result(body: unknown, meta: { ip?: string }, now: number = Date.now()): B2cResult {
    this.assertFromSafaricom(meta.ip);
    const r = (body as DarajaB2cResult)?.Result;
    const request = this.match(r);
    if (request.resultAt) return { payoutId: request.payoutId, repeat: true };
    this.requests.set(request.originatorId, { ...request, resultAt: new Date(now).toISOString() });
    if (String(r?.ResultCode ?? '') !== '0') return { payoutId: request.payoutId, paid: false, reason: r?.ResultDesc?.trim() || `M-Pesa did not pay it (${r?.ResultCode})` };
    const params = resultParameters(r);
    const receipt = String(params.TransactionReceipt ?? r?.TransactionID ?? '').trim();
    const amount = Number(params.TransactionAmount);
    if (!receipt) return { payoutId: request.payoutId, unsure: 'M-Pesa says it paid, without a receipt: check the M-Pesa portal before marking it paid.' };
    if (Number.isFinite(amount) && amount !== request.amount) {
      return { payoutId: request.payoutId, unsure: `M-Pesa says it paid ${amount}, not ${request.amount} (receipt ${receipt}): check before marking it paid.` };
    }
    return { payoutId: request.payoutId, paid: true, receipt, ...(Number.isFinite(amount) ? { amount } : {}) };
  }

  /** The request waited too long in Safaricom's queue. Whether it was paid is not known: said, never assumed. */
  timeout(body: unknown, meta: { ip?: string }): B2cResult {
    this.assertFromSafaricom(meta.ip);
    const request = this.match((body as DarajaB2cResult)?.Result);
    if (request.resultAt) return { payoutId: request.payoutId, repeat: true };
    return { payoutId: request.payoutId, unsure: 'M-Pesa’s queue timed out on this payment. It may not have been paid: check the M-Pesa portal before marking it paid or failed.' };
  }

  /** One of ours, by the id we made — and Daraja's own, where it gave us one. Anything else is refused by name. */
  private match(r: DarajaB2cResult['Result']): B2cRequest {
    const originatorId = String(r?.OriginatorConversationID ?? '').trim();
    const request = originatorId ? this.requests.get(originatorId) : undefined;
    if (!request) throw new GlosError('CALLBACK_INVALID', 'This result is not about a payout we sent');
    const conversationId = String(r?.ConversationID ?? '').trim();
    if (request.conversationId && conversationId !== request.conversationId) throw new GlosError('CALLBACK_CONTRADICTED', 'This result names a different M-Pesa conversation from the one we were given');
    return request;
  }

  /** Safaricom's addresses only; the loopback only in a sandbox (mpesa_rail.md: the callback is not signed). */
  private assertFromSafaricom(ip?: string): void {
    const address = normaliseIp(ip);
    if (!address) throw new GlosError('CALLBACK_UNSIGNED', 'This result arrived from an unknown address');
    if (address === '127.0.0.1' || address === '::1') {
      if (isSandbox()) return;
      throw new GlosError('CALLBACK_UNSIGNED', 'This result arrived from this machine rather than from M-Pesa. Behind a proxy, configure trust proxy so the real caller’s address is seen.');
    }
    const allowed = this.config.allowedCidrs?.length ? this.config.allowedCidrs : DARAJA_CALLBACK_CIDRS;
    if (!allowed.some((cidr) => ipInCidr(address, cidr))) throw new GlosError('CALLBACK_UNSIGNED', `This result did not come from M-Pesa (${address})`);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const basic = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
    const res = await this.fetchWithTimeout(`${this.host}${TOKEN_PATH}`, { method: 'GET', headers: { Authorization: `Basic ${basic}` } });
    if (!res.ok) throw new Error(`M-Pesa refused our credentials (${res.status})`);
    const json = (await res.json()) as { access_token?: string; expires_in?: string | number };
    const value = String(json.access_token ?? '').trim();
    if (!value) throw new Error('M-Pesa returned no access token');
    const ttl = Number(json.expires_in) * 1000;
    this.token = { value, expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3_599_000) - TOKEN_SAFETY_MS };
    return value;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), HTTP_TIMEOUT_MS);
    try {
      return await this.http(url, { ...init, signal: abort.signal });
    } catch (err) {
      throw new Error(abort.signal.aborted ? 'no answer in time' : (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Daraja's key/value list as a record. One parameter arrives as an object, several as a list. */
function resultParameters(r: DarajaB2cResult['Result']): Record<string, unknown> {
  const list = r?.ResultParameters?.ResultParameter;
  const items = Array.isArray(list) ? list : list ? [list] : [];
  return Object.fromEntries(items.filter((p) => p?.Key).map((p) => [String(p.Key), p.Value]));
}
