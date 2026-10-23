import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MAX_DRIVER_REFUSALS_PER_DAY } from '../src/modules/pudo/account.service';

/**
 * A DRIVER SIGNS UP WITH THE PIN THEY WILL OPEN THE DRIVER APP WITH (the user, 2026-10-23). It used to be an email and a
 * password the Driver app never asks for, and a second code and a PIN the first time the app was opened. Now the person
 * signs in on the front page (a code, a PIN, a recovery email), the driver is made under that sign-in, and the same
 * phone and PIN open the Driver app at once.
 */
describe('a driver signs up with their PIN, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: Record<string, string> = {};
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** The front page's first steps: a code to the phone, then a PIN and — the first time — a confirmed recovery email. */
  async function aPerson(withPin = true): Promise<{ phone: string; auth: Record<string, string>; device: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    if (!withPin) {
      const bare = (await http().post('/v1/sbg/identity/enroll').send({ phone }).expect(201)).body;
      return { phone, auth: bearer(bare.token.access_token as string), device: bare.device as string };
    }
    const email = `driver-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body;
    return { phone, auth: bearer(enrolled.token.access_token as string), device: enrolled.device as string };
  }
  /** What the front page sends for a courier on a bike: the same profile the email door took. */
  const profile = (phone: string, u: string) => ({
    driver: { displayName: `Amos ${u}`, fullName: 'Amos Kiprono', nationalId: `DRV-${u}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE', homeZone: 'Z-A' },
    vehicle: { plate: `BK ${u}`, vehicleClass: 'bike' },
  });

  it('makes the driver under the person’s own sign-in, and the same phone and PIN open the Driver app', async () => {
    const amos = await aPerson();
    const other = await aPerson();
    const u = digits();
    const signUp = (auth: Record<string, string> | null, body: Record<string, unknown>) => (auth ? http().post('/v1/sbg/drivers/signups').set(auth) : http().post('/v1/sbg/drivers/signups')).send(body);

    // Signed in as themselves, with their own number: not anonymous, not staff, not somebody else's phone.
    await signUp(null, { phone: amos.phone, profile: profile(amos.phone, u) }).expect(401);
    await signUp(operator, { phone: amos.phone, profile: profile(amos.phone, u) }).expect(403);
    expect((await signUp(amos.auth, { phone: other.phone, profile: profile(other.phone, u) }).expect(403)).body.detail).toMatch(/phone number you signed in with/);

    const made = (await signUp(amos.auth, { phone: amos.phone, profile: profile(amos.phone, u) }).expect(201)).body;
    expect(made).toEqual({ did: expect.any(String), entityStatus: expect.any(String) });

    // The Driver app's own door: the phone and the PIN chosen on the front page, on the device the code was typed on.
    const session = (await http().post('/v1/sbg/drivers/session').send({ phone: amos.phone, pin: '48261', device: amos.device }).expect(201)).body;
    expect(session).toMatchObject({ did: made.did, displayName: `Amos ${u}`, token: { access_token: expect.any(String) } });
    // No email account was made: there is nothing to sign in to with an address.
    const welcome = ((await http().get('/v1/mail/outbox').query({ to: `driver-${tag}-1@example.com` }).expect(200)).body.items as Array<{ template: string; text: string }>).filter((m) => m.template === 'welcome');
    expect(welcome.map((m) => m.text).join(' ')).toContain('the PIN you chose when you signed up');

    // The same details again are refused by name — the answer the "already registered" note is built on.
    const again = await signUp(other.auth, { phone: other.phone, profile: { ...profile(other.phone, u), vehicle: { plate: `BK ${u}x`, vehicleClass: 'bike' } } });
    expect(again.body).toMatchObject({ code: 'DUPLICATE', params: { field: 'nationalId' } });
  });

  it('asks for the PIN first, and stops answering "already registered" after a few tries a day', async () => {
    const bare = await aPerson(false);
    expect((await http().post('/v1/sbg/drivers/signups').set(bare.auth).send({ phone: bare.phone, profile: profile(bare.phone, digits()) })).body.detail).toBe('Choose your PIN first: it is how you open the Driver app');

    // Somebody walking IDs to learn which are registered: each refusal names the detail, so they are counted.
    const taken = await aPerson();
    const u = digits();
    await http().post('/v1/sbg/drivers/signups').set(taken.auth).send({ phone: taken.phone, profile: profile(taken.phone, u) }).expect(201);
    const prober = await aPerson();
    const probe = () => http().post('/v1/sbg/drivers/signups').set(prober.auth).send({ phone: prober.phone, profile: { ...profile(prober.phone, u), vehicle: { plate: `BK ${digits()}`, vehicleClass: 'bike' } } });
    for (let i = 0; i < MAX_DRIVER_REFUSALS_PER_DAY; i++) expect((await probe()).body.code).toBe('DUPLICATE');
    expect((await probe()).body.code).toBe('RATE_LIMITED');
  });
});
