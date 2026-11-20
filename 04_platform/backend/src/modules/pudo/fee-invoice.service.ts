import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { escapeHtml } from '../../foundation/mail/mail.blocks';
import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DirectPayService } from './direct-pay.service';
import type { DirectPayment } from './direct-pay.types';
import { NotificationService } from './notification.service';

/** The tax on our fee, per country of the company that invoices it: the Netherlands' standard rate (the owner: "with BTW"). */
export const FEE_TAX_RATE: Readonly<Record<string, number>> = { NL: 0.21 };
/** How often the server looks for a month to invoice. */
const LOOK_EVERY_MS = 60 * 60_000;

export interface FeeInvoiceParty {
  name: string;
  registrationNumber?: string;
  vatNumber?: string;
  address?: string;
}

export interface FeeInvoiceLine {
  paymentId: string;
  code: string;
  paidAt: string;
  /** Our fee as Mollie took it: tax included. */
  fee: number;
}

/**
 * 2026-11-20 — OUR FEE, INVOICED ONCE A MONTH (the payments plan, part 2c; the owner: "taking the fee is allowed but makes me
 * eligible for income tax" — "the invoices are already paid because we took a cut"). Mollie takes our fee from each payment
 * and invoices none of it, so the country's company invoices each carrier for a month's fees: numbered in one unbroken series
 * per company and year, the tax said, and paid on the day it is made. Test payments move no money: theirs is a series of its
 * own, marked as a test, so the real one never has a gap or a test in it.
 */
export interface FeeInvoice {
  invoiceId: string;
  number: string;
  test: boolean;
  entityId: string;
  country: string;
  payeeId: string;
  /** The calendar month invoiced, YYYY-MM (UTC). */
  month: string;
  issuedAt: string;
  currency: string;
  rate: number;
  /** Tax included, as Mollie took it. */
  gross: number;
  net: number;
  tax: number;
  lines: FeeInvoiceLine[];
  seller: FeeInvoiceParty;
  buyer: FeeInvoiceParty;
}

export class FeeInvoiceRow {
  @ApiProperty() invoiceId: string;
  @ApiProperty() number: string;
  @ApiProperty() test: boolean;
  @ApiProperty() month: string;
  @ApiProperty() issuedAt: string;
  @ApiProperty() currency: string;
  @ApiProperty() gross: number;
  @ApiProperty() payments: number;
}

