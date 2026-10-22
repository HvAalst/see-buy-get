import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';

/**
 * A STORE'S CONTENT PHOTO, REALLY KEPT, over the wire (round 30, the user: "A store's content photo, really kept"; "It
 * sends the photo too"). The photo of what is in the box is the "before" a damage claim is judged against. The Store app
 * sent only its file name, and the shipping API took any text: a claim on a store's parcel had no photo to show. Now an
 * order is made only on a photo we hold — the store's own, of that parcel alone — from the app and from its own system.
 */
describe('a store’s content photo, really kept, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();

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

  const fund = async (path: string, token: { authorization: string }, amount: number) => {
    const asked = await http().post(path).set(token).send({ amount }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount }).expect(201);
  };
  async function aShop(shopName: string, zone: string): Promise<string> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-CPH-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-CPH-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photograph = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: await photograph('kyc_licence'), shopPhotoRefs: [await photograph('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    await fund(`/v1/sbg/agents/${did}/top-up`, operator, 50);
    return did;
  }
  async function aStore(): Promise<{ id: string; token: { authorization: string } }> {
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `Photo Store ${digits()}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const token = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    await fund(`/v1/sbg/vendors/${made.vendorId}/top-up`, token, 5000);
    return { id: made.vendorId, token };
  }
  const upload = async (token: { authorization: string }) => (await http().post('/v1/sbg/media').set(token).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
  let nairobi = '';
  let kisumu = '';
  beforeAll(async () => {
    nairobi = await aShop(`Nairobi CPH ${tag}`, `CphNairobi${tag}`);
    kisumu = await aShop(`Kisumu CPH ${tag}`, `CphKisumu${tag}`);
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `CphNairobi → CphKisumu ${tag}`, originZone: `CphNairobi${tag}`, destZone: `CphKisumu${tag}` }).expect(201);
  });

  it('makes a store’s order from the app only on a photo it sent: its own, of that parcel alone', async () => {
    const store = await aStore();
    const other = await aStore();
    const order = (contentPhotoRef: string) => ({ vendorId: store.id, originPudoDid: nairobi, destPudoDid: kisumu, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef });
    const balance = async () => (await http().get(`/v1/sbg/vendors/${store.id}`).set(store.token).expect(200)).body.balance as number;
    const before = await balance();

    // A file name — what the Store app used to send — and another store's photo: no photo of this parcel.
    for (const ref of ['IMG_2041.jpg', await upload(other.token)]) {
      const refused = await http().post('/v1/sbg/inbound/orders').set(store.token).send(order(ref)).expect(400);
      expect(refused.body).toMatchObject({ code: 'PHOTO_REQUIRED', detail: expect.stringMatching(/^We do not hold that photo of the contents/) });
    }
    expect(await balance()).toBe(before); // nothing billed for an order never made

    // Its own: made, and the photo is kept — the store reads it back.
    const photo = await upload(store.token);
    const made = (await http().post('/v1/sbg/inbound/orders').set(store.token).send(order(photo)).expect(201)).body;
    expect(made.parcel.contentPhotoRef).toBe(photo);
    const back = await http().get(`/v1/sbg/media/${photo}`).set(store.token).expect(200);
    expect(back.headers['content-type']).toMatch(/image\/png/);
    expect((await http().get(`/v1/sbg/vendors/${store.id}/orders/${made.parcel.parcelId}`).set(store.token).expect(200)).body.contentPhotoRef).toBe(photo);
    // One photo, one parcel: the next order photographs its own box.
    expect((await http().post('/v1/sbg/inbound/orders').set(store.token).send(order(photo)).expect(400)).body.detail).toMatch(/used for no other/);
  });

  it('takes the photo from the store’s own system with a secret key, and mints on it — in test as in live', async () => {
    const store = await aStore();
    const key = async (kind: 'secret' | 'publishable', mode: 'live' | 'test' = 'live') =>
      (await http().post(`/v1/sbg/vendors/${store.id}/api-keys`).set(store.token).send({ kind, mode }).expect(201)).body.secret as string;
    const [live, test, publishable] = [await key('secret'), await key('secret', 'test'), await key('publishable')];
    const shipment = (contentPhotoRef: string) => ({ from: { pointId: nairobi }, to: { pointId: kisumu }, dimensionsCm: { l: 20, w: 15, h: 10 }, weightKg: 1, buyerMobile: '+254700000301', contentPhotoRef });
    const mint = (k: string, ref: string) => http().post('/v1/sbg/shipping/shipments').set('x-sbg-key', k).send(shipment(ref));

    // A publishable key sits in a web page: it ships nothing, so it sends no photo.
    await http().post('/v1/sbg/shipping/photos').set('x-sbg-key', publishable).send({ dataUrl: CONTENTS_PNG }).expect(403);
    await http().post('/v1/sbg/shipping/photos').send({ dataUrl: CONTENTS_PNG }).expect(403);
    const sent = (await http().post('/v1/sbg/shipping/photos').set('x-sbg-key', live).send({ dataUrl: CONTENTS_PNG }).expect(201)).body;
    expect(sent).toEqual({ photoId: expect.stringMatching(/^med_/), keptUnusedUntil: expect.any(String) });
    expect(Date.parse(sent.keptUnusedUntil) - Date.now()).toBeGreaterThan(47 * 3_600_000);
    // Not an image: refused by name.
    expect((await http().post('/v1/sbg/shipping/photos').set('x-sbg-key', live).send({ dataUrl: 'data:text/plain;base64,aGVsbG8=' }).expect(415)).body.code).toBe('UNSUPPORTED_MEDIA');

    // A name is refused by a test key exactly as by a live one: a sandbox never mints what live would refuse.
    for (const k of [test, live]) expect((await mint(k, 'contents.jpg').expect(400)).body.detail).toMatch(/POST \/v1\/sbg\/shipping\/photos/);
    // A test key checks the photo and keeps nothing; the live shipment makes it its own.
    expect((await mint(test, sent.photoId).expect(201)).body.simulated).toBe(true);
    const made = (await mint(live, sent.photoId).expect(201)).body;
    expect(made.paid).toBe(true);
    expect((await http().get(`/v1/sbg/vendors/${store.id}/orders/${made.shipmentId}`).set(store.token).expect(200)).body.contentPhotoRef).toBe(sent.photoId);
    expect((await mint(live, sent.photoId).expect(400)).body.detail).toMatch(/used for no other/);
  });
});
