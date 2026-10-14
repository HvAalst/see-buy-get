import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { isSandbox } from '../runtime/sandbox';
import { PersistentMap } from '../store/persistent-map';
import {
  CallbackMeta,
  FundingInstruction,
  FundingRail,
  RailCallback,
  RailOpening,
  RailPayment,
} from './funding.types';
import {
  DARAJA_CALLBACK_CIDRS,
  DARAJA_HOSTS,
  DARAJA_TRANSACTION_TYPE,
  DarajaC2bConfirmation,
  DarajaEnv,
  DarajaShortcodeKind,
  DarajaStkCallback,
  DarajaStkQueryResponse,
  DarajaStkRequest,
  DarajaStkResponse,
  DarajaTokenResponse,
} from './mpesa.types';

/**
 * THE M-PESA RAIL — STK push as the main path, a paybill as the fallback. (User's decision, 2026-09-22.)
 *
 * The shape of the decision is the shape of this file. With STK push WE initiate: the shop says how much
 * and which phone, Safaricom makes that handset ring, the shopkeeper enters their PIN and we are told.
 * Because we started it we already know who is paying and how much, so there is no reference for anybody
 * to mistype and the unattributable pile nearly empties. The paybill exists for everything STK cannot
 * reach — a payer at a kiosk, somebody paying from a relative's phone, a handset with no data — and it
 * pays the price for that reach in the only currency available: a reference typed by hand.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE SANDBOX RAIL BESIDE IT, AND WHY THE WARNING WAS WRITTEN DOWN.
 *
 * The sandbox adapter verifies an HMAC. That is right for a card acquirer and it is **not how M-Pesa
 * works**: Daraja's callbacks are plain unauthenticated POSTs with no signature, no bearer token and no
 * shared secret of any kind. A body from Safaricom and a body from somebody who guessed our URL are
 * byte-identical. Anyone porting the sandbox rail's approach here would have written a check that passes
 * on nothing, which is worse than no check at all because it reads like one.
 *
 * So provenance is established twice over, and the two are doing different jobs:
 *
 * 1. **WHERE IT CAME FROM.** Safaricom publishes the ranges their callbacks originate in. This is the
 *    security boundary: source addresses on an established TCP connection are not practically forgeable,
 *    so a body from outside those ranges is refused outright and never reaches the books.
 * 2. **ASKING THEM.** For an STK payment we then call Daraja's query API — over a connection WE opened
 *    and authenticated — and ask what that checkout actually ended in. A "paid" callback whose query says
 *    cancelled is refused. This is corroboration, not the boundary, and it can veto but not admit.
 *
 * WHAT THAT LEAVES OPEN, SAID PLAINLY RATHER THAN HIDDEN. The C2B fallback has no synchronous query to
 * make: Safaricom's Transaction Status API answers to a *result URL* minutes later, so it cannot
 * corroborate a callback we are answering right now. A paybill confirmation is therefore accepted on the
 * allowlist alone. That is a real and narrower guarantee than the STK path's, it is recorded on the
 * payment, and it is a named gap — not a thing to discover later from a reconciliation that will not
 * balance.
 */

const TOKEN_PATH = '/oauth/v1/generate?grant_type=client_credentials';
const STK_PATH = '/mpesa/stkpush/v1/processrequest';
const STK_QUERY_PATH = '/mpesa/stkpushquery/v1/query';

/** The alphabet a payer can read off one screen and type into another — no 0/O, no 1/I/L. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * A token is good for an hour; it is refreshed a minute early rather than on expiry, because a request
 * that starts valid and arrives expired fails in the one place a shopkeeper is watching.
 */
const TOKEN_SAFETY_MS = 60_000;

/** How long we will wait on Safaricom before giving up and showing the payer the paybill instead. */
const HTTP_TIMEOUT_MS = 20_000;

/** The one currency this rail can carry. Not a limitation to work around — M-Pesa is Kenyan shillings. */
const RAIL_CURRENCY = 'KES';

