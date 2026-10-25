import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { OutboxSmsSender } from './outbox-sms.sender';
import { SmsModule, chooseSmsSender } from './sms.module';
import { CODES_PAUSED, SmsService, codeText, notSentWords, smsMayGoTo } from './sms.service';
import { SMS_SENDER, SmsSendError } from './sms.types';
import { TWILIO_API, readTwilioAnswer, toTwilioForm, twilioConfig } from './twilio';
import { TwilioSmsSender } from './twilio.sender';

/*
 * THE TEXT THAT CARRIES A CODE (the user, 2026-10-11: "The sms provider outside sandbox will be twilio").
 *
 * Until this, a code was made and — off a sandbox — handed to nobody: the door answered "sent" and nothing left the
 * server. What is tested here is the RECEIVING END: a server standing where Twilio stands says what it was sent, and
 * the sender is believed only as far as that server's answer goes. Nothing here reaches the real provider.
 */

const ACCOUNT = 'ACtest0000000000000000000000000001';
const TOKEN = 'not-a-real-auth-token';
const KEY = 'SKtest0000000000000000000000000002';
const KEY_SECRET = 'not-a-real-key-secret';
const SERVICE = 'MGtest0000000000000000000000000003';
const PHONE = '+254712345678';
const sms = { to: PHONE, body: codeText('482615', 10, {}) };

/** What Twilio's documentation shows a taken message to look like, from a number and from a Messaging Service. */
const QUEUED = { sid: 'SMtest0000000000000000000000000004', status: 'queued', error_code: null, error_message: null, to: PHONE };
const ACCEPTED = { sid: 'SMtest0000000000000000000000000005', status: 'accepted', error_code: null, messaging_service_sid: SERVICE };
const said = (code: number, status: number) => ({ code, message: `The 'To' number ${PHONE} is not a valid phone number.`, more_info: `https://www.twilio.com/docs/errors/${code}`, status });

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

