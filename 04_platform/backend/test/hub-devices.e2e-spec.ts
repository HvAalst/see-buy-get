import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxSmsSender } from '../src/foundation/sms/outbox-sms.sender';
import { AccountService } from '../src/modules/pudo/account.service';
import { AGREED } from './agreed';

/**
 * ROUND 40 — A HUB'S SIGN-IN BOUND TO ITS OWN PHONES, over the wire (the user: "Hubs and stores now"). A hub signs up with a
 * number verified by its code; its email and password work on the phone it signed up on, and anywhere else only after a
 * code to that number is typed there. It reads and forgets its own phones; staff are refused. A hub that had no number gives
 * one at its next sign-in. A hub's name is never read as its number.
 */
describe('a hub’s own phones, over the wire', () => {
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

  async function aHub(name: string) {
    const u = digits();
    const phone = `+2547${u}4`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `sort.${u}@hub.example`;
    const password = 'kituo-cha-kupanga-9';
    // Named with seven digits in it: a name is never read as a number.
    const made = await http()
      .post('/v1/sbg/auth/signup')
      .send({ ...AGREED, role: 'mdp', email, password, phone, profile: { mdp: { name: `${name} ${u}`, zones: [`HZ${u}`], country: 'KE', location: { lat: -1.25, lng: 36.85 } } } })
      .expect(201);
    return { phone, email, password, made: made.body as { did: string; device?: string; token: { access_token: string } } };
  }

  it('works on the phone it signed up on, asks a code to the hub’s number anywhere else, and lists and forgets its phones', async () => {
    const hub = await aHub('Kati Sort');
    const first = hub.made.device as string;
    expect(first).toMatch(/^dvc_/);
    const login = (device?: string) => http().post('/v1/sbg/auth/login').send({ email: hub.email, password: hub.password, ...(device ? { device } : {}) });

    await login(first).expect(201);
    const elsewhere = await login().expect(403);
    expect(elsewhere.body).toMatchObject({ code: 'DEVICE_NOT_KNOWN', params: { challenge: expect.stringMatching(/^dc_/), sentTo: `•••${hub.phone.slice(-3)}`, code: expect.stringMatching(/^\d{6}$/) } });
    expect(elsewhere.body.detail).toMatch(/has not signed in to this hub before\. A code went to the hub’s number/);
    // The code went to the number the hub verified — not to anything read from its name.
    expect(app.get(OutboxSmsSender).recent(hub.phone).some((m) => m.body.includes(elsewhere.body.params.code))).toBe(true);
    // A hub that HAS a number cannot be handed another: the password alone never chooses where the code goes.
    const stranger = `+2547${digits()}2`;
    expect((await http().post('/v1/sbg/auth/device/phone').send({ challenge: elsewhere.body.params.challenge, phone: stranger })).body.code).toBe('OTP_INVALID');
    expect(app.get(OutboxSmsSender).recent(stranger)).toHaveLength(0);

    const confirmed = (await http().post('/v1/sbg/auth/device').send({ challenge: elsewhere.body.params.challenge, code: elsewhere.body.params.code }).expect(201)).body;
    const second = confirmed.device as string;
    const onSecond = (await login(second).expect(201)).body.token.access_token as string;

    // Its own list, read with its own sign-in; staff are refused.
    expect((await http().post('/v1/sbg/account/shop-devices').set(bearer(onSecond)).send({ device: second }).expect(201)).body).toMatchObject({ count: 2, here: true });
    await http().post('/v1/sbg/account/shop-devices').set(bearer(operator)).send({ device: second }).expect(403);
    // Every other phone forgotten, with the password: the first asks for a code again.
    await http().post('/v1/sbg/account/shop-devices/forget-others').set(bearer(onSecond)).send({ password: hub.password, device: second }).expect(201);
    expect((await login(first)).body.code).toBe('DEVICE_NOT_KNOWN');
  });

  it('a hub that had no number gives one at its next sign-in, proven by a code to it', async () => {
    const hub = await aHub('Zamani Sort');
    // As a hub made before hubs were bound: no number kept with its account.
    const accounts = (app.get(AccountService) as unknown as { accounts: Map<string, { codePhone?: string }> }).accounts;
    delete accounts.get(hub.email)!.codePhone;
    const login = (device?: string) => http().post('/v1/sbg/auth/login').send({ email: hub.email, password: hub.password, ...(device ? { device } : {}) });

    const first = await login().expect(403);
    expect(first.body).toMatchObject({ code: 'DEVICE_NOT_KNOWN', params: { challenge: expect.stringMatching(/^dp_/), needsPhone: true } });
    expect(first.body.detail).toMatch(/This hub has no phone number yet/);
    // No number given, so no code was sent: none typed signs it in, an empty one neither — and the sign-in still waits.
    for (const code of ['', '000000']) {
      const early = await http().post('/v1/sbg/auth/device').send({ challenge: first.body.params.challenge, code });
      expect(early.body.code).toBe('OTP_INVALID');
      expect(early.body.token).toBeUndefined();
    }
    const number = `+2547${digits()}5`;
    const sent = (await http().post('/v1/sbg/auth/device/phone').send({ challenge: first.body.params.challenge, phone: number }).expect(201)).body;
    expect(app.get(OutboxSmsSender).recent(number).some((m) => m.body.includes(sent.code))).toBe(true);
    // A second number cannot be put on the same sign-in within the minute.
    expect((await http().post('/v1/sbg/auth/device/phone').send({ challenge: first.body.params.challenge, phone: `+2547${digits()}6` })).body.code).toBe('RATE_LIMITED');
    const confirmed = (await http().post('/v1/sbg/auth/device').send({ challenge: sent.challenge, code: sent.code }).expect(201)).body;
    await login(confirmed.device).expect(201);
    // From now its codes go to that number.
    expect((await login().expect(403)).body.params).toMatchObject({ sentTo: `•••${number.slice(-3)}` });
    // The number is kept encrypted: not as it was typed.
    expect(accounts.get(hub.email)!.codePhone).toBeTruthy();
    expect(accounts.get(hub.email)!.codePhone).not.toContain(number.slice(-6));
  });
});