export class FeeInvoiceList {
  @ApiProperty({ type: [FeeInvoiceRow] }) items: FeeInvoiceRow[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const monthOf = (iso: string): string => iso.slice(0, 7);
const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** A month's fees as one invoice's figures: the tax worked back out of what Mollie took, never added on top. */
export function feeTotals(fees: number[], rate: number): { gross: number; net: number; tax: number } {
  const gross = round2(fees.reduce((s, f) => s + f, 0));
  const net = round2(gross / (1 + rate));
  return { gross, net, tax: round2(gross - net) };
}

@Injectable()
export class FeeInvoiceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('FeeInvoices');
  private readonly invoices = new PersistentMap<string, FeeInvoice>('fee-invoices');
  /** The last number given, per company, year and series: `${entityId}:${year}:${test ? 'test' : 'real'}`. */
  private readonly counters = new PersistentMap<string, number>('fee-invoice-counters');
  private timer?: ReturnType<typeof setInterval>;
  private saidNoCompany = false;

  constructor(
    private readonly direct: DirectPayService,
    private readonly mollie: MollieConnectService,
    private readonly entities: EntityService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    void this.issueDue().catch((err) => this.logger.warn(`fee invoices: ${(err as Error).message}`));
    this.timer = setInterval(() => void this.issueDue().catch(() => undefined), LOOK_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * EVERY MONTH THAT HAS ENDED, INVOICED ONCE: per carrier, per series, the fees of the payments Mollie confirmed paid in it.
   * A month already invoiced is not invoiced again; a carrier in a country where no company of ours is recorded waits.
   */
  async issueDue(now: number = Date.now()): Promise<FeeInvoice[]> {
    const thisMonth = monthOf(new Date(now).toISOString());
    const groups = new Map<string, DirectPayment[]>();
    for (const p of this.direct.paidWithFee()) {
      const month = monthOf(p.paidAt as string);
      if (month >= thisMonth) continue;
      const key = `${p.payeeId}|${month}|${p.testmode ? 'test' : 'real'}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const made: FeeInvoice[] = [];
    for (const [key, payments] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [payeeId, month, series] = key.split('|');
      const test = series === 'test';
      if ([...this.invoices.values()].some((i) => i.payeeId === payeeId && i.month === month && i.test === test)) continue;
      const country = 'NL';
      const company = this.entities.sisterRecordFor(country);
      // No company of ours recorded there: nothing can be invoiced yet — said once in the log, made the day it is recorded.
      if (!company) {
        if (!this.saidNoCompany) this.logger.warn(`fee invoices wait: no company of ours is recorded in ${country}`);
        this.saidNoCompany = true;
        continue;
      }
      const rate = FEE_TAX_RATE[country] ?? 0;
      const lines = payments
        .map((p) => ({ paymentId: p.paymentId, code: p.code, paidAt: p.paidAt as string, fee: p.fee as number }))
        .sort((a, b) => a.paidAt.localeCompare(b.paidAt));
      const totals = feeTotals(lines.map((l) => l.fee), rate);
      const year = month.slice(0, 4);
      const counterKey = `${company.entityId}:${year}:${series}`;
      const next = (this.counters.get(counterKey) ?? 0) + 1;
      this.counters.set(counterKey, next);
      const inv: FeeInvoice = {
        invoiceId: `fi_${randomBytes(9).toString('base64url')}`,
        number: `${test ? 'TEST-' : ''}${country}-${year}-${String(next).padStart(5, '0')}`,
        test,
        entityId: company.entityId,
        country,
        payeeId,
        month,
        issuedAt: new Date(now).toISOString(),
        currency: payments[0].currency,
        rate,
        ...totals,
        lines,
        seller: this.sellerOf(company),
        buyer: this.buyerOf(payeeId),
      };
      this.invoices.set(inv.invoiceId, inv);
      made.push(inv);
      await this.tell(inv);
    }
    return made;
  }

  listFor(payeeId: string): FeeInvoiceList {
    const items = [...this.invoices.values()]
      .filter((i) => i.payeeId === payeeId)
      .sort((a, b) => b.month.localeCompare(a.month) || Number(a.test) - Number(b.test))
      .map((i) => ({ invoiceId: i.invoiceId, number: i.number, test: i.test, month: i.month, issuedAt: i.issuedAt, currency: i.currency, gross: i.gross, payments: i.lines.length }));
    return { items };
  }

  /** The invoice as its printable page — only to the carrier it is made out to. */
  html(invoiceId: string, payeeId: string): string {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.payeeId !== payeeId) throw new GlosError('NOT_FOUND', 'No such invoice');
    return invoiceHtml(inv);
  }

  private sellerOf(company: { entityId: string; name?: string; record?: { legalName?: string; registrationNumber?: string; registeredAddress?: { line1: string; line2?: string; postalCode?: string; city: string; country: string }; taxRegistrations?: Array<{ kind: string; number: string }> } }): FeeInvoiceParty {
    const r = company.record;
    const a = r?.registeredAddress;
    const vat = r?.taxRegistrations?.find((t) => t.kind === 'vat')?.number;
    return {
      name: r?.legalName || company.name || 'SeeBuyGet',
      ...(r?.registrationNumber ? { registrationNumber: r.registrationNumber } : {}),
      ...(vat ? { vatNumber: vat } : {}),
      ...(a ? { address: [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') } : {}),
    };
  }

  /** The carrier's company as Mollie knows it, from the connection; failing that, only who it is. */
  private buyerOf(payeeId: string): FeeInvoiceParty {
    const o = this.mollie.connection(payeeId)?.organization;
    const a = o?.address;
    const address = a ? [a.streetAndNumber, [a.postalCode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') : '';
    return {
      name: o?.name || payeeId,
      ...(o?.registrationNumber ? { registrationNumber: o.registrationNumber } : {}),
      ...(o?.vatNumber ? { vatNumber: o.vatNumber } : {}),
      ...(address ? { address } : {}),
    };
  }

  private async tell(inv: FeeInvoice): Promise<void> {
    if (!this.notifications) return;
    try {
      await this.notifications.notify(inv.payeeId, {
        kind: 'fee_invoice',
        title: `${inv.test ? 'Test invoice' : 'Invoice'} ${inv.number}: our fee for ${monthWords(inv.month)}`,
        body: `${inv.currency} ${inv.gross.toFixed(2)} for ${inv.lines.length} payment${inv.lines.length === 1 ? '' : 's'} by Mollie, tax included. Already paid: Mollie took it from the payments. It is in Settings, under Mollie.`,
        tag: `fee-invoice:${inv.invoiceId}`,
        data: { invoiceId: inv.invoiceId },
      });
    } catch (err) {
      this.logger.warn(`fee invoice ${inv.number} could not be told: ${(err as Error).message}`);
    }
  }
}

function monthWords(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${y}`;
}

const euro = (n: number, currency: string): string => `${currency} ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The invoice as a page: Dutch first, the English beside it; every figure from the record, nothing worked out on the page. */
export function invoiceHtml(inv: FeeInvoice): string {
  const e = escapeHtml;
  const [y, m] = inv.month.split('-').map(Number);
  const period = `${MONTHS_NL[m - 1]} ${y}`;
  const party = (p: FeeInvoiceParty) =>
    [`<b>${e(p.name)}</b>`, p.address ? e(p.address) : '', p.registrationNumber ? `KvK / Chamber of Commerce: ${e(p.registrationNumber)}` : '', p.vatNumber ? `Btw / VAT: ${e(p.vatNumber)}` : ''].filter(Boolean).join('<br>');
  const rows = inv.lines.map((l) => `<tr><td>${e(l.paidAt.slice(0, 10))}</td><td>${e(l.code)}</td><td>${e(l.paymentId)}</td><td class="n">${e(euro(l.fee, inv.currency))}</td></tr>`).join('');
  const pct = `${Math.round(inv.rate * 100)}%`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${e(inv.number)}</title><style>body{font-family:system-ui,sans-serif;color:#1a1a1a;margin:24px;font-size:14px}h1{font-size:20px;margin:0 0 4px}.test{color:#b00020;font-weight:700}.parties{display:flex;gap:32px;margin:16px 0}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}.n{text-align:right}.paid{margin-top:12px;font-weight:600}</style></head><body>${inv.test ? '<p class="test">TESTFACTUUR — er is geen geld overgemaakt. / TEST INVOICE — no money moved.</p>' : ''}<h1>Factuur / Invoice ${e(inv.number)}</h1><p>Factuurdatum / Date: ${e(inv.issuedAt.slice(0, 10))} · Periode / Period: ${e(period)}</p><div class="parties"><div>Van / From<br>${party(inv.seller)}</div><div>Aan / To<br>${party(inv.buyer)}</div></div><p>Vergoeding voor serverkosten op betalingen via Mollie / Fee for server costs on payments by Mollie</p><table><thead><tr><th>Betaald / Paid</th><th>Lading / Load</th><th>Mollie</th><th class="n">Vergoeding / Fee</th></tr></thead><tbody>${rows}</tbody></table><table><tbody><tr><td>Bedrag excl. btw / Amount excl. VAT</td><td class="n">${e(euro(inv.net, inv.currency))}</td></tr><tr><td>Btw / VAT ${e(pct)}</td><td class="n">${e(euro(inv.tax, inv.currency))}</td></tr><tr><td><b>Totaal / Total</b></td><td class="n"><b>${e(euro(inv.gross, inv.currency))}</b></td></tr></tbody></table><p class="paid">Voldaan: ingehouden door Mollie op de betalingen hierboven. / Paid: taken by Mollie from the payments above.</p></body></html>`;
}