export interface MpesaConfig {
  env: DarajaEnv;
  consumerKey: string;
  consumerSecret: string;
  /** The paybill or till number money is paid into. */
  shortcode: string;
  /** For a till, the store number that owns it; defaults to the shortcode. */
  partyB?: string;
  kind: DarajaShortcodeKind;
  /** The Lipa-na-M-Pesa passkey, used to derive each request's password. A secret. */
  passkey: string;
  /** Public HTTPS base for our callbacks, e.g. `https://api.seebuyget.com`. Daraja refuses plain http. */
  callbackBase: string;
  /** Overrides the published ranges. A deployment that cannot correct these without a release is one
   *  that will eventually refuse every payment. */
  allowedCidrs?: string[];
  /**
   * WHERE DARAJA IS, when it is not Safaricom — a stand-in on a laptop, or a proxy a bank insists on.
   *
   * Refused outside a sandbox, and that refusal matters more than it looks: an attacker who could set
   * this would not be forging a callback, they would be choosing who we ask to corroborate one, which
   * turns the whole verification into a conversation with themselves.
   */
  host?: string;
  /** Refuse an STK confirmation we could not corroborate, instead of accepting it on provenance alone. */
  strictQuery?: boolean;
}

/** Is there enough configuration to talk to Daraja at all? Absent any of it, the sandbox rail stays. */
export function mpesaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MpesaConfig | null {
  const consumerKey = (env.GLOS_MPESA_CONSUMER_KEY ?? '').trim();
  const consumerSecret = (env.GLOS_MPESA_CONSUMER_SECRET ?? '').trim();
  const shortcode = (env.GLOS_MPESA_SHORTCODE ?? '').trim();
  const passkey = (env.GLOS_MPESA_PASSKEY ?? '').trim();
  const callbackBase = (env.GLOS_MPESA_CALLBACK_BASE ?? '').trim().replace(/\/+$/, '');
  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackBase) return null;
  const kind: DarajaShortcodeKind = (env.GLOS_MPESA_SHORTCODE_KIND ?? '').trim().toLowerCase() === 'till' ? 'till' : 'paybill';
  return {
    env: (env.GLOS_MPESA_ENV ?? '').trim().toLowerCase() === 'production' ? 'production' : 'sandbox',
    consumerKey,
    consumerSecret,
    shortcode,
    partyB: (env.GLOS_MPESA_PARTY_B ?? '').trim() || undefined,
    kind,
    passkey,
    callbackBase,
    allowedCidrs: (env.GLOS_MPESA_ALLOWED_IPS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    strictQuery: (env.GLOS_MPESA_STRICT_QUERY ?? '').trim() === '1',
    host: (env.GLOS_MPESA_HOST ?? '').trim() || undefined,
  };
}

/** What `open` remembers so a callback carrying only a CheckoutRequestID can be attributed. */
interface PushedRequest {
  reference: string;
  fundingId: string;
  amount: number;
  phone: string;
  at: string;
}

type Fetcher = typeof fetch;

@Injectable()
export class MpesaFundingRail implements FundingRail {
  readonly provider = 'mpesa';
  private readonly logger = new Logger(MpesaFundingRail.name);

