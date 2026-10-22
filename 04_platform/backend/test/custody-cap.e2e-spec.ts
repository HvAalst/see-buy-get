import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { EntityService } from '../src/foundation/entity/entity.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';
import { DriverService } from '../src/modules/pudo/driver.service';

/**
 * THE CUSTODY CAP FOR THE NEW AND THE INFORMAL (the user, round 38: "Count cap that grows") — through the booted
 * application. Each country's company sets what a new shop holds and a new independent rider carries at once, and after
 * how many hand-overs it lifts; the limit grows by one with each parcel handed on. A shop at its limit takes nothing more
 * in, a rider at theirs takes nothing more on, and both are told the limit and how it grows. A fleet's driver is not capped.
 */
describe('the custody cap for the new and the informal, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
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

  /** A working shop — registered, its papers sent, approved, its float paid in — and its owner's sign-in. */
  async function aShop(): Promise<{ did: string; owner: Record<string, string> }> {
    const u = digits();
    const day = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({ shopName: `Duka Jipya ${u}`, zone: `ZC${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null }, fullName: `Duka ${u} owner`, nationalId: `ID-CAP-${u}`, mobile: `+2547${u}2`, deviceImei: `IMEI-CAP-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const owner = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(owner).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(owner).send({ idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(owner).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, owner };
  }
  const take = async (shop: string, as: Record<string, string>) =>
    http().post('/v1/sbg/parcels/accept').set(as).send({ agentDid: shop, parcelId: `CAP-${digits()}`, size: 'S', destZone: 'FarTown', senderMobile: '+254700', receiverMobile: '+254711', dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop) });

  it('each country’s company sets it; a new shop at its limit takes nothing more in, and grows with each parcel handed on', async () => {
    const kenya = app.get(EntityService).forJurisdiction('KE')!;
    const caps = `/v1/sbg/entities/${kenya.entityId}/custody-caps`;
    expect((await http().get(caps).set(operator).expect(200)).body).toEqual({ entityId: kenya.entityId });
    const shop = await aShop();
    // Not the shop's to set; whole numbers, a start of at least one, lifted no sooner than it starts.
    await http().post(caps).set(shop.owner).send({ shop: { start: 2, liftedAfter: 5 } }).expect(403);
    await http().post(caps).set(operator).send({ shop: { start: 0, liftedAfter: 5 } }).expect(400);
    expect((await http().post(caps).set(operator).send({ shop: { start: 5, liftedAfter: 2 } }).expect(400)).body.detail).toMatch(/no fewer than it starts/);
    expect((await http().post(caps).set(operator).send({ shop: { start: 2, liftedAfter: 5 } }).expect(201)).body).toEqual({ entityId: kenya.entityId, shop: { start: 2, liftedAfter: 5 } });
    expect(app.get(EntityService).changes(kenya.entityId, 1)[0]).toMatchObject({ what: 'custodyCaps', from: 'no cap', to: 'new shops: 2, lifted after 5' });
    expect((await http().get(`/v1/sbg/entities/${kenya.entityId}/pricing`).set(operator).expect(200)).body.custodyCaps).toEqual({ shop: { start: 2, liftedAfter: 5 } });

    // The shop reads where it stands; two in, the third refused in words, and nothing written for it.
    expect((await http().get('/v1/sbg/custody-cap').set(shop.owner).expect(200)).body).toEqual({ capped: true, kind: 'shop', holds: 0, cap: 2, completed: 0, liftedAfter: 5 });
    const first = (await take(shop.did, shop.owner)).body.parcelId as string;
    await take(shop.did, shop.owner).then((r) => expect(r.status).toBe(201));
    const third = await take(shop.did, shop.owner);
    expect([third.status, third.body.code]).toEqual([409, 'CUSTODY_CAP_REACHED']);
    expect(third.body.detail).toMatch(/holds 2 parcels?; a new shop holds at most 2 here for now\. It grows by one with each parcel handed on \(0 so far\) and lifts after 5/);
    // One handed on: one fewer held, the limit one higher — two more may come in.
    Object.assign(app.get(ParcelService).get(first), { status: 'On_Bus' });
    expect((await http().get('/v1/sbg/custody-cap').set(shop.owner).expect(200)).body).toMatchObject({ holds: 1, cap: 3, completed: 1 });
    await take(shop.did, shop.owner).then((r) => expect(r.status).toBe(201));
    await take(shop.did, shop.owner).then((r) => expect(r.status).toBe(201));
    expect((await take(shop.did, shop.owner)).status).toBe(409);

    // A company that caps nobody: everybody takes in freely, and is told nothing about a cap.
    await http().post(caps).set(operator).send({}).expect(201);
    expect((await http().get('/v1/sbg/custody-cap').set(shop.owner).expect(200)).body).toEqual({ capped: false });
    await take(shop.did, shop.owner).then((r) => expect(r.status).toBe(201));
  });

  it('a new independent rider carrying their limit takes no load over — a fleet’s driver is never capped', async () => {
    const kenya = app.get(EntityService).forJurisdiction('KE')!;
    await http().post(`/v1/sbg/entities/${kenya.entityId}/custody-caps`).set(operator).send({ rider: { start: 1, liftedAfter: 3 } }).expect(201);
    const n = digits();
    const rider = (await http().post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: 'Juma', fullName: 'Juma Rider', nationalId: `DRV-CAP-${n}`, mobile: `+2547${n}4`, licenceClasses: ['truck'], licenceNumber: `DL-CAP-${n}`, licenceExpiresAt: '2030-01-01' }).expect(201)).body;
    const riderToken = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: rider.did, type: 'client_credentials' }).expect(201)).body.access_token);
    expect((await http().get('/v1/sbg/custody-cap').set(riderToken).expect(200)).body).toEqual({ capped: true, kind: 'rider', holds: 0, cap: 1, completed: 0, liftedAfter: 3 });

    const dispatch = app.get(DispatchService);
    const load = () => dispatch.registerFreight({ description: 'Sacks', pickupLocation: { lat: -1.3, lng: 36.8 }, pickupLabel: 'Yard', destLabel: 'Store', destLocation: { lat: -1.4, lng: 36.9 }, weightKg: 200, pickupCountry: 'KE', destCountry: 'KE' });
    const takeOver = (id: string, did: string) => {
      try {
        dispatch.pickupFreight(id, did, {});
        return 'taken';
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    const carrying = load();
    const next = load();
    Object.assign(dispatch.requireFreightPublic(carrying.freightId), { status: 'in_transit', claimedBy: rider.did, pickedUpAt: new Date().toISOString() });
    Object.assign(dispatch.requireFreightPublic(next.freightId), { status: 'claimed', claimedBy: rider.did });
    expect((await http().get('/v1/sbg/custody-cap').set(riderToken).expect(200)).body).toMatchObject({ holds: 1, cap: 1 });
    expect(takeOver(next.freightId, rider.did)).toBe('CUSTODY_CAP_REACHED');
    // Delivered: off them, and the limit one higher. The next thing asked is the safety check.
    Object.assign(dispatch.requireFreightPublic(carrying.freightId), { status: 'delivered', deliveredAt: new Date().toISOString() });
    expect((await http().get('/v1/sbg/custody-cap').set(riderToken).expect(200)).body).toMatchObject({ holds: 0, cap: 2, completed: 1 });
    expect(takeOver(next.freightId, rider.did)).toBe('SAFETY_CHECK_INCOMPLETE');

    // A fleet's driver: the fleet answers for them — no cap, whatever the company says.
    const managed = app.get(ParcelService);
    const fleetDriver = (await http().post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: 'Wekesa', fullName: 'Wekesa Fleet', nationalId: `DRV-CAPF-${n}`, mobile: `+2547${n}5`, licenceClasses: ['truck'], licenceNumber: `DL-CAPF-${n}`, licenceExpiresAt: '2030-01-01' }).expect(201)).body;
    Object.assign(app.get(DriverService).get(fleetDriver.did), { managerDid: 'did:glos:some-fleet' });
    expect(managed.riderStanding(fleetDriver.did)).toBeUndefined();
    await http().post(`/v1/sbg/entities/${kenya.entityId}/custody-caps`).set(operator).send({}).expect(201);
  });
});
