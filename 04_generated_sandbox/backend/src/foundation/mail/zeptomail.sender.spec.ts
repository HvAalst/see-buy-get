import { Test } from '@nestjs/testing';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { MailModule, chooseMailSender } from './mail.module';
import { MailService, isReservedAddress } from './mail.service';
import { MAIL_TEMPLATES, renderMail } from './mail.templates';
import { MAIL_SENDER, MailSendError, OutgoingMail } from './mail.types';
import { OutboxMailSender } from './outbox-mail.sender';
import { readZeptoMailAnswer, toZeptoMailRequest, zeptoMailConfig } from './zeptomail';
import { ZeptoMailSender } from './zeptomail.sender';

/*
 * THE TRANSPORT. Ten emails were written, laid out, wired to their moments and tested — and reached nobody, because
 * the only sender kept them in an array. What is tested here is the RECEIVING END: a server standing where the
 * provider stands says what it was sent, and the sender is believed only as far as that server's answer goes.
 */

const TOKEN = 'wSsVR60-not-a-real-token';
const mail: OutgoingMail = { ...renderMail('welcome', MAIL_TEMPLATES.welcome.sample), template: 'welcome', to: { address: 'amina@example.com', name: 'Amina' }, reference: 'welcome:abc', tracking: false };
const QUICK = { timeoutMs: 300, retryAfterMs: 5 };

