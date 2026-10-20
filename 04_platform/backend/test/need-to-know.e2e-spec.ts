import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';

/**
 * NEED TO KNOW, over the wire (the ISO 28000 check: "Any shop can read any parcel's history"). A parcel's number opened
 * its scans and photo ids to any shop that knew it. A shop reads the whole history of a parcel of its own — taken in
 * there, addressed there — and of one coming off a bus only what it needs to take it in; of anybody else's, nothing.
 */
describe('a parcel’s history is read by the shops it belongs to', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();
  let seq = 0;

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

  async function aShop(shopName: string, zone: string): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-NTK-${u}`, mobile: `+2547${u}8`, deviceImei: `IMEI-NTK-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const shopPhoto = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await shopPhoto('kyc_id'), tradingLicenceRef: await shopPhoto('kyc_licence'), shopPhotoRefs: [await shopPhoto('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, token };
  }

  it('the whole history to the shops it belongs to, the basics of one coming off a bus, nothing to anybody else', async () => {
    const north = await aShop(`North NTK ${tag}`, `NtkNorth${tag}`);
    const south = await aShop(`South NTK ${tag}`, `NtkSouth${tag}`);
    const east = await aShop(`East NTK ${tag}`, `NtkEast${tag}`);
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `NTK Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const storeToken = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(storeToken).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    await http().post('/v1/sbg/mdps').set(operator).send({ name: `NTK Hub ${tag}`, zones: [`NtkSouth${tag}`], location: { lat: -1.25, lng: 36.9 } }).expect(201);
    const order = (await http().post('/v1/sbg/inbound/orders').set(storeToken).send({ vendorId: made.vendorId, originPudoDid: north.did, destPudoDid: south.did, buyerMobile: `+2547${digits()}2`, size: 'S', weightKg: 1, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), storeToken) }).expect(201)).body;
    const parcelId = order.parcel.parcelId as string;
    const read = (who: { authorization: string }) => http().get(`/v1/sbg/parcels/${parcelId}`).set(who);
    // Before it is brought in: the shop it is committed to, expecting it at its counter.
    expect((await read(north.token).expect(200)).body).toMatchObject({ parcelId });
    await http().post(`/v1/sbg/parcels/${parcelId}/intake`).set(north.token).send({ agentDid: north.did }).expect(201);

    // The shop it was taken in at, and the shop it is addressed to: the whole of it. Staff: always.
    const whole = (await read(north.token).expect(200)).body;
    expect(whole).toMatchObject({ parcelId, scans: expect.any(Array) });
    expect(whole.scans.length).toBeGreaterThan(0);
    expect((await read(south.token).expect(200)).body).toHaveProperty('scans');
    expect((await read(operator).expect(200)).body).toHaveProperty('scans');
    // Any other shop that knows the number: nothing — not even that it exists.
    expect((await read(east.token).expect(404)).body.detail).toBe('No parcel of this shop has that number');

    // On a bus: a counter it may be handed to reads what it needs to take it in — never its scans or photographs.
    const bag = (await http().post(`/v1/sbg/agents/${north.did}/totes`).set(north.token).send({ destZone: `NtkSouth${tag}` }).expect(201)).body.code as string;
    await http().post(`/v1/sbg/agents/${north.did}/totes/${bag}/fill`).set(north.token).send({ parcelId }).expect(201);
    seq += 1;
    const sealPhoto = (await http().post('/v1/sbg/media').set(north.token).send({ kind: 'seal', dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`seal:${tag}:${seq}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${north.did}/totes/${bag}/seal`).set(north.token).send({ closure: { photoRef: sealPhoto } }).expect(201);
    await http().post(`/v1/sbg/totes/${bag}/load`).set(operator).send({ driverBadgeId: 'BUS-3' }).expect(201);
    const arriving = (await read(east.token).expect(200)).body;
    expect(arriving).toEqual({ parcelId, status: 'On_Bus', size: 'S', origin: `NtkNorth${tag}`, destination: `NtkSouth${tag}` });
    expect((await read(north.token).expect(200)).body).toHaveProperty('scans');
  });
});
