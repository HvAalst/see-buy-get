import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { actingTenant } from '../../foundation/auth/acting';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { qrSvgGroup } from '../../foundation/label/qr';
import { escapeHtml } from '../../foundation/mail/mail.blocks';
import { MollieError } from '../../foundation/mollie/mollie-client';
import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import { directPayWayOf } from '../../foundation/mollie/mollie.types';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DispatchService, lockedCurrencyOf } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { DIRECT_PAY_FINAL, type DirectPayment, type DirectPayPaymentView, type DirectPayStatus, type DirectPayView } from './direct-pay.types';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { NETWORK_JURISDICTION } from './pudo.config';

/** An open payment is asked about again, when the driver's screen looks, no more often than this. */
const LOOK_EVERY_MS = 5_000;
const STATUSES: readonly DirectPayStatus[] = ['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed'];

/**
 * Mollie's own ceiling on a platform's fee: the payment, less what Mollie keeps — €0.35 and 6% (docs.mollie.com, application
 * fees, read 19 November 2026). A fee above it is not asked for at all: a payment refused for its fee helps nobody.
 */
export function feeAllowed(amount: number, fee: number): boolean {
  return fee >= 0.01 && fee <= amount - (0.35 + 0.06 * amount);
}

/**
 * 2026-11-19 — A PAYMENT AT THE HANDOVER, STRAIGHT TO THE CARRIER (the payments plan, part 2b; the owner: "Netherlands: Mollie",
 * "a small fee for server costs"). On a load the shipper pays directly, the driver asks for the price agreed; the payment is
 * made on the Mollie account of whoever is paid for the load — the courier's own, or its fleet's — and its page is shown as a
 * QR code for the payer to scan. Mollie says when it is paid, and the load is marked paid by Mollie's word, not the driver's.
 * The money goes into the carrier's balance; Mollie takes our fee from it, where the country's company set one.
 */
@Injectable()
export class DirectPayService {
  private readonly logger = new Logger('DirectPay');
  private readonly payments = new PersistentMap<string, DirectPayment>('direct-payments');
  private readonly latest = new PersistentMap<string, string>('direct-payments-by-load');

  constructor(
    private readonly mollie: MollieConnectService,
    private readonly dispatch: DispatchService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly entities: EntityService,
  ) {}

  /** What the driver's screen shows for this load: whether it can be paid by Mollie now, the fee, and the latest payment. */
  view(freightId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): DirectPayView {
    const f = this.dispatch.requireFreightPublic(freightId);
    this.assertMayAsk(f, actor);
    return this.viewOf(f, actor, now);
  }

  /** The same, after asking Mollie about an open payment — for a screen without Mollie's notice (a laptop, a lost one). */
  async look(freightId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): Promise<DirectPayView> {
    const f = this.dispatch.requireFreightPublic(freightId);
    this.assertMayAsk(f, actor);
    const p = this.latestFor(f.freightId);
    if (p && !DIRECT_PAY_FINAL.includes(p.status) && (!p.checkedAt || now - Date.parse(p.checkedAt) >= LOOK_EVERY_MS)) await this.refresh(p, now).catch(() => undefined);
    return this.viewOf(this.dispatch.requireFreightPublic(freightId), actor, now);
  }

