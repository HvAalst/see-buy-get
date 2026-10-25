import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ssccOf } from '../src/foundation/gs1/gs1';
import { ShipperCodesService, vendorCoder } from '../src/modules/pudo/shipper-codes.service';
import { contentPhotoOver, shipmentPhotoOver } from './content-photo';
import { AGREED } from './agreed';

/**
 * A STORE'S LABELS CARRY A GS1 CODE, over the wire (round 29, the user: "A store's labels carry a GS1 code"; "In the Store
 * app, as a business does"). A store gives its GS1 company prefix in the Store app; each of its parcels, once paid, is
 * given an SSCC under it, printed on its label and its thermal label, said on its order and to its own system. The prefix
 * is held to a business's rules: the same digit another uses is refused, and a store may dispute it with its licence.
 */
describe('a store’s labels carry a GS1 code, over the wire', () => {
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

  async function aShop(shopName: string, zone: string): Promise<string> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-SG1-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-SG1-${u}`,
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
    await fund(`/v1/sbg/agents/${did}/top-up`, operator, 50);
    return did;
  }
  const fund = async (path: string, token: { authorization: string }, amount: number) => {
    const asked = await http().post(path).set(token).send({ amount }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount }).expect(201);
  };
  async function aStore(funded = true): Promise<{ id: string; token: { authorization: string } }> {
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ ...AGREED, name: `GS1 Store ${digits()}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const token = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    if (funded) await fund(`/v1/sbg/vendors/${made.vendorId}/top-up`, token, 5000);
    return { id: made.vendorId, token };
  }
  async function aBusiness(name: string): Promise<string> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `sg1-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    return (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `SG1-${tag}-${seq}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
  }
  async function aStaff(name: string): Promise<string> {
    const made = await http().post('/v1/sbg/operators').set(operator).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    return (await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201)).body.token.access_token;
  }
  const licence = async (token: { authorization: string }) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`sg1:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(token).send({ kind: 'gs1_licence', dataUrl }).expect(201)).body.mediaId as string;
  };
  const prefix = () => `62${String(Math.floor(Math.random() * 90_000) + 10_000)}`;

  it('gives each paid parcel of a store an SSCC under its prefix: on its labels, its order and to its own system', async () => {
    const nairobi = await aShop(`Nairobi SG1 ${tag}`, `Sg1Nairobi${tag}`);
    const kisumu = await aShop(`Kisumu SG1 ${tag}`, `Sg1Kisumu${tag}`);
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `Sg1Nairobi → Sg1Kisumu ${tag}`, originZone: `Sg1Nairobi${tag}`, destZone: `Sg1Kisumu${tag}` }).expect(201);
    const store = await aStore();
    const P = prefix();
    const order = { vendorId: store.id, originPudoDid: nairobi, destPudoDid: kisumu, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef: 'content.jpg' };

    // Staff give a store's prefix for it no more than they change its other settings.
    await http().put(`/v1/sbg/vendors/${store.id}/gs1`).set(operator).send({ companyPrefix: P, extensionDigit: 2 }).expect(403);
    expect((await http().put(`/v1/sbg/vendors/${store.id}/gs1`).set(store.token).send({ companyPrefix: P, extensionDigit: 2 }).expect(200)).body.gs1).toMatchObject({ companyPrefix: P, extensionDigit: 2 });
    expect((await http().get(`/v1/sbg/vendors/${store.id}`).set(store.token).expect(200)).body.gs1).toMatchObject({ companyPrefix: P, extensionDigit: 2, left: expect.any(Number) });

    // Paid at once: its SSCC, on the label as a person reads it and as a scanner does, on the thermal label, on the order.
    const made = (await http().post('/v1/sbg/inbound/orders').set(store.token).send({ ...order, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(201)).body;
    const first = ssccOf(P, 2, 0);
    expect(made.parcel.sscc).toBe(first);
    expect(made.label.svg).toContain(`(00) ${first}`);
    expect((await http().get(`/v1/sbg/vendors/${store.id}/orders/${made.parcel.parcelId}`).set(store.token).expect(200)).body.sscc).toBe(first);
    expect((await http().get(`/v1/sbg/vendors/${store.id}/orders/${made.parcel.parcelId}/label.zpl`).set(store.token).expect(200)).text).toContain(`^FD>;>800${first}^FS`);

    // Through the shipping API: the next number, said on the shipment and when it is read back.
    const sk = (await http().post(`/v1/sbg/vendors/${store.id}/api-keys`).set(store.token).send({ kind: 'secret', mode: 'live' }).expect(201)).body.secret as string;
    const minted = (await http().post('/v1/sbg/shipping/shipments').set('x-sbg-key', sk).send({ from: { pointId: nairobi }, to: { pointId: kisumu }, dimensionsCm: { l: 20, w: 15, h: 10 }, weightKg: 1, buyerMobile: '+254700000501', contentPhotoRef: await shipmentPhotoOver(app.getHttpServer(), sk) }).expect(201)).body;
    expect(minted.sscc).toBe(ssccOf(P, 2, 1));
    expect((await http().get(`/v1/sbg/shipping/shipments/${minted.shipmentId}`).set('x-sbg-key', sk).expect(200)).body.sscc).toBe(ssccOf(P, 2, 1));

    // Given up: the next carries none; what was labelled keeps its code.
    await http().delete(`/v1/sbg/vendors/${store.id}/gs1`).set(store.token).expect(200);
    const after = (await http().post('/v1/sbg/inbound/orders').set(store.token).send({ ...order, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(201)).body;
    expect(after.parcel.sscc).toBeUndefined();
    expect((await http().get(`/v1/sbg/vendors/${store.id}/orders/${made.parcel.parcelId}`).set(store.token).expect(200)).body.sscc).toBe(first);

    // Paid later: given its code when it is paid, not before.
    const later = await aStore(false);
    const L = prefix();
    await http().put(`/v1/sbg/vendors/${later.id}/gs1`).set(later.token).send({ companyPrefix: L, extensionDigit: 0 }).expect(200);
    const waiting = (await http().post('/v1/sbg/inbound/orders').set(later.token).send({ ...order, vendorId: later.id, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), later.token) }).expect(201)).body;
    expect(waiting.paid).toBe(false);
    expect(waiting.parcel.sscc).toBeUndefined();
    await fund(`/v1/sbg/vendors/${later.id}/top-up`, later.token, 5000);
    const settled = (await http().post(`/v1/sbg/parcels/${waiting.parcel.parcelId}/settle`).set(later.token).expect(201)).body;
    expect(settled.parcel.sscc).toBe(ssccOf(L, 0, 0));
    expect(settled.label.svg).toContain(`(00) ${ssccOf(L, 0, 0)}`);
  });

  it('refuses to settle an order before billing it when the store’s digit has no code left — and settles under another', async () => {
    const nairobi = await aShop(`Nairobi SG1b ${tag}`, `Sg1bNairobi${tag}`);
    const kisumu = await aShop(`Kisumu SG1b ${tag}`, `Sg1bKisumu${tag}`);
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `Sg1bNairobi → Sg1bKisumu ${tag}`, originZone: `Sg1bNairobi${tag}`, destZone: `Sg1bKisumu${tag}` }).expect(201);
    const store = await aStore(false);
    const P = `62${String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000)}`; // 12 digits: 10,000 codes a digit
    await http().put(`/v1/sbg/vendors/${store.id}/gs1`).set(store.token).send({ companyPrefix: P, extensionDigit: 7 }).expect(200);
    const waiting = (await http().post('/v1/sbg/inbound/orders').set(store.token).send({ vendorId: store.id, originPudoDid: nairobi, destPudoDid: kisumu, buyerMobile: `+2547${digits()}2`, size: 'M', weightKg: 2, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(201)).body;
    expect(waiting.paid).toBe(false);

    // Every code under digit 7 given out since the order was made.
    const codes = app.get(ShipperCodesService, { strict: false });
    for (let n = 0; n < 20; n++) codes.issue(`frt_fill_${tag}_${n}`, vendorCoder(store.id), 500);
    await fund(`/v1/sbg/vendors/${store.id}/top-up`, store.token, 5000);
    const before = (await http().get(`/v1/sbg/vendors/${store.id}`).set(store.token).expect(200)).body.balance;
    const refused = await http().post(`/v1/sbg/parcels/${waiting.parcel.parcelId}/settle`).set(store.token).expect(400);
    expect(refused.body.detail).toMatch(/Only 0 GS1 codes are left under extension digit 7.*the Store app, under My store/);
    // Not billed, and still waiting: nothing was taken for a label that could not be printed.
    expect((await http().get(`/v1/sbg/vendors/${store.id}`).set(store.token).expect(200)).body.balance).toBe(before);
    expect((await http().get(`/v1/sbg/vendors/${store.id}/orders/${waiting.parcel.parcelId}`).set(store.token).expect(200)).body.paidStatus).toBe('unpaid');

    await http().put(`/v1/sbg/vendors/${store.id}/gs1`).set(store.token).send({ companyPrefix: P, extensionDigit: 8 }).expect(200);
    const settled = (await http().post(`/v1/sbg/parcels/${waiting.parcel.parcelId}/settle`).set(store.token).expect(201)).body;
    expect(settled.parcel.sscc).toBe(ssccOf(P, 8, 0));
    expect((await http().get(`/v1/sbg/vendors/${store.id}`).set(store.token).expect(200)).body.balance).toBeLessThan(before);
  });

  it('holds a store’s prefix to a business’s rules — the same digit refused, disputed with its licence, decided by two staff', async () => {
    const P = prefix();
    const biz = await aBusiness('Jenga Bricks');
    await http().post('/v1/sbg/business/me/gs1').set(bearer(biz)).send({ companyPrefix: P, extensionDigit: 4 }).expect(201);
    const store = await aStore();
    const refused = await http().put(`/v1/sbg/vendors/${store.id}/gs1`).set(store.token).send({ companyPrefix: P, extensionDigit: 4 }).expect(409);
    expect(refused.body.code).toBe('GS1_PREFIX_TAKEN');

    // The store says it is its own, with its licence; the business using it is told, by the store's name.
    const disputes = `/v1/sbg/vendors/${store.id}/gs1/disputes`;
    await http().post(disputes).set(store.token).send({ companyPrefix: P, extensionDigit: 4, licenceRef: await licence(store.token), forClientId: 'x' }).expect(400);
    const opened = (await http().post(disputes).set(store.token).send({ companyPrefix: P, extensionDigit: 4, licenceRef: await licence(store.token) }).expect(201)).body;
    expect(opened).toMatchObject({ side: 'claimant', state: 'open', licenceSent: true, holderNames: [`Jenga Bricks ${tag}`] });
    expect((await http().get(disputes).set(store.token).expect(200)).body.items).toEqual([expect.objectContaining({ disputeId: opened.disputeId })]);
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(bearer(biz)).expect(200)).body)).toContain(`A store says the GS1 prefix ${P} is its own`);
    // Another store may not answer it.
    const other = await aStore();
    await http().post(`/v1/sbg/vendors/${other.id}/gs1/disputes/${opened.disputeId}/withdraw`).set(other.token).expect(404);

    // The business sends its licence; staff read the store as a store; two decide it for the store.
    await http().post(`/v1/sbg/business/me/gs1/disputes/${opened.disputeId}/licence`).set(bearer(biz)).send({ licenceRef: await licence(bearer(biz)) }).expect(200);
    const amina = await aStaff('amina-sg1');
    const brian = await aStaff('brian-sg1');
    const row = (await http().get('/v1/sbg/gs1-disputes').set(bearer(amina)).expect(200)).body.items.find((d: { disputeId: string }) => d.disputeId === opened.disputeId);
    expect(row.claimant).toMatchObject({ store: true, licenceRef: expect.any(String) });
    expect(row.holders[0].store).toBeUndefined();
    await http().post(`/v1/sbg/gs1-disputes/${opened.disputeId}/propose`).set(bearer(amina)).send({ to: 'claimant', what: 'GS1 Kenya register: the prefix is licensed to the store', reason: 'The licence is in the store’s name' }).expect(200);
    await http().post(`/v1/sbg/gs1-disputes/${opened.disputeId}/approve`).set(bearer(brian)).send({}).expect(200);

    // The store prints under it now; the business does not, and is told it is a store's.
    expect((await http().get(`/v1/sbg/vendors/${store.id}`).set(store.token).expect(200)).body.gs1).toMatchObject({ companyPrefix: P, extensionDigit: 4 });
    expect((await http().get('/v1/sbg/business/me').set(bearer(biz)).expect(200)).body.gs1).toBeUndefined();
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(bearer(biz)).expect(200)).body)).toContain(`The GS1 prefix ${P} is a store's`);
    expect((await http().get(disputes).set(store.token).expect(200)).body.items[0]).toMatchObject({ state: 'decided', decided: { mine: true } });
  });

  it('tells a store using a prefix a business claims — at its own bell, pointed to the Store app — and takes its licence there', async () => {
    const P = prefix();
    const store = await aStore();
    await http().put(`/v1/sbg/vendors/${store.id}/gs1`).set(store.token).send({ companyPrefix: P, extensionDigit: 1 }).expect(200);
    const biz = await aBusiness('Pwani Fish');
    // Refused by a STORE's digit, and told so: "another business" would send it looking for one.
    expect((await http().post('/v1/sbg/business/me/gs1').set(bearer(biz)).send({ companyPrefix: P, extensionDigit: 1 }).expect(409)).body.detail).toMatch(/^A store prints SSCCs under this prefix with extension digit 1\..*that store should not use it/);
    const opened = (await http().post('/v1/sbg/business/me/gs1/disputes').set(bearer(biz)).send({ companyPrefix: P, extensionDigit: 1, licenceRef: await licence(bearer(biz)) }).expect(201)).body;
    expect(opened.holderNames).toEqual([expect.stringMatching(/^GS1 Store /)]);

    const told = JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(store.token).expect(200)).body);
    expect(told).toContain(`Another business says the GS1 prefix ${P} is its own`);
    expect(told).toContain('Send yours in the Store app, under My store');
    const mine = `/v1/sbg/vendors/${store.id}/gs1/disputes`;
    expect((await http().get(mine).set(store.token).expect(200)).body.items[0]).toMatchObject({ disputeId: opened.disputeId, side: 'holder', licenceSent: false });
    expect((await http().post(`${mine}/${opened.disputeId}/licence`).set(store.token).send({ licenceRef: await licence(store.token) }).expect(200)).body).toMatchObject({ side: 'holder', licenceSent: true });
    // The store did not open it, so it cannot take it back; the business can, and the store is told.
    await http().post(`${mine}/${opened.disputeId}/withdraw`).set(store.token).expect(404);
    await http().post(`/v1/sbg/business/me/gs1/disputes/${opened.disputeId}/withdraw`).set(bearer(biz)).expect(200);
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(store.token).expect(200)).body)).toContain(`The dispute about GS1 prefix ${P} was withdrawn`);
    expect((await http().get(`/v1/sbg/vendors/${store.id}`).set(store.token).expect(200)).body.gs1).toMatchObject({ companyPrefix: P, extensionDigit: 1 });
  });
});
