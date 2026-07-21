import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Route-resolution guard. Nest matches routes in declaration order, so a static segment
 * (`agents/kyc-queue`) MUST be declared before its `:param` sibling (`agents/:did`) or the param route
 * swallows it and the static handler becomes unreachable (the request 404s as "not found: kyc-queue").
 *
 * These five static/param pairs are the fragile ones in the SeeBuyGet controller. This spec pins their
 * resolution so a future reorder — most importantly the physical persona split (moving handlers between
 * controllers) — can't silently shadow a static route. Each static route must return its own handler's
 * 2xx, never the param handler's 404.
 */
describe('SeeBuyGet route resolution (static must win over :param)', () => {
  let app: INestApplication;
  let auth: { Authorization: string };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    const token = (await request(app.getHttpServer()).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
    auth = { Authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => app.getHttpServer();

  it('agents/kyc-queue resolves to the queue, not getAgent(:did="kyc-queue")', async () => {
    const res = await request(http()).get('/v1/sbg/agents/kyc-queue').set(auth).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('fleet/managers/kyc-queue resolves to the queue, not getManager(:did="kyc-queue")', async () => {
    const res = await request(http()).get('/v1/sbg/fleet/managers/kyc-queue').set(auth).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('fleet/drivers/kyc-queue resolves to the queue, not getFleetDriver(:did="kyc-queue")', async () => {
    const res = await request(http()).get('/v1/sbg/fleet/drivers/kyc-queue').set(auth).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('vehicles/truck-subtypes resolves to the catalog, not getVehicle(:id="truck-subtypes")', async () => {
    const res = await request(http()).get('/v1/sbg/vehicles/truck-subtypes').set(auth).expect(200);
    // The catalog is an object/array of subtypes; a param-capture would 404 as "vehicle not found".
    expect(res.body).toBeDefined();
    expect(res.status).toBe(200);
  });

  it('fleet/managers/login resolves to managerLogin, not a param route (bad code → 401 AUTH_CODE_INVALID)', async () => {
    const res = await request(http()).post('/v1/sbg/fleet/managers/login').set(auth).send({ code: 'FM-NOPE' }).expect(401);
    expect(res.body.code).toBe('AUTH_CODE_INVALID');
  });
});
