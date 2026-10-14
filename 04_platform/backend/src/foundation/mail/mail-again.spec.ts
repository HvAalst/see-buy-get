import { Logger } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { MAIL_AGAIN_AFTER_MIN, MAIL_MAX_WAITING, MailService } from './mail.service';
import { MAIL_TEMPLATES, MailTemplateId } from './mail.templates';
import { MailSendError, MailSender, OutgoingMail } from './mail.types';
import { OutboxMailSender } from './outbox-mail.sender';
import { zeptoMailConfig } from './zeptomail';
import { ZeptoMailSender } from './zeptomail.sender';

/*
 * SENT AGAIN LATER. Most notices are sent ONCE, by the event that causes them — a load delivered, a paper lapsing, a
 * sign-in changed. With no second chance, a provider's bad hour was a notice nobody ever got.
 *
 * What is tested is the RECEIVING END, as with the transport: a server standing where the provider stands says what
 * arrived. "It is in the queue" is not a result; "the provider was given it, once" is.
 */

const TAKEN = { data: [{ code: 'EM_104', additional_info: [], message: 'Email request received' }], message: 'OK', request_id: 'req-1', object: 'email' };
const BAD_TOKEN = { error: { code: 'TM_4001', details: [{ code: 'SERR_157', message: 'Invalid API Token found', target: 'Authorization' }], message: 'Access Denied', request_id: 'req-2' } };
const QUICK = { timeoutMs: 250, retryAfterMs: 2 };
const MIN = 60_000;
const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-07T09:00:00Z');

