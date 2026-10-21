import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { IS_PUBLIC_KEY } from '../src/foundation/auth/public.decorator';
import { STAFF_OUTSIDE_SANDBOX_KEY } from '../src/foundation/auth/engine-surface';
import { STAFF_AREAS } from '../src/foundation/auth/staff-areas.table';
import { routeKeyOf } from '../src/foundation/auth/staff-roles';

/**
 * STAFF HOLD ROLES (the user, round 38: "Four roles") — through the booted application. Every door a member of staff
 * passes is named in STAFF_AREAS for support, vetting, money, administration, any of them, or none; a named member of
 * staff passes only the doors of their roles. Roles are said when an account is asked for and approved by a second
 * person; a change of roles is asked for and approved the same way, and signs the person out.
 */
describe('staff hold roles, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tag = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let setupKey = '';
  const ALL = ['support', 'vetting', 'money', 'admin'];
  const person = (name: string, roles: string[] = ALL) => ({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}`, roles });
  const signIn = async (email: string, password: string) => (await http().post('/v1/sbg/operators/login').send({ email, password }).expect(201)).body.token.access_token as string;
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

  it('names every door a member of staff passes — and only doors there are', () => {
    const all = new Set<string>();
    const reachable = new Set<string>();
    for (const module of app.get(ModulesContainer).values()) {
      for (const { metatype } of module.controllers.values()) {
        if (!metatype) continue;
        const proto = metatype.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const h = proto[name];
          if (typeof h !== 'function') continue;
          const key = routeKeyOf(h, metatype);
          if (!key) continue;
          all.add(key);
          const pub = Reflect.getMetadata(IS_PUBLIC_KEY, h) ?? Reflect.getMetadata(IS_PUBLIC_KEY, metatype);
          const engine = Reflect.getMetadata(STAFF_OUTSIDE_SANDBOX_KEY, h) ?? Reflect.getMetadata(STAFF_OUTSIDE_SANDBOX_KEY, metatype);
          if (!pub || engine) reachable.add(key);
        }
      }
    }
    expect(reachable.size).toBeGreaterThan(700); // the application was read, not an empty list
    expect([...reachable].filter((k) => !(k in STAFF_AREAS))).toEqual([]);
    expect(Object.keys(STAFF_AREAS).filter((k) => !all.has(k))).toEqual([]);
  });

  it('a member of staff passes only the doors of their roles; a change of roles takes two, and signs them out', async () => {
    // The first, made by the setup key: every role, setting the installation up.
    const first = person('first');
    const made = (await http().post('/v1/sbg/operators').set(bearer(setupKey)).send(first).expect(201)).body;
    expect(made.roles).toEqual(ALL);
    const firstToken = await signIn(first.email, made.temporaryPassword);
    const approve = (id: string, token: string) => http().post(`/v1/sbg/operators/proposals/${id}/approve`).set(bearer(token));
    const welcomeAndSignIn = async (who: { email: string }, invited: { link: string }) => {
      await http().post('/v1/sbg/operators/welcome').send({ token: tokenOf(invited.link), password: `${who.email}-pw-9` }).expect(201);
      return signIn(who.email, `${who.email}-pw-9`);
    };

    // A second administrator: asked by the first, approved by the setup key while nobody else can sign in.
    const second = person('second');
    const secondAsked = (await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send(second).expect(201)).body;
    let secondToken = await welcomeAndSignIn(second,(await approve(secondAsked.proposalId, setupKey).expect(201)).body);

    // Roles are said when an account is asked for: none, or an unknown one, is refused.
    await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send({ ...person('nobody'), roles: [] }).expect(400);
    await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send({ ...person('nobody'), roles: ['boss'] }).expect(400);

    // Somebody for support only: asked by the first, approved by the second.
    const sam = person('sam', ['support']);
    const samAsked = (await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send(sam).expect(201)).body;
    expect(samAsked).toMatchObject({ roles: ['support'] });
    expect(samAsked.kind).toBeUndefined();
    let samToken = await welcomeAndSignIn(sam, (await approve(samAsked.proposalId, secondToken).expect(201)).body);

    // Their doors, and only theirs — each refusal says which role it is for.
    await http().get('/v1/sbg/ops/disposal-queue').set(bearer(samToken)).expect(200);
    expect((await http().get('/v1/sbg/operators/me').set(bearer(samToken)).expect(200)).body.roles).toEqual(['support']);
    await http().get('/v1/sbg/entities').set(bearer(samToken)).expect(200);
    expect((await http().get('/v1/rails/funding').set(bearer(samToken)).expect(403)).body.detail).toMatch(/money \(payouts and books\)/);
    expect((await http().get('/v1/sbg/agents/kyc-queue').set(bearer(samToken)).expect(403)).body.detail).toMatch(/vetting \(joining and papers\)/);
    expect((await http().get('/v1/sbg/operators').set(bearer(samToken)).expect(403)).body.detail).toMatch(/administration \(staff and settings\)/);
    // An administrator reaches the money's door too only if they hold money: the first holds every role.
    await http().get('/v1/rails/funding').set(bearer(firstToken)).expect(200);
    // The setup key on a laptop is no person: held to no roles.
    await http().get('/v1/rails/funding').set(bearer(setupKey)).expect(200);

    // A change of roles: asked by the first, said beside the roles held now; never the asker's to approve, never the key's.
    const samId = (await http().get('/v1/sbg/operators/me').set(bearer(samToken)).expect(200)).body.operatorId as string;
    await http().post(`/v1/sbg/operators/${samId}/roles`).set(bearer(samToken)).send({ roles: ['support', 'money'] }).expect(403); // not theirs: administration's
    await http().post(`/v1/sbg/operators/${samId}/roles`).set(bearer(firstToken)).send({ roles: ['support'] }).expect(400); // the roles they hold already
    const change = (await http().post(`/v1/sbg/operators/${samId}/roles`).set(bearer(firstToken)).send({ roles: ['money', 'support'] }).expect(201)).body;
    expect(change).toMatchObject({ kind: 'roles', roles: ['support', 'money'], rolesNow: ['support'], mine: true });
    await http().post(`/v1/sbg/operators/${samId}/roles`).set(bearer(secondToken)).send({ roles: ['vetting'] }).expect(409); // one waiting at a time
    await approve(change.proposalId, firstToken).expect(409);
    await approve(change.proposalId, setupKey).expect(403);
    // Until it is approved, nothing changed.
    await http().get('/v1/rails/funding').set(bearer(samToken)).expect(403);
    await approve(change.proposalId, secondToken).expect(201);
    // Signed out; signed in again, the new roles.
    await http().get('/v1/sbg/ops/disposal-queue').set(bearer(samToken)).expect(401);
    samToken = await signIn(sam.email, `${sam.email}-pw-9`);
    await http().get('/v1/rails/funding').set(bearer(samToken)).expect(200);
    expect((await http().get('/v1/sbg/operators').set(bearer(firstToken)).expect(200)).body.items.find((a: { email: string }) => a.email === sam.email).roles).toEqual(['support', 'money']);

    // A change of somebody's OWN roles is decided by others: the second may neither wave through nor stop a change of theirs.
    const third = person('third');
    const thirdAsked = (await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send(third).expect(201)).body;
    const thirdToken = await welcomeAndSignIn(third, (await approve(thirdAsked.proposalId, secondToken).expect(201)).body);
    const secondId = (await http().get('/v1/sbg/operators/me').set(bearer(secondToken)).expect(200)).body.operatorId as string;
    const drop = (await http().post(`/v1/sbg/operators/${secondId}/roles`).set(bearer(firstToken)).send({ roles: ['support', 'admin'] }).expect(201)).body;
    const seenBySecond = (await http().get('/v1/sbg/operators').set(bearer(secondToken)).expect(200)).body.waiting.find((p: { proposalId: string }) => p.proposalId === drop.proposalId);
    expect(seenBySecond).toMatchObject({ kind: 'roles', operatorId: secondId, aboutYou: true, rolesNow: ALL, roles: ['support', 'admin'] });
    expect((await approve(drop.proposalId, secondToken).expect(403)).body.detail).toMatch(/your own roles/);
    await http().post(`/v1/sbg/operators/proposals/${drop.proposalId}/decline`).set(bearer(secondToken)).send({ reason: 'I keep the money' }).expect(403);
    await approve(drop.proposalId, thirdToken).expect(201);
    secondToken = await signIn(second.email, `${second.email}-pw-9`);
    await http().get('/v1/rails/funding').set(bearer(secondToken)).expect(403);
  });
});
