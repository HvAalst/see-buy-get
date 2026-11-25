import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { appUrl } from '../mail/mail.templates';
import type { MollieConnectService } from '../mollie/mollie-connect.service';
import type { CallbackMeta, FundingInstruction, FundingRail, RailCallback, RailOpening } from './funding.types';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
/** What Mollie answers when it can no longer take the money: the payer is told, and nothing moves. */
const NOT_PAID: Record<string, string> = { failed: 'The payment failed', canceled: 'The payment was cancelled', expired: 'The payment was not made in time' };

/**
 * 2026-11-24 — MONEY PAID TO OUR DUTCH COMPANY ONLINE, THROUGH MOLLIE (route plan part 9; the owner: "the system will choose the
 * right method depending on the country without the user noticing it"). The payment hub's rail for euros: a payment on our own
 * Mollie account by iDEAL, its page opened by the app; Mollie's notice names only the payment, and the payment is asked of
 * Mollie before anything is credited — its provenance is Mollie's own answer, never the notice.
 */
export class MollieFundingRail implements FundingRail {
  readonly provider = 'mollie';

  constructor(private readonly mollie: MollieConnectService) {}

  /** Whether our own account can be paid now: its key, or the test key standing in. */
  ready(): boolean {
    return Boolean(this.mollie.ownToken());
  }

  async open(instruction: FundingInstruction): Promise<RailOpening> {
    const token = this.mollie.ownToken();
    if (!token) throw new GlosError('INVALID_STATE', 'Paying online is not set up here yet');
    const reference = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
    const base = this.mollie.cfg.publicBase;
    const hooked = base && !/\/\/(localhost|127\.|\[::1\])/.test(base);
    const body: Record<string, unknown> = {
      amount: { currency: instruction.currency.toUpperCase(), value: instruction.amount.toFixed(2) },
      description: `SeeBuyGet ${reference}`,
      method: 'ideal',
      redirectUrl: `${appUrl('send')}?paid=${encodeURIComponent(reference)}`,
      ...(hooked ? { webhookUrl: `${base}/v1/rails/funding/mollie/callback` } : {}),
      metadata: { fundingId: instruction.fundingId, reference, purpose: instruction.purpose },
      locale: 'nl_NL',
    };
    const made = await this.mollie.api().createPayment(token.bearer, body, `funding-${instruction.fundingId}`);
    const id = typeof made.id === 'string' ? made.id : '';
    const links = made._links as { checkout?: { href?: string } } | undefined;
    const link = links?.checkout?.href;
    if (!id || !link) throw new GlosError('INVALID_STATE', 'Mollie did not open the payment: try again in a moment');
    return { reference, railRef: id, link, provider: this.provider, instructions: 'Pay on the iDEAL page that opens.' };
  }

  /**
   * MOLLIE SAYS A PAYMENT CHANGED: its notice carries only the payment's id, so Mollie itself is asked what became of it. Paid is
   * money, with our reference from the payment's own metadata; failed, cancelled or expired is a straight answer that none is
   * coming. Still open is neither: refused, so Mollie asks again later.
   */
  async verify(_headers: Record<string, string | undefined>, body: unknown, _meta?: CallbackMeta): Promise<RailCallback> {
    const id = typeof (body as { id?: unknown })?.id === 'string' ? ((body as { id: string }).id) : '';
    if (!/^tr_[A-Za-z0-9]+$/.test(id)) throw new GlosError('VALIDATION_FAILED', 'A Mollie notice names its payment', { field: 'id' });
    const token = this.mollie.ownToken();
    if (!token) throw new GlosError('NOT_FOUND', 'No Mollie account of ours is set up here');
    const p = await this.mollie.api().getPayment(token.bearer, id, false);
    const status = typeof p.status === 'string' ? p.status : '';
    if (status === 'paid') {
      const amount = p.amount as { value?: string; currency?: string } | undefined;
      const meta = p.metadata as { reference?: string } | undefined;
      return {
        provider: this.provider,
        providerRef: id,
        ...(meta?.reference ? { reference: meta.reference } : {}),
        amount: Number(amount?.value ?? 0),
        currency: (amount?.currency ?? '').toUpperCase(),
        ...(typeof p.paidAt === 'string' ? { paidAt: p.paidAt } : {}),
        payerLabel: 'iDEAL',
      };
    }
    if (NOT_PAID[status]) return { provider: this.provider, paid: false, railRef: id, reason: NOT_PAID[status] };
    throw new GlosError('INVALID_STATE', `Mollie says payment ${id} is ${status || 'unknown'}: not final yet`);
  }
}