type Answer = (res: ServerResponse) => void;
const json =
  (status: number, body: unknown): Answer =>
  (res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
const taken = json(201, TAKEN);
const notThere = json(503, { message: 'Service Unavailable' });
const refused = json(401, BAD_TOKEN);
const limit = json(429, { error: { code: 'LE_101', message: 'Credits exhausted' } });
const turnedDown = json(400, { error: { code: 'TM_3201', details: [{ code: 'GE_102', message: 'Invalid address' }], message: 'Mandatory Field missing' } });
const fault = json(500, { message: 'Internal error' });
const silence: Answer = () => undefined;

describe('an email that could not be handed over', () => {
  const servers: Server[] = [];
  const services: MailService[] = [];
  // Every failure here is planted, and each is logged: five hundred lines of it say nothing.
  beforeAll(() => void jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());
  afterEach(async () => {
    for (const m of services.splice(0)) m.onModuleDestroy();
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
  });

  /** A server where the provider stands. It answers with `now()` — a test changes what the provider says by swapping it. */
  async function provider(first: Answer) {
    const seen: Array<{ reference: string; to: string; subject: string }> = [];
    const state = { answer: first };
    const server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { client_reference: string; subject: string; to: Array<{ email_address: { address: string } }> };
        seen.push({ reference: body.client_reference, to: body.to[0].email_address.address, subject: body.subject });
        state.answer(res);
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const mail = new MailService(new ZeptoMailSender(zeptoMailConfig({ ZEPTOMAIL_TOKEN: 'not-a-real-token', ZEPTOMAIL_URL: url }, true), QUICK));
    services.push(mail);
    return { seen, mail, says: (a: Answer) => (state.answer = a) };
  }
  const AMINA = { address: 'amina@kilima.co.ke', name: 'Amina' };
  const notice = (mail: MailService, at = T0, to: { address: string; name?: string } = AMINA) => mail.send('password-changed', to, MAIL_TEMPLATES['password-changed'].sample, at);
  const timerOf = (mail: MailService) => (mail as unknown as { timer?: unknown }).timer;

  describe('is tried again, and arrives', () => {
    it('reaches the provider once it is back — the same email, once, and the server says it went on a later try', async () => {
      const p = await provider(notThere);
      expect(await notice(p.mail)).toBe(false);
      // The sender's own two tries, a breath apart; nothing has arrived.
      expect(p.seen).toHaveLength(2);
      expect(p.mail.connection()).toMatchObject({ written: 1, failed: 1, waiting: 1, waitingSince: new Date(T0).toISOString(), sentLater: 0, gaveUp: 0, last: { ok: false, again: true } });

      p.says(taken);
      await p.mail.tryWaiting(T0 + MIN);

      expect(p.seen).toHaveLength(3);
      expect(new Set(p.seen.map((s) => s.reference)).size).toBe(1);
      expect(p.seen[2]).toMatchObject({ to: 'amina@kilima.co.ke', subject: p.seen[0].subject });
      expect(p.mail.connection()).toMatchObject({ written: 1, failed: 1, waiting: 0, sentLater: 1, gaveUp: 0, last: { ok: true, at: new Date(T0 + MIN).toISOString() } });
      expect(p.mail.connection().waitingSince).toBeUndefined();
      // And it is not sent again after that: there is nothing left to try.
      await p.mail.tryWaiting(T0 + 10 * HOUR);
      expect(p.seen).toHaveLength(3);
    });

    it('is not tried before its time, and waits longer after each failure: a minute, five, fifteen, then by the hour', async () => {
      expect([...MAIL_AGAIN_AFTER_MIN]).toEqual([1, 5, 15, 60]);
      const p = await provider(refused);
      await notice(p.mail);
      const tries = () => p.seen.length;
      expect(tries()).toBe(1);
      let at = T0;
      for (const [n, wait] of [1, 5, 15, 60, 60].entries()) {
        await p.mail.tryWaiting(at + wait * MIN - 1);
        expect(tries()).toBe(n + 1);
        at += wait * MIN;
        await p.mail.tryWaiting(at);
        expect(tries()).toBe(n + 2);
      }
      expect(p.mail.connection()).toMatchObject({ waiting: 1, waitingSince: new Date(T0).toISOString(), failed: 1 });
    });

    it('is kept when the ACCOUNT was refused or its limit used up — somebody can put that right — and goes when they have', async () => {
      for (const no of [refused, limit]) {
        const p = await provider(no);
        await notice(p.mail);
        expect(p.mail.connection().waiting).toBe(1);
        p.says(taken);
        await p.mail.tryWaiting(T0 + MIN);
        expect(p.mail.connection()).toMatchObject({ waiting: 0, sentLater: 1 });
        expect(p.seen).toHaveLength(2);
      }
    });
  });

  describe('is not tried again', () => {
    it('when it is a code: late, it has run out, or been replaced by the one they asked for next', async () => {
      const p = await provider(notThere);
      expect(await p.mail.send('email-code', AMINA, MAIL_TEMPLATES['email-code'].sample, T0)).toBe(false);
      expect(await p.mail.send('password-reset', AMINA, MAIL_TEMPLATES['password-reset'].sample, T0)).toBe(false);
      expect(p.mail.connection()).toMatchObject({ failed: 2, waiting: 0, gaveUp: 0 });
      // Said of that email: it failed, and it is not one that is kept.
      expect(p.mail.connection().last).toMatchObject({ ok: false });
      expect(p.mail.connection().last?.again).toBeUndefined();
      expect(timerOf(p.mail)).toBeUndefined();
      const before = p.seen.length;
      p.says(taken);
      await p.mail.tryWaiting(T0 + HOUR);
      expect(p.seen).toHaveLength(before);
    });

    it('when the provider may have taken it — no answer in time, or a plain fault — or turned this one email down', async () => {
      for (const no of [silence, fault, turnedDown]) {
        const p = await provider(no);
        expect(await notice(p.mail)).toBe(false);
        expect(p.mail.connection()).toMatchObject({ failed: 1, waiting: 0 });
        const before = p.seen.length;
        p.says(taken);
        await p.mail.tryWaiting(T0 + HOUR);
        // One email was asked for. A second, because nobody knew what became of the first, is two.
        expect(p.seen).toHaveLength(before);
      }
    });

    it('when the sender failed without saying how: nothing says the email was not taken', async () => {
      const mail = new MailService({ send: async () => Promise.reject(new Error('socket hang up')) });
      services.push(mail);
      expect(await notice(mail)).toBe(false);
      expect(mail.connection()).toMatchObject({ failed: 1, waiting: 0 });
    });

    it('when its address cannot exist: that one was never handed over at all', async () => {
      const p = await provider(notThere);
      await notice(p.mail, T0, { address: 'made-up@example.com', name: 'Nobody' });
      expect(p.seen).toHaveLength(0);
      expect(p.mail.connection()).toMatchObject({ reserved: 1, waiting: 0, failed: 0 });
    });
  });

  describe('is given up on, and counted', () => {
    it('once it has waited past being worth sending — and it is not tried one last time', async () => {
      const hours = MAIL_TEMPLATES['password-changed'].sendLater as number;
      const p = await provider(refused);
      await notice(p.mail);
      p.says(taken);
      // Still worth sending a millisecond before; not at the hour itself. Looked at only then.
      await p.mail.tryWaiting(T0 + hours * HOUR);
      expect(p.seen).toHaveLength(1);
      expect(p.mail.connection()).toMatchObject({ waiting: 0, sentLater: 0, gaveUp: 1 });
      expect(timerOf(p.mail)).toBeUndefined();
    });

    it('sends it a millisecond before that', async () => {
      const hours = MAIL_TEMPLATES['password-changed'].sendLater as number;
      const p = await provider(refused);
      await notice(p.mail);
      p.says(taken);
      await p.mail.tryWaiting(T0 + hours * HOUR - 1);
      expect(p.mail.connection()).toMatchObject({ waiting: 0, sentLater: 1, gaveUp: 0 });
    });

    it('when a later try is turned down, or may have gone: it is not asked a third way', async () => {
      for (const then of [turnedDown, silence, fault]) {
        const p = await provider(refused);
        await notice(p.mail);
        p.says(then);
        await p.mail.tryWaiting(T0 + MIN);
        expect(p.mail.connection()).toMatchObject({ waiting: 0, sentLater: 0, gaveUp: 1 });
        expect(p.mail.connection().last?.again).toBeUndefined();
        const before = p.seen.length;
        p.says(taken);
        await p.mail.tryWaiting(T0 + 10 * HOUR);
        expect(p.seen).toHaveLength(before);
      }
    });

    it('when too many are waiting already: the newest is not kept, and is said', async () => {
      let calls = 0;
      const down: MailSender = { send: async () => ((calls += 1), Promise.reject(new MailSendError('unreachable', 'the mail provider could not be reached', undefined, true))) };
      const mail = new MailService(down);
      services.push(mail);
      for (let i = 0; i < MAIL_MAX_WAITING + 2; i++) await notice(mail, T0 + i);
      expect(mail.connection()).toMatchObject({ written: MAIL_MAX_WAITING + 2, failed: MAIL_MAX_WAITING + 2, waiting: MAIL_MAX_WAITING, gaveUp: 2, waitingSince: new Date(T0).toISOString() });
      expect(calls).toBe(MAIL_MAX_WAITING + 2);
    });
  });

  describe('a provider that is not there', () => {
    it('is asked once in a look, not once for every email waiting — and when it is back, they all go in one', async () => {
      const p = await provider(refused);
      for (const n of [1, 2, 3]) await notice(p.mail, T0, { address: `person${n}@kilima.co.ke`, name: `Person ${n}` });
      expect(p.seen).toHaveLength(3);
      expect(p.mail.connection().waiting).toBe(3);

      // All three are due. The first hears "no" to the account; the other two are not sent to hear it too.
      await p.mail.tryWaiting(T0 + MIN);
      expect(p.seen).toHaveLength(4);
      expect(p.mail.connection().last).toMatchObject({ ok: false, failed: 'refused', again: true, at: new Date(T0 + MIN).toISOString() });
      // The next look tries one more — the next one waiting, not the same one again.
      await p.mail.tryWaiting(T0 + MIN + 30_000);
      expect(p.seen).toHaveLength(5);
      expect(new Set(p.seen.slice(3).map((s) => s.to)).size).toBe(2);
      expect(p.mail.connection().waiting).toBe(3);

      p.says(taken);
      await p.mail.tryWaiting(T0 + HOUR);
      expect(p.mail.connection()).toMatchObject({ waiting: 0, sentLater: 3, gaveUp: 0 });
      // Each person got theirs, once.
      expect(p.seen.slice(5).map((s) => s.to).sort()).toEqual(['person1@kilima.co.ke', 'person2@kilima.co.ke', 'person3@kilima.co.ke']);
    });

    it('does not hold up one that was turned down: that is the email’s, and the next one is still tried', async () => {
      const p = await provider(refused);
      await notice(p.mail, T0, { address: 'first@kilima.co.ke' });
      await notice(p.mail, T0, { address: 'second@kilima.co.ke' });
      let n = 0;
      p.says((res) => ((n += 1) === 1 ? turnedDown(res) : taken(res)));
      await p.mail.tryWaiting(T0 + MIN);
      expect(p.mail.connection()).toMatchObject({ waiting: 0, sentLater: 1, gaveUp: 1 });
    });
  });

  describe('how it waits', () => {
    it('is looked at on a timer only while something waits — and never keeps a stopping server alive', async () => {
      const p = await provider(refused);
      expect(timerOf(p.mail)).toBeUndefined();
      await notice(p.mail);
      const timer = timerOf(p.mail) as { hasRef?: () => boolean };
      expect(timer).toBeDefined();
      expect(timer.hasRef?.()).toBe(false);
      p.says(taken);
      await p.mail.tryWaiting(T0 + MIN);
      expect(timerOf(p.mail)).toBeUndefined();
      // Stopping the server stops the looking, whatever is waiting.
      p.says(refused);
      await notice(p.mail);
      expect(timerOf(p.mail)).toBeDefined();
      p.mail.onModuleDestroy();
      expect(timerOf(p.mail)).toBeUndefined();
    });

    it('never waits where nothing is sent: the outbox keeps every email, as a sandbox should', async () => {
      const outbox = new OutboxMailSender();
      const mail = new MailService(outbox);
      services.push(mail);
      expect(await notice(mail)).toBe(true);
      expect(mail.connection()).toMatchObject({ sends: false, waiting: 0, sentLater: 0, gaveUp: 0, failed: 0 });
    });
  });

  describe('each email’s own answer', () => {
    it('is stated by every template — hours it stays worth sending, or never — and only a code says never', () => {
      const never: MailTemplateId[] = [];
      const briefly: MailTemplateId[] = [];
      for (const id of Object.keys(MAIL_TEMPLATES) as MailTemplateId[]) {
        const later = MAIL_TEMPLATES[id].sendLater;
        if (later === false) never.push(id);
        else {
          expect(typeof later).toBe('number');
          expect(later).toBeLessThanOrEqual(72);
          if ((later as number) < 24) briefly.push(id);
        }
      }
      // A notice stays worth sending for a day or more — except the one that says "tomorrow": a day late it would
      // say it of today, so it is worth sending for hours and no longer.
      expect(briefly).toEqual(['appointment-reminder']);
      expect(MAIL_TEMPLATES['appointment-reminder'].sendLater).toBeGreaterThanOrEqual(6);
      expect(never.sort()).toEqual(['email-code', 'password-reset']);
      // The two that say never are the two that carry a code somebody is waiting for.
      for (const id of never) expect(JSON.stringify(MAIL_TEMPLATES[id].sample)).toMatch(/"code"/);
    });
  });

  it('tells a refusal from a line that dropped, on the error itself: both may be tried later, a turned-down email may not', async () => {
    const send = async (answer: Answer) => {
      const p = await provider(answer);
      const sender = (p.mail as unknown as { sender: ZeptoMailSender }).sender;
      return sender.send({ template: 'welcome', to: AMINA, reference: 'welcome:x', tracking: false, subject: 's', html: '<p>h</p>', text: 't', images: [] } as unknown as OutgoingMail).then(
        () => 'sent',
        (e: MailSendError) => `${e.kind}:${e.later}`,
      );
    };
    expect(await send(notThere)).toBe('failed:true');
    expect(await send(refused)).toBe('refused:true');
    expect(await send(limit)).toBe('limit:true');
    expect(await send(turnedDown)).toBe('rejected:false');
    expect(await send(fault)).toBe('failed:false');
    expect(await send(silence)).toBe('unreachable:false');
    expect(await send((res) => res.socket?.destroy())).toBe('unreachable:true');
    expect(await send(taken)).toBe('sent');
  });
});
