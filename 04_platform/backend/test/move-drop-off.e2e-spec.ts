import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';
import { declared } from './declared';
import { AGREED } from './agreed';

/**
 * 2026-11-06 — A STORE MOVES ITS ORDER TO ANOTHER DROP-OFF SHOP, over the wire (the owner: "moving needs a re-price, but it's
 * not automated by us so the user is aware of the implication"). The store asks what it would do — the new price beside the
 * old — and moves it at that price; a price that changed since is refused with the new one. Only the store itself: not
 * another store, not staff.
 */
describe('a store moves its order to another drop-off shop, over the wire', () => {
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

  async function aShop(shopName: string, zone: string): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-MOV-${u}`, mobile: `+2547${u}8`, deviceImei: `IMEI-MOV-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const shopPhoto = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await shopPhoto('kyc_id'), tradingLicenceRef: await shopPhoto('kyc_licence'), shopPhotoRefs: [await shopPhoto('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, token };
  }

  async function aStore(name: string): Promise<{ vendorId: string; token: { authorization: string } }> {
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ ...AGREED, name, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const token = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(token).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    return { vendorId: made.vendorId, token };
  }

  it('asked first, moved at the price shown, refused at a price that changed — and only by the store itself', async () => {
    const a = await aShop(`Move A ${tag}`, `MoveNorth${tag}`);
    const b = await aShop(`Move B ${tag}`, `MoveNorth${tag}`);
    const dest = await aShop(`Move Dest ${tag}`, `MoveSouth${tag}`);
    await http().post('/v1/sbg/mdps').set(operator).send({ name: `Move Hub ${tag}`, zones: [`MoveSouth${tag}`], location: { lat: -1.25, lng: 36.9 } }).expect(201);
    const store = await aStore(`Move Store ${tag}`);
    const other = await aStore(`Other Store ${tag}`);
    const order = (await http().post('/v1/sbg/inbound/orders').set(store.token).send({ vendorId: store.vendorId, originPudoDid: a.did, destPudoDid: dest.did, buyerMobile: `+2547${digits()}1`, size: 'S', weightKg: 1, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(201)).body.parcel.parcelId as string;
    const path = `/v1/sbg/vendors/${store.vendorId}/orders/${order}/move`;

    // Asked: what it would cost from the other shop, and the balance after — nothing done.
    const view = (await http().get(path).query({ to: b.did }).set(store.token).expect(200)).body;
    expect(view).toMatchObject({ canMove: true, pays: 'balance', from: { did: a.did }, to: { did: b.did } });
    expect(typeof view.now).toBe('number');

    // Not another store's to look at or move, and not staff's.
    await http().get(path).query({ to: b.did }).set(other.token).expect(403);
    await http().post(path).set(other.token).send({ to: b.did, expectedTotal: view.now }).expect(403);
    await http().post(path).set(operator).send({ to: b.did, expectedTotal: view.now }).expect(403);

    // A price other than the one shown is refused, with the one it is.
    const changed = (await http().post(path).set(store.token).send({ to: b.did, expectedTotal: view.now + 1 }).expect(409)).body;
    expect(changed).toMatchObject({ code: 'PRICE_CHANGED' });

    // At the price shown, it moves: handed in at the new shop, and no longer at the first.
    const moved = (await http().post(path).set(store.token).send({ to: b.did, expectedTotal: view.now }).expect(201)).body;
    expect(moved).toMatchObject({ moved: true, to: { did: b.did }, now: view.now });
    expect((await http().post(`/v1/sbg/parcels/${order}/intake`).set(a.token).send({ agentDid: a.did }).expect(403)).body).toMatchObject({ code: 'WRONG_PUDO' });
    await http().post(`/v1/sbg/parcels/${order}/intake`).set(b.token).send({ agentDid: b.did }).expect(201);

    // Handed in, it moves no more.
    const late = (await http().get(path).query({ to: a.did }).set(store.token).expect(200)).body;
    expect(late).toMatchObject({ canMove: false });
    expect(late.why).toMatch(/handed in already/);
  });
});
