import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver } from './content-photo';
import { declared } from './declared';

/**
 * A STORE PARCEL'S PAPERS ABROAD, over the wire (the user, round 13: per item "As shippers do"; the buyer "Address entered
 * is address carried"; "The store, with the label"). Through the Store app's own door — the shipping API's is proved in
 * shipping-api.spec — a shipment crossing a border goes with its commercial invoice; the store reads and prints it, staff
 * read it, nobody else does; and the shop that takes it in looks for the copies in the pouch first.
 */
describe('a store parcel’s papers abroad, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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

  /** A shop signed up, vetted and funded: its did, and its own sign-in. */
  async function aShop(shopName: string, zone: string, country: string, location: { lat: number; lng: number }): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country, location, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-PAP-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-PAP-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photograph = async (kind: string) => {
      const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}`;
      return (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
    };
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: await photograph('kyc_licence'), shopPhotoRefs: [await photograph('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did); // the shop signs its security declaration, as at joining
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${u}`, amount: 50 }).expect(201);
    return { did, token };
  }

  /** A store, signed in to its app, with money to ship. */
  async function aStore(): Promise<{ id: string; token: { authorization: string } }> {
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `Papers Store ${digits()}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const token = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const asked = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(token).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    return { id: made.vendorId, token };
  }

  it('a crossing order from the Store app goes with its papers: read and printed by the store, read by staff, looked for by the shop', async () => {
    const tag = digits();
    const nairobi = await aShop(`Nairobi Papers ${tag}`, `PapNairobi${tag}`, 'KE', { lat: -1.286, lng: 36.817 });
    const kisumu = await aShop(`Kisumu Papers ${tag}`, `PapKisumu${tag}`, 'KE', { lat: -0.09, lng: 34.77 });
    const addis = await aShop(`Addis Papers ${tag}`, `PapAddis${tag}`, 'ET', { lat: 9.03, lng: 38.74 });
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `PapNairobi → PapAddis ${tag}`, originZone: `PapNairobi${tag}`, destZone: `PapAddis${tag}` }).expect(201);
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `PapNairobi → PapKisumu ${tag}`, originZone: `PapNairobi${tag}`, destZone: `PapKisumu${tag}` }).expect(201);
    const store = await aStore();
    const home = 'Bole Road, House 12\nNear the Edna Mall\nAddis Ababa';
    const invoice = { number: `INV-${tag}`, currency: 'KES', importer: { name: 'Abebe Kebede', address: home }, lines: [{ description: 'Ankara shirt', quantity: 2, netKg: 0.6, unitValue: 1700, originCountry: 'KE' }], declare: true };
    const order = { vendorId: store.id, originPudoDid: nairobi.did, destPudoDid: addis.did, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef: 'content.jpg' };

    // Without its papers, a crossing is refused — the same words the shipping API uses; with them, it is made.
    const refused = await http().post('/v1/sbg/inbound/orders').set(store.token).send({ ...order, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(400);
    expect(refused.body.code).toBe('CUSTOMS_INCOMPLETE');
    expect(refused.body.detail).toMatch(/needs its commercial invoice/);
    const made = (await http().post('/v1/sbg/inbound/orders').set(store.token).send({ ...order, invoice, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(201)).body;
    const parcelId = made.parcel.parcelId as string;
    expect(made.parcel.customs).toMatchObject({ declaredValue: 3400, currency: 'KES' });
    expect(made.label.svg).toContain('Customs papers in the pouch');
    // A shipment staying in the country needs none, and is told so.
    expect((await http().post('/v1/sbg/inbound/orders').set(store.token).send({ ...order, destPudoDid: kisumu.did, invoice, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(400)).body.detail).toMatch(/does not cross a border/);

    // The store reads and prints them; the address exactly as entered.
    const own = `/v1/sbg/vendors/${store.id}/parcels/${parcelId}/invoice`;
    const read = (await http().get(own).set(store.token).expect(200)).body;
    expect(read).toMatchObject({ correctable: true, current: { number: `INV-${tag}`, importer: { name: 'Abebe Kebede', address: home, country: 'ET' }, importerAddressFrom: 'entered', totalValue: 3400 } });
    const page = (await http().get(`${own}.html`).set(store.token).expect(200)).text;
    expect(page.match(/<section class="copy">/g)).toHaveLength(3);
    expect(page).toContain('Bole Road, House 12<br>Near the Edna Mall<br>Addis Ababa');
    // Staff read them, as they read a store's other records; another store does not.
    await http().get(own).set(operator).expect(200);
    const other = await aStore();
    await http().get(own).set(other.token).expect(403);
    await http().get(`/v1/sbg/vendors/${other.id}/parcels/${parcelId}/invoice`).set(other.token).expect(404);

    // The shop that takes it in is told it crosses, and looks for the papers before it does.
    const preview = (await http().get(`/v1/sbg/parcels/${parcelId}/intake-preview`).set(nairobi.token).expect(200)).body;
    expect(preview.papers).toEqual({ copies: 3, crossing: 'KE→ET' });
    const unchecked = await http().post(`/v1/sbg/parcels/${parcelId}/intake`).set(nairobi.token).send({}).expect(400);
    expect(unchecked.body.detail).toMatch(/look for its commercial invoice/);
    expect((await http().post(`/v1/sbg/parcels/${parcelId}/intake`).set(nairobi.token).send({ papersInPouch: true }).expect(201)).body).toMatchObject({ status: 'At_PUDO', papersSeen: { by: nairobi.did } });
    expect((await http().get(own).set(store.token).expect(200)).body.correctable).toBe(false);
    // The support desk answering for a parcel held at the border reads that the papers were seen, and by whom.
    expect((await http().get(`/v1/sbg/parcels/${parcelId}`).set(operator).expect(200)).body).toMatchObject({ crossesBorder: true, papersSeen: { by: nairobi.did } });
  });
});
