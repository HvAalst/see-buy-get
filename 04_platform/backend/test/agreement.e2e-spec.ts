import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * EVERY SIGN-UP AGREES, AND THE TEXT IS STAFF'S, over the wire (the user, 2026-10-25: "every sign up needs an agreement
 * of terms of use, use of data, storage of data, cookie statement, etc." — "the text can be drafted and inserted but
 * need cms from the staff console and it's usual track of changes timestamped etc.").
 *
 * A fresh server reads version 1 of each document, inserted with it. Nobody signs up without agreeing — a person, a
 * shop, a store — and a refusal costs them nothing. Two members of staff publish a new version; when it asks everybody
 * to agree again, somebody signed in is asked, and agrees, in their app. The steps run in order.
 */
describe('agreeing to the terms, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tag = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

  const must = async (call: request.Test, status = 201): Promise<any> => {
    const r = await call;
    const asked = (r as unknown as { request: { method: string; url: string } }).request;
    if (r.status !== status) throw new Error(`${asked.method} ${asked.url.replace(/^https?:\/\/[^/]+/, '')} answered ${r.status}, wanted ${status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    return r.body;
  };
  const refused = async (call: request.Test) => {
    const r = await call;
    return [r.status, r.body.code, r.body.params?.field] as const;
  };

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

  it('1 · anybody reads what a sign-up agrees to: version 1 of each document, inserted with the system', async () => {
    const set = (await must(http().get('/v1/sbg/agreement'), 200)).documents as Array<{ kind: string; number: number; since: number; path: string }>;
    expect(set.map((d) => [d.kind, d.number, d.since, d.path])).toEqual([
      ['terms', 1, 1, '/terms/'],
      ['privacy', 1, 1, '/privacy/'],
      ['cookies', 1, 1, '/cookies/'],
    ]);
    const terms = await must(http().get('/v1/sbg/documents/terms'), 200);
    expect(terms).toMatchObject({ kind: 'terms', number: 1, title: 'Terms of use' });
    expect(terms.body).toContain('## Who you agree with');
    expect(terms).not.toHaveProperty('writtenBy');
    expect((await must(http().get('/v1/sbg/documents/cookies/history'), 200)).items).toHaveLength(1);
    expect((await refused(http().get('/v1/sbg/documents/contract')))[0]).toBe(404);
  });

  let person = '';
  let duka = '';
  const PHONE = `+2547${tag}1`;

  /** What somebody's bell says about the documents they agreed to, newest first. */
  const bell = async (token: string) =>
    ((await must(http().get('/v1/sbg/notifications/inbox').set(bearer(token)), 200)).items as Array<{ kind: string; title: string; body: string; link?: string; data?: Record<string, unknown> }>).filter((n) => n.kind === 'terms_updated');

  it('2 · nobody signs up without agreeing — and a refusal costs them nothing: the same confirmed number agrees and goes on', async () => {
    const code = (await must(http().post('/v1/sbg/auth/phone/request').send({ phone: PHONE }))).code as string;
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone: PHONE, code }));
    const email = `agree-${tag}@sbg.test`;
    const mailed = (await must(http().post('/v1/sbg/identity/email/request').send({ email }))).code as string;
    const body = { phone: PHONE, pin: '48261', email, emailCode: mailed };
    expect(await refused(http().post('/v1/sbg/identity/enroll').send(body))).toEqual([400, 'AGREEMENT_REQUIRED', 'agreement']);
    // A version that does not exist is not one anybody read.
    expect(await refused(http().post('/v1/sbg/identity/enroll').send({ ...body, agreement: { versions: { terms: 2, privacy: 1, cookies: 1 } } }))).toEqual([400, 'AGREEMENT_REQUIRED', 'agreement']);
    const enrolled = await must(http().post('/v1/sbg/identity/enroll').send({ ...body, ...AGREED }));
    person = enrolled.token.access_token;
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(person)), 200)).toMatchObject({ needed: false, agreed: { terms: 1, privacy: 1, cookies: 1 } });

    // A shop and a store are refused the same way, before anything of theirs is made.
    const shopPhone = `+2547${tag}2`;
    const shopCode = (await must(http().post('/v1/sbg/auth/phone/request').send({ phone: shopPhone }))).code as string;
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone: shopPhone, code: shopCode }));
    const shop = {
      role: 'pudo',
      email: `duka-${tag}@sbg.test`,
      password: `duka-${tag}-keeps-this-7`,
      phone: shopPhone,
      profile: { agent: { shopName: `Duka ${tag}`, zone: `Z${tag}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '08:00', close: '18:00' }])), fullName: 'Mama Duka', nationalId: `ID-${tag}`, mobile: shopPhone, deviceImei: `IMEI-${tag}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } } },
    };
    expect(await refused(http().post('/v1/sbg/auth/signup').send(shop))).toEqual([400, 'AGREEMENT_REQUIRED', 'agreement']);
    const made = await must(http().post('/v1/sbg/auth/signup').send({ ...shop, ...AGREED }));
    duka = made.token.access_token;
    // The shop stands in Kenya: what it agreed to is kept for Kenya.
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(duka)), 200)).toMatchObject({ needed: false, country: 'KE' });
    expect(await refused(http().post('/v1/sbg/vendors').send({ name: `Store ${tag}` }))).toEqual([400, 'AGREEMENT_REQUIRED', 'agreement']);
    await must(http().post('/v1/sbg/vendors').send({ ...AGREED, name: `Store ${tag}` }));
  });

  let amina = '';
  let brian = '';

  it('3 · two members of staff: one made by the setup key, the second asked for by the first', async () => {
    const setupKey = (await must(http().post('/v1/auth/token').send({ role: 'operator' }))).access_token as string;
    const signIn = async (email: string, password: string) => (await must(http().post('/v1/sbg/operators/login').send({ email, password }))).token.access_token as string;
    const first = { email: `amina-${tag}@sbg.test`, name: `Amina ${tag}` };
    const made = await must(http().post('/v1/sbg/operators').set(bearer(setupKey)).send(first));
    amina = await signIn(first.email, made.temporaryPassword);
    const second = { email: `brian-${tag}@sbg.test`, name: `Brian ${tag}`, roles: ['support', 'vetting', 'money', 'admin'] };
    const asked = await must(http().post('/v1/sbg/operators/proposals').set(bearer(amina)).send(second));
    const invited = await must(http().post(`/v1/sbg/operators/proposals/${asked.proposalId}/approve`).set(bearer(setupKey)));
    await must(http().post('/v1/sbg/operators/welcome').send({ token: String(invited.link).split('#welcome=')[1], password: `brian-${tag}-chose-this-9` }));
    brian = await signIn(second.email, `brian-${tag}-chose-this-9`);
    // Staff are SeeBuyGet's own, not somebody signing up to it: nothing is asked of them here.
    expect(await refused(http().get('/v1/sbg/agreement/mine').set(bearer(amina)))).toEqual([403, 'FORBIDDEN', undefined]);
  });

  it('4 · a new version takes two people, keeps every earlier one, and when it asks again, the person signed in agrees in their app', async () => {
    const terms = await must(http().get('/v1/sbg/documents/terms'), 200);
    const proposal = await must(
      http()
        .post('/v1/sbg/documents/terms/versions')
        .set(bearer(amina))
        .send({ title: terms.title, body: `${terms.body}\n\n## Something new\n\n- A new rule for everybody.`, changeNote: 'A new rule', askAgain: true }),
    );
    expect(proposal).toMatchObject({ status: 'proposed', mine: true });
    // Nothing changes until a second person publishes it; the writer cannot.
    expect((await must(http().get('/v1/sbg/documents/terms'), 200)).number).toBe(1);
    expect((await refused(http().post(`/v1/sbg/documents/versions/${proposal.versionId}/publish`).set(bearer(amina)).send({})))[0]).toBe(403);
    const published = await must(http().post(`/v1/sbg/documents/versions/${proposal.versionId}/publish`).set(bearer(brian)).send({}));
    expect(published).toMatchObject({ status: 'published', number: 2 });

    // Every version, kept, with who wrote and published it — for staff.
    const staffView = (await must(http().get('/v1/sbg/documents').set(bearer(brian)), 200)).items.find((i: { kind: string }) => i.kind === 'terms');
    expect(staffView.current).toMatchObject({ number: 2, decidedBy: expect.stringContaining('Brian') });
    expect(staffView.versions.map((v: { number?: number }) => v.number)).toEqual([2, 1]);
    expect(staffView.versions.find((v: { number?: number }) => v.number === 1).agreed).toBeGreaterThanOrEqual(1);
    // And publicly: the history, and the old text word for word.
    expect((await must(http().get('/v1/sbg/documents/terms/history'), 200)).items.map((l: { number: number }) => l.number)).toEqual([2, 1]);
    expect((await must(http().get('/v1/sbg/documents/terms/versions/1'), 200)).body).toBe(terms.body);

    // Everybody with an account is told, in the bell of the app they use: what changed, and that they will be asked.
    for (const token of [person, duka]) {
      expect((await bell(token))[0]).toMatchObject({ title: 'Terms of use: a new version', body: 'A new rule. You are asked to agree to it the next time you open the app.', link: '/terms/', data: { key: 'terms', number: 2, askAgain: true } });
    }

    // The person who agreed to version 1 is asked again — and the old version will not do.
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(person)), 200)).toMatchObject({ needed: true });
    expect(await refused(http().post('/v1/sbg/agreement/mine').set(bearer(person)).send(AGREED.agreement))).toEqual([400, 'AGREEMENT_REQUIRED', 'agreement']);
    const now = await must(http().post('/v1/sbg/agreement/mine').set(bearer(person)).send({ versions: { ...AGREED.agreement.versions, terms: 2 } }));
    expect(now).toMatchObject({ needed: false, agreed: { terms: 2 } });
    // A sign-up from here on agrees to version 2.
    expect(await refused(http().post('/v1/sbg/vendors').send({ ...AGREED, name: `Late store ${tag}` }))).toEqual([400, 'AGREEMENT_REQUIRED', 'agreement']);
  });

  it('5 · a version that asks nothing new is shown, and nobody is asked again', async () => {
    const cookies = await must(http().get('/v1/sbg/documents/cookies'), 200);
    const proposal = await must(http().post('/v1/sbg/documents/cookies/versions').set(bearer(brian)).send({ title: cookies.title, body: `${cookies.body} `.replace('stays on your phone', 'stays on your phone or computer'), changeNote: 'Computers too', askAgain: false }));
    await must(http().post(`/v1/sbg/documents/versions/${proposal.versionId}/publish`).set(bearer(amina)).send({}));
    expect((await must(http().get('/v1/sbg/agreement'), 200)).documents.find((d: { kind: string }) => d.kind === 'cookies')).toMatchObject({ number: 2, since: 1 });
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(person)), 200)).toMatchObject({ needed: false });
    // Told all the same — with nothing to do.
    expect((await bell(person))[0]).toMatchObject({ title: 'Cookies: a new version', body: 'Computers too. Nothing to do: it is there to read.', link: '/cookies/' });
    // Declining takes a reason, kept with the version.
    const another = await must(http().post('/v1/sbg/documents/privacy/versions').set(bearer(amina)).send({ title: 'Your data at SeeBuyGet', body: 'Too short', changeNote: 'Trying', askAgain: true }));
    expect((await refused(http().post(`/v1/sbg/documents/versions/${another.versionId}/decline`).set(bearer(brian)).send({}))).slice(0, 2)).toEqual([400, 'REASON_REQUIRED']);
    expect(await must(http().post(`/v1/sbg/documents/versions/${another.versionId}/decline`).set(bearer(brian)).send({ reason: 'It leaves out what is kept' }))).toMatchObject({ status: 'declined', reason: 'It leaves out what is kept' });
  });

  /**
   * GENERAL, AND EACH COUNTRY'S OWN (the user, 2026-10-25: "every country needs it's specific adjustments, so there will
   * be the general terms of use, global, and specific terms of use"): Kenya's own terms, on top of the general ones.
   */
  it('6 · a country writes its own terms: everybody there is told and asked to agree to both — and a sign-up elsewhere is not', async () => {
    const GENERAL = { terms: 2, privacy: 1, cookies: 1 };
    const keys = async (query = '') => ((await must(http().get(`/v1/sbg/agreement${query}`), 200)).documents as Array<{ key: string }>).map((d) => d.key);
    expect(await keys('?country=KE')).toEqual(['terms', 'privacy', 'cookies']);

    const proposal = await must(
      http()
        .post('/v1/sbg/documents/terms/versions')
        .set(bearer(amina))
        .send({ country: 'ke', title: 'Terms of use — Kenya', body: '## What Kenyan law adds\n\n- The Data Protection Act, 2019, applies to what is kept.', changeNote: 'What Kenyan law adds to the general terms', askAgain: false }),
    );
    // A country's first version is agreed to by everybody there, whatever was ticked.
    expect(proposal).toMatchObject({ status: 'proposed', country: 'KE', askAgain: true });
    expect(await keys('?country=KE')).toEqual(['terms', 'privacy', 'cookies']);
    await must(http().post(`/v1/sbg/documents/versions/${proposal.versionId}/publish`).set(bearer(brian)).send({}));

    // Read by anybody: Kenya's set has four; Uganda's, and the general, three. The general text is untouched.
    expect(await keys('?country=KE')).toEqual(['terms', 'privacy', 'cookies', 'terms@KE']);
    expect(await keys('?country=UG')).toEqual(['terms', 'privacy', 'cookies']);
    expect(await keys()).toEqual(['terms', 'privacy', 'cookies']);
    expect(await must(http().get('/v1/sbg/documents/terms?country=KE'), 200)).toMatchObject({ key: 'terms@KE', country: 'KE', number: 1, path: '/terms/?country=KE' });
    expect((await must(http().get('/v1/sbg/documents/terms'), 200)).number).toBe(2);
    expect((await must(http().get('/v1/sbg/documents/terms/countries'), 200)).items).toEqual([{ country: 'KE', name: 'Kenya', number: 1, publishedAt: expect.any(String), path: '/terms/?country=KE' }]);
    expect((await must(http().get('/v1/sbg/documents/terms/history?country=KE'), 200)).items.map((l: { number: number }) => l.number)).toEqual([1]);
    expect((await refused(http().get('/v1/sbg/documents/privacy?country=KE')))[0]).toBe(404);
    expect((await refused(http().get('/v1/sbg/documents/terms?country=XX')))[0]).toBe(400);

    // Staff read it as a line of its own, beside the general ones.
    const lines = (await must(http().get('/v1/sbg/documents').set(bearer(amina)), 200)).items as Array<{ key: string; country?: string; current?: { number: number } }>;
    expect(lines.map((l) => l.key)).toEqual(['terms', 'privacy', 'cookies', 'terms@KE']);

    // Everybody in Kenya is told: the person (a Kenyan number), and the shop that stands there.
    for (const token of [person, duka]) {
      expect((await bell(token))[0]).toMatchObject({ title: 'New: Terms of use — Kenya', link: '/terms/?country=KE', data: { key: 'terms@KE', number: 1, askAgain: true } });
    }
    // And asked to agree, to Kenya's on top of what they agreed to already.
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(person)), 200)).toMatchObject({ needed: true, country: 'KE' });
    const [status, code] = await refused(http().post('/v1/sbg/agreement/mine').set(bearer(person)).send({ versions: GENERAL }));
    expect([status, code]).toEqual([400, 'AGREEMENT_REQUIRED']);
    expect(await must(http().post('/v1/sbg/agreement/mine').set(bearer(person)).send({ versions: { ...GENERAL, 'terms@KE': 1 } }))).toMatchObject({ needed: false, country: 'KE', agreed: { terms: 2, 'terms@KE': 1 } });
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(duka)), 200)).toMatchObject({ needed: true, country: 'KE' });

    // A store signing up in Kenya agrees to Kenya's too; one in Uganda, to the general text alone.
    expect(await refused(http().post('/v1/sbg/vendors').send({ agreement: { versions: GENERAL }, name: `Kenyan store ${tag}`, country: 'KE' }))).toEqual([400, 'AGREEMENT_REQUIRED', 'agreement']);
    await must(http().post('/v1/sbg/vendors').send({ agreement: { versions: { ...GENERAL, 'terms@KE': 1 } }, name: `Kenyan store ${tag}`, country: 'KE' }));
    await must(http().post('/v1/sbg/vendors').send({ agreement: { versions: GENERAL }, name: `Ugandan store ${tag}`, country: 'UG' }));
  });
});
