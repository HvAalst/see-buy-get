import { readTruecallerCallback, truecallerConfig, truecallerEndpoint, truecallerLink, truecallerNumbers } from '../../foundation/sms/truecaller';
import { TruecallerRoute } from '../../foundation/sms/truecaller.route';
import { CodeRouteService } from '../../foundation/sms/code-route.service';
import { SmsService } from '../../foundation/sms/sms.service';
import { TruecallerService } from './truecaller.service';
import type { OtpService } from './otp.service';

/*
 * 2026-11-17 — A NUMBER CONFIRMED BY TRUECALLER (the owner, of the BRICS nations' own apps: "as recommended … build it"). No
 * code: Truecaller on the person's Android phone says which number its account holds, and it must be the one they typed. The
 * callback is unsigned, so it counts only for our own secret request number, and the profile is fetched only from Truecaller's
 * own address. Only the numbers are read; nothing is kept.
 */
describe('Truecaller on the wire', () => {
  it('is set up by its app key; a sandbox never asks it', () => {
    expect(truecallerConfig({}, false).state).toBe('not_set_up');
    expect(truecallerConfig({ TRUECALLER_APP_KEY: 'k' }, true).state).toBe('sandbox');
    expect(truecallerConfig({ TRUECALLER_APP_KEY: 'k' }, false)).toEqual({ state: 'ready', appKey: 'k', appName: 'SeeBuyGet' });
  });

  it('builds the link Truecaller’s pages give, with our privacy and terms pages', () => {
    const link = truecallerLink({ state: 'ready', appKey: 'KEY1', appName: 'SeeBuyGet' }, 'nonce-123456', 'en', 'https://seebuyget.com');
    expect(link.startsWith('truecallersdk://truesdk/web_verify?')).toBe(true);
    const q = new URLSearchParams(link.split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({ type: 'btmsheet', requestNonce: 'nonce-123456', partnerKey: 'KEY1', partnerName: 'SeeBuyGet', lang: 'en', privacyUrl: 'https://seebuyget.com/privacy/', termsUrl: 'https://seebuyget.com/terms/' });
  });

  it('reads its three callbacks, and nothing else', () => {
    expect(readTruecallerCallback({ requestId: 'n1', status: 'flow_invoked' })).toEqual({ requestId: 'n1', kind: 'invoked' });
    expect(readTruecallerCallback({ requestId: 'n1', status: 'user_rejected' })).toEqual({ requestId: 'n1', kind: 'rejected' });
    expect(readTruecallerCallback({ requestId: 'n1', accessToken: 't', endpoint: 'https://profile4-noneu.truecaller.com/v1/default' })).toMatchObject({ kind: 'approved', accessToken: 't' });
    expect(readTruecallerCallback({ status: 'flow_invoked' })).toBeUndefined();
  });

  it('fetches a profile only from an https address of Truecaller’s own', () => {
    expect(truecallerEndpoint('https://profile4-noneu.truecaller.com/v1/default')).toBe('https://profile4-noneu.truecaller.com/v1/default');
    expect(truecallerEndpoint('http://profile4-noneu.truecaller.com/v1/default')).toBeUndefined();
    expect(truecallerEndpoint('https://truecaller.com.attacker.example/v1')).toBeUndefined();
    expect(truecallerEndpoint('https://eviltruecaller.com/v1')).toBeUndefined();
    expect(truecallerEndpoint('https://user:pw@api.truecaller.com/v1')).toBeUndefined();
    expect(truecallerEndpoint('not a url')).toBeUndefined();
  });

  it('reads only the profile’s numbers, as E.164', () => {
    expect(truecallerNumbers({ phoneNumbers: [254712345678, '919876543210'], name: { first: 'Amina' }, onlineIdentities: { email: 'a@b.c' } })).toEqual(['+254712345678', '+919876543210']);
    expect(truecallerNumbers({})).toEqual([]);
  });
});

describe('a number confirmed by Truecaller', () => {
  const KE = '+254712345678';
  const setup = (offered = true) => {
    const vouched: string[] = [];
    const noted: Array<[string, boolean]> = [];
    const otp = { phoneFor: (p: string) => (p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`), vouch: (p: string) => void vouched.push(p) } as unknown as OtpService;
    const routes = { offers: () => offered, noteConfirm: (p: string, _r: string, ok: boolean) => void noted.push([p, ok]) } as unknown as CodeRouteService;
    const route = new TruecallerRoute({ state: 'ready', appKey: 'KEY1', appName: 'SeeBuyGet' });
    return { vouched, noted, svc: new TruecallerService(otp, routes, route) };
  };
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const profileAnswers = (numbers: unknown[], status = 200) => {
    const calls: Array<{ url: string; auth?: string }> = [];
    global.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: String(url), auth: init?.headers?.authorization });
      return { status, json: async () => ({ phoneNumbers: numbers, name: { first: 'Amina' } }) } as Response;
    }) as typeof fetch;
    return calls;
  };

  it('approved with the number typed: confirmed, as a code typed would be — the token sent only to Truecaller', async () => {
    const { svc, vouched, noted } = setup();
    const calls = profileAnswers([254712345678]);
    const { nonce, link } = svc.start(KE, 'en');
    expect(link).toContain(`requestNonce=${nonce}`);
    expect(svc.status(nonce).state).toBe('waiting');
    await svc.callback({ requestId: nonce, status: 'flow_invoked' });
    expect(svc.status(nonce).state).toBe('opened');
    await svc.callback({ requestId: nonce, accessToken: 'tok', endpoint: 'https://profile4-noneu.truecaller.com/v1/default' });
    expect(svc.status(nonce).state).toBe('confirmed');
    expect(vouched).toEqual([KE]);
    expect(noted).toEqual([[KE, true]]);
    expect(calls).toEqual([{ url: 'https://profile4-noneu.truecaller.com/v1/default', auth: 'Bearer tok' }]);
  });

  it('a Truecaller account on another number confirms nothing', async () => {
    const { svc, vouched } = setup();
    profileAnswers([254700000000]);
    const { nonce } = svc.start(KE, 'en');
    await svc.callback({ requestId: nonce, accessToken: 'tok', endpoint: 'https://api.truecaller.com/v1' });
    expect(svc.status(nonce).state).toBe('other_number');
    expect(vouched).toEqual([]);
  });

  it('a forged callback naming its own address, or one for a request number we never made, confirms nothing', async () => {
    const { svc, vouched } = setup();
    const calls = profileAnswers([254712345678]);
    const { nonce } = svc.start(KE, 'en');
    await svc.callback({ requestId: nonce, accessToken: 'tok', endpoint: 'https://attacker.example/profile' });
    expect(svc.status(nonce).state).toBe('failed');
    await svc.callback({ requestId: 'never-made-1234', accessToken: 'tok', endpoint: 'https://api.truecaller.com/v1' });
    expect(calls).toEqual([]);
    expect(vouched).toEqual([]);
  });

  it('declined, unreadable, or ten minutes gone: no confirmation, and the page sends a code', async () => {
    const { svc, vouched } = setup();
    const t0 = Date.parse('2026-11-17T10:00:00Z');
    const a = svc.start(KE, 'en', t0);
    await svc.callback({ requestId: a.nonce, status: 'user_rejected' }, t0 + 1000);
    expect(svc.status(a.nonce, t0 + 2000).state).toBe('rejected');
    profileAnswers([254712345678], 401);
    const b = svc.start('+254711111111', 'en', t0 + 30_000);
    await svc.callback({ requestId: b.nonce, accessToken: 'tok', endpoint: 'https://api.truecaller.com/v1' }, t0 + 31_000);
    expect(svc.status(b.nonce, t0 + 32_000).state).toBe('failed');
    const c = svc.start('+254722222222', 'en', t0 + 60_000);
    expect(svc.status(c.nonce, t0 + 60_000 + 11 * 60_000).state).toBe('expired');
    expect(svc.status('unknown-nonce').state).toBe('expired');
    expect(vouched).toEqual([]);
  });

  it('only where it is offered, and one try at a time per number', () => {
    expect(() => setup(false).svc.start(KE, 'en')).toThrow(/not offered/);
    const { svc } = setup();
    const t0 = Date.parse('2026-11-17T10:00:00Z');
    svc.start(KE, 'en', t0);
    expect(() => svc.start(KE, 'en', t0 + 5000)).toThrow(/a moment ago/);
    expect(() => svc.start(KE, 'en', t0 + 20_000)).not.toThrow();
  });

  it('an approval arriving after the ten minutes confirms nothing', async () => {
    const { svc, vouched } = setup();
    const calls = profileAnswers([254712345678]);
    const t0 = Date.parse('2026-11-17T10:00:00Z');
    const { nonce } = svc.start(KE, 'en', t0);
    await svc.callback({ requestId: nonce, accessToken: 'tok', endpoint: 'https://api.truecaller.com/v1' }, t0 + 10 * 60_000 + 1);
    expect(calls).toEqual([]);
    expect(vouched).toEqual([]);
  });

  it('a new phone’s or a payout number’s code is never offered by Truecaller: it carries no code', () => {
    const tc = new TruecallerRoute({ state: 'ready', appKey: 'k', appName: 'SeeBuyGet' });
    const routes = new CodeRouteService([tc]);
    routes.onModuleDestroy();
    expect(routes.ways(KE)).toEqual(['truecaller']);
    expect(new SmsService({ send: async () => undefined } as never, undefined, routes).waysFor(KE)).toEqual([]);
  });

  it('opens Truecaller in the app’s language where its sheet speaks it, in English otherwise', () => {
    const { svc } = setup();
    expect(svc.start('+254733333333', 'sw').link).toContain('lang=sw');
    expect(svc.start('+254744444444', 'am').link).toContain('lang=en');
    expect(svc.start('+254755555555', 'x"y').link).toContain('lang=en');
  });
});
