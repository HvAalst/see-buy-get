import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { MdpService } from '../src/modules/pudo/mdp.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';
import { WalletGateService } from '../src/modules/pudo/wallet-gate.service';
import { AGREED } from './agreed';

/**
 * A PERSON'S PARCEL WITHDRAWN BY STAFF AT A HUB, over the wire (the user, 2026-10-27: "Back to its shop, sender pays"). Staff
 * are told first what it would do; withdrawn, it is turned round to the shop it was handed in at as a new parcel to its
 * sender — told in the app where to collect it and what they pay, the receiver that it will not come. The sender reads its
 * code in the Send app; the counter reads what to take in cash, and takes it from the float as it hands the parcel over.
 */
describe('a person’s parcel withdrawn at a hub, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
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

  /** A working shop and its own sign-in. */
  async function aShop(zone: string): Promise<{ did: string; owner: Record<string, string>; name: string }> {
    const u = digits();
    const day = { open: '00:00', close: '23:59' };
    const name = `Duka ${u}`;
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({ shopName: name, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }, fullName: `Duka ${u} owner`, nationalId: `ID-${u}`, mobile: `+2547${u}1`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const owner = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(owner).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(owner).send({ idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(owner).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, owner, name };
  }

  /** A person with their own phone and PIN, signed in as themselves. */
  async function aPerson(phone: string): Promise<Record<string, string>> {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `duka${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    return bearer(enrolled.body.token.access_token as string);
  }

  const inbox = async (who: Record<string, string>) => ((await http().get('/v1/sbg/notifications/inbox').set(who).expect(200)).body.items ?? []) as Array<{ kind: string; title: string; body: string }>;

  it('is said first, turned round to the shop it was handed in at, told to both sides in the app — and paid for in cash as its sender collects it', async () => {
    const zone = `ZW${digits()}`;
    const shop = await aShop(zone);
    const hub = app.get(MdpService).register({ name: `Ghala ${digits()}`, zones: [zone, 'FarTown'], location: { lat: -1.25, lng: 36.85 } }, { approvedBy: 'staff' });
    const senderPhone = `+2547${digits()}5`;
    const receiverPhone = `+2547${digits()}6`;
    const sender = await aPerson(senderPhone);
    const receiver = await aPerson(receiverPhone);
    const id = `DUKA-${digits()}`;
    await http().post('/v1/sbg/parcels/accept').set(shop.owner).send({ agentDid: shop.did, parcelId: id, size: 'S', destZone: 'FarTown', senderMobile: senderPhone, receiverMobile: receiverPhone, dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop.did) }).expect(201);
    // At the hub now (the road there is any parcel's).
    Object.assign(app.get(ParcelService).get(id), { status: 'At_MDP', atMdpId: hub.mdpId });

    // Said to staff first — and only to staff.
    const told = (await http().get(`/v1/sbg/parcels/${id}/withdraw`).set(operator).expect(200)).body;
    expect(told).toMatchObject({ parcelId: id, outcome: 'turn_round', backTo: shop.name, atHub: hub.name, amount: expect.any(Number) });
    await http().get(`/v1/sbg/parcels/${id}/withdraw`).set(shop.owner).expect(403);
    await http().post(`/v1/sbg/parcels/${id}/withdraw`).set(shop.owner).send({ reason: 'The sender asked, by phone' }).expect(403);
    // Never voided at a hub, by the old door either.
    expect((await http().post(`/v1/sbg/parcels/${id}/cancel`).set(operator).send({ reason: 'x' })).body.detail).toMatch(/not voided: withdrawn, it is turned round there/);
    // A reason staff wrote, kept on its history.
    await http().post(`/v1/sbg/parcels/${id}/withdraw`).set(operator).send({ reason: 'x' }).expect(400);
    const done = (await http().post(`/v1/sbg/parcels/${id}/withdraw`).set(operator).send({ reason: 'The sender asked, by phone', by: 'Achieng' }).expect(201)).body;
    expect(done).toMatchObject({ parcelId: id, status: 'Returned', outcome: 'turn_round', amount: told.amount, backTo: shop.name, atHub: hub.name, returnParcelId: expect.stringMatching(/^PUD-/) });
    const backId = done.returnParcelId as string;
    expect((await http().get(`/v1/sbg/parcels/${id}`).set(operator).expect(200)).body).toMatchObject({ status: 'Returned', returnParcelId: backId });
    // Its journey's promise starts at the hub.
    expect(app.get(ParcelService).get(backId).plan).toBeDefined();

    // Told in the app: the sender where to collect it and what they pay; the receiver that it will not come.
    expect(await inbox(sender)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'parcel_withdrawn', title: `Your parcel ${id} comes back to you`, body: expect.stringContaining(`comes back to ${shop.name}, where you handed it in, as ${backId}`) })]));
    expect(await inbox(receiver)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'parcel_withdrawn', title: `Parcel ${id} will not come` })]));

    // The sender's Send app: under Received, with its own code and what they pay there.
    const mine = (await http().get('/v1/sbg/identity/parcels').set(sender).expect(200)).body;
    expect((mine.received as Array<{ parcelId: string }>).map((p) => p.parcelId)).toContain(backId);
    const detail = (await http().get(`/v1/sbg/identity/parcels/${backId}`).set(sender).expect(200)).body;
    expect(detail).toMatchObject({ relation: 'received', returnOf: id, payAtCollection: { amount: told.amount, currency: expect.any(String) }, collectToken: { code: expect.stringMatching(/^\d{4}$/) } });
    const code = detail.collectToken.code as string;

    // On the shelf of the shop it came back to: the counter reads what to take, before it hands anything over.
    Object.assign(app.get(ParcelService).get(backId), { status: 'Ready_For_Pickup', atMdpId: undefined, readyAt: new Date().toISOString() });
    expect((await http().get(`/v1/sbg/parcels/${backId}`).set(shop.owner).expect(200)).body).toMatchObject({ payAtCollection: { amount: told.amount } });
    // A float that cannot cover it: refused before the code is tried.
    const gate = app.get(WalletGateService);
    gate.reverseTopUp(shop.did, gate.canTransact(shop.did).balance, 'drain');
    const short = await http().post(`/v1/sbg/parcels/${backId}/pickup`).set(shop.owner).send({ otp: code });
    expect([short.status, short.body.detail]).toEqual([402, expect.stringMatching(/^Top up first: .* is due on this parcel, taken in cash from the person collecting it$/)]);
    gate.topUp(shop.did, 20);
    const before = gate.canTransact(shop.did).balance;
    await http().post(`/v1/sbg/parcels/${backId}/pickup`).set(shop.owner).send({ otp: code }).expect(201);
    expect(gate.entries({ did: shop.did, type: 'FEE' }).filter((e) => e.reference === backId)).toEqual([expect.objectContaining({ sign: '-', amount: told.amount })]);
    expect(gate.canTransact(shop.did).balance).toBeLessThan(before);
    const after = (await http().get(`/v1/sbg/identity/parcels/${backId}`).set(sender).expect(200)).body;
    expect(after.status).toBe('Delivered');
    expect(after.payAtCollection).toBeUndefined();
  });
});
