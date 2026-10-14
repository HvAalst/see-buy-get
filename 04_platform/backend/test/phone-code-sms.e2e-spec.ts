import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/modules/pudo/otp.service';
import { OutboxSmsSender } from '../src/foundation/sms/outbox-sms.sender';
import { SmsService } from '../src/foundation/sms/sms.service';
import { PresenceService } from '../src/foundation/presence/presence.service';
import { OutgoingSms, SMS_SENDER, SmsSendError } from '../src/foundation/sms/sms.types';

/**
 * THE CODE REACHES THE PHONE, OR THE PERSON IS TOLD IT DID NOT — through the booted application (the user,
 * 2026-10-11: "The sms provider outside sandbox will be twilio").
 *
 * The door that makes a code answered "sent" and, off a sandbox, sent it nowhere: the code was made, kept out of the
 * answer (rightly — handing it to whoever asked would let anyone verify anyone's phone) and reached nobody. What is
 * proved here is the RECEIVING END: with a sender standing where the provider's does, the code that arrives is the
 * code that verifies; and where it cannot arrive, the answer says so and the try is not counted.
 */
describe('a code is texted to the phone, over the wire', () => {
  const env = { ...process.env };
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const boot = async (sender?: { send(sms: OutgoingSms): Promise<void> }): Promise<INestApplication> => {
    const building = Test.createTestingModule({ imports: [AppModule] });
    const moduleRef = await (sender ? building.overrideProvider(SMS_SENDER).useValue(sender) : building).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    return app;
  };
  const ask = (app: INestApplication, phone: string) => request(app.getHttpServer()).post('/v1/sbg/auth/phone/request').send({ phone });
  const type = (app: INestApplication, phone: string, code: string) => request(app.getHttpServer()).post('/v1/sbg/auth/phone/verify').send({ phone, code });
  /** The code a text carries: its first six digits, as the person reads it. */
  const codeIn = (sms: OutgoingSms | undefined) => sms?.body.match(/^(\d{6}) /)?.[1] ?? '';
  /** How many numbers have a code made for them, and how many have a try counted. */
  const made = (app: INestApplication) => {
    const otp = app.get(OtpService) as unknown as { codes: Map<string, unknown>; rates: Map<string, unknown> };
    return { codes: otp.codes.size, tries: otp.rates.size };
  };
  /** One call as a server real people use answers it. Whether this is a sandbox is read at each call, from one switch. */
  const offSandbox = async <T>(calling: () => PromiseLike<T>): Promise<T> => {
    process.env.GLOS_ENV = 'production';
    try {
      return await calling();
    } finally {
      if (env.GLOS_ENV === undefined) delete process.env.GLOS_ENV;
      else process.env.GLOS_ENV = env.GLOS_ENV;
    }
  };

  afterEach(() => {
    process.env = { ...env };
  });

  describe('with a sender standing where the provider’s does', () => {
    /** What arrived, and what the provider says to the next text. */
    const arrived: OutgoingSms[] = [];
    let refuse: SmsSendError | Error | undefined;
    let app: INestApplication;

    beforeAll(async () => {
      app = await boot({
        send: async (sms) => {
          if (refuse) throw refuse;
          arrived.push(sms);
        },
      });
      // What a failed text logs is not what is proved here.
      (app.get(SmsService) as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
    });
    afterAll(async () => {
      await app?.close();
    });
    beforeEach(() => {
      arrived.length = 0;
      refuse = undefined;
    });

    it('texts the code to the number, however it was typed — and the code that arrives is the one that verifies', async () => {
      const national = `07${digits()}1`;
      const e164 = `+254${national.slice(1)}`;
      const asked = await ask(app, national.replace(/^(\d{4})(\d{3})/, '$1 $2 ')).expect(201);
      expect(arrived).toHaveLength(1);
      expect(arrived[0].to).toBe(e164);
      expect(arrived[0].body).toMatch(/^\d{6} is your SeeBuyGet code\. It works for 10 minutes\./);
      // A sandbox also hands the code back, and it is the same code.
      expect(codeIn(arrived[0])).toBe(asked.body.code);
      await type(app, e164, codeIn(arrived[0])).expect(201, { verified: true });
    });

    it('off a sandbox the code is in the text and NOWHERE in the answer', async () => {
      const phone = `+2547${digits()}2`;
      const asked = await offSandbox(() => ask(app, phone).expect(201));
      expect(asked.body).toEqual({ sent: true });
      expect(arrived).toHaveLength(1);
      expect(JSON.stringify(asked.body) + JSON.stringify(asked.headers)).not.toContain(codeIn(arrived[0]));
      await type(app, phone, codeIn(arrived[0])).expect(201, { verified: true });
    });

    it('a second code inside the minute is refused, and is not texted', async () => {
      const phone = `+2547${digits()}3`;
      await ask(app, phone).expect(201);
      const again = await ask(app, phone).expect(429);
      expect(again.body.code).toBe('RATE_LIMITED');
      expect(arrived).toHaveLength(1);
    });

    it('a text the provider did not take is said, not passed off as sent — and the try is given back', async () => {
      const phone = `+2547${digits()}4`;
      for (const [kind, code] of [['unreachable', undefined], ['refused', '20003'], ['limit', '20429'], ['failed', undefined]] as const) {
        refuse = new SmsSendError(kind, `the SMS provider said no to ${phone}`, code);
        const answer = await ask(app, phone).expect(503);
        expect([kind, answer.body.code, answer.body.retryable]).toEqual([kind, 'SMS_NOT_SENT', true]);
        // The person is not told whose fault it was, nor anything the provider said.
        expect(JSON.stringify(answer.body)).not.toMatch(/20003|20429|provider|said no/);
        expect(answer.body).not.toHaveProperty('sent');
      }
      // A sender that fails in words of its own is answered the same way.
      refuse = new Error(`socket hang up texting ${phone}`);
      expect((await ask(app, phone).expect(503)).body.code).toBe('SMS_NOT_SENT');
      expect(arrived).toHaveLength(0);

      // Five failures, no minute to wait and nothing against the day: the sixth goes, and its code verifies.
      refuse = undefined;
      await ask(app, phone).expect(201);
      expect(arrived).toHaveLength(1);
      await type(app, phone, codeIn(arrived[0])).expect(201, { verified: true });
      expect(app.get(SmsService).connection()).toMatchObject({ sends: true, last: { ok: true } });
    });

    it('a number the provider cannot text is the person’s to correct, and is said as that', async () => {
      const phone = `+2547${digits()}5`;
      refuse = new SmsSendError('rejected', 'the SMS provider cannot text this number (21614)', '21614');
      const answer = await ask(app, phone).expect(400);
      expect([answer.body.code, answer.body.params]).toEqual(['PHONE_INVALID', { field: 'phone' }]);
      expect(answer.body.detail).toMatch(/cannot send a text to that number/);
      expect(JSON.stringify(answer.body)).not.toContain('21614');
      // Not counted either: the number corrected to itself may be asked for at once.
      refuse = undefined;
      await ask(app, phone).expect(201);
    });

    it('a number that is not one is refused before anything is made, counted or sent', async () => {
      const answer = await ask(app, '123').expect(400);
      expect(answer.body.code).toBe('PHONE_INVALID');
      expect(arrived).toHaveLength(0);
    });

    it('a number in a country that is not switched on is turned away before a code is made or counted — and switching the country on is what lets it through', async () => {
      const presence = app.get(PresenceService);
      const abroad = `+3712${digits()}`;
      expect([presence.resolve('LV').level, presence.resolve('KE').level === 'observed']).toEqual(['observed', false]);
      const before = made(app);
      const fencedBefore = app.get(SmsService).connection().fenced;
      const answer = await ask(app, abroad).expect(400);
      expect([answer.body.code, answer.body.params]).toEqual(['PHONE_NOT_SERVED', { field: 'phone' }]);
      expect(arrived).toHaveLength(0);
      expect(made(app)).toEqual(before);
      expect(app.get(SmsService).connection().fenced).toBe(fencedBefore + 1);
      // A country that IS on, typed the national way.
      await ask(app, `07${digits()}7`).expect(201);
      expect(arrived.map((m) => m.to.slice(0, 4))).toEqual(['+254']);
      // Latvia is switched on, as two members of staff switch a country on. Nothing else is set; nothing is restarted.
      presence.set({ jurisdiction: 'LV', level: 'matched', by: 'a member of staff', approvedBy: 'another' });
      try {
        expect(app.get(SmsService).connection().countries).toContain('LV +371');
        await ask(app, abroad).expect(201);
        expect(arrived[1].to).toBe(abroad);
      } finally {
        presence.set({ jurisdiction: 'LV', level: 'observed', by: 'a member of staff' });
      }
      // …and lowered again, its numbers stop.
      expect((await ask(app, `+3712${digits()}`).expect(400)).body.code).toBe('PHONE_NOT_SERVED');
    });
  });

  describe('with nothing wired in', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await boot();
    });
    afterAll(async () => {
      await app?.close();
    });

    it('a sandbox keeps the text and hands the code back, as it always did', async () => {
      const phone = `+2547${digits()}8`;
      const asked = await ask(app, phone).expect(201);
      expect(asked.body).toEqual({ sent: true, code: expect.stringMatching(/^\d{6}$/) });
      // What would have been texted is kept, and is the same code.
      const kept = app.get(OutboxSmsSender).recent(phone);
      expect(kept).toHaveLength(1);
      expect(codeIn(kept[0])).toBe(asked.body.code);
      expect(app.get(SmsService).connection()).toMatchObject({ sends: false, last: { ok: true } });
      await type(app, phone, asked.body.code).expect(201, { verified: true });
    });

    it('a sandbox hands the code back for a number in any country: nothing is texted, so nothing is turned away', async () => {
      expect(app.get(PresenceService).resolve('LV').level).toBe('observed');
      await ask(app, `+3712${digits()}`).expect(201);
    });

    it('off a sandbox it does not say "sent": no code is made, nothing is counted, and the person is told', async () => {
      const phone = `+2547${digits()}9`;
      const before = made(app);
      const answer = await offSandbox(() => ask(app, phone));
      expect([answer.status, answer.body.code, answer.body.retryable]).toEqual([503, 'SMS_NOT_SENT', true]);
      expect(answer.body).not.toHaveProperty('sent');
      expect(made(app)).toEqual(before);
      expect(app.get(OutboxSmsSender).recent(phone)).toEqual([]);
    });
  });
});
