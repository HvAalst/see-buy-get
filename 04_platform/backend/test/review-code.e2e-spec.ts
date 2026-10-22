import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxSmsSender } from '../src/foundation/sms/outbox-sms.sender';
import { PersonService } from '../src/modules/pudo/person.service';
import { EmailCodeService } from '../src/modules/pudo/email-code.service';
import { MailService } from '../src/foundation/mail/mail.service';

/**
 * THE REVIEW CODE, over the wire, as the live server answers (the user, 2026-10-22: "feature flag the twillio requirement
 * and make every sign up pass with 000000 for now. that will allow for quick review").
 *
 * Off a sandbox with nothing to text through, GLOS_REVIEW_CODE_UNTIL lets a NEW account be made with 000000 — a hub, a
 * store, a person choosing a PIN with a recovery email — and the answer carries the code, as a sandbox's does. A code
 * everybody knows proves nobody, so it never opens an account: a number or address that has one gets no review code,
 * a new phone or browser still waits for a real text, and a verification whose number was taken meanwhile is void.
 */
describe('the review code, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const env = { ...process.env };
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  /** One call as the live server answers it, the review code set to `until` (null: not set at all). */
  const live = async <T>(calling: () => PromiseLike<T>, until: string | null = today): Promise<T> => {
    process.env.GLOS_ENV = 'production';
    if (until === null) delete process.env.GLOS_REVIEW_CODE_UNTIL;
    else process.env.GLOS_REVIEW_CODE_UNTIL = until;
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

  it('is off without a day, and after it: the live server still says no code can be sent', async () => {
    const phone = `+2547${digits()}1`;
    for (const until of [null, yesterday, 'yes']) {
      const answer = await live(() => askCode(phone), until);
      expect([String(until), answer.status, answer.body.code]).toEqual([String(until), 503, 'SMS_NOT_SENT']);
      expect(answer.body).not.toHaveProperty('review');
    }
  });

  it('a new number gets 000000, shown in the answer, texted nowhere — and a hub is made with it, on the browser that made it', async () => {
    const u = digits();
    const phone = `+2547${u}2`;
    const asked = await live(() => askCode(phone));
    expect([asked.status, asked.body]).toEqual([201, { sent: false, review: true, code: '000000' }]);
    expect(app.get(OutboxSmsSender).recent(phone)).toEqual([]);
    // Any other code is wrong.
    expect((await live(() => typeCode(phone, '123456'))).body.code).toBe('OTP_INVALID');
    await live(() => typeCode(phone, '000000').expect(201, { verified: true }));

    const email = `review.${u}@hub.example`;
    const password = 'kituo-cha-kupanga-9';
    const made = await live(() =>
      http()
        .post('/v1/sbg/auth/signup')
        .send({ role: 'mdp', email, password, phone, profile: { mdp: { name: `Review Sort ${u}`, zones: [`RZ${u}`], country: 'KE', location: { lat: -1.25, lng: 36.85 } } } }),
    );
    expect(made.status).toBe(201);
    expect(made.body.device).toMatch(/^dvc_/);
    const login = (device?: string) => http().post('/v1/sbg/auth/login').send({ email, password, ...(device ? { device } : {}) });
    expect((await live(() => login(made.body.device))).status).toBe(201);

    // IT NEVER OPENS AN ACCOUNT: the number has one now, so it gets no review code ...
    const again = await live(() => askCode(phone));
    expect([again.status, again.body.code]).toEqual([503, 'SMS_NOT_SENT']);
    expect(again.body.detail).toMatch(/already belongs to an account, and the review code 000000 only makes new ones/);
    expect(again.body).not.toHaveProperty('review');
    // ... and the hub's password on another browser still waits for a real text to the hub's number.
    const elsewhere = await live(() => login());
    expect([elsewhere.status, elsewhere.body.code]).toEqual([503, 'SMS_NOT_SENT']);
  });

  it('a store is made with a number confirmed by it: the browser it was made on is its first, and no other', async () => {
    const u = digits();
    const phone = `+2547${u}3`;
    await live(() => askCode(phone).expect(201));
    await live(() => typeCode(phone, '000000').expect(201));
    const email = `review.${u}@store.example`;
    const password = 'duka-la-nguo-2026';
    const store = await live(() => http().post('/v1/sbg/vendors').send({ name: `Review Duka ${u}`, country: 'KE', email, password, ownerPhone: phone }));
    expect(store.status).toBe(201);
    // Read before the store's person was made: the store keeps its number, and this browser.
    expect(store.body.device).toMatch(/^dvc_/);
    const session = (device?: string) => http().post('/v1/sbg/vendors/session').send({ email, password, ...(device ? { device } : {}) });
    expect((await live(() => session(store.body.device))).status).toBe(201);
    expect((await live(() => session())).body.code).toBe('SMS_NOT_SENT');
  });

  it('a person choosing a PIN confirms a new recovery email with 000000 too — an address somebody holds gets no review code', async () => {
    const u = digits();
    const phone = `+2547${u}4`;
    const mail = `review.${u}@person.example`;
    await live(() => askCode(phone).expect(201));
    await live(() => typeCode(phone, '000000').expect(201));
    const emailAsked = await live(() => http().post('/v1/sbg/identity/email/request').send({ email: mail }));
    expect([emailAsked.status, emailAsked.body]).toEqual([201, { sent: false, review: true, code: '000000' }]);
    const enrolled = await live(() => http().post('/v1/sbg/identity/enroll').send({ phone, pin: '27493', email: mail, emailCode: '000000' }));
    expect([enrolled.status, enrolled.body.code, enrolled.body.detail]).toEqual([201, undefined, undefined]);
    expect(enrolled.body).toMatchObject({ isNew: true, token: { access_token: expect.any(String) }, device: expect.stringMatching(/^dvc_/) });

    // The address is on an account now: asked again (past the minute between codes), it is answered as the live server
    // always does — no code in sight.
    (app.get(EmailCodeService) as unknown as { rates: Map<string, unknown> }).rates.delete(mail);
    const heldMail = await live(() => http().post('/v1/sbg/identity/email/request').send({ email: mail }));
    expect(heldMail.body).toEqual({ sent: true });
    // And the number gets no review code: a new phone for this person waits for a real text.
    expect((await live(() => askCode(phone))).body.code).toBe('SMS_NOT_SENT');
  });

  it('the email code is a real one the moment mail really leaves: the review code stops on that channel by itself', async () => {
    const mailer = app.get(MailService);
    const real = mailer.connection.bind(mailer);
    const spy = jest.spyOn(mailer, 'connection').mockImplementation(() => ({ ...real(), sends: true }));
    try {
      const asked = await live(() => http().post('/v1/sbg/identity/email/request').send({ email: `mailed.${digits()}@person.example` }));
      expect([asked.status, asked.body]).toEqual([201, { sent: true }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a verification whose number somebody took meanwhile counts for nothing: it signs nobody in as them', async () => {
    const phone = `+2547${digits()}5`;
    await live(() => askCode(phone).expect(201));
    await live(() => typeCode(phone, '000000').expect(201));
    // Somebody else signs up with the number in the half hour the verification lasts.
    app.get(PersonService).attachRole(phone, 'consumer', '');
    const enroll = await live(() => http().post('/v1/sbg/identity/enroll').send({ phone }));
    expect(enroll.body.code).toBe('PHONE_NOT_VERIFIED');
    expect(enroll.body.token).toBeUndefined();
  });

  it('on a sandbox nothing changes: the code is the random one it always was', async () => {
    process.env.GLOS_REVIEW_CODE_UNTIL = today;
    try {
      const phone = `+2547${digits()}6`;
      const asked = (await askCode(phone).expect(201)).body;
      expect(asked).not.toHaveProperty('review');
      expect(asked.code).toMatch(/^\d{6}$/);
    } finally {
      process.env = { ...env };
    }
  });
});
