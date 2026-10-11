import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/modules/pudo/otp.service';
import { EmailCodeService } from '../src/modules/pudo/email-code.service';

/**
 * A PIN WORKS ONLY ON A DEVICE A CODE TO THE PHONE CONFIRMED — through the booted application (the user, 2026-10-11:
 * "I thought that the pin was unique to the device. so indeed only after a new sign in and a pin setup, the pin could
 * unlock the app. also a five digit pin is safer").
 *
 * It was not: a phone number and its PIN signed in from anywhere, so a PIN was something anybody on the internet
 * could try five times against every phone there is. What is proved here: without the key a device is handed when
 * the code is typed on it, the PIN is never looked at — at any of the doors that take one — and nothing is counted;
 * a new device is confirmed by the code and by nothing else; a PIN replaced by a code leaves every other device
 * behind; and a PIN is five digits, not the four of the one people already have for their money.
 */
describe('a PIN works only on a device a code to the phone confirmed, over the wire', () => {
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

  /** The code to a phone, typed back. (A second code to one number inside a minute is refused; that minute is not what is proved here.) */
  const typeTheCode = async (phone: string) => {
    (app.get(OtpService) as unknown as { rates: Map<string, unknown> }).rates.clear();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
  };
  /** Somebody signs up on a device: the code, a PIN, a confirmed recovery email. */
  const signUp = async (phone: string, pin = PIN) => {
    await typeTheCode(phone);
    const email = `pd${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    return (await http().post('/v1/sbg/identity/enroll').send({ phone, pin, email, emailCode: mailed.body.code }).expect(201)).body as { token: { access_token: string }; device: string; personId: string };
  };
  const login = (body: Record<string, unknown>) => http().post('/v1/sbg/identity/login').send(body);
  const said = async (r: request.Test) => {
    const answer = await r;
    return `${answer.status} ${answer.body.code ?? 'in'}`;
  };

  it('a PIN is five digits, and not one that is easy to guess', async () => {
    const phone = `+2547${digits()}2`;
    await typeTheCode(phone);
    const email = `pd${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const choose = (pin: string) => http().post('/v1/sbg/identity/enroll').send({ phone, pin, email, emailCode: mailed.body.code });
    // Four was the length of a PIN. It is the length of a mobile-money PIN and a bank card's — not of this one.
    for (const pin of ['2468', '246890', 'abcde', '']) expect([pin, await said(choose(pin))]).toEqual([pin, '400 PIN_INVALID']);
    for (const pin of ['12345', '00000', '13579', '12312', '02580']) expect([pin, await said(choose(pin))]).toEqual([pin, '400 PIN_GUESSABLE']);
    // None of those spent the code: the person chooses again and is in.
    const chosen = await choose(PIN).expect(201);
    expect(chosen.body.device).toMatch(/^dvc_[0-9a-f]{64}$/);
    expect(chosen.body.hasPin).toBe(true);
  });

  it('the PIN is not looked at without the device’s key: not the right one, not a wrong one, and nothing is counted', async () => {
    const phone = `+2547${digits()}3`;
    const mine = await signUp(phone);
    const other = await signUp(`+2547${digits()}4`);

    // No key, a made-up key, and a real key that is somebody else's: one answer, whatever the PIN.
    for (const device of [undefined, 'dvc_made-up', other.device]) {
      for (const pin of [PIN, '00000', '73914']) {
        expect([device, pin, await said(login({ phone, pin, device }))]).toEqual([device, pin, '403 DEVICE_NOT_KNOWN']);
      }
    }
    // A number nobody has is answered the same way: the door does not say who has an account.
    expect(await said(login({ phone: `+2547${digits()}9`, pin: PIN }))).toBe('403 DEVICE_NOT_KNOWN');
    expect(await said(login({ phone: `+2547${digits()}9`, pin: PIN, device: mine.device }))).toBe('403 DEVICE_NOT_KNOWN');

    // NINE TRIES FROM NOWHERE LOCKED NOTHING: on its own device the right PIN is still let in…
    const back = await login({ phone, pin: PIN, device: mine.device }).expect(201);
    expect(back.body.personId).toBe(mine.personId);
    // …and there a wrong PIN is a wrong PIN, counted as it always was: the fifth locks it, the right one included.
    const wrong: string[] = [];
    for (let i = 0; i < 5; i++) wrong.push(await said(login({ phone, pin: '00000', device: mine.device })));
    expect(wrong).toEqual(['401 AUTH_FAILED', '401 AUTH_FAILED', '401 AUTH_FAILED', '401 AUTH_FAILED', '403 PIN_LOCKED']);
    expect(await said(login({ phone, pin: PIN, device: mine.device }))).toBe('403 PIN_LOCKED');
  });

  it('every door that takes a PIN asks for the device first: a driver’s, a fleet office’s, and changing a PIN', async () => {
    const phone = `+2547${digits()}5`;
    const driver = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Baraka', fullName: 'Baraka Rider', nationalId: `ID-PD-${digits()}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' }).expect(201);
    const mine = await signUp(phone);

    const doors: Array<[string, (device?: string) => request.Test]> = [
      ['a driver signing in', (device) => http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device })],
      ['a fleet office asking which fleets are theirs', (device) => http().post('/v1/sbg/fleet/managers/mine').send({ phone, pin: PIN, device })],
      ['changing a PIN with the current one', (device) => http().post('/v1/sbg/identity/pin/change').send({ phone, pin: PIN, newPin: '73914', device })],
    ];
    for (const [name, door] of doors) {
      expect([name, await said(door())]).toEqual([name, '403 DEVICE_NOT_KNOWN']);
      expect([name, await said(door('dvc_made-up'))]).toEqual([name, '403 DEVICE_NOT_KNOWN']);
    }
    // Nothing was changed by the refused change, and each door opens on the device the code was typed on.
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: mine.device }).expect(201);
    expect(session.body.did).toBe(driver.body.did);
    expect((await http().post('/v1/sbg/fleet/managers/mine').send({ phone, pin: PIN, device: mine.device }).expect(201)).body.fleets).toEqual([]);
    await http().post('/v1/sbg/identity/pin/change').send({ phone, pin: PIN, newPin: '73914', device: mine.device }).expect(201);
    // A PIN changed with the current one is still this device's: nothing to confirm again.
    await login({ phone, pin: '73914', device: mine.device }).expect(201);
  });

  it('a new device is confirmed by the code to the phone, and by nothing else; the account is as it was', async () => {
    const phone = `+2547${digits()}6`;
    const first = await signUp(phone);
    const confirm = () => http().post('/v1/sbg/identity/device').send({ phone });

    // Without the code: nothing. Knowing the number and the PIN is not holding the phone.
    expect(await said(confirm())).toBe('400 PHONE_NOT_VERIFIED');
    await typeTheCode(phone);
    const tablet = (await confirm().expect(201)).body.device as string;
    expect(tablet).toMatch(/^dvc_[0-9a-f]{64}$/);
    expect(tablet).not.toBe(first.device);
    // The code was used up by it: one code, one device.
    expect(await said(confirm())).toBe('400 PHONE_NOT_VERIFIED');

    // The same PIN, on both devices: confirming a device changed nothing about the account.
    for (const device of [first.device, tablet]) expect((await login({ phone, pin: PIN, device }).expect(201)).body.personId).toBe(first.personId);

    // A number with no account has no device to confirm — said to somebody who has just proved the number is theirs.
    const nobody = `+2547${digits()}7`;
    await typeTheCode(nobody);
    await http().post('/v1/sbg/identity/device').send({ phone: nobody }).expect(404);
  });

  it('a number that changes takes no device with it — except the one the change was made on, which typed the code to the new number', async () => {
    /* ---- changed from Settings, with the PIN and a code to the new number ---- */
    const phone = `+2547${digits()}1`;
    const mine = await signUp(phone);
    await typeTheCode(phone);
    const tablet = (await http().post('/v1/sbg/identity/device').send({ phone }).expect(201)).body.device as string;
    const moved = `+2541${digits()}1`;
    await typeTheCode(moved);
    const changed = (await http().post('/v1/sbg/account/phone/change').set(bearer(mine.token.access_token)).send({ pin: PIN, newPhone: moved }).expect(201)).body;
    expect(changed.device).toMatch(/^dvc_[0-9a-f]{64}$/);
    // The two devices from before open neither number; the one that made the change opens the new one.
    for (const device of [mine.device, tablet]) {
      for (const number of [phone, moved]) expect([number, await said(login({ phone: number, pin: PIN, device }))]).toEqual([number, '403 DEVICE_NOT_KNOWN']);
    }
    expect((await login({ phone: moved, pin: PIN, device: changed.device }).expect(201)).body.personId).toBe(mine.personId);

    /* ---- the number gone and the PIN forgotten: back in through the inbox, on a new number ---- */
    const lost = `+2547${digits()}0`;
    await typeTheCode(lost);
    const email = `pd-lost-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const theirs = (await http().post('/v1/sbg/identity/enroll').send({ phone: lost, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body;
    const found = `+2541${digits()}0`;
    await typeTheCode(found);
    // (An address, like a number, is sent one code a minute; that minute is not what is proved here.)
    (app.get(EmailCodeService) as unknown as { rates: Map<string, unknown> }).rates.clear();
    const inbox = await http().post('/v1/sbg/identity/account-code').send({ email, why: 'recover' }).expect(201);
    const recovered = (await http().post('/v1/sbg/identity/recover').send({ email, code: inbox.body.code, newPhone: found, pin: '73914' }).expect(201)).body;
    expect(recovered.device).toMatch(/^dvc_[0-9a-f]{64}$/);
    // The device that had the old number opens nothing; the one the recovery was done on opens the new number.
    expect(await said(login({ phone: found, pin: '73914', device: theirs.device }))).toBe('403 DEVICE_NOT_KNOWN');
    expect((await login({ phone: found, pin: '73914', device: recovered.device }).expect(201)).body.personId).toBe(theirs.personId);
  });

  it('a PIN replaced by a code — forgotten, or locked — works on the device that did it and on no other', async () => {
    const phone = `+2547${digits()}8`;
    const before = await signUp(phone);
    await typeTheCode(phone);
    const tablet = (await http().post('/v1/sbg/identity/device').send({ phone }).expect(201)).body.device as string;

    // Forgotten: the code again, and a new PIN, on some device.
    await typeTheCode(phone);
    const again = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '73914' }).expect(201)).body;
    expect(again.personId).toBe(before.personId);
    for (const device of [before.device, tablet]) expect(await said(login({ phone, pin: '73914', device }))).toBe('403 DEVICE_NOT_KNOWN');
    await login({ phone, pin: '73914', device: again.device }).expect(201);
    // The old PIN is gone with it, wherever it is tried.
    expect(await said(login({ phone, pin: PIN, device: again.device }))).toBe('401 AUTH_FAILED');
  });
});