  /**
   * ASK FOR THE PRICE AGREED: a payment on the carrier's own account, its page as a QR code. One still open is shown again,
   * never a second one beside it; one that lapsed or failed is followed by a new one.
   */
  async ask(freightId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): Promise<DirectPayView> {
    const f = this.dispatch.requireFreightPublic(freightId);
    this.assertMayAsk(f, actor);
    const can = this.viewOf(f, actor, now);
    if (!can.available) throw new GlosError('INVALID_STATE', refusalOf(can.why));
    const open = this.latestFor(f.freightId);
    if (open && !DIRECT_PAY_FINAL.includes(open.status) && (!open.expiresAt || Date.parse(open.expiresAt) > now)) return can;
    const { payeeId } = this.payeeOf(f);
    const token = await this.mollie.tokenFor(payeeId, now);
    const amount = f.lockedPrice as number;
    const fee = token.via === 'oauth' ? can.fee : undefined;
    const ref = randomBytes(12).toString('base64url');
    const base = this.mollie.cfg.publicBase;
    const hooked = base && !/\/\/(localhost|127\.|\[::1\])/.test(base);
    const tries = [...this.payments.values()].filter((p) => p.freightId === f.freightId).length;
    const body: Record<string, unknown> = {
      amount: { currency: 'EUR', value: amount.toFixed(2) },
      description: `SeeBuyGet ${f.code}: ${f.pickupLabel} → ${f.destLabel}`.slice(0, 255),
      redirectUrl: `${base ?? ''}/v1/sbg/mollie/paid/${ref}`,
      ...(hooked ? { webhookUrl: `${base}/v1/sbg/mollie/webhook` } : {}),
      metadata: { freightId: f.freightId, code: f.code },
      locale: 'nl_NL',
      ...(token.via === 'oauth' ? { profileId: token.profileId, ...(token.testmode ? { testmode: true } : {}) } : {}),
      ...(fee ? { applicationFee: { amount: { currency: 'EUR', value: fee.toFixed(2) }, description: `SeeBuyGet, server costs, ${f.code}`.slice(0, 255) } } : {}),
    };
    let made: Record<string, unknown>;
    try {
      made = await this.mollie.api().createPayment(token.bearer, body, `${f.freightId}-${tries + 1}`);
    } catch (err) {
      throw asOurs(err);
    }
    const paymentId = String(made.id ?? '');
    if (!paymentId.startsWith('tr_')) throw new GlosError('PROVIDER_UNAVAILABLE', 'Mollie did not give back a payment');
    const p: DirectPayment = {
      paymentId,
      ref,
      freightId: f.freightId,
      code: f.code,
      payeeId,
      via: token.via,
      testmode: token.testmode,
      amount,
      currency: 'EUR',
      ...(fee ? { fee } : {}),
      status: statusOf(made.status) ?? 'open',
      ...(checkoutOf(made) ? { checkoutUrl: checkoutOf(made) } : {}),
      createdAt: new Date(now).toISOString(),
      ...(typeof made.expiresAt === 'string' ? { expiresAt: made.expiresAt } : {}),
      checkedAt: new Date(now).toISOString(),
      askedBy: actor?.did ?? 'unknown',
    };
    this.payments.set(paymentId, p);
    this.latest.set(f.freightId, paymentId);
    return this.viewOf(f, actor, now);
  }

  /**
   * MOLLIE'S NOTICE: only a payment's id, never its status and never signed — so the payment is asked for from Mollie, on the
   * carrier's own token, and that answer is what counts. An id that is not ours is answered and ignored.
   */
  async onWebhook(paymentId: string, now: number = Date.now()): Promise<void> {
    const p = this.payments.get(paymentId);
    if (!p) return;
    await this.refresh(p, now);
  }

  /** Every payment Mollie confirmed paid that carried our fee — what the monthly fee invoices are made from (part 2c). */
  paidWithFee(): DirectPayment[] {
    return [...this.payments.values()].filter((p) => p.status === 'paid' && p.paidAt && p.fee && p.fee > 0);
  }

  /** The page the payer comes back to after Mollie's checkout: how the payment went, in Dutch and English, nothing else. */
  paidPage(ref: string): string {
    const p = [...this.payments.values()].find((x) => x.ref === ref);
    const said =
      !p
        ? { nl: 'Deze link is onbekend.', en: 'This link is not known.' }
        : p.status === 'paid'
          ? { nl: 'Betaald. De chauffeur ziet het in de app.', en: 'Paid. The driver sees it in the app.' }
          : DIRECT_PAY_FINAL.includes(p.status)
            ? { nl: 'Niet betaald. Vraag de chauffeur om een nieuwe code.', en: 'Not paid. Ask the driver for a new code.' }
            : { nl: 'Nog niet bevestigd. Heb je betaald, dan ziet de chauffeur het binnen een minuut.', en: 'Not confirmed yet. If you paid, the driver sees it within a minute.' };
    const load = p ? `<p class="load">${escapeHtml(p.code)}</p>` : '';
    return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SeeBuyGet</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 20px;background:#f7f7f8;color:#1a1a1a;text-align:center}main{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 20px}p{font-size:18px;line-height:1.45;margin:0 0 12px}.en{color:#555;font-size:16px}.load{color:#777;font-size:14px}</style></head><body><main>${load}<p>${escapeHtml(said.nl)}</p><p class="en" lang="en">${escapeHtml(said.en)}</p></main></body></html>`;
  }

