import type { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import type { EntityService } from '../../foundation/entity/entity.service';
import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import type { MollieConfig } from '../../foundation/mollie/mollie.types';
import type { DispatchService } from './dispatch.service';
import { DirectPayService, feeAllowed } from './direct-pay.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';

/*
 * 2026-11-19 — A LOAD'S PRICE, PAID AT THE HANDOVER BY MOLLIE (the payments plan, part 2b; the owner: "Netherlands: Mollie", "a
 * small fee for server costs"). What is held to here: the payment is made on the Mollie account of whoever is paid for the
 * load, its page shown as a QR code; one still open is shown again, never a second; Mollie's notice counts only as Mollie's
 * own answer, for the amount asked, and marks the load paid by Mollie with its id; our fee only where the country set it and
 * Mollie allows it, never on the test key; only the driver it is on or its fleet's office asks; and the payer's page says
 * how it went, by our own reference.
 */

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
type Answer = { status: number; body?: unknown } | 'down';
function aMollie(given: Record<string, (c: Call) => Answer>) {
  const routes = { ...given };
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const c: Call = { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined };
    calls.push(c);
    const route = routes[`${c.method} ${new URL(url).pathname}`];
    const a = route ? route(c) : { status: 404, body: { status: 404, title: 'Not Found', detail: 'No such route' } };
    if (a === 'down') throw new Error('connect ETIMEDOUT');
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls, routes };
}

const crypt = { encrypt: (s: string) => `sealed(${Buffer.from(s).toString('base64')})`, decrypt: (s: string) => Buffer.from(s.slice(7, -1), 'base64').toString() } as unknown as FieldEncryption;
const APP: MollieConfig = { clientId: 'app_seebuyget', clientSecret: 'app-secret', testmode: true, publicBase: 'https://seebuyget.test', host: 'https://mollie.stand-in' };
const T0 = Date.parse('2026-11-20T10:00:00Z');
const COURIER = 'did:glos:courier-utrecht';
const FLEET_DRIVER = 'did:glos:fleet-driver';
const KENYAN = 'did:glos:courier-nairobi';
const CHECKOUT = 'https://www.mollie.com/checkout/select-method/tr_1';

const CONNECT = {
  'POST /oauth2/tokens': () => ({ status: 200, body: { access_token: 'access_1', refresh_token: 'refresh_1', expires_in: 3600 } }),
  'GET /v2/profiles': () => ({ status: 200, body: { _embedded: { profiles: [{ id: 'pfl_live', name: 'Van Dijk Transport', status: 'verified' }] } } }),
  'GET /v2/organizations/me': () => ({ status: 200, body: { id: 'org_1', name: 'Van Dijk Transport' } }),
  'GET /v2/onboarding/me': () => ({ status: 200, body: { status: 'completed', canReceivePayments: true } }),
};
let paymentStatus: { status: string; paidAt?: string; value?: string } = { status: 'open' };
const PAYMENTS = {
  'POST /v2/payments': () => ({ status: 201, body: { id: 'tr_1', status: 'open', expiresAt: new Date(T0 + 15 * 60_000).toISOString(), amount: { currency: 'EUR', value: '180.00' }, _links: { checkout: { href: CHECKOUT } } } }),
  'GET /v2/payments/tr_1': () => ({ status: 200, body: { id: 'tr_1', status: paymentStatus.status, ...(paymentStatus.paidAt ? { paidAt: paymentStatus.paidAt } : {}), amount: { currency: 'EUR', value: paymentStatus.value ?? '180.00' } } }),
};

