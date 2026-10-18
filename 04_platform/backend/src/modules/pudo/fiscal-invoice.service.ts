import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES, type AccountCode, type JournalEntry } from '../../foundation/books/books.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { fiscalWayOf } from '../../foundation/fiscal/fiscal-ways';
import { GlosError } from '../../foundation/http/glos-error';
import { escapeHtml } from '../../foundation/mail/mail.blocks';
import { qrSvgGroup } from '../../foundation/label/qr';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { BAND_RATES, bandFor, cuInvoiceNo, dashed, kenyaStamp, saleRequest, verifyUrl } from './etims';
import { ETIMS_RAIL, type EtimsRail } from './etims-rail.adapter';
import type { EtimsReceipt, EtimsState, EtimsStatus, FiscalBuyer, FiscalInvoice, FiscalInvoiceList } from './fiscal-invoice.types';
import { ParcelService } from './parcel.service';
import type { Parcel } from './pudo.types';
import { VendorService } from './vendor.service';

/**
 * TAX INVOICES, KENYA ONLY (the user, 2026-10-18: "KRA eTIMS invoices"; "make sure eTIMS is only used for kenya as it
 * not applies to any other country").
 *
 * MADE FROM THE BOOKS. Every sale is already a books entry: a shop's or a store's shipping, the fee on a top-up; and
 * every sale given back is one too: a refund, a rebate. This listens to the books, so no path that charges can forget an
 * invoice — and reads the company that POSTED it: only a Kenyan company's entries are invoiced (fiscal-ways.ts). A top-up
 * that comes back is not a credit note: the fee on it is not given back (WalletGateService.reverseTopUp).
 *
 * NUMBERED BEFORE ANYTHING IS SENT, one unbroken series per company, and sent to eTIMS in that order on its own time: a
 * counter never waits on KRA. One KRA refused holds back the ones after it, so KRA never receives a number before the
 * one it follows. One that cannot be sent at all — a rate with no band in eTIMS — gets no number, so it leaves no gap.
 *
 * NOT REGISTERED YET: nothing here reaches KRA unless a server is given KRA's device (etims-rail.adapter.ts).
 */

/** What a company sells, and what gives a sale back. */
const SALE_KINDS = new Set(['shipping', 'top-up']);
const CREDIT_KINDS = new Set(['refund', 'rebate']);
/** The lines a price is made of: what was earned, the exchange buffer, the risk cover, and the tax. */
const PRICE_CODES = new Set<AccountCode>([ACCOUNT_CODES.REVENUE, ACCOUNT_CODES.FX_GAINLOSS, ACCOUNT_CODES.PROVISION_CLAIMS, ACCOUNT_CODES.PAYABLE_TAX]);
/** Whose money paid it: a shop's float or its credit line, or a store's float. */
const SHOP_CODES = new Set<AccountCode>([ACCOUNT_CODES.DEPOSIT_AGENT, ACCOUNT_CODES.RECEIVABLE_AGENT]);
const SEND_EVERY_MS = 60_000;
/** At most this many sent in one go, so a backlog on the day eTIMS is set up does not hold the server. */
const SENDS_PER_GO = 200;
/** What a person who sent their own parcel is called on the invoice: we keep no name for them, and KRA asks none. */
const PERSON = 'Cash customer';

