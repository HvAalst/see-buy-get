import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxSmsSender } from '../src/foundation/sms/outbox-sms.sender';

/**
 * A SHOP'S SIGN-IN WORKS ONLY ON ITS OWN PHONES (the user, 2026-10-18: "who is at the counter") — over the wire.
 *
 * The phone a shop signs up on is its first. Its email and password typed anywhere else open nothing until a code
 * texted to the shop's number is typed there. The shop sees its phones in Settings and forgets them; staff do not.
 */
describe('a shop’s own phones, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('works on the phone it signed up on, asks a code to the shop’s number anywhere else, and lists and forgets its phones', async () => {
    const u = digits();
    const phone = `+2547${u}3`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const HOURS = { open: '08:00', close: '18:00' };
    const email = `kona.${u}@shop.example`;
    const password = 'duka-la-kona-2026';
    const made = await http()
      .post('/v1/sbg/auth/signup')
      .send({ role: 'pudo', email, password, phone, profile: { agent: { shopName: `Kona ${u}`, zone: `Z${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Kona Shop', nationalId: `ID-${u}`, mobile: phone, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } } } })
      .expect(201);
    const first = made.body.device as string;
    expect(first).toMatch(/^dvc_/);
    const login = (device?: string, pw = password) => http().post('/v1/sbg/auth/login').send({ email, password: pw, ...(device ? { device } : {}) });

    // The phone it signed up on.
    const onFirst = (await login(first).expect(201)).body.token.access_token as string;
    // Anywhere else: the right password opens nothing — a code went to the shop's number.
    const elsewhere = await login().expect(403);
    expect(elsewhere.body).toMatchObject({ code: 'DEVICE_NOT_KNOWN', params: { challenge: expect.stringMatching(/^dc_/), sentTo: `•••${phone.slice(-3)}`, code: expect.stringMatching(/^\d{6}$/) } });
    expect(app.get(OutboxSmsSender).recent(phone).some((m) => m.body.includes(elsewhere.body.params.code))).toBe(true);
    // A wrong password still says only that: nothing about phones, nothing sent.
    expect((await login(undefined, 'not-it-at-all')).body.code).toBe('AUTH_FAILED');

    // The code, typed on the new browser: it is one of the shop's, and signed in.
    const { challenge, code } = elsewhere.body.params as { challenge: string; code: string };
    await http().post('/v1/sbg/auth/device').send({ challenge, code: code === '000000' ? '111111' : '000000' }).expect(400);
    const confirmed = (await http().post('/v1/sbg/auth/device').send({ challenge, code }).expect(201)).body;
    const second = confirmed.device as string;
    expect(second).toMatch(/^dvc_/);
    expect(second).not.toBe(first);
    await http().post('/v1/sbg/auth/device').send({ challenge, code }).expect(400); // one code, one phone
    const onSecond = (await login(second).expect(201)).body.token.access_token as string;

    // The shop's own list: two phones, this one marked. Staff are refused by name.
    const listed = (await http().post('/v1/sbg/account/shop-devices').set(bearer(onSecond)).send({ device: second }).expect(201)).body;
    expect(listed).toMatchObject({ count: 2, here: true, unusedDays: 90 });
    expect(listed.devices.filter((d: { here: boolean }) => d.here)).toHaveLength(1);
    expect((await http().post('/v1/sbg/account/shop-devices').set(bearer(operator)).send({ device: second }).expect(403)).body.detail).toMatch(/the shop’s own/);

    // Every other phone forgotten, with the password: the first asks for a code again, and its sign-in has ended.
    await http().post('/v1/sbg/account/shop-devices/forget-others').set(bearer(onSecond)).send({ password: 'wrong-one-here', device: second }).expect(401);
    const fresh = (await http().post('/v1/sbg/account/shop-devices/forget-others').set(bearer(onSecond)).send({ password, device: second }).expect(201)).body;
    expect(fresh).toMatchObject({ signedOutEverywhere: true, token: { access_token: expect.any(String) } });
    expect((await login(first)).body.code).toBe('DEVICE_NOT_KNOWN');
    await http().post('/v1/sbg/account/shop-devices').set(bearer(onFirst)).send({}).expect(401);

    // A password change hands back a sign-in: from an unknown phone it is refused — after the password, never before.
    expect((await http().post('/v1/sbg/auth/password').send({ email, password: 'wrong-one-here', newPassword: 'kitu-kipya-kabisa-1' })).body.code).toBe('AUTH_FAILED');
    expect((await http().post('/v1/sbg/auth/password').send({ email, password, newPassword: 'kitu-kipya-kabisa-1' })).body.code).toBe('DEVICE_NOT_KNOWN');

    // This one forgotten too: then it asks for a code.
    await http().post('/v1/sbg/account/shop-devices/forget-this').set(bearer(fresh.token.access_token)).send({ device: second }).expect(201);
    expect((await login(second)).body.code).toBe('DEVICE_NOT_KNOWN');
  });
});
