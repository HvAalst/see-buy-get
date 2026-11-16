import { readAtAnswer, readAtReport, africasTalkingConfig, toAtForm } from './africastalking';
import { CodeRouteService, RouteSender, defaultOrder } from './code-route.service';
import type { AnyRouteId, CodeRouteId, RouteState } from './code-routes.types';
import { SmsSendError } from './sms.types';
import { readTwilioReport, twilioConfig, toTwilioForm } from './twilio';

/*
 * 2026-11-16 — THE WAYS A CODE REACHES A PHONE, STEERED FROM THE STAFF CONSOLE (the owner: "Can we build it in a way that
 * it becomes visual and controlable from the staff console? If so, we implement."; the plan's D1 and D4). A code goes by a
 * country's routes in order — set up and on — the next when one will not take it, the next when one reports it failed or
 * leaves it undelivered for a minute; the way that got a code typed in goes first for that number; staff steer each country.
 */
class FakeRoute implements RouteSender {
  readonly kind: 'sms' | 'app';
  sent: Array<{ to: string; body: string; code?: string }> = [];
  fail?: SmsSendError;
  n = 0;
  constructor(
    readonly id: AnyRouteId,
    private readonly st: RouteState = 'ready',
    private readonly reports = true,
  ) {
    this.kind = id === 'whatsapp' || id === 'telegram' ? 'app' : 'sms';
  }
  state(): RouteState {
    return this.st;
  }
  reportsDelivery(): boolean {
    return this.reports;
  }
  async deliver(sms: { to: string; body: string; code?: string }): Promise<{ ref?: string }> {
    if (this.fail) throw this.fail;
    this.sent.push(this.kind === 'app' ? { to: sms.to, body: sms.body, code: sms.code } : { to: sms.to, body: sms.body });
    this.n += 1;
    return { ref: `${this.id}-${this.n}` };
  }
}

const KE = '+254712345678';
const NL = '+31612345678';
const make = (routes: FakeRoute[]) => {
  const s = new CodeRouteService(routes);
  s.onModuleDestroy();
  return s;
};