/** What the provider's documentation has shown a taken email to look like — at two different times. */
const TAKEN_201 = { data: [{ code: 'EM_104', additional_info: [], message: 'Email request received' }], message: 'OK', request_id: 'req-1', object: 'email' };
const TAKEN_200 = { data: [{ code: 'EM_104', additional_info: [{ to: { email_address: {} } }], message: 'OK' }], message: 'OK', request_id: 'req-xxxx' };
const invalidKey = { error: { code: 'TM_4001', details: [{ code: 'SERR_157', message: 'Invalid API Token found', target: 'Authorization' }], message: 'Access Denied', request_id: 'req-2' } };

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}
type Answer = (res: ServerResponse) => void;
const json =
  (status: number, body: unknown): Answer =>
  (res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
const text =
  (status: number, body: string, headers: Record<string, string> = { 'content-type': 'text/html' }): Answer =>
  (res) => {
    res.writeHead(status, headers);
    res.end(body);
  };
const silence: Answer = () => undefined;
const hangUp: Answer = (res) => res.socket?.destroy();

describe('the mail transport', () => {
  const servers: Server[] = [];
  const env = { ...process.env };
  afterEach(async () => {
    process.env = { ...env };
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
  });

  /** A server where the provider stands: it answers each request with the next answer, and the last one for ever after. */
  async function provider(...answers: Answer[]): Promise<{ seen: Seen[]; url: string; sender: ZeptoMailSender }> {
    const seen: Seen[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        answers[Math.min(seen.length - 1, answers.length - 1)](res);
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { seen, url, sender: new ZeptoMailSender(zeptoMailConfig({ ZEPTOMAIL_TOKEN: TOKEN, ZEPTOMAIL_URL: url }, true), QUICK) };
  }
  const refusal = async (sending: Promise<void>): Promise<MailSendError> => {
    const err = await sending.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MailSendError);
    return err as MailSendError;
  };

  describe('what the server was given to send with', () => {
    const given = (ZEPTOMAIL_TOKEN: string | undefined, ZEPTOMAIL_URL: string | undefined, sandbox = false) => zeptoMailConfig({ ZEPTOMAIL_TOKEN, ZEPTOMAIL_URL }, sandbox);

    it('is nothing without a token — and a token of nothing but spaces is not one', () => {
      expect(given(undefined, undefined)).toEqual({ tokenSet: false });
      expect(given('   ', 'https://api.zeptomail.com')).toEqual({ tokenSet: false, host: 'api.zeptomail.com' });
    });

    it('is not used with a token and no address: there is no address it falls back to', () => {
      expect(given(TOKEN, undefined)).toEqual({ tokenSet: true, problem: 'no_address' });
      expect(given(TOKEN, '  ')).toEqual({ tokenSet: true, problem: 'no_address' });
    });

    it('is not used with something that is not a web address', () => {
      for (const not of ['api.zeptomail.com', 'zeptomail', 'ftp://api.zeptomail.com', 'https://']) expect(given(TOKEN, not)).toEqual({ tokenSet: true, problem: 'not_an_address' });
    });

    it('never sends the token in the clear — except to a stand-in on this machine, on a sandbox', () => {
      expect(given(TOKEN, 'http://api.zeptomail.com')).toEqual({ tokenSet: true, host: 'api.zeptomail.com', problem: 'not_https' });
      // A sandbox does not make somebody else's machine safe to send a token to.
      expect(given(TOKEN, 'http://api.zeptomail.com', true).problem).toBe('not_https');
      expect(given(TOKEN, 'http://192.168.1.20:8792', true).problem).toBe('not_https');
      // And off a sandbox, not even this one.
      expect(given(TOKEN, 'http://127.0.0.1:8792').problem).toBe('not_https');
      for (const here of ['http://127.0.0.1:8792', 'http://localhost:8792', 'http://[::1]:8792']) expect(given(TOKEN, here, true)).toMatchObject({ tokenSet: true, endpoint: `${here}/v1.1/email` });
    });

    it('takes the address as the account shows it — a host, or the whole sending address — and nothing else it carried', () => {
      expect(given(TOKEN, 'https://api.zeptomail.eu')).toEqual({ tokenSet: true, host: 'api.zeptomail.eu', endpoint: 'https://api.zeptomail.eu/v1.1/email', authorization: `Zoho-enczapikey ${TOKEN}` });
      expect(given(TOKEN, 'https://api.zeptomail.eu/').endpoint).toBe('https://api.zeptomail.eu/v1.1/email');
      expect(given(TOKEN, ' https://cpaas.zoho.com/v1.1/email ').endpoint).toBe('https://cpaas.zoho.com/v1.1/email');
      expect(given(TOKEN, 'https://cpaas.zoho.com/v1.1/email/').endpoint).toBe('https://cpaas.zoho.com/v1.1/email');
      // A user or a query in the address is shown nowhere and sent nowhere.
      const carried = given(TOKEN, 'https://ops:hunter2@cpaas.zoho.com:8443/v1.1/email?key=hunter3#x');
      expect(carried).toMatchObject({ host: 'cpaas.zoho.com:8443', endpoint: 'https://cpaas.zoho.com:8443/v1.1/email' });
      expect(JSON.stringify(carried)).not.toMatch(/hunter/);
    });

    it('takes the token as people paste it: with its scheme in front, or without', () => {
      expect(given(` ${TOKEN} `, 'https://api.zeptomail.com').authorization).toBe(`Zoho-enczapikey ${TOKEN}`);
      expect(given(`Zoho-enczapikey ${TOKEN}`, 'https://api.zeptomail.com').authorization).toBe(`Zoho-enczapikey ${TOKEN}`);
      expect(given(`zoho-enczapikey ${TOKEN}`, 'https://api.zeptomail.com').authorization).toBe(`zoho-enczapikey ${TOKEN}`);
    });
  });

  describe('reading the provider’s answer', () => {
    const read = (status: number, body: unknown) => readZeptoMailAnswer(status, typeof body === 'string' ? body : JSON.stringify(body));

    it('takes an email as sent only on a success that is the provider’s own answer and carries no error', () => {
      expect(read(201, TAKEN_201)).toEqual({ ok: true });
      expect(read(200, TAKEN_200)).toEqual({ ok: true });
      // A success that is not its answer is not a sent email: a wrong address, a proxy's sign-in page.
      expect(read(200, '<html>Welcome</html>')).toEqual({ ok: false, kind: 'failed', again: false });
      expect(read(200, '')).toEqual({ ok: false, kind: 'failed', again: false });
      expect(read(204, '')).toEqual({ ok: false, kind: 'failed', again: false });
      expect(read(200, [])).toEqual({ ok: false, kind: 'failed', again: false });
      expect(read(200, 'true')).toEqual({ ok: false, kind: 'failed', again: false });
      // A success that says error, in either of the shapes its documentation has shown.
      expect(read(200, { data: { error_code: 'TM_3004', message: 'Invalid request' }, message: 'error' })).toEqual({ ok: false, kind: 'rejected', code: 'TM_3004', again: false });
      expect(read(200, { error: { code: 'TM_3201', message: 'Mandatory Field missing' } })).toEqual({ ok: false, kind: 'rejected', code: 'TM_3201', again: false });
      expect(read(200, { message: 'error' })).toEqual({ ok: false, kind: 'rejected', again: false });
      // …each of the three on its own: an error code under `data` is one whatever the line above it says.
      expect(read(200, { data: { error_code: 'TM_3004' }, message: 'OK' })).toEqual({ ok: false, kind: 'rejected', code: 'TM_3004', again: false });
      // A redirect was not followed, and is not a sent email.
      expect(read(307, '')).toEqual({ ok: false, kind: 'failed', again: false });
    });

    it('says whose a refusal is: the account’s, by its code where there is one and by the status where there is not', () => {
      expect(read(401, invalidKey)).toEqual({ ok: false, kind: 'refused', code: 'SERR_157', again: false });
      expect(read(403, '')).toEqual({ ok: false, kind: 'refused', again: false });
      // The code decides, whatever status it came with: a sender's domain that is not verified is not "this email".
      expect(read(400, { error: { code: 'TM_4001', details: [{ code: 'SM_111', message: 'Sender address domain is not verified in your Agent' }], message: 'Access Denied' } })).toEqual({ ok: false, kind: 'refused', code: 'SM_111', again: false });
      for (const code of ['SERR_157', 'TM_4001', 'SM_111', 'SM_128', 'AE_101']) expect(read(400, { data: { error_code: code }, message: 'error' })).toMatchObject({ kind: 'refused', code });
    });

    it('says a limit is a limit, and one email turned down is that email', () => {
      for (const code of ['LE_101', 'LE_102', 'SM_133', 'SMI_115']) expect(read(400, { error: { code, message: 'x' } })).toMatchObject({ kind: 'limit', code, again: false });
      expect(read(429, '')).toEqual({ ok: false, kind: 'limit', again: false });
      expect(read(400, { error: { code: 'TM_3201', details: [{ code: 'GE_102', message: 'Mandatory field missing', target: 'to' }], message: 'Mandatory Field missing' } })).toEqual({ ok: false, kind: 'rejected', code: 'GE_102', again: false });
      expect(read(422, '')).toEqual({ ok: false, kind: 'rejected', again: false });
    });

    it('asks once more only where nothing says the email was taken', () => {
      for (const gone of [502, 503, 504]) expect(read(gone, '<html>Bad gateway</html>')).toEqual({ ok: false, kind: 'failed', again: true });
      // A plain fault may have taken it.
      expect(read(500, '')).toEqual({ ok: false, kind: 'failed', again: false });
      expect(read(100, '')).toEqual({ ok: false, kind: 'failed', again: false });
    });

    it('keeps a code only when it is one: the provider’s words can name who an email was for', () => {
      const said = read(400, { error: { code: 'amina@example.com', details: [{ code: '<b>', message: 'Invalid to address amina@example.com' }], message: 'amina@example.com' } });
      expect(said).toEqual({ ok: false, kind: 'rejected', again: false });
      expect(JSON.stringify(said)).not.toContain('amina');
    });
  });

  describe('sending', () => {
    it('posts the email to the provider, as the provider takes it, and is done when the provider says it took it', async () => {
      const { seen, sender } = await provider(json(201, TAKEN_201));
      await expect(sender.send(mail)).resolves.toBeUndefined();
      expect(seen).toHaveLength(1);
      expect([seen[0].method, seen[0].url]).toEqual(['POST', '/v1.1/email']);
      expect(seen[0].headers).toMatchObject({ authorization: `Zoho-enczapikey ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json' });
      // The receiving end has the email itself: who from, who to, both bodies, our reference, and no tracking.
      expect(JSON.parse(seen[0].body)).toEqual(toZeptoMailRequest(mail));
      expect(JSON.parse(seen[0].body)).toMatchObject({ to: [{ email_address: { address: 'amina@example.com', name: 'Amina' } }], subject: mail.subject, htmlbody: mail.html, textbody: mail.text, client_reference: 'welcome:abc', track_clicks: false, track_opens: false });
    });

    it('does not call an email sent because something answered: a page that is not the provider’s answer is a failure', async () => {
      const { seen, sender } = await provider(text(200, '<html>Sign in to continue</html>'));
      const err = await refusal(sender.send(mail));
      expect([err.kind, err.code]).toEqual(['failed', undefined]);
      expect(seen).toHaveLength(1);
    });

    it('says a refusal is the account’s, with the provider’s code, and does not ask again', async () => {
      const { seen, sender } = await provider(json(401, invalidKey));
      const err = await refusal(sender.send(mail));
      expect([err.kind, err.code, err.message]).toEqual(['refused', 'SERR_157', 'the mail provider refused it for this account (SERR_157)']);
      expect(seen).toHaveLength(1);
      // What is thrown — and so what is logged — names neither the token nor who the email was for.
      expect(`${err.message} ${err.stack}`).not.toMatch(/wSsVR60|amina/);
    });

    it('tries once more when a gateway says the service is not there — the same email, and no third time', async () => {
      const back = await provider(text(503, 'Service Unavailable'), json(200, TAKEN_200));
      await expect(back.sender.send(mail)).resolves.toBeUndefined();
      expect(back.seen).toHaveLength(2);
      expect(back.seen[1].body).toBe(back.seen[0].body);

      const down = await provider(text(503, 'Service Unavailable'));
      expect((await refusal(down.sender.send(mail))).kind).toBe('failed');
      expect(down.seen).toHaveLength(2);
    });

    it('tries once more when the line drops before any answer: nothing says the email was taken', async () => {
      const dropped = await provider(hangUp, json(201, TAKEN_201));
      await expect(dropped.sender.send(mail)).resolves.toBeUndefined();
      expect(dropped.seen).toHaveLength(2);
      expect(dropped.seen[1].body).toBe(dropped.seen[0].body);
      // …and once only.
      const dead = await provider(hangUp);
      expect((await refusal(dead.sender.send(mail))).kind).toBe('unreachable');
      expect(dead.seen).toHaveLength(2);
    });

    it('does not try again after a plain fault or a turned-down email: the first may have gone, the second never will', async () => {
      const fault = await provider(text(500, 'oops'), json(201, TAKEN_201));
      expect((await refusal(fault.sender.send(mail))).kind).toBe('failed');
      expect(fault.seen).toHaveLength(1);
      const turnedDown = await provider(json(400, { error: { code: 'TM_3201', details: [{ code: 'GE_102' }], message: 'Mandatory Field missing' } }), json(201, TAKEN_201));
      expect(await refusal(turnedDown.sender.send(mail))).toMatchObject({ kind: 'rejected', code: 'GE_102' });
      expect(turnedDown.seen).toHaveLength(1);
    });

    it('gives up on a provider that does not answer in time, and does not send the email a second time', async () => {
      const { seen, sender } = await provider(silence);
      const started = Date.now();
      const err = await refusal(sender.send(mail));
      expect([err.kind, err.message]).toEqual(['unreachable', 'the mail provider could not be reached']);
      expect(Date.now() - started).toBeLessThan(2500);
      expect(seen).toHaveLength(1);
    });

    it('says a provider that is not there is not there', async () => {
      const { url, sender } = await provider(json(201, TAKEN_201));
      const s = servers.pop()!;
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
      expect((await refusal(sender.send(mail))).kind).toBe('unreachable');
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it('does not follow the provider somewhere else: the token is for one address', async () => {
      const elsewhere = await provider(json(201, TAKEN_201));
      const { seen, sender } = await provider(text(307, '', { location: `${elsewhere.url}/v1.1/email` }));
      expect((await refusal(sender.send(mail))).kind).toBe('failed');
      expect(seen).toHaveLength(1);
      expect(elsewhere.seen).toHaveLength(0);
    });

    it('sends nothing anywhere when it was given a token and no usable address', async () => {
      const halfSet = new ZeptoMailSender(zeptoMailConfig({ ZEPTOMAIL_TOKEN: TOKEN }, true), QUICK);
      expect(halfSet.ready()).toBe(false);
      expect(await refusal(halfSet.send(mail))).toMatchObject({ kind: 'refused', message: 'the mail provider is not set up' });
    });
  });

  describe('through the mail service, as staff are shown it', () => {
    const quiet = (m: MailService) => {
      (m as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
      return m;
    };
    const due = { company: 'Kilima', days: 120 };

    it('says it sends, and what the last email met — taken, or refused and why', async () => {
      const { seen, url, sender } = await provider(json(201, TAKEN_201), json(401, invalidKey), text(500, 'oops'));
      process.env.ZEPTOMAIL_TOKEN = TOKEN;
      process.env.ZEPTOMAIL_URL = url;
      const m = quiet(new MailService(sender));
      expect(m.connection()).toMatchObject({ sends: true, tokenSet: true, host: new URL(url).host, written: 0, failed: 0 });
      expect(m.connection().problem).toBeUndefined();

      expect(await m.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, due)).toBe(true);
      expect(m.connection()).toMatchObject({ written: 1, failed: 0, last: { ok: true, what: MAIL_TEMPLATES['fleet-code-due'].title } });
      expect(m.connection().last).not.toHaveProperty('failed');
      expect(JSON.parse(seen[0].body).to).toEqual([{ email_address: { address: 'ops@kilima.co.ke' } }]);

      expect(await m.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, due)).toBe(false);
      expect(m.connection()).toMatchObject({ written: 2, failed: 1, last: { ok: false, failed: 'refused', code: 'SERR_157' } });
      expect(await m.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, due)).toBe(false);
      const said = m.connection();
      expect(said).toMatchObject({ written: 3, failed: 2, last: { ok: false, failed: 'failed' } });
      expect(said.last).not.toHaveProperty('code');
      // Nothing staff are shown names the token or anybody's address.
      expect(JSON.stringify(said)).not.toMatch(/wSsVR60|ops@kilima/);
    });

    it('says a sender that fails without saying why failed, and no more', async () => {
      const m = quiet(new MailService({ send: async () => Promise.reject(new Error('socket hang up for ops@kilima.co.ke')) }));
      await m.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, due);
      expect(m.connection().last).toEqual({ at: expect.any(String), ok: false, what: MAIL_TEMPLATES['fleet-code-due'].title, failed: 'failed' });
    });

    it('never hands the provider an address that cannot exist — a sandbox with a real token does not mail its made-up people', async () => {
      const { seen, sender } = await provider(json(201, TAKEN_201));
      const m = quiet(new MailService(sender));
      // The domains set aside for examples and tests, as the seeds and the specs use them.
      for (const madeUp of ['ops@kilima.example', 'amina@example.com', 'ops1@sbg.test', 'a@shop.sbg-ke.test', 'x@EXAMPLE.ORG', 'y@mail.example.net', 'z@nowhere.invalid', 'root@localhost', 'dev@box.localhost', 'q@example.com.']) {
        expect(await m.send('fleet-code-due', { address: madeUp }, due)).toBe(false);
      }
      expect(seen).toHaveLength(0);
      // Not written, not failed: counted as what they are.
      expect(m.connection()).toMatchObject({ sends: true, written: 0, failed: 0, reserved: 10 });
      expect(m.connection().last).toBeUndefined();
      // Nothing is guessed at: a domain that only looks made up may be somebody's, and is sent to.
      for (const real of ['ops@kilima.co.ke', 'amina@example.fr', 'x@test.com', 'y@examples.org', 'z@mytest.io']) {
        expect(isReservedAddress(real)).toBe(false);
        expect(await m.send('fleet-code-due', { address: real }, due)).toBe(true);
      }
      expect(seen).toHaveLength(5);
      expect(m.connection()).toMatchObject({ written: 5, failed: 0, reserved: 10 });
      expect([isReservedAddress('no-at-sign'), isReservedAddress('trailing@'), isReservedAddress('')]).toEqual([false, false, false]);

      // The outbox keeps them, as it keeps everything: a sandbox's own flows are as they were.
      const outbox = new OutboxMailSender();
      const kept = new MailService(outbox);
      expect(await kept.send('fleet-code-due', { address: 'ops@kilima.example' }, due)).toBe(true);
      expect(outbox.recent('ops@kilima.example')).toHaveLength(1);
      expect(kept.connection()).toMatchObject({ sends: false, written: 1, reserved: 0 });
    });

    it('says why a token that is set is not used', () => {
      const m = new MailService(new OutboxMailSender());
      process.env.ZEPTOMAIL_TOKEN = TOKEN;
      delete process.env.ZEPTOMAIL_URL;
      expect(m.connection()).toMatchObject({ sends: false, tokenSet: true, problem: 'no_address' });
      process.env.ZEPTOMAIL_URL = 'http://api.zeptomail.com';
      process.env.GLOS_ENV = 'production';
      expect(m.connection()).toMatchObject({ sends: false, tokenSet: true, host: 'api.zeptomail.com', problem: 'not_https' });
    });
  });

  describe('which sender the server starts with', () => {
    const outbox = new OutboxMailSender();
    const start = async () => {
      const moduleRef = await Test.createTestingModule({ imports: [MailModule] }).compile();
      return { sender: moduleRef.get(MAIL_SENDER), service: moduleRef.get(MailService) };
    };

    it('is the provider’s only with a token and an address it may be sent to', () => {
      const ready = new ZeptoMailSender(zeptoMailConfig({ ZEPTOMAIL_TOKEN: TOKEN, ZEPTOMAIL_URL: 'https://api.zeptomail.com' }, false));
      expect(chooseMailSender(outbox, ready)).toBe(ready);
      for (const halfSet of [{ ZEPTOMAIL_TOKEN: TOKEN }, { ZEPTOMAIL_URL: 'https://api.zeptomail.com' }, { ZEPTOMAIL_TOKEN: TOKEN, ZEPTOMAIL_URL: 'http://api.zeptomail.com' }, {}]) {
        expect(chooseMailSender(outbox, new ZeptoMailSender(zeptoMailConfig(halfSet, false)))).toBe(outbox);
      }
    });

    it('keeps every email when the server is started with nothing — as every sandbox and every test is', async () => {
      delete process.env.ZEPTOMAIL_TOKEN;
      delete process.env.ZEPTOMAIL_URL;
      const { sender, service } = await start();
      expect(sender).toBeInstanceOf(OutboxMailSender);
      expect(service.connection()).toMatchObject({ sends: false, tokenSet: false });
    });

    it('keeps every email when it is started with a token and no address, and says so', async () => {
      process.env.ZEPTOMAIL_TOKEN = TOKEN;
      delete process.env.ZEPTOMAIL_URL;
      const { sender, service } = await start();
      expect(sender).toBeInstanceOf(OutboxMailSender);
      expect(service.connection()).toMatchObject({ sends: false, tokenSet: true, problem: 'no_address' });
    });

    it('sends through the provider when it is started with both — and the email arrives there', async () => {
      const { seen, url } = await provider(json(201, TAKEN_201));
      process.env.ZEPTOMAIL_TOKEN = TOKEN;
      process.env.ZEPTOMAIL_URL = url;
      delete process.env.GLOS_ENV;
      const { sender, service } = await start();
      expect(sender).toBeInstanceOf(ZeptoMailSender);
      expect(await service.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, { company: 'Kilima', days: 120 })).toBe(true);
      expect(seen).toHaveLength(1);
      expect(service.connection()).toMatchObject({ sends: true, written: 1, failed: 0, last: { ok: true } });
    });
  });
});
