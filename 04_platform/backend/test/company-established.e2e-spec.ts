import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MAIL_SENDER, OutgoingMail } from '../src/foundation/mail/mail.types';
import { pdfDataUrl } from '../src/foundation/entity/company.test-util';
import { AGREED } from './agreed';

/**
 * A COMPANY OF OURS SWITCHED ON WHERE PEOPLE ALREADY WORK, over the wire (the user, 2026-10-25, to "when a company is
 * set up in a country, staff publish that country's own terms naming the company; everyone there is told in the bell and
 * agrees on their next opening; their records move to that company at the same time": "yes").
 *
 * Zambia opens without a company of ours — goods move, nobody of ours handles the money — and the person who asked about
 * it is told so, and that we will write again when that changes. A shop and a person sign up there. Then Zambia's company
 * is readied: it cannot be switched on until Zambia's terms naming it are written, and those cannot be published on their
 * own. The approval that switches it on publishes them: everybody there is told who they work with from today, in their
 * app and by email; the one who asked is written to again; the shop's record names the new company; both are asked to
 * agree. The steps run in order.
 */
describe('a company of ours switched on where people already work', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const mails: OutgoingMail[] = [];
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tag = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const short = tag.slice(0, 5);

  const must = async (call: request.Test, status = 201): Promise<any> => {
    const r = await call;
    const asked = (r as unknown as { request: { method: string; url: string } }).request;
    if (r.status !== status) throw new Error(`${asked.method} ${asked.url.replace(/^https?:\/\/[^/]+/, '')} answered ${r.status}, wanted ${status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    return r.body;
  };
  const mailsTo = (address: string, template: string) => mails.filter((m) => m.to.address === address && m.template === template);
  /** What somebody's bell says about the documents they agreed to, newest first. */
  const bell = async (token: string) =>
    ((await must(http().get('/v1/sbg/notifications/inbox').set(bearer(token)), 200)).items as Array<{ kind: string; title: string; body: string; link?: string; data?: Record<string, unknown> }>).filter((n) => n.kind === 'terms_updated');
  /** The notices go out after the approval has answered: let them. */
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };
  /** A change to Zambia, asked by one member of staff and approved by the other. */
  const raise = async (level: string) => {
    await must(http().post('/v1/sbg/presence/ZM').set(bearer(amina)).send({ level, note: `Zambia: ${level}` }));
    const proposal = ((await must(http().get('/v1/sbg/presence/proposals').set(bearer(brian)), 200)).items as Array<{ proposalId: string; jurisdiction: string; status: string }>).find((p) => p.jurisdiction === 'ZM' && p.status === 'pending')!;
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(brian)).send({}));
    await settle();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (mail: OutgoingMail) => void mails.push(mail) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  let amina = '';
  let brian = '';

  it('1 · two members of staff: one made by the setup key, the second asked for by the first', async () => {
    const setupKey = (await must(http().post('/v1/auth/token').send({ role: 'operator' }))).access_token as string;
    const signIn = async (email: string, password: string) => (await must(http().post('/v1/sbg/operators/login').send({ email, password }))).token.access_token as string;
    const first = { email: `amina-zm-${tag}@sbg.test`, name: `Amina ${tag}` };
    const made = await must(http().post('/v1/sbg/operators').set(bearer(setupKey)).send(first));
    amina = await signIn(first.email, made.temporaryPassword);
    const second = { email: `brian-zm-${tag}@sbg.test`, name: `Brian ${tag}`, roles: ['support', 'vetting', 'money', 'admin'] };
    const asked = await must(http().post('/v1/sbg/operators/proposals').set(bearer(amina)).send(second));
    const invited = await must(http().post(`/v1/sbg/operators/proposals/${asked.proposalId}/approve`).set(bearer(setupKey)));
    await must(http().post('/v1/sbg/operators/welcome').send({ token: String(invited.link).split('#welcome=')[1], password: `brian-zm-${tag}-chose-this-9` }));
    brian = await signIn(second.email, `brian-zm-${tag}-chose-this-9`);
  });

  const MWILA = `mwila-${tag}@lusaka.sbg-rehearsal.org`;
  const SHOP_EMAIL = `duka-zm-${tag}@shops.sbg-rehearsal.org`;
  let shop = '';
  let person = '';

  it('2 · somebody asks about Zambia; it opens with no company of ours behind the money, and they are told we will write again', async () => {
    await must(http().post('/v1/sbg/countries/ZM/interest').send({ kind: 'carrier', email: MWILA, message: 'Two lorries, Lusaka to Ndola' }));
    await must(http().post('/v1/sbg/fx').set(bearer(amina)).send({ currency: 'ZMW', perBase: 26.4, source: 'the rehearsal' }));
    await raise('matched');
    const [open] = mailsTo(MWILA, 'country-open');
    expect(JSON.stringify(open)).toContain('When a company is established there, that changes and we will write again.');
  });

  it('3 · a shop and a person sign up in Zambia, and no company of ours contracts with them', async () => {
    const shopPhone = `+2609772${short}`;
    const code = (await must(http().post('/v1/sbg/auth/phone/request').send({ phone: shopPhone }))).code as string;
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone: shopPhone, code }));
    const made = await must(
      http()
        .post('/v1/sbg/auth/signup')
        .send({
          ...AGREED,
          role: 'pudo',
          email: SHOP_EMAIL,
          password: `duka-zm-${tag}-keeps-this-7`,
          phone: shopPhone,
          profile: {
            agent: {
              shopName: `Duka Lusaka ${tag}`,
              zone: `LUN${tag}`,
              country: 'ZM',
              location: { lat: -15.4167, lng: 28.2833 },
              landmark: 'On Cairo Road',
              shelf: { rows: 3, cols: 3 },
              openingHours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '08:00', close: '18:00' }])),
              fullName: 'Chanda Mulenga',
              nationalId: `ZM-ID-${tag}`,
              mobile: shopPhone,
              deviceImei: `IMEI-ZM-${tag}`,
              requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-ZM-${tag}`, criminalRecordClear: true },
            },
          },
        }),
    );
    shop = made.token.access_token;
    expect(await must(http().get('/v1/sbg/contract/company').set(bearer(shop)), 200)).toEqual({ papers: [] });
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(shop)), 200)).toMatchObject({ needed: false, country: 'ZM' });

    const personPhone = `+2609773${short}`;
    const personCode = (await must(http().post('/v1/sbg/auth/phone/request').send({ phone: personPhone }))).code as string;
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone: personPhone, code: personCode }));
    const email = `bwalya-${tag}@people.sbg-rehearsal.org`;
    const mailed = (await must(http().post('/v1/sbg/identity/email/request').send({ email }))).code as string;
    person = (await must(http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone: personPhone, pin: '48261', email, emailCode: mailed }))).token.access_token;
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(person)), 200)).toMatchObject({ needed: false, country: 'ZM' });
  });

  let zambia = '';
  let termsId = '';

  it('4 · Zambia’s company is readied — and cannot be switched on until Zambia’s terms naming it are written, which wait for it', async () => {
    const draft = await must(http().post('/v1/sbg/entities').set(bearer(amina)).send({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }));
    zambia = draft.entityId;
    const record = async () => (await must(http().get(`/v1/sbg/entities/${zambia}/record`).set(bearer(amina)), 200)) as { readiness: { ready: boolean; items: Array<{ key: string; met: boolean; label: string }> } };
    const missing = async () => (await record()).readiness.items.filter((i) => !i.met).map((i) => i.key);
    const obligations = (await missing()).filter((k) => k.startsWith('obligation:')).map((k) => k.slice('obligation:'.length));
    await must(
      http()
        .post(`/v1/sbg/entities/${zambia}/record`)
        .set(bearer(amina))
        .send({
          legalName: 'SeeBuyGet Zambia Limited',
          legalForm: 'private_limited',
          registrationNumber: `ZM-REG-${tag}`,
          registeredAddress: { line1: '1 Cairo Road', city: 'Lusaka', country: 'ZM' },
          representatives: [{ name: 'Mutale Banda', role: 'Managing director', signing: 'alone' }],
          beneficialOwners: [{ name: 'SeeBuyGet Group', sharePct: 100 }],
          taxRegistrations: [{ kind: 'vat', number: `ZM-TPIN-${tag}` }],
          bankAccounts: [{ bankName: 'Zanaco', accountName: 'SeeBuyGet Zambia Limited', accountNumber: '0001', currency: 'ZMW', purpose: 'payouts' }],
          obligations: obligations.map((key) => ({ key, reference: `REF-${key}` })),
        }),
    );
    const papers: Array<[string, string?]> = [['certificate_of_incorporation'], ['tax_registration_certificate'], ['bank_confirmation'], ...obligations.map((key): [string, string] => ['obligation_registration', key])];
    for (const [kind, relatesTo] of papers) {
      const put = await must(http().post(`/v1/sbg/entities/${zambia}/documents`).set(bearer(amina)).send({ kind, title: kind.replace(/_/g, ' '), ...(relatesTo ? { relatesTo } : {}), dataUrl: pdfDataUrl(`zm:${tag}:${kind}:${relatesTo ?? ''}`) }));
      await must(http().post(`/v1/sbg/entities/${zambia}/documents/${put.documentId}/verify`).set(bearer(brian)).send({}));
    }
    const admin = await must(http().post(`/v1/sbg/entities/${zambia}/admins`).set(bearer(amina)).send({ email: `mutale-${tag}@zambia.sbg-rehearsal.org`, name: 'Mutale Banda' }));
    const mutale = (await must(http().post('/v1/sbg/entities/admins/login').send({ email: `mutale-${tag}@zambia.sbg-rehearsal.org`, password: admin.temporaryPassword ?? admin.password }))).token.access_token as string;
    await must(
      http()
        .post(`/v1/sbg/entities/${zambia}/contact`)
        .set(bearer(mutale))
        .send({ contactName: 'Front desk', phone: '+260211100200', deskPhone: '+260211100300', address: '1 Cairo Road, Lusaka', visitDays: ['mon', 'tue', 'wed', 'thu', 'fri'], visitFrom: '09:00', visitTo: '16:00', visitorsPerHour: 6 }),
    );
    // Everything but its terms: and asking to switch it on is refused, saying what is left.
    expect(await missing()).toEqual(['country_terms']);
    const refused = await must(http().post('/v1/sbg/presence/ZM').set(bearer(amina)).send({ level: 'established', note: 'The company is ready' }), 400);
    expect(JSON.stringify(refused)).toContain('Its terms of use for Zambia, naming it');

    // Written from what its record says, by one of staff.
    const text = await must(http().get('/v1/sbg/documents/terms/draft?country=ZM').set(bearer(amina)), 200);
    expect(text).toMatchObject({ title: 'Terms of use — Zambia', changeNote: 'SeeBuyGet Zambia Limited runs SeeBuyGet in Zambia from today: it is the company you agree with there.' });
    expect(text.body).toContain(`In Zambia, you agree with SeeBuyGet Zambia Limited, registered under number ZM-REG-${tag}, at 1 Cairo Road, Lusaka, Zambia.`);
    termsId = (await must(http().post('/v1/sbg/documents/terms/versions').set(bearer(amina)).send({ country: 'ZM', ...text, askAgain: true }))).versionId;
    // It waits for the company: the console says so, and publishing it on its own is refused.
    const line = ((await must(http().get('/v1/sbg/documents').set(bearer(brian)), 200)).items as Array<{ key: string; heldFor?: unknown }>).find((l) => l.key === 'terms@ZM');
    expect(line?.heldFor).toEqual({ company: 'SeeBuyGet Zambia Limited', country: 'ZM' });
    expect(await must(http().post(`/v1/sbg/documents/versions/${termsId}/publish`).set(bearer(brian)).send({}), 400)).toMatchObject({ code: 'INVALID_STATE', params: { reason: 'held_for_switch_on' } });
    expect((await record()).readiness.ready).toBe(true);
    // Nobody heard a word of it yet.
    expect(await bell(shop)).toEqual([]);
  });

  it('5 · two people switch it on: its terms are published with it, everybody there is told who they work with, and their records follow', async () => {
    await raise('established');
    expect((await must(http().get('/v1/sbg/presence/ZM').set(bearer(amina)), 200)).level).toBe('established');

    // Its terms, published by the second person in the same act.
    const line = ((await must(http().get('/v1/sbg/documents').set(bearer(amina)), 200)).items as Array<{ key: string; current?: { number: number; decidedBy: string; versionId: string }; heldFor?: unknown }>).find((l) => l.key === 'terms@ZM');
    expect(line?.current).toMatchObject({ number: 1, versionId: termsId, decidedBy: `Brian ${tag}` });
    expect(line?.heldFor).toBeUndefined();

    // The shop's record follows: the company that contracts with it is Zambia's, from now.
    expect((await must(http().get('/v1/sbg/contract/company').set(bearer(shop)), 200)).company).toEqual({ name: 'SeeBuyGet Zambia', jurisdiction: 'ZM' });

    // Told, by name, in the app — the shop, and the person who agreed for Zambia.
    for (const token of [shop, person]) {
      expect(await bell(token)).toHaveLength(1);
      expect((await bell(token))[0]).toMatchObject({
        title: 'SeeBuyGet Zambia Limited runs SeeBuyGet in Zambia from today',
        body: 'SeeBuyGet Zambia Limited is the company you work with in Zambia from today. Its terms are in your app: you are asked to agree to them the next time you open it.',
        link: '/terms/?country=ZM',
        data: { key: 'terms@ZM', number: 1, askAgain: true, established: 'SeeBuyGet Zambia Limited' },
      });
    }
    // By email, where they gave an address — and the one who asked about Zambia is written to again, as promised.
    expect(mailsTo(SHOP_EMAIL, 'country-established').map((m) => m.subject)).toEqual(['SeeBuyGet Zambia Limited runs SeeBuyGet in Zambia from today']);
    const [settles] = mailsTo(MWILA, 'country-settles');
    expect(settles?.subject).toBe('SeeBuyGet Zambia Limited runs SeeBuyGet in Zambia from today');
    expect(JSON.stringify(settles)).toContain('we would write again when one did');

    // Asked to agree to Zambia's terms the next time they open their app — and, agreeing, they go on.
    const mine = await must(http().get('/v1/sbg/agreement/mine').set(bearer(shop)), 200);
    expect(mine).toMatchObject({ needed: true, country: 'ZM' });
    expect((mine.documents as Array<{ key: string }>).map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies', 'terms@ZM']);
    expect(await must(http().post('/v1/sbg/agreement/mine').set(bearer(shop)).send({ versions: { ...AGREED.agreement.versions, 'terms@ZM': 1 } }))).toMatchObject({ needed: false });
    expect(await must(http().get('/v1/sbg/agreement/mine').set(bearer(person)), 200)).toMatchObject({ needed: true, country: 'ZM' });
  });
});
