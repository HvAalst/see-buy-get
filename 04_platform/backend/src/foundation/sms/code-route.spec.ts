import { readAtAnswer, readAtReport, africasTalkingConfig, toAtForm } from './africastalking';
import { CodeRouteService, RouteSender, defaultOrder } from './code-route.service';
import type { CodeRouteId, RouteState } from './code-routes.types';
import { SmsSendError } from './sms.types';
import { readTwilioReport, twilioConfig, toTwilioForm } from './twilio';

/*
 * 2026-11-16 — THE WAYS A CODE REACHES A PHONE, STEERED FROM THE STAFF CONSOLE (the owner: "Can we build it in a way that
 * it becomes visual and controlable from the staff console? If so, we implement."; the plan's D1 and D4). A code goes by a
 * country's routes in order — set up and on — the next when one will not take it, the next when one reports it failed or
 * leaves it undelivered for a minute; the way that got a code typed in goes first for that number; staff steer each country.
 */
class FakeRoute implements RouteSender {
  sent: Array<{ to: string; body: string }> = [];
  fail?: SmsSendError;
  n = 0;
  constructor(
    readonly id: CodeRouteId,
    private readonly st: RouteState = 'ready',
    private readonly reports = true,
  ) {}
  state(): RouteState {
    return this.st;
  }
  reportsDelivery(): boolean {
    return this.reports;
  }
  async deliver(sms: { to: string; body: string }): Promise<{ ref?: string }> {
    if (this.fail) throw this.fail;
    this.sent.push(sms);
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
