import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';
import { declared } from './declared';
import { AGREED } from './agreed';
import { ParcelService } from '../src/modules/pudo/parcel.service';

/**
 * INBOUND SUPPLY, READING B, over the wire (assessment.html D1–D14; the user, 2026-10-25: "Yes, A then B"): A HUB AS A
 * CROSS-DOCK. A hub says it takes stores' parcels in bulk, and when. A store's parcel handed in there is priced from the
 * hub — no first road leg, no shop — and is booked onto an arrival: which parcels, on what, which day on the hub's clock.
 * At its door the hub counts the units, then scans each parcel off them: the hub answers for it from there (custody), and
 * it is sorted like any other. What was booked and did not come is still the store's, which is told and books it again.
 */
describe('reading B: a store hands its parcels in at a hub, in bulk', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();
  /** Today, and yesterday, on the hub's own clock (Kenya keeps one). */
  const kenyaDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

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

  async function aShop(shopName: string, zone: string, location: { lat: number; lng: number }): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-HUB-${u}`, mobile: `+2547${u}8`, deviceImei: `IMEI-HUB-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const shopPhoto = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await shopPhoto('kyc_id'), tradingLicenceRef: await shopPhoto('kyc_licence'), shopPhotoRefs: [await shopPhoto('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    return { did, token };
  }

  it('the hub says it takes bulk; a store’s parcels are priced from the hub, booked, counted at the door, scanned off and sorted — what did not come stays the store’s', async () => {
    const north = `HubNorth${tag}`;
    const south = `HubSouth${tag}`;
    const counter = await aShop(`Counter ${tag}`, north, { lat: -1.2, lng: 36.8 });
    const dest = await aShop(`Riverside ${tag}`, south, { lat: -1.32, lng: 36.92 });
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ ...AGREED, name: `Bulk Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const store = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(store).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Bulk Hub ${tag}`, zones: [north, south], location: { lat: -1.25, lng: 36.88 } }).expect(201)).body;
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    declared(app, 'hub', hub.did);

    // THE HUB'S WORD: it takes stores' parcels in bulk, every day 06:00–18:00, at two doors. Its own, never staff's.
    const everyDay = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '06:00', close: '18:00' }]));
    expect((await http().put(`/v1/sbg/mdps/${hub.mdpId}/bulk`).set(operator).send({ open: true, hours: everyDay, doors: 2 }).expect(403)).body.detail).toMatch(/A hub says itself whether it takes parcels in bulk/);
    // Before it says so, a store cannot hand in there.
    const mint = (body: Record<string, unknown>) => http().post('/v1/sbg/inbound/orders').set(store).send({ vendorId: made.vendorId, destPudoDid: dest.did, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, ...body });
    expect((await mint({ handInMdpId: hub.mdpId, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store) }).expect(400)).body.detail).toMatch(/does not take parcels in bulk/);
    const said = (await http().put(`/v1/sbg/mdps/${hub.mdpId}/bulk`).set(hubToken).send({ open: true, hours: everyDay, doors: 2 }).expect(200)).body;
    expect(said.bulk).toMatchObject({ mdpId: hub.mdpId, doors: 2, zone: 'Africa/Nairobi' });

    // PRICED FROM THE HUB: no shop's fee and no road before it — cheaper than the same parcel handed in at a shop.
    const options = (await http().get(`/v1/sbg/vendors/${made.vendorId}/hubs?dest=${dest.did}&size=M`).set(store).expect(200)).body.hubs;
    const here = options.find((o: { mdpId: string }) => o.mdpId === hub.mdpId);
    expect(here).toMatchObject({ name: `Bulk Hub ${tag}`, doors: 2 });
    expect(here.quote.hops.map((h: { type: string }) => h.type)).toEqual(['mdp', 'pudo']);
    const fromShop = (await http().get(`/v1/sbg/quote/options?dest=${dest.did}&origins=${counter.did}&size=M`).set(store).expect(200)).body.options[0].quote;
    expect(here.quote.locked.total).toBeLessThan(fromShop.locked.total);
    await http().get(`/v1/sbg/vendors/${made.vendorId}/hubs?dest=${dest.did}`).set(operator).expect(403);

    // THE MINT: one origin only; handed in at the hub, it waits with the store — never on a dock's list.
    expect((await mint({ handInMdpId: hub.mdpId, originPudoDid: counter.did, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store) }).expect(400)).body.detail).toMatch(/at a shop or at a hub, not both/);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const order = (await mint({ handInMdpId: hub.mdpId, externalOrderId: `WEB-${tag}-${i}`, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store) }).expect(201)).body;
      expect(order.parcel).toMatchObject({ handInMdpId: hub.mdpId, status: 'Created' });
      expect(order.parcel.originAgentDid).toBeUndefined();
      ids.push(order.parcel.parcelId);
    }
    const waiting = (await http().get(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals`).set(store).expect(200)).body.waiting;
    expect(waiting).toEqual([expect.objectContaining({ mdpId: hub.mdpId, parcels: expect.arrayContaining(ids.map((parcelId) => expect.objectContaining({ parcelId, destination: `Riverside ${tag}` }))) })]);

    // THE BOOKING: which parcels, on what, which day on the hub's clock. Not yesterday; not a parcel twice; not by staff.
    const today = kenyaDay(Date.now());
    const book = (body: Record<string, unknown>, who = store) => http().post(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals`).set(who).send({ mdpId: hub.mdpId, unitKind: 'pallet', units: 1, expectedOn: today, ...body });
    expect((await book({ parcelIds: ids, expectedOn: kenyaDay(Date.now() - 86_400_000) }).expect(400)).body.detail).toMatch(/Choose today or a day ahead/);
    await book({ parcelIds: ids }, operator).expect(403);
    const booked = (await book({ parcelIds: ids, reference: `DISPATCH-${tag}` }).expect(201)).body;
    expect(booked).toMatchObject({ state: 'expected', units: 1, unitKind: 'pallet', reference: `DISPATCH-${tag}`, scannedCount: 0 });
    expect((await book({ parcelIds: [ids[0]] }).expect(400)).body.detail).toMatch(/on another arrival already/);

    // AT THE HUB: due today on its clock. Counted at the door before anything is scanned.
    const listed = (await http().get(`/v1/sbg/mdps/${hub.mdpId}/arrivals`).set(hubToken).expect(200)).body;
    expect(listed.arrivals[0]).toMatchObject({ arrivalId: booked.arrivalId, storeName: `Bulk Store ${tag}`, today: true, late: false });
    const scan = (code: string) => http().post(`/v1/sbg/mdps/${hub.mdpId}/arrivals/${booked.arrivalId}/scan`).set(hubToken).send({ code });
    expect((await scan(ids[0]).expect(400)).body.detail).toMatch(/Count what came at the door first/);
    await http().post(`/v1/sbg/mdps/${hub.mdpId}/arrivals/${booked.arrivalId}/receive`).set(hubToken).send({ units: 1, note: 'Wrap intact' }).expect(201);

    // SCANNED OFF: by its tracking key or its id. The hub answers for it from here; twice changes nothing; a stranger is set aside.
    const parcels = app.get(ParcelService);
    const first = (await scan(parcels.get(ids[0]).trackingKey!).expect(201)).body;
    expect(first).toMatchObject({ parcelId: ids[0], destination: `Riverside ${tag}`, already: false });
    const taken = parcels.get(ids[0]);
    expect(taken).toMatchObject({ status: 'At_MDP', atMdpId: hub.mdpId });
    expect(taken.custody?.map((l) => l.holderKind)).toEqual(['sender', 'hub']);
    expect(taken.plan?.hops[0]).toMatchObject({ type: 'mdp', id: hub.mdpId });
    expect((await scan(ids[0]).expect(201)).body.already).toBe(true);
    expect((await scan('NOT-ON-IT').expect(404)).body.detail).toMatch(/is not on this arrival: set it aside/);
    await scan(ids[1]).expect(201);

    // FINISHED: the third was not on it — still the store's, told, and bookable again.
    const done = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/arrivals/${booked.arrivalId}/finish`).set(hubToken).expect(201)).body;
    expect(done).toMatchObject({ state: 'received', scannedCount: 2, finished: { missing: [ids[2]] } });
    expect(parcels.get(ids[2])).toMatchObject({ status: 'Created' });
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(store).expect(200)).body;
    expect(((bell.items ?? bell) as Array<{ kind: string; title: string }>).find((n) => n.kind === 'hub_arrival')?.title).toBe(`Bulk Hub ${tag} took in 2 parcels of 3`);
    const after = (await http().get(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals`).set(store).expect(200)).body;
    expect(after.waiting[0].parcels.map((p: { parcelId: string }) => p.parcelId)).toEqual([ids[2]]);

    // SORTED like any other parcel at the hub.
    await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(hubToken).send({ parcelId: ids[0] }).expect(201);

    // WITHDRAWN before the hub has it: nothing to take in at the door.
    const again = (await book({ parcelIds: [ids[2]] }).expect(201)).body;
    await http().post(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals/${again.arrivalId}/withdraw`).set(store).expect(201);
    expect((await http().post(`/v1/sbg/mdps/${hub.mdpId}/arrivals/${again.arrivalId}/receive`).set(hubToken).send({ units: 1 }).expect(400)).body.detail).toMatch(/The store withdrew it/);
  });
});