@Injectable()
export class FiscalInvoiceService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FiscalInvoiceService.name);
  private readonly invoices = new PersistentMap<string, FiscalInvoice>('fiscal-invoices');
  /** The last number each company gave. Checked against the invoices at start, so a stop between the two never repeats one. */
  private readonly counters = new PersistentMap<string, number>('fiscal-counters');
  /** The request as first sent, kept while KRA's answer is not known: sent again, it is the same request. */
  private readonly requests = new PersistentMap<string, Record<string, unknown>>('fiscal-etims-requests');
  /** When each invoice's one original was handed to its buyer: every opening after it is a copy. */
  private readonly originals = new PersistentMap<string, { at: string }>('fiscal-originals');
  private readonly byEntry = new Map<string, string>();
  /** The last number each company gave, as numbering reads it — the counters' own copy, ahead of a batch's write. */
  private readonly last = new Map<string, number>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();
  private stopListening?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  /** An entry posted while making its invoice failed: the next round looks through the books for it. */
  private missed = false;

  constructor(
    private readonly books: BooksService,
    private readonly entities: EntityService,
    private readonly agents: AgentService,
    private readonly vendors: VendorService,
    private readonly parcels: ParcelService,
    @Optional() @Inject(ETIMS_RAIL) private readonly rail?: EtimsRail | null,
  ) {}

  onModuleInit(): void {
    for (const [entityId, n] of this.counters.entries()) this.last.set(entityId, n);
    for (const inv of this.invoices.values()) {
      this.byEntry.set(inv.entryId, inv.invoiceId);
      if (inv.number > (this.last.get(inv.entityId) ?? 0)) {
        this.last.set(inv.entityId, inv.number);
        this.counters.set(inv.entityId, inv.number);
      }
    }
    this.stopListening = this.books.onPosted((entry) => {
      try {
        const made = this.make(entry);
        // Sent once whatever posted it has finished: sendFor starts its work on the next turn.
        if (made?.number) void this.sendFor(made.entityId);
      } catch (err) {
        this.missed = true;
        throw err;
      }
    });
  }

  onApplicationBootstrap(): void {
    this.catchUp();
    void this.sendAll();
    this.timer = setInterval(() => {
      if (this.missed) this.catchUp();
      void this.sendAll();
    }, SEND_EVERY_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopListening?.();
    if (this.timer) clearInterval(this.timer);
    await this.settled();
  }

  /** Every send under way, finished. */
  async settled(): Promise<void> {
    while (this.flights.size) await Promise.allSettled([...this.flights.values()]);
  }

  /** Where invoices go on this server: KRA, the laptop stand-in, or nowhere yet. */
  railOf(): Pick<FiscalInvoiceList, 'rail' | 'env'> {
    if (!this.rail) return { rail: 'not_set_up' };
    return this.rail.kind === 'kra' ? { rail: 'kra', env: this.rail.env } : { rail: 'stand_in' };
  }

  /* ------------------------------------------------------------ making one -- */

  /**
   * The invoice for one books entry, where it is a Kenyan company's sale or a sale it gave back. Made once. With `batch`,
   * kept there for the caller to write all together.
   */
  make(entry: JournalEntry, batch?: FiscalInvoice[]): FiscalInvoice | undefined {
    const kind = SALE_KINDS.has(entry.kind) ? 'sale' : CREDIT_KINDS.has(entry.kind) ? 'credit' : undefined;
    if (!kind || this.byEntry.has(entry.entryId)) return undefined;
    const entity = this.entities.find(entry.entityId);
    // KENYA ONLY: eTIMS is KRA's, and applies to no other country's sales (fiscal-ways.ts).
    if (!entity || fiscalWayOf(entity.jurisdiction) !== 'etims') return undefined;
    let priceMinor = 0;
    let taxMinor = 0;
    let payer: { code: AccountCode; counterparty: string } | undefined;
    for (const line of entry.lines) {
      const account = this.books.accountById(line.accountId);
      if (!account) continue;
      if (PRICE_CODES.has(account.code)) priceMinor += line.amount;
      if (account.code === ACCOUNT_CODES.PAYABLE_TAX) taxMinor += line.amount;
      if (!payer && account.counterparty && (SHOP_CODES.has(account.code) || account.code === ACCOUNT_CODES.DEPOSIT_VENDOR)) payer = { code: account.code, counterparty: account.counterparty };
    }
    // A sale credits what it earns, a credit note debits it back. Nothing earned, nothing invoiced: a top-up with no fee sold nothing.
    const grossMinor = kind === 'sale' ? -priceMinor : priceMinor;
    if (grossMinor <= 0) return undefined;
    const taxAbs = Math.abs(taxMinor);
    const gross = grossMinor / 100;
    const tax = taxAbs / 100;
    const net = (grossMinor - taxAbs) / 100;
    const parcel = entry.kind !== 'top-up' && entry.ref ? this.parcelOrNone(entry.ref) : undefined;
    const { buyer, paidBy } = this.buyerOf(payer, parcel);
    const original = kind === 'credit' ? this.saleFor(entity.entityId, entry.ref, buyer) : undefined;
    const band = bandFor(net, tax);
    const ratePct = band ? BAND_RATES[band] : net > 0 ? Math.round((tax / net) * 10_000) / 100 : 0;
    const why =
      entry.currency !== 'KES'
        ? `eTIMS records Kenyan shillings, not ${entry.currency}`
        : !band
          ? `A tax of ${ratePct}% has no band in eTIMS (16% or 8%): not sent to KRA`
          : kind === 'credit' && !original
            ? 'The sale it gives back has no invoice: not sent to KRA'
            : undefined;
    const number = why ? 0 : (this.last.get(entity.entityId) ?? 0) + 1;
    const etims: EtimsStatus = why ? { state: 'not_sendable', tries: 0, note: why } : { state: 'waiting', tries: 0 };
    const inv: FiscalInvoice = {
      invoiceId: `fi_${randomBytes(8).toString('hex')}`,
      entityId: entity.entityId,
      seller: entity.name,
      ...(entity.taxRegistration ? { sellerPin: entity.taxRegistration } : {}),
      country: 'KE',
      number,
      kind,
      ...(original ? { originalNumber: original.number } : {}),
      entryId: entry.entryId,
      ...(entry.ref ? { ref: entry.ref } : {}),
      buyer,
      line: { description: this.describe(entry, parcel), net, tax, gross, ...(band ? { band } : {}), ratePct },
      currency: entry.currency,
      paidBy,
      at: entry.at,
      etims,
    };
    // The invoice first, then the counter: a stop between the two is mended at start (onModuleInit), never a number twice.
    if (batch) batch.push(inv);
    else this.invoices.set(inv.invoiceId, inv);
    if (number) {
      this.last.set(entity.entityId, number);
      if (!batch) this.counters.set(entity.entityId, number);
    }
    this.byEntry.set(entry.entryId, inv.invoiceId);
    return inv;
  }

  /** Every Kenyan sale in the books that has no invoice yet — an entry whose invoice failed to be made, in the order posted. */
  catchUp(): number {
    this.missed = false;
    const due = this.books
      .journal()
      .filter((e) => (SALE_KINDS.has(e.kind) || CREDIT_KINDS.has(e.kind)) && !this.byEntry.has(e.entryId))
      .reverse();
    const batch: FiscalInvoice[] = [];
    for (const entry of due) {
      try {
        this.make(entry, batch);
      } catch (err) {
        this.missed = true;
        this.logger.error(`No tax invoice made for entry ${entry.entryId}: ${(err as Error).message}`);
      }
    }
    if (!batch.length) return 0;
    this.invoices.setMany(batch.map((i) => [i.invoiceId, i] as const));
    for (const entityId of new Set(batch.map((i) => i.entityId))) this.counters.set(entityId, this.last.get(entityId) ?? 0);
    this.logger.log(`${batch.length} tax invoice(s) made for Kenyan sales that had none`);
    return batch.length;
  }

  /**
   * Who bought it. A shop buys carriage at the wholesale price and sells it on; a store buys it for its buyers. A person
   * who sent their own parcel paid the shop the price the app showed them, and the shop passed it on: the sale is theirs.
   */
  private buyerOf(payer: { code: AccountCode; counterparty: string } | undefined, parcel: Parcel | undefined): { buyer: FiscalBuyer; paidBy: 'cash' | 'prepaid' } {
    if (parcel?.paymentMode === 'cash' && parcel.senderMobile === 'app') return { buyer: { kind: 'person', name: PERSON }, paidBy: 'cash' };
    if (payer && SHOP_CODES.has(payer.code)) return { buyer: { kind: 'shop', id: payer.counterparty, name: this.agents.find(payer.counterparty)?.shopName ?? 'Shop' }, paidBy: 'prepaid' };
    if (payer) return { buyer: { kind: 'store', id: payer.counterparty, name: this.vendorName(payer.counterparty) }, paidBy: 'prepaid' };
    return { buyer: { kind: 'person', name: PERSON }, paidBy: 'cash' };
  }

  private describe(entry: JournalEntry, parcel: Parcel | undefined): string {
    if (entry.kind === 'top-up') return 'Top-up service fee';
    return parcel ? `Delivery service, parcel ${parcel.parcelId}` : entry.ref ? `Delivery service, load ${entry.ref}` : 'Delivery service';
  }

  /** The sale a credit note gives back: the last one made for the same thing, to the same buyer. */
  private saleFor(entityId: string, ref: string | undefined, buyer: FiscalBuyer): FiscalInvoice | undefined {
    if (!ref) return undefined;
    let found: FiscalInvoice | undefined;
    for (const i of this.invoices.values()) {
      if (i.entityId === entityId && i.kind === 'sale' && i.number > 0 && i.ref === ref && i.buyer.kind === buyer.kind && i.buyer.id === buyer.id && (!found || i.number > found.number)) found = i;
    }
    return found;
  }

  private parcelOrNone(ref: string): Parcel | undefined {
    try {
      return this.parcels.get(ref);
    } catch {
      return undefined;
    }
  }

  private vendorName(vendorId: string): string {
    try {
      return this.vendors.get(vendorId).name;
    } catch {
      return 'Store';
    }
  }

  /* ------------------------------------------------------------ sending -- */

  /** Each Kenyan company's waiting invoices, to eTIMS. */
  async sendAll(): Promise<void> {
    const companies = new Set<string>();
    for (const i of this.invoices.values()) if (i.number > 0 && i.etims.state === 'waiting') companies.add(i.entityId);
    for (const entityId of companies) await this.sendFor(entityId);
  }

  /** One company's, in number order. Never two at once for one company: a second call runs once the first is done. */
  sendFor(entityId: string): Promise<void> {
    const running = this.flights.get(entityId);
    if (running) {
      this.again.add(entityId);
      return running;
    }
    const flight = (async () => {
      // Registered now, started on the next turn: whatever posted the sale finishes first.
      await null;
      do {
        this.again.delete(entityId);
        await this.drain(entityId);
      } while (this.again.has(entityId));
    })()
      .catch((err) => this.logger.error(`Sending ${entityId}'s tax invoices failed: ${(err as Error).message}`))
      .finally(() => this.flights.delete(entityId));
    this.flights.set(entityId, flight);
    return flight;
  }

  private async drain(entityId: string): Promise<void> {
    const rail = this.rail;
    // Not set up on this server: every invoice waits, and the list says that nothing went to KRA.
    if (!rail) return;
    const entity = this.entities.find(entityId);
    if (!entity || fiscalWayOf(entity.jurisdiction) !== 'etims') return;
    const queue = [...this.invoices.values()]
      .filter((i) => i.entityId === entityId && i.number > 0 && (i.etims.state === 'waiting' || i.etims.state === 'refused'))
      .sort((a, b) => a.number - b.number);
    let sent = 0;
    for (const queued of queue) {
      // Numbers reach KRA in order: nothing passes one KRA turned down until somebody sends it again.
      if (queued.etims.state === 'refused') return;
      // The rest go on the next round, a minute on.
      if (sent >= SENDS_PER_GO) return;
      const tin = entity.taxRegistration?.trim() ?? '';
      if (rail.kind === 'kra' && !tin) {
        this.setStatus(queued.invoiceId, { state: 'waiting', note: `${entity.name} has no KRA PIN in its tax settings: nothing sent to KRA` });
        return;
      }
      // Kept BEFORE it goes: an answer lost on the way is asked again with the very same request.
      const body = this.requests.get(queued.invoiceId) ?? saleRequest(queued, { tin, bhfId: rail.bhfId }, rail.item, rail.taxable);
      this.requests.set(queued.invoiceId, body);
      sent += 1;
      const answer = await rail.record(tin, body);
      const tried = { tries: (this.invoices.get(queued.invoiceId)?.etims.tries ?? 0) + 1, lastTriedAt: new Date().toISOString() };
      if ('recorded' in answer) {
        const receipt = { ...answer.recorded, tin, bhfId: rail.bhfId, ...(rail.kind === 'kra' ? { env: rail.env } : {}) };
        this.setStatus(queued.invoiceId, { state: 'recorded', ...tried, receipt });
        this.requests.delete(queued.invoiceId);
        continue;
      }
      if ('already' in answer) {
        this.setStatus(queued.invoiceId, { state: 'needs_check', ...tried, note: `${answer.already} An earlier try reached KRA and its answer was lost: look it up on KRA’s eTIMS portal.` });
        this.requests.delete(queued.invoiceId);
        continue;
      }
      if ('refused' in answer) {
        // Built afresh when sent again: what was wrong is fixed in the settings, and the request must carry the fix.
        this.setStatus(queued.invoiceId, { state: 'refused', ...tried, note: answer.refused });
        this.requests.delete(queued.invoiceId);
        return;
      }
      this.setStatus(queued.invoiceId, { state: 'waiting', ...tried, note: answer.unknown });
      return;
    }
  }

  private setStatus(invoiceId: string, status: Partial<EtimsStatus> & { state: EtimsState }): void {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return;
    // A note belongs to the answer it came with: a new state without one clears the last.
    const etims: EtimsStatus = { ...inv.etims, ...status };
    if (!('note' in status)) delete etims.note;
    this.invoices.set(invoiceId, { ...inv, etims });
  }

  /**
   * Send one again: one KRA refused (once what it refused is fixed), or one KRA said it already held. Then the ones
   * held behind it go too.
   */
  async retry(invoiceId: string): Promise<FiscalInvoice> {
    const inv = this.require(invoiceId);
    if (inv.etims.state === 'recorded') throw new GlosError('INVALID_STATE', 'This invoice is recorded with KRA');
    if (inv.etims.state === 'not_sendable') throw new GlosError('INVALID_STATE', inv.etims.note ?? 'This invoice cannot be sent to KRA');
    if (!this.rail) throw new GlosError('INVALID_STATE', 'eTIMS is not set up on this server: nothing is sent to KRA');
    this.setStatus(invoiceId, { state: 'waiting' });
    await this.sendFor(inv.entityId);
    return this.require(invoiceId);
  }

  /* ------------------------------------------------------------ reading -- */

  require(invoiceId: string): FiscalInvoice {
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new GlosError('NOT_FOUND', 'No such invoice');
    return inv;
  }

  /** The companies' invoices, newest first, with how many stand in each state. */
  list(q: { entityIds?: Set<string>; state?: EtimsState; limit?: number; offset?: number } = {}): FiscalInvoiceList {
    const mine = [...this.invoices.values()].filter((i) => !q.entityIds || q.entityIds.has(i.entityId));
    const counts: Record<string, number> = {};
    for (const i of mine) counts[i.etims.state] = (counts[i.etims.state] ?? 0) + 1;
    const shown = mine.filter((i) => !q.state || i.etims.state === q.state).sort((a, b) => b.at.localeCompare(a.at) || b.number - a.number);
    const offset = Math.max(0, q.offset ?? 0);
    const limit = Math.min(Math.max(1, q.limit ?? 50), 200);
    return { items: shown.slice(offset, offset + limit), total: shown.length, counts, ...this.railOf() };
  }

  /** One shop's or store's, the newest first: its last two hundred. */
  forBuyer(kind: 'shop' | 'store', id: string): FiscalInvoice[] {
    return [...this.invoices.values()]
      .filter((i) => i.buyer.kind === kind && i.buyer.id === id)
      .sort((a, b) => b.at.localeCompare(a.at) || b.number - a.number)
      .slice(0, 200);
  }

  /** The invoices made for one parcel or load, oldest first. */
  forRef(ref: string): FiscalInvoice[] {
    return [...this.invoices.values()].filter((i) => i.ref === ref).sort((a, b) => a.at.localeCompare(b.at) || a.number - b.number);
  }

  /* ------------------------------------------------------------ the page -- */

  /**
   * The page for whoever opens it, by KRA's rules for a till (TIS v2.0): nothing printed before KRA has answered (rule
   * 10); ONE original, and it is the buyer's — the first time they open it (rule 6.17); every other opening, and every
   * opening by the company, a COPY that says it is not an official receipt (rule 11).
   */
  pageFor(inv: FiscalInvoice, byBuyer: boolean): string {
    if (inv.etims.state !== 'recorded' || !inv.etims.receipt) {
      throw new GlosError('INVALID_STATE', 'Not recorded with KRA yet: a tax invoice is printed only once KRA has signed it');
    }
    const original = byBuyer && !this.originals.has(inv.invoiceId);
    if (original) this.originals.set(inv.invoiceId, { at: new Date().toISOString() });
    return this.htmlFor(inv, inv.etims.receipt, !original);
  }

  /**
   * The invoice as a page: what KRA requires printed (TIS §6) — the CU ID, the CU invoice number, the internal data and
   * the receipt signature with a dash every fourth character, the date and time, and a QR code that checks it with KRA.
   * A copy, or one the stand-in answered, says so above the items, across the page, and below the total — larger than
   * the amounts (TIS rule 11).
   */
  private htmlFor(inv: FiscalInvoice, r: EtimsReceipt, copy: boolean): string {
    const e = escapeHtml;
    const money = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const title = inv.kind === 'credit' ? 'Credit note' : 'Tax invoice';
    const band = inv.line.band ? `${inv.line.band} · ${inv.line.band === 'D' ? 'Non-VAT' : `VAT ${inv.line.ratePct}%`}` : `${inv.line.ratePct}%`;
    const stamp = kenyaStamp(inv.at).dateTime;
    const mark = [r.sandbox ? 'SANDBOX' : '', copy ? 'COPY' : ''].filter(Boolean).join(' · ');
    const scu = `<section class="scu"><div class="h">SCU information</div>
  <div class="scu-grid"><div>
    <div>Date <b>${e(dateOf(r.sdcDateTime))}</b> Time <b>${e(timeOf(r.sdcDateTime))}</b></div>
    <div>SCU ID <b class="mono">${e(r.sdcId)}</b></div>
    <div>CU invoice no. <b class="mono">${e(cuInvoiceNo(r))}</b></div>
    <div>Internal data <span class="mono">${e(dashed(r.intrlData))}</span></div>
    <div>Receipt signature <span class="mono">${e(dashed(r.rcptSign))}</span></div>
    <div>Receipt no. ${r.curRcptNo} of ${r.totRcptNo} · MRC ${e(r.mrcNo)}</div>
  </div>${
    r.sandbox
      ? '<div class="sbx">Answered on a laptop by a stand-in for KRA. Not recorded with KRA.</div>'
      : `<svg class="qr" viewBox="0 0 120 120" role="img" aria-label="Check this invoice with KRA">${qrSvgGroup(verifyUrl({ tin: r.tin ?? inv.sellerPin ?? '', bhfId: r.bhfId ?? '00' }, r, r.env ?? 'production'), 0, 0, 120, 'M')}</svg>`
  }</div></section>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} ${inv.number || ''} — ${e(inv.seller)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 12px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; background: #fff; }
  main { max-width: 720px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; gap: 12px; }
  h1 { font-size: 20px; margin: 0; text-transform: uppercase; letter-spacing: .04em; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .box { border: 1px solid #555; padding: 6px 8px; }
  .h { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #444; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { border: 1px solid #555; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .03em; background: #f1f1f1; }
  .r { text-align: right; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
  .scu { border: 2px solid #111; padding: 8px; }
  .scu-grid { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  .scu-grid > div:first-child > div { margin: 2px 0; }
  .qr { width: 120px; height: 120px; flex: none; }
  .sbx { flex: none; width: 180px; border: 3px solid #b00; color: #b00; font-size: 11px; text-align: center; padding: 8px; }
  .mark { font-size: 28px; font-weight: 800; letter-spacing: .12em; text-align: center; border: 3px solid #111; margin: 0 0 10px; padding: 4px; }
  .notoff { font-size: 24px; font-weight: 800; text-align: center; margin: 4px 0 12px; }
  .wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 120px; font-weight: 900; color: rgba(0,0,0,.07); transform: rotate(-30deg); z-index: 0; }
  main { position: relative; z-index: 1; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } .scu-grid { flex-direction: column; align-items: flex-start; } .wm { font-size: 64px; } }
</style></head><body>${mark ? `<div class="wm" aria-hidden="true">${e(mark)}</div>` : ''}<main>
  <header><div><h1>${e(title)}</h1><div>No. <b>${inv.number}</b> · ${e(dateOf(stamp))} ${e(timeOf(stamp))}${inv.originalNumber ? ` · gives back invoice no. <b>${inv.originalNumber}</b>` : ''}</div></div>
  <div class="r"><b>${e(inv.seller)}</b><br>KRA PIN ${inv.sellerPin ? `<span class="mono">${e(inv.sellerPin)}</span>` : 'not set'}</div></header>
  ${mark ? `<div class="mark">${e(mark)}</div>` : ''}
  <div class="grid"><div class="box"><div class="h">Buyer</div><b>${e(inv.buyer.name)}</b>${inv.buyer.pin ? `<br>KRA PIN <span class="mono">${e(inv.buyer.pin)}</span>` : ''}</div>
  <div class="box"><div class="h">Paid</div>${inv.paidBy === 'cash' ? 'Cash' : 'From money held with us'}${inv.ref ? `<br>Reference <span class="mono">${e(inv.ref)}</span>` : ''}</div></div>
  <table><thead><tr><th>Description</th><th class="r">Qty</th><th>Tax</th><th class="r">Without tax (${e(inv.currency)})</th><th class="r">Tax (${e(inv.currency)})</th><th class="r">Total (${e(inv.currency)})</th></tr></thead>
  <tbody><tr><td>${e(inv.line.description)}</td><td class="r">1</td><td>${e(band)}</td><td class="r">${money(inv.line.net)}</td><td class="r">${money(inv.line.tax)}</td><td class="r"><b>${money(inv.line.gross)}</b></td></tr></tbody></table>
  ${mark ? '<p class="notoff">THIS IS NOT AN OFFICIAL RECEIPT</p>' : ''}
  ${scu}
</main></body></html>`;
  }
}

/** yyyyMMddhhmmss → dd/MM/yyyy and hh:mm:ss, as KRA prints them. */
function dateOf(s: string): string {
  return s.length >= 8 ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : s;
}
function timeOf(s: string): string {
  return s.length >= 14 ? `${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}` : '';
}
