import { Test, type TestingModule } from '@nestjs/testing';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { AgentService } from './agent.service';
import { ETIMS_RAIL, SandboxEtimsRail, type EtimsAnswer, type EtimsRail } from './etims-rail.adapter';
import { FiscalInvoiceService } from './fiscal-invoice.service';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';

/** What eTIMS was sent, in order — the receiver, asserted on. Answers as the stand-in does unless told otherwise. */
class RecordingRail implements EtimsRail {
  readonly kind = 'stand_in' as const;
  readonly env = 'sandbox' as const;
  readonly bhfId = '00';
  item = { itemCd: 'KE3NTU0000001', itemClsCd: '7810220000' };
  readonly taxable = 'gross' as const;
  readonly sent: Array<{ tin: string; body: Record<string, unknown> }> = [];
  readonly scripted: EtimsAnswer[] = [];
  private readonly standIn = new SandboxEtimsRail();
  async record(tin: string, body: Record<string, unknown>): Promise<EtimsAnswer> {
    this.sent.push({ tin, body: structuredClone(body) });
    const scripted = this.scripted.shift();
    // "Already" means KRA holds it: so does the stand-in behind this one.
    if (scripted && 'already' in scripted) await this.standIn.record(tin, body);
    return scripted ?? this.standIn.record(tin, body);
  }
}

const SHOP = 'did:glos:shop-1';
const PARCELS: Record<string, unknown> = {
  'PUD-APP': { parcelId: 'PUD-APP', paymentMode: 'cash', senderMobile: 'app' },
  'PUD-WALK': { parcelId: 'PUD-WALK', paymentMode: 'cash', senderMobile: '+254700000001' },
};

