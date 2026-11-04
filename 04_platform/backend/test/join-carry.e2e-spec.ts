import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/modules/pudo/otp.service';
import { AGREED } from './agreed';

/**
 * ANOTHER SIGN-UP, STARTED FROM A SIGNED-IN APP ON THE SAME PHONE (the owner, 2026-11-04: "I am in the hub, click 'all sbg
 * apps' then select fleet and sign up. The phone number, name etc is not prefilled" — then: "Phone, name, email, country",
 * and the text code skipped) — over the wire.
 */
describe('a sign-up carried from a signed-in app, over the wire', () => {
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

  it('carries the number, the email, the name and the country — from one of its own phones, once, the number checked', async () => {
    const u = digits();
    const email = `wanjiku.${u}@example.com`;
    const phone = `+2547${u}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const profile = {
      agent: { shopName: `Duka ${u}`, zone: `Z${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Wanjiku Njeri', nationalId: `ID-${u}`, mobile: phone, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } },
    };
    const shop = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'pudo', email, password: 'duka-la-wanjiku-2026', phone, profile }).expect(201)).body;
    const signedIn = (await http().post('/v1/sbg/auth/login').send({ email, password: 'duka-la-wanjiku-2026', device: shop.device, role: 'pudo' }).expect(201)).body;
    const bearer = { authorization: `Bearer ${signedIn.token.access_token}` };
    const me = (await http().get('/v1/sbg/account/me').set(bearer).expect(200)).body;
    const otp = app.get(OtpService);
    expect(otp.isVerified(phone)).toBe(false); // spent by the shop's own sign-up

    // Nobody signed out carries anything; nor a phone that is not one of the shop's.
    await http().post('/v1/sbg/account/my-apps/carry').send({ device: shop.device }).expect(401);
    expect((await http().post('/v1/sbg/account/my-apps/carry').set(bearer).send({ device: 'dvc_not-one-of-the-shops' }).expect(403)).body.code).toBe('DEVICE_NOT_KNOWN');

    const { code, expiresIn } = (await http().post('/v1/sbg/account/my-apps/carry').set(bearer).send({ device: shop.device }).expect(201)).body;
    expect(code).toMatch(/^jc_/);
    expect(expiresIn).toBe(600);

    // The front page takes it, once: the details, and the number counted as checked — no text code asked.
    const taken = (await http().post('/v1/sbg/auth/join-carry').send({ code }).expect(201)).body;
    // The picture menu has no name for a shop: its owner's, as the shop was signed up with.
    expect(me.displayName).toBeUndefined();
    expect(taken).toEqual({ email, phone, name: 'Wanjiku Njeri', country: 'KE', phoneChecked: true });
    expect(otp.isVerified(phone)).toBe(true);
    expect((await http().post('/v1/sbg/auth/join-carry').send({ code }).expect(400)).body.code).toBe('OTP_INVALID');
    expect((await http().post('/v1/sbg/auth/join-carry').send({ code: 'jc_made-up' }).expect(400)).body.code).toBe('OTP_INVALID');
  });
});
