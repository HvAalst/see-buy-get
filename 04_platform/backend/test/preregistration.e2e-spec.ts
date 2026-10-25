import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MAIL_SENDER, OutgoingMail } from '../src/foundation/mail/mail.types';
import { OutgoingSms, SMS_SENDER } from '../src/foundation/sms/sms.types';

/**
 * SIGNING UP BEFORE A COUNTRY OPENS, over the wire (the user, 2026-10-25: "it would be good when shops, drivers/fleets,
 * hubs etc can preregister before a country goes live. Then we have those on the network immediately").
 *
 * Zambia, from nothing decided to open: two members of staff mark it COMING, the people who asked are told, a shop signs
 * up by a code texted to its phone and has its papers checked — and takes nothing in until the day it opens. Then two
 * members of staff open it, and everybody hears it once: the ones who asked, and the shop, which is told it can start.
 * The steps run in order and each leans on the last.
 */
describe('signing up before a country opens, over the wire', () => {
  const texts: OutgoingSms[] = [];
  const mails: OutgoingMail[] = [];
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tag = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

  /** The answer, or a failure that says which call it was and what the server said. */
  const must = async (call: request.Test, status = 201): Promise<any> => {
    const r = await call;
    const asked = (r as unknown as { request: { method: string; url: string } }).request;
    if (r.status !== status) throw new Error(`${asked.method} ${asked.url.replace(/^https?:\/\/[^/]+/, '')} answered ${r.status}, wanted ${status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    return r.body;
  };
  const mailsTo = (address: string, template: string) => mails.filter((m) => m.to.address === address && m.template === template);
  const textTo = (phone: string) => [...texts].reverse().find((t) => t.to === phone);
  const codeIn = (sms: OutgoingSms | undefined) => sms?.body.match(/^(\d{6}) /)?.[1] ?? '';
  const zambia = async () => ((await must(http().get('/v1/sbg/countries'), 200)) as Array<{ country: string }>).find((c) => c.country === 'ZM');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue({ send: async (sms: OutgoingSms) => void texts.push(sms) })
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

  /* ------------------------------------------------------------------ staff -- */

  let amina = '';
  let brian = '';
  const signIn = async (email: string, password: string) => (await must(http().post('/v1/sbg/operators/login').send({ email, password }))).token.access_token as string;

  it('1 · two members of staff: one made by the setup key, the second asked for by the first', async () => {
    const setupKey = (await must(http().post('/v1/auth/token').send({ role: 'operator' }))).access_token as string;
    const first = { email: `amina-${tag}@sbg.test`, name: `Amina ${tag}` };
    const made = await must(http().post('/v1/sbg/operators').set(bearer(setupKey)).send(first));
    amina = await signIn(first.email, made.temporaryPassword);
    const second = { email: `brian-${tag}@sbg.test`, name: `Brian ${tag}`, roles: ['support', 'vetting', 'money', 'admin'] };
    const asked = await must(http().post('/v1/sbg/operators/proposals').set(bearer(amina)).send(second));
    const invited = await must(http().post(`/v1/sbg/operators/proposals/${asked.proposalId}/approve`).set(bearer(setupKey)));
    await must(http().post('/v1/sbg/operators/welcome').send({ token: String(invited.link).split('#welcome=')[1], password: `brian-${tag}-chose-this-9` }));
    brian = await signIn(second.email, `brian-${tag}-chose-this-9`);
  });

  /* -------------------------------------------------------- nothing decided -- */

  const CHANDA = `chanda-${tag}@lusaka.sbg-rehearsal.org`;
  const MWILA = `mwila-${tag}@lusaka.sbg-rehearsal.org`;
  const PHONE = `+2609771${tag.slice(0, 5)}`;

  it('2 · nothing decided about Zambia: no sign-up, no code texted — and two people ask to be told', async () => {
    expect(await zambia()).toMatchObject({ joinable: false });
    expect(await zambia()).not.toHaveProperty('coming');
    const refused = await http().post('/v1/sbg/auth/phone/request').send({ phone: PHONE });
    expect([refused.status, refused.body.code]).toEqual([400, 'PHONE_NOT_SERVED']);
    expect(texts).toEqual([]);
    await must(http().post('/v1/sbg/countries/ZM/interest').send({ kind: 'shop', email: CHANDA, message: 'I keep a shop on Cairo Road' }));
    await must(http().post('/v1/sbg/countries/ZM/interest').send({ kind: 'carrier', email: MWILA, message: 'Two lorries, Lusaka to Ndola' }));
  });

  /* ---------------------------------------------------------------- coming -- */

  it('3 · marked coming by one and approved by another — no exchange rate asked — and the two who asked are told they can sign up', async () => {
    await must(http().post('/v1/sbg/presence/ZM').set(bearer(amina)).send({ level: 'coming', note: 'Partners in Lusaka are signing up ahead of the launch' }));
    // Asking changes nothing: taking sign-ups is a gain, and a gain takes a second person.
    expect((await must(http().get('/v1/sbg/presence/ZM').set(bearer(amina)), 200)).level).toBe('observed');
    const proposal = ((await must(http().get('/v1/sbg/presence/proposals').set(bearer(brian)), 200)).items as Array<{ proposalId: string; jurisdiction: string; gains: string[] }>).find((p) => p.jurisdiction === 'ZM')!;
    expect(proposal.gains).toEqual(['signUp']);
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(amina)).send({}), 403);
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(brian)).send({}));

    expect(await must(http().get('/v1/sbg/presence/ZM').set(bearer(amina)), 200)).toMatchObject({ level: 'coming', capabilities: { signUp: true, takeIn: false, payouts: false } });
    expect(await zambia()).toMatchObject({ joinable: true, coming: true, settles: false });
    // One country on its own, as an app asks for the country its account is in.
    expect(await must(http().get('/v1/sbg/countries/zm'), 200)).toEqual({ country: 'ZM', name: 'Zambia', settles: false, joinable: true, coming: true });
    for (const address of [CHANDA, MWILA]) {
      const [told] = mailsTo(address, 'country-coming');
      expect(told?.subject).toBe('SeeBuyGet is coming to Zambia: sign up now');
    }
    // A code may be texted there now, as to an open country.
    expect((await must(http().get('/v1/sbg/connections').set(bearer(amina)), 200)).sms.countries).toContain('ZM +260');
    // And the two are still waiting — for the opening.
    const row = ((await must(http().get('/v1/sbg/interest').set(bearer(amina)), 200)).items as Array<{ country: string; waiting: number }>).find((r) => r.country === 'ZM');
    expect(row?.waiting).toBe(2);
  });

  let shop = { did: '', token: '' };

  it('4 · a shop signs up there by a code texted to its phone, its papers are checked — and it takes nothing in yet', async () => {
    await must(http().post('/v1/sbg/auth/phone/request').send({ phone: PHONE }));
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone: PHONE, code: codeIn(textTo(PHONE)) }));
    const account = await must(
      http()
        .post('/v1/sbg/auth/signup')
        .send({
          role: 'pudo',
          email: CHANDA,
          password: `chanda-${tag}-keeps-this-7`,
          phone: PHONE,
          profile: {
            agent: {
              shopName: 'Cairo Road Duka',
              fullName: 'Chanda Mulenga',
              nationalId: `ZM-ID-${tag}`,
              mobile: PHONE,
              deviceImei: `IMEI-ZM-${tag}`,
              country: 'ZM',
              zone: 'Lusaka',
              landmark: 'Opposite the post office',
              location: { lat: -15.4167, lng: 28.2833 },
              pricePerParcel: 1.5,
              shelf: { rows: 3, cols: 4 },
              openingHours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '08:00', close: '18:00' }])),
              requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-ZM-${tag}`, criminalRecordClear: true },
            },
          },
        }),
    );
    shop = { did: account.did, token: account.token.access_token };
    const own = `/v1/sbg/agents/${encodeURIComponent(shop.did)}`;
    const shot = (label: string) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]).toString('base64')}`;
    const photo = async (kind: string) => (await must(http().post('/v1/sbg/media').set(bearer(shop.token)).send({ kind, dataUrl: shot(`${kind} of ${shop.did}`) }))).mediaId as string;
    const papers = { idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] };
    expect((await must(http().post(`${own}/submit-kyc`).set(bearer(shop.token)).send(papers))).status).toBe('KYC_PENDING');
    // Checked as they come in, ahead of the day.
    await must(http().post(`${own}/kyc-decision`).set(bearer(amina)).send({ approve: true, licenceExpiresAt: '2099-12-31' }));
    expect((await must(http().get(own).set(bearer(shop.token)), 200)).status).toBe('ACTIVE');

    // …and still nothing is taken in: the counter says why, and the public map does not show it yet.
    expect(await must(http().get(`${own}/can-transact`).set(bearer(shop.token)), 200)).toMatchObject({ canTransact: false, code: 'COUNTRY_NOT_OPEN' });
    const onMap = (await must(http().get('/v1/sbg/network/points'), 200)) as Array<{ did: string }>;
    expect(onMap.map((p) => p.did)).not.toContain(shop.did);
  });

  /* ---------------------------------------------------------------- opened -- */

  it('5 · opened by two people once a rate is on the book — and everybody hears it once', async () => {
    // Opening prices things, and nothing is priced in a money with no rate.
    const early = await http().post('/v1/sbg/presence/ZM').set(bearer(amina)).send({ level: 'matched', note: 'Launch day' });
    expect([early.status, early.body.code]).toEqual([400, 'INVALID_STATE']);
    expect(early.body.message).toMatch(/no exchange rate for ZMW/);
    await must(http().post('/v1/sbg/fx').set(bearer(amina)).send({ currency: 'ZMW', perBase: 26.4, source: 'the rehearsal' }));

    await must(http().post('/v1/sbg/presence/ZM').set(bearer(amina)).send({ level: 'matched', note: 'Launch day' }));
    const proposal = ((await must(http().get('/v1/sbg/presence/proposals').set(bearer(brian)), 200)).items as Array<{ proposalId: string; jurisdiction: string; status: string }>).find(
      (p) => p.jurisdiction === 'ZM' && p.status === 'pending',
    )!;
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(brian)).send({}));
    expect(await zambia()).toMatchObject({ joinable: true });
    expect(await zambia()).not.toHaveProperty('coming');
    expect(await must(http().get('/v1/sbg/countries/ZM'), 200)).not.toHaveProperty('coming');

    // The one who asked and never signed up hears it from the waiting list…
    expect(mailsTo(MWILA, 'country-open')).toHaveLength(1);
    // …and the one who asked AND signed up hears it once, as somebody registered there: that they can start today, and
    // that no company of ours handles money there yet.
    expect(mailsTo(CHANDA, 'country-open')).toEqual([]);
    const [opened] = mailsTo(CHANDA, 'country-opened');
    expect(opened?.subject).toBe('SeeBuyGet is open in Zambia from today');
    expect(JSON.stringify(opened)).toContain('you can start today');
    expect(JSON.stringify(opened)).toContain('Work yes, money no');
    expect(mailsTo(CHANDA, 'country-opened')).toHaveLength(1);

    // The counter no longer says the country is not open, and the shop is on the map.
    expect((await must(http().get(`/v1/sbg/agents/${encodeURIComponent(shop.did)}/can-transact`).set(bearer(shop.token)), 200)).code).not.toBe('COUNTRY_NOT_OPEN');
    const onMap = (await must(http().get('/v1/sbg/network/points'), 200)) as Array<{ did: string }>;
    expect(onMap.map((p) => p.did)).toContain(shop.did);
    // Told, and no longer waiting.
    const row = ((await must(http().get('/v1/sbg/interest').set(bearer(amina)), 200)).items as Array<{ country: string; waiting: number }>).find((r) => r.country === 'ZM');
    expect(row?.waiting).toBe(0);
  });
});
