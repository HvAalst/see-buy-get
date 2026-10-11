import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

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
});
