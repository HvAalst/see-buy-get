import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';

/**
 * A STORE HAS AN ACCOUNT OF ITS OWN — through the booted application (the user, 2026-10-09: "store needs a email and
 * password account setup").
 *
 * A store signed in to its console with its store id and its SIGNING SECRET: a machine credential doing a person's
 * job, kept on the device, and with no way back once it was lost. What is proved here is the replacement, door by
 * door: a store is registered WITH an email and a password and signs in with them; from then its secret signs
 * nobody in; a lost secret is replaced with the password; a store that already exists sets its account up itself —
 * and nobody sets it up for it.
 */
describe('a store has an account of its own, over the wire', () => {
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

  const stores = async () => ((await http().get('/v1/sbg/vendors').set(bearer(operator)).expect(200)).body as unknown[]).length;
  const session = (email: string, password: string) => http().post('/v1/sbg/vendors/session').send({ email, password });
  const bySecret = (vendorId: string, secret: string) => http().post('/v1/sbg/vendors/login').send({ vendorId, secret });

  it('a store is registered with an email and a password and signs in with them — and from then its secret signs nobody in', async () => {
    const u = digits();
    const email = `orders.${u}@dukabora.example`;
    const password = 'maziwa-lala-2026';
    const before = await stores();

    // An account that cannot be made leaves NO STORE behind it.
    expect((await http().post('/v1/sbg/vendors').send({ name: `Duka ${u}`, email: 'not-an-address', password })).body.code).toBe('EMAIL_INVALID');
    // Seven characters is one short of enough.
    expect((await http().post('/v1/sbg/vendors').send({ name: `Duka ${u}`, email, password: 'seven-7' })).body.code).toBe('PASSWORD_TOO_SHORT');
    expect((await http().post('/v1/sbg/vendors').send({ name: `Duka ${u}`, email })).body.code).toBe('PASSWORD_TOO_SHORT');
    expect((await http().post('/v1/sbg/vendors').send({ name: `Duka ${u}`, password })).body.code).toBe('EMAIL_INVALID');
    // A password that is easy to guess, and a signing secret of its own choosing that is short, are refused the same way.
    expect((await http().post('/v1/sbg/vendors').send({ name: `Duka Bora ${u}`, email, password: 'DukaBora2026' })).body.code).toBe('PASSWORD_GUESSABLE');
    expect((await http().post('/v1/sbg/vendors').send({ name: `Duka ${u}`, email, password, secret: '1234' })).body).toMatchObject({ code: 'VALIDATION_FAILED', params: { field: 'secret' } });
    expect(await stores()).toBe(before);

    const made = (await http().post('/v1/sbg/vendors').send({ name: `Duka Bora ${u}`, email: `  ${email.toUpperCase()} `, password }).expect(201)).body;
    expect(made).toMatchObject({ name: `Duka Bora ${u}`, email });
    expect(made.secret).toMatch(/^whsec_/);
    expect(await stores()).toBe(before + 1);
    // The answer carries a sign-in for the device that registered: the store's own, which its routes answer.
    expect(made.token?.access_token).toBeTruthy();
    await http().get(`/v1/sbg/vendors/${made.vendorId}/orders/stats`).set(bearer(made.token.access_token)).expect(200);
    // The address is taken: a second store cannot be registered on it, and none is left behind by trying.
    expect((await http().post('/v1/sbg/vendors').send({ name: `Another ${u}`, email, password })).body.code).toBe('DUPLICATE');
    expect(await stores()).toBe(before + 1);
    // It is welcomed at that address, and told what its secret is now for.
    const [welcome] = app.get(OutboxMailSender).recent(email).filter((m) => m.template === 'welcome');
    expect(welcome.subject).toBe(`Welcome to SeeBuyGet, Duka Bora ${u}`);
    expect(welcome.text).toContain('Your signing secret is for your own systems: it no longer signs anybody in');

    /* ---- signing in ---- */
    expect((await session(email, 'not-the-password')).body.code).toBe('AUTH_FAILED');
    expect((await session(`nobody.${u}@example.com`, password)).body.code).toBe('AUTH_FAILED');
    const signedIn = (await session(email, password).expect(201)).body;
    expect(signedIn).toMatchObject({ vendorId: made.vendorId, name: `Duka Bora ${u}`, email, hasAccount: true });
    expect(signedIn.secret).toBeUndefined();
    // It is the store's own token: the store's routes answer it, and it is tied to the company it contracts with.
    expect((await http().get('/v1/sbg/contract/company').set(bearer(signedIn.token.access_token)).expect(200)).body.company).toEqual({ name: 'SeeBuyGet Kenya', jurisdiction: 'KE' });
    expect((await http().get(`/v1/sbg/vendors/${made.vendorId}`).set(bearer(signedIn.token.access_token)).expect(200)).body.hasAccount).toBe(true);

    /* ---- THE SECRET SIGNS NOBODY IN ANY MORE — said only to somebody who holds the right one ---- */
    const refused = await bySecret(made.vendorId, made.secret).expect(403);
    expect(refused.body.detail).toContain('sign in with its email and password');
    expect((await bySecret(made.vendorId, 'whsec_wrong')).body.code).toBe('AUTH_FAILED');
    expect((await bySecret('ven_nosuchstore', made.secret)).body.code).toBe('AUTH_FAILED');
  });

  it('a store that has LOST its signing secret replaces it with its password; the password is changed with the current one, and reset by a code to the address', async () => {
    const u = digits();
    const email = `owner.${u}@kiosk.example`;
    const password = 'chai-na-mandazi-7';
    const made = (await http().post('/v1/sbg/vendors').send({ name: `Kiosk ${u}`, email, password }).expect(201)).body;
    const token = (await session(email, password).expect(201)).body.token.access_token as string;
    const rotate = (body: Record<string, unknown>, as = token) => http().post(`/v1/sbg/vendors/${made.vendorId}/secret/rotate`).set(bearer(as)).send(body);

    // A console left open is not enough: the second proof is the PASSWORD — not the old secret, which is what was lost.
    // A WRONG ONE IS A 403 OF ITS OWN, never a 401: the store is signed in, and every app reads a 401 as "your sign-in
    // ended" — one mistyped password would sign it out of its own console.
    for (const wrong of [{}, { password: 'not-the-password' }, { secret: made.secret }]) {
      const refused = await rotate(wrong);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('PASSWORD_WRONG');
    }
    // …and the same sign-in still works after the wrong tries, with the secret untouched.
    const still = (await http().get(`/v1/sbg/vendors/${made.vendorId}`).set(bearer(token)).expect(200)).body;
    expect(still.secretRotatedAt).toBeUndefined();
    await http().get(`/v1/sbg/vendors/${made.vendorId}/orders/stats`).set(bearer(token)).expect(200);
    const rotated = (await rotate({ password }).expect(201)).body;
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(made.secret);
    expect(rotated.secretRotatedAt).toBeTruthy();
    // Network staff cannot do it for the store, and are refused before any password is looked at: a guess from a
    // staff sign-in used to be weighed like the store's own, and counted against the store's five tries.
    const byStaff = await rotate({ password: 'seebuyget-staff' }, operator);
    expect(byStaff.status).toBe(403);
    expect(byStaff.body.code).toBe('FORBIDDEN');
    expect(byStaff.body.detail).toMatch(/A store makes its own changes/);
    // Six of them, where five wrong ones lock a store: none is counted, so the store is not locked out by somebody else's guessing.
    for (let i = 0; i < 6; i++) expect((await rotate({ password: `a-guess-${i}` }, operator)).body.code).toBe('FORBIDDEN');
    // Replacing the secret ended every sign-in the store had, and handed this device a new one.
    await http().get(`/v1/sbg/vendors/${made.vendorId}/orders/stats`).set(bearer(token)).expect(401);
    await http().get(`/v1/sbg/vendors/${made.vendorId}/orders/stats`).set(bearer(rotated.token.access_token)).expect(200);

    /* ---- the password itself ---- */
    const next = 'ugali-sukuma-2027';
    expect((await http().post('/v1/sbg/auth/password').send({ email, password: 'not-the-password', newPassword: next })).body.code).toBe('AUTH_FAILED');
    const changed = (await http().post('/v1/sbg/auth/password').send({ email, password, newPassword: next }).expect(201)).body;
    // Every device is signed out but the one it was changed on, which is handed a sign-in that is the STORE's.
    await http().get(`/v1/sbg/vendors/${made.vendorId}/orders/stats`).set(bearer(rotated.token.access_token)).expect(401);
    await http().get(`/v1/sbg/vendors/${made.vendorId}/orders/stats`).set(bearer(changed.token.access_token)).expect(200);
    expect((await session(email, password)).body.code).toBe('AUTH_FAILED');
    await session(email, next).expect(201);
    // Forgotten: a code goes to the address (handed back here only because this is a sandbox), and opens it again.
    const forgot = (await http().post('/v1/sbg/auth/forgot').send({ email }).expect(201)).body;
    expect(forgot.resetToken).toMatch(/^RST-/);
    // Eight or more here too — and a refusal does not use the code up.
    expect((await http().post('/v1/sbg/auth/reset').send({ token: forgot.resetToken, password: 'pilau-7' })).body.code).toBe('PASSWORD_TOO_SHORT');
    await http().post('/v1/sbg/auth/reset').send({ token: forgot.resetToken, password: 'pilau-kuku-2028' }).expect(201);
    expect((await session(email, next)).body.code).toBe('AUTH_FAILED');
    expect((await session(email, 'pilau-kuku-2028').expect(201)).body.vendorId).toBe(made.vendorId);
    const told = app.get(OutboxMailSender).recent(email).map((m) => m.template);
    expect(told).toEqual(expect.arrayContaining(['welcome', 'password-changed', 'password-reset']));
  });

  it('a store that already exists sets its account up ITSELF, signed in the old way one last time — nobody sets it up for it', async () => {
    const u = digits();
    // Registered as stores were: a name, and a secret shown once.
    const old = (await http().post('/v1/sbg/vendors').send({ name: `Mzee Store ${u}` }).expect(201)).body;
    expect(old.email).toBeUndefined();
    expect(old.token).toBeUndefined();
    const legacy = (await bySecret(old.vendorId, old.secret).expect(201)).body;
    expect(legacy.hasAccount).toBe(false);
    const token = legacy.token.access_token as string;
    expect((await http().get(`/v1/sbg/vendors/${old.vendorId}`).set(bearer(token)).expect(200)).body.hasAccount).toBe(false);
    // Without an account, replacing the secret still asks for the current secret, exactly as before.
    // A wrong one is refused as its own 403, and the store stays signed in.
    const wrongSecret = await http().post(`/v1/sbg/vendors/${old.vendorId}/secret/rotate`).set(bearer(token)).send({ password: 'anything-at-all' });
    expect(wrongSecret.status).toBe(403);
    expect(wrongSecret.body.code).toBe('SECRET_WRONG');
    await http().get(`/v1/sbg/vendors/${old.vendorId}/orders/stats`).set(bearer(token)).expect(200);

    const email = `mzee.${u}@store.example`;
    const password = 'nyama-choma-2026';
    const setUp = (body: Record<string, unknown>, as: string, id = old.vendorId) => http().post(`/v1/sbg/vendors/${id}/account`).set(bearer(as)).send(body);
    // NOT STAFF: a member of staff setting this up would be choosing the password a store signs in with. Neither the
    // shared operator key, nor somebody with a named sign-in — who may act for a store on every other store route.
    await setUp({ email, password }, operator).expect(403);
    const staffMade = (await http().post('/v1/sbg/operators').set(bearer(operator)).send({ email: `zainab-${u}@sbg.test`, name: `Zainab ${u}` }).expect(201)).body;
    const staff = (await http().post('/v1/sbg/operators/login').send({ email: staffMade.email, password: staffMade.temporaryPassword }).expect(201)).body.token.access_token as string;
    // A real staff sign-in: it reads a store at staff's own desk — never the store's own records (user, 2026-10-15).
    await http().get(`/v1/sbg/vendors/${old.vendorId}/desk`).set(bearer(staff)).expect(200);
    await http().get(`/v1/sbg/vendors/${old.vendorId}/orders/stats`).set(bearer(staff)).expect(403);
    await setUp({ email, password }, staff).expect(403);
    // …nor a staff token asked for with the store's ID in it: the server puts no store in a staff token, so it is
    // still staff's — it neither reads the store's own records nor sets anything up.
    const pointed = await http().post('/v1/auth/token').send({ role: 'operator', did: old.did, type: 'client_credentials' }).expect(201);
    await http().get(`/v1/sbg/vendors/${old.vendorId}/orders/stats`).set(bearer(pointed.body.access_token)).expect(403);
    await setUp({ email, password }, pointed.body.access_token).expect(403);
    expect((await session(email, password)).body.code).toBe('AUTH_FAILED');
    // Not another store.
    const other = (await http().post('/v1/sbg/vendors').send({ name: `Jirani ${u}` }).expect(201)).body;
    const otherToken = (await bySecret(other.vendorId, other.secret).expect(201)).body.token.access_token as string;
    await setUp({ email, password }, otherToken).expect(403);
    await http().post(`/v1/sbg/vendors/${old.vendorId}/account`).send({ email, password }).expect(401);
    expect((await setUp({ email, password: 'seven-7' }, token)).body.code).toBe('PASSWORD_TOO_SHORT');
    expect((await session(email, password)).body.code).toBe('AUTH_FAILED');

    const done = (await setUp({ email, password }, token).expect(201)).body;
    expect(done).toMatchObject({ vendorId: old.vendorId, email, hasAccount: true });
    expect(done.token.access_token).toBeTruthy();
    // From now: the email and the password, and not the secret.
    expect((await session(email, password).expect(201)).body.vendorId).toBe(old.vendorId);
    await bySecret(old.vendorId, old.secret).expect(403);
    // One account per store, and one store per address.
    expect((await setUp({ email: `second.${u}@store.example`, password }, done.token.access_token)).body.code).toBe('CONFLICT');
    expect((await setUp({ email, password }, otherToken, other.vendorId)).body.code).toBe('DUPLICATE');
    // The neighbour, who has set nothing up, still signs in as before.
    await bySecret(other.vendorId, other.secret).expect(201);
  });

  it('the store’s door answers a shop’s email exactly as it answers a wrong password', async () => {
    const u = digits();
    const phone = `+2547${u}7`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const HOURS = { open: '08:00', close: '18:00' };
    const email = `mama.${u}@shop.example`;
    const password = 'duka-langu-2026';
    await http()
      .post('/v1/sbg/auth/signup')
      .send({ role: 'pudo', email, password, phone, profile: { agent: { shopName: `Mama ${u}`, zone: `Z${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Mama Shop', nationalId: `ID-${u}`, mobile: phone, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } } } })
      .expect(201);
    // Her account is real, and signs her in to the Shop app.
    await http().post('/v1/sbg/auth/login').send({ email, password }).expect(201);
    // At the store's door it is "wrong email or password": it does not say that the address is somebody's.
    const refused = await session(email, password);
    expect(refused.body).toMatchObject({ code: 'AUTH_FAILED', detail: 'Wrong email or password' });
    // And a store cannot be signed up through the shops' door.
    expect((await http().post('/v1/sbg/auth/signup').send({ role: 'vendor', email: `x.${u}@example.com`, password, phone, profile: {} })).status).toBe(400);
  });

  // LAST IN THIS FILE ON PURPOSE: it uses up the door's tries for this caller, and every test above signs in.
  it('one caller is counted too: twenty tries in a quarter of an hour at the stores’ door, however many stores they are spread over — and then it answers that caller nothing', async () => {
    const u = digits();
    const email = `guess.${u}@target.example`;
    const password = 'samaki-wa-kupaka-9';
    const made = (await http().post('/v1/sbg/vendors').send({ name: `Target ${u}`, email, password }).expect(201)).body;
    const token = made.token.access_token as string;

    /* ---- the sign-in door: one wrong try each at twenty-one stores, never enough to lock any one of them ---- */
    // (Five at ONE store lock that store, whoever makes them: that count is proved in sign-in-limits.e2e-spec.ts.)
    const answers: number[] = [];
    for (let i = 0; i < 21; i++) answers.push((await session(`spray.${u}.${i}@target.example`, 'Welcome2026!')).status);
    // Wrong guesses are refused as wrong (401) until the count runs out, and then as too many (429) — never let in.
    expect(answers.every((s) => s === 401 || s === 429)).toBe(true);
    expect(answers[0]).toBe(401);
    expect(answers[answers.length - 1]).toBe(429);
    // The guesser who now tries the RIGHT password learns nothing: the door is shut to them.
    const shut = await session(email, password);
    expect(shut.status).toBe(429);
    expect(shut.body.code).toBe('RATE_LIMITED');
    expect(shut.body.token).toBeUndefined();

    /* ---- the same password, asked for from inside: a console left open is not a place to guess it from ---- */
    const rotate = (body: Record<string, unknown>) => http().post(`/v1/sbg/vendors/${made.vendorId}/secret/rotate`).set(bearer(token)).send(body);
    const inside: string[] = [];
    for (let i = 0; i < 21; i++) {
      const r = await rotate({ password: `guess-number-${i}` });
      inside.push(`${r.status} ${r.body.code}`);
    }
    // Four are wrong; the fifth locks the ACCOUNT; and when this caller's twenty at this route are used up (the tests
    // above made some of them) it stops answering this caller at all. Nothing else is ever said, and nobody is let in.
    expect(inside.slice(0, 5)).toEqual(['403 PASSWORD_WRONG', '403 PASSWORD_WRONG', '403 PASSWORD_WRONG', '403 PASSWORD_WRONG', '403 PASSWORD_LOCKED']);
    const firstLimited = inside.indexOf('429 RATE_LIMITED');
    expect(firstLimited).toBeGreaterThan(5);
    expect(inside.slice(5, firstLimited).every((s) => s === '403 PASSWORD_LOCKED')).toBe(true);
    expect(inside.slice(firstLimited).every((s) => s === '429 RATE_LIMITED')).toBe(true);
    expect((await rotate({ password })).status).toBe(429);
    // Nothing was replaced, and the store is still signed in.
    const still = (await http().get(`/v1/sbg/vendors/${made.vendorId}`).set(bearer(token)).expect(200)).body;
    expect(still.secretRotatedAt).toBeUndefined();
  });
});