function aWorld(opts: { cfg?: MollieConfig; fee?: number; connect?: string[] } = {}) {
  paymentStatus = { status: 'open' };
  const mollie = aMollie({ ...CONNECT, ...PAYMENTS });
  const connect = new MollieConnectService(crypt, opts.cfg ?? APP, mollie.fetchImpl);
  const loads = new Map<string, Record<string, unknown>>();
  const load = (id: string, over: Record<string, unknown> = {}) => loads.set(id, { freightId: id, code: id.toUpperCase().replace('_', '-'), status: 'in_transit', settlement: 'between_parties', lockedPrice: 180, lockedCurrency: 'EUR', claimedBy: COURIER, pickupLabel: 'Utrecht', destLabel: 'Rotterdam', ...over });
  const confirmed: unknown[][] = [];
  const dispatch = {
    requireFreightPublic: (id: string) => loads.get(id),
    confirmPaidDirect: (id: string, by: string, now: number, reference?: string) => {
      confirmed.push([id, by, now, reference]);
      const f = loads.get(id)!;
      f.paidDirect = { at: new Date(now).toISOString(), amount: f.lockedPrice, currency: 'EUR', by, reference };
      return f;
    },
  } as unknown as DispatchService;
  const DRIVERS: Record<string, unknown> = { [COURIER]: { did: COURIER, jurisdiction: 'NL' }, [FLEET_DRIVER]: { did: FLEET_DRIVER, jurisdiction: 'NL', managerDid: 'did:glos:fleet-1' }, [KENYAN]: { did: KENYAN, jurisdiction: 'KE' } };
  const drivers = { get: (did: string) => DRIVERS[did] } as unknown as DriverService;
  const managers = { get: (did: string) => ({ did, jurisdiction: 'NL' }) } as unknown as FleetManagerService;
  const entities = { sisterRecordFor: (c: string) => (c === 'NL' ? { entityId: 'ent_nl' } : undefined), amountsFor: () => ({ directPayFee: opts.fee ?? 0.5, currency: 'EUR' }) } as unknown as EntityService;
  const svc = new DirectPayService(connect, dispatch, drivers, managers, entities);
  const join = async (payeeId: string) => {
    const started = connect.connect({ payeeId, country: 'NL', by: payeeId, back: 'driver' }, T0);
    if (started.url) await connect.finish({ code: 'c', state: new URL(started.url).searchParams.get('state') ?? '' }, T0);
  };
  return { svc, mollie, connect, load, loads, confirmed, join };
}

const courier = { role: 'driver', did: COURIER } as never;
const body = (c: { body?: string }) => JSON.parse(c.body ?? '{}') as Record<string, unknown>;

