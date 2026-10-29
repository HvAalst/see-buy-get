import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';
import { AGREED } from './agreed';
import { FundingService } from '../src/foundation/funding/funding.service';
import { VendorService } from '../src/modules/pudo/vendor.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';

/**
 * A BUSINESS'S PARCELS, over the wire (the user, 2026-10-29: "Billed to the business"; "A prepaid balance"). A business
 * opens a parcel account — a till with our company in its country, as a store has — tops it up, and sends parcels shop to
 * shop, each paid from the balance when it is sent: no balance, no label. Its people send; a viewer reads; another business
 * sees none of it; calling one off before it is handed in gives the money back. Staff see the account for what it is.
 */
describe('a business’s parcels, paid from its own balance', () => {
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

  const fund = async (path: string, token: { authorization: string }, amount: number) => {
    const asked = await http().post(path).set(token).send({ amount }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount }).expect(201);
  };

  async function aShop(shopName: string, zone: string, location: { lat: number; lng: number }): Promise<string> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-BPA-${u}`, mobile: `+2547${u}7`, deviceImei: `IMEI-BPA-${u}`,
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

  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `bparcel-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token };
  }

  async function aBusiness(name: string): Promise<{ token: { authorization: string }; entityId: string; viewer: () => Promise<{ authorization: string }> }> {
    const owner = await aPerson();
    const created = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `BPA-${tag}-${seq}`, activities: ['shipper'], yourName: `${name} Owner` }).expect(201);
    const token = bearer(created.body.token.access_token as string);
    const entityId = created.body.business.entityId as string;
    const viewer = async () => {
      const who = await aPerson();
      await http().post('/v1/sbg/business/me/members').set(token).send({ phone: who.phone, name: `${name} viewer`, role: 'viewer' }).expect(201);
      const invite = (await http().get('/v1/sbg/business/mine').set(bearer(who.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === entityId);
      await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(who.token)).expect(201);
      return bearer((await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(201)).body.token.access_token as string);
    };
    return { token, entityId, viewer };
  }

  const photo = async (token: { authorization: string }) => (await http().post('/v1/sbg/media').set(token).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;

  let nairobi = '';
  let kisumu = '';
  beforeAll(async () => {
    nairobi = await aShop(`Nairobi BPA ${tag}`, `BpaNairobi${tag}`, { lat: -1.286, lng: 36.817 });
    kisumu = await aShop(`Kisumu BPA ${tag}`, `BpaKisumu${tag}`, { lat: -0.0917, lng: 34.768 });
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `BpaNairobi → BpaKisumu ${tag}`, originZone: `BpaNairobi${tag}`, destZone: `BpaKisumu${tag}` }).expect(201);
  });

  it('opens a parcel account, tops it up, and sends shop to shop paid from the balance — no balance, no label', async () => {
    const biz = await aBusiness('Zawadi Spares');
    const account = () => http().get('/v1/sbg/business/me/parcels/account').set(biz.token).expect(200).then((r) => r.body);
    const parcel = (contentPhotoRef: string, more: Record<string, unknown> = {}) => ({ originPudoDid: nairobi, destPudoDid: kisumu, receiverMobile: '0712 345 678', dimensionsCm: { l: 30, w: 20, h: 15 }, weightKg: 2, contentPhotoRef, reference: 'INV-2041', ...more });

    // Nothing yet: it can be opened, and nothing is sent before it is.
    expect(await account()).toMatchObject({ open: false, canOpen: true, sent: 0 });
    const early = await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(parcel(await photo(biz.token))).expect(400);
    expect(early.body.detail).toMatch(/^Open your parcel account first/);
    const opened = (await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201)).body;
    expect(opened).toMatchObject({ open: true, balance: 0, company: { name: 'SeeBuyGet Kenya', currency: 'KES' } });
    // Opened twice, it is the one account.
    await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201);
    const vendors = app.get(VendorService);
    const till = vendors.forBusiness(biz.entityId)!;
    expect(vendors.list().filter((v) => v.business?.entityId === biz.entityId)).toHaveLength(1);

    // Sent with nothing in the balance: made, and unpaid — no label, no code to pass on.
    const first = (await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(parcel(await photo(biz.token))).expect(201)).body;
    expect(first).toMatchObject({ paid: false, parcel: { status: 'Created', paid: false, receiver: '+254712345678', reference: 'INV-2041', from: { did: nairobi }, to: { did: kisumu }, sentBy: 'Zawadi Spares Owner', currency: 'KES' } });
    expect(first.parcel.collectionCode).toBeUndefined();
    const id1 = first.parcel.parcelId as string;
    expect((await http().get(`/v1/sbg/business/me/parcels/${id1}/label`).set(biz.token).expect(400)).body.detail).toMatch(/^A label is issued once the order is paid/);
    expect((await http().post(`/v1/sbg/business/me/parcels/${id1}/pay`).set(biz.token).expect(402)).body.code).toBe('WALLET_INSUFFICIENT');

    // Topped up: asked, then confirmed by the rail — never credited on anybody's word.
    const asked = (await http().post('/v1/sbg/business/me/parcels/top-up').set(biz.token).send({ amount: 3000, phone: '0712345678' }).expect(201)).body;
    expect(asked.waiting).toMatchObject({ amount: 3000, currency: 'KES', reference: expect.any(String) });
    expect(asked.balance).toBe(0);
    const open = app.get(FundingService).openFor(till.vendorId)!;
    await http().post(`/v1/rails/funding/${open.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 3000 }).expect(201);
    const funded = await account();
    expect(funded).toMatchObject({ balance: 3000, sent: 1, unpaid: 1 });
    expect(funded.waiting).toBeUndefined();

    // Paid now: the cost leaves the balance, the label prints, the code is there to pass on.
    const paid = (await http().post(`/v1/sbg/business/me/parcels/${id1}/pay`).set(biz.token).expect(201)).body;
    expect(paid.paid).toBe(true);
    expect(paid.parcel.collectionCode).toMatch(/^COL-/);
    expect(paid.balance).toBeCloseTo(3000 - paid.parcel.cost, 2);
    expect((await http().get(`/v1/sbg/business/me/parcels/${id1}/label`).set(biz.token).expect(200)).body).toMatchObject({ parcelId: id1, svg: expect.stringContaining('<svg') });

    // The price it was shown is the price it pays: moved, it is said, never billed silently.
    const quoted = (await http().get('/v1/sbg/quote').query({ origin: nairobi, dest: kisumu, l: 30, w: 20, h: 15, kg: 2 }).expect(200)).body;
    const moved = await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(parcel(await photo(biz.token), { expectedTotal: 1 })).expect(409);
    expect(moved.body.code).toBe('PRICE_CHANGED');
    const second = (await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(parcel(await photo(biz.token), { expectedTotal: quoted.flexible.gross })).expect(201)).body;
    expect(second).toMatchObject({ paid: true, parcel: { paid: true, cost: quoted.flexible.gross } });
    // Its own parcel: no buyer at a checkout shares the cost, so none is reported.
    expect(app.get(ParcelService).get(second.parcel.parcelId).buyerCharge).toBeUndefined();

    // Its list, and its book: two parcels, a top-up and two payments.
    const list = (await http().get('/v1/sbg/business/me/parcels').set(biz.token).expect(200)).body;
    expect(list.total).toBe(2);
    expect(list.items.map((r: { parcelId: string }) => r.parcelId).sort()).toEqual([id1, second.parcel.parcelId].sort());
    const book = (await http().get('/v1/sbg/business/me/parcels/book').set(biz.token).expect(200)).body;
    expect(book.items.map((l: { type: string }) => l.type).sort()).toEqual(['BILLING', 'BILLING', 'TOP_UP']);
    expect(book.balance).toBeCloseTo(3000 - paid.parcel.cost - second.parcel.cost, 2);

    // Called off before it is handed in: withdrawn, its money back in full.
    expect((await http().get(`/v1/sbg/business/me/parcels/${second.parcel.parcelId}/call-off`).set(biz.token).expect(200)).body).toMatchObject({ outcome: 'refund', amount: second.parcel.cost });
    const off = (await http().post(`/v1/sbg/business/me/parcels/${second.parcel.parcelId}/call-off`).set(biz.token).send({ reason: 'the order was cancelled' }).expect(201)).body;
    expect(off).toMatchObject({ outcome: 'refund', amount: second.parcel.cost, done: true });
    expect((await account()).balance).toBeCloseTo(3000 - paid.parcel.cost, 2);
    expect((await http().get(`/v1/sbg/business/me/parcels/${second.parcel.parcelId}`).set(biz.token).expect(200)).body).toMatchObject({ status: 'Voided' });
    expect((await http().get(`/v1/sbg/business/me/parcels/${second.parcel.parcelId}`).set(biz.token).expect(200)).body.collectionCode).toBeUndefined();

    // Staff see it for what it is: a business's parcels, not a store that signs in.
    const rows = (await http().get('/v1/sbg/vendors').set(operator).expect(200)).body as Array<{ vendorId: string; forBusiness?: boolean }>;
    expect(rows.find((r) => r.vendorId === till.vendorId)).toMatchObject({ forBusiness: true });
    // Nobody signs in to it as a store.
    await http().post('/v1/sbg/vendors/login').send({ vendorId: till.vendorId, secret: till.secret }).expect(401);
  });

  it('refuses before anything is written: another’s photo, no receiver, too big for a parcel — and a viewer or another business changes nothing', async () => {
    const biz = await aBusiness('Pwani Pharma Supplies');
    const other = await aBusiness('Mlima Traders');
    await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201);
    await http().post('/v1/sbg/business/me/parcels/account').set(other.token).expect(201);
    const base = (contentPhotoRef: string, more: Record<string, unknown> = {}) => ({ originPudoDid: nairobi, destPudoDid: kisumu, receiverMobile: '+254711000222', dimensionsCm: { l: 20, w: 20, h: 10 }, weightKg: 1, contentPhotoRef, ...more });
    const send = (token: { authorization: string }, body: Record<string, unknown>) => http().post('/v1/sbg/business/me/parcels').set(token).send(body);

    // A photograph another business took is not this parcel's.
    expect((await send(biz.token, base(await photo(other.token))).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    // Nobody to hand it to.
    expect((await send(biz.token, base(await photo(biz.token), { receiverMobile: '12' })).expect(400)).body).toMatchObject({ code: 'FIELD_REQUIRED', detail: expect.stringMatching(/^Give the number of the person who collects it/) });
    // Handed in and collected at one shop.
    expect((await send(biz.token, base(await photo(biz.token), { destPudoDid: nairobi })).expect(400)).body.detail).toMatch(/same shop/);
    // A pallet goes as a load.
    expect((await send(biz.token, base(await photo(biz.token), { dimensionsCm: { l: 120, w: 100, h: 150 }, weightKg: 600 })).expect(400)).body).toMatchObject({ code: 'CARGO_REQUIRES_DEDICATED', detail: expect.stringMatching(/post it as a load, under Domestic$/) });
    expect((await http().get('/v1/sbg/business/me/parcels/account').set(biz.token).expect(200)).body.sent).toBe(0);

    // One sent; a viewer reads it and changes nothing; another business does not see it.
    const made = (await send(biz.token, base(await photo(biz.token))).expect(201)).body.parcel;
    const viewer = await biz.viewer();
    expect((await http().get('/v1/sbg/business/me/parcels').set(viewer).expect(200)).body.total).toBe(1);
    await send(viewer, base(await photo(viewer))).expect(403);
    await http().post('/v1/sbg/business/me/parcels/top-up').set(viewer).send({ amount: 100 }).expect(403);
    await http().post(`/v1/sbg/business/me/parcels/${made.parcelId}/call-off`).set(viewer).send({}).expect(403);
    expect((await http().get(`/v1/sbg/business/me/parcels/${made.parcelId}`).set(other.token).expect(404)).body.detail).toMatch(/^No parcel .* was sent by this business$/);
    await http().post(`/v1/sbg/business/me/parcels/${made.parcelId}/call-off`).set(other.token).send({}).expect(404);
    expect((await http().get('/v1/sbg/business/me/parcels').set(other.token).expect(200)).body.total).toBe(0);
    // Staff send nothing in a business's name.
    await http().post('/v1/sbg/business/me/parcels').set(operator).send(base(await photo(biz.token))).expect(403);
  });
});