describe('tax invoices — KRA eTIMS, Kenya only', () => {
  let moduleRef: TestingModule;
  let books: BooksService;
  let entities: EntityService;
  let invoices: FiscalInvoiceService;
  let rail: RecordingRail | null;

  async function boot(withRail: RecordingRail | null = new RecordingRail()) {
    rail = withRail;
    moduleRef = await Test.createTestingModule({
      providers: [
        BooksService,
        EntityService,
        DidService,
        LedgerService,
        EventBus,
        FiscalInvoiceService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        { provide: ETIMS_RAIL, useValue: withRail },
        { provide: AgentService, useValue: { find: (did: string) => (did === SHOP ? { did, shopName: 'Mama Sarah Shop' } : undefined) } },
        { provide: VendorService, useValue: { get: (id: string) => ({ vendorId: id, did: `did:glos:${id}`, name: 'Duka la Mama' }) } },
        {
          provide: ParcelService,
          useValue: {
            get: (id: string) => {
              if (!PARCELS[id]) throw new Error('No such parcel');
              return PARCELS[id];
            },
          },
        },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    books = moduleRef.get(BooksService);
    books.reset();
    invoices = moduleRef.get(FiscalInvoiceService);
    await moduleRef.init();
  }

  afterEach(async () => {
    await moduleRef?.close();
  });

  /** A shop's parcel charged at 16% VAT: 100 + 16. */
  const shopSale = (ref: string, entityId = 'sbg-ke', net = 100, tax = 16) =>
    books.post({
      entityId,
      kind: 'shipping',
      ref,
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: SHOP, amount: net + tax },
        { code: ACCOUNT_CODES.REVENUE, amount: -net },
        ...(tax ? [{ code: ACCOUNT_CODES.PAYABLE_TAX, amount: -tax }] : []),
      ],
    });

  it('invoices a Kenyan company’s sale and records it — and an Ethiopian company’s sale is never invoiced, nor anything of it sent', async () => {
    await boot();
    shopSale('PUD-ET', 'sbg-et');
    shopSale('PUD-KE');
    await invoices.settled();
    expect(invoices.catchUp()).toBe(0); // nothing of Ethiopia's waits to be made either
    const { items, total } = invoices.list();
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ entityId: 'sbg-ke', country: 'KE', number: 1, kind: 'sale', ref: 'PUD-KE', buyer: { kind: 'shop', id: SHOP, name: 'Mama Sarah Shop' }, paidBy: 'prepaid' });
    expect(items[0].line).toMatchObject({ net: 100, tax: 16, gross: 116, band: 'B', ratePct: 16 });
    expect(items[0].etims.state).toBe('recorded');
    expect(rail!.sent).toHaveLength(1);
    expect(rail!.sent[0].body).toMatchObject({ invcNo: 1, trdInvcNo: items[0].invoiceId, totAmt: 116, taxAmtB: 16 });
    expect(rail!.sent.some((s) => JSON.stringify(s.body).includes('PUD-ET'))).toBe(false);
  });

  it('numbers one unbroken series: a rate with no band takes no number, and a credit note names the sale it gives back', async () => {
    await boot();
    shopSale('PUD-1');
    shopSale('PUD-2', 'sbg-ke', 100, 18); // 18%: no band in eTIMS
    shopSale('PUD-3');
    books.post({
      entityId: 'sbg-ke',
      kind: 'refund',
      ref: 'PUD-1',
      lines: [
        { code: ACCOUNT_CODES.REVENUE, amount: 100 },
        { code: ACCOUNT_CODES.PAYABLE_TAX, amount: 16 },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: SHOP, amount: -116 },
      ],
    });
    await invoices.settled();
    const byRef = (ref: string, kind = 'sale') => invoices.forRef(ref).find((i) => i.kind === kind)!;
    expect(byRef('PUD-2')).toMatchObject({ number: 0, etims: { state: 'not_sendable' } });
    expect(byRef('PUD-2').etims.note).toMatch(/18% has no band/);
    expect(byRef('PUD-3').number).toBe(2);
    expect(byRef('PUD-1', 'credit')).toMatchObject({ number: 3, originalNumber: 1, line: { gross: 116, tax: 16 } });
    expect(rail!.sent.map((s) => s.body.invcNo)).toEqual([1, 2, 3]);
    expect(rail!.sent[2].body).toMatchObject({ rcptTyCd: 'R', orgInvcNo: 1, rfdRsnCd: '06' });
  });

  it('a top-up is invoiced for its fee alone; a top-up with no fee, and one that came back, are not invoiced', async () => {
    await boot();
    books.post({
      entityId: 'sbg-ke',
      kind: 'top-up',
      ref: 'MPESA-1',
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: 1000 },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: SHOP, amount: -1000 },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: SHOP, amount: 20 },
        { code: ACCOUNT_CODES.REVENUE, amount: -20 },
      ],
    });
    books.post({ entityId: 'sbg-ke', kind: 'top-up', ref: 'MPESA-2', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 500 }, { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: SHOP, amount: -500 }] });
    books.post({ entityId: 'sbg-ke', kind: 'top-up-reversal', ref: 'MPESA-1', lines: [{ code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: SHOP, amount: 1000 }, { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -1000 }] });
    await invoices.settled();
    const { items } = invoices.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'sale', ref: 'MPESA-1', line: { description: 'Top-up service fee', net: 20, tax: 0, gross: 20, band: 'D' } });
  });

  it('a person’s own send is sold to them, paid in cash; a walk-up’s wholesale charge is sold to the shop', async () => {
    await boot();
    shopSale('PUD-APP');
    shopSale('PUD-WALK');
    await invoices.settled();
    expect(invoices.forRef('PUD-APP')[0]).toMatchObject({ buyer: { kind: 'person', name: 'Cash customer' }, paidBy: 'cash' });
    expect(invoices.forRef('PUD-APP')[0].buyer.id).toBeUndefined();
    expect(invoices.forRef('PUD-WALK')[0]).toMatchObject({ buyer: { kind: 'shop', id: SHOP }, paidBy: 'prepaid' });
    expect(rail!.sent[0].body).toMatchObject({ pmtTyCd: '01', custNm: 'Cash customer' });
  });

  it('one KRA refused holds back the ones after it; sent again, they go in number order', async () => {
    await boot();
    rail!.scripted.push({ refused: 'Request parameter error (910)', code: '910' });
    shopSale('PUD-1');
    shopSale('PUD-2');
    await invoices.settled();
    const [first, second] = [invoices.forRef('PUD-1')[0], invoices.forRef('PUD-2')[0]];
    expect(first.etims).toMatchObject({ state: 'refused', tries: 1, note: 'Request parameter error (910)' });
    expect(second.etims.state).toBe('waiting');
    expect(rail!.sent.map((s) => s.body.invcNo)).toEqual([1]);
    // The next round, a minute on: still held behind the refused one.
    await invoices.sendAll();
    await invoices.settled();
    expect(rail!.sent.map((s) => s.body.invcNo)).toEqual([1]);
    await invoices.retry(first.invoiceId);
    await invoices.settled();
    expect(rail!.sent.map((s) => s.body.invcNo)).toEqual([1, 1, 2]);
    expect(invoices.forRef('PUD-1')[0].etims).toMatchObject({ state: 'recorded', tries: 2 });
    expect(invoices.forRef('PUD-2')[0].etims.state).toBe('recorded');
  });

  it('an answer lost on the way is asked again with the very same request', async () => {
    await boot();
    rail!.scripted.push({ unknown: 'KRA did not answer (no answer in time)' });
    shopSale('PUD-1');
    await invoices.settled();
    expect(invoices.forRef('PUD-1')[0].etims).toMatchObject({ state: 'waiting', tries: 1, note: 'KRA did not answer (no answer in time)' });
    // The settings change in between: KRA may hold the first request, so the first request is what goes again.
    rail!.item = { itemCd: 'KE3NTU0000002', itemClsCd: '7810220000' };
    await invoices.sendAll();
    await invoices.settled();
    expect(rail!.sent).toHaveLength(2);
    expect(rail!.sent[1].body).toEqual(rail!.sent[0].body);
    expect(invoices.forRef('PUD-1')[0].etims.state).toBe('recorded');
    expect(invoices.forRef('PUD-1')[0].etims.note).toBeUndefined();
  });

  it('KRA already holding the number is said, to be looked up — and the next goes on', async () => {
    await boot();
    rail!.scripted.push({ already: 'There is an overlapped Data (994)', code: '994' });
    shopSale('PUD-1');
    shopSale('PUD-2');
    await invoices.settled();
    expect(invoices.forRef('PUD-1')[0].etims.state).toBe('needs_check');
    expect(invoices.forRef('PUD-1')[0].etims.note).toMatch(/KRA’s eTIMS portal/);
    expect(invoices.forRef('PUD-2')[0].etims.state).toBe('recorded');
  });

  it('with eTIMS not set up on a server, invoices are made and wait — nothing is sent, and the page says so', async () => {
    await boot(null);
    shopSale('PUD-1');
    await invoices.settled();
    const list = invoices.list();
    expect(list.rail).toBe('not_set_up');
    expect(list.items[0]).toMatchObject({ number: 1, etims: { state: 'waiting', tries: 0 } });
    // KRA's rule 10: nothing is printed before KRA has answered.
    expect(() => invoices.pageFor(list.items[0], true)).toThrow(/Not recorded with KRA yet/);
    await expect(invoices.retry(list.items[0].invoiceId)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('prints KRA’s block — CU invoice number, dashed internal data and signature — and the stand-in’s says SANDBOX, not official, with no QR', async () => {
    await boot();
    shopSale('PUD-1');
    await invoices.settled();
    const inv = invoices.forRef('PUD-1')[0];
    const html = invoices.pageFor(inv, true);
    expect(html).toContain('Tax invoice');
    expect(html).toContain(`SANDBOX/${inv.etims.receipt!.curRcptNo}`);
    expect(html).toContain(inv.etims.receipt!.rcptSign.slice(0, 4) + '-' + inv.etims.receipt!.rcptSign.slice(4, 8));
    expect(html).toContain('<div class="mark">SANDBOX</div>');
    expect(html).toContain('THIS IS NOT AN OFFICIAL RECEIPT');
    expect(html).not.toContain('<svg class="qr"');
  });

  it('hands its buyer one original; every other opening, and every opening by the company, is a COPY (KRA’s rules 6.17 and 11)', async () => {
    await boot();
    shopSale('PUD-1');
    await invoices.settled();
    const inv = invoices.forRef('PUD-1')[0];
    // As KRA itself would have recorded it: a QR that checks it there.
    const kra = { ...inv, invoiceId: 'fi_kra', etims: { ...inv.etims, receipt: { ...inv.etims.receipt!, sandbox: undefined, sdcId: 'KRACU0100000001', tin: 'P051234567X', bhfId: '00', env: 'production' as const } } };
    const byCompany = invoices.pageFor(kra, false);
    expect(byCompany).toContain('<div class="mark">COPY</div>');
    const original = invoices.pageFor(kra, true);
    expect(original).not.toContain('class="mark"');
    expect(original).not.toContain('NOT AN OFFICIAL RECEIPT');
    expect(original).toContain('<svg class="qr"');
    expect(original).toContain('KRACU0100000001/');
    expect(invoices.pageFor(kra, true)).toContain('<div class="mark">COPY</div>');
    expect(invoices.pageFor(kra, true)).toContain('THIS IS NOT AN OFFICIAL RECEIPT');
  });

  it('a stop between the invoice and its counter never gives a number twice', async () => {
    await boot();
    shopSale('PUD-1');
    await invoices.settled();
    // The counter went back, as if the server stopped after the invoice was written and before the counter was.
    (invoices as unknown as { counters: Map<string, number> }).counters.set('sbg-ke', 0);
    invoices.onModuleInit();
    shopSale('PUD-2');
    await invoices.settled();
    expect(invoices.forRef('PUD-2')[0].number).toBe(2);
  });
});