  private async refresh(p: DirectPayment, now: number): Promise<void> {
    const token = await this.mollie.tokenFor(p.payeeId, now);
    let got: Record<string, unknown>;
    try {
      got = await this.mollie.api().getPayment(token.bearer, p.paymentId, p.via === 'oauth' && p.testmode);
    } catch (err) {
      throw asOurs(err);
    }
    const status = statusOf(got.status) ?? p.status;
    const paidAt = typeof got.paidAt === 'string' ? got.paidAt : undefined;
    const next: DirectPayment = { ...p, status, ...(paidAt ? { paidAt } : {}), checkedAt: new Date(now).toISOString(), ...(typeof got.expiresAt === 'string' ? { expiresAt: got.expiresAt } : {}) };
    this.payments.set(p.paymentId, next);
    if (status !== 'paid') return;
    // Paid what was asked, in the money asked for: anything else is somebody else's payment, and marks nothing paid.
    const amount = got.amount as { currency?: string; value?: string } | undefined;
    if (amount?.currency !== p.currency || Number(amount?.value) !== p.amount) {
      this.logger.warn(`Mollie payment ${p.paymentId} for ${p.code} came back for ${amount?.currency} ${amount?.value}, not ${p.currency} ${p.amount}: not marked paid`);
      return;
    }
    try {
      this.dispatch.confirmPaidDirect(p.freightId, 'mollie', paidAt ? Date.parse(paidAt) : now, p.paymentId);
    } catch (err) {
      this.logger.warn(`Mollie payment ${p.paymentId} is paid, but ${p.code} could not be marked paid: ${(err as Error).message}`);
    }
  }

  private viewOf(f: Freight, actor: IntrospectionResult | undefined, now: number): DirectPayView {
    const p = this.latestFor(f.freightId);
    const payment = p ? this.paymentView(p, now) : undefined;
    const with_ = (v: DirectPayView): DirectPayView => ({ ...v, ...(payment ? { payment } : {}) });
    if (f.settlement !== 'between_parties') return { available: false, why: 'not_direct' };
    if (f.paidDirect) return with_({ available: false, why: 'paid' });
    if (f.lockedPrice == null) return with_({ available: false, why: 'no_price' });
    const { payeeId, country, fleet } = this.payeeOf(f);
    const currency = lockedCurrencyOf(f);
    if (directPayWayOf(country) !== 'mollie' || !this.mollie.via()) return with_({ available: false, why: 'not_mollie' });
    if (currency !== 'EUR') return with_({ available: false, why: 'not_eur' });
    const c = this.mollie.connection(payeeId);
    if (!c || c.lostAt) return with_({ available: false, why: fleet && actor?.role === 'driver' ? 'office_connects' : 'not_connected' });
    const fee = c.via === 'oauth' ? this.feeFor(country, f.lockedPrice) : undefined;
    return with_({ available: true, amount: f.lockedPrice, currency, ...(fee ? { fee } : {}), testmode: c.testmode });
  }

