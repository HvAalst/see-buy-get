import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/modules/pudo/otp.service';
import { AGREED } from './agreed';

/**
 * TWO MEMBERS OF STAFF MOVE AN ACCOUNT, OVER THE WIRE — as the guards and the route roles see it.
 *
 * The user, 2026-10-01: "2 seebuyget staff can move an account." What has to hold on the wire is who may do which
 * part: anybody may ask and read their own reference; only the account's holder may stop it, by their own sign-in;
 * only staff may check and approve — and never the same member of staff both.
 */
describe('two members of staff move an account, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const aNumber = () => `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${(seq += 1)}`.slice(0, 13);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
    // Booting the whole app on a cold compile can take longer than a hook's five seconds.
  }, 60_000);
  afterAll(async () => {
    await app?.close();
  });

  /** A person through the ordinary phone door: a code to the phone, a PIN, a confirmed recovery email. */
  /**
   * THIS DEVICE, CONFIRMED BY A CODE TO THE PHONE — what an app does the first time a number's PIN is used on it.
   * (A second code to one number inside a minute is refused, as it should be; that minute is not what is proved here.)
   */
  async function confirmDevice(phone: string): Promise<string> {
    (app.get(OtpService) as unknown as { rates: Map<string, unknown> }).rates.clear();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    return (await http().post('/v1/sbg/identity/device').send({ phone }).expect(201)).body.device as string;
  }

  async function aPerson(): Promise<{ phone: string; token: string; device: string }> {
    const phone = aNumber();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `mv-${tag}-${(seq += 1)}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token, device: enrolled.body.device };
  }
  /** A number somebody holds: confirmed by its code, as the app does before asking. */
  async function aVerifiedNumber(): Promise<string> {
    const phone = aNumber();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    return phone;
  }
  /** A member of staff with a named sign-in, so two approvals are two people. */
  async function aStaff(name: string): Promise<string> {
    const made = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    const login = await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201);
    return login.body.token.access_token;
  }
  const idOf = async (reference: string, as: string) => ((await http().get('/v1/sbg/account-moves').set(bearer(as)).expect(200)).body.items as Array<{ reference: string; moveId: string }>).find((m) => m.reference === reference)!.moveId;

  it('is asked by anybody, read back by its reference, checked by one member of staff and approved by another', async () => {
    const amina = await aStaff('amina');
    const brian = await aStaff('brian');
    const holder = await aPerson();

    // Asking: nobody is signed in. The new number has to have been confirmed first.
    await http().post('/v1/sbg/identity/move-requests').send({ oldPhone: holder.phone, newPhone: aNumber() }).expect(400);
    await http().post('/v1/sbg/identity/move-requests').send({ oldPhone: holder.phone }).expect(400);
    const newPhone = await aVerifiedNumber();
    const asked = await http().post('/v1/sbg/identity/move-requests').send({ oldPhone: holder.phone, newPhone, note: 'My phone was stolen.' }).expect(201);
    expect(asked.body.reference).toMatch(/^MV-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // A number with no account is answered the same way.
    const nobody = await http().post('/v1/sbg/identity/move-requests').send({ oldPhone: aNumber(), newPhone: await aVerifiedNumber() }).expect(201);
    expect(Object.keys(nobody.body).sort()).toEqual(Object.keys(asked.body).sort());

    // Read back with the reference, by whoever holds it — and nothing is said to a guess.
    const status = async (reference: string) => (await http().post('/v1/sbg/identity/move-requests/status').send({ reference }).expect(200)).body;
    expect(await status(asked.body.reference.toLowerCase())).toMatchObject({ state: 'asked', lapsesAt: asked.body.lapsesAt });
    await http().post('/v1/sbg/identity/move-requests/status').send({ reference: 'MV-AAAA-AAAA' }).expect(404);
    await http().post('/v1/sbg/identity/move-requests/status').send({}).expect(400);

    // The holder sees it on their own account — and nobody else's account says anything.
    const me = (await http().get('/v1/sbg/account/me').set(bearer(holder.token)).expect(200)).body;
    expect(me.moveAsked).toEqual({ askedAt: expect.any(String), toEnds: newPhone.slice(-3) });
    const bystander = await aPerson();
    expect((await http().get('/v1/sbg/account/me').set(bearer(bystander.token)).expect(200)).body.moveAsked).toBeUndefined();

    // Staff alone read the requests: not a signed-in person, and not nobody.
    await http().get('/v1/sbg/account-moves').expect(401);
    await http().get('/v1/sbg/account-moves').set(bearer(holder.token)).expect(403);
    const moveId = await idOf(asked.body.reference, amina);
    await http().get(`/v1/sbg/account-moves/${moveId}`).set(bearer(bystander.token)).expect(403);
    await http().post(`/v1/sbg/account-moves/${moveId}/approve`).set(bearer(holder.token)).send({}).expect(403);
    const row = (await http().get(`/v1/sbg/account-moves/${moveId}`).set(bearer(amina)).expect(200)).body;
    expect(row).toMatchObject({ state: 'asked', namesAccount: true, oldEnds: holder.phone.slice(-3), newEnds: newPhone.slice(-3), note: 'My phone was stolen.', account: { hasPin: true, roles: [], nationalIdOnRecord: false } });
    // Never a whole number, to anybody.
    expect(JSON.stringify(row)).not.toContain(holder.phone);
    expect(JSON.stringify(row)).not.toContain(newPhone);

    // One checks; that one cannot approve; another does.
    await http().post(`/v1/sbg/account-moves/${moveId}/approve`).set(bearer(brian)).send({}).expect(400);
    await http().post(`/v1/sbg/account-moves/${moveId}/check`).set(bearer(amina)).send({}).expect(400);
    const checked = await http().post(`/v1/sbg/account-moves/${moveId}/check`).set(bearer(amina)).send({ what: 'Saw their ID at the Nairobi office.' }).expect(200);
    expect(checked.body).toMatchObject({ state: 'checked', checkedBy: `amina ${tag}`, checkedByYou: true });
    expect((await http().post(`/v1/sbg/account-moves/${moveId}/approve`).set(bearer(amina)).send({}).expect(409)).body.detail).toMatch(/A second member of staff has to approve/);
    // Somebody typing another name over the same sign-in is still the same person.
    await http().post(`/v1/sbg/account-moves/${moveId}/approve`).set(bearer(amina)).send({ by: 'Somebody Else' }).expect(409);
    const moved = await http().post(`/v1/sbg/account-moves/${moveId}/approve`).set(bearer(brian)).send({}).expect(200);
    expect(moved.body).toMatchObject({ state: 'moved', decidedBy: `brian ${tag}`, checkedBy: `amina ${tag}` });

    // The account is on the new number: the old sign-in is over, the new number and the PIN open it.
    await http().get('/v1/sbg/account/me').set(bearer(holder.token)).expect(401);
    // No device went with the number: the one that signed in on the old number opens neither. The PIN works again on
    // a device a code to the NEW number confirmed — which only whoever holds that number can do.
    for (const phone of [holder.phone, newPhone]) {
      const refused = await http().post('/v1/sbg/identity/login').send({ phone, pin: '48261', device: holder.device }).expect(403);
      expect(refused.body.code).toBe('DEVICE_NOT_KNOWN');
    }
    const back = await http().post('/v1/sbg/identity/login').send({ phone: newPhone, pin: '48261', device: await confirmDevice(newPhone) }).expect(201);
    expect((await http().get('/v1/sbg/account/me').set(bearer(back.body.token.access_token)).expect(200)).body.moveAsked).toBeUndefined();
    expect(await status(asked.body.reference)).toMatchObject({ state: 'moved', decidedAt: expect.any(String) });
    // Over is over.
    await http().post(`/v1/sbg/account-moves/${moveId}/refuse`).set(bearer(brian)).send({ reason: 'Too late' }).expect(400);
    // And the request that named no account can only be refused.
    const emptyId = await idOf(nobody.body.reference, amina);
    await http().post(`/v1/sbg/account-moves/${emptyId}/check`).set(bearer(amina)).send({ what: 'Saw an ID' }).expect(400);
    await http().post(`/v1/sbg/account-moves/${emptyId}/refuse`).set(bearer(amina)).send({}).expect(400);
    await http().post(`/v1/sbg/account-moves/${emptyId}/refuse`).set(bearer(amina)).send({ reason: 'We could not confirm that this account is yours.' }).expect(200);
    expect(await status(nobody.body.reference)).toMatchObject({ state: 'refused', reason: 'We could not confirm that this account is yours.' });
  });

  it('is stopped by the account’s holder — by saying so, signed in, or simply by signing in with the PIN', async () => {
    const amina = await aStaff('amina2');
    const brian = await aStaff('brian2');

    // By saying so. Only their own sign-in can: nobody signed out, and not somebody else's sign-in.
    const holder = await aPerson();
    const other = await aPerson();
    const first = await http().post('/v1/sbg/identity/move-requests').send({ oldPhone: holder.phone, newPhone: await aVerifiedNumber() }).expect(201);
    const firstId = await idOf(first.body.reference, amina);
    await http().post(`/v1/sbg/account-moves/${firstId}/check`).set(bearer(amina)).send({ what: 'Saw an ID card.' }).expect(200);
    await http().post('/v1/sbg/account/move-requests/stop').expect(401);
    expect((await http().post('/v1/sbg/account/move-requests/stop').set(bearer(other.token)).expect(200)).body).toEqual({ stopped: 0 });
    await http().post('/v1/sbg/account/move-requests/stop').set(bearer(amina)).expect(403);
    expect((await http().post('/v1/sbg/account/move-requests/stop').set(bearer(holder.token)).expect(200)).body).toEqual({ stopped: 1 });
    expect((await http().post(`/v1/sbg/account-moves/${firstId}/approve`).set(bearer(brian)).send({}).expect(400)).body.detail).toBe('This request is over.');
    expect((await http().get(`/v1/sbg/account-moves/${firstId}`).set(bearer(brian)).expect(200)).body).toMatchObject({ state: 'stopped', stoppedBy: 'holder' });
    expect((await http().get('/v1/sbg/account/me').set(bearer(holder.token)).expect(200)).body.moveAsked).toBeUndefined();

    // By signing in with the PIN — the one thing the asker said they could not do. Staff are told why, and nothing moves.
    const second = await http().post('/v1/sbg/identity/move-requests').send({ oldPhone: other.phone, newPhone: await aVerifiedNumber() }).expect(201);
    const secondId = await idOf(second.body.reference, amina);
    await http().post(`/v1/sbg/account-moves/${secondId}/check`).set(bearer(amina)).send({ what: 'Saw an ID card.' }).expect(200);
    await new Promise((r) => setTimeout(r, 5));
    await http().post('/v1/sbg/identity/login').send({ phone: other.phone, pin: '48261', device: other.device }).expect(201);
    expect((await http().get(`/v1/sbg/account-moves/${secondId}`).set(bearer(brian)).expect(200)).body.account.pinUsedSince).toEqual(expect.any(String));
    const refusal = await http().post(`/v1/sbg/account-moves/${secondId}/approve`).set(bearer(brian)).send({}).expect(409);
    expect(refusal.body.detail).toMatch(/PIN was used after the request was made/);
    expect((await http().post('/v1/sbg/identity/move-requests/status').send({ reference: second.body.reference }).expect(200)).body.state).toBe('stopped');
    await http().post('/v1/sbg/identity/login').send({ phone: other.phone, pin: '48261', device: other.device }).expect(201);
  });

  it('counts two people by their sign-ins — and, on a sandbox’s shared key, by the names typed', async () => {
    const holder = await aPerson();
    const asked = await http().post('/v1/sbg/identity/move-requests').send({ oldPhone: holder.phone, newPhone: await aVerifiedNumber() }).expect(201);
    const moveId = await idOf(asked.body.reference, setupKey);
    await http().post(`/v1/sbg/account-moves/${moveId}/check`).set(bearer(setupKey)).send({ what: 'Saw an ID card.', by: 'Amina Otieno' }).expect(200);
    await http().post(`/v1/sbg/account-moves/${moveId}/approve`).set(bearer(setupKey)).send({ by: 'Amina Otieno' }).expect(409);
    expect((await http().post(`/v1/sbg/account-moves/${moveId}/approve`).set(bearer(setupKey)).send({ by: 'Brian Kamau' }).expect(200)).body).toMatchObject({ state: 'moved', checkedBy: 'Amina Otieno', decidedBy: 'Brian Kamau' });
  });
});