describe('the ways a code reaches a phone', () => {
  it('East Africa starts on the local route, everywhere else on Twilio — and a route not set up is passed over', async () => {
    expect(defaultOrder('KE')).toEqual(['africastalking', 'twilio']);
    expect(defaultOrder('NL')).toEqual(['twilio', 'africastalking']);
    const at = new FakeRoute('africastalking', 'not_set_up');
    const tw = new FakeRoute('twilio');
    const s = make([at, tw]);
    await s.send(KE, 'code 123456');
    expect([at.sent.length, tw.sent.length]).toEqual([0, 1]);
  });

  it('a route that will not take a text hands it to the next at once; every route refusing the number is the person’s', async () => {
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    at.fail = new SmsSendError('refused', 'balance');
    const s = make([at, tw]);
    await s.send(KE, 'code 1');
    expect(tw.sent).toHaveLength(1);
    const counts = s.view().countries.find((c) => c.country === 'KE')!.counts;
    expect(counts.find((c) => c.route === 'africastalking')).toMatchObject({ asked: 1, failed: 1 });
    expect(counts.find((c) => c.route === 'twilio')).toMatchObject({ asked: 1, failed: 0 });
    at.fail = new SmsSendError('rejected', 'bad number');
    tw.fail = new SmsSendError('rejected', 'bad number');
    await expect(s.send(KE, 'code 2')).rejects.toMatchObject({ kind: 'rejected' });
    tw.fail = new SmsSendError('unreachable', 'down');
    await expect(s.send(KE, 'code 3')).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('a text reported failed, or still undelivered after a minute, goes the next way — the same code, once', async () => {
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    const s = make([at, tw]);
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    await s.send(KE, 'code 111111', t0);
    await s.sweep(t0 + 30_000);
    expect(tw.sent).toHaveLength(0);
    await s.sweep(t0 + 61_000);
    expect(tw.sent).toEqual([{ to: KE, body: 'code 111111' }]);
    await s.sweep(t0 + 200_000);
    expect(tw.sent).toHaveLength(1);
    // Reported failed: at once.
    await s.send(KE, 'code 222222', t0 + 300_000);
    await s.report('africastalking', 'africastalking-2', 'failed', t0 + 301_000);
    expect(tw.sent.at(-1)).toEqual({ to: KE, body: 'code 222222' });
    // Reported delivered: it stays.
    await s.send(KE, 'code 333333', t0 + 400_000);
    await s.report('africastalking', 'africastalking-3', 'delivered', t0 + 401_000);
    await s.sweep(t0 + 500_000);
    expect(tw.sent).toHaveLength(2);
  });

  it('a route that does not report deliveries is never second-guessed by the clock', async () => {
    const at = new FakeRoute('africastalking', 'ready', false);
    const tw = new FakeRoute('twilio');
    const s = make([at, tw]);
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    await s.send(KE, 'code 1', t0);
    await s.sweep(t0 + 120_000);
    expect(tw.sent).toHaveLength(0);
  });

  it('the cap is asked before a text moves on by itself; at the cap it does not', async () => {
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    const s = make([at, tw]);
    s.useGate(() => {
      throw new SmsSendError('paused', 'cap');
    });
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    await s.send(KE, 'code 1', t0);
    await s.sweep(t0 + 61_000);
    expect(tw.sent).toHaveLength(0);
  });

  it('a code typed in marks its text delivered and entered, and that route goes first for the number next time', async () => {
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    const s = make([at, tw]);
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    at.fail = new SmsSendError('failed', 'x');
    await s.send(KE, 'code 1', t0);
    s.entered(KE, t0 + 20_000);
    const tw1 = s.view().countries.find((c) => c.country === 'KE')!.counts.find((c) => c.route === 'twilio');
    expect(tw1).toMatchObject({ asked: 1, delivered: 1, entered: 1 });
    at.fail = undefined;
    await s.send(KE, 'code 2', t0 + 3_600_000);
    expect([at.sent.length, tw.sent.length]).toEqual([0, 2]);
    // Never past what staff switched off.
    s.setOn('KE', 'twilio', false, 'Amina (staff)');
    await s.send(KE, 'code 3', t0 + 7_200_000);
    expect(at.sent).toHaveLength(1);
  });

  it('staff set the order and switch routes, the last one on stays on, and every change is kept with who made it', async () => {
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    const s = make([at, tw]);
    const ke = s.setOrder('ke', ['twilio', 'africastalking'], 'Amina (staff)');
    expect(ke).toMatchObject({ country: 'KE', order: ['twilio', 'africastalking'], changed: true, goesBy: 'twilio' });
    await s.send(KE, 'code 1');
    expect(tw.sent).toHaveLength(1);
    expect(() => s.setOrder('KE', ['twilio'] as CodeRouteId[], 'Amina (staff)')).toThrow(/every route once/);
    expect(() => s.setOrder('KE', ['twilio', 'twilio'] as CodeRouteId[], 'Amina (staff)')).toThrow(/every route once/);
    s.setOn('KE', 'twilio', false, 'Brian (staff)');
    expect(() => s.setOn('KE', 'africastalking', false, 'Brian (staff)')).toThrow(/At least one route stays on/);
    expect(s.view().changes.map((c) => [c.by, c.what])).toEqual([
      ['Brian (staff)', 'off'],
      ['Amina (staff)', 'order'],
    ]);
    expect(() => s.setOrder('XX', ['twilio', 'africastalking'], 'Amina')).toThrow(/No such country/);
    // Another country keeps its own default.
    await s.send(NL, 'code 2');
    expect(tw.sent).toHaveLength(2);
  });

  it('no route set up and on: nothing is sent, and it says so', async () => {
    const s = make([new FakeRoute('africastalking', 'sandbox'), new FakeRoute('twilio', 'not_set_up')]);
    expect(s.anyReady()).toBe(false);
    await expect(s.send(KE, 'x')).rejects.toMatchObject({ kind: 'refused' });
  });

  it('a report for a text this server never handed that route changes nothing', async () => {
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    const s = make([at, tw]);
    await s.send(KE, 'code 1');
    expect(await s.report('africastalking', 'ATXid_forged', 'failed')).toBe(false);
    // Africa's Talking's own id, said to come from Twilio: not Twilio's text, so it changes nothing and moves nothing on.
    expect(await s.report('twilio', 'africastalking-1', 'failed')).toBe(false);
    expect(tw.sent).toHaveLength(0);
    expect(s.view().countries.find((c) => c.country === 'KE')!.counts.find((c) => c.route === 'africastalking')).toMatchObject({ failed: 0 });
  });
});

describe("Africa's Talking on the wire", () => {
  it('is set up by its username and key; a sandbox never sends; its own sandbox username uses its sandbox', () => {
    expect(africasTalkingConfig({}, false).state).toBe('not_set_up');
    expect(africasTalkingConfig({ AT_USERNAME: 'sbg' }, false).state).toBe('half_set_up');
    expect(africasTalkingConfig({ AT_USERNAME: 'sbg', AT_API_KEY: 'k' }, true).state).toBe('sandbox');
    const live = africasTalkingConfig({ AT_USERNAME: 'sbg', AT_API_KEY: 'k', AT_SENDER_ID: 'SEEBUYGET', AT_DELIVERY_REPORTS: 'on' }, false);
    expect(live).toMatchObject({ state: 'ready', reports: true, endpoint: 'https://api.africastalking.com/version1/messaging', from: 'SEEBUYGET' });
    expect(africasTalkingConfig({ AT_USERNAME: 'sandbox', AT_API_KEY: 'k' }, false).endpoint).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    const form = new URLSearchParams(toAtForm(live, { to: KE, body: 'hi' }));
    expect(Object.fromEntries(form)).toEqual({ username: 'sbg', to: KE, message: 'hi', from: 'SEEBUYGET' });
  });

  it('reads its answer by the status word: taken, the number’s, ours, or a fault', () => {
    const answer = (status: string, code = 101, extra = {}) => JSON.stringify({ SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode: code, number: KE, status, cost: 'KES 0.8000', messageId: 'ATXid_abc', ...extra }] } });
    expect(readAtAnswer(201, answer('Success'))).toEqual({ ok: true, ref: 'ATXid_abc' });
    expect(readAtAnswer(201, answer('InvalidPhoneNumber', 403))).toEqual({ ok: false, kind: 'rejected', code: '403' });
    expect(readAtAnswer(201, answer('InsufficientBalance', 405))).toEqual({ ok: false, kind: 'refused', code: '405' });
    expect(readAtAnswer(201, answer('CouldNotRoute', 407))).toEqual({ ok: false, kind: 'failed', code: '407' });
    expect(readAtAnswer(200, '<html>proxy</html>')).toEqual({ ok: false, kind: 'failed' });
    expect(readAtAnswer(401, 'The supplied authentication is invalid')).toEqual({ ok: false, kind: 'refused' });
    expect(readAtAnswer(201, JSON.stringify({ SMSMessageData: { Message: 'InvalidPhoneNumber', Recipients: [] } }))).toEqual({ ok: false, kind: 'failed' });
  });

  it('reads a delivery report: delivered, failed, or still on its way', () => {
    expect(readAtReport({ id: 'ATXid_abc', status: 'Success' })).toEqual({ ref: 'ATXid_abc', outcome: 'delivered' });
    expect(readAtReport({ id: 'ATXid_abc', status: 'Rejected', failureReason: 'UserInBlacklist' })).toEqual({ ref: 'ATXid_abc', outcome: 'failed' });
    expect(readAtReport({ id: 'ATXid_abc', status: 'Buffered' })).toBeUndefined();
    expect(readAtReport({ status: 'Success' })).toBeUndefined();
  });
});

