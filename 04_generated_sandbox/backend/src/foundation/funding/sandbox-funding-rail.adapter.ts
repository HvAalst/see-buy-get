import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { GlosError } from '../http/glos-error';
import { isSandbox } from '../runtime/sandbox';
import { deploymentSecret } from '../runtime/secrets';
import { CallbackMeta, FundingInstruction, FundingRail, RailOpening, RailPayment } from './funding.types';

/** How long a signed callback stays acceptable. Long enough for a provider's own retry, short enough that
 *  a body lifted off a log an hour later is refused. */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** The alphabet a payer can read off one screen and type into another — no 0/O, no 1/I/L. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * The sandbox funding rail — it issues a reference and, deliberately, **cannot confirm anything**.
 *
 * It would be one line to have `open()` return "paid" and it would teach every screen and every test above
 * it that money arrives the instant you ask for it, which is the single most misleading thing a stub can
 * do. A real C2B payment is somebody walking to a kiosk; the confirmation arrives minutes later on a
 * callback, and sometimes it does not arrive at all. So a sandbox top-up sits in `awaiting` until a signed
 * confirmation comes through the callback door — in a live deployment from the provider, in the sandbox
 * from the operator's Money screen. **Both go through the same door, and the same signature check.**
 *
 * WHAT IT DOES DO PROPERLY IS VERIFY. Signature, replay window, and a payment shape it will not guess at.
 * That is not sandbox dressing: a webhook anybody can post to is not an improvement on the shop's own word,
 * it is everybody's word, and it would hand the power to create money to whoever finds the URL.
 */
@Injectable()
export class SandboxFundingRail implements FundingRail {
  readonly provider = 'sandbox';

  /**
   * The signing secret. Printed in this file for the sandbox, and REFUSED outside one — the same rule as
   * the vault key, for a sharper reason: this secret is the authority to create money on our books.
   */
  private readonly secret = deploymentSecret('GLOS_FUNDING_SECRET', 'glos-dev-funding-secret-change-me');

  async open(instruction: FundingInstruction): Promise<RailOpening> {
    const reference = this.reference();
    const amount = instruction.amount.toFixed(2);
    /*
     * The payer's words — PROVIDER facts only, and short.
     *
     * Two rules held this apart from the screen's own copy. What a provider needs (pay this much, quote
     * this) belongs to the rail and travels with the request, so no screen can drift from what the
     * provider actually requires. What happens to the payer's balance afterwards is OUR policy and is
     * said by the screen, once, under the reference. Saying it in both places made a nine-line block on a
     * phone that repeated itself — and long blocks are what people stop reading.
     *
     * The sandbox line stays here because it is a fact about the RAIL: a shopkeeper reading "your float
     * will be credited shortly" from a rail that cannot receive a shilling has been told something false
     * by us, and they will stand at the till waiting for it.
     */
    const instructions = [
      // The reference is not repeated here: the screen shows it in full, in the one place it can be read
      // off and typed without a mistake.
      `Pay ${amount} ${instruction.currency} and quote the reference below.`,
      isSandbox() ? `SANDBOX: no real payment can reach us — network staff stand in for the provider.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { reference, instructions };
  }

  /**
   * Is this really from the provider, and what does it say?
   *
   * Signed over a CANONICAL FIELD LIST rather than the raw body: every real provider signs its own
   * envelope its own way, and translating to our normalised shape is exactly what an adapter is for. A
   * Daraja adapter verifies Daraja's scheme here and hands back the same `RailPayment`; nothing above this
   * line learns a provider's dialect.
   */
  async verify(headers: Record<string, string | undefined>, body: unknown, _meta?: CallbackMeta): Promise<RailPayment> {
    const payload = (body ?? {}) as Record<string, unknown>;
    const providerRef = String(payload.providerRef ?? '').trim();
    const amount = Number(payload.amount);
    const currency = String(payload.currency ?? '').trim().toUpperCase();
    if (!providerRef) throw new GlosError('CALLBACK_INVALID', 'A confirmation must carry the provider’s own reference');
    if (!Number.isFinite(amount)) throw new GlosError('CALLBACK_INVALID', 'A confirmation must carry the amount that was paid');
    if (!currency) throw new GlosError('CALLBACK_INVALID', 'A confirmation must say what currency was paid');

    const timestamp = String(headers['x-sbg-timestamp'] ?? '').trim();
    const signature = String(headers['x-sbg-signature'] ?? '').trim();
    if (!timestamp || !signature) throw new GlosError('CALLBACK_UNSIGNED', 'This confirmation is not signed');

    const age = Math.abs(Date.now() - Number(timestamp));
    if (!Number.isFinite(age) || age > REPLAY_WINDOW_MS) {
      // A replayed body is a signed body — the signature alone cannot tell you it is being sent for the
      // second time an hour later. Only the clock can.
      throw new GlosError('CALLBACK_STALE', 'This confirmation is too old to accept');
    }

    const reference = String(payload.reference ?? '').trim();
    const fee = Number.isFinite(Number(payload.fee)) ? Number(payload.fee) : 0;
    const paidAt = payload.paidAt ? String(payload.paidAt) : undefined;
    const expected = this.sign(timestamp, { providerRef, reference, amount, currency, fee, paidAt });
    const given = Buffer.from(signature, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new GlosError('CALLBACK_UNSIGNED', 'This confirmation is not signed by the payment provider');
    }

    return {
      provider: this.provider,
      providerRef,
      reference: reference || undefined,
      amount,
      currency,
      fee,
      paidAt,
      payerLabel: payload.payerLabel ? String(payload.payerLabel) : undefined,
    };
  }

  /**
   * A signed callback, exactly as the provider would send one — so that "confirm" in a sandbox demo goes
   * THROUGH the signature check rather than around it. See FundingRail.simulate.
   */
  simulate(payment: Omit<RailPayment, 'provider'>): { headers: Record<string, string>; body: Record<string, unknown> } {
    if (!isSandbox()) throw new GlosError('FORBIDDEN', 'Payments are confirmed by the provider, never by us');
    const timestamp = String(Date.now());
    const fields = {
      providerRef: payment.providerRef,
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      fee: payment.fee ?? 0,
      paidAt: payment.paidAt,
    };
    return {
      headers: { 'x-sbg-timestamp': timestamp, 'x-sbg-signature': this.sign(timestamp, fields) },
      body: { ...fields, payerLabel: payment.payerLabel },
    };
  }

  /**
   * The signature a caller must produce. One implementation, used by both `verify` and `simulate`, so the
   * sandbox cannot drift into accepting something a real callback would never send.
   */
  sign(timestamp: string, fields: { providerRef: string; reference?: string; amount: number; currency: string; fee?: number; paidAt?: string }): string {
    const canonical = [timestamp, fields.providerRef, fields.reference ?? '', fields.amount.toFixed(2), fields.currency, (fields.fee ?? 0).toFixed(2), fields.paidAt ?? ''].join('|');
    return createHmac('sha256', this.secret).update(canonical).digest('hex');
  }

  private reference(): string {
    const bytes = randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `SBG-${out.slice(0, 4)}-${out.slice(4)}`;
  }
}
