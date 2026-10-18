import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BooksService } from '../src/foundation/books/books.service';
import { FiscalInvoiceService } from '../src/modules/pudo/fiscal-invoice.service';

/**
 * KENYAN TAX INVOICES, over the wire (the user, 2026-10-18: "KRA eTIMS invoices", "not registered yet", "eTIMS only for
 * Kenya"). A Kenyan shop's charge is invoiced and recorded — here by the laptop stand-in, said SANDBOX — and read by the
 * shop that bought it and by the company, by nobody else. An Ethiopian shop's charge is booked and never invoiced.
 */
describe('Kenyan tax invoices, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A working shop and its own sign-in, where the pin says. */
  async function aShop(at: { lat: number; lng: number }, mobile: string, country = 'KE'): Promise<{ did: string; owner: Record<string, string> }> {
    const u = digits();
    const day = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({ shopName: `Duka ${u}`, zone: `ZF${u}`, country, location: at, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null }, fullName: `Duka ${u} owner`, nationalId: `ID-${u}`, mobile, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const owner = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(owner).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(owner).send({ idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(owner).send({ amount: 500 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 500 }).expect(201);
    return { did, owner };
  }

  async function aParcelTakenIn(shop: { did: string; owner: Record<string, string> }, sender: string, receiver: string): Promise<string> {
    const parcelId = `FISC-${digits()}`;
    await http().post('/v1/sbg/parcels/accept').set(shop.owner).send({ agentDid: shop.did, parcelId, size: 'S', destZone: 'FarTown', senderMobile: sender, receiverMobile: receiver, dropoffPhotoRef: 'd.jpg' }).expect(201);
    return parcelId;
  }

  it('a Kenyan shop’s charge is invoiced and recorded, read by that shop and the company — by nobody else', async () => {
    const shop = await aShop({ lat: -1.2, lng: 36.8 }, `+2547${digits()}1`);
    const other = await aShop({ lat: -1.21, lng: 36.81 }, `+2547${digits()}2`);
    const parcelId = await aParcelTakenIn(shop, `+2547${digits()}3`, `+2547${digits()}4`);
    await app.get(FiscalInvoiceService).settled();

    const mine = (await http().get(`/v1/sbg/parcels/${parcelId}/fiscal-invoices`).set(shop.owner).expect(200)).body as Array<Record<string, any>>;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ entityId: 'sbg-ke', country: 'KE', kind: 'sale', ref: parcelId, buyer: { kind: 'shop', id: shop.did }, paidBy: 'prepaid', etims: { state: 'recorded', tries: 1 } });
    expect(mine[0].number).toBeGreaterThan(0);
    expect(mine[0].etims.receipt).toMatchObject({ sdcId: 'SANDBOX', sandbox: true });
    // Staff look first: theirs is a copy, and the buyer's original is still the buyer's.
    expect((await http().get(`/v1/sbg/fiscal-invoices/${mine[0].invoiceId}/invoice.html`).set(operator).expect(200)).text).toContain('<div class="mark">SANDBOX · COPY</div>');
    const page = await http().get(`/v1/sbg/fiscal-invoices/${mine[0].invoiceId}/invoice.html`).set(shop.owner).expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('Tax invoice');
    expect(page.text).toContain('<div class="mark">SANDBOX</div>');
    expect(page.text).toContain('THIS IS NOT AN OFFICIAL RECEIPT');
    // One original, the buyer's: every opening after it is a copy.
    expect((await http().get(`/v1/sbg/fiscal-invoices/${mine[0].invoiceId}/invoice.html`).set(shop.owner).expect(200)).text).toContain('<div class="mark">SANDBOX · COPY</div>');

    // The shop's own list, for its VAT: this one in it; another shop's list does not hold it.
    expect(((await http().get('/v1/sbg/fiscal-invoices/mine').set(shop.owner).expect(200)).body as Array<{ invoiceId: string }>).map((i) => i.invoiceId)).toContain(mine[0].invoiceId);
    expect(((await http().get('/v1/sbg/fiscal-invoices/mine').set(other.owner).expect(200)).body as Array<{ invoiceId: string }>).map((i) => i.invoiceId)).not.toContain(mine[0].invoiceId);
    // Another shop: told nothing, not even that it exists.
    expect((await http().get(`/v1/sbg/parcels/${parcelId}/fiscal-invoices`).set(other.owner).expect(200)).body).toEqual([]);
    await http().get(`/v1/sbg/fiscal-invoices/${mine[0].invoiceId}`).set(other.owner).expect(404);
    await http().get(`/v1/sbg/fiscal-invoices/${mine[0].invoiceId}/invoice.html`).set(other.owner).expect(404);
    // The list and sending again are the company's: not a shop's.
    await http().get('/v1/sbg/fiscal-invoices').set(shop.owner).expect(403);
    await http().post(`/v1/sbg/fiscal-invoices/${mine[0].invoiceId}/retry`).set(shop.owner).expect(403);

    const list = (await http().get('/v1/sbg/fiscal-invoices?entityId=sbg-ke&state=recorded').set(operator).expect(200)).body;
    expect(list.rail).toBe('stand_in');
    expect(list.way).toBe('etims');
    // Ethiopia's company has no eTIMS: the console shows it no tax-invoice panel.
    expect((await http().get('/v1/sbg/fiscal-invoices?entityId=sbg-et').set(operator).expect(200)).body).toMatchObject({ total: 0 });
    expect((await http().get('/v1/sbg/fiscal-invoices?entityId=sbg-et').set(operator).expect(200)).body.way).toBeUndefined();
    expect(list.items.map((i: { invoiceId: string }) => i.invoiceId)).toContain(mine[0].invoiceId);
    await http().get('/v1/sbg/fiscal-invoices?state=lost').set(operator).expect(400);
    // Recorded is recorded: nothing to send again.
    await http().post(`/v1/sbg/fiscal-invoices/${mine[0].invoiceId}/retry`).set(operator).expect(400);
  });

  it('an Ethiopian shop’s charge is booked, and never invoiced for KRA', async () => {
    const shop = await aShop({ lat: 9.03, lng: 38.74 }, `+2519${digits()}1`, 'ET');
    const parcelId = await aParcelTakenIn(shop, `+2519${digits()}3`, `+2519${digits()}4`);
    await app.get(FiscalInvoiceService).settled();
    // It was charged, by the Ethiopian company…
    expect(app.get(BooksService).journal({ ref: parcelId }).some((e) => e.entityId === 'sbg-et' && e.kind === 'shipping')).toBe(true);
    // …and nothing of it is a Kenyan tax invoice, nor went to eTIMS.
    expect((await http().get(`/v1/sbg/parcels/${parcelId}/fiscal-invoices`).set(operator).expect(200)).body).toEqual([]);
    const all = (await http().get('/v1/sbg/fiscal-invoices?limit=200').set(operator).expect(200)).body;
    expect(all.items.some((i: { ref?: string; entityId: string }) => i.ref === parcelId || i.entityId !== 'sbg-ke')).toBe(false);
  });
});