describe('Twilio reports what became of a text', () => {
  it('is told where with each text, when the site is known over https', () => {
    const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: 'SEEBUYGET' };
    expect(twilioConfig({ ...env, SBG_PUBLIC_URL: 'https://seebuyget.com' }, false).statusCallback).toBe('https://seebuyget.com/v1/sms/status/twilio');
    expect(twilioConfig({ ...env, SBG_PUBLIC_URL: 'http://localhost:5173' }, false).statusCallback).toBeUndefined();
    const config = twilioConfig({ ...env, SBG_PUBLIC_URL: 'https://seebuyget.com' }, false);
    expect(new URLSearchParams(toTwilioForm(config, { to: KE, body: 'hi' })).get('StatusCallback')).toBe('https://seebuyget.com/v1/sms/status/twilio');
  });

  it('reads its status callback', () => {
    expect(readTwilioReport({ MessageSid: 'SM1', MessageStatus: 'delivered' })).toEqual({ ref: 'SM1', outcome: 'delivered' });
    expect(readTwilioReport({ MessageSid: 'SM1', MessageStatus: 'undelivered', ErrorCode: '30003' })).toEqual({ ref: 'SM1', outcome: 'failed' });
    expect(readTwilioReport({ MessageSid: 'SM1', MessageStatus: 'sent' })).toBeUndefined();
  });
});

