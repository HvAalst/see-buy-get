import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { readSignedReportsRaw } from '../src/foundation/sms/sms-reports.raw';

/**
 * 2026-11-16 — SIGN-IN CODES ON THE STAFF CONSOLE, OVER THE WIRE (the owner: "Can we build it in a way that it becomes
 * visual and controlable from the staff console? If so, we implement."). Staff read every route and each country's
 * order; they set the order and switch a route off, named; the last route on stays on; nobody else may. A provider's
 * report about a text this server never sent changes nothing, and is answered the same.
 */
describe('sign-in codes on the staff console', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    readSignedReportsRaw(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows every route, and per country the order, what is off and where codes go now', async () => {
    const view = (await http().get('/v1/sbg/code-routes').set(bearer(staff)).expect(200)).body;
    expect(view.routes.map((r: { id: string }) => r.id)).toEqual(['africastalking', 'twilio', 'whatsapp', 'telegram']);
    // A sandbox never sends: each route is said as not set up, or set up and held back.
    for (const r of view.routes) expect(['not_set_up', 'half_set_up', 'sandbox']).toContain(r.state);
    expect(view.autoNextSeconds).toBe(60);
  });

  it('staff set a country’s order and switch a route off, named; the last route on stays on', async () => {
    const ke = (await http().post('/v1/sbg/code-routes/KE/order').set(bearer(staff)).send({ order: ['twilio', 'africastalking'], by: 'Amina Staff' }).expect(201)).body;
    expect(ke).toMatchObject({ country: 'KE', order: ['twilio', 'africastalking'], changed: true });
    await http().post('/v1/sbg/code-routes/KE/order').set(bearer(staff)).send({ order: ['twilio'], by: 'Amina Staff' }).expect(400);
    await http().post('/v1/sbg/code-routes/KE/order').set(bearer(staff)).send({ order: ['twilio', 'smoke-signals'], by: 'Amina Staff' }).expect(400);
    await http().post('/v1/sbg/code-routes/KE/routes/twilio').set(bearer(staff)).send({ on: false, by: 'Brian Staff' }).expect(201);
    const last = await http().post('/v1/sbg/code-routes/KE/routes/africastalking').set(bearer(staff)).send({ on: false, by: 'Brian Staff' });
    expect([last.status, last.body.detail]).toEqual([400, expect.stringMatching(/At least one route stays on/)]);
    await http().post('/v1/sbg/code-routes/ZZ/routes/twilio').set(bearer(staff)).send({ on: false, by: 'Brian Staff' }).expect(404);
    const view = (await http().get('/v1/sbg/code-routes').set(bearer(staff)).expect(200)).body;
    expect(view.countries.find((c: { country: string }) => c.country === 'KE')).toMatchObject({ order: ['twilio', 'africastalking'], off: ['twilio'] });
    expect(view.changes.slice(0, 2).map((c: { by: string; what: string }) => [c.by, c.what])).toEqual([
      ['Brian Staff', 'off'],
      ['Amina Staff', 'order'],
    ]);
    // Back on, for the rest of the run.
    await http().post('/v1/sbg/code-routes/KE/routes/twilio').set(bearer(staff)).send({ on: true, by: 'Brian Staff' }).expect(201);
  });

  it('nobody but staff reads or steers it', async () => {
    // Which staff role it takes (administration) is held by the staff-roles e2e, as for every staff door.
    await http().get('/v1/sbg/code-routes').expect(401);
    await http().post('/v1/sbg/code-routes/KE/order').send({ order: ['twilio', 'africastalking'] }).expect(401);
  });

  it('a provider’s report about a text this server never sent changes nothing, and is answered the same', async () => {
    await http().post('/v1/sms/status/twilio').type('form').send({ MessageSid: 'SMforged', MessageStatus: 'failed' }).expect(204);
    await http().post('/v1/sms/status/africastalking').type('form').send({ id: 'ATXid_forged', status: 'Failed' }).expect(204);
    await http().post('/v1/sms/status/africastalking').send({ nothing: true }).expect(204);
  });
/* 2026-11-16 — WhatsApp and Telegram, the person's choice (the plan, D2 and D3). */
  it('staff offer an app in a country, or withdraw it, named; the ways a number may choose come from it', async () => {
    const ke = (await http().post('/v1/sbg/code-routes/KE/apps/whatsapp').set(bearer(staff)).send({ on: false, by: 'Amina Staff' }).expect(201)).body;
    expect(ke.offer).toEqual(['telegram']);
    await http().post('/v1/sbg/code-routes/KE/apps/pigeon').set(bearer(staff)).send({ on: true, by: 'Amina Staff' }).expect(404);
    const view = (await http().get('/v1/sbg/code-routes').set(bearer(staff)).expect(200)).body;
    expect(view.changes[0]).toMatchObject({ by: 'Amina Staff', what: 'withdraw', route: 'whatsapp' });
    await http().post('/v1/sbg/code-routes/KE/apps/whatsapp').set(bearer(staff)).send({ on: true, by: 'Amina Staff' }).expect(201);
    // A sandbox sets up no app: a number is offered none, and a code chosen by an app still comes (kept here).
    expect((await http().get('/v1/sbg/auth/phone/ways').query({ phone: '+254711000888' }).expect(200)).body).toEqual({ ways: [] });
    await http().post('/v1/sbg/auth/phone/request').send({ phone: '+254711000888', via: 'whatsapp' }).expect(201);
    await http().post('/v1/sbg/auth/phone/request').send({ phone: '+254711000889', via: 'pigeon' }).expect(400);
  });

  it('WhatsApp and Telegram reports are believed only signed; Meta’s check is answered only with our verify token', async () => {
    await http().get('/v1/sms/status/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': 'abc' }).expect(403);
    await http().post('/v1/sms/status/whatsapp').set('content-type', 'application/json').send(JSON.stringify({ entry: [] })).expect(403);
    await http().post('/v1/sms/status/telegram').set('content-type', 'application/json').set('x-request-timestamp', String(Math.floor(Date.now() / 1000))).set('x-request-signature', 'ab'.repeat(32)).send(JSON.stringify({ request_id: 'r' })).expect(403);
  });
});

