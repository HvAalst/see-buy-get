import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';

/**
 * EVERY PASSWORD DOOR COUNTS ITS TRIES — through the booted application (the user, 2026-10-11: "the shop and hub need
 * limitation as well. AI getting smarter at hacking we need to bring security to a high level.").
 *
 * A limit per caller counts addresses, and a guesser with ten thousand of them is ten thousand polite callers. What
 * is proved here is the count nobody can spread out — the one against the ACCOUNT — at every door that takes a
 * password: a shop's and a hub's, a store's, network staff's, a company administrator's; that it says nothing about
 * who has an account; that its holder is told and has a way back that does not wait; that the passwords a guesser
 * tries first cannot be chosen; and, last, that one caller is stopped too.
 */
describe('every password door counts its tries, over the wire', () => {
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

  const HOURS = { open: '08:00', close: '18:00' };
  const aVerifiedNumber = async (u: string) => {
    const phone = `+2547${u}7`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    return phone;
  };
  const shopBody = (u: string, email: string, password: string, phone: string) => ({
    role: 'pudo',
    email,
    password,
    phone,
    profile: { agent: { shopName: `Duka Imara ${u}`, zone: `Z${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Mama Imara', nationalId: `ID-${u}`, mobile: phone, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } } },
  });
  const login = (email: string, password: string) => http().post('/v1/sbg/auth/login').send({ email, password });
  const lockedMails = (email: string) => app.get(OutboxMailSender).recent(email).filter((m) => m.template === 'password-locked');
  /** Type the wrong password `n` times and say what each was answered with. */
  const guess = async (door: (password: string) => request.Test, n: number) => {
    const answers: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await door(`not-it-${i}`);
      answers.push(`${r.status} ${r.body.code}`);
    }
    return answers;
  };
  const FOUR_WRONG_THEN_LOCKED = ['401 AUTH_FAILED', '401 AUTH_FAILED', '401 AUTH_FAILED', '401 AUTH_FAILED', '403 PASSWORD_LOCKED'];

  it('a shop: a password that is easy to guess cannot be chosen; five wrong ones lock the sign-in, the right one included; its holder is told, and a code to the address opens it at once', async () => {
    const u = digits();
    const email = `imara.${u}@shop.example`;
    const password = 'sukuma-wiki-na-ugali';
    const phone = await aVerifiedNumber(u);

    /* ---- what may be chosen ---- */
    const signup = (pw: string) => http().post('/v1/sbg/auth/signup').send(shopBody(u, email, pw, phone));
    expect((await signup('seven-7')).body.code).toBe('PASSWORD_TOO_SHORT');
    for (const easy of ['password123', 'Welcome2026!', '12345678', 'qwertyui', `imara${u}`, 'DukaImara1', 'Nairobi@2026']) {
      const refused = await signup(easy);
      expect([easy, refused.status, refused.body.code]).toEqual([easy, 400, 'PASSWORD_GUESSABLE']);
    }
    // None of those used the phone's verification up: the shop signs up with a password that passes.
    await signup(password).expect(201);
    await login(email, password).expect(201);

    /* ---- five wrong passwords ---- */
    expect(await guess((pw) => login(email, pw), 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
    // THE RIGHT PASSWORD IS REFUSED TOO: a lock that let it through would only tell a guesser when to stop.
    const shut = await login(email, password);
    expect([shut.status, shut.body.code]).toEqual([403, 'PASSWORD_LOCKED']);
    expect(shut.body.detail).toContain('try again in 15 minutes');
    expect(shut.body.token).toBeUndefined();
    // Every door this account has is the same lock: changing the password proves itself with the current one, and
    // the store's door takes the same address.
    expect((await http().post('/v1/sbg/auth/password').send({ email, password, newPassword: 'kachumbari-na-nyama' })).body.code).toBe('PASSWORD_LOCKED');
    expect((await http().post('/v1/sbg/vendors/session').send({ email, password })).body.code).toBe('PASSWORD_LOCKED');
    // More wrong tries while it is locked change nothing, and tell nobody anything new.
    expect((await login(email, 'still-guessing')).body.code).toBe('PASSWORD_LOCKED');

    /* ---- the holder is told, once ---- */
    const told = lockedMails(email);
    expect(told).toHaveLength(1);
    expect(told[0].subject).toBe('SeeBuyGet: your sign-in is locked after wrong passwords');
    expect(told[0].text).toContain('Nothing was opened');
    expect(told[0].text).toContain('I forgot my password');
    // It names no password that was tried.
    expect(told[0].text).not.toContain('not-it-');

    /* ---- the way back that does not wait: a code to the address ---- */
    const forgot = (await http().post('/v1/sbg/auth/forgot').send({ email }).expect(201)).body;
    // Sixty random bits: it was thirty-two, and the reset finds the account BY the code.
    expect(forgot.resetToken).toMatch(/^RST-[0-9A-HJKMNP-TV-Z]{12}$/);
    expect((await http().post('/v1/sbg/auth/reset').send({ token: forgot.resetToken, password: 'Welcome2026!' })).body.code).toBe('PASSWORD_GUESSABLE');
    expect((await http().post('/v1/sbg/auth/reset').send({ token: 'RST-000000000000', password: 'kachumbari-na-nyama' })).body.code).toBe('WINDOW_EXPIRED');
    await http().post('/v1/sbg/auth/reset').send({ token: forgot.resetToken.toLowerCase(), password: 'kachumbari-na-nyama' }).expect(201);
    // Open at once — and the old password is gone with the lock.
    await login(email, 'kachumbari-na-nyama').expect(201);
    expect((await login(email, password)).body.code).toBe('AUTH_FAILED');

    /* ---- a slip is not a lock: four wrong, the right one, four wrong again ---- */
    expect(await guess((pw) => login(email, pw), 3)).toEqual(['401 AUTH_FAILED', '401 AUTH_FAILED', '401 AUTH_FAILED']);
    await login(email, 'kachumbari-na-nyama').expect(201);
    expect(await guess((pw) => login(email, pw), 4)).toEqual(['401 AUTH_FAILED', '401 AUTH_FAILED', '401 AUTH_FAILED', '401 AUTH_FAILED']);
    await login(email, 'kachumbari-na-nyama').expect(201);
    expect(lockedMails(email)).toHaveLength(1);

    /* ---- a new password must pass the same rules ---- */
    const change = (newPassword: string) => http().post('/v1/sbg/auth/password').send({ email, password: 'kachumbari-na-nyama', newPassword });
    expect((await change('Arsenal2026')).body.code).toBe('PASSWORD_GUESSABLE');
    expect((await change(`imara.${u}`)).body.code).toBe('PASSWORD_GUESSABLE');
    await change('mchele-na-maharagwe').expect(201);
  });

  it('an address nobody holds is locked exactly as one somebody does: the door does not say who has an account', async () => {
    const u = digits();
    const nobody = `nobody.${u}@nowhere.example`;
    expect(await guess((pw) => login(nobody, pw), 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
    const shut = await login(nobody, 'anything-at-all');
    expect([shut.status, shut.body.code]).toEqual([403, 'PASSWORD_LOCKED']);
    expect(shut.body.detail).toContain('try again in 15 minutes');
    // Nobody is written to about it, and asking for a reset says what it says for everybody.
    expect(app.get(OutboxMailSender).recent(nobody)).toHaveLength(0);
    expect((await http().post('/v1/sbg/auth/forgot').send({ email: nobody }).expect(201)).body).toEqual({ sent: false });
  });

  it('a hub: the same door, the same count', async () => {
    const u = digits();
    const email = `hub.${u}@depot.example`;
    const password = 'mabati-na-misumari-4';
    const phone = await aVerifiedNumber(u);
    const signup = (pw: string) => http().post('/v1/sbg/auth/signup').send({ role: 'mdp', email, password: pw, phone, profile: { mdp: { name: `Ghala Kuu ${u}`, zones: [`H${u}`], country: 'KE', location: { lat: -1.3, lng: 36.9 } } } });
    expect((await signup('GhalaKuu2026')).body.code).toBe('PASSWORD_GUESSABLE');
    await signup(password).expect(201);
    expect(await guess((pw) => login(email, pw), 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
    expect((await login(email, password)).body.code).toBe('PASSWORD_LOCKED');
    expect(lockedMails(email)).toHaveLength(1);
    expect(lockedMails(email)[0].text).toContain('Hub app');
  });

  it('a store: at its sign-in, and from inside, where replacing its secret asks for the password', async () => {
    const u = digits();
    const email = `soko.${u}@store.example`;
    const password = 'vitenge-vya-pwani-8';
    expect((await http().post('/v1/sbg/vendors').send({ name: `Soko Letu ${u}`, email, password: 'SokoLetu2026' })).body.code).toBe('PASSWORD_GUESSABLE');
    const made = (await http().post('/v1/sbg/vendors').send({ name: `Soko Letu ${u}`, email, password }).expect(201)).body;
    const token = made.token.access_token as string;
    const rotate = (pw: string) => http().post(`/v1/sbg/vendors/${made.vendorId}/secret/rotate`).set(bearer(token)).send({ password: pw });
    // Two wrong at the sign-in and three from inside are five at one account.
    expect(await guess((pw) => http().post('/v1/sbg/vendors/session').send({ email, password: pw }), 2)).toEqual(['401 AUTH_FAILED', '401 AUTH_FAILED']);
    expect(await guess(rotate, 3)).toEqual(['403 PASSWORD_WRONG', '403 PASSWORD_WRONG', '403 PASSWORD_LOCKED']);
    expect((await rotate(password)).body.code).toBe('PASSWORD_LOCKED');
    expect((await http().post('/v1/sbg/vendors/session').send({ email, password })).body.code).toBe('PASSWORD_LOCKED');
    // The store is not signed out by any of it, and its secret was not replaced.
    const still = (await http().get(`/v1/sbg/vendors/${made.vendorId}`).set(bearer(token)).expect(200)).body;
    expect(still.secretRotatedAt).toBeUndefined();
    expect(lockedMails(email)).toHaveLength(1);
  });

  it('a store’s old door — its ID and its signing secret — is counted the same way, and says so in its own words', async () => {
    const u = digits();
    const old = (await http().post('/v1/sbg/vendors').send({ name: `Zamani ${u}` }).expect(201)).body;
    const bySecret = (secret: string) => http().post('/v1/sbg/vendors/login').send({ vendorId: old.vendorId, secret });
    await bySecret(old.secret).expect(201);
    expect(await guess(bySecret, 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
    const shut = await bySecret(old.secret);
    expect([shut.status, shut.body.code]).toEqual([403, 'PASSWORD_LOCKED']);
    expect(shut.body.detail).toContain('Too many wrong secrets');
    // A store with no account has no password to reset: it is not sent to a way back that is not there.
    expect(shut.body.detail).not.toContain('reset');
    // A store ID nobody has is locked the same way.
    expect(await guess((secret) => http().post('/v1/sbg/vendors/login').send({ vendorId: `ven_nosuch${u}`, secret }), 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
  });

  it('network staff and a company’s administrator: the same count, and a password that is easy to guess is refused however long it is', async () => {
    const u = digits();
    /* ---- staff ---- */
    const staffEmail = `zawadi-${u}@sbg.test`;
    const staff = (await http().post('/v1/sbg/operators').set(bearer(operator)).send({ email: staffEmail, name: `Zawadi Mwangi ${u}` }).expect(201)).body;
    const staffLogin = (pw: string) => http().post('/v1/sbg/operators/login').send({ email: staffEmail, password: pw });
    const staffChange = (newPassword: string) => http().post('/v1/sbg/operators/password').send({ email: staffEmail, password: staff.temporaryPassword, newPassword });
    expect((await staffChange('Password2026!')).body.code).toBe('PASSWORD_GUESSABLE');
    expect((await staffChange(`ZawadiMwangi${u}`)).body.code).toBe('PASSWORD_GUESSABLE');
    expect(await guess(staffLogin, 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
    const staffShut = await staffLogin(staff.temporaryPassword);
    expect(staffShut.body.code).toBe('PASSWORD_LOCKED');
    // What the console shows is this sentence: it says how long, and offers no reset — staff have none of their own.
    expect(staffShut.body.detail).toBe('Too many wrong passwords. This sign-in is locked: try again in 15 minutes.');
    expect((await staffChange('maji-ya-kunywa-safi')).body.code).toBe('PASSWORD_LOCKED');
    const staffTold = lockedMails(staffEmail);
    expect(staffTold).toHaveLength(1);
    // Staff cannot reset their own: the email does not send them to a button that is not there.
    expect(staffTold[0].text).not.toContain('I forgot my password');
    expect(staffTold[0].text).toContain('Tell a colleague');

    /* ---- a company's administrator ---- */
    const adminEmail = `admin.${u}@sbg-ke.example`;
    const admin = (await http().post('/v1/sbg/entities/sbg-ke/admins').set(bearer(operator)).send({ email: adminEmail, name: `Otieno Odhiambo ${u}` }).expect(201)).body;
    const adminLogin = (pw: string) => http().post('/v1/sbg/entities/admins/login').send({ email: adminEmail, password: pw });
    const adminChange = (newPassword: string) => http().post('/v1/sbg/entities/admins/password').send({ email: adminEmail, password: admin.temporaryPassword, newPassword });
    expect((await adminChange('Seebuyget2026!')).body.code).toBe('PASSWORD_GUESSABLE');
    await adminLogin(admin.temporaryPassword).expect(201);
    expect(await guess(adminLogin, 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
    expect((await adminLogin(admin.temporaryPassword)).body.code).toBe('PASSWORD_LOCKED');
    expect((await adminChange('maji-ya-kunywa-safi')).body.code).toBe('PASSWORD_LOCKED');
    expect(lockedMails(adminEmail)).toHaveLength(1);
    // An administrator nobody made is locked the same way.
    expect(await guess((pw) => http().post('/v1/sbg/entities/admins/login').send({ email: `ghost.${u}@sbg-ke.example`, password: pw }), 5)).toEqual(FOUR_WRONG_THEN_LOCKED);
  });

  it('does the same work to refuse an address nobody holds as to refuse a wrong password: how long an answer takes says nothing about who has an account', async () => {
    const u = digits();
    const shop = `kazi.${u}@shop.example`;
    const phone = await aVerifiedNumber(u);
    await http().post('/v1/sbg/auth/signup').send(shopBody(u, shop, 'mahindi-ya-kuchoma-3', phone)).expect(201);
    const store = `kazi.${u}@store.example`;
    await http().post('/v1/sbg/vendors').send({ name: `Kazi Store ${u}`, email: store, password: 'mahindi-ya-kuchoma-3' }).expect(201);
    const staff = `kazi-${u}@sbg.test`;
    await http().post('/v1/sbg/operators').set(bearer(operator)).send({ email: staff, name: `Kazi ${u}` }).expect(201);
    const admin = `kazi.${u}@sbg-ke.example`;
    await http().post('/v1/sbg/entities/sbg-ke/admins').set(bearer(operator)).send({ email: admin, name: `Kazi ${u}` }).expect(201);
    const nobody = `hakuna.${u}@nowhere.example`;

    // The slow part of checking a password is one key derivation. Counted here, where a clock would only be noise.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const derive = jest.spyOn(require('crypto') as typeof import('crypto'), 'scryptSync');
    const work = async (door: () => request.Test) => {
      derive.mockClear();
      const answered = await door();
      return `${answered.status} after ${derive.mock.calls.length}`;
    };
    try {
      const wrong = 'not-the-one';
      const doors: Array<[string, (email: string) => request.Test]> = [
        ['the shops’ and hubs’ door', (email) => login(email, wrong)],
        ['the stores’ door', (email) => http().post('/v1/sbg/vendors/session').send({ email, password: wrong })],
        ['changing a password', (email) => http().post('/v1/sbg/auth/password').send({ email, password: wrong, newPassword: 'kitu-kipya-kabisa-1' })],
        ['the staff door', (email) => http().post('/v1/sbg/operators/login').send({ email, password: wrong })],
        ['the company door', (email) => http().post('/v1/sbg/entities/admins/login').send({ email, password: wrong })],
      ];
      const said: Record<string, string[]> = {};
      for (const [name, door] of doors) {
        said[name] = [];
        // Somebody's of each kind, then nobody's: at every door, each is one derivation and the same answer.
        for (const email of [shop, store, staff, admin, nobody]) said[name].push(await work(() => door(email)));
      }
      for (const [name] of doors) expect([name, said[name]]).toEqual([name, Array(5).fill('401 after 1')]);
    } finally {
      derive.mockRestore();
    }
  });

  // LAST IN THIS FILE ON PURPOSE: it uses up this caller's tries at the shops' and hubs' door.
  it('one caller working through many accounts is stopped too: sixty tries in a quarter of an hour at the shops’ and hubs’ door', async () => {
    const u = digits();
    const email = `mwisho.${u}@shop.example`;
    const password = 'ndizi-na-machungwa-6';
    const phone = await aVerifiedNumber(u);
    await http().post('/v1/sbg/auth/signup').send(shopBody(u, email, password, phone)).expect(201);

    // One wrong try each at sixty-one different accounts: never enough to lock any one of them.
    const answers: number[] = [];
    for (let i = 0; i < 61; i++) answers.push((await login(`spray.${u}.${i}@shop.example`, 'Welcome2026!')).status);
    expect(answers.every((s) => s === 401 || s === 429)).toBe(true);
    expect(answers[0]).toBe(401);
    expect(answers[answers.length - 1]).toBe(429);
    // Sixty at most were looked at — this file's earlier tries at this door count too.
    expect(answers.filter((s) => s === 401).length).toBeLessThanOrEqual(60);
    // And the caller who then has the RIGHT password for a real account learns nothing from it.
    const shut = await login(email, password);
    expect([shut.status, shut.body.code]).toEqual([429, 'RATE_LIMITED']);
    expect(shut.body.token).toBeUndefined();
  });
});
