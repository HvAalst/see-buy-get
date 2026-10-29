import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';
import { AGREED } from './agreed';
import { FundingService } from '../src/foundation/funding/funding.service';
import { VendorService } from '../src/modules/pudo/vendor.service';
import { BusinessHookService } from '../src/modules/pudo/business-hooks.service';

/**
 * A BUSINESS'S PARCELS FROM ITS OWN SYSTEM, over the wire (the user, 2026-10-29: sent "both" on screen and from its own
 * system). Its company key sends a parcel through the same steps its people take in the app, paid from the same balance; a
 * test key runs every check and prices it, and nothing is made or paid; a retried send is answered once; its system hears
 * each step of the parcel as its Parcels screen reads it. Another business's key finds none of it.
 */
describe('a business’s parcels from its own system', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const keyed = (key: string) => ({ 'x-sbg-key': key });
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

  const simulate = async (fundingId: string, amount: number) => http().post(`/v1/rails/funding/${fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount }).expect(201);

  async function aShop(shopName: string, zone: string, location: { lat: number; lng: number }): Promise<string> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-BPI-${u}`, mobile: `+2547${u}6`, deviceImei: `IMEI-BPI-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photograph = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: await photograph('kyc_licence'), shopPhotoRefs: [await photograph('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await simulate(asked.body.fundingId, 50);
    return did;
  }

  async function aBusiness(name: string): Promise<{ token: { authorization: string }; entityId: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `bpapi-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const created = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `BPI-${tag}-${seq}`, activities: ['shipper'], yourName: `${name} Owner` }).expect(201);
    return { token: bearer(created.body.token.access_token as string), entityId: created.body.business.entityId as string };
  }

  let nairobi = '';
  let kisumu = '';
  beforeAll(async () => {
    nairobi = await aShop(`Nairobi BPI ${tag}`, `BpiNairobi${tag}`, { lat: -1.286, lng: 36.817 });
    kisumu = await aShop(`Kisumu BPI ${tag}`, `BpiKisumu${tag}`, { lat: -0.0917, lng: 34.768 });
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `BpiNairobi → BpiKisumu ${tag}`, originZone: `BpiNairobi${tag}`, destZone: `BpiKisumu${tag}` }).expect(201);
  });

  it('sends from its system as from the app: a test key prices it and keeps nothing, a retried send is answered once, and its system hears each step', async () => {
    const biz = await aBusiness('Simba Spares');
    const vendors = app.get(VendorService);
    // Its people open the account and pay money in; a key does neither.
    await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201);
    await http().post('/v1/sbg/business/me/parcels/top-up').set(biz.token).send({ amount: 2000 }).expect(201);
    const till = vendors.forBusiness(biz.entityId)!;
    await simulate(app.get(FundingService).openFor(till.vendorId)!.fundingId, 2000);
    // Its system is told: an address, as an owner gives it in the app.
    await http().put('/v1/sbg/business/me/system').set(biz.token).send({ url: 'https://erp.simba.example/hooks' }).expect(200);
    const live = (await http().post('/v1/sbg/business/me/keys').set(biz.token).send({ mode: 'live', label: 'ERP' }).expect(201)).body.secret as string;
    const test = (await http().post('/v1/sbg/business/me/keys').set(biz.token).send({ mode: 'test', label: 'ERP sandbox' }).expect(201)).body.secret as string;

    expect((await http().get('/v1/sbg/api/business/parcels/account').set(keyed(live)).expect(200)).body).toMatchObject({ open: true, balance: 2000 });
    const photo = (await http().post('/v1/sbg/api/business/parcels/photos').set(keyed(live)).send({ dataUrl: CONTENTS_PNG }).expect(201)).body;
    expect(photo).toEqual({ photoId: expect.stringMatching(/^med_/), keptUnusedUntil: expect.any(String) });
    const parcel = (contentPhotoRef: string) => ({ originPudoDid: nairobi, destPudoDid: kisumu, receiverMobile: '+254722000111', dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.5, contentPhotoRef, reference: 'SO-5531' });

    // A name is no photograph — for a test key exactly as for a live one.
    for (const k of [test, live]) expect((await http().post('/v1/sbg/api/business/parcels').set(keyed(k)).send(parcel('contents.jpg')).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    // A test key: every check, the price, whether the balance covers it — and nothing made, nothing paid.
    const tried = (await http().post('/v1/sbg/api/business/parcels').set(keyed(test)).send(parcel(photo.photoId)).expect(201)).body;
    expect(tried).toMatchObject({ test: true, currency: 'KES', routeMode: 'flexible', covered: true, balance: 2000, replayed: false });
    expect(tried.price).toBeGreaterThan(0);
    expect((await http().get('/v1/sbg/api/business/parcels').set(keyed(live)).expect(200)).body.total).toBe(0);
    expect(vendors.balanceOf(till.vendorId)).toBe(2000);

    // Live, sent twice under one idempotency key: one parcel, paid once.
    const once = (await http().post('/v1/sbg/api/business/parcels').set(keyed(live)).set('idempotency-key', `bp-${tag}`).send(parcel(photo.photoId)).expect(201)).body;
    const twice = (await http().post('/v1/sbg/api/business/parcels').set(keyed(live)).set('idempotency-key', `bp-${tag}`).send(parcel(photo.photoId)).expect(201)).body;
    expect(once).toMatchObject({ test: false, paid: true, replayed: false, parcel: { reference: 'SO-5531', sentBy: expect.stringMatching(/^its system \(ERP/), cost: tried.price } });
    expect(twice).toMatchObject({ replayed: true, parcel: { parcelId: once.parcel.parcelId } });
    expect(vendors.balanceOf(till.vendorId)).toBeCloseTo(2000 - tried.price, 2);
    const id = once.parcel.parcelId as string;
    // Read back by the key as by the app; its label once paid.
    expect((await http().get('/v1/sbg/api/business/parcels').set(keyed(live)).expect(200)).body.total).toBe(1);
    expect((await http().get(`/v1/sbg/api/business/parcels/${id}`).set(keyed(live)).expect(200)).body).toMatchObject({ parcelId: id, collectionCode: expect.stringMatching(/^COL-/) });
    expect((await http().get(`/v1/sbg/api/business/parcels/${id}/label`).set(keyed(live)).expect(200)).body.svg).toContain('<svg');
    expect((await http().get(`/v1/sbg/business/me/parcels/${id}`).set(biz.token).expect(200)).body.sentBy).toMatch(/^its system \(ERP/);

    // Its system heard it paid — the parcel as its screen reads it, the code to pass on included.
    const hooks = app.get(BusinessHookService);
    const heard = (event: string) => hooks.view(biz.entityId).messages.filter((m) => m.event === event).map((m) => JSON.parse(m.body).data.parcel);
    expect(heard('parcel.paid')).toEqual([expect.objectContaining({ parcelId: id, reference: 'SO-5531', collectionCode: expect.stringMatching(/^COL-/) })]);
    expect((await http().get('/v1/sbg/business/me/system').set(biz.token).expect(200)).body.events).toEqual(expect.arrayContaining(['parcel.paid', 'parcel.ready', 'parcel.collected', 'parcel.called_off']));

    // Another business's key: no such parcel.
    const rival = await aBusiness('Mlima Traders');
    const rivalKey = (await http().post('/v1/sbg/business/me/keys').set(rival.token).send({ mode: 'live' }).expect(201)).body.secret as string;
    expect((await http().get('/v1/sbg/api/business/parcels/account').set(keyed(rivalKey)).expect(200)).body).toMatchObject({ open: false, canOpen: true });
    expect((await http().post('/v1/sbg/api/business/parcels').set(keyed(rivalKey)).send(parcel(photo.photoId)).expect(400)).body.detail).toMatch(/^Open your parcel account first/);
    // Its key opens no account — its people do — and once they have, another's parcel is still not found, nor its photo its own.
    await http().post('/v1/sbg/api/business/parcels/account').set(keyed(rivalKey)).expect(404);
    await http().post('/v1/sbg/business/me/parcels/account').set(rival.token).expect(201);
    await http().get(`/v1/sbg/api/business/parcels/${id}`).set(keyed(rivalKey)).expect(404);
    await http().get(`/v1/sbg/api/business/parcels/${id}/label`).set(keyed(rivalKey)).expect(404);
    await http().post(`/v1/sbg/api/business/parcels/${id}/call-off`).set(keyed(rivalKey)).send({}).expect(404);
    const another = (await http().post('/v1/sbg/api/business/parcels/photos').set(keyed(live)).send({ dataUrl: CONTENTS_PNG }).expect(201)).body.photoId as string;
    expect((await http().post('/v1/sbg/api/business/parcels').set(keyed(rivalKey)).send(parcel(another)).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    // Its own test key, on an empty balance: priced, and told the balance would not pay for it.
    const rivalTest = (await http().post('/v1/sbg/business/me/keys').set(rival.token).send({ mode: 'test' }).expect(201)).body.secret as string;
    const own = (await http().post('/v1/sbg/api/business/parcels/photos').set(keyed(rivalKey)).send({ dataUrl: CONTENTS_PNG }).expect(201)).body.photoId as string;
    expect((await http().post('/v1/sbg/api/business/parcels').set(keyed(rivalTest)).send(parcel(own)).expect(201)).body).toMatchObject({ test: true, covered: false, balance: 0, price: tried.price });

    // Called off: a test key says what would happen and does nothing; the live key withdraws it, money back.
    expect((await http().post(`/v1/sbg/api/business/parcels/${id}/call-off`).set(keyed(test)).send({}).expect(201)).body).toMatchObject({ test: true, outcome: 'refund', amount: tried.price });
    expect((await http().get(`/v1/sbg/api/business/parcels/${id}`).set(keyed(live)).expect(200)).body.status).toBe('Created');
    expect((await http().post(`/v1/sbg/api/business/parcels/${id}/call-off`).set(keyed(live)).send({ reason: 'order cancelled' }).expect(201)).body).toMatchObject({ test: false, outcome: 'refund', done: true });
    expect(vendors.balanceOf(till.vendorId)).toBeCloseTo(2000, 2);
    expect(heard('parcel.called_off')).toEqual([expect.objectContaining({ parcelId: id, status: 'Voided' })]);
    expect(heard('parcel.called_off')[0].collectionCode).toBeUndefined();
  });
});