describe('the code door uses the routes', () => {
  it('a code goes by the routes once one is set up, and a code typed in is told to them', async () => {
    const { SmsService } = await import('./sms.service');
    const { OutboxSmsSender } = await import('./outbox-sms.sender');
    const { OtpService } = await import('../../modules/pudo/otp.service');
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    const routes = make([at, tw]);
    const outbox = new OutboxSmsSender();
    const sms = new SmsService(outbox, undefined, routes);
    expect(sms.sends()).toBe(true);
    const otp = new OtpService(undefined, sms);
    const { code } = otp.request(KE);
    await sms.sendCode(KE, code, 10);
    expect(at.sent).toHaveLength(1);
    expect(at.sent[0].body).toContain(code);
    otp.verify(KE, code);
    expect(routes.view().countries.find((c) => c.country === 'KE')!.counts.find((c) => c.route === 'africastalking')).toMatchObject({ entered: 1 });
  });

  it('with no route set up, the sender the server started with keeps it, as before', async () => {
    const { SmsService } = await import('./sms.service');
    const { OutboxSmsSender } = await import('./outbox-sms.sender');
    const outbox = new OutboxSmsSender();
    const sms = new SmsService(outbox, undefined, make([new FakeRoute('africastalking', 'sandbox'), new FakeRoute('twilio', 'not_set_up')]));
    expect(sms.sends()).toBe(false);
    await sms.sendCode(KE, '123456', 10);
    expect(outbox.recent().length).toBeGreaterThan(0);
  });
});

/*
 * 2026-11-16 — WHATSAPP AND TELEGRAM, THE PERSON'S CHOICE (the plan, D2 and D3): an app only where the person chose it — now,
 * or by having had a code by it typed in — and only where it is offered and set up; a code alone, never a notice; not
 * delivered, or not on that app, and the code goes by text.
 */
const ET_NUMBER = '+251911234567';

describe('a code by an app the person chose', () => {
  const four = () => {
    const at = new FakeRoute('africastalking');
    const tw = new FakeRoute('twilio');
    const wa = new FakeRoute('whatsapp');
    const tg = new FakeRoute('telegram');
    return { at, tw, wa, tg, s: make([at, tw, wa, tg]) };
  };

  it('goes by the app only when chosen, with the code itself; by text otherwise', async () => {
    const { at, wa, s } = four();
    await s.send(KE, 'text 1', Date.now(), { code: '111111', minutes: 10 });
    expect([at.sent.length, wa.sent.length]).toEqual([1, 0]);
    await s.send(KE, 'text 2', Date.now(), { code: '222222', minutes: 10, via: 'whatsapp' });
    expect(wa.sent).toEqual([{ to: KE, body: 'text 2', code: '222222' }]);
    // A notice is no code: never by an app, chosen or not.
    await s.send(KE, 'notice', Date.now(), { via: 'whatsapp' });
    expect(wa.sent).toHaveLength(1);
  });

  it('an app not offered in the country is not used: WhatsApp in Ethiopia, or one staff withdrew', async () => {
    const { at, wa, tg, s } = four();
    expect(s.ways(KE)).toEqual(['whatsapp', 'telegram']);
    expect(s.ways(ET_NUMBER)).toEqual(['telegram']);
    await s.send(ET_NUMBER, 't', Date.now(), { code: '1', via: 'whatsapp' });
    expect([wa.sent.length, at.sent.length]).toEqual([0, 1]);
    await s.send(ET_NUMBER, 't', Date.now(), { code: '2', via: 'telegram' });
    expect(tg.sent).toHaveLength(1);
    s.setOffer('KE', 'whatsapp', false, 'Amina (staff)');
    expect(s.ways(KE)).toEqual(['telegram']);
    await s.send(KE, 't', Date.now(), { code: '3', via: 'whatsapp' });
    expect(wa.sent).toHaveLength(0);
    // Offered again, it takes its place again; Telegram stays first in Ethiopia.
    expect(s.setOffer('KE', 'whatsapp', true, 'Amina (staff)').offer).toEqual(['whatsapp', 'telegram']);
    expect(s.setOffer('ET', 'whatsapp', true, 'Amina (staff)').offer).toEqual(['telegram', 'whatsapp']);
    expect(s.view().changes.map((c) => c.what).slice(0, 3)).toEqual(['offer', 'offer', 'withdraw']);
  });

  it('not on that app, or not delivered within a minute: the same code goes by text', async () => {
    const { at, wa, s } = four();
    wa.fail = new SmsSendError('rejected', 'not on WhatsApp');
    await s.send(KE, 'text 1', Date.now(), { code: '111111', via: 'whatsapp' });
    expect(at.sent.map((m) => m.body)).toEqual(['text 1']);
    wa.fail = undefined;
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    await s.send(KE, 'text 2', t0, { code: '222222', via: 'whatsapp' });
    expect(wa.sent).toHaveLength(1);
    await s.sweep(t0 + 61_000);
    expect(at.sent.map((m) => m.body)).toEqual(['text 1', 'text 2']);
  });

  it('a code by an app typed in makes that app the person’s way next time — unless they ask for a text', async () => {
    const { at, wa, s } = four();
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    await s.send(KE, 'text 1', t0, { code: '111111', via: 'whatsapp' });
    s.entered(KE, t0 + 10_000);
    await s.send(KE, 'text 2', t0 + 3_600_000, { code: '222222' });
    expect(wa.sent.map((m) => m.code)).toEqual(['111111', '222222']);
    await s.send(KE, 'text 3', t0 + 7_200_000, { code: '333333', via: 'sms' });
    expect(at.sent.map((m) => m.body)).toEqual(['text 3']);
    // Withdrawn by staff, the remembered app is passed over.
    s.setOffer('KE', 'whatsapp', false, 'Amina (staff)');
    await s.send(KE, 'text 4', t0 + 10_800_000, { code: '444444' });
    expect(wa.sent).toHaveLength(2);
  });

  it('an app alone carries no text: with no text route set up, nothing is said to send', () => {
    const s = make([new FakeRoute('africastalking', 'not_set_up'), new FakeRoute('twilio', 'not_set_up'), new FakeRoute('whatsapp'), new FakeRoute('telegram')]);
    expect(s.anyReady()).toBe(false);
  });
});

