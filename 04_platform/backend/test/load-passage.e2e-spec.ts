import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BusinessHookService } from '../src/modules/pudo/business-hooks.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { AGREED } from './agreed';

/**
 * A LOAD AT A BORDER OR A HUB, over the wire (the user, round 14: "A load at a border or hub"; "The driver, by a tap";
 * "Each post's promise"). A business's load to Kampala is put on the road in the running app's store; from there on it
 * is the booted app: the driver says each step through the door its app uses, and its shipper's Loads screen, its own
 * system, the tracking page and staff read what was said — never who said it or where their phone was.
 */
describe('a load at a border or a hub, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  let receiver: Server;
  let origin = '';
  let landed: Array<{ event: string; signature: string; raw: string }> = [];

  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `pass-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token };
  }

  const driverToken = async (did: string) => (await http().post('/v1/auth/token').send({ role: 'driver', did, type: 'client_credentials' }).expect(201)).body.access_token as string;
  /** A driver on the network's books. */
  async function aDriver(name: string): Promise<string> {
    seq += 1;
    const u = `${tag}${seq}`;
    const r = await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: name, fullName: `${name} Truck`, nationalId: `DRV-B-${u}`, mobile: `+2547${String(Date.now()).slice(-6)}${seq}`, licenceClasses: ['truck'], licenceNumber: `DL-${u}`, licenceExpiresAt: '2030-01-01' });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.did as string;
  }

  beforeAll(async () => {
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ event: String(req.headers['x-sbg-event']), signature: String(req.headers['x-sbg-signature']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const a = receiver.address();
    origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  it('the driver says the border, the clearing and the hub; the shipper, its system, the page and staff read it', async () => {
    const owner = await aPerson();
    const created = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `Border Traders ${tag}`, country: 'KE', registrationNo: `BRD-${tag}`, activities: ['shipper'], yourName: 'Wanjiku Owner' }).expect(201);
    const biz = created.body.token.access_token as string;
    const secret = (await http().put('/v1/sbg/business/me/system').set(bearer(biz)).send({ url: `${origin}/hooks` }).expect(200)).body.secret as string;
    // Kenya into Uganda, with its posts on record.
    await http().post('/v1/sbg/border-rules').set(bearer(setupKey)).send({ from: 'KE', to: 'UG', crossings: [{ name: 'Malaba', hours: '24 hours' }, { name: 'Busia' }], cabotage: 'allowed' }).expect(201);

    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(biz))
      .send({ description: 'Clay bricks, 3 pallets', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', destLocation: { lat: 0.31, lng: 32.58 }, weightKg: 1200, packaging: 'palletised', packages: 3, pickupCountry: 'KE', destCountry: 'UG' })
      .expect(201);
    const freightId = posted.body.freightId as string;
    const driverDid = await aDriver('Otieno');
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const pickedUpAt = new Date(Date.now() - 10 * 3_600_000).toISOString();
    store.set(freightId, { ...store.get(freightId), status: 'in_transit', claimedBy: driverDid, claimedAt: pickedUpAt, pickedUpAt, carriage: { vehicleId: 'veh_b', plate: 'KDB 404X', vehicleClass: 'truck', driverDid, at: pickedUpAt } });
    const driver = await driverToken(driverDid);
    const hooks = app.get(BusinessHookService);
    const say = (token: string, body: Record<string, unknown>) => http().post(`/v1/sbg/dispatch/freight/${freightId}/passages`).set(bearer(token)).send(body);

    // Only the driver carrying it, and in words; staff may not say it in the driver's place.
    expect((await say(setupKey, { kind: 'at_border', post: 'Malaba' }).expect(403)).body.detail).toMatch(/said by the driver carrying the load/);
    expect((await say(await driverToken(await aDriver('Kamau')), { kind: 'at_border', post: 'Malaba' }).expect(403)).body.detail).toMatch(/claimed by another driver/);
    await say(biz, { kind: 'at_border', post: 'Malaba' }).expect(403);
    await say(driver, { kind: 'over_the_moon' }).expect(400);
    expect((await say(driver, { kind: 'at_border' }).expect(400)).body.detail).toMatch(/which border post/);
    expect((await say(driver, { kind: 'cleared_border' }).expect(400)).body.detail).toMatch(/not at a border/);

    // The driver's app is told it crosses, and the posts on record.
    const mine = (await http().get(`/v1/sbg/fleet/drivers/${driverDid}/claims`).set(bearer(driver)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);
    expect(mine.passage).toEqual({ crosses: true, from: 'KE', to: 'UG', posts: ['Malaba', 'Busia'] });

    // At Malaba: said, its system told — signed, the step and the load as its Loads screen reads it.
    landed = [];
    const atBorder = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const at = (await say(driver, { kind: 'at_border', post: 'malaba', location: { lat: 0.636, lng: 34.28 }, observedAt: atBorder }).expect(201)).body;
    expect(at).toMatchObject({ replayed: false, passage: { kind: 'at_border', post: 'Malaba', at: atBorder }, crossing: { state: 'at_post', post: 'Malaba', since: atBorder, wait: { hours: 4, basis: 'standard' } } });
    expect(at.crossing.expectedAt).toBeTruthy();
    // The same tap sent again (no answer heard): the same step, nobody told twice.
    expect((await say(driver, { kind: 'at_border', post: 'Malaba', observedAt: atBorder }).expect(201)).body.replayed).toBe(true);
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['load.at_border']);
    expect(timingSafeEqual(Buffer.from(createHmac('sha256', secret).update(landed[0].raw).digest('hex')), Buffer.from(landed[0].signature))).toBe(true);
    const told = JSON.parse(landed[0].raw) as { data: { load: Record<string, unknown>; passage: Record<string, unknown> } };
    expect(told.data.passage).toEqual({ kind: 'at_border', post: 'Malaba', at: atBorder });
    expect(told.data.load).toMatchObject({ freightId, passages: [{ kind: 'at_border', post: 'Malaba' }], crossing: { state: 'at_post' } });

    // Cleared three hours later, then at a hub.
    const clearedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect((await say(driver, { kind: 'cleared_border', observedAt: clearedAt }).expect(201)).body.passage).toEqual({ kind: 'cleared_border', post: 'Malaba', at: clearedAt, waitedMin: 180 });
    await say(driver, { kind: 'at_hub', hub: 'Kampala ICD' }).expect(201);
    await hooks.drain();
    expect(landed.map((l) => l.event)).toEqual(['load.at_border', 'load.border_cleared', 'load.at_hub']);

    // The shipper's Loads screen: what was said, where it has got to, when it is expected — never who, never where the phone was.
    const row = (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    expect(row.passages.map((p: { kind: string }) => p.kind)).toEqual(['at_border', 'cleared_border', 'at_hub']);
    expect(row.crossing).toMatchObject({ state: 'cleared', post: 'Malaba', clearedAt, waitedMin: 180 });
    expect(Date.parse(row.crossing.expectedAt)).toBeGreaterThan(Date.parse(clearedAt));
    for (const said of [JSON.stringify(row), ...landed.map((l) => l.raw)]) {
      expect(said).not.toContain(driverDid);
      expect(said).not.toContain('34.28');
    }

    // Whoever holds the tracking link reads the same.
    expect(row.trackingKey).toBeTruthy();
    const page = (await http().get(`/v1/sbg/track/${row.trackingKey}`).expect(200)).body;
    expect(page).toMatchObject({ passages: [{ kind: 'at_border', post: 'Malaba' }, { kind: 'cleared_border', waitedMin: 180 }, { kind: 'at_hub', hub: 'Kampala ICD' }], crossing: { state: 'cleared', post: 'Malaba' } });
    expect(JSON.stringify(page)).not.toContain(driverDid);

    // Staff read every post's measured wait; nobody else does.
    const waits = (await http().get('/v1/sbg/border-waits').set(bearer(setupKey)).expect(200)).body;
    expect(waits).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'KE', to: 'UG', post: 'Malaba', hours: 3, crossings: 1, measured: false })]));
    await http().get('/v1/sbg/border-waits').set(bearer(biz)).expect(403);
    await http().get('/v1/sbg/border-waits').set(bearer(driver)).expect(403);

    // Delivered: its steps stay; where it has got to and when it is expected are over.
    store.set(freightId, { ...store.get(freightId), status: 'delivered', deliveredAt: new Date().toISOString() });
    const after = (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    expect(after.passages).toHaveLength(3);
    expect(after.crossing).toBeUndefined();
    await say(driver, { kind: 'at_hub', hub: 'Kampala ICD 2' }).expect(400);
  });
});
