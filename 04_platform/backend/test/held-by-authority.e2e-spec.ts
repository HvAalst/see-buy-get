import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';

/**
 * A LOAD HELD BY THE POLICE OR CUSTOMS, over the wire (the ISO 28000 check: "Held by police or customs as a state, with
 * operations told"). The driver carrying it says so; operations has a critical case at once; the shipper is told and reads
 * who holds it; the tracking page says only that it is held on the way; it is not delivered and its stop is not a mystery;
 * the driver says it was let go, and the case clears itself.
 */
describe('a load held by the police or customs, over the wire', () => {
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

  async function aBusiness(): Promise<{ authorization: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `held-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const owner = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const created = await http().post('/v1/sbg/business').set(bearer(owner)).send({ name: `Held Traders ${tag}`, country: 'KE', registrationNo: `HLD-${tag}`, activities: ['shipper'], yourName: 'Achieng Owner' }).expect(201);
    return bearer(created.body.token.access_token);
  }

  async function aDriver(name: string): Promise<{ did: string; token: { authorization: string } }> {
    seq += 1;
    const u = `${tag}${seq}`;
    const r = await http().post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: name, fullName: `${name} Truck`, nationalId: `DRV-H-${u}`, mobile: `+2547${digits().slice(-6)}${seq}`, licenceClasses: ['truck'], licenceNumber: `DL-${u}`, licenceExpiresAt: '2030-01-01' }).expect(201);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: r.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: r.body.did as string, token: bearer(token) };
  }

  it('said by the driver, told to operations and the shipper, never named on the tracking page, let go, and the case clears itself', async () => {
    const biz = await aBusiness();
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(biz)
      .send({ description: 'Maize, 20 bags', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Mlolongo yard', destLabel: 'Nakuru store', destLocation: { lat: -0.3, lng: 36.07 }, weightKg: 1000, packaging: 'bagged', packages: 20, pickupCountry: 'KE', destCountry: 'KE' })
      .expect(201);
    const freightId = posted.body.freightId as string;
    const driver = await aDriver('Wekesa');
    const other = await aDriver('Otieno');
    const dispatch = app.get(DispatchService);
    const store = (dispatch as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    // Claimed and not yet picked up: nothing is held off the road.
    store.set(freightId, { ...store.get(freightId), status: 'claimed', claimedBy: driver.did, claimedAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/held`).set(driver.token).send({ by: 'police' }).expect(400)).body.detail).toMatch(/held is said while it is on the road/);
    // On the road with this driver (the pickup itself is not what this is about).
    store.set(freightId,{ ...store.get(freightId), status: 'in_transit', claimedBy: driver.did, claimedAt: new Date(Date.now() - 3_600_000).toISOString(), pickedUpAt: new Date(Date.now() - 1_800_000).toISOString() });
    const code = store.get(freightId).code as string;
    const trackingKey = store.get(freightId).trackingKey as string;
    const held = (who: { authorization: string }, body: Record<string, unknown>) => http().post(`/v1/sbg/dispatch/freight/${freightId}/held`).set(who).send(body);
    const letGo = (who: { authorization: string }, body: Record<string, unknown> = {}) => http().post(`/v1/sbg/dispatch/freight/${freightId}/let-go`).set(who).send(body);
    const cases = async (which: 'live' | 'closed') => ((await http().get('/v1/sbg/flag-cases').query({ which, kind: 'Held_By_Authority' }).set(operator).expect(200)).body.items as Array<{ subject: string; severity: string; state: string }>).filter((c) => c.subject === code);

    // Only the driver carrying it says it: not staff, not another driver; and who holds it is said.
    await held(operator, { by: 'police' }).expect(403);
    await held(other.token, { by: 'police' }).expect(403);
    await held(driver.token, { by: 'army' }).expect(400);
    await letGo(driver.token).expect(400);

    const said = (await held(driver.token, { by: 'police', who: '  Traffic police,  Athi River ', note: 'Checking the papers' }).expect(201)).body;
    expect(said).toEqual({ replayed: false, held: { by: 'police', who: 'Traffic police, Athi River', note: 'Checking the papers', since: expect.any(String) } });
    // The same tap sent again (kept with no signal): the hold already said. Held by somebody else is said after it lets go.
    expect((await held(driver.token, { by: 'police' }).expect(201)).body.replayed).toBe(true);
    expect((await held(driver.token, { by: 'customs' }).expect(400)).body.detail).toMatch(/held by the police already: say it was let go/);

    // Operations: a critical case at once. The shipper: told, and reads who holds it. The driver's app: says it.
    expect(await cases('live')).toEqual([expect.objectContaining({ severity: 'critical' })]);
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(biz).expect(200)).body)).toMatch(new RegExp(`Load ${code} is held by the police`));
    const mine = (await http().get('/v1/sbg/dispatch/posted').set(biz).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    expect(mine.heldByAuthority).toMatchObject({ by: 'police', who: 'Traffic police, Athi River' });
    const claim = (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(driver.token).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);
    expect(claim.heldByAuthority).toMatchObject({ by: 'police' });
    // The tracking page — anybody with the label's key: held on the way, since when; never by whom or where.
    const page = (await http().get(`/v1/sbg/track/${trackingKey}`).expect(200)).body;
    expect(page.heldOnTheWay).toEqual({ since: said.held.since });
    // …and promises no time while it is held: when it arrives is not known until it is let go.
    expect(page.arrival).toBeUndefined();
    expect(JSON.stringify(page)).not.toMatch(/police|Athi River|papers/i);
    // Not delivered while held; and standing where it is held is a reason to stand, not a vehicle gone astray.
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(driver.token).send({ driverDid: driver.did }).expect(400)).body.detail).toMatch(/say it was let go before you deliver it/);
    expect(dispatch.reasonsToStand(driver.did).held).toBe(true);

    // LET GO: the case clears itself and says so; the shipper is told; the tap sent twice is the one already made.
    const done = (await letGo(driver.token, { note: 'Papers in order' }).expect(201)).body;
    expect(done.held).toMatchObject({ by: 'police', letGoAt: expect.any(String), letGoNote: 'Papers in order' });
    expect((await letGo(driver.token).expect(201)).body.replayed).toBe(true);
    expect(await cases('live')).toEqual([]);
    expect(await cases('closed')).toEqual([expect.objectContaining({ state: 'cleared' })]);
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(biz).expect(200)).body)).toMatch(new RegExp(`Load ${code} was let go`));
    const after = (await http().get(`/v1/sbg/track/${trackingKey}`).expect(200)).body;
    expect(after.heldOnTheWay).toBeUndefined();
    expect(after.arrival).toMatchObject({ expectedAt: expect.any(String) });
    expect(dispatch.reasonsToStand(driver.did).held).toBe(false);
    // Held again later, by customs this time: a new hold.
    expect((await held(driver.token, { by: 'customs', who: 'KRA, Naivasha weighbridge' }).expect(201)).body.held).toMatchObject({ by: 'customs' });
    expect(await cases('live')).toHaveLength(1);
    // Off the road by any way at all, it is held on the road no longer: nobody reads it so, and the case clears.
    store.set(freightId, { ...store.get(freightId), status: 'delivered', deliveredAt: new Date().toISOString() });
    expect((await http().get('/v1/sbg/dispatch/posted').set(biz).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId).heldByAuthority).toBeUndefined();
    expect(await cases('live')).toEqual([]);
  });

  it('carries each country’s desk number on the load, from its company’s own card — and no directory shows it (round 39)', async () => {
    const biz = await aBusiness();
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(biz)
      .send({ description: 'Coffee, 40 sacks', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Mlolongo yard', destLabel: 'Addis depot', destLocation: { lat: 9.0, lng: 38.75 }, weightKg: 2400, packaging: 'bagged', packages: 40, pickupCountry: 'KE', destCountry: 'ET' })
      .expect(201);
    const freightId = posted.body.freightId as string;
    const driver = await aDriver('Kiprop');
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(freightId, { ...store.get(freightId), status: 'in_transit', claimedBy: driver.did, claimedAt: new Date(Date.now() - 3_600_000).toISOString(), pickedUpAt: new Date(Date.now() - 1_800_000).toISOString() });
    const claim = async () => (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(driver.token).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);
    const card = (entityId: string, body: Record<string, unknown>) => http().post(`/v1/sbg/entities/${entityId}/contact`).set(operator).send({ ...body, by: 'Grace' });

    // Each company writes its own; a number's shape is checked. Until one is written, there is nothing to show.
    await card('sbg-ke', { deskPhone: '' }).expect(201);
    await card('sbg-et', { deskPhone: '' }).expect(201);
    expect((await claim()).desks).toBeUndefined();
    await card('sbg-ke', { deskPhone: 'ring the border' }).expect(400);
    await card('sbg-ke', { deskPhone: '+254 20 765 4321', phone: '+254 20 111 2222' }).expect(201);
    await card('sbg-et', { deskPhone: '+251 11 555 0100' }).expect(201);
    // On the load: the country it was taken over in first, then the one it goes to.
    expect((await claim()).desks).toEqual([
      { country: 'KE', company: 'SeeBuyGet Kenya', phone: '+254 20 765 4321' },
      { country: 'ET', company: 'SeeBuyGet Ethiopia', phone: '+251 11 555 0100' },
    ]);
    // The company's own screen reads it; switching a country on asks for it.
    const own = (await http().get('/v1/sbg/entities/sbg-ke/contact').set(operator).expect(200)).body;
    expect(own).toMatchObject({ deskPhone: '+254 20 765 4321', phone: '+254 20 111 2222' });
    const readiness = (await http().get('/v1/sbg/entities/sbg-ke/record').set(operator).expect(200)).body.readiness.items as Array<{ key: string; met: boolean }>;
    expect(readiness.find((i) => i.key === 'desk_phone')).toMatchObject({ met: true });
    // Delivered, it is the driver's load no longer: no desk is carried with it.
    store.set(freightId, { ...store.get(freightId), status: 'delivered', deliveredAt: new Date().toISOString() });
    expect((await claim())?.desks).toBeUndefined();
  });
});
