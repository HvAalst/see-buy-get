import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/modules/pudo/otp.service';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';
import { EmailCodeService } from '../src/modules/pudo/email-code.service';
import { AGREED } from './agreed';

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
    const made = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin, email, emailCode: mailed.body.code }).expect(201)).body as { token: { access_token: string }; device: string; personId: string };
    return { ...made, email };
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
    const choose = (pin: string) => http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin, email, emailCode: mailed.body.code });
    // Four was the length of a PIN. It is the length of a mobile-money PIN and a bank card's — not of this one.
    for (const pin of ['2468', '246890', 'abcde', '']) expect([pin, await said(choose(pin))]).toEqual([pin, '400 PIN_INVALID']);
    for (const pin of ['12345', '00000', '13579', '12312', '02580']) expect([pin, await said(choose(pin))]).toEqual([pin, '400 PIN_GUESSABLE']);
    // Said BEFORE an email is asked for: a PIN that will not do is not found out a step later, on a screen with no
    // PIN field on it. A PIN that will do, and no email yet, is asked for the email.
    const withoutEmail = (pin: string) => http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin });
    expect(await said(withoutEmail('12345'))).toBe('400 PIN_GUESSABLE');
    expect(await said(withoutEmail('2468'))).toBe('400 PIN_INVALID');
    expect(await said(withoutEmail(PIN))).toBe('400 FIELD_REQUIRED');
    // …but not before the phone: somebody who has not typed the code is told that, whatever PIN they sent.
    expect(await said(http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone: `+2547${digits()}0`, pin: '12345' }))).toBe('400 PHONE_NOT_VERIFIED');
    // None of those spent the code: the person chooses again and is in.
    const chosen = await choose(PIN).expect(201);
    expect(chosen.body.device).toMatch(/^dvc_[0-9a-f]{64}$/);
    expect(chosen.body.hasPin).toBe(true);
    // The other way a PIN is chosen — changing it, signed in — refuses the same ones, and leaves the PIN as it was.
    const change = (newPin: string) => http().post('/v1/sbg/account/pin/change').set(bearer(chosen.body.token.access_token)).send({ currentPin: PIN, newPin });
    for (const pin of ['13579', '2468']) expect([pin, (await change(pin)).status]).toEqual([pin, 400]);
    expect((await change('13579')).body.code).toBe('PIN_GUESSABLE');
    await login({ phone, pin: PIN, device: chosen.body.device }).expect(201);
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
    const theirs = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone: lost, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body;
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

    // Forgotten, ON A DEVICE THE PIN WORKED ON: the code to the number again, and a new PIN.
    await typeTheCode(phone);
    const again = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '73914', device: tablet }).expect(201)).body;
    expect(again.personId).toBe(before.personId);
    // It works on the device that did it — a new key, because every key from before went with the old PIN.
    for (const device of [before.device, tablet]) expect(await said(login({ phone, pin: '73914', device }))).toBe('403 DEVICE_NOT_KNOWN');
    await login({ phone, pin: '73914', device: again.device }).expect(201);
    // The old PIN is gone with it, wherever it is tried.
    expect(await said(login({ phone, pin: PIN, device: again.device }))).toBe('401 AUTH_FAILED');
    // The holder is told, in their inbox: if it was not them, it is the only way they find out.
    const told = app.get(OutboxMailSender).recent(before.email).filter((m) => m.subject.includes('PIN was replaced'));
    expect(told).toHaveLength(1);
    expect(told[0].text).toContain('on a phone or browser you had signed in on before');
    expect(told[0].text).toContain('forgot your PIN');
  });

  it('a PIN replaced on a phone or browser it NEVER worked on needs the code to the recovery email as well', async () => {
    const phone = `+2547${digits()}0`;
    const before = await signUp(phone);
    const replace = (body: Record<string, unknown>) => http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '73914', ...body });
    const refused = async (r: request.Test) => {
      const answer = await r;
      return `${answer.status} ${answer.body.code} ${answer.body.params?.field ?? ''} ${answer.body.params?.why ?? ''}`.trim();
    };
    const emailCode = async (email: string) => {
      (app.get(EmailCodeService) as unknown as { rates: Map<string, unknown> }).rates.clear();
      return (await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201)).body.code as string;
    };

    // Somebody with the code to the number, and no device of this account's: the SIM today, or the handset for a minute.
    await typeTheCode(phone);
    expect(await refused(replace({}))).toBe('400 FIELD_REQUIRED email pin-reset');
    expect(await refused(replace({ device: 'dvc_made-up' }))).toBe('400 FIELD_REQUIRED email pin-reset');
    // An inbox of their own, confirmed by its code, is an inbox — not this account's.
    const theirs = `somebody.${digits()}@example.com`;
    expect(await refused(replace({ email: theirs, emailCode: await emailCode(theirs) }))).toBe('403 FORBIDDEN email pin-reset');
    // The account's address without its code.
    expect(await refused(replace({ email: before.email }))).toBe('400 EMAIL_NOT_VERIFIED emailCode pin-reset');
    // NOTHING WAS CHANGED OR SPENT: the old PIN on the old device, and nobody was written to about a PIN.
    await login({ phone, pin: PIN, device: before.device }).expect(201);
    expect(app.get(OutboxMailSender).recent(before.email).filter((m) => m.subject.includes('PIN was replaced'))).toHaveLength(0);

    // Both codes: replaced, here and nowhere else — and the holder is told which kind of device it was.
    const replaced = (await replace({ email: before.email.toUpperCase(), emailCode: await emailCode(before.email) }).expect(201)).body;
    expect(replaced.personId).toBe(before.personId);
    await login({ phone, pin: '73914', device: replaced.device }).expect(201);
    expect(await said(login({ phone, pin: '73914', device: before.device }))).toBe('403 DEVICE_NOT_KNOWN');
    const told = app.get(OutboxMailSender).recent(before.email).filter((m) => m.subject.includes('PIN was replaced'));
    expect(told).toHaveLength(1);
    expect(told[0].text).toContain('had not signed in to it before');
  });

  it('the holder is told when their PIN starts working on a new phone or browser', async () => {
    const phone = `+2547${digits()}9`;
    const mine = await signUp(phone);
    const news = () => app.get(OutboxMailSender).recent(mine.email).filter((m) => m.subject.includes('new phone or browser'));
    // Signing up is not news to the person signing up: not in their inbox, and not in the app.
    const inApp = async () => JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(bearer(mine.token.access_token)).expect(200)).body);
    expect(news()).toHaveLength(0);
    expect(await inApp()).not.toContain('A new phone or browser can use your PIN');
    expect(await inApp()).not.toContain('Your PIN was replaced');
    await typeTheCode(phone);
    await http().post('/v1/sbg/identity/device').send({ phone }).expect(201);
    expect(news()).toHaveLength(1);
    expect(news()[0].text).toContain('Your PIN now works there too');
    // The same in the app, where the person is.
    const inbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(mine.token.access_token)).expect(200)).body;
    expect(JSON.stringify(inbox)).toContain('A new phone or browser can use your PIN');
  });

  it('Settings shows the phones and browsers a PIN works on; the others are forgotten with the PIN, this one without', async () => {
    const phone = `+2547${digits()}7`;
    const first = await signUp(phone);
    const otherPhone = `+2547${digits()}8`;
    const other = await signUp(otherPhone);
    await typeTheCode(phone);
    const second = (await http().post('/v1/sbg/identity/device').send({ phone }).expect(201)).body.device as string;
    const signIn = async (device: string) => (await login({ phone, pin: PIN, device }).expect(201)).body.token.access_token as string;
    const devices = (token: string, body: Record<string, unknown>) => http().post('/v1/sbg/account/pin-devices').set(bearer(token)).send(body);
    const forgetOthers = (token: string, body: Record<string, unknown>) => http().post('/v1/sbg/account/pin-devices/forget-others').set(bearer(token)).send(body);
    const forgetThis = (token: string, body: Record<string, unknown>) => http().post('/v1/sbg/account/pin-devices/forget-this').set(bearer(token)).send(body);

    // Asked from the second device, whose browser also holds a key for another number that signed in on it.
    const onSecond = await signIn(second);
    const seen = (await devices(onSecond, { devices: [other.device, 'dvc_made-up', second] }).expect(201)).body;
    expect(seen).toMatchObject({ count: 2, here: true, unusedDays: 90 });
    // The one last used first — this one, a moment ago — and each as dates only.
    expect(seen.devices.map((d: { here: boolean }) => d.here)).toEqual([true, false]);
    expect(Object.keys(seen.devices[0]).sort()).toEqual(['addedAt', 'here', 'usedAt']);
    expect(JSON.stringify(seen)).not.toMatch(/dvc_|[0-9a-f]{40}/);
    // With no key, or only somebody else's, none of them is "this one" — and somebody else's are not counted in.
    expect((await devices(onSecond, {}).expect(201)).body).toMatchObject({ count: 2, here: false });
    expect((await devices(onSecond, { devices: [other.device] }).expect(201)).body).toMatchObject({ count: 2, here: false });
    // Nobody signed in is told nothing, and staff are not a person whose devices these are.
    await http().post('/v1/sbg/account/pin-devices').send({ devices: [second] }).expect(401);
    expect((await devices(operator, { devices: [second] })).status).toBeGreaterThanOrEqual(400);
    // A body that is not a list of keys is refused before anything is looked at.
    await devices(onSecond, { devices: 'dvc_one' }).expect(400);
    await devices(onSecond, { devices: Array.from({ length: 21 }, () => second) }).expect(400);

    // FORGET THE OTHERS. A wrong PIN is a wrong PIN — a 403, so the session stands — and forgets nothing.
    expect(await said(forgetOthers(onSecond, { pin: '73914', devices: [second] }))).toBe('403 PIN_WRONG');
    await forgetOthers(onSecond, { devices: [second] }).expect(400);
    expect((await devices(onSecond, { devices: [second] }).expect(201)).body.count).toBe(2);
    expect((await forgetOthers(onSecond, { pin: PIN, devices: [other.device, second] }).expect(201)).body).toEqual({ forgotten: 1, kept: true, signedOutEverywhere: true });
    // Every session is over, this one too; the forgotten phone needs a code; this one signs back in with its PIN.
    await devices(onSecond, { devices: [second] }).expect(401);
    await http().get('/v1/sbg/account/me').set(bearer(first.token.access_token)).expect(401);
    expect(await said(login({ phone, pin: PIN, device: first.device }))).toBe('403 DEVICE_NOT_KNOWN');
    const again = await signIn(second);
    expect((await devices(again, { devices: [second] }).expect(201)).body).toMatchObject({ count: 1, here: true });
    // Nobody else's device went with it.
    await login({ phone: otherPhone, pin: PIN, device: other.device }).expect(201);

    // FORGET THIS ONE: no PIN, and it says which of the browser's keys it was, so the browser drops its copy.
    expect((await forgetThis(again, { devices: [other.device, second] }).expect(201)).body).toEqual({ forgotten: true, which: 1 });
    expect(await said(login({ phone, pin: PIN, device: second }))).toBe('403 DEVICE_NOT_KNOWN');
    // The session it was asked from is not ended by the server (the app drops it): asked again, there is nothing to forget.
    expect((await forgetThis(again, { devices: [other.device, second] }).expect(201)).body).toEqual({ forgotten: false, which: -1 });
    expect((await devices(again, { devices: [second] }).expect(201)).body).toMatchObject({ count: 0, here: false });
  });
});
