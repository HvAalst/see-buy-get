import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ssccOf } from '../src/foundation/gs1/gs1';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';
import { declared } from './declared';

/**
 * A STORE PARCEL'S SSCC FINDS ITS PARCEL, over the wire (round 32, the user: "A store parcel's SSCC at our counters";
 * "Every scan box"). Since round 29 a store's parcel carries its own GS1-128 barcode; scanned at a counter it found
 * nothing. Now it finds the parcel — for the shops it goes between, the hub it stands at and staff — and for anybody else
 * reads exactly as a code nobody was given, because serials run in order under a store's prefix.
 */
describe('a store parcel’s SSCC finds its parcel, over the wire', () => {
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
  /** A shop signed up, vetted and funded: its did and its own sign-in. */
  async function aShop(shopName: string, zone: string): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-SSC-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-SSC-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true }).expect(201);
    declared(app, 'shop', did); // the shop signs its security declaration, as at joining
    await fund(`/v1/sbg/agents/${did}/top-up`, operator, 50);
    return { did, token };
  }

  it('finds a store’s parcel by its GS1 barcode for the shops it goes between and staff — and for no other shop', async () => {
    const north = await aShop(`North SSC ${tag}`, `SscNorth${tag}`);
    const south = await aShop(`South SSC ${tag}`, `SscSouth${tag}`);
    const other = await aShop(`Other SSC ${tag}`, `SscNorth${tag}`);
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `SscNorth → SscSouth ${tag}`, originZone: `SscNorth${tag}`, destZone: `SscSouth${tag}` }).expect(201);
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `SSCC Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const store = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    await fund(`/v1/sbg/vendors/${made.vendorId}/top-up`, store, 5000);
    const P = `62${String(Math.floor(Math.random() * 90_000) + 10_000)}`;
    await http().put(`/v1/sbg/vendors/${made.vendorId}/gs1`).set(store).send({ companyPrefix: P, extensionDigit: 3 }).expect(200);
    const order = (await http().post('/v1/sbg/inbound/orders').set(store).send({ vendorId: made.vendorId, originPudoDid: north.did, destPudoDid: south.did, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store) }).expect(201)).body;
    const sscc = order.parcel.sscc as string;
    expect(sscc).toBe(ssccOf(P, 3, 0));
    const scan = (raw: string, who: { authorization: string }) => http().get('/v1/sbg/scan/parcel').query({ scanned: raw }).set(who);

    // The shop it is handed in at, as a scanner sends the barcode; the shop it goes to; staff.
    for (const raw of [`]C100${sscc}`, `(00) ${sscc}`, sscc]) expect((await scan(raw, north.token).expect(200)).body).toEqual({ parcelId: order.parcel.parcelId, sscc, status: 'Created' });
    expect((await scan(sscc, south.token).expect(200)).body.parcelId).toBe(order.parcel.parcelId);
    expect((await scan(sscc, operator).expect(200)).body.parcelId).toBe(order.parcel.parcelId);

    // Another shop, and the next serial nobody was given: the same answer, so the barcode never walks a store's parcels.
    const theirs = await scan(sscc, other.token).expect(404);
    const unknown = await scan(ssccOf(P, 3, 1), north.token).expect(404);
    expect(theirs.body.detail).toBe('No parcel you handle has that barcode');
    expect(unknown.body.detail).toBe(theirs.body.detail);
    // Not a GS1 barcode: said so by name. And nobody signed in reads nothing at all.
    expect((await scan(order.parcel.parcelId, north.token).expect(400)).body.detail).toMatch(/not a GS1 barcode/);
    await http().get('/v1/sbg/scan/parcel').query({ scanned: sscc }).expect(401);

    // Found, the counter goes on with it as with our QR: the shop takes it in.
    const found = (await scan(sscc, north.token).expect(200)).body.parcelId as string;
    expect((await http().post(`/v1/sbg/parcels/${found}/intake`).set(north.token).send({ agentDid: north.did }).expect(201)).body.status).toBe('At_PUDO');
  });
});
