import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2026-11-18 — PARCELS ACROSS A BORDER ON THE CONSOLE, OVER THE WIRE (the plan, step 1). Staff read every route and what it
 * still needs; a route is refused, by name, while anything is missing; an airport is never opened without a licensed
 * customs warehouse; the clearer and the fee are checked; nobody but staff reads or changes any of it.
 */
describe('parcels across a border, on the console', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a route is refused while anything is missing, each thing named', async () => {
    const r = await http().post('/v1/sbg/border-routes/NL/KE/propose').set(bearer(staff)).send({ by: 'Amina Staff' });
    expect(r.status).toBe(400);
    expect(r.body.detail).toMatch(/cannot be switched on yet/);
    expect(r.body.detail).toMatch(/no airport in KE is open/);
    await http().post('/v1/sbg/border-routes/KE/KE/propose').set(bearer(staff)).send({ by: 'Amina Staff' }).expect(400);
    await http().post('/v1/sbg/border-routes/NL/KE/approve').set(bearer(staff)).send({ by: 'Brian Staff' }).expect(400);
  });

  it('an arrival country’s airports: blocked until a licensed customs warehouse is agreed there', async () => {
    const opened = await http().post('/v1/sbg/border-arrivals/KE/airports/NBO').set(bearer(staff)).send({ open: true, by: 'Amina Staff' });
    expect([opened.status, opened.body.detail]).toEqual([400, expect.stringMatching(/customs warehouse agreed there/)]);
    await http().post('/v1/sbg/border-arrivals/KE/airports/AMS').set(bearer(staff)).send({ open: true, by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-arrivals/KE/airports/NBO/warehouse').set(bearer(staff)).send({ mdpId: 'no-such-hub', tstLicence: 'TST-1', agreement: 'AGR-1', by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-arrivals/KE/airports/NBO/warehouse').set(bearer(staff)).send({ mdpId: 'x', tstLicence: 'T', agreement: 'AGR-1', by: 'Amina Staff' }).expect(400);
    const view = (await http().get('/v1/sbg/border-routes').set(bearer(staff)).expect(200)).body;
    expect(Array.isArray(view.routes)).toBe(true);
    expect(Array.isArray(view.arrivals)).toBe(true);
  });

  it('the clearer and the fee are checked', async () => {
    await http().post('/v1/sbg/border-arrivals/KE/clearer').set(bearer(staff)).send({ kind: 'agent', entityId: 'nobody', by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-arrivals/KE/clearer').set(bearer(staff)).send({ kind: 'pigeon', by: 'Amina Staff' }).expect(400);
    await http().post('/v1/sbg/border-arrivals/KE/fee').set(bearer(staff)).send({ amount: 0, by: 'Amina Staff' }).expect(400);
  });

  it('nobody but staff reads or changes it', async () => {
    await http().get('/v1/sbg/border-routes').expect(401);
    await http().post('/v1/sbg/border-routes/NL/KE/propose').send({}).expect(401);
    await http().post('/v1/sbg/border-arrivals/KE/fee').send({ amount: 100 }).expect(401);
  });
});