describe('a load’s price, paid at the handover by Mollie', () => {
  it('is not offered where it cannot be: a load we pay for, paid already, elsewhere, not in euros, not connected', async () => {
    const w = aWorld();
    w.load('frt_billed', { settlement: undefined });
    expect(w.svc.view('frt_billed', courier, T0)).toEqual({ available: false, why: 'not_direct' });
    w.load('frt_paid', { paidDirect: { at: 'x', amount: 180, by: 'driver' } });
    expect(w.svc.view('frt_paid', courier, T0)).toEqual({ available: false, why: 'paid' });
    w.load('frt_ke', { claimedBy: KENYAN, lockedCurrency: 'KES' });
    expect(w.svc.view('frt_ke', { role: 'driver', did: KENYAN } as never, T0)).toEqual({ available: false, why: 'not_mollie' });
    w.load('frt_usd', { lockedCurrency: 'USD' });
    expect(w.svc.view('frt_usd', courier, T0)).toEqual({ available: false, why: 'not_eur' });
    w.load('frt_1');
    expect(w.svc.view('frt_1', courier, T0)).toEqual({ available: false, why: 'not_connected' });
    w.load('frt_fleet', { claimedBy: FLEET_DRIVER });
    expect(w.svc.view('frt_fleet', { role: 'driver', did: FLEET_DRIVER } as never, T0)).toEqual({ available: false, why: 'office_connects' });
    expect(w.svc.view('frt_fleet', { role: 'fleet_manager', did: 'office', tenant: 'did:glos:fleet-1' } as never, T0)).toEqual({ available: false, why: 'not_connected' });
    await expect(w.svc.ask('frt_1', courier, T0)).rejects.toThrow('Connect Mollie in Settings first');
  });

  it('asks on the carrier’s own account: the price agreed, its profile, our fee, our return page and notice address — and shows the page as a QR code', async () => {
    const w = aWorld();
    await w.join(COURIER);
    w.load('frt_1');
    expect(w.svc.view('frt_1', courier, T0)).toEqual({ available: true, amount: 180, currency: 'EUR', fee: 0.5, testmode: true });
    const asked = await w.svc.ask('frt_1', courier, T0);
    const post = w.mollie.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v2/payments'))!;
    expect(post.headers.authorization).toBe('Bearer access_1');
    expect(post.headers['idempotency-key']).toBe('frt_1-1');
    const sent = body(post);
    expect(sent).toMatchObject({ amount: { currency: 'EUR', value: '180.00' }, profileId: 'pfl_live', testmode: true, metadata: { freightId: 'frt_1', code: 'FRT-1' }, webhookUrl: 'https://seebuyget.test/v1/sbg/mollie/webhook', applicationFee: { amount: { currency: 'EUR', value: '0.50' } } });
    expect(String(sent.redirectUrl)).toMatch(/^https:\/\/seebuyget\.test\/v1\/sbg\/mollie\/paid\/[A-Za-z0-9_-]{16}$/);
    expect(String(sent.redirectUrl)).not.toContain('FRT-1');
    expect(asked.payment).toMatchObject({ paymentId: 'tr_1', status: 'open', amount: 180, fee: 0.5, testmode: true, checkoutUrl: CHECKOUT });
    expect(asked.payment?.qrSvg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<path d="M/);
  });

  it('one still open is shown again, never a second beside it; one that lapsed is followed by a new one', async () => {
    const w = aWorld();
    await w.join(COURIER);
    w.load('frt_1');
    await w.svc.ask('frt_1', courier, T0);
    await w.svc.ask('frt_1', courier, T0 + 60_000);
    expect(w.mollie.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/payments'))).toHaveLength(1);
    paymentStatus = { status: 'expired' };
    await w.svc.onWebhook('tr_1', T0 + 16 * 60_000);
    expect(w.svc.view('frt_1', courier, T0 + 16 * 60_000).payment).toMatchObject({ status: 'expired' });
    expect(w.svc.view('frt_1', courier, T0 + 16 * 60_000).payment?.qrSvg).toBeUndefined();
    await w.svc.ask('frt_1', courier, T0 + 17 * 60_000);
    const posts = w.mollie.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/payments'));
    expect(posts).toHaveLength(2);
    expect(posts[1].headers['idempotency-key']).toBe('frt_1-2');
  });

  it('Mollie’s notice: asked of Mollie on the carrier’s token, paid what was asked — marked paid by Mollie, with its id and time', async () => {
    const w = aWorld();
    await w.join(COURIER);
    w.load('frt_1');
    await w.svc.ask('frt_1', courier, T0);
    const before = w.mollie.calls.length;
    await w.svc.onWebhook('tr_unknown', T0);
    expect(w.mollie.calls.length).toBe(before);
    paymentStatus = { status: 'paid', paidAt: '2026-11-20T10:03:00+00:00' };
    await w.svc.onWebhook('tr_1', T0 + 4 * 60_000);
    const asked = w.mollie.calls.find((c) => c.method === 'GET' && c.url.includes('/v2/payments/tr_1'))!;
    expect(asked.url).toMatch(/\/v2\/payments\/tr_1\?testmode=true$/);
    expect(asked.headers.authorization).toBe('Bearer access_1');
    expect(w.confirmed).toEqual([['frt_1', 'mollie', Date.parse('2026-11-20T10:03:00+00:00'), 'tr_1']]);
    expect(w.svc.view('frt_1', courier, T0 + 5 * 60_000)).toMatchObject({ available: false, why: 'paid', payment: { status: 'paid' } });
  });

  it('a payment that comes back for another amount marks nothing paid', async () => {
    const w = aWorld();
    await w.join(COURIER);
    w.load('frt_1');
    await w.svc.ask('frt_1', courier, T0);
    paymentStatus = { status: 'paid', paidAt: '2026-11-20T10:03:00Z', value: '18.00' };
    await w.svc.onWebhook('tr_1', T0);
    expect(w.confirmed).toEqual([]);
  });

  it('looking again asks Mollie about an open payment, no more often than every five seconds', async () => {
    const w = aWorld();
    await w.join(COURIER);
    w.load('frt_1');
    await w.svc.ask('frt_1', courier, T0);
    const gets = () => w.mollie.calls.filter((c) => c.method === 'GET' && c.url.includes('/v2/payments/tr_1')).length;
    await w.svc.look('frt_1', courier, T0 + 1_000);
    expect(gets()).toBe(0);
    paymentStatus = { status: 'paid', paidAt: '2026-11-20T10:00:05Z' };
    await w.svc.look('frt_1', courier, T0 + 6_000);
    expect(gets()).toBe(1);
    expect(w.confirmed).toHaveLength(1);
  });

  it('our fee only where the country set it and Mollie allows it — never on the test key', async () => {
    expect(feeAllowed(180, 168.85)).toBe(true);
    expect(feeAllowed(180, 168.86)).toBe(false);
    expect(feeAllowed(180, 0)).toBe(false);
    const none = aWorld({ fee: 0 });
    await none.join(COURIER);
    none.load('frt_1');
    expect(none.svc.view('frt_1', courier, T0).fee).toBeUndefined();
    await none.svc.ask('frt_1', courier, T0);
    expect(body(none.mollie.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v2/payments'))!).applicationFee).toBeUndefined();
    const above = aWorld({ fee: 200 });
    await above.join(COURIER);
    above.load('frt_1');
    expect(above.svc.view('frt_1', courier, T0).fee).toBeUndefined();

    const test = aWorld({ cfg: { testKey: 'test_abc', testmode: true, publicBase: 'https://seebuyget.test', host: 'https://mollie.stand-in' } });
    await test.join(COURIER);
    test.load('frt_1');
    expect(test.svc.view('frt_1', courier, T0)).toEqual({ available: true, amount: 180, currency: 'EUR', testmode: true });
    await test.svc.ask('frt_1', courier, T0);
    const post = test.mollie.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v2/payments'))!;
    expect(post.headers.authorization).toBe('Bearer test_abc');
    const sent = body(post);
    expect([sent.profileId, sent.testmode, sent.applicationFee]).toEqual([undefined, undefined, undefined]);
  });

  it('only the driver the load is on, or the office of the fleet that is paid for it, asks', async () => {
    const w = aWorld();
    await w.join('did:glos:fleet-1');
    w.load('frt_fleet', { claimedBy: FLEET_DRIVER });
    expect(() => w.svc.view('frt_fleet', courier, T0)).toThrow('This load is not on you');
    expect(() => w.svc.view('frt_fleet', { role: 'fleet_manager', did: 'x', tenant: 'did:glos:fleet-other' } as never, T0)).toThrow('This load is not on you');
    expect(() => w.svc.view('frt_fleet', { role: 'operator', did: 'ops1' } as never, T0)).toThrow('This load is not on you');
    expect(w.svc.view('frt_fleet', { role: 'driver', did: FLEET_DRIVER } as never, T0).available).toBe(true);
    const asked = await w.svc.ask('frt_fleet', { role: 'fleet_manager', did: 'office-person', tenant: 'did:glos:fleet-1' } as never, T0);
    expect(asked.payment?.status).toBe('open');
  });

  it('Mollie’s refusal is said as ours: its own words for a payment it will not take, connect again, or try again', async () => {
    const w = aWorld();
    await w.join(COURIER);
    w.load('frt_1');
    w.mollie.routes['POST /v2/payments'] = () => ({ status: 422, body: { status: 422, title: 'Unprocessable Entity', detail: 'The amount is lower than the minimum', field: 'amount' } });
    await expect(w.svc.ask('frt_1', courier, T0)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Mollie did not take the payment: The amount is lower than the minimum' });
    w.mollie.routes['POST /v2/payments'] = () => ({ status: 401, body: { status: 401, title: 'Unauthorized', detail: 'Missing authentication' } });
    await expect(w.svc.ask('frt_1', courier, T0)).rejects.toThrow('connect Mollie again in Settings');
    w.mollie.routes['POST /v2/payments'] = () => 'down';
    await expect(w.svc.ask('frt_1', courier, T0)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('the page the payer comes back to says how it went, by our own reference, and nothing else', async () => {
    const w = aWorld();
    await w.join(COURIER);
    w.load('frt_1');
    await w.svc.ask('frt_1', courier, T0);
    const ref = String(body(w.mollie.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v2/payments'))!).redirectUrl).split('/').pop()!;
    expect(w.svc.paidPage(ref)).toContain('Nog niet bevestigd');
    paymentStatus = { status: 'paid', paidAt: '2026-11-20T10:03:00Z' };
    await w.svc.onWebhook('tr_1', T0);
    expect(w.svc.paidPage(ref)).toContain('Betaald. De chauffeur ziet het in de app.');
    expect(w.svc.paidPage(ref)).toContain('FRT-1');
    expect(w.svc.paidPage('made-up')).toContain('Deze link is onbekend.');
    expect(w.svc.paidPage('made-up')).not.toContain('FRT-1');
  });
});
