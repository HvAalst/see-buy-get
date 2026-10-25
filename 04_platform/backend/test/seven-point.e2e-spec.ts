import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { AGREED } from './agreed';

/**
 * ROUND 40 — THE 7-POINT INSPECTION, OVER THE WIRE (the user: "Cross-border closed loads"). A container or a closed body
 * leaving for a border is looked over at seven points before it is loaded — each point with its own photograph — and the
 * load is not taken over until all seven are done; the driver's claim says so beforehand. A load that stays in its country,
 * or an open body, is taken over as before. Something found is reported under the tamper protocol: the load is held.
 */
describe('the 7-point inspection — over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  let seq = 0;
  let biz = '';
  let driver = { did: '', token: '' };
  let store: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}5`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `seven-${tag}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Border Goods ${tag}`, country: 'KE', registrationNo: `SEV-${tag}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: 'Kamau', fullName: 'Kamau Truck', nationalId: `DRV-7P-${tag}`, mobile: `+2547${String(Date.now()).slice(-6)}7`, licenceClasses: ['truck'], licenceNumber: `DL-7P-${tag}`, licenceExpiresAt: '2030-01-01', criminalRecordClear: true }).expect(201);
    // Vetted, as a driver is before a shift can start.
    await http().post(`/v1/sbg/fleet/drivers/${onboarded.body.did}/submit-kyc`).set(bearer(setupKey)).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${onboarded.body.did}/kyc-decision`).set(bearer(setupKey)).send({ approve: true, by: 'Test' }).expect(201);
    driver = { did: onboarded.body.did as string, token: (await http().post('/v1/auth/token').send({ role: 'driver', did: onboarded.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string };
    store = (app.get(DispatchService) as unknown as { freights: typeof store }).freights;
  });

  afterAll(async () => {
    await app?.close();
  });

  const photo = async (kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(bearer(driver.token)).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };
  const POINTS = ['front_wall', 'left_side', 'right_side', 'floor', 'roof', 'doors', 'undercarriage'];

  /** A load from Nairobi, claimed by the driver, carried in the body given. */
  const aLoad = async (destCountry: string, carriedBy: { vehicleClass: string; truckSubtype?: string }, containerNo?: string) => {
    const { freightId } = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(biz))
        .send({ description: 'Tea chests', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Nairobi warehouse', destLabel: 'Kampala depot', destLocation: { lat: 0.31, lng: 32.58 }, weightKg: 800, packaging: 'palletised', packages: 4, pickupCountry: 'KE', destCountry })
        .expect(201)
    ).body;
    if (destCountry !== 'KE') await http().post(`/v1/sbg/dispatch/freight/${freightId}/commercial-invoice/own-paper`).set(bearer(biz)).send({ travels: true }).expect(201);
    store.set(freightId, { ...store.get(freightId), status: 'claimed', claimedBy: driver.did, claimedAt: new Date(Date.now() - 3_600_000).toISOString(), carriedBy, ...(containerNo ? { containerNo } : {}) });
    const claim = (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(bearer(driver.token)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);
    return { freightId: freightId as string, claim };
  };
  const pickup = (freightId: string, body: Record<string, unknown>) => http().post(`/v1/sbg/dispatch/freight/${freightId}/pickup`).set(bearer(driver.token)).send(body);
  const gate = async (claim: { loadChecklist: Array<{ key: string }> }) => ({ confirmed: claim.loadChecklist.map((x) => x.key), securementPhotoId: await photo('securement') });
  // One after another: requests sent at once through the test client are reset on Linux (CI), though not on Windows.
  const seven = async () => {
    const done: Array<{ point: string; photoRef: string }> = [];
    for (const point of POINTS) done.push({ point, photoRef: await photo('inspection') });
    return done;
  };

  it('a closed body leaving for a border is not taken over until its seven points are done, each photographed', async () => {
    const l = await aLoad('UG', { vehicleClass: 'truck', truckSubtype: 'box' });
    // The driver is told before they try.
    expect(l.claim.inspection).toEqual({ kind: 'closed', points: POINTS });

    const none = await pickup(l.freightId, await gate(l.claim)).expect(400);
    expect(none.body).toMatchObject({ code: 'INSPECTION_INCOMPLETE', params: { missing: POINTS } });
    const six = (await seven()).filter((p) => p.point !== 'doors');
    expect((await pickup(l.freightId, { ...(await gate(l.claim)), inspection: six }).expect(400)).body.detail).toMatch(/Not done yet: the doors, inside and out\.$/);
    // One photograph for every point is not seven looks.
    const one = await photo('inspection');
    await pickup(l.freightId, { ...(await gate(l.claim)), inspection: POINTS.map((point) => ({ point, photoRef: one })) }).expect(400);
    // Nor is one picture uploaded twice: two ids, the same photograph.
    const twice = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`same:${tag}`)]).toString('base64')}`;
    const again: string[] = [];
    for (let i = 0; i < 2; i++) again.push((await http().post('/v1/sbg/media').set(bearer(driver.token)).send({ kind: 'inspection', dataUrl: twice }).expect(201)).body.mediaId as string);
    expect(again[0]).not.toBe(again[1]);
    const copied = (await seven()).map((p) => (p.point === 'roof' ? { ...p, photoRef: again[0] } : p.point === 'floor' ? { ...p, photoRef: again[1] } : p));
    expect((await pickup(l.freightId, { ...(await gate(l.claim)), inspection: copied }).expect(400)).body.detail).toMatch(/the same picture was sent twice/);
    // Somebody else's photographs are not this driver's look.
    const other = (await http().post('/v1/sbg/media').set(bearer(biz)).send({ kind: 'inspection', dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`biz:${tag}`)]).toString('base64')}` }).expect(201)).body.mediaId;
    const borrowed = (await seven()).map((p) => (p.point === 'floor' ? { ...p, photoRef: other } : p));
    expect((await pickup(l.freightId, { ...(await gate(l.claim)), inspection: borrowed }).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    expect(store.get(l.freightId).status).toBe('claimed');

    const done = await seven();
    const taken = (await pickup(l.freightId, { ...(await gate(l.claim)), inspection: done }).expect(201)).body;
    expect(taken).toMatchObject({ status: 'in_transit', inspection: { kind: 'closed', points: done, by: driver.did } });
    // The photographs are kept with the load, and the pickup's fingerprint covers them: the trail is whole.
    const operator = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
    const trail = (await http().get(`/v1/sbg/ops/trail/${taken.code}`).set(operator).expect(200)).body as { steps: Array<{ kind: string; state: string }>; chain: { whole: boolean } };
    expect(trail.steps.find((s) => s.kind === 'picked_up')).toMatchObject({ state: 'intact' });
    const kept = store.get(l.freightId) as { inspection: { points: Array<{ photoRef: string }> } };
    kept.inspection.points[2].photoRef = 'med_swapped';
    expect(((await http().get(`/v1/sbg/ops/trail/${taken.code}`).set(operator).expect(200)).body as typeof trail).steps.find((s) => s.kind === 'picked_up')?.state).not.toBe('intact');
  });

  it('a container leg leaving for a border: the container, whatever carries it', async () => {
    const l = await aLoad('UG', { vehicleClass: 'truck', truckSubtype: 'flatbed' }, 'MSKU1234565');
    expect(l.claim.inspection).toEqual({ kind: 'container', points: POINTS });
    expect((await pickup(l.freightId, await gate(l.claim)).expect(400)).body.detail).toMatch(/^The container is looked over at seven points/);
    await pickup(l.freightId, { ...(await gate(l.claim)), inspection: await seven() }).expect(201);
  });

  it('a load that stays in Kenya, and an open body abroad, are taken over as before', async () => {
    const home = await aLoad('KE', { vehicleClass: 'truck', truckSubtype: 'box' });
    expect(home.claim.inspection).toBeUndefined();
    expect((await pickup(home.freightId, await gate(home.claim)).expect(201)).body.inspection).toBeUndefined();
    const open = await aLoad('UG', { vehicleClass: 'truck', truckSubtype: 'flatbed' });
    expect(open.claim.inspection).toBeUndefined();
    await pickup(open.freightId, await gate(open.claim)).expect(201);
  });

  it('what is loaded is what the driver is on shift with: a box van on the claim, an open truck at the gate', async () => {
    const l = await aLoad('UG', { vehicleClass: 'truck', truckSubtype: 'box' });
    expect(l.claim.inspection).toEqual({ kind: 'closed', points: POINTS });
    const flatbed = (await http().post('/v1/sbg/vehicles').set(bearer(setupKey)).send({ plate: `7P-${tag}`, vehicleClass: 'truck', truckSubtype: 'flatbed', ownerName: 'Kamau' }).expect(201)).body;
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/start-session`).set(bearer(setupKey)).send({ vehicleId: flatbed.vehicleId }).expect(201);
    try {
      await pickup(l.freightId, await gate(l.claim)).expect(201);
    } finally {
      await http().post(`/v1/sbg/fleet/drivers/${driver.did}/end-session`).set(bearer(setupKey)).send({});
    }
  });

  it('something found at the inspection holds the load and tells operations — at pickup, and only there', async () => {
    const l = await aLoad('UG', { vehicleClass: 'truck', truckSubtype: 'semi_trailer' });
    const report = (await http()
      .post(`/v1/sbg/dispatch/freight/${l.freightId}/tamper`)
      .set(bearer(driver.token))
      .send({ finding: 'inspection_failed', photoRefs: [await photo('tamper')], note: 'The front wall is a hand short of the outside' })
      .expect(201)).body;
    expect(report.held).toMatchObject({ finding: 'inspection_failed', stage: 'pickup' });
    expect((await pickup(l.freightId, { ...(await gate(l.claim)), inspection: await seven() }).expect(409)).body.code).toBe('UNIT_HELD');

    // On the road it is not the inspection any more.
    const road = await aLoad('UG', { vehicleClass: 'truck', truckSubtype: 'box' });
    await pickup(road.freightId, { ...(await gate(road.claim)), inspection: await seven() }).expect(201);
    expect((await http().post(`/v1/sbg/dispatch/freight/${road.freightId}/tamper`).set(bearer(driver.token)).send({ finding: 'inspection_failed', photoRefs: [await photo('tamper')] }).expect(400)).body.code).toBe('INVALID_STATE');
  });
});
