import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/modules/pudo/otp.service';
import { AGREED } from './agreed';
import { SoftAuthenticator } from './soft-authenticator';

/**
 * UNLOCK WITH FINGERPRINT OR FACE, OVER THE WIRE (the owner, 2026-11-02: "if face unlock works, integrate it, but then
 * in settings users should be able to undo it and get back to a preferred option").
 *
 * Through the booted application and its validation: turned on under Settings with the PIN; a sign-in screen asks for
 * a challenge, the phone (in software, test/soft-authenticator.ts) signs it, and the ticket that comes back opens the
 * app's own door — the Send app's, a driver's, a fleet office's — in the PIN's place, once. Turned off, or with its
 * device forgotten, it opens nothing and is offered nowhere; the PIN works as it always did.
 */
describe('unlock with fingerprint or face, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
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

  const typeTheCode = async (phone: string) => {
    (app.get(OtpService) as unknown as { rates: Map<string, unknown> }).rates.clear();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
  };
  const signUp = async (phone: string) => {
    await typeTheCode(phone);
    const email = `pk${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    return (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body as { token: { access_token: string }; device: string; personId: string };
  };
  const said = async (r: request.Test) => {
    const answer = await r;
    return `${answer.status} ${answer.body.code ?? 'in'}`;
  };
  /** Settings: the PIN, then the phone's answer. */
  const turnOn = async (token: string, device: string, phoneApp = new SoftAuthenticator()) => {
    const asked = await http().post('/v1/sbg/account/passkey/options').set(bearer(token)).send({ devices: [device], pin: PIN }).expect(201);
    const on = await http().post('/v1/sbg/account/passkey/on').set(bearer(token)).send({ devices: [device], response: phoneApp.register(asked.body.options) }).expect(201);
    expect(on.body).toMatchObject({ on: true, which: 0, id: phoneApp.id });
    return phoneApp;
  };
  /** A sign-in screen: a challenge, the phone's signature, a ticket. */
  const unlockTicket = async (phone: string, device: string, phoneApp: SoftAuthenticator): Promise<string> => {
    const options = (await http().post('/v1/sbg/identity/unlock/options').send({ phone, device }).expect(201)).body;
    const r = await http().post('/v1/sbg/identity/unlock').send({ phone, device, response: phoneApp.assert(options.challenge) }).expect(201);
    expect(r.body.expiresIn).toBe(120);
    return r.body.unlock as string;
  };

  it('turned on in Settings with the PIN; the ticket opens the Send app’s door, a driver’s and a fleet office’s — once each', async () => {
    const phone = `+2547${digits()}1`;
    const driver = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Wanjiru', fullName: 'Wanjiru Rider', nationalId: `ID-PK-${digits()}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' }).expect(201);
    const me = await signUp(phone);
    const token = me.token.access_token;

    expect((await http().post('/v1/sbg/account/passkey').set(bearer(token)).send({ devices: [me.device] }).expect(201)).body).toEqual({ on: false, which: 0 });
    // The PIN again, counted as at the door: a wrong one turns nothing on and is not a sign-out (403, not 401).
    expect(await said(http().post('/v1/sbg/account/passkey/options').set(bearer(token)).send({ devices: [me.device], pin: '00000' }))).toBe('403 PIN_WRONG');
    const phoneApp = await turnOn(token, me.device);
    expect((await http().post('/v1/sbg/account/passkey').set(bearer(token)).send({ devices: [me.device] }).expect(201)).body).toMatchObject({ on: true, id: phoneApp.id });

    // The Send app's door (identity/login): the ticket in the PIN's place — and once.
    const ticket = await unlockTicket(phone, me.device, phoneApp);
    const send = await http().post('/v1/sbg/identity/login').send({ phone, unlock: ticket, device: me.device }).expect(201);
    expect(send.body.personId).toBe(me.personId);
    expect(await said(http().post('/v1/sbg/identity/login').send({ phone, unlock: ticket, device: me.device }))).toBe('401 UNLOCK_FAILED');
    // Neither a PIN nor a ticket: refused by the door's own rules, before anything is looked at.
    expect((await http().post('/v1/sbg/identity/login').send({ phone, device: me.device })).status).toBe(400);

    // A driver's door.
    const drive = await http().post('/v1/sbg/drivers/session').send({ phone, unlock: await unlockTicket(phone, me.device, phoneApp), device: me.device }).expect(201);
    expect(drive.body.did).toBe(driver.body.did);

    // A fleet office's "which fleets are mine" mints nothing: it hands on a fresh ticket for the sign-in that follows.
    const mineTicket = await unlockTicket(phone, me.device, phoneApp);
    const mine = await http().post('/v1/sbg/fleet/managers/mine').send({ phone, unlock: mineTicket, device: me.device }).expect(201);
    expect(mine.body.fleets).toEqual([]);
    expect(mine.body.unlock).toMatch(/^unl_[0-9a-f]{64}$/);
    expect(mine.body.unlock).not.toBe(mineTicket);
    expect(await said(http().post('/v1/sbg/fleet/managers/mine').send({ phone, unlock: mineTicket, device: me.device }))).toBe('401 UNLOCK_FAILED');
    await http().post('/v1/sbg/identity/login').send({ phone, unlock: mine.body.unlock, device: me.device }).expect(201);

    // The PIN works as it always did.
    await http().post('/v1/sbg/identity/login').send({ phone, pin: PIN, device: me.device }).expect(201);
  });

  it('asking tells a stranger nothing; another device is offered nothing and opens nothing', async () => {
    const phone = `+2547${digits()}2`;
    const me = await signUp(phone);
    const phoneApp = await turnOn(me.token.access_token, me.device);
    const ask = (body: Record<string, unknown>) => http().post('/v1/sbg/identity/unlock/options').send(body).expect(201).then((r) => r.body as Record<string, unknown>);
    const strangers = [await ask({ phone: `+2547${digits()}9` }), await ask({ phone }), await ask({ phone, device: 'dvc_made-up' }), await ask({ phone: `+2547${digits()}9`, device: me.device })];
    const mine = await ask({ phone, device: me.device });
    for (const s of strangers) {
      expect(Object.keys(s).sort()).toEqual(Object.keys(mine).sort());
      expect(s.allowCredentials).toEqual([]);
    }
    expect(mine.allowCredentials).toEqual([expect.objectContaining({ id: phoneApp.id })]);
    // Without this person's device key, the phone's answer is not even looked at.
    const options = await ask({ phone, device: me.device });
    expect(await said(http().post('/v1/sbg/identity/unlock').send({ phone, device: 'dvc_made-up', response: phoneApp.assert(options.challenge as string) }))).toBe('403 DEVICE_NOT_KNOWN');
  });

  it('turned off — or its device forgotten — it is offered nowhere and opens nothing; the PIN is the way in', async () => {
    const phone = `+2547${digits()}3`;
    const me = await signUp(phone);
    const token = me.token.access_token;
    const phoneApp = await turnOn(token, me.device);
    const held = await unlockTicket(phone, me.device, phoneApp);

    const off = await http().post('/v1/sbg/account/passkey/off').set(bearer(token)).send({ devices: [me.device] }).expect(201);
    expect(off.body).toMatchObject({ on: false, which: 0, dropped: phoneApp.id, rpId: 'localhost' });
    expect(await said(http().post('/v1/sbg/identity/login').send({ phone, unlock: held, device: me.device }))).toBe('401 UNLOCK_FAILED');
    const options = (await http().post('/v1/sbg/identity/unlock/options').send({ phone, device: me.device }).expect(201)).body;
    expect(options.allowCredentials).toEqual([]);
    expect(await said(http().post('/v1/sbg/identity/unlock').send({ phone, device: me.device, response: phoneApp.assert(options.challenge) }))).toBe('403 UNLOCK_OFF');
    await http().post('/v1/sbg/identity/login').send({ phone, pin: PIN, device: me.device }).expect(201);

    // On again — then "Sign out, and forget this one" from the devices list takes it with the device.
    const again = await turnOn(token, me.device);
    await unlockTicket(phone, me.device, again);
    await http().post('/v1/sbg/account/pin-devices/forget-this').set(bearer(token)).send({ devices: [me.device] }).expect(201);
    expect((await http().post('/v1/sbg/identity/unlock/options').send({ phone, device: me.device }).expect(201)).body.allowCredentials).toEqual([]);
  });

  it('is a person’s own: staff turn nobody’s on or off', async () => {
    expect((await http().post('/v1/sbg/account/passkey').set(bearer(operator)).send({ devices: [] })).status).toBe(403);
    expect((await http().post('/v1/sbg/account/passkey/off').set(bearer(operator)).send({ devices: [] })).status).toBe(403);
    expect((await http().post('/v1/sbg/account/passkey')).status).toBe(401);
  });
});