describe('the text that carries a code', () => {
  const servers: Server[] = [];
  const env = { ...process.env };
  afterEach(async () => {
    process.env = { ...env };
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
  });

  /** A server where Twilio stands: it answers each request with the next answer, and the last one for ever after. */
  async function provider(...answers: Answer[]): Promise<{ seen: Seen[]; url: string; sender: TwilioSmsSender }> {
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
    return { seen, url, sender: new TwilioSmsSender(twilioConfig({ TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006', TWILIO_URL: url }, true), 300) };
  }
  const refusal = async (sending: Promise<void>): Promise<SmsSendError> => {
    const err = await sending.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SmsSendError);
    return err as SmsSendError;
  };
  const basic = (user: string, secret: string) => `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;

  describe('what the server was given to text with', () => {
    const live = (given: Record<string, string>) => twilioConfig(given, false);
    const whole = { TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006' };

    it('is nothing with nothing set — and that is not a problem to report', () => {
      expect(live({})).toEqual({ accountSet: false, standIn: false });
      expect(live({ TWILIO_ACCOUNT_SID: '  ', TWILIO_AUTH_TOKEN: ' ' })).toEqual({ accountSet: false, standIn: false });
    });

    it('posts to Twilio’s own address, for the account, with the account’s token and a number to text from', () => {
      expect(live(whole)).toEqual({
        accountSet: true,
        credential: 'auth_token',
        sender: 'from',
        standIn: false,
        endpoint: `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`,
        authorization: basic(ACCOUNT, TOKEN),
        from: { field: 'From', value: '+15005550006' },
      });
      expect(TWILIO_API).toBe('https://api.twilio.com');
    });

    it('prefers an API key to the account’s token, and a Messaging Service to a number', () => {
      const both = live({ ...whole, TWILIO_API_KEY_SID: KEY, TWILIO_API_KEY_SECRET: KEY_SECRET, TWILIO_MESSAGING_SERVICE_SID: SERVICE });
      expect(both).toMatchObject({ credential: 'api_key', sender: 'service', authorization: basic(KEY, KEY_SECRET), from: { field: 'MessagingServiceSid', value: SERVICE } });
      // The account is still what the address names, whoever signs.
      expect(both.endpoint).toContain(`/Accounts/${ACCOUNT}/`);
      // Half a key is not a key: the token is used, or nothing is.
      expect(live({ ...whole, TWILIO_API_KEY_SID: KEY })).toMatchObject({ credential: 'auth_token', authorization: basic(ACCOUNT, TOKEN) });
      expect(live({ TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_FROM: '+15005550006', TWILIO_API_KEY_SECRET: KEY_SECRET })).toEqual({ accountSet: true, sender: 'from', standIn: false, problem: 'no_credential' });
    });

    it('is not used half set up, says which part is missing, and carries nothing to send with', () => {
      const missing = (drop: keyof typeof whole) => {
        const given: Record<string, string> = { ...whole };
        delete given[drop];
        return live(given);
      };
      expect(missing('TWILIO_ACCOUNT_SID')).toEqual({ accountSet: false, credential: 'auth_token', sender: 'from', standIn: false, problem: 'no_account' });
      expect(missing('TWILIO_AUTH_TOKEN')).toEqual({ accountSet: true, sender: 'from', standIn: false, problem: 'no_credential' });
      expect(missing('TWILIO_FROM')).toEqual({ accountSet: true, credential: 'auth_token', standIn: false, problem: 'no_sender' });
      for (const drop of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] as const) expect(new TwilioSmsSender(missing(drop)).ready()).toBe(false);
    });

    it('never texts through Twilio from a sandbox, with everything set: its people are made up', () => {
      const given = twilioConfig(whole, true);
      expect(given).toEqual({ accountSet: true, credential: 'auth_token', sender: 'from', standIn: false, problem: 'sandbox' });
      expect(new TwilioSmsSender(given).ready()).toBe(false);
    });

    it('sends the credential to no address but Twilio’s — except a stand-in on this machine, on a sandbox', () => {
      for (const here of ['http://127.0.0.1:8793', 'http://localhost:8793', 'http://[::1]:8793']) {
        expect(twilioConfig({ ...whole, TWILIO_URL: here }, true)).toMatchObject({ standIn: true, endpoint: `${here}/2010-04-01/Accounts/${ACCOUNT}/Messages.json` });
      }
      // Whatever else the address carried is not sent anywhere.
      expect(twilioConfig({ ...whole, TWILIO_URL: 'http://ops:hunter2@127.0.0.1:8793/elsewhere?key=hunter3' }, true).endpoint).toBe(`http://127.0.0.1:8793/2010-04-01/Accounts/${ACCOUNT}/Messages.json`);
      // Off a sandbox, not even this machine. On one, not somebody else's — and not "Twilio's" typed by hand either.
      const refused = [
        twilioConfig({ ...whole, TWILIO_URL: 'http://127.0.0.1:8793' }, false),
        twilioConfig({ ...whole, TWILIO_URL: 'http://192.168.1.20:8793' }, true),
        twilioConfig({ ...whole, TWILIO_URL: 'https://sms-proxy.example' }, true),
        twilioConfig({ ...whole, TWILIO_URL: 'https://sms-proxy.example' }, false),
        twilioConfig({ ...whole, TWILIO_URL: 'https://api.twilio.com' }, false),
        twilioConfig({ ...whole, TWILIO_URL: 'https://127.0.0.1:8793' }, true),
        twilioConfig({ ...whole, TWILIO_URL: 'not an address' }, true),
      ];
      for (const given of refused) {
        expect(given).toEqual({ accountSet: true, credential: 'auth_token', sender: 'from', standIn: false, problem: 'not_twilio' });
        expect(new TwilioSmsSender(given).ready()).toBe(false);
      }
    });

    it('is written as a form: who to, who from, and the text — a plus, a space and a new line each arriving as they were', () => {
      const form = new URLSearchParams(toTwilioForm(live(whole), { to: PHONE, body: 'one two\n\n@host #3 & more' }));
      expect([...form.keys()]).toEqual(['To', 'From', 'Body']);
      expect(Object.fromEntries(form)).toEqual({ To: PHONE, From: '+15005550006', Body: 'one two\n\n@host #3 & more' });
      const viaService = new URLSearchParams(toTwilioForm(live({ ...whole, TWILIO_MESSAGING_SERVICE_SID: SERVICE }), sms));
      expect([viaService.get('MessagingServiceSid'), viaService.get('From')]).toEqual([SERVICE, null]);
    });
  });

  describe('reading Twilio’s answer', () => {
    const read = (status: number, body: unknown) => readTwilioAnswer(status, typeof body === 'string' ? body : JSON.stringify(body));

    it('takes a text as sent only on a success that is Twilio’s own answer: a message with an id that does not say it failed', () => {
      expect(read(201, QUEUED)).toEqual({ ok: true });
      expect(read(201, ACCEPTED)).toEqual({ ok: true });
      expect(read(200, QUEUED)).toEqual({ ok: true });
      // A success that is not its answer is not a sent text: a proxy's sign-in page, nothing at all.
      for (const not of ['<html>Sign in to continue</html>', '', 'true', '[]', '{}', JSON.stringify({ status: 'queued' }), JSON.stringify({ sid: '' }), JSON.stringify({ sid: 42 })]) {
        expect([not, read(201, not)]).toEqual([not, { ok: false, kind: 'failed' }]);
      }
      // A message that was made and says it failed, in either of the ways it could.
      expect(read(201, { ...QUEUED, status: 'failed' })).toEqual({ ok: false, kind: 'failed' });
      expect(read(201, { ...QUEUED, status: 'undelivered' })).toEqual({ ok: false, kind: 'failed' });
      expect(read(201, { ...QUEUED, error_code: 30008 })).toEqual({ ok: false, kind: 'failed', code: '30008' });
      // A redirect was not followed, and is not a sent text.
      expect(read(307, '')).toEqual({ ok: false, kind: 'failed' });
    });

    it('says a number that cannot be texted is the number’s — by the numbers whose meaning Twilio states, and no others', () => {
      for (const code of [21211, 21214, 21217, 21610, 21614]) expect([code, read(400, said(code, 400))]).toEqual([code, { ok: false, kind: 'rejected', code: String(code) }]);
    });

    it('says everything else on a refusal is OURS to put right, with its number: the credential, the sender, a country not allowed', () => {
      expect(read(401, said(20003, 401))).toEqual({ ok: false, kind: 'refused', code: '20003' });
      expect(read(403, '')).toEqual({ ok: false, kind: 'refused' });
      expect(read(404, said(20404, 404))).toEqual({ ok: false, kind: 'refused', code: '20404' });
      // A country the account was not allowed to text, a From that cannot send, a trial account: not the person's.
      for (const code of [21408, 21606, 21608, 21612, 21617]) expect([code, read(400, said(code, 400))]).toEqual([code, { ok: false, kind: 'refused', code: String(code) }]);
      expect(read(400, '')).toEqual({ ok: false, kind: 'refused' });
    });

    it('says a limit is a limit, and a fault is a fault', () => {
      expect(read(429, said(20429, 429))).toEqual({ ok: false, kind: 'limit', code: '20429' });
      expect(read(429, '')).toEqual({ ok: false, kind: 'limit' });
      for (const fault of [500, 502, 503, 504]) expect(read(fault, '<html>Bad gateway</html>')).toEqual({ ok: false, kind: 'failed' });
    });

    it('keeps a number only when it is one: Twilio’s words name the phone', () => {
      const leaky = read(400, { code: PHONE, message: `Invalid number ${PHONE}`, more_info: PHONE, status: 400 });
      expect(leaky).toEqual({ ok: false, kind: 'refused' });
      expect(JSON.stringify(read(400, said(21211, 400)))).not.toContain('2547');
    });
  });

  describe('the text itself', () => {
    it('is one segment in the plain SMS alphabet, with the code first — and says what nobody will ask for', () => {
      const body = codeText('482615', 10, {});
      expect(body).toBe('482615 is your SeeBuyGet code. It works for 10 minutes. Nobody from SeeBuyGet will ask you for it.');
      expect(body.startsWith('482615')).toBe(true);
    });

    it('ends with the line a phone’s browser needs to hand the code to our page and no other, where the site is known', () => {
      const body = codeText('482615', 10, { SBG_PUBLIC_URL: 'https://app.seebuyget.example/send/' });
      expect(body.split('\n').pop()).toBe('@app.seebuyget.example #482615');
      // Still one text: 160 characters, none of them outside the alphabet a single text is counted in.
      expect(body.length).toBeLessThanOrEqual(160);
      expect(body).toMatch(/^[A-Za-z0-9 .,@#\n-]+$/);
      // An address that is not one adds nothing rather than a broken line.
      expect(codeText('482615', 10, { SBG_PUBLIC_URL: 'not an address' })).toBe(codeText('482615', 10, {}));
    });
  });

  describe('the countries a code may be texted to', () => {
    it('are judged by the LONGEST dial code a number starts with: the Bahamas is not the United States', () => {
      expect([smsMayGoTo('+254712345678', ['+254', '+255']), smsMayGoTo('+255712345678', ['+254', '+255'])]).toEqual([true, true]);
      expect([smsMayGoTo('+37120000000', ['+254']), smsMayGoTo('+25', ['+254']), smsMayGoTo('254712345678', ['+254']), smsMayGoTo('', ['+254'])]).toEqual([false, false, false, false]);
      // +1 is on. +1242 is a country of its own in the catalogue, and is not.
      expect([smsMayGoTo('+12025550123', ['+1']), smsMayGoTo('+12425550123', ['+1']), smsMayGoTo('+12425550123', ['+1242'])]).toEqual([true, false, true]);
      // With none switched on, nobody is texted: there is no "any country".
      expect(smsMayGoTo(PHONE, [])).toBe(false);
      // A number that starts with no dial code there is, is in no country.
      expect(smsMayGoTo('+999123456789', ['+254'], ['+254', '+1'])).toBe(false);
    });
  });

  describe('sending', () => {
    it('posts the text to the provider, as the provider takes it, and is done when the provider says it took it', async () => {
      const { seen, sender } = await provider(json(201, QUEUED));
      await expect(sender.send(sms)).resolves.toBeUndefined();
      expect(seen).toHaveLength(1);
      expect([seen[0].method, seen[0].url]).toEqual(['POST', `/2010-04-01/Accounts/${ACCOUNT}/Messages.json`]);
      expect(seen[0].headers).toMatchObject({ authorization: basic(ACCOUNT, TOKEN), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' });
      // The receiving end has the text itself: who to, who from, and the code in it.
      expect(Object.fromEntries(new URLSearchParams(seen[0].body))).toEqual({ To: PHONE, From: '+15005550006', Body: sms.body });
    });

    it('does not call a text sent because something answered', async () => {
      const { seen, sender } = await provider(text(200, '<html>Sign in to continue</html>'));
      const err = await refusal(sender.send(sms));
      expect([err.kind, err.code]).toEqual(['failed', undefined]);
      expect(seen).toHaveLength(1);
    });

    it('says a refusal is the account’s, with the provider’s number, and names neither the credential nor the phone', async () => {
      const { seen, sender } = await provider(json(401, said(20003, 401)));
      const err = await refusal(sender.send(sms));
      expect([err.kind, err.code, err.message]).toEqual(['refused', '20003', 'the SMS provider refused it for this account (20003)']);
      expect(`${err.message} ${err.stack}`).not.toMatch(/not-a-real|2547123|482615/);
      expect(seen).toHaveLength(1);
    });

    it('says a number that cannot be texted is that number', async () => {
      const { sender } = await provider(json(400, said(21614, 400)));
      expect(await refusal(sender.send(sms))).toMatchObject({ kind: 'rejected', code: '21614' });
    });

    it('never sends a text a second time: not after a fault, a dropped line, or no answer in time', async () => {
      const fault = await provider(text(503, 'Service Unavailable'), json(201, QUEUED));
      expect((await refusal(fault.sender.send(sms))).kind).toBe('failed');
      expect(fault.seen).toHaveLength(1);

      const dropped = await provider(hangUp, json(201, QUEUED));
      expect((await refusal(dropped.sender.send(sms))).kind).toBe('unreachable');
      expect(dropped.seen).toHaveLength(1);

      const slow = await provider(silence);
      const started = Date.now();
      const err = await refusal(slow.sender.send(sms));
      expect([err.kind, err.message]).toEqual(['unreachable', 'the SMS provider could not be reached']);
      expect(Date.now() - started).toBeLessThan(2500);
      expect(slow.seen).toHaveLength(1);
    });

    it('says a provider that is not there is not there', async () => {
      const { sender } = await provider(json(201, QUEUED));
      const s = servers.pop()!;
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
      expect((await refusal(sender.send(sms))).kind).toBe('unreachable');
    });

    it('does not follow the provider somewhere else: the credential is for one address', async () => {
      const elsewhere = await provider(json(201, QUEUED));
      const { seen, sender } = await provider(text(307, '', { location: `${elsewhere.url}/2010-04-01/Accounts/${ACCOUNT}/Messages.json` }));
      expect((await refusal(sender.send(sms))).kind).toBe('failed');
      expect(seen).toHaveLength(1);
      expect(elsewhere.seen).toHaveLength(0);
    });

    it('sends nothing anywhere when it is half set up', async () => {
      const halfSet = new TwilioSmsSender(twilioConfig({ TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN }, false));
      expect(halfSet.ready()).toBe(false);
      expect(await refusal(halfSet.send(sms))).toMatchObject({ kind: 'refused', message: 'the SMS provider is not set up' });
    });
  });

  describe('through the SMS service, as staff are shown it', () => {
    const quiet = (s: SmsService) => {
      (s as unknown as { logger: { error: () => void; warn: () => void } }).logger = { error: () => undefined, warn: () => undefined };
      return s;
    };

    it('says it sends, and what the last text met — taken, or not and whose that is', async () => {
      const { seen, url, sender } = await provider(json(201, QUEUED), json(401, said(20003, 401)), text(500, 'oops'));
      Object.assign(process.env, { TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006', TWILIO_URL: url, SBG_PUBLIC_URL: 'https://app.seebuyget.example' });
      delete process.env.GLOS_ENV;
      const s = quiet(new SmsService(sender));
      expect(s.connection()).toEqual({ sends: true, accountSet: true, credential: 'auth_token', sender: 'from', standIn: true, countries: [], written: 0, failed: 0, fenced: 0, cap: { perHour: 100, perDay: 500, lastHour: 0, lastDay: 0, held: 0 } });

      await s.sendCode(PHONE, '482615', 10);
      expect(s.connection()).toMatchObject({ written: 1, failed: 0, last: { ok: true } });
      expect(s.connection().last).not.toHaveProperty('failed');
      // What arrived is the code, to that number, ending with the line that binds it to our site.
      const arrived = new URLSearchParams(seen[0].body);
      expect(arrived.get('To')).toBe(PHONE);
      expect(arrived.get('Body')).toBe('482615 is your SeeBuyGet code. It works for 10 minutes. Nobody from SeeBuyGet will ask you for it.\n\n@app.seebuyget.example #482615');

      await expect(s.sendCode(PHONE, '482615', 10)).rejects.toMatchObject({ kind: 'refused', code: '20003' });
      expect(s.connection()).toMatchObject({ written: 2, failed: 1, last: { ok: false, failed: 'refused', code: '20003' } });
      await expect(s.sendCode(PHONE, '482615', 10)).rejects.toMatchObject({ kind: 'failed' });
      const shown = s.connection();
      expect(shown).toMatchObject({ written: 3, failed: 2, last: { ok: false, failed: 'failed' } });
      expect(shown.last).not.toHaveProperty('code');
      // Nothing staff are shown names a credential, a number or a code.
      expect(JSON.stringify(shown)).not.toMatch(/not-a-real|2547123|482615|\+1500/);
    });

    it('says a sender that fails without saying why failed, and no more — and still tells whoever asked', async () => {
      const s = quiet(new SmsService({ send: async () => Promise.reject(new Error(`socket hang up texting ${PHONE}`)) }));
      const err = await s.sendCode(PHONE, '482615', 10).then(
        () => undefined,
        (e: unknown) => e as SmsSendError,
      );
      expect(err).toBeInstanceOf(SmsSendError);
      expect([err?.kind, err?.message]).toEqual(['failed', 'the SMS provider answered with a fault']);
      expect(s.connection().last).toEqual({ at: expect.any(String), ok: false, failed: 'failed' });
    });

    it('keeps what it is handed when no provider is wired in, and says it does not send', async () => {
      const outbox = new OutboxSmsSender();
      const s = new SmsService(outbox);
      await s.sendCode(PHONE, '482615', 10);
      expect(outbox.recent(PHONE)).toEqual([{ to: PHONE, body: expect.stringContaining('482615'), at: expect.any(String) }]);
      expect(outbox.recent('+254700000000')).toEqual([]);
      expect(s.connection()).toMatchObject({ sends: false, written: 1, failed: 0, last: { ok: true } });
      // The outbox costs nothing: it is not counted against the caps.
      expect(s.connection().cap).toMatchObject({ lastHour: 0, lastDay: 0, held: 0 });
    });

    /*
     * A BILL RUN UP BY CODES ASKED FOR IN BULK STOPS AT A CAP (2026-10-25, before Twilio is wired): per number and per
     * caller the doors already limit; this is the whole server's, an hour and a day, set by the environment.
     */
    it('pauses texting at the cap of an hour or a day — says so once, and resumes by itself below it', async () => {
      const sent: string[] = [];
      const logged: string[] = [];
      const s = new SmsService({ send: async (sms) => void sent.push(sms.to) });
      (s as unknown as { logger: { error: (m: string) => void; warn: (m: string) => void } }).logger = { error: (m) => logged.push(`error: ${m}`), warn: (m) => logged.push(`warn: ${m}`) };
      const before = { ...process.env };
      Object.assign(process.env, { GLOS_SMS_PER_HOUR: '2', GLOS_SMS_PER_DAY: '3' });
      try {
        const T = Date.UTC(2026, 9, 25, 12, 0, 0);
        await s.sendCode(PHONE, '111111', 10, T);
        await s.sendCode(PHONE, '222222', 10, T + 60_000);
        const held = await s.sendCode(PHONE, '333333', 10, T + 120_000).then(() => undefined, (e: unknown) => e as SmsSendError);
        expect([held?.kind, held?.message]).toEqual(['paused', 'the cap of 2 texts an hour was reached']);
        expect(sent).toHaveLength(2);
        // Said once, as the alarm it is — and a second refusal in the same pause adds nothing to the log.
        await expect(s.sendCode(PHONE, '444444', 10, T + 180_000)).rejects.toMatchObject({ kind: 'paused' });
        expect(logged.filter((l) => l.startsWith('error: Texting is PAUSED'))).toHaveLength(1);
        expect(s.connection(T + 180_000)).toMatchObject({ last: { ok: false, failed: 'paused' }, cap: { perHour: 2, perDay: 3, lastHour: 2, lastDay: 2, held: 2, pausedBy: 'hour', pausedSince: new Date(T + 120_000).toISOString() } });

        // An hour on, the hour has room again: it resumes, and says so. The day's cap is the next to stop it.
        await s.sendCode(PHONE, '555555', 10, T + 3_700_000);
        expect(logged.some((l) => l.startsWith('warn: Texting resumed'))).toBe(true);
        expect(s.connection(T + 3_700_000).cap).not.toHaveProperty('pausedBy');
        await expect(s.sendCode(PHONE, '666666', 10, T + 3_800_000)).rejects.toMatchObject({ kind: 'paused', message: 'the cap of 3 texts a day was reached' });
        expect(s.connection(T + 3_800_000).cap).toMatchObject({ pausedBy: 'day', lastDay: 3 });
        // A day after the first, it has room again.
        await s.sendCode(PHONE, '777777', 10, T + 86_400_000 + 60_000);
        expect(sent).toHaveLength(4);
      } finally {
        process.env = before;
      }
    });

    it('reads its caps from the environment, and falls back to its own where they are missing or not whole numbers above nought', () => {
      const s = new SmsService(new OutboxSmsSender());
      expect(s.caps({})).toEqual({ perHour: 100, perDay: 500 });
      expect(s.caps({ GLOS_SMS_PER_HOUR: '40', GLOS_SMS_PER_DAY: ' 900 ' })).toEqual({ perHour: 40, perDay: 900 });
      expect(s.caps({ GLOS_SMS_PER_HOUR: '0', GLOS_SMS_PER_DAY: 'lots' })).toEqual({ perHour: 100, perDay: 500 });
      expect(notSentWords(new SmsSendError('paused', 'cap'), 'otherwise')).toBe(CODES_PAUSED);
      expect(notSentWords(new SmsSendError('failed', 'x'), 'otherwise')).toBe('otherwise');
    });

    /** The register every other screen asks how a country stands — here with the standings a test gives it. */
    const register = (levels: Record<string, string>) => ({ list: () => Object.entries(levels).map(([jurisdiction, level]) => ({ jurisdiction, level })) }) as never;

    it('texts the countries that are switched on, and no other: switching one on is what lets its numbers through', () => {
      const levels: Record<string, string> = { KE: 'established', TZ: 'matched', DE: 'observed' };
      const s = new SmsService(new OutboxSmsSender(), register(levels));
      expect([s.mayGoTo(PHONE), s.mayGoTo('+255712345678'), s.mayGoTo('+4915112345678'), s.mayGoTo('+37120000000')]).toEqual([true, true, false, false]);
      expect(s.connection()).toMatchObject({ countries: ['KE +254', 'TZ +255'], fenced: 2, written: 0 });
      // Germany is switched on. Asked again, the same number goes: nothing was restarted and nothing else was set.
      levels.DE = 'partnered';
      expect(s.mayGoTo('+4915112345678')).toBe(true);
      expect(s.connection().countries).toEqual(['DE +49', 'KE +254', 'TZ +255']);
      // …and a country lowered to observed stops being texted.
      levels.TZ = 'observed';
      expect(s.mayGoTo('+255712345678')).toBe(false);
      expect(s.connection()).toMatchObject({ countries: ['DE +49', 'KE +254'], fenced: 3 });
    });

    it('texts nobody when no country is switched on — and fences nothing only where there is no register to ask', () => {
      const none = new SmsService(new OutboxSmsSender(), register({ KE: 'observed' }));
      expect(none.mayGoTo(PHONE)).toBe(false);
      expect(none.connection()).toMatchObject({ countries: [], fenced: 1 });
      // Built by hand, with no register of countries (the application never is: app.boot.spec holds it to that).
      const bare = new SmsService(new OutboxSmsSender());
      expect([bare.mayGoTo('+37120000000'), bare.connection().fenced]).toEqual([true, 0]);
    });

    it('says why an account that is set is not used', () => {
      const s = new SmsService(new OutboxSmsSender());
      Object.assign(process.env, { TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN });
      delete process.env.TWILIO_FROM;
      delete process.env.TWILIO_MESSAGING_SERVICE_SID;
      delete process.env.TWILIO_URL;
      expect(s.connection()).toMatchObject({ sends: false, accountSet: true, credential: 'auth_token', problem: 'no_sender' });
      process.env.TWILIO_FROM = '+15005550006';
      delete process.env.GLOS_ENV;
      expect(s.connection()).toMatchObject({ sends: false, sender: 'from', problem: 'sandbox' });
    });

    it('says at start-up, off a sandbox, that nobody can be sent a code — and nothing when texts do leave', () => {
      const warned: string[] = [];
      const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void warned.push(String(m)));
      try {
        // A sandbox says nothing: kept is how it is meant to run.
        delete process.env.GLOS_ENV;
        new SmsService(new OutboxSmsSender());
        expect(warned).toEqual([]);

        process.env.GLOS_ENV = 'production';
        Object.assign(process.env, { TWILIO_ACCOUNT_SID: ACCOUNT });
        delete process.env.TWILIO_AUTH_TOKEN;
        delete process.env.TWILIO_API_KEY_SID;
        new SmsService(new OutboxSmsSender());
        expect(warned).toHaveLength(1);
        expect(warned[0]).toMatch(/No text leaves this server \(Twilio: no_credential\)/);
        expect(warned[0]).toMatch(/nobody can sign up/);

        new SmsService({ send: async () => undefined });
        expect(warned).toHaveLength(1);
        // Nothing it says at start-up is a credential.
        expect(warned.join(' ')).not.toContain(ACCOUNT);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('which sender the server starts with', () => {
    const outbox = new OutboxSmsSender();
    const whole = { TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006' };
    const clear = () => {
      for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_FROM', 'TWILIO_URL', 'GLOS_ENV']) delete process.env[name];
    };
    const start = async () => {
      const moduleRef = await Test.createTestingModule({ imports: [SmsModule] }).compile();
      return { sender: moduleRef.get(SMS_SENDER), service: moduleRef.get(SmsService) };
    };

    it('is the provider’s only with all of it, off a sandbox', () => {
      const ready = new TwilioSmsSender(twilioConfig(whole, false));
      expect(chooseSmsSender(outbox, ready)).toBe(ready);
      for (const halfSet of [{ TWILIO_ACCOUNT_SID: ACCOUNT }, { TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN }, { TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006' }, { ...whole, TWILIO_URL: 'https://sms-proxy.example' }, {}]) {
        expect(chooseSmsSender(outbox, new TwilioSmsSender(twilioConfig(halfSet, false)))).toBe(outbox);
      }
      expect(chooseSmsSender(outbox, new TwilioSmsSender(twilioConfig(whole, true)))).toBe(outbox);
    });

    it('keeps every text when the server is started with nothing — as every sandbox and every test is', async () => {
      clear();
      const { sender, service } = await start();
      expect(sender).toBeInstanceOf(OutboxSmsSender);
      expect(service.connection()).toMatchObject({ sends: false, accountSet: false });
      expect(service.connection().problem).toBeUndefined();
    });

    it('keeps every text on a sandbox given a real account, and says that is why', async () => {
      clear();
      Object.assign(process.env, whole);
      const { sender, service } = await start();
      expect(sender).toBeInstanceOf(OutboxSmsSender);
      expect(service.connection()).toMatchObject({ sends: false, accountSet: true, problem: 'sandbox' });
    });

    it('texts through the provider when it is started with all of it — and the text arrives there', async () => {
      const { seen, url } = await provider(json(201, ACCEPTED));
      clear();
      Object.assign(process.env, { ...whole, TWILIO_URL: url });
      const { sender, service } = await start();
      expect(sender).toBeInstanceOf(TwilioSmsSender);
      await service.sendCode(PHONE, '482615', 10);
      expect(seen).toHaveLength(1);
      expect(new URLSearchParams(seen[0].body).get('Body')).toContain('482615');
      expect(service.connection()).toMatchObject({ sends: true, standIn: true, written: 1, failed: 0, last: { ok: true } });
    });
  });
});
