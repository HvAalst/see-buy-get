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
  const ALL = ['support', 'vetting', 'money', 'admin', 'languages'];
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

    // 2026-11-03 — the console's daily screens, split (the owner: "Daily screens now"): she opens each, and sees her
    // country's rows only; a record of no country she can tell answers as one that does not exist.
    for (const path of ['/v1/sbg/totes', '/v1/sbg/flags', '/v1/sbg/flag-cases', '/v1/sbg/paper-reports', '/v1/sbg/consignment-notes', '/v1/sbg/documents', '/v1/sbg/fleet/assignments']) {
      const res = await http().get(path).set(bearer(zara.token));
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
    const texts = (await http().get('/v1/sbg/documents').set(bearer(zara.token)).expect(200)).body.items as Array<{ country?: string }>;
    expect(texts.every((line) => line.country === 'ZM')).toBe(true);
    const textsEverywhere = (await http().get('/v1/sbg/documents').set(bearer(firstToken)).expect(200)).body.items as Array<{ country?: string }>;
    expect(textsEverywhere.some((line) => line.country !== 'ZM')).toBe(true);
    const cases = (await http().get('/v1/sbg/flag-cases').set(bearer(zara.token)).expect(200)).body as { items: unknown[]; waiting: number };
    expect(cases.waiting).toBeLessThanOrEqual((await http().get('/v1/sbg/flag-cases').set(bearer(firstToken)).expect(200)).body.waiting);
    await http().get('/v1/sbg/totes/NO-SUCH-BAG').set(bearer(zara.token)).expect(404);
    // A country's texts: her own country's draft, and no other.
    await http().get('/v1/sbg/documents/terms/draft').query({ country: 'MW' }).set(bearer(zara.token)).expect(404);
    // A file of every country's notes stays with somebody who works in every country.
    await http().get('/v1/sbg/consignment-notes/export').set(bearer(zara.token)).expect(403);

    // 2026-11-03 — a language reviewed per country (the owner: "languages are reviewed per country sbg company"): she writes
    // Zambia's version 2, the apps read it without signing in, and Kenya's is not hers to write.
    await http().put('/v1/sbg/words/sw/ZM/common.save').set(bearer(zara.token)).send({ text: 'Hifadhi hapa' }).expect(200);
    expect((await http().get('/v1/sbg/words/sw').query({ country: 'ZM' }).expect(200)).body.words).toMatchObject({ 'common.save': 'Hifadhi hapa' });
    expect((await http().get('/v1/sbg/words/sw').query({ country: 'KE' }).expect(200)).body.words['common.save']).toBeUndefined();
    await http().put('/v1/sbg/words/sw/KE/common.save').set(bearer(zara.token)).send({ text: 'Hifadhi' }).expect(404);
    expect((await http().get('/v1/sbg/words/sw/ZM/reviews').set(bearer(zara.token)).expect(200)).body.items[0]).toMatchObject({ key: 'common.save', by: `zara ${tag}`, history: [{ text: 'Hifadhi hapa' }] });

    // 2026-11-03 — a proofreader (the owner: "we have credits for the proofreader accounts"): the languages role, Ethiopia
    // only. She signs in, sees her own account, reviews Amharic for Ethiopia — and nothing else opens to her.
    const tsehay = await join({ ...person('tsehay', ['ET']), roles: ['languages'] }, second.token);
    expect((await http().get('/v1/sbg/operators/me').set(bearer(tsehay.token)).expect(200)).body).toMatchObject({ roles: ['languages'], countries: ['ET'] });
    await http().put('/v1/sbg/words/am/ET/common.save').set(bearer(tsehay.token)).send({ text: 'ያስቀምጡ' }).expect(200);
    await http().get('/v1/sbg/words/am/ET/reviews').set(bearer(tsehay.token)).expect(200);
    await http().put('/v1/sbg/words/am/KE/common.save').set(bearer(tsehay.token)).send({ text: 'x' }).expect(404);
    for (const path of ['/v1/sbg/documents', '/v1/sbg/totes', '/v1/sbg/flag-cases', '/v1/sbg/interest']) {
      const res = await http().get(path).set(bearer(tsehay.token));
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }

    // Colleagues: she sees those who work in Zambia, and those who work everywhere — and gives only Zambia.
    const staff = (await http().get('/v1/sbg/operators').set(bearer(zara.token)).expect(200)).body.items as Array<{ operatorId: string; countries: string[] }>;
    expect(staff.every((a) => a.countries.includes('ZM') || a.countries.includes('*'))).toBe(true);
    await http().post('/v1/sbg/operators/proposals').set(bearer(zara.token)).send(person('nina', ['MW'])).expect(403);
  });
});
