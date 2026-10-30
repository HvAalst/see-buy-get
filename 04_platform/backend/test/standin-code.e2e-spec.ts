import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxSmsSender } from '../src/foundation/sms/outbox-sms.sender';
import { SmsService } from '../src/foundation/sms/sms.service';
import { MailService } from '../src/foundation/mail/mail.service';
import { AGREED } from './agreed';

/**
 * THE OWNER'S STAND-IN CODES, over the wire, as the live server answers (the user, 2026-10-30: "I want you to wire it in
 * as digits that are accepted as if it were twillio"). Set on the server — GLOS_STANDIN_CODES and its day — never in the
 * repository; the numbers and addresses here are made up. While no text can leave, a named number's every code is the one
 * set: signing up, a new phone, a shop's new browser. Nothing is sent and nothing is shown. Off without a day, after it,
 * for a number not named, and the moment texts leave.
 */
describe('the owner’s stand-in codes, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const env = { ...process.env };
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const owner = `+3160${digits()}`.slice(0, 12);
  const shopPhone = `+3161${digits()}`.slice(0, 12);
  const address = `owner.${digits()}@example.com`;
  const CODE = '246813';
  const named = `${owner}:${CODE}, ${shopPhone}:${CODE}, ${address}:${CODE}`;

  /** One call as the live server answers it, with the stand-in codes set to `codes` until `until`. */
  const live = async <T>(calling: () => PromiseLike<T>, codes: string | null = named, until: string | null = today): Promise<T> => {
    process.env.GLOS_ENV = 'production';
    delete process.env.GLOS_REVIEW_CODE_UNTIL;
    if (codes === null) delete process.env.GLOS_STANDIN_CODES;
    else process.env.GLOS_STANDIN_CODES = codes;
    if (until === null) delete process.env.GLOS_STANDIN_CODES_UNTIL;
    else process.env.GLOS_STANDIN_CODES_UNTIL = until;
    try {
      return await calling();
    } finally {
      process.env = { ...env };
    }
  };
  const askCode = (phone: string) => http().post('/v1/sbg/auth/phone/request').send({ phone });
  const typeCode = (phone: string, code: string) => http().post('/v1/sbg/auth/phone/verify').send({ phone, code });

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

  it('is off without the pairs, without a day, after it, and for a number not named: no code can be sent', async () => {
    for (const [codes, until] of [
      [null, today],
      [named, null],
      [named, yesterday],
      [`${owner}:12345`, today],
    ] as const) {
      const answer = await live(() => askCode(owner), codes, until);
      expect([String(codes), String(until), answer.status, answer.body.code]).toEqual([String(codes), String(until), 503, 'SMS_NOT_SENT']);
    }
    const other = await live(() => askCode(`+3162${digits()}`.slice(0, 12)));
    expect([other.status, other.body.code]).toEqual([503, 'SMS_NOT_SENT']);
  });

  it('a named number signs up, signs in on a new phone, with its own code — nothing texted, nothing shown', async () => {
    const asked = await live(() => askCode(owner));
    expect([asked.status, asked.body]).toEqual([201, { sent: true }]);
    expect(app.get(OutboxSmsSender).recent(owner)).toEqual([]);
    expect((await live(() => typeCode(owner, '000000'))).body.code).toBe('OTP_INVALID');
    await live(() => typeCode(owner, CODE).expect(201, { verified: true }));
    // Its recovery email, named too: its code mailed nowhere, shown nowhere.
    const mail = jest.spyOn(app.get(MailService), 'send');
    const mailed = await live(() => http().post('/v1/sbg/identity/email/request').send({ email: address }));
    expect([mailed.status, mailed.body]).toEqual([201, { sent: true }]);
    expect(mail.mock.calls.filter((c) => c[0] === 'email-code')).toEqual([]);
    const enrolled = await live(() => http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone: owner, pin: '27493', email: address, emailCode: CODE }));
    expect(enrolled.status).toBe(201);
    const device = enrolled.body.device as string;
    expect(device).toMatch(/^dvc_/);
    const login = (dev?: string) => http().post('/v1/sbg/identity/login').send({ phone: owner, pin: '27493', ...(dev ? { device: dev } : {}) });
    expect((await live(() => login(device))).status).toBe(201);

    // A NEW PHONE: the number has an account now, and its code still stands in — unlike the review code, it opens one.
    const elsewhere = await live(() => login());
    expect(elsewhere.body.code).toBe('DEVICE_NOT_KNOWN');
    // A minute after the first: one code a minute to a number holds for a stand-in as for everybody.
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      expect((await live(() => askCode(owner))).body).toEqual({ sent: true });
    } finally {
      clock.mockRestore();
    }
    await live(() => typeCode(owner, CODE).expect(201));
    const trusted = await live(() => http().post('/v1/sbg/identity/device').send({ phone: owner }).expect(201));
    expect((await live(() => login(trusted.body.device))).status).toBe(201);
    // The address's own code, to get back in: mailed nowhere, shown nowhere.
    const later = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      expect((await live(() => http().post('/v1/sbg/identity/account-code').send({ email: address, why: 'recover' }))).body).toEqual({ sent: true });
      // A code is mailed to nobody — the account's safety notice of a new phone still goes, as it should.
      expect(mail.mock.calls.filter((c) => c[0] === 'email-code')).toEqual([]);
    } finally {
      later.mockRestore();
      mail.mockRestore();
    }
    expect(app.get(OutboxSmsSender).recent(owner)).toEqual([]);
  });

  it('a shop’s new browser is confirmed with the code of the shop’s number, when that number is named', async () => {
    await live(() => askCode(shopPhone).expect(201));
    await live(() => typeCode(shopPhone, CODE).expect(201));
    const u = digits();
    const email = `standin.${u}@hub.example`;
    const password = 'kituo-cha-kupanga-9';
    const made = await live(() =>
      http()
        .post('/v1/sbg/auth/signup')
        .send({ ...AGREED, role: 'mdp', email, password, phone: shopPhone, profile: { mdp: { name: `Stand-in Sort ${u}`, zones: [`SZ${u}`], country: 'KE', location: { lat: -1.25, lng: 36.85 } } } }),
    );
    expect(made.status).toBe(201);
    const fresh = await live(() => http().post('/v1/sbg/auth/login').send({ email, password }));
    expect(fresh.body.code).toBe('DEVICE_NOT_KNOWN');
    expect(fresh.body.code).not.toBe('SMS_NOT_SENT');
    // The challenge, and the number's ending — never the code, which a sandbox would show.
    expect(fresh.body).toMatchObject({ params: { challenge: expect.stringMatching(/^dc_/), sentTo: `•••${shopPhone.slice(-3)}` } });
    expect(fresh.body.params.code).toBeUndefined();
    const challenge = fresh.body.params.challenge as string;
    expect((await live(() => http().post('/v1/sbg/auth/device').send({ challenge, code: '111111' }))).status).toBeGreaterThanOrEqual(400);
    expect((await live(() => http().post('/v1/sbg/auth/device').send({ challenge, code: CODE }))).status).toBe(201);
    expect(app.get(OutboxSmsSender).recent(shopPhone)).toEqual([]);
  });

  it('stands down the moment texts leave: the real code goes, as for everybody', async () => {
    const sms = app.get(SmsService);
    const sends = jest.spyOn(sms, 'sends').mockReturnValue(true);
    const sent = jest.spyOn(sms, 'sendCode').mockResolvedValue(undefined);
    const mayGoTo = jest.spyOn(sms, 'mayGoTo').mockReturnValue(true);
    try {
      const fresh = `+3163${digits()}`.slice(0, 12);
      const answer = await live(() => askCode(fresh), `${fresh}:${CODE}`);
      expect(answer.status).toBe(201);
      expect(sent).toHaveBeenCalledTimes(1);
      const texted = sent.mock.calls[0][1];
      expect(texted).toMatch(/^\d{6}$/);
      // The stand-in code no longer opens it; the texted one does.
      if (texted !== CODE) expect((await live(() => typeCode(fresh, CODE), `${fresh}:${CODE}`)).body.code).toBe('OTP_INVALID');
      await live(() => typeCode(fresh, texted).expect(201), `${fresh}:${CODE}`);
    } finally {
      sends.mockRestore();
      sent.mockRestore();
      mayGoTo.mockRestore();
    }
  });
});
