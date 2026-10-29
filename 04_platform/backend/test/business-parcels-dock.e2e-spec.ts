import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';
import { AGREED } from './agreed';
import { FundingService } from '../src/foundation/funding/funding.service';
import { VendorService } from '../src/modules/pudo/vendor.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';

/**
 * A BUSINESS'S PARCELS COLLECTED FROM ITS OWN PLACE, over the wire (the user, 2026-10-29: "they can set their own (business
 * address) pick up"). One of its own saved places — never a port, never one no shop is near — becomes where drivers collect
 * its parcels, as a store's dock: priced from there, bagged there by destination, closed with its seal and its own
 * photograph, and a driver is sent to that pin. Stopped, nothing more is sent from there.
 */
describe('a business’s parcels collected from its own place', () => {
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
        fullName: `${shopName} owner`, nationalId: `ID-BPD-${u}`, mobile: `+2547${u}6`, deviceImei: `IMEI-BPD-${u}`,
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
    const email = `bpdock-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const created = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `BPD-${tag}-${seq}`, activities: ['shipper'], yourName: `${name} Owner` }).expect(201);
    return { token: bearer(created.body.token.access_token as string), entityId: created.body.business.entityId as string };
  }

  let nairobi = '';
  let kisumu = '';
  beforeAll(async () => {
    nairobi = await aShop(`Nairobi BPD ${tag}`, `BpdNairobi${tag}`, { lat: -1.286, lng: 36.817 });
    kisumu = await aShop(`Kisumu BPD ${tag}`, `BpdKisumu${tag}`, { lat: -0.0917, lng: 34.768 });
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `BpdNairobi → BpdKisumu ${tag}`, originZone: `BpdNairobi${tag}`, destZone: `BpdKisumu${tag}` }).expect(201);
  });

  it('collects from one of its own places: chosen from its list, priced from there, bagged there and closed for a driver — and stopped', async () => {
    const biz = await aBusiness('Ruiru Hardware');
    const vendors = app.get(VendorService);
    await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201);
    await http().post('/v1/sbg/business/me/parcels/top-up').set(biz.token).send({ amount: 3000 }).expect(201);
    const till = vendors.forBusiness(biz.entityId)!;
    await simulate(app.get(FundingService).openFor(till.vendorId)!.fundingId, 3000);
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${biz.entityId}/sites`).set(biz.token).send({ kind, name, location }).expect(201)).body.siteId as string;
    const warehouse = await site('loading', 'Ruiru warehouse', { lat: -1.2, lng: 36.85 });
    const port = await site('port', 'Kilindini', { lat: -4.04, lng: 39.66 });
    const far = await site('delivery', 'Marsabit depot', { lat: 2.33, lng: 37.99 });
    const collectFrom = (siteId: string) => http().post('/v1/sbg/business/me/parcels/collect-from').set(biz.token).send({ siteId, bays: 2 });

    // Not a port, not a place no shop is near, not another business's place.
    expect((await collectFrom(port).expect(400)).body.detail).toMatch(/is a port or a clearing place/);
    expect((await collectFrom(far).expect(400)).body.detail).toMatch(/^No shop of ours is within 30 km of Marsabit depot/);
    const rival = await aBusiness('Mlima Hardware');
    await http().post('/v1/sbg/business/me/parcels/account').set(rival.token).expect(201);
    await http().post('/v1/sbg/business/me/parcels/collect-from').set(rival.token).send({ siteId: warehouse }).expect(404);
    // Its own warehouse: the area of the shop nearest it.
    const set = (await collectFrom(warehouse).expect(201)).body;
    expect(set.collection).toMatchObject({ siteId: warehouse, label: 'Ruiru warehouse', zone: `BpdNairobi${tag}`, bays: 2 });
    // A driver is sent to the warehouse's own pin for its bags.
    expect(app.get(DispatchService).pickupPlace(till.did)).toEqual({ loc: { lat: -1.2, lng: 36.85 }, label: 'Ruiru warehouse' });

    // Priced from there, and sent from there; never from a shop and its place at once.
    const priced = (await http().get('/v1/sbg/business/me/parcels/price').query({ origin: 'own', dest: kisumu, l: 30, w: 20, h: 10, kg: 2 }).set(biz.token).expect(200)).body;
    expect(priced).toMatchObject({ currency: 'KES', crossesBorder: false });
    expect(priced.flexible).toBeGreaterThan(0);
    const photo = async (token: { authorization: string }) => (await http().post('/v1/sbg/media').set(token).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    const parcel = async (more: Record<string, unknown>) => ({ destPudoDid: kisumu, receiverMobile: '+254733000444', dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 2, contentPhotoRef: await photo(biz.token), ...more });
    expect((await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(await parcel({ fromOwnPlace: true, originPudoDid: nairobi })).expect(400)).body.detail).toMatch(/not both/);
    const sent = (await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(await parcel({ fromOwnPlace: true, expectedTotal: priced.flexible })).expect(201)).body;
    expect(sent).toMatchObject({ paid: true, parcel: { fromOwnPlace: true, from: { name: 'Ruiru warehouse' }, cost: priced.flexible } });
    const id = sent.parcel.parcelId as string;
    // A parcel handed in at a shop is that shop's to expect: it is never one to bag at the warehouse.
    const atShop = (await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(await parcel({ originPudoDid: nairobi })).expect(201)).body.parcel.parcelId as string;

    // Bagged at its place: waiting by destination, a bag opened, the parcel in it, closed with its own photograph.
    const dock = () => http().get('/v1/sbg/business/me/parcels/dock').set(biz.token).expect(200).then((r) => r.body);
    expect((await dock()).groups).toEqual([expect.objectContaining({ zone: `BpdKisumu${tag}`, parcels: [expect.objectContaining({ parcelId: id })] })]);
    const opened = (await http().post('/v1/sbg/business/me/parcels/dock/bags').set(biz.token).send({ destZone: `BpdKisumu${tag}` }).expect(201)).body;
    const code = opened.bags[0].code as string;
    expect(opened.groups[0].openBagCode).toBe(code);
    // Another business's parcel, or one going to a shop, is not this place's to bag.
    await http().post(`/v1/sbg/business/me/parcels/dock/bags/${code}/parcels`).set(rival.token).send({ parcelId: id }).expect(400);
    await http().post(`/v1/sbg/business/me/parcels/dock/bags/${code}/parcels`).set(biz.token).send({ parcelId: atShop }).expect(403);
    const filled = (await http().post(`/v1/sbg/business/me/parcels/dock/bags/${code}/parcels`).set(biz.token).send({ parcelId: id }).expect(201)).body;
    expect(filled.bags[0].parcelIds).toEqual([id]);
    expect((await http().post(`/v1/sbg/business/me/parcels/dock/bags/${code}/seal`).set(biz.token).send({ closure: { seal: 'SEAL-001', photoRef: await photo(rival.token) } }).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    const closed = (await http().post(`/v1/sbg/business/me/parcels/dock/bags/${code}/seal`).set(biz.token).send({ closure: { seal: 'SEAL-001', photoRef: await photo(biz.token) } }).expect(201)).body;
    expect(closed.bags[0]).toMatchObject({ code, status: 'available', parcelIds: [id] });
    expect(closed.groups).toEqual([]);

    // At a hub, one collected from its own place comes back there as a driver's load, at most what the business allows.
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Ruiru Hub ${tag}`, zones: [`BpdNairobi${tag}`], location: { lat: -1.25, lng: 36.88 } }).expect(201)).body;
    const second = (await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(await parcel({ fromOwnPlace: true })).expect(201)).body.parcel.parcelId as string;
    Object.assign(app.get(ParcelService).get(second), { status: 'At_MDP', atMdpId: hub.mdpId });
    expect((await http().get(`/v1/sbg/business/me/parcels/${second}/call-off`).set(biz.token).expect(200)).body).toMatchObject({ outcome: 'pick', door: 'Ruiru warehouse' });
    const door = (await http().get(`/v1/sbg/business/me/parcels/${second}/call-off`).query({ backTo: 'door' }).set(biz.token).expect(200)).body;
    expect(door).toMatchObject({ outcome: 'to_door', backTo: 'Ruiru warehouse' });
    expect(door.suggestedMax).toBeGreaterThan(0);
    const back = (await http().post(`/v1/sbg/business/me/parcels/${second}/call-off`).set(biz.token).send({ backTo: 'door', maxSpend: door.suggestedMax }).expect(201)).body;
    expect(back).toMatchObject({ outcome: 'to_door', done: true, loadCode: expect.any(String), amount: door.suggestedMax });

    // Stopped: nothing more is sent from there.
    expect((await http().delete('/v1/sbg/business/me/parcels/collect-from').set(biz.token).expect(200)).body.collection).toBeUndefined();
    expect((await http().post('/v1/sbg/business/me/parcels').set(biz.token).send(await parcel({ fromOwnPlace: true })).expect(400)).body.detail).toMatch(/^Choose the place of yours drivers collect from first/);
    await http().get('/v1/sbg/business/me/parcels/dock').set(biz.token).expect(400);
  });
});
