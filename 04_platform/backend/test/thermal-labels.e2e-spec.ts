import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, shipmentPhotoOver, shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { AGREED } from './agreed';

/**
 * EVERY LABEL FOR A THERMAL PRINTER, over the wire (round 27, the user: "Thermal labels (ZPL)"; "Every label we print").
 * The shop's counter label, a store's order label and a business's package labels, each as ZPL beside the label it
 * already prints — each to whoever prints that label, and to nobody else. A store's label prints again once paid.
 */
describe('every label for a thermal printer, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const labelsIn = (zpl: string) => (zpl.match(/\^XA/g) ?? []).length;

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
  async function aShop(shopName: string, zone: string): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-ZPL-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-ZPL-${u}`,
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

  /** A store, signed in to its app — with money to ship, or none. */
  async function aStore(funded = true): Promise<{ id: string; token: { authorization: string } }> {
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ ...AGREED, name: `Label Store ${digits()}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const token = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    if (funded) {
      const asked = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(token).send({ amount: 5000 }).expect(201);
      await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    }
    return { id: made.vendorId, token };
  }

  it('prints the counter’s label and a store’s order label as ZPL — for that shop and that store alone', async () => {
    const tag = digits();
    const nairobi = await aShop(`Nairobi Labels ${tag}`, `ZplNairobi${tag}`);
    // A name with what a printer would read as commands in it: escaped, never obeyed.
    const kisumu = await aShop(`Kisumu ^Corner~ ${tag}`, `ZplKisumu${tag}`);
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `ZplNairobi → ZplKisumu ${tag}`, originZone: `ZplNairobi${tag}`, destZone: `ZplKisumu${tag}` }).expect(201);

    // THE COUNTER: a walk-up taken in at Nairobi for the Kisumu shop.
    const walkUp = `ZPL-${tag}`;
    const taken = (await http().post('/v1/sbg/parcels/accept').set(nairobi.token).send({ agentDid: nairobi.did, parcelId: walkUp, size: 'S', destZone: `ZplKisumu${tag}`, destPudoDid: kisumu.did, senderMobile: '+254700000301', receiverMobile: '+254700000302', dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), nairobi.did), paymentMode: 'prepaid' }).expect(201)).body;
    const counter = await http().get(`/v1/sbg/agents/${nairobi.did}/parcels/${walkUp}/label.zpl`).set(nairobi.token).expect(200);
    expect(counter.headers['content-type']).toMatch(/^text\/plain/);
    const zpl = counter.text;
    expect(labelsIn(zpl)).toBe(1);
    expect(zpl).toMatch(/\^PW800\n\^LL1200/);
    expect(zpl).toContain(`^BQN,2,10^FH_^FDQA,sbg:parcel:${walkUp}^FS`);
    expect(zpl).toContain(taken.trackingKey);
    expect(zpl).toContain('Kisumu _5ECorner_7E');
    expect(zpl).not.toContain('^Corner~');
    // A parcel never carries its own key.
    expect(zpl).not.toContain(taken.otp);
    // Another shop's parcel reads as not there; another shop's counter is not this one's.
    await http().get(`/v1/sbg/agents/${kisumu.did}/parcels/${walkUp}/label.zpl`).set(kisumu.token).expect(404);
    await http().get(`/v1/sbg/agents/${nairobi.did}/parcels/${walkUp}/label.zpl`).set(kisumu.token).expect(403);

    // A STORE: its paid order's label prints again, and as ZPL; another store's does not.
    const store = await aStore();
    const order = { vendorId: store.id, originPudoDid: nairobi.did, destPudoDid: kisumu.did, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef: 'content.jpg' };
    const made = (await http().post('/v1/sbg/inbound/orders').set(store.token).send({ ...order, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(201)).body;
    const parcelId = made.parcel.parcelId as string;
    const own = `/v1/sbg/vendors/${store.id}/orders/${parcelId}`;
    expect((await http().get(`${own}/label`).set(store.token).expect(200)).body.svg).toBe(made.label.svg);
    const storeZpl = (await http().get(`${own}/label.zpl`).set(store.token).expect(200)).text;
    expect(storeZpl).toContain(`sbg:parcel:${parcelId}`);
    expect(storeZpl).toContain('Pre-paid');
    expect(storeZpl).not.toContain(made.parcel.collectionCode);
    const other = await aStore();
    await http().get(`/v1/sbg/vendors/${other.id}/orders/${parcelId}/label.zpl`).set(other.token).expect(404);
    await http().get(`${own}/label.zpl`).set(other.token).expect(403);

    // An order not yet paid has no label to print — said so.
    const broke = await aStore(false);
    const unpaid = (await http().post('/v1/sbg/inbound/orders').set(broke.token).send({ ...order, vendorId: broke.id, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), broke.token) }).expect(201)).body;
    expect(unpaid.paid).toBe(false);
    const refused = await http().get(`/v1/sbg/vendors/${broke.id}/orders/${unpaid.parcel.parcelId}/label.zpl`).set(broke.token).expect(400);
    expect(refused.headers['content-type']).toMatch(/json/);
    expect(refused.body.detail).toMatch(/once the order is paid/);
  });

  it('gives a store’s own system its label again through the shipping API — as it came, or as ZPL when it asks (round 28)', async () => {
    const tag = digits();
    const nairobi = await aShop(`Nairobi API ${tag}`, `ApiNairobi${tag}`);
    const kisumu = await aShop(`Kisumu API ${tag}`, `ApiKisumu${tag}`);
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `ApiNairobi → ApiKisumu ${tag}`, originZone: `ApiNairobi${tag}`, destZone: `ApiKisumu${tag}` }).expect(201);
    const keyOf = async (store: { id: string; token: { authorization: string } }, kind: 'secret' | 'publishable', mode: 'live' | 'test' = 'live') =>
      (await http().post(`/v1/sbg/vendors/${store.id}/api-keys`).set(store.token).send({ kind, mode }).expect(201)).body.secret as string;
    const shipment = { from: { pointId: nairobi.did }, to: { pointId: kisumu.did }, dimensionsCm: { l: 20, w: 15, h: 10 }, weightKg: 1, buyerMobile: '+254700000401', contentPhotoRef: 'content.jpg' };
    const mint = async (key: string) => (await http().post('/v1/sbg/shipping/shipments').set('x-sbg-key', key).send({ ...shipment, contentPhotoRef: await shipmentPhotoOver(app.getHttpServer(), key) }).expect(201)).body;
    const label = (key: string, id: string, format?: string) => http().get(`/v1/sbg/shipping/shipments/${id}/label${format ? `?format=${format}` : ''}`).set('x-sbg-key', key);

    const store = await aStore();
    const sk = await keyOf(store, 'secret');
    const made = await mint(sk);
    expect(made.paid).toBe(true);
    // As it came when it was made…
    expect((await label(sk, made.shipmentId).expect(200)).body.svg).toBe(made.label.svg);
    expect((await label(sk, made.shipmentId, 'svg').expect(200)).body.svg).toBe(made.label.svg);
    // …or for a thermal printer, asked for on this request.
    const zpl = await label(sk, made.shipmentId, 'zpl').expect(200);
    expect(zpl.headers['content-type']).toMatch(/^text\/plain/);
    expect(zpl.text).toContain(`^FDQA,sbg:parcel:${made.shipmentId}^FS`);
    expect(zpl.text).toContain(made.trackingKey);
    expect((await label(sk, made.shipmentId, 'pdf').expect(400)).body).toMatchObject({ code: 'INVALID_INPUT', params: { field: 'format' } });

    // A publishable key sits in a page: no label for it. Another store's key: no such shipment. A test key made nothing.
    expect((await label(await keyOf(store, 'publishable'), made.shipmentId, 'zpl').expect(403)).body.detail).toMatch(/secret key/);
    const other = await aStore();
    await label(await keyOf(other, 'secret'), made.shipmentId, 'zpl').expect(404);
    const simulated = await mint(await keyOf(store, 'secret', 'test'));
    expect((await label(sk, simulated.shipmentId, 'zpl').expect(404)).body.detail).toMatch(/simulated shipment/);

    // Not paid yet: no label, said in the usual way.
    const broke = await aStore(false);
    const bsk = await keyOf(broke, 'secret');
    const unpaid = await mint(bsk);
    expect(unpaid.paid).toBe(false);
    const refused = await label(bsk, unpaid.shipmentId, 'zpl').expect(400);
    expect(refused.headers['content-type']).toMatch(/json/);
    expect(refused.body.detail).toMatch(/once the order is paid/);
  });

  it('prints a business’s package labels as ZPL — one a package, each SSCC as the printer’s own GS1-128 — for whoever reads the load', async () => {
    const owner = async (name: string) => {
      const phone = `+2547${digits()}3`.slice(0, 13);
      const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
      await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
      const email = `zpl-${digits()}@example.com`;
      const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
      const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
      return (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${digits()}`, country: 'KE', registrationNo: `ZPL-${digits()}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    };
    const biz = await owner('Jenga Bricks');
    const prefix = `61${String(Math.floor(Math.random() * 90_000) + 10_000)}`;
    await http().post('/v1/sbg/business/me/gs1').set(bearer(biz)).send({ companyPrefix: prefix, extensionDigit: 3 }).expect(201);
    const { freightId } = (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Clay bricks', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Nakuru depot', destLocation: { lat: -0.3, lng: 36.08 }, weightKg: 900, packaging: 'palletised', packages: 3 }).expect(201)).body;
    const codes = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/package-labels`).set(bearer(biz)).expect(200)).body.codes as string[];
    expect(codes).toHaveLength(3);
    const zpl = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/package-labels.zpl`).set(bearer(biz)).expect(200)).text;
    expect(labelsIn(zpl)).toBe(3);
    codes.forEach((c, i) => {
      expect(zpl).toContain(`^BCN,224,N,N,N^FD>;>800${c}^FS`);
      expect(zpl).toContain(`Package ${i + 1} of 3`);
      expect(zpl).toContain(`(00) ${c}`);
    });
    // Whoever does not read the load does not get its labels.
    await http().get(`/v1/sbg/dispatch/freight/${freightId}/package-labels.zpl`).set(bearer(await owner('Rival Bricks'))).expect(404);
  });
});
