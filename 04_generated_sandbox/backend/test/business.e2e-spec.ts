import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * B1 — A CUSTOMER'S BUSINESS, OVER THE WIRE: as the guards, the route roles and the live membership check see it.
 *
 * The user, 2026-10-04: a separate business app for shippers and expeditors, and we never handle their payments. The
 * things that must hold on the wire are the access ones: a business sign-in reaches its own work and nothing of ours,
 * a viewer reads, somebody taken out is out on their next request, and nobody unchecked is shown to strangers.
 */
describe('a customer’s business, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A person through the ordinary phone door: a code to the phone, a PIN, a confirmed recovery email. */
  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2519${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `biz-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '4826', email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token };
  }

  /** A member of staff with a named sign-in, so two approvals are two people. */
  async function aStaff(name: string): Promise<string> {
    const made = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    const login = await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201);
    return login.body.token.access_token;
  }

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

  it('is set up by a person, works on its own imports, and reaches nothing of ours', async () => {
    const owner = await aPerson();
    const created = await http()
      .post('/v1/sbg/business')
      .set(bearer(owner.token))
      .send({ name: `Abebe Import ${tag}`, country: 'ET', registrationNo: `REG-${tag}`, activities: ['importer'], yourName: 'Abebe Kebede' })
      .expect(201);
    const biz = created.body.token.access_token;
    const entityId = created.body.business.entityId;
    expect(created.body.business.you.role).toBe('owner');

    // Its own work, on the routes importers always used.
    const imp = await http().post('/v1/sbg/imports').set(bearer(biz)).send({ goodsDescription: 'Coffee roaster', originCountry: 'NL', destCountry: 'ET', destPort: 'Modjo dry port' }).expect(201);
    expect(imp.body.importerEntityId).toBe(entityId);
    await http().get('/v1/sbg/imports').set(bearer(biz)).expect(200);
    await http().get(`/v1/sbg/entities/${entityId}/record`).set(bearer(biz)).expect(200);

    // Nothing of ours: no prices, no books, no logins minted for the company, no other company's record.
    await http().get('/v1/sbg/entities/sbg-et/pricing').set(bearer(biz)).expect(403);
    await http().get(`/v1/sbg/entities/${entityId}/books`).set(bearer(biz)).expect(403);
    await http().post(`/v1/sbg/entities/${entityId}/admins`).set(bearer(biz)).send({ email: 'x@example.com', name: 'X' }).expect(403);
    await http().get('/v1/sbg/entities/sbg-et/record').set(bearer(biz)).expect(404);
    // And a consumer token is not a business sign-in.
    await http().get('/v1/sbg/business/me').set(bearer(owner.token)).expect(403);

    // Staff see it in their own Businesses list — never among OUR companies, and never with an email-and-password
    // login of the kind our companies' administrators have: its people are its owners' to add.
    const ours = await http().get('/v1/sbg/entities').set(bearer(setupKey)).expect(200);
    expect(ours.body.map((e: { entityId: string }) => e.entityId)).not.toContain(entityId);
    const theirs = await http().get('/v1/sbg/businesses').set(bearer(setupKey)).expect(200);
    expect(theirs.body.items.map((e: { entityId: string }) => e.entityId)).toContain(entityId);
    await http().post(`/v1/sbg/entities/${entityId}/admins`).set(bearer(setupKey)).send({ email: `x-${tag}@example.com`, name: 'X' }).expect(400);
  });

  it('lets a viewer read and leave, and takes somebody out on their next request', async () => {
    const owner = await aPerson();
    const created = await http()
      .post('/v1/sbg/business')
      .set(bearer(owner.token))
      .send({ name: `Selam Freight ${tag}`, country: 'ET', registrationNo: `REG2-${tag}`, activities: ['shipper', 'expeditor'], yourName: 'Selam Owner' })
      .expect(201);
    const ownerBiz = created.body.token.access_token;
    const entityId = created.body.business.entityId;

    const viewer = await aPerson();
    const booker = await aPerson();
    await http().post('/v1/sbg/business/me/members').set(bearer(ownerBiz)).send({ phone: viewer.phone, name: 'Vera Viewer', role: 'viewer' }).expect(201);
    const bookerRow = await http().post('/v1/sbg/business/me/members').set(bearer(ownerBiz)).send({ phone: booker.phone, name: 'Bekele Booker', role: 'booker' }).expect(201);

    const join = async (who: { token: string }) => {
      const mine = await http().get('/v1/sbg/business/mine').set(bearer(who.token)).expect(200);
      const invite = mine.body.items.find((i: { entityId: string }) => i.entityId === entityId);
      expect(invite.state).toBe('invited');
      // Not in until they say yes.
      await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(404);
      await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(who.token)).expect(201);
      return (await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(201)).body.token.access_token as string;
    };
    const viewerBiz = await join(viewer);
    const bookerBiz = await join(booker);

    // A viewer reads, and changes nothing — on the import routes as much as on the business's own.
    await http().get('/v1/sbg/imports').set(bearer(viewerBiz)).expect(200);
    await http().post('/v1/sbg/imports').set(bearer(viewerBiz)).send({ goodsDescription: 'x', originCountry: 'NL', destCountry: 'ET', destPort: 'Modjo' }).expect(403);
    // Only an owner manages people.
    await http().post('/v1/sbg/business/me/members').set(bearer(bookerBiz)).send({ phone: '+251911000999', name: 'X', role: 'owner' }).expect(403);

    // Taken out: the same session, refused on the next request.
    await http().post('/v1/sbg/imports').set(bearer(bookerBiz)).send({ goodsDescription: 'Spare parts', originCountry: 'CN', destCountry: 'ET', destPort: 'Modjo' }).expect(201);
    await http().delete(`/v1/sbg/business/me/members/${bookerRow.body.memberId}`).set(bearer(ownerBiz)).expect(200);
    await http().get('/v1/sbg/imports').set(bearer(bookerBiz)).expect(403);

    // A viewer may leave: that changes only their own place.
    const me = await http().get('/v1/sbg/business/me').set(bearer(viewerBiz)).expect(200);
    await http().delete(`/v1/sbg/business/me/members/${me.body.you.memberId}`).set(bearer(viewerBiz)).expect(200);
    await http().get('/v1/sbg/business/me').set(bearer(viewerBiz)).expect(403);
  });

  it('is checked by two members of staff, and only then given a public page and a place in the agent finder', async () => {
    const owner = await aPerson();
    const name = `Djibouti Clearing ${tag}`;
    const created = await http()
      .post('/v1/sbg/business')
      .set(bearer(owner.token))
      .send({ name, country: 'ET', registrationNo: `REG3-${tag}`, activities: ['clearing_agent'], yourName: 'Dawit Agent' })
      .expect(201);
    const biz = created.body.token.access_token;
    const entityId = created.body.business.entityId;
    await http().post(`/v1/sbg/entities/${entityId}/clearance-offer`).set(bearer(biz)).send({ specialisms: ['sea_container'], places: ['Djibouti'] }).expect(201);

    const findable = async () => (await http().get('/v1/sbg/agents/find').query({ country: 'ET' }).expect(200)).body.items.some((a: { entityId: string }) => a.entityId === entityId);
    // Unchecked, it advertises to nobody: a name is only its own claim until somebody has looked. Not in the finder, and
    // no public page — the profile route sweeps handles before it answers, and the sweep passes an unchecked business by.
    expect(await findable()).toBe(false);
    await http().get(`/v1/sbg/profiles/djibouti-clearing-${tag}`).expect(404);
    await http().post('/v1/sbg/business/me/check').set(bearer(biz)).expect(400);

    const docs: string[] = [];
    for (const kind of ['certificate_of_incorporation', 'representative_id']) {
      const up = await http().post(`/v1/sbg/entities/${entityId}/documents`).set(bearer(biz)).send({ kind, title: kind, dataUrl: pdf(`${tag}-${kind}`) }).expect(201);
      docs.push(up.body.documentId);
    }
    expect((await http().post('/v1/sbg/business/me/check').set(bearer(biz)).expect(201)).body.check.state).toBe('asked');

    const amina = await aStaff('amina');
    const brian = await aStaff('brian');
    // A business sign-in is not staff.
    await http().post(`/v1/sbg/businesses/${entityId}/approve`).set(bearer(biz)).send({}).expect(403);
    for (const id of docs) await http().post(`/v1/sbg/entities/${entityId}/documents/${id}/verify`).set(bearer(amina)).send({}).expect(201);
    expect((await http().post(`/v1/sbg/businesses/${entityId}/approve`).set(bearer(amina)).send({}).expect(201)).body.state).toBe('checking');
    await http().post(`/v1/sbg/businesses/${entityId}/approve`).set(bearer(amina)).send({}).expect(409);
    const done = await http().post(`/v1/sbg/businesses/${entityId}/approve`).set(bearer(brian)).send({}).expect(201);
    expect(done.body).toMatchObject({ state: 'verified', firstBy: `amina ${tag}`, verifiedBy: `brian ${tag}` });

    expect(await findable()).toBe(true);
    const me = await http().get('/v1/sbg/business/me').set(bearer(biz)).expect(200);
    expect(me.body.check.state).toBe('verified');
    await http().get(`/v1/sbg/profiles/${me.body.handle ?? 'missing'}`).expect(200);
  });
});