describe('WhatsApp and Telegram on the wire', () => {
  it('WhatsApp is set up by its token, number id and template; the code goes twice, the number without +', async () => {
    const { whatsAppConfig, toWhatsAppBody } = await import('./whatsapp');
    expect(whatsAppConfig({}, false).state).toBe('not_set_up');
    expect(whatsAppConfig({ WHATSAPP_TOKEN: 't' }, false).state).toBe('half_set_up');
    expect(whatsAppConfig({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1059', WHATSAPP_TEMPLATE: 'sbg_code' }, true).state).toBe('sandbox');
    const c = whatsAppConfig({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1059', WHATSAPP_TEMPLATE: 'sbg_code', WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 'v' }, false);
    expect(c).toMatchObject({ state: 'ready', reports: true, endpoint: 'https://graph.facebook.com/v27.0/1059/messages', language: 'en' });
    const body = JSON.parse(toWhatsAppBody(c, KE, '482915'));
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '254712345678', type: 'template', template: { name: 'sbg_code', language: { code: 'en' } } });
    expect(JSON.stringify(body.template.components).match(/482915/g)).toHaveLength(2);
  });

  it('reads WhatsApp’s answer and its webhook, and believes a webhook only with its signature', async () => {
    const { readWhatsAppAnswer, readWhatsAppReports, whatsAppSigned } = await import('./whatsapp');
    const { createHmac } = await import('crypto');
    expect(readWhatsAppAnswer(200, JSON.stringify({ contacts: [{ wa_id: '254712345678' }], messages: [{ id: 'wamid.X' }] }))).toEqual({ ok: true, ref: 'wamid.X' });
    expect(readWhatsAppAnswer(400, JSON.stringify({ error: { code: 131026, message: 'Message undeliverable' } }))).toEqual({ ok: false, kind: 'rejected', code: '131026' });
    expect(readWhatsAppAnswer(400, JSON.stringify({ error: { code: 132001, message: 'Template does not exist' } }))).toEqual({ ok: false, kind: 'refused', code: '132001' });
    expect(readWhatsAppAnswer(400, JSON.stringify({ error: { code: 130429 } }))).toEqual({ ok: false, kind: 'limit', code: '130429' });
    const hook = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.A', status: 'delivered' }, { id: 'wamid.B', status: 'failed', errors: [{ code: 131026 }] }, { id: 'wamid.C', status: 'sent' }] } }] }] };
    expect(readWhatsAppReports(hook)).toEqual([{ ref: 'wamid.A', outcome: 'delivered' }, { ref: 'wamid.B', outcome: 'failed' }]);
    const raw = Buffer.from(JSON.stringify(hook));
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
    expect(whatsAppSigned(raw, sig, 'app-secret')).toBe(true);
    expect(whatsAppSigned(raw, sig, 'another-secret')).toBe(false);
    expect(whatsAppSigned(Buffer.from(raw.toString() + ' '), sig, 'app-secret')).toBe(false);
    expect(whatsAppSigned(raw, undefined, 'app-secret')).toBe(false);
  });

  it('Telegram takes our own code and how long it works, reports by itself over https, and is believed only signed and fresh', async () => {
    const { telegramConfig, toTelegramBody, readTelegramAnswer, readTelegramReport, telegramSigned } = await import('./telegram');
    const { createHash, createHmac } = await import('crypto');
    expect(telegramConfig({}, false).state).toBe('not_set_up');
    const c = telegramConfig({ TELEGRAM_GATEWAY_TOKEN: 'tok', SBG_PUBLIC_URL: 'https://seebuyget.com' }, false);
    expect(c).toMatchObject({ state: 'ready', reports: true, callbackUrl: 'https://seebuyget.com/v1/sms/status/telegram' });
    expect(JSON.parse(toTelegramBody(c, ET_NUMBER, '482915', 10))).toEqual({ phone_number: ET_NUMBER, code: '482915', ttl: 600, callback_url: 'https://seebuyget.com/v1/sms/status/telegram' });
    expect(readTelegramAnswer(200, JSON.stringify({ ok: true, result: { request_id: 'req1', phone_number: ET_NUMBER, request_cost: 0.01 } }))).toEqual({ ok: true, ref: 'req1' });
    expect(readTelegramAnswer(200, JSON.stringify({ ok: false, error: 'PHONE_NUMBER_INVALID' }))).toEqual({ ok: false, kind: 'rejected', code: 'PHONE_NUMBER_INVALID' });
    expect(readTelegramAnswer(200, JSON.stringify({ ok: false, error: 'BALANCE_NOT_ENOUGH' }))).toEqual({ ok: false, kind: 'refused', code: 'BALANCE_NOT_ENOUGH' });
    expect(readTelegramReport({ request_id: 'req1', delivery_status: { status: 'read', updated_at: 1 } })).toEqual({ ref: 'req1', outcome: 'delivered' });
    expect(readTelegramReport({ request_id: 'req1', delivery_status: { status: 'expired', updated_at: 1 } })).toEqual({ ref: 'req1', outcome: 'failed' });
    expect(readTelegramReport({ request_id: 'req1', delivery_status: { status: 'sent', updated_at: 1 } })).toBeUndefined();
    const now = Date.parse('2026-11-16T10:00:00Z');
    const ts = String(Math.floor(now / 1000));
    const raw = Buffer.from(JSON.stringify({ request_id: 'req1', delivery_status: { status: 'delivered' } }));
    const sig = createHmac('sha256', createHash('sha256').update('tok').digest()).update(ts + '\n' + raw.toString()).digest('hex');
    expect(telegramSigned(raw, ts, sig, 'tok', now)).toBe(true);
    expect(telegramSigned(raw, ts, sig, 'other', now)).toBe(false);
    expect(telegramSigned(raw, ts, sig, 'tok', now + 3_600_000)).toBe(false);
    expect(telegramSigned(raw, undefined, sig, 'tok', now)).toBe(false);
  });
});

describe('the report doors', () => {
  it('Meta’s check of the address is answered only with our own verify token', async () => {
    const { SmsStatusController } = await import('./sms-status.controller');
    const doors = new SmsStatusController(make([]), { config: { verifyToken: 'our-token' } } as never, { config: {} } as never);
    expect(doors.whatsAppVerify('subscribe', 'our-token', 'abc123')).toBe('abc123');
    expect(() => doors.whatsAppVerify('subscribe', 'a-guess', 'abc123')).toThrow();
    expect(() => doors.whatsAppVerify('unsubscribe', 'our-token', 'abc123')).toThrow();
    expect(() => new SmsStatusController(make([]), { config: {} } as never, { config: {} } as never).whatsAppVerify('subscribe', undefined, 'abc123')).toThrow();
  });
});
