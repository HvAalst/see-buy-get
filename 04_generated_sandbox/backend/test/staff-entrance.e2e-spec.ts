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

  describe('a new staff account takes two members of staff', () => {
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const signIn = async (who: { email: string; temporaryPassword: string }) => (await http().post('/v1/sbg/operators/login').send({ email: who.email, password: who.temporaryPassword }).expect(201)).body.token.access_token as string;
    const listed = async (token: string) => (await http().get('/v1/sbg/operators').set(bearer(token)).expect(200)).body as { items: Array<{ email: string }>; waiting: Array<{ proposalId: string; email: string; askedBy: string; mine: boolean }> };

    it('one asks and a second approves — and nobody with a sign-in of their own makes one alone', async () => {
      const amina = await make('amina2');
      const brian = await make('brian2');
      const [aminaToken, brianToken] = [await signIn(amina), await signIn(brian)];
      const eve = { email: `eve-${tag}@sbg.test`, name: `Eve ${tag}` };

      // The old way, with a staff sign-in: refused, and nothing is made.
      const alone = await http().post('/v1/sbg/operators').set(bearer(aminaToken)).send(eve).expect(403);
      expect(alone.body.detail ?? alone.body.message).toMatch(/a second member of staff approves it/);
      expect(alone.body).not.toHaveProperty('temporaryPassword');
      // The setup key is nobody in particular: it cannot ask, approve or decline.
      await http().post('/v1/sbg/operators/proposals').set(bearer(setupKey)).send(eve).expect(403);
      await http().post('/v1/sbg/operators/proposals').send(eve).expect(401);

      const asked = (await http().post('/v1/sbg/operators/proposals').set(bearer(aminaToken)).send(eve).expect(201)).body;
      expect(asked).toMatchObject({ email: eve.email, name: eve.name, askedBy: `amina2 ${tag}`, mine: true });
      expect(JSON.stringify(asked)).not.toMatch(/password/i);
      expect((await listed(aminaToken)).waiting.find((p) => p.proposalId === asked.proposalId)?.mine).toBe(true);
      expect((await listed(brianToken)).waiting.find((p) => p.proposalId === asked.proposalId)).toMatchObject({ mine: false, askedBy: `amina2 ${tag}` });
      expect((await listed(brianToken)).items.some((a) => a.email === eve.email)).toBe(false);

      const approve = (token: string) => http().post(`/v1/sbg/operators/proposals/${asked.proposalId}/approve`).set(bearer(token));
      await approve(aminaToken).expect(409);
      await approve(setupKey).expect(403);
      expect((await listed(brianToken)).items.some((a) => a.email === eve.email)).toBe(false);

      const made = (await approve(brianToken).expect(201)).body;
      expect(made).toMatchObject({ email: eve.email, name: eve.name });
      expect(made.temporaryPassword).toHaveLength(12);
      const eveToken = await signIn({ email: eve.email, temporaryPassword: made.temporaryPassword });
      expect((await http().get('/v1/sbg/operators/me').set(bearer(eveToken)).expect(200)).body.name).toBe(eve.name);
      const after = await listed(brianToken);
      expect(after.items.some((a) => a.email === eve.email)).toBe(true);
      expect(after.waiting.some((p) => p.proposalId === asked.proposalId)).toBe(false);
      // Decided once: a second yes makes no second account and shows no second password.
      const twice = await approve(brianToken).expect(400);
      expect(twice.body.code).toBe('INVALID_STATE');
      expect(twice.body).not.toHaveProperty('temporaryPassword');
      expect((await listed(brianToken)).items.filter((a) => a.email === eve.email)).toHaveLength(1);
    });

    it('is declined with a reason, or taken back by the one who asked', async () => {
      const amina = await make('amina3');
      const brian = await make('brian3');
      const [aminaToken, brianToken] = [await signIn(amina), await signIn(brian)];
      const fay = { email: `fay-${tag}@sbg.test`, name: `Fay ${tag}` };
      const ask = async () => (await http().post('/v1/sbg/operators/proposals').set(bearer(aminaToken)).send(fay).expect(201)).body.proposalId as string;
      const decline = (id: string, token: string, body: object) => http().post(`/v1/sbg/operators/proposals/${id}/decline`).set(bearer(token)).send(body);

      const first = await ask();
      const silent = await decline(first, brianToken, {}).expect(400);
      expect([silent.body.code, silent.body.params?.field]).toEqual(['FIELD_REQUIRED', 'reason']);
      await decline(first, setupKey, { reason: 'no' }).expect(403);
      await decline(first, brianToken, { reason: 'Nobody of that name works here.' }).expect(201, { ok: true });
      expect((await listed(aminaToken)).waiting.some((p) => p.proposalId === first)).toBe(false);
      expect((await http().post(`/v1/sbg/operators/proposals/${first}/approve`).set(bearer(brianToken)).expect(400)).body.code).toBe('INVALID_STATE');

      // The address is free again, and the one who asked takes their own back without a reason.
      const second = await ask();
      await decline(second, aminaToken, {}).expect(201, { ok: true });
      expect((await listed(brianToken)).waiting.some((p) => p.email === fay.email)).toBe(false);
      expect((await listed(brianToken)).items.some((a) => a.email === fay.email)).toBe(false);
    });

    it('outside a sandbox the setup key adds nobody once two people can sign in', async () => {
      const before = (await listed(setupKey)).items.length;
      expect(before).toBeGreaterThanOrEqual(2);
      const gus = { email: `gus-${tag}@sbg.test`, name: `Gus ${tag}` };
      const env = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'production';
      try {
        const refused = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send(gus).expect(403);
        expect(refused.body.detail ?? refused.body.message).toMatch(/Two members of staff add a new one/);
        expect(refused.body).not.toHaveProperty('temporaryPassword');
      } finally {
        if (env === undefined) delete process.env.GLOS_ENV;
        else process.env.GLOS_ENV = env;
      }
      const after = await listed(setupKey);
      expect(after.items.length).toBe(before);
      expect(after.items.some((a) => a.email === gus.email)).toBe(false);
    });
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
