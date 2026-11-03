import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';
import { AGREED } from './agreed';

/**
 * A NEW PHONE LINKED BY ONE THE ACCOUNT ALREADY USES (the owner, 2026-11-03: "A different device can be linked like the dutch
 * digid with a qr and a couple code or something similar") — over the wire.
 *
 * The password is right on a new phone; instead of the code to the shop's number, the new phone shows a pairing code (as a
 * QR code and in words). The shop's own phone, signed in, scans or types it; the new phone is then signed in, and one of
 * the shop's phones. Nobody else's phone can approve it, and a code is good once.
 */
describe('a new phone, linked by the shop’s own phone, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const HOURS = { open: '08:00', close: '18:00' };

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

  const verified = async (phone: string) => {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
  };
  const shopProfile = (u: string, phone: string) => ({
    agent: { shopName: `Kona ${u}`, zone: `Z${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Kona Shop', nationalId: `ID-${u}`, mobile: phone, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } },
  });

  it('links the new phone when the shop’s own phone takes its code — once, and only the shop’s', async () => {
    const u = digits();
    const email = `kona.${u}@shop.example`;
    const password = 'duka-la-kona-2026';
    const phone = `+2547${u}1`;
    await verified(phone);
    const shop = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'pudo', email, password, phone, profile: shopProfile(u, phone) }).expect(201)).body;
    const onFirst = (await http().post('/v1/sbg/auth/login').send({ email, password, device: shop.device, role: 'pudo' }).expect(201)).body;
    const bearer = { authorization: `Bearer ${onFirst.token.access_token}` };

    // The new phone: the right password, and no phone of the shop's.
    const asked = (await http().post('/v1/sbg/auth/login').send({ email, password, role: 'pudo' }).expect(403)).body;
    expect(asked.code).toBe('DEVICE_NOT_KNOWN');
    const { challenge } = asked.params as { challenge: string };

    // It shows a pairing code: eight letters and digits, two minutes; the shop has one phone that can take it.
    const shown = (await http().post('/v1/sbg/auth/device/pair').send({ challenge }).expect(201)).body;
    expect(shown).toMatchObject({ pairCode: expect.stringMatching(/^[A-HJKMNP-Z2-9]{8}$/), expiresIn: 120, phones: 1 });
    expect((await http().post('/v1/sbg/auth/device/pair/status').send({ challenge }).expect(201)).body).toMatchObject({ linked: false });

    // A code that is nobody's, or typed on a phone that is not the shop's, links nothing.
    await http().post('/v1/sbg/account/pair').set(bearer).send({ code: 'AAAA-AAAA', device: shop.device }).expect(404);
    await http().post('/v1/sbg/account/pair').set(bearer).send({ code: shown.pairCode, device: 'dvc_not-the-shops' }).expect(403);

    // Typed as people type it — small letters, a dash in the middle — on the shop's own phone: linked.
    const typed = `${shown.pairCode.slice(0, 4)}-${shown.pairCode.slice(4)}`.toLowerCase();
    expect((await http().post('/v1/sbg/account/pair').set(bearer).send({ code: typed, device: shop.device }).expect(201)).body).toEqual({ linked: true });

    // The new phone asks again: signed in, and one of the shop's phones from now — and the code is spent.
    const linked = (await http().post('/v1/sbg/auth/device/pair/status').send({ challenge }).expect(201)).body;
    expect(linked).toMatchObject({ linked: true, role: 'pudo', did: shop.did, email, device: expect.stringMatching(/^dvc_/), token: { access_token: expect.any(String) } });
    await http().post('/v1/sbg/auth/device/pair/status').send({ challenge }).expect(400);
    await http().post('/v1/sbg/auth/login').send({ email, password, device: linked.device, role: 'pudo' }).expect(201);
    // Nor is a challenge that went through a pairing confirmed by its old code afterwards.
    await http().post('/v1/sbg/auth/device').send({ challenge, code: asked.params.code ?? '000000' }).expect(400);
  });

  it('keeps each kind’s new-phone challenge its own under one email: the hub’s code opens the hub, not the shop', async () => {
    const u = digits();
    const email = `amani.${u}@example.com`;
    const shopPhone = `+2547${u}2`;
    const hubPhone = `+2547${u}3`;
    await verified(shopPhone);
    await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'pudo', email, password: 'duka-la-kona-2026', phone: shopPhone, profile: shopProfile(u, shopPhone) }).expect(201);
    await verified(hubPhone);
    const hub = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'mdp', email, password: 'kituo-cha-amani-2026', phone: hubPhone, profile: { mdp: { name: `Kituo ${u}`, zones: [`HZ${u}`], country: 'KE', location: { lat: -1.25, lng: 36.85 } } } }).expect(201)).body;
    const ask = app.get(OutboxMailSender).recent(email).find((m) => m.template === 'yes-it-is-me');
    await http().post('/v1/sbg/auth/link/confirm').send({ token: /#link=([A-Za-z0-9_-]+)/.exec(ask!.html)![1] }).expect(201);

    // The shop on a new phone first, then the hub on a new phone within the minute: two challenges, each its own kind's.
    const shopAsk = (await http().post('/v1/sbg/auth/login').send({ email, password: 'duka-la-kona-2026', role: 'pudo' }).expect(403)).body.params;
    const hubAsk = (await http().post('/v1/sbg/auth/login').send({ email, password: 'kituo-cha-amani-2026', role: 'mdp' }).expect(403)).body.params;
    expect(hubAsk.challenge).not.toBe(shopAsk.challenge);
    const confirmed = (await http().post('/v1/sbg/auth/device').send({ challenge: hubAsk.challenge, code: hubAsk.code }).expect(201)).body;
    expect(confirmed).toMatchObject({ role: 'mdp', did: hub.did });

    // The hub's own phone cannot link a phone to the shop — the same owner's, but another account.
    const shopCode = (await http().post('/v1/sbg/auth/device/pair').send({ challenge: shopAsk.challenge }).expect(201)).body.pairCode;
    await http().post('/v1/sbg/account/pair').set({ authorization: `Bearer ${confirmed.token.access_token}` }).send({ code: shopCode, device: confirmed.device }).expect(404);
    expect((await http().post('/v1/sbg/auth/device/pair/status').send({ challenge: shopAsk.challenge }).expect(201)).body.linked).toBe(false);
  });
});
