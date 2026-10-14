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

      // Approved: NO password is made. The one who approved is answered with whether the email went — and, on a
      // laptop where none leaves, the link that was written.
      const made = (await approve(brianToken).expect(201)).body;
      expect(made).toMatchObject({ email: eve.email, name: eve.name, sent: true });
      expect(made).not.toHaveProperty('temporaryPassword');
      expect(JSON.stringify(made)).not.toMatch(/"password"|hash|salt/i);
      const token = (made.link as string).split('#welcome=')[1];
      expect(token).toMatch(/^[\w-]{32}$/);
      const welcome = (body: object, path = '') => http().post(`/v1/sbg/operators/welcome${path}`).send(body);
      // Nothing signs in until its holder has chosen a password — and the link's token is not one.
      await http().post('/v1/sbg/operators/login').send({ email: eve.email, password: token }).expect(401);
      expect((await welcome({ token }, '/check').expect(201)).body).toEqual({ email: eve.email, name: eve.name });
      expect((await welcome({ token: 'A'.repeat(32) }, '/check').expect(400)).body.code).toBe('WINDOW_EXPIRED');
      expect((await welcome({ token, password: 'too-short' }).expect(400)).body.code).toBe('VALIDATION_FAILED');
      expect((await welcome({ token, password: eve.email }).expect(400)).body.code).toBe('PASSWORD_GUESSABLE');
      expect((await welcome({ token, password: 'eve-chose-this-one' }).expect(201)).body).toEqual({ ok: true, email: eve.email });
      const eveToken = await signIn({ email: eve.email, temporaryPassword: 'eve-chose-this-one' });
      expect((await http().get('/v1/sbg/operators/me').set(bearer(eveToken)).expect(200)).body.name).toBe(eve.name);
      // Once: whoever finds the email afterwards opens nothing with it.
      expect((await welcome({ token, password: 'somebody-else-chose-this' }).expect(400)).body.code).toBe('WINDOW_EXPIRED');
      expect((await welcome({ token }, '/check').expect(400)).body.code).toBe('WINDOW_EXPIRED');
      await http().post('/v1/sbg/operators/login').send({ email: eve.email, password: 'somebody-else-chose-this' }).expect(401);

      const after = await listed(brianToken);
      expect(after.items.some((a) => a.email === eve.email)).toBe(true);
      expect(after.waiting.some((p) => p.proposalId === asked.proposalId)).toBe(false);
      // Decided once: a second yes makes no second account and writes no second link.
      const twice = await approve(brianToken).expect(400);
      expect(twice.body.code).toBe('INVALID_STATE');
      expect(twice.body).not.toHaveProperty('link');
      expect((await listed(brianToken)).items.filter((a) => a.email === eve.email)).toHaveLength(1);
    });

    it('a new link is sent on asking, to the same address, and the one before it stops working', async () => {
      const amina = await make('amina4');
      const brian = await make('brian4');
      const [aminaToken, brianToken] = [await signIn(amina), await signIn(brian)];
      const hal = { email: `hal-${tag}@sbg.test`, name: `Hal ${tag}` };
      const id = (await http().post('/v1/sbg/operators/proposals').set(bearer(aminaToken)).send(hal).expect(201)).body.proposalId;
      const made = (await http().post(`/v1/sbg/operators/proposals/${id}/approve`).set(bearer(brianToken)).expect(201)).body;
      const row = async () => ((await listed(aminaToken)).items as Array<{ email: string; passwordLinkUntil?: string }>).find((a) => a.email === hal.email);
      expect((await row())?.passwordLinkUntil).toBe(made.passwordLinkUntil);

      const again = (await http().post(`/v1/sbg/operators/${made.operatorId}/welcome-link`).set(bearer(aminaToken)).expect(201)).body;
      expect(again).toMatchObject({ email: hal.email, sent: true });
      const [first, second] = [made.link, again.link].map((l: string) => l.split('#welcome=')[1]);
      expect(second).not.toBe(first);
      expect((await http().post('/v1/sbg/operators/welcome').send({ token: first, password: 'hal-chose-this-one' }).expect(400)).body.code).toBe('WINDOW_EXPIRED');
      await http().post('/v1/sbg/operators/welcome').send({ token: second, password: 'hal-chose-this-one' }).expect(201);
      expect(await row()).not.toHaveProperty('passwordLinkUntil');
      // Nothing to send to somebody who has chosen; and it is a door for staff only.
      expect((await http().post(`/v1/sbg/operators/${made.operatorId}/welcome-link`).set(bearer(aminaToken)).expect(400)).body.code).toBe('INVALID_STATE');
      await http().post(`/v1/sbg/operators/${made.operatorId}/welcome-link`).expect(401);
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

    it('two colleagues with the same name are two people: either can second the other, and neither their own', async () => {
      const sam = async (n: number) => (await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `sam${n}-${tag}@sbg.test`, name: `Sam ${tag}` }).expect(201)).body as { email: string; temporaryPassword: string };
      const [first, second] = [await signIn(await sam(1)), await signIn(await sam(2))];
      // A country nobody switched on: raising it is a change that needs a second person.
      const asked = (await http().post('/v1/sbg/presence/LV').set(bearer(first)).send({ level: 'matched', note: 'Riga partners ready' }).expect(201)).body;
      expect(asked.proposal).toMatchObject({ jurisdiction: 'LV', status: 'pending', proposedBy: `Sam ${tag}` });
      const id = asked.proposal.proposalId as string;
      const listedAs = async (token: string) => ((await http().get('/v1/sbg/presence/proposals').set(bearer(token)).expect(200)).body.items as Array<{ proposalId: string; mine?: boolean }>).find((p) => p.proposalId === id);
      // Each reader is told whose it is — by account, since the name says nothing here — and never which account.
      expect((await listedAs(first))?.mine).toBe(true);
      expect((await listedAs(second))?.mine).toBe(false);
      expect(JSON.stringify(await listedAs(second))).not.toMatch(/operator:|opr_/);

      const approve = (token: string) => http().post(`/v1/sbg/presence/proposals/${id}/approve`).set(bearer(token)).send({});
      expect((await approve(first).expect(403)).body.detail).toMatch(/different person must approve/);
      expect((await http().get('/v1/sbg/presence/LV').set(bearer(second)).expect(200)).body.level).toBe('observed');
      const done = (await approve(second).expect(201)).body;
      expect(done.presence).toMatchObject({ level: 'matched', setBy: `Sam ${tag}`, approvedBy: `Sam ${tag}` });
      // Put back: a lowering is applied at once, by one person.
      await http().post('/v1/sbg/presence/LV').set(bearer(first)).send({ level: 'observed', note: 'test over' }).expect(201);
    });

    it('outside a sandbox the setup key adds nobody while anybody can sign in, and takes no sign-in away without a day’s notice a member of staff can stop', async () => {
      const victim = await make('victim');
      const leaver = (await make('leaver')).operatorId;
      const witness = await signIn(await make('witness'));
      const before = (await listed(setupKey)).items.length;
      expect(before).toBeGreaterThanOrEqual(2);
      const gus = { email: `gus-${tag}@sbg.test`, name: `Gus ${tag}` };
      const env = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'production';
      const remove = () => http().delete(`/v1/sbg/operators/${victim.operatorId}`).set(bearer(setupKey));
      const row = async () => ((await listed(witness)).items as Array<{ operatorId?: string; email: string; removalFrom?: string }>).find((a) => a.email === victim.email);
      try {
        const refused = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send(gus).expect(403);
        expect(refused.body.detail ?? refused.body.message).toMatch(/only while nobody can sign in/);
        expect(refused.body).not.toHaveProperty('temporaryPassword');

        // Asked by the setup key: announced, and nothing is taken away.
        const asked = (await remove().expect(200)).body;
        expect(Date.parse(asked.removalFrom) - Date.now()).toBeGreaterThan(23.9 * 60 * 60 * 1000);
        expect(asked).not.toHaveProperty('revokedAt');
        expect((await row())?.removalFrom).toBe(asked.removalFrom);
        // Asked again before the day is out: refused, and still nothing is taken away.
        expect((await remove().expect(400)).body.code).toBe('INVALID_STATE');
        expect(await row()).toBeDefined();
        // Stopped by a member of staff — never by the setup key itself.
        await http().post(`/v1/sbg/operators/${victim.operatorId}/removal/stop`).set(bearer(setupKey)).expect(403);
        expect((await http().post(`/v1/sbg/operators/${victim.operatorId}/removal/stop`).set(bearer(witness)).expect(201)).body).not.toHaveProperty('removalFrom');
        expect(await row()).not.toHaveProperty('removalFrom');
        // A MEMBER OF STAFF still takes a colleague's sign-in away at once, here as anywhere: that is not the key's rule.
        expect((await http().delete(`/v1/sbg/operators/${leaver}`).set(bearer(witness)).expect(200)).body.revokedAt).toBeDefined();
        // And with no email leaving this server, a new account is not asked for at all: its link could not travel.
        const noMail = await http().post('/v1/sbg/operators/proposals').set(bearer(witness)).send(gus).expect(400);
        expect(noMail.body.detail ?? noMail.body.message).toMatch(/No email leaves this server yet/);
      } finally {
        if (env === undefined) delete process.env.GLOS_ENV;
        else process.env.GLOS_ENV = env;
      }
      // One fewer than before: the colleague a member of staff took away. Nobody the setup key touched, and nobody added.
      const after = await listed(setupKey);
      expect(after.items.length).toBe(before - 1);
      expect(after.items.some((a) => a.email === victim.email)).toBe(true);
      expect(after.items.some((a) => a.email === gus.email)).toBe(false);
      expect(after.waiting.some((p) => p.email === gus.email)).toBe(false);
      // A member of staff still takes a colleague's sign-in away at once.
      expect((await http().delete(`/v1/sbg/operators/${victim.operatorId}`).set(bearer(witness)).expect(200)).body.revokedAt).toBeDefined();
    });
  });

  it('closes every staff door outside the networks a deployment names — sign-in, the setup key, and tokens already issued', async () => {
    const dana = await make('dana');
    const token = (await http().post('/v1/sbg/operators/login').send({ email: dana.email, password: dana.temporaryPassword })).body.token.access_token;
    process.env.GLOS_STAFF_NETWORKS = '10.20.0.0/16';
    try {
      await http().post('/v1/sbg/operators/login').send({ email: dana.email, password: dana.temporaryPassword }).expect(403);
      await http().post('/v1/auth/token').send({ role: 'operator' }).expect(403);
      // The link a new member of staff is emailed opens nothing from anywhere else either.
      await http().post('/v1/sbg/operators/welcome/check').send({ token: 'A'.repeat(32) }).expect(403);
      await http().post('/v1/sbg/operators/welcome').send({ token: 'A'.repeat(32), password: 'a-long-chosen-password' }).expect(403);
      await http().get('/v1/sbg/operators').set('authorization', `Bearer ${token}`).expect(403);
      process.env.GLOS_STAFF_NETWORKS = '127.0.0.1, ::1';
      await http().get('/v1/sbg/operators').set('authorization', `Bearer ${token}`).expect(200);
    } finally {
      delete process.env.GLOS_STAFF_NETWORKS;
    }
  });
});
