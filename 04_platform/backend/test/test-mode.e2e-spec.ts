import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MAIL_SENDER, OutgoingMail } from '../src/foundation/mail/mail.types';
import { OutgoingSms, SMS_SENDER } from '../src/foundation/sms/sms.types';
import { AGREED } from './agreed';
import { photoOver } from './content-photo';
import { declared } from './declared';

/**
 * A COUNTRY IN TEST MODE, over the wire (the owner, 2026-11-13: "opening a country in a test mode as protocol where we can
 * just only allow specific Mobile numbers before fully open to the public before wiring in the money model"; plan T1–T6).
 *
 * Malawi: two members of staff put a number on its test list and switch it on for testers only. A number not on the list is
 * sent no code and told it opens soon; the tester's shop signs up, works, and is on the map only for testers; the people who
 * asked are not written to. Then two people lift the list, and the country opens to everybody — and they are told once.
 * The steps run in order and each leans on the last.
 */
describe('a country in test mode, over the wire', () => {
  const texts: OutgoingSms[] = [];
  const mails: OutgoingMail[] = [];
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
  const mailsTo = (address: string, template: string) => mails.filter((m) => m.to.address === address && m.template === template);
  const textTo = (phone: string) => [...texts].reverse().find((t) => t.to === phone);
  const codeIn = (sms: OutgoingSms | undefined) => sms?.body.match(/^(\d{6}) /)?.[1] ?? '';
  const malawi = async () => must(http().get('/v1/sbg/countries/MW'), 200);

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

  let amina = '';
  let brian = '';
  const signIn = async (email: string, password: string) => (await must(http().post('/v1/sbg/operators/login').send({ email, password }))).token.access_token as string;
  const pending = async () =>
    ((await must(http().get('/v1/sbg/presence/proposals').set(bearer(brian)), 200)).items as Array<{ proposalId: string; jurisdiction: string; status: string; testersOnly?: boolean; opensToPublic?: boolean }>).find(
      (p) => p.jurisdiction === 'MW' && p.status === 'pending',
    )!;

  it('1 · two members of staff', async () => {
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

  const ASKED = `thoko-${tag}@lilongwe.sbg-rehearsal.org`;
  const LATER = `kondwani-${tag}@lilongwe.sbg-rehearsal.org`;
  const SHOPKEEPER = `chisomo-${tag}@lilongwe.sbg-rehearsal.org`;
  const TESTER = `+26599${tag}`;
  const STRANGER = `+26588${tag}`;

  it('2 · a number on the test list — one person adds it, kept with her name; the number is never shown back', async () => {
    await must(http().post('/v1/sbg/countries/MW/interest').send({ kind: 'carrier', email: ASKED, message: 'A pickup in Lilongwe, most days' }));
    const added = await must(http().post('/v1/sbg/presence/MW/testers').set(bearer(amina)).send({ phone: TESTER, name: 'Chisomo', role: 'shop' }));
    expect(added).toMatchObject({ ending: TESTER.slice(-3), name: 'Chisomo', role: 'shop' });
    expect(JSON.stringify(added)).not.toContain(TESTER);
    // A number with no country code is refused, in words.
    const bad = await http().post('/v1/sbg/presence/MW/testers').set(bearer(amina)).send({ phone: '0991234567', name: 'Nobody', role: 'driver' });
    expect([bad.status, bad.body.code]).toEqual([400, 'INVALID_INPUT']);
    const list = await must(http().get('/v1/sbg/presence/MW/testers').set(bearer(brian)), 200);
    expect(list.testers).toHaveLength(1);
    expect(list.log[0].said).toContain('added Chisomo');
    // A shop is not staff: the list is not theirs to read.
    expect((await http().get('/v1/sbg/presence/MW/testers')).status).toBe(401);
  });

  it('3 · switched on for testers only — by two people — and nobody who asked is written to', async () => {
    await must(http().post('/v1/sbg/fx').set(bearer(amina)).send({ currency: 'MWK', perBase: 13.4, source: 'the rehearsal' }));
    // Testers only needs goods to move: on a country taking sign-ups only, there is nothing to test.
    const early = await http().post('/v1/sbg/presence/MW').set(bearer(amina)).send({ level: 'coming', testersOnly: true });
    expect([early.status, early.body.code]).toEqual([400, 'INVALID_STATE']);
    await must(http().post('/v1/sbg/presence/MW').set(bearer(amina)).send({ level: 'matched', testersOnly: true, note: 'Testing with our first shop' }));
    const proposal = await pending();
    expect(proposal.testersOnly).toBe(true);
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(brian)).send({}));
    expect(await must(http().get('/v1/sbg/presence/MW').set(bearer(amina)), 200)).toMatchObject({ level: 'matched', testersOnly: true, testers: 1 });
    expect(await malawi()).toMatchObject({ joinable: true, testing: true });
    expect(mailsTo(ASKED, 'country-open')).toEqual([]);
    // Somebody may still ask to be told: it has not opened to them.
    await must(http().post('/v1/sbg/countries/MW/interest').send({ kind: 'shop', email: LATER, message: 'Waiting while it is tested' }));
  });

  it('4 · a number not on the list is sent no code and told it opens soon; a tester is sent one', async () => {
    const refused = await http().post('/v1/sbg/auth/phone/request').send({ phone: STRANGER });
    expect([refused.status, refused.body.code, refused.body.params?.country]).toEqual([403, 'NOT_A_TESTER', 'MW']);
    expect(refused.body.message).toMatch(/being tested in Malawi and opens to everyone soon/);
    expect(textTo(STRANGER)).toBeUndefined();
    await must(http().post('/v1/sbg/auth/phone/request').send({ phone: TESTER }));
    expect(codeIn(textTo(TESTER))).toMatch(/^\d{6}$/);
  });

  let shop = { did: '', token: '' };
  const signUp = (phone: string, email: string) =>
    http()
      .post('/v1/sbg/auth/signup')
      .send({
        ...AGREED,
        role: 'pudo',
        email,
        password: `${email.split('@')[0]}-keeps-this-7`,
        phone,
        profile: {
          agent: {
            shopName: 'Area 47 Duka',
            fullName: 'Chisomo Banda',
            nationalId: `MW-ID-${phone.slice(-7)}`,
            mobile: phone,
            deviceImei: `IMEI-MW-${phone.slice(-7)}`,
            country: 'MW',
            zone: 'Lilongwe',
            landmark: 'Beside the market',
            location: { lat: -13.9626, lng: 33.7741 },
            pricePerParcel: 900,
            shelf: { rows: 3, cols: 4 },
            openingHours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '08:00', close: '18:00' }])),
            requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-MW-${phone.slice(-7)}`, criminalRecordClear: true },
          },
        },
      });

  it('5 · the tester’s shop signs up and works — and is on the map only for testers', async () => {
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone: TESTER, code: codeIn(textTo(TESTER)) }));
    const account = await must(signUp(TESTER, SHOPKEEPER));
    shop = { did: account.did, token: account.token.access_token };
    const own = `/v1/sbg/agents/${encodeURIComponent(shop.did)}`;
    const shot = (label: string) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]).toString('base64')}`;
    const photo = async (kind: string) => (await must(http().post('/v1/sbg/media').set(bearer(shop.token)).send({ kind, dataUrl: shot(`${kind} of ${shop.did}`) }))).mediaId as string;
    const papers = { idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] };
    await must(http().post(`${own}/submit-kyc`).set(bearer(shop.token)).send(papers));
    await must(http().post(`${own}/kyc-decision`).set(bearer(amina)).send({ approve: true, licenceExpiresAt: '2099-12-31' }));
    // A tester's shop is not held back as "not open yet".
    expect((await must(http().get(`${own}/can-transact`).set(bearer(shop.token)), 200)).code).not.toBe('COUNTRY_NOT_OPEN');
    // The public map does not show it; the tester's own view does.
    const publicMap = (await must(http().get('/v1/sbg/network/points'), 200)) as Array<{ did: string }>;
    expect(publicMap.map((p) => p.did)).not.toContain(shop.did);
    const mine = (await must(http().get('/v1/sbg/network/points/mine').set(bearer(shop.token)), 200)) as Array<{ did: string }>;
    expect(mine.map((p) => p.did)).toContain(shop.did);
    // Staff are not on the list, so they see the public map there.
    const staffView = (await must(http().get('/v1/sbg/network/points/mine').set(bearer(amina)), 200)) as Array<{ did: string }>;
    expect(staffView.map((p) => p.did)).not.toContain(shop.did);
  });

  it('5b · a parcel goes only to a listed receiver: the counter is refused one for anybody else, before anything is kept', async () => {
    declared(app, 'shop', shop.did);
    const dropoffPhotoRef = await photoOver(app.getHttpServer(), bearer(shop.token));
    const parcelId = `TEST-${tag}`;
    const refused = await http()
      .post('/v1/sbg/parcels/accept')
      .set(bearer(shop.token))
      .send({ agentDid: shop.did, parcelId, size: 'S', destZone: 'Lilongwe', senderMobile: TESTER, receiverMobile: STRANGER, paymentMode: 'prepaid', dropoffPhotoRef });
    expect([refused.status, refused.body.code]).toEqual([403, 'NOT_A_TESTER']);
    expect(refused.body.message).toMatch(/sending to this number/);
    expect((await http().get(`/v1/sbg/parcels/${parcelId}`).set(bearer(shop.token))).status).toBe(404);
  });

  it('6 · taken off the list after a code: the sign-up itself is refused', async () => {
    const second = `+26599${String(Number(tag) + 1)}`;
    await must(http().post('/v1/sbg/presence/MW/testers').set(bearer(amina)).send({ phone: second, name: 'Mphatso', role: 'shop' }));
    await must(http().post('/v1/sbg/auth/phone/request').send({ phone: second }));
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone: second, code: codeIn(textTo(second)) }));
    const list = await must(http().get('/v1/sbg/presence/MW/testers').set(bearer(amina)), 200);
    const hash = (list.testers as Array<{ name: string; phoneHash: string }>).find((t) => t.name === 'Mphatso')!.phoneHash;
    const after = await must(http().delete(`/v1/sbg/presence/MW/testers/${hash}`).set(bearer(amina)), 200);
    expect((after.testers as Array<{ name: string }>).map((t) => t.name)).toEqual(['Chisomo']);
    expect(after.log[0].said).toContain('removed Mphatso');
    const refused = await signUp(second, `mphatso-${tag}@lilongwe.sbg-rehearsal.org`);
    expect([refused.status, refused.body.code]).toEqual([403, 'NOT_A_TESTER']);
  });

  it('7 · the list lifted by two people: Malawi opens to everybody, and the people who asked hear it once', async () => {
    // While it was tested, nobody registered there was told it opened.
    expect(mailsTo(SHOPKEEPER, 'country-opened')).toEqual([]);
    await must(http().post('/v1/sbg/presence/MW').set(bearer(amina)).send({ level: 'matched', testersOnly: false, note: 'Open to everybody' }));
    const proposal = await pending();
    expect(proposal.opensToPublic).toBe(true);
    // Nothing changes until a second person approves.
    expect((await malawi()).testing).toBe(true);
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(amina)).send({}), 403);
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(brian)).send({}));
    expect(await malawi()).not.toHaveProperty('testing');
    for (const address of [ASKED, LATER]) expect(mailsTo(address, 'country-open')).toHaveLength(1);
    // Everybody registered there hears it is open to everyone now, once — as a country's opening tells them.
    expect(mailsTo(SHOPKEEPER, 'country-opened')).toHaveLength(1);
    // The shop is on the public map now, and a stranger is sent a code.
    const publicMap = (await must(http().get('/v1/sbg/network/points'), 200)) as Array<{ did: string }>;
    expect(publicMap.map((p) => p.did)).toContain(shop.did);
    await must(http().post('/v1/sbg/auth/phone/request').send({ phone: STRANGER }));
  });
});
