import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { SETUP_KEY_KEY } from '../src/foundation/auth/setup-key';
import { DidService } from '../src/foundation/did/did.service';

/**
 * A NEW INSTALLATION'S FIRST DAYS, OVER THE WIRE — from nobody on staff to three people.
 *
 * The setup key makes the first account. The second is asked for by the first and approved by the setup key, because
 * there is nobody else to be the second person. From the third on, a colleague is. And nobody but its holder ever
 * holds a way into an account: the new person chooses their password by a link sent to their own address.
 *
 * Its own file, and so its own server: every other file here already has a staff list.
 */
describe('a new installation’s first days', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const person = (name: string) => ({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` });
  const signIn = async (email: string, password: string) => (await http().post('/v1/sbg/operators/login').send({ email, password }).expect(201)).body.token.access_token as string;
  const listed = async (token: string) => (await http().get('/v1/sbg/operators').set(bearer(token)).expect(200)).body as { items: Array<{ operatorId: string; email: string; passwordLinkUntil?: string }>; waiting: Array<{ proposalId: string; email: string; mine: boolean; forSetupKey: boolean }> };
  const tokenOf = (link: string) => link.split('#welcome=')[1];

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
    await app?.close();
  });

  it('goes from nobody to three: the key makes the first, seconds the second, and is nobody’s second after that', async () => {
    expect(await listed(setupKey)).toEqual({ items: [], waiting: [] });

    // THE FIRST: made by the setup key alone, with a password shown once to whoever holds the key.
    const first = person('first');
    const made = (await http().post('/v1/sbg/operators').set(bearer(setupKey)).send(first).expect(201)).body;
    expect(made.temporaryPassword).toHaveLength(12);
    const firstToken = await signIn(first.email, made.temporaryPassword);

    // THE SECOND: nobody else can sign in, so the first asks and the setup key approves.
    const second = person('second');
    const asked = (await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send(second).expect(201)).body;
    expect(asked).toMatchObject({ email: second.email, mine: true, forSetupKey: true });
    expect((await listed(setupKey)).waiting).toEqual([expect.objectContaining({ proposalId: asked.proposalId, mine: false, forSetupKey: true })]);
    const approve = (id: string, token: string) => http().post(`/v1/sbg/operators/proposals/${id}/approve`).set(bearer(token));
    // Never their own second.
    await approve(asked.proposalId, firstToken).expect(409);
    const invited = (await approve(asked.proposalId, setupKey).expect(201)).body;
    expect(invited).toMatchObject({ email: second.email, sent: true });
    expect(invited).not.toHaveProperty('temporaryPassword');
    // On the list, and not yet somebody who can sign in.
    expect((await listed(firstToken)).items.find((a) => a.email === second.email)?.passwordLinkUntil).toBe(invited.passwordLinkUntil);

    // Asked for and not yet in: still nobody's second. A THIRD asked for now is the setup key's to approve as well.
    const third = person('third');
    const wanted = (await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send(third).expect(201)).body;
    expect(wanted.forSetupKey).toBe(true);

    // The second chooses their own password by the link, and signs in with it.
    await http().post('/v1/sbg/operators/welcome').send({ token: tokenOf(invited.link), password: 'second-chose-this-one' }).expect(201);
    const secondToken = await signIn(second.email, 'second-chose-this-one');

    // TWO CAN SIGN IN: the setup key is nobody's second any more — a colleague is.
    expect((await listed(secondToken)).waiting).toEqual([expect.objectContaining({ proposalId: wanted.proposalId, mine: false, forSetupKey: false })]);
    const refused = await approve(wanted.proposalId, setupKey).expect(403);
    expect(refused.body.detail ?? refused.body.message).toMatch(/The setup key approves only for somebody who is the only one able to sign in/);
    expect((await listed(firstToken)).items.some((a) => a.email === third.email)).toBe(false);
    expect((await approve(wanted.proposalId, secondToken).expect(201)).body).toMatchObject({ email: third.email, sent: true });
    expect((await listed(firstToken)).items.map((a) => a.email)).toEqual([first.email, second.email, third.email]);
  });

  /**
   * The user, 2026-10-11: "client secret should not act as participant outside sandbox." It could ask for a token as
   * any shop, driver or company; and its own operator token could stand in for any of them, and read everything.
   */
  describe('outside a sandbox the client secret acts for nobody', () => {
    const REFUSED = /The setup key only sets network staff up\. Sign in with a staff account of your own for everything else\./;
    const said = (r: { body: { detail?: string; message?: string } }) => r.body.detail ?? r.body.message ?? '';
    const env = process.env.GLOS_ENV;
    const asProduction = async <T>(doing: () => Promise<T>): Promise<T> => {
      process.env.GLOS_ENV = 'production';
      try {
        return await doing();
      } finally {
        if (env === undefined) delete process.env.GLOS_ENV;
        else process.env.GLOS_ENV = env;
      }
    };
    // What a member of staff reads and does every day: labelled for operators, for several roles, and not at all.
    const ELSEWHERE: Array<['get' | 'post', string]> = [
      ['get', '/v1/sbg/presence/proposals'],
      ['get', '/v1/sbg/connections'],
      ['get', '/v1/sbg/fleet/managers'],
      ['get', '/v1/sbg/border-rules'],
      ['get', '/v1/sbg/presence/KE'],
      ['post', '/v1/sbg/presence/LV'],
      ['post', '/v1/sbg/operators/proposals'],
    ];

    it('its token reaches the staff set-up and is refused everywhere else — which a member of staff is not', async () => {
      const amina = person('amina');
      const made = (await http().post('/v1/sbg/operators').set(bearer(setupKey)).send(amina).expect(201)).body;
      const staffToken = await signIn(amina.email, made.temporaryPassword);
      // On a laptop the setup key reads and does all of it: that is the seeder, and the tests.
      for (const [method, path] of ELSEWHERE.filter(([m]) => m === 'get')) expect([path, (await http()[method](path).set(bearer(setupKey))).status]).toEqual([path, 200]);
      expect(await listed(setupKey)).not.toHaveProperty('setupOnly');

      await asProduction(async () => {
        // The one screen it has: who is on staff. And it is told that is all.
        const list = (await http().get('/v1/sbg/operators').set(bearer(setupKey)).expect(200)).body;
        expect(list.setupOnly).toBe(true);
        expect(list.items.length).toBeGreaterThanOrEqual(4);
        for (const [method, path] of ELSEWHERE) {
          const refused = await http()[method](path).set(bearer(setupKey)).send({ level: 'matched', email: 'x@sbg.test', name: 'X' });
          expect([path, refused.status, REFUSED.test(said(refused))]).toEqual([path, 403, true]);
        }
        // Nothing was changed by any of it.
        expect((await http().get('/v1/sbg/presence/LV').set(bearer(staffToken)).expect(200)).body.level).toBe('observed');
        // A member of staff, on the same server at the same moment, is refused none of these for being who they are.
        for (const [method, path] of ELSEWHERE.filter(([m]) => m === 'get')) expect([path, (await http()[method](path).set(bearer(staffToken))).status]).toEqual([path, 200]);
        expect((await http().get('/v1/sbg/operators').set(bearer(staffToken)).expect(200)).body).not.toHaveProperty('setupOnly');
      });
    });

    it('nothing is given a participant’s token but that participant signing in', async () => {
      const shop = { role: 'agent', did: app.get(DidService).generate(`pudo-agent:+2547009${tag}`).id };
      // On a laptop the seeder acts as the shops and drivers it made.
      expect((await http().post('/v1/auth/token').send(shop).expect(201)).body.access_token).toBeTruthy();
      await asProduction(async () => {
        for (const body of [shop, { ...shop, clientSecret: 'whatever-is-presented' }, { role: 'driver', did: shop.did, tenant: 'did:glos:a-fleet' }]) {
          const refused = await http().post('/v1/auth/token').send(body).expect(403);
          expect(said(refused)).toMatch(/Nobody is signed in as somebody else here/);
          expect(refused.body).not.toHaveProperty('access_token');
        }
        // Nor a plain machine token: nobody at all, but "a valid token" — which is all a great many routes ask for.
        for (const body of [{ sub: 'a-script', type: 'client_credentials' }, { sub: 'a-script', type: 'client_credentials', clientSecret: 'whatever-is-presented' }]) {
          const refused = await http().post('/v1/auth/token').send(body).expect(403);
          expect(said(refused)).toMatch(/the client secret gets the setup key’s token and no other/);
          expect(refused.body).not.toHaveProperty('access_token');
        }
      });
      // On a laptop a script still gets one.
      expect((await http().post('/v1/auth/token').send({ sub: 'a-script', type: 'client_credentials' }).expect(201)).body.access_token).toBeTruthy();
    });

    it('exactly four routes are marked for the setup key, and all four set network staff up', () => {
      const VERB: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.DELETE]: 'DELETE', [RequestMethod.PUT]: 'PUT', [RequestMethod.PATCH]: 'PATCH' };
      const marked: string[] = [];
      let routes = 0;
      for (const module of app.get(ModulesContainer).values()) {
        for (const controller of module.controllers.values()) {
          const type = controller.metatype as { prototype: Record<string, unknown> };
          // Never on a whole controller: a route added to it later would be open to the key without anybody deciding so.
          expect([type.constructor?.name, Reflect.getMetadata(SETUP_KEY_KEY, type)]).toEqual([type.constructor?.name, undefined]);
          const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
          for (const name of Object.getOwnPropertyNames(type.prototype)) {
            const handler = type.prototype[name];
            if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
            routes += 1;
            if (Reflect.getMetadata(SETUP_KEY_KEY, handler)) marked.push(`${VERB[Reflect.getMetadata(METHOD_METADATA, handler) as number]} ${base}/${String(Reflect.getMetadata(PATH_METADATA, handler))}`);
          }
        }
      }
      // It read the real application: hundreds of routes, not a list that could have been empty.
      expect(routes).toBeGreaterThan(600);
      expect(marked.sort()).toEqual(['DELETE sbg/operators/:operatorId', 'GET sbg/operators', 'POST sbg/operators', 'POST sbg/operators/proposals/:proposalId/approve']);
    });
  });
});
