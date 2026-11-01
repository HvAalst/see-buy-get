import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * STAFF SEPARATED BY COUNTRY (the owner, 2026-11-01: "everything needs to be separated by country … those assigned to a
 * country can not login to any other country without the right credentials") — through the booted application. A
 * colleague who works in Zambia reads Zambia's early sign-ups and companies and nothing of Malawi's; a Malawi record
 * answers as one that does not exist; the figures across every country are for somebody who works in every country,
 * whose own lists the console's picker can narrow to one.
 */
describe('staff separated by country, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tag = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const ALL = ['support', 'vetting', 'money', 'admin'];
  const person = (name: string, countries?: string[]) => ({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}`, roles: ALL, ...(countries ? { countries } : {}) });
  const signIn = async (email: string, password: string) => (await http().post('/v1/sbg/operators/login').send({ email, password }).expect(201)).body.token.access_token as string;
  const tokenOf = (link: string) => link.split('#welcome=')[1];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows a colleague the countries they work in, and nothing of the others', async () => {
    const setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token as string;
    const first = person('first');
    const made = (await http().post('/v1/sbg/operators').set(bearer(setupKey)).send(first).expect(201)).body;
    expect(made.countries).toEqual(['*']);
    const firstToken = await signIn(first.email, made.temporaryPassword);
    const join = async (who: ReturnType<typeof person>, approver: string) => {
      const asked = (await http().post('/v1/sbg/operators/proposals').set(bearer(firstToken)).send(who).expect(201)).body;
      const invited = (await http().post(`/v1/sbg/operators/proposals/${asked.proposalId}/approve`).set(bearer(approver)).expect(201)).body;
      await http().post('/v1/sbg/operators/welcome').send({ token: tokenOf(invited.link), password: `${who.email}-pw-9` }).expect(201);
      return { token: await signIn(who.email, `${who.email}-pw-9`), operatorId: invited.operatorId as string };
    };
    // A second with every country (the setup key approves while the first is alone), then one who works in Zambia only.
    const second = await join(person('second', ['*']), setupKey);
    const zara = await join(person('zara', ['ZM']), second.token);
    expect((await http().get('/v1/sbg/operators/me').set(bearer(zara.token)).expect(200)).body.countries).toEqual(['ZM']);

    // Early sign-ups in Zambia and in Malawi (the owner's first example).
    await http().post('/v1/sbg/countries/ZM/interest').send({ kind: 'shop', email: `chanda-${tag}@example.com`, message: 'A shop on Cairo Road' }).expect(201);
    await http().post('/v1/sbg/countries/MW/interest').send({ kind: 'carrier', email: `kondwani-${tag}@example.com`, message: 'Two lorries, Lilongwe to Blantyre' }).expect(201);
    const countriesIn = (body: { items: Array<{ country: string }> }) => body.items.map((g) => g.country).sort();
    expect(countriesIn((await http().get('/v1/sbg/interest').set(bearer(zara.token)).expect(200)).body)).toEqual(['ZM']);
    const everywhere = countriesIn((await http().get('/v1/sbg/interest').set(bearer(firstToken)).expect(200)).body);
    expect(everywhere).toEqual(expect.arrayContaining(['MW', 'ZM']));
    // The picker narrows the lists of somebody who works in every country — and picks nothing outside a colleague's own.
    expect(countriesIn((await http().get('/v1/sbg/interest').set(bearer(firstToken)).set('x-sbg-country', 'mw').expect(200)).body)).toEqual(['MW']);
    expect(countriesIn((await http().get('/v1/sbg/interest').set(bearer(zara.token)).set('x-sbg-country', 'MW').expect(200)).body)).toEqual(['ZM']);

    // Companies: Zambia's is hers to read; Malawi's answers as one that does not exist.
    const zm = (await http().post('/v1/sbg/entities').set(bearer(firstToken)).send({ kind: 'sister', jurisdiction: 'ZM', name: `SeeBuyGet Zambia ${tag}` }).expect(201)).body;
    const mw = (await http().post('/v1/sbg/entities').set(bearer(firstToken)).send({ kind: 'sister', jurisdiction: 'MW', name: `SeeBuyGet Malawi ${tag}` }).expect(201)).body;
    const theirs = (await http().get('/v1/sbg/entities').set(bearer(zara.token)).expect(200)).body as Array<{ entityId: string; jurisdiction?: string }>;
    expect(theirs.map((e) => e.entityId)).toContain(zm.entityId);
    expect(theirs.map((e) => e.entityId)).not.toContain(mw.entityId);
    expect(theirs.every((e) => e.jurisdiction === 'ZM')).toBe(true);
    await http().get(`/v1/sbg/entities/${zm.entityId}/record`).set(bearer(zara.token)).expect(200);
    const hidden = await http().get(`/v1/sbg/entities/${mw.entityId}/record`).set(bearer(zara.token)).expect(404);
    expect(hidden.body.detail).toBe('Not found');
    await http().get(`/v1/sbg/entities/${mw.entityId}/record`).set(bearer(firstToken)).expect(200);
    // What staff opened says in which country — and can be read for one country.
    const opened = (await http().get('/v1/sbg/staff-reads').query({ country: 'ZM' }).set(bearer(firstToken)).expect(200)).body.items as Array<{ byName: string; record: string; countries?: string[] }>;
    expect(opened.find((r) => r.byName === `zara ${tag}` && r.record === zm.entityId)?.countries).toEqual(['ZM']);
    expect(opened.some((r) => r.record === mw.entityId)).toBe(false);
    // Making a company is not yet split by country, so it is for somebody who works in every country.
    await http().post('/v1/sbg/entities').set(bearer(zara.token)).send({ kind: 'sister', jurisdiction: 'ZM', name: `Another ${tag}` }).expect(403);

    // A country's standing, by its code.
    await http().get('/v1/sbg/presence/ZM').set(bearer(zara.token)).expect(200);
    await http().get('/v1/sbg/presence/MW').set(bearer(zara.token)).expect(404);

    // The figures across every country are the network's as a whole.
    expect((await http().get('/v1/sbg/dashboard').set(bearer(zara.token)).expect(403)).body.detail).toMatch(/work in every country/);
    await http().get('/v1/sbg/dashboard').set(bearer(firstToken)).expect(200);

    // Colleagues: she sees those who work in Zambia, and those who work everywhere — and gives only Zambia.
    const staff = (await http().get('/v1/sbg/operators').set(bearer(zara.token)).expect(200)).body.items as Array<{ operatorId: string; countries: string[] }>;
    expect(staff.every((a) => a.countries.includes('ZM') || a.countries.includes('*'))).toBe(true);
    await http().post('/v1/sbg/operators/proposals').set(bearer(zara.token)).send(person('nina', ['MW'])).expect(403);
  });
});