  /**
   * CHECKOUT ID → OUR REFERENCE, and the reason this rail needs a memory at all.
   *
   * An STK callback does **not** carry the account reference we sent with the request. It carries the
   * `CheckoutRequestID` Safaricom handed back when we asked. Nothing above this line should have to know
   * that, so the translation happens here — and it is durable, because a restart between the prompt and
   * the payer finding their PIN would otherwise turn a perfectly ordinary payment into an unattributable
   * one. (The book still balances either way; somebody just has to work out whose it was by hand.)
   */
  private readonly pushes = new PersistentMap<string, PushedRequest>('funding-mpesa-pushes');

  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly config: MpesaConfig,
    /** Injected so the whole rail can be driven in a test without a network. Defaults to the real thing. */
    private readonly http: Fetcher = fetch,
  ) {
    if (config.host && !isSandbox()) {
      throw new Error('GLOS_MPESA_HOST is set outside a sandbox: the rail would ask something other than Safaricom whether a payment is real');
    }
  }

  /** Safaricom, or whatever stands in for it on a laptop. */
  private get host(): string {
    return this.config.host || DARAJA_HOSTS[this.config.env];
  }

  /* ===================================================================== opening == */

  async open(instruction: FundingInstruction): Promise<RailOpening> {
    const reference = this.reference();

    /*
     * A CURRENCY THIS RAIL CANNOT CARRY.
     *
     * M-Pesa moves Kenyan shillings. A sister keeping its books in birr or naira has no paybill of ours
     * to be paid into, and inventing words that tell its shops to "pay the number below" would send them
     * looking for a number that does not exist. Said plainly instead, and the operator's statement path
     * — which exists precisely for a payment with no webhook behind it — remains open.
     */
    if (instruction.currency.toUpperCase() !== RAIL_CURRENCY) {
      return {
        reference,
        instructions: `M-Pesa cannot take ${instruction.currency}. Arrange this payment with the office and quote the reference below.`,
      };
    }

    const paybill = this.paybillWords(instruction.amount, reference);
    const phone = normaliseMsisdn(instruction.payerPhone);
    if (!phone) return { reference, instructions: paybill };

    /*
     * WHOLE SHILLINGS ONLY, and this is not a rounding decision to make quietly.
     *
     * Daraja rejects a decimal amount. Rounding one for the payer would mean asking a phone for a figure
     * the shop never typed, and — because the books move by what the RAIL says arrived — the request and
     * the payment would disagree for ever after by a few cents nobody could explain. So a fractional
     * amount simply does not get a prompt; it gets the paybill, where the payer types the exact figure.
     */
    if (!Number.isInteger(instruction.amount)) {
      return { reference, instructions: paybill, pushError: 'M-Pesa prompts can only ask for whole shillings' };
    }

    try {
      const pushed = await this.stkPush(instruction, reference, phone);
      this.pushes.set(pushed.checkoutRequestId, {
        reference,
        fundingId: instruction.fundingId,
        amount: instruction.amount,
        phone,
        at: new Date().toISOString(),
      });
      return {
        reference,
        instructions: `Check ${maskMsisdn(phone)} — enter your M-Pesa PIN to pay ${instruction.amount} KES. ${paybill}`,
        pushed: true,
        railRef: pushed.checkoutRequestId,
      };
    } catch (err) {
      /*
       * THE PROMPT COULD NOT BE SENT, AND THE SHOP IS NOT TOLD TO WAIT FOR ONE.
       *
       * This is the fallback doing its job. Safaricom being down, a token expiring, a subscriber who
       * cannot be reached — none of them is a reason a shopkeeper cannot top up, and none of them is
       * worth an error page. They get the paybill, which is what they would have got a minute ago.
       */
      const reason = (err as Error).message;
      this.logger.warn(`STK push failed for ${instruction.fundingId}: ${reason}`);
      return { reference, instructions: paybill, pushError: reason };
    }
  }

  /* ================================================================== verifying == */

  async verify(headers: Record<string, string | undefined>, body: unknown, meta?: CallbackMeta): Promise<RailCallback> {
    /*
     * THE BOUNDARY, BEFORE THE BODY IS READ.
     *
     * Nothing in a Daraja callback proves where it came from, so the connection has to. This runs first
     * and on both shapes: a body we would refuse anyway should never get as far as being parsed, and a
     * caller probing the URL learns nothing about what we expect.
     */
    this.assertFromSafaricom(meta?.ip);

    const stk = (body ?? {}) as DarajaStkCallback;
    if (stk.Body?.stkCallback) return this.verifyStk(stk);
    return this.verifyC2b((body ?? {}) as DarajaC2bConfirmation);
  }

  /** The main path: a prompt the payer answered. Corroborated with Safaricom before it reaches the books. */
  private async verifyStk(body: DarajaStkCallback): Promise<RailCallback> {
    const cb = body.Body!.stkCallback!;
    const checkoutId = String(cb.CheckoutRequestID ?? '').trim();
    if (!checkoutId) throw new GlosError('CALLBACK_INVALID', 'An STK callback must carry its CheckoutRequestID');

    const resultCode = Number(cb.ResultCode);
    if (!Number.isFinite(resultCode) || resultCode !== 0) {
      /*
       * A PROMPT THAT ENDED IN NO PAYMENT — cancelled, timed out, wrong PIN, not enough money.
       *
       * Reported, not thrown: see RailNonPayment. The provider's own words are carried through, because
       * "Request cancelled by user" is a sentence the shop can act on and "callback rejected" is not.
       */
      return {
        provider: this.provider,
        paid: false,
        railRef: checkoutId,
        reason: cb.ResultDesc?.trim() || `the payer did not complete this payment (code ${cb.ResultCode})`,
      };
    }

    const items = new Map<string, string | number | undefined>(
      (cb.CallbackMetadata?.Item ?? []).map((i) => [String(i.Name ?? '').toLowerCase(), i.Value]),
    );
    const receipt = String(items.get('mpesareceiptnumber') ?? '').trim();
    const amount = Number(items.get('amount'));
    if (!receipt) throw new GlosError('CALLBACK_INVALID', 'A paid STK callback must carry its M-Pesa receipt number');
    if (!Number.isFinite(amount) || amount <= 0) throw new GlosError('CALLBACK_INVALID', 'A paid STK callback must carry the amount');

    await this.corroborate(checkoutId);

    /*
     * WHOSE PAYMENT THIS IS. The callback does not say — it never does — so the checkout id is looked up
     * against what `open` remembered. A miss is not fatal: the money is real, and an unattributable
     * payment is a thing this system already models properly. It lands in the unmatched pile with a
     * reason somebody can act on rather than being refused at the door.
     */
    const remembered = this.pushes.get(checkoutId);
    const phone = items.get('phonenumber');

    return {
      provider: this.provider,
      providerRef: receipt,
      reference: remembered?.reference,
      amount,
      currency: RAIL_CURRENCY,
      // Safaricom does not tell us their cut on a C2B/STK collection in the callback; it is invoiced
      // separately. A zero here would be a claim we did not verify — see RailPayment.fee.
      fee: 0,
      paidAt: darajaDate(items.get('transactiondate')),
      payerLabel: phone ? `M-Pesa ${maskMsisdn(String(phone))}` : undefined,
    };
  }

  /** The fallback: somebody paid the paybill and typed a reference, or did not. */
  private verifyC2b(body: DarajaC2bConfirmation): RailPayment {
    const transId = String(body.TransID ?? '').trim();
    const amount = Number(body.TransAmount);
    if (!transId) throw new GlosError('CALLBACK_INVALID', 'A C2B confirmation must carry its TransID');
    if (!Number.isFinite(amount) || amount <= 0) throw new GlosError('CALLBACK_INVALID', 'A C2B confirmation must carry the amount paid');

    /*
     * PAID INTO A SHORTCODE THAT IS NOT OURS.
     *
     * Cheap to check and worth checking: it catches a callback misrouted between two deployments sharing
     * an allowlist far more often than it catches an attacker, and crediting another company's paybill
     * into our books is not a mistake anybody would find later.
     */
    const paidTo = String(body.BusinessShortCode ?? '').trim();
    if (paidTo && paidTo !== this.config.shortcode) {
      throw new GlosError('CALLBACK_INVALID', `This payment was made to shortcode ${paidTo}, which is not ours`);
    }

    const name = [body.FirstName, body.MiddleName, body.LastName].map((p) => (p ?? '').trim()).filter(Boolean).join(' ');
    return {
      provider: this.provider,
      providerRef: transId,
      reference: String(body.BillRefNumber ?? '').trim() || undefined,
      amount,
      currency: RAIL_CURRENCY,
      fee: 0,
      paidAt: darajaDate(body.TransTime),
      // Whatever Safaricom chose to tell us. The number is masked at their end in production; it is a
      // label for a person chasing a payment, never an identity.
      payerLabel: [name, body.MSISDN ? maskMsisdn(String(body.MSISDN)) : ''].filter(Boolean).join(' · ') || undefined,
    };
  }

  /**
   * ASK SAFARICOM WHETHER THAT CHECKOUT REALLY ENDED IN A PAYMENT.
   *
   * The corroboration described in the class comment, and its limits are deliberate. A definite answer
   * that contradicts the callback REFUSES it — that is the whole value. An answer we could not get does
   * not: Daraja routinely replies "the transaction is being processed" to a query made in the same
   * second as its own callback, and refusing money on the strength of our own timing would mean a shop
   * that paid being told nothing arrived. So an unreachable or indefinite query lets the callback stand
   * on the allowlist, loudly, unless the deployment has asked for `strictQuery`.
   */
  private async corroborate(checkoutId: string): Promise<void> {
    let answer: DarajaStkQueryResponse;
    try {
      answer = await this.post<DarajaStkQueryResponse>(STK_QUERY_PATH, {
        BusinessShortCode: this.config.shortcode,
        ...this.password(),
        CheckoutRequestID: checkoutId,
      });
    } catch (err) {
      if (this.config.strictQuery) {
        throw new GlosError('CALLBACK_UNVERIFIED', `Could not confirm this payment with M-Pesa: ${(err as Error).message}`);
      }
      this.logger.warn(`could not corroborate ${checkoutId} with Daraja (${(err as Error).message}) — accepted on source address alone`);
      return;
    }

    const code = Number(answer.ResultCode);
    if (Number.isFinite(code) && code !== 0) {
      throw new GlosError(
        'CALLBACK_CONTRADICTED',
        `M-Pesa says this checkout was not paid: ${answer.ResultDesc?.trim() || `result code ${answer.ResultCode}`}`,
      );
    }
  }

  /**
   * IS THIS ADDRESS ONE OF SAFARICOM'S?
   *
   * Matched as a real prefix against each CIDR rather than by string comparison, because
   * `196.201.214.1`.startsWith() would admit `196.201.214.100` and a truncated range would admit a
   * neighbouring network entirely.
   *
   * LOOPBACK IS A SANDBOX AFFORDANCE AND NOTHING MORE, and the first version of this got it wrong by
   * allowing it everywhere. Walking the whole path on a laptop needs it. In production it is a hole with
   * two mouths: any other process on the host — a compromised sidecar, an SSRF in our own code — could
   * create money by POSTing a JSON body; and an app sitting behind nginx on the same machine sees EVERY
   * caller as 127.0.0.1, which would quietly disable the allowlist for the entire internet while
   * appearing to work perfectly.
   *
   * So outside a sandbox it is refused, and the refusal names the likely cause rather than the symptom:
   * somebody deploying behind a proxy needs `trust proxy` configured so that `req.ip` is the real caller,
   * not a debugging session against a rail that has stopped checking anything.
   */
  private assertFromSafaricom(ip?: string): void {
    const address = normaliseIp(ip);
    if (!address) throw new GlosError('CALLBACK_UNSIGNED', 'This confirmation arrived from an unknown address');
    if (address === '127.0.0.1' || address === '::1') {
      if (isSandbox()) return;
      throw new GlosError(
        'CALLBACK_UNSIGNED',
        'This confirmation arrived from this machine rather than from M-Pesa. Behind a proxy, configure trust proxy so the real caller’s address is seen.',
      );
    }
    const allowed = this.config.allowedCidrs?.length ? this.config.allowedCidrs : DARAJA_CALLBACK_CIDRS;
    if (!allowed.some((cidr) => ipInCidr(address, cidr))) {
      throw new GlosError('CALLBACK_UNSIGNED', `This confirmation did not come from M-Pesa (${address})`);
    }
  }

  /* ======================================================================= wire == */

  private async stkPush(instruction: FundingInstruction, reference: string, phone: string): Promise<{ checkoutRequestId: string }> {
    const request: DarajaStkRequest = {
      BusinessShortCode: this.config.shortcode,
      ...this.password(),
      TransactionType: DARAJA_TRANSACTION_TYPE[this.config.kind],
      Amount: instruction.amount,
      PartyA: phone,
      PartyB: this.config.partyB || this.config.shortcode,
      PhoneNumber: phone,
      CallBackURL: `${this.config.callbackBase}/v1/rails/funding/${this.provider}/callback`,
      // Twelve characters is Daraja's limit, which is why the reference scheme normalises to eleven.
      AccountReference: accountReference(reference),
      TransactionDesc: instruction.purpose === 'activation' ? 'Activation' : 'Float top-up',
    };
    const answer = await this.post<DarajaStkResponse>(STK_PATH, request as unknown as Record<string, unknown>);
    if (answer.errorCode) throw new Error(`${answer.errorCode}: ${answer.errorMessage ?? 'rejected'}`);
    if (String(answer.ResponseCode ?? '') !== '0') {
      throw new Error(answer.ResponseDescription?.trim() || 'M-Pesa would not send the prompt');
    }
    const checkoutRequestId = String(answer.CheckoutRequestID ?? '').trim();
    if (!checkoutRequestId) throw new Error('M-Pesa accepted the request without a CheckoutRequestID');
    return { checkoutRequestId };
  }

  /** The per-request password and the timestamp inside it — always produced together, because a pair
   *  that disagrees is rejected with an error message that names neither. */
  private password(): { Password: string; Timestamp: string } {
    const Timestamp = eastAfricanTimestamp();
    return { Password: Buffer.from(`${this.config.shortcode}${this.config.passkey}${Timestamp}`).toString('base64'), Timestamp };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const basic = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
    const res = await this.fetchWithTimeout(`${this.host}${TOKEN_PATH}`, {
      method: 'GET',
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new Error(`M-Pesa refused our credentials (${res.status})`);
    const json = (await res.json()) as DarajaTokenResponse;
    const value = String(json.access_token ?? '').trim();
    if (!value) throw new Error('M-Pesa returned no access token');
    const ttl = Number(json.expires_in) * 1000;
    this.token = { value, expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3_599_000) - TOKEN_SAFETY_MS };
    return value;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchWithTimeout(`${this.host}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
    if (!res.ok && !json.errorMessage) throw new Error(`M-Pesa answered ${res.status}`);
    return json;
  }

  /** A provider that never answers must not hold a shopkeeper's screen open for ever. */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), HTTP_TIMEOUT_MS);
    try {
      return await this.http(url, { ...init, signal: abort.signal });
    } catch (err) {
      throw new Error(abort.signal.aborted ? 'M-Pesa did not answer in time' : (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ===================================================================== words == */

  /** What a payer is told when they have to pay the long way. PROVIDER facts only — what happens to
   *  their balance afterwards is our policy, and the screen says it. */
  private paybillWords(amount: number, reference: string): string {
    const what = this.config.kind === 'till' ? `Buy Goods till ${this.config.shortcode}` : `Paybill ${this.config.shortcode}`;
    return `Or pay ${amount} KES to ${what}, account ${accountReference(reference)}.`;
  }

  private reference(): string {
    const bytes = randomAlphabet(8);
    return `SBG-${bytes.slice(0, 4)}-${bytes.slice(4)}`;
  }
}

/* ======================================================================== bits == */

/**
 * The reference as Daraja will carry it: letters and digits only, **at most twelve characters**.
 *
 * The limit is the provider's and it decides the whole scheme. `SBG-QNTS-QP5D` is thirteen characters and
 * would be truncated silently by Safaricom — producing a reference that matches nothing on the way back.
 * Stripping the separators gives eleven, and the service's own matching ignores separators and case on
 * both sides, so the stripped form and the printed form are the same reference.
 */
export function accountReference(reference: string): string {
  return reference.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
}

/**
 * A Kenyan subscriber number as Daraja wants it: `2547XXXXXXXX`, no plus, no leading zero.
 *
 * Returns undefined for anything it cannot be sure of, and that is the point — a prompt sent to a
 * number we guessed at is a PIN request landing on a stranger's phone. Better no prompt than that.
 */
export function normaliseMsisdn(input?: string): string | undefined {
  const digits = (input ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  // 07XX XXX XXX / 01XX XXX XXX — the domestic way of writing it.
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  // 7XX XXX XXX / 1XX XXX XXX — written without the trunk zero.
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  // Already international, with or without a plus.
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return undefined;
}

/** Enough of a number to recognise your own, not enough to be a record of somebody's phone. */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, '');
  if (digits.length < 6) return msisdn;
  return `${digits.slice(0, 6)}***${digits.slice(-3)}`;
}

/**
 * `yyyyMMddHHmmss` in East Africa Time, which is what Daraja means by "timestamp" and what the password
 * is derived from. UTC+3 with no daylight saving, so the offset is arithmetic rather than a timezone
 * database lookup — and a server running in any other zone still produces the right string.
 */
export function eastAfricanTimestamp(at: number = Date.now()): string {
  const t = new Date(at + 3 * 3_600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}

/** Daraja's `20191219102115` → an ISO instant. East Africa Time, as everything of theirs is. */
export function darajaDate(value?: string | number): string | undefined {
  const s = String(value ?? '').trim();
  if (!/^\d{14}$/.test(s)) return undefined;
  const [y, mo, d, h, mi, sec] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14)].map(Number);
  const utc = Date.UTC(y, mo - 1, d, h - 3, mi, sec);
  return Number.isFinite(utc) ? new Date(utc).toISOString() : undefined;
}

/** Express reports IPv4 callers as `::ffff:196.201.214.200` behind a dual-stack socket. */
export function normaliseIp(ip?: string): string | undefined {
  const raw = (ip ?? '').trim();
  if (!raw) return undefined;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/** A real prefix comparison. `startsWith` on a dotted quad is a bug waiting for its first octet. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const a = ipToInt(ip);
  const b = ipToInt(range);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function randomAlphabet(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
