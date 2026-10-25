import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EventBus } from '../src/foundation/events/event-bus.service';
import { GlosEvent } from '../src/foundation/events/glos-events';
import { BusinessHookService } from '../src/modules/pudo/business-hooks.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { AGREED } from './agreed';

/**
 * A BUSINESS'S OWN SYSTEM, TOLD OF ITS LOADS, over the wire (the user, round 10: "Businesses first"; "Only what it sees in
 * its app"; "The company, once a day"). The drivers' own acts are proved where they live; here a load is moved in the
 * running app's store and its events said on the app's own bus — everything after is the booted app's real wiring: what
 * is sent, signed, read back, sent again, and told when the system stays down.
 */
describe('a business’s own system, told of its loads, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  let receiver: Server;
  let origin = '';
  let landed: Array<{ event: string; delivery: string; signature: string; raw: string }> = [];
  let answer = 200;

  async function aPerson(): Promise<{ phone: string; token: string; email: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `sys-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token, email };
  }

  beforeAll(async () => {
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ event: String(req.headers['x-sbg-event']), delivery: String(req.headers['x-sbg-delivery']), signature: String(req.headers['x-sbg-signature']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(answer);
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

  it('tells its system each step of its loads, as its own screen reads them — signed, read back, sent again, and said when it stays down', async () => {
    const owner = await aPerson();
    const created = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `System Traders ${tag}`, country: 'KE', registrationNo: `SYS-${tag}`, activities: ['shipper'], yourName: 'Wanjiku Owner' }).expect(201);
    const ownerBiz = created.body.token.access_token as string;
    const entityId = created.body.business.entityId as string;
    const join = async (role: 'booker' | 'viewer', name: string) => {
      const who = await aPerson();
      await http().post('/v1/sbg/business/me/members').set(bearer(ownerBiz)).send({ phone: who.phone, name, role }).expect(201);
      const invite = (await http().get('/v1/sbg/business/mine').set(bearer(who.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === entityId);
      await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(who.token)).expect(201);
      return (await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(201)).body.token.access_token as string;
    };
    const bookerBiz = await join('booker', 'Otieno Booker');
    const viewerBiz = await join('viewer', 'Akinyi Viewer');
    const hooks = app.get(BusinessHookService);

    // Nothing is sent until an owner gives an address; then the signing secret is shown once.
    expect((await http().get('/v1/sbg/business/me/system').set(bearer(viewerBiz)).expect(200)).body).toMatchObject({ hasSecret: false, messages: [], events: expect.arrayContaining(['load.taken', 'load.picked_up', 'load.delivered', 'load.claim_opened']) });
    await http().put('/v1/sbg/business/me/system').set(bearer(bookerBiz)).send({ url: `${origin}/hooks` }).expect(403);
    await http().put('/v1/sbg/business/me/system').set(bearer(viewerBiz)).send({ url: `${origin}/hooks` }).expect(403);
    await http().put('/v1/sbg/business/me/system').set(bearer(setupKey)).send({ url: `${origin}/hooks` }).expect(403);
    await http().put('/v1/sbg/business/me/system').set(bearer(ownerBiz)).send({ url: 'not an address' }).expect(400);
    const set = (await http().put('/v1/sbg/business/me/system').set(bearer(ownerBiz)).send({ url: `${origin}/hooks` }).expect(200)).body;
    expect(set.secret).toMatch(/^whsec_/);
    const secret = set.secret as string;
    expect((await http().get('/v1/sbg/business/me/system').set(bearer(ownerBiz)).expect(200)).body).toMatchObject({ url: `${origin}/hooks`, hasSecret: true });
    expect((await http().get('/v1/sbg/business/me/system').set(bearer(ownerBiz)).expect(200)).body.secret).toBeUndefined();

    // Its load: taken, picked up, delivered.
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(bookerBiz))
      .send({ description: 'Avocados, 12 pallets', pickupLocation: { lat: -0.72, lng: 37.15 }, pickupLabel: 'Murang’a packhouse', destLabel: 'Nairobi market', weightKg: 6000, packaging: 'palletised', pickupCountry: 'KE', destCountry: 'KE' })
      .expect(201);
    const freightId = posted.body.freightId as string;
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const bus = app.get(EventBus);
    const say = async (topic: string, payload: Record<string, unknown>, patch?: Record<string, unknown>) => {
      if (patch) store.set(freightId, { ...store.get(freightId), ...patch });
      await bus.publish(topic, payload, { source: 'test' });
      await hooks.drain();
    };
    landed = [];
    await say(GlosEvent.Pudo.LoadClaimed, { kind: 'freight', ref: freightId, driverDid: 'did:glos:driver-x' }, { status: 'claimed', claimedBy: 'did:glos:driver-x' });
    await say(GlosEvent.Pudo.FreightPickedUp, { freightId, code: posted.body.code }, { status: 'in_transit', pickedUpAt: new Date().toISOString() });
    const at = new Date().toISOString();
    await say(GlosEvent.Pudo.FreightDelivered, { freightId, code: posted.body.code }, { status: 'delivered', deliveredAt: at, proofOfDelivery: { receiverName: 'Mwangi at the market', photoRef: 'med_pod', confirmed: [], at } });
    expect(landed.map((l) => l.event)).toEqual(['load.taken', 'load.picked_up', 'load.delivered']);
    for (const l of landed) {
      const expected = createHmac('sha256', secret).update(l.raw).digest('hex');
      expect(timingSafeEqual(Buffer.from(expected), Buffer.from(l.signature))).toBe(true);
    }
    // EXACTLY what its own Loads screen reads about that load, and nothing more.
    const delivered = JSON.parse(landed[2].raw) as { event: string; data: { load: Record<string, unknown> } };
    const row = (await http().get('/v1/sbg/dispatch/posted').set(bearer(bookerBiz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    expect(delivered.data.load).toMatchObject({ freightId, status: 'delivered', receiverName: 'Mwangi at the market' });
    for (const key of Object.keys(delivered.data.load)) expect(row).toHaveProperty(key);

    // Its system is down: the message waits, says why, and is read back; a viewer cannot send it again, a booker can.
    answer = 503;
    await say(GlosEvent.Pudo.FreightClaimOpened, { freightId, code: posted.body.code, kind: 'damaged' }, { claim: { kind: 'damaged', description: 'Two pallets crushed', at: new Date().toISOString() } });
    const waiting = (await http().get('/v1/sbg/business/me/system').set(bearer(viewerBiz)).expect(200)).body.messages.find((m: { event: string }) => m.event === 'load.claim_opened');
    expect(waiting).toMatchObject({ state: 'pending', attempts: 1 });
    expect(waiting.lastError).toBeTruthy();
    await http().post(`/v1/sbg/business/me/system/messages/${waiting.id}/resend`).set(bearer(viewerBiz)).expect(403);
    // The owner turns the secret meanwhile (a booker cannot); what is sent again is signed with the new one.
    await http().post('/v1/sbg/business/me/system/secret').set(bearer(bookerBiz)).expect(403);
    const turned = (await http().post('/v1/sbg/business/me/system/secret').set(bearer(ownerBiz)).expect(201)).body.secret as string;
    expect(turned).toMatch(/^whsec_/);
    expect(turned).not.toBe(secret);
    answer = 200;
    landed = [];
    expect((await http().post(`/v1/sbg/business/me/system/messages/${waiting.id}/resend`).set(bearer(bookerBiz)).expect(201)).body).toMatchObject({ id: waiting.id, state: 'delivered', resent: 1 });
    expect(landed).toEqual([expect.objectContaining({ delivery: waiting.id, event: 'load.claim_opened' })]);
    expect(landed[0].raw).toBe(waiting.body);
    const resigned = createHmac('sha256', turned).update(landed[0].raw).digest('hex');
    expect(timingSafeEqual(Buffer.from(resigned), Buffer.from(landed[0].signature))).toBe(true);
    expect((await http().post('/v1/sbg/business/me/system/test').set(bearer(bookerBiz)).expect(201)).body).toMatchObject({ event: 'test', state: 'delivered' });

    // Another business cannot find it.
    const rival = await aPerson();
    const rivalBiz = (await http().post('/v1/sbg/business').set(bearer(rival.token)).send({ name: `Rival ${tag}`, country: 'KE', registrationNo: `RIV-${tag}`, activities: ['shipper'], yourName: 'Rival Owner' }).expect(201)).body.token.access_token;
    await http().post(`/v1/sbg/business/me/system/messages/${waiting.id}/resend`).set(bearer(rivalBiz)).expect(404);

    // Given up after a day of tries: the business is told in its bell, its owner by email — once a day, not once a message.
    answer = 503;
    const stateOf = (event: string) => hooks.view(entityId).messages.find((m) => m.event === event)?.state;
    const notices = async () => ((await http().get('/v1/sbg/notifications/inbox').set(bearer(ownerBiz)).expect(200)).body.items as Array<{ kind: string }>).filter((n) => n.kind === 'system_down').length;
    const mails = async () => ((await http().get('/v1/mail/outbox').query({ to: owner.email }).expect(200)).body.items as Array<{ template: string; text: string }>).filter((m) => m.template === 'business-system-down');
    // Time goes by in five-minute steps, so every try is made when it is due.
    let t = Date.now();
    const tick = async () => {
      t += 5 * 60_000;
      await hooks.drain(t);
    };
    await say(GlosEvent.Pudo.FreightClaimDecided, { freightId, code: posted.body.code, decision: 'report_only' });
    for (let i = 0; i < 72; i++) await tick();
    // A second one, six hours behind the first.
    await say(GlosEvent.Pudo.FreightCancelled, { freightId, code: posted.body.code, reason: 'test' });
    let toldAt = 0;
    for (let i = 0; i < 1500 && stateOf('load.cancelled') !== 'failed'; i++) {
      await tick();
      if (!toldAt && stateOf('load.claim_decided') === 'failed') toldAt = t;
    }
    expect(stateOf('load.claim_decided')).toBe('failed');
    expect(stateOf('load.cancelled')).toBe('failed');
    // The first given up: told once, in the bell and by email. The second, hours later the same day: not told again yet…
    expect(t - toldAt).toBeLessThan(24 * 3_600_000);
    expect(await notices()).toBe(1);
    expect(await mails()).toHaveLength(1);
    expect((await mails())[0].text).toContain('could not be delivered to your system');
    // …and a day after the first notice, it is.
    await hooks.drain(toldAt + 25 * 3_600_000);
    expect(await notices()).toBe(2);
    expect(await mails()).toHaveLength(2);
    // Staff read the counts; they send nothing in the business's name.
    expect((await http().get(`/v1/sbg/businesses/${entityId}`).set(bearer(setupKey)).expect(200)).body.system).toMatchObject({ hasAddress: true, givenUp: 2, delivered: expect.any(Number) });
    await http().post(`/v1/sbg/business/me/system/messages/${waiting.id}/resend`).set(bearer(setupKey)).expect(403);
  });
});