  private paymentView(p: DirectPayment, now: number): DirectPayPaymentView {
    const payable = !DIRECT_PAY_FINAL.includes(p.status) && (!p.expiresAt || Date.parse(p.expiresAt) > now) && p.checkoutUrl;
    return {
      paymentId: p.paymentId,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      ...(p.fee ? { fee: p.fee } : {}),
      testmode: p.testmode,
      ...(payable ? { checkoutUrl: p.checkoutUrl, qrSvg: qrSvgOf(p.checkoutUrl as string) } : {}),
      ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}),
      ...(p.paidAt ? { paidAt: p.paidAt } : {}),
    };
  }

  /** Our fee from the country's company list: nothing where it set none, or where Mollie would not allow it on this payment. */
  private feeFor(country: string, amount: number): number | undefined {
    const company = this.entities.sisterRecordFor(country);
    const fee = company ? this.entities.amountsFor(company.entityId).directPayFee : 0;
    return fee && feeAllowed(amount, fee) ? Math.round(fee * 100) / 100 : undefined;
  }

  /** Who is paid for the load: a courier itself, a fleet driver's fleet — and where that carrier is. */
  private payeeOf(f: Freight): { payeeId: string; country: string; fleet: boolean } {
    const driverDid = f.claimedBy;
    if (!driverDid) throw new GlosError('INVALID_STATE', 'No driver has taken this load yet');
    const driver = this.drivers.get(driverDid);
    if (driver.managerDid) {
      const fleet = this.managers.get(driver.managerDid);
      return { payeeId: fleet.did, country: fleet.jurisdiction ?? driver.jurisdiction ?? NETWORK_JURISDICTION, fleet: true };
    }
    return { payeeId: driver.did, country: driver.jurisdiction ?? NETWORK_JURISDICTION, fleet: false };
  }

  /** The driver the load is on, or the office of the fleet that is paid for it. Nobody else asks for its price. */
  private assertMayAsk(f: Freight, actor: IntrospectionResult | undefined): void {
    if (actor?.role === 'driver' && actor.did && actor.did === f.claimedBy) return;
    if (actor?.role === 'fleet_manager' && f.claimedBy) {
      const driver = this.drivers.get(f.claimedBy);
      if (driver.managerDid && driver.managerDid === actingTenant(actor)) return;
    }
    throw new GlosError('FORBIDDEN', 'This load is not on you');
  }

  private latestFor(freightId: string): DirectPayment | undefined {
    const id = this.latest.get(freightId);
    return id ? this.payments.get(id) : undefined;
  }
}

function statusOf(v: unknown): DirectPayStatus | undefined {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v) ? (v as DirectPayStatus) : undefined;
}

function checkoutOf(made: Record<string, unknown>): string | undefined {
  const href = (made._links as Record<string, { href?: string }> | undefined)?.checkout?.href;
  return typeof href === 'string' && href.startsWith('https://') ? href : undefined;
}

/** The QR code of Mollie's payment page, as a whole drawing: scanned with a phone's camera, it opens that page. */
function qrSvgOf(url: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" role="img">${qrSvgGroup(url, 0, 0, 240, 'M')}</svg>`;
}

function refusalOf(why?: DirectPayView['why']): string {
  switch (why) {
    case 'not_direct':
      return 'SeeBuyGet pays the carrier for this load: there is nothing for the shipper to pay here';
    case 'paid':
      return 'This load is paid already';
    case 'no_price':
      return 'No price is agreed for this load yet';
    case 'not_eur':
      return 'Mollie takes payments in euros here, and this load’s price is not in euros';
    case 'not_connected':
      return 'Connect Mollie in Settings first';
    case 'office_connects':
      return 'The company you drive for connects Mollie first';
    default:
      return 'Payments by Mollie are for carriers in the Netherlands';
  }
}

/** Mollie's refusal, said as ours: a payment it will not take (its own words), a connection to make again, or Mollie away. */
function asOurs(err: unknown): GlosError {
  if (err instanceof GlosError) return err;
  if (err instanceof MollieError) {
    if (err.status === 401 || err.status === 403) return new GlosError('INVALID_STATE', 'Mollie refused this account: connect Mollie again in Settings');
    if (err.status === 422 || err.status === 400) return new GlosError('INVALID_INPUT', `Mollie did not take the payment: ${err.detail || err.title}`);
  }
  return new GlosError('PROVIDER_UNAVAILABLE', 'Mollie did not answer: try again in a moment');
}
