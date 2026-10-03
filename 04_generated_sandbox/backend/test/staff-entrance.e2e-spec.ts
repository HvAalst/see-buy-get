import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { totpCode, totpStep } from '../src/foundation/auth/totp';

/**
 * THE STAFF ENTRANCE, OVER THE WIRE — the console's sign-in as the guards and the rate limit actually see it.
 *
 * Staff sign in with a password and the code an authenticator app shows; a lost authenticator is reset by two
 * other members of staff; and a deployment can fence every staff door to the networks staff work on.
 */
describe('the staff entrance', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const make = async (name: string) =>
    (await http().post('/v1/sbg/operators').set('authorization', `Bearer ${setupKey}`).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201)).body as {
      operatorId: string;
      email: string;
      temporaryPassword: string;
    };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
  });

  afterAll(async () => {
    delete process.env.GLOS_STAFF_NETWORKS;
    await app?.close();
  });

  it('sets up two-step sign-in from Settings, and from then on the password alone opens nothing', async () => {
    const chloe = await make('chloe');
    const first = await http().post('/v1/sbg/operators/login').send({ email: chloe.email, password: chloe.temporaryPassword }).expect(201);
    const token = first.body.token.access_token;
    expect(first.body.twoStep).toBe(false);

    // The shared setup key is nobody in particular: it cannot set up a second step for itself.
    await http().post('/v1/sbg/operators/me/two-step').set('authorization', `Bearer ${setupKey}`).expect(403);

    const setup = await http().post('/v1/sbg/operators/me/two-step').set('authorization', `Bearer ${token}`).expect(201);
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//);
    const code = () => totpCode(setup.body.secret, totpStep());
    await http().post('/v1/sbg/operators/me/two-step/confirm').set('authorization', `Bearer ${token}`).send({ code: code() }).expect(201);
    const me = await http().get('/v1/sbg/operators/me').set('authorization', `Bearer ${token}`).expect(200);
    expect(me.body.twoStep).toBe(true);

    const asked = await http().post('/v1/sbg/operators/login').send({ email: chloe.email, password: chloe.temporaryPassword }).expect(400);
    expect(asked.body.code).toBe('FIELD_REQUIRED');
    expect(asked.body.params?.field).toBe('code');
    // The code that turned it on was spent; the next step's code (or this one, once) signs in.
    const next = totpCode(setup.body.secret, totpStep() + 1);
    await http().post('/v1/sbg/operators/login').send({ email: chloe.email, password: chloe.temporaryPassword, code: next }).expect(201);
  });

  it('is reset by two other members of staff, never by the person themselves', async () => {
    const lost = await make('lost');
    const amina = await make('amina');
    const brian = await make('brian');
    const tokenOf = async (who: { email: string; temporaryPassword: string }) => (await http().post('/v1/sbg/operators/login').send({ email: who.email, password: who.temporaryPassword })).body.token.access_token;
    const lostToken = await tokenOf(lost);
    const setup = await http().post('/v1/sbg/operators/me/two-step').set('authorization', `Bearer ${lostToken}`);
    await http().post('/v1/sbg/operators/me/two-step/confirm').set('authorization', `Bearer ${lostToken}`).send({ code: totpCode(setup.body.secret, totpStep()) }).expect(201);

    const reset = (token: string) => http().post(`/v1/sbg/operators/${lost.operatorId}/two-step/reset`).set('authorization', `Bearer ${token}`);
    await reset(lostToken).expect(403);
    await reset(setupKey).expect(403);
    const aminaToken = await tokenOf(amina);
    expect((await reset(aminaToken).expect(201)).body.twoStepResetAskedBy).toBe(`amina ${tag}`);
    await reset(aminaToken).expect(409);
    expect((await reset(await tokenOf(brian)).expect(201)).body.twoStep).toBe(false);
    // Signed out, and the password alone works again until they set it up anew (a sandbox does not force it).
    await http().get('/v1/sbg/operators/me').set('authorization', `Bearer ${lostToken}`).expect(401);
  });

  it('closes every staff door outside the networks a deployment names — sign-in, the setup key, and tokens already issued', async () => {
    const dana = await make('dana');
    const token = (await http().post('/v1/sbg/operators/login').send({ email: dana.email, password: dana.temporaryPassword })).body.token.access_token;
    process.env.GLOS_STAFF_NETWORKS = '10.20.0.0/16';
    try {
      await http().post('/v1/sbg/operators/login').send({ email: dana.email, password: dana.temporaryPassword }).expect(403);
      await http().post('/v1/auth/token').send({ role: 'operator' }).expect(403);
      await http().get('/v1/sbg/operators').set('authorization', `Bearer ${token}`).expect(403);
      process.env.GLOS_STAFF_NETWORKS = '127.0.0.1, ::1';
      await http().get('/v1/sbg/operators').set('authorization', `Bearer ${token}`).expect(200);
    } finally {
      delete process.env.GLOS_STAFF_NETWORKS;
    }
  });
});
