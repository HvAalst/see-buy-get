import type { FieldEncryption } from '../data-firewall/field-encryption.service';
import { GlosError } from '../http/glos-error';
import { MOLLIE_CALLBACK_PATH } from './mollie-client';
import { MOLLIE_STATE_TTL_MS, MollieConnectService, mollieConfigFromEnv } from './mollie-connect.service';
import { MOLLIE_SCOPES, type MollieConfig, type MolliePayee } from './mollie.types';
import { MollieController } from '../../modules/pudo/mollie.controller';
import type { DriverService } from '../../modules/pudo/driver.service';
import type { FleetManagerService } from '../../modules/pudo/fleet-manager.service';

/*
 * 2026-11-19 — A CARRIER CONNECTS ITS OWN MOLLIE ACCOUNT (the payments plan, part 2; the owner: "Netherlands: Mollie"). What is
 * held to here: Mollie's own sign-in with a state only we know, good once and for ten minutes; the code exchanged with the
 * app's own secret; a profile that can take payments chosen; the tokens kept sealed, renewed before they lapse, and given back
 * on a disconnect; a refused renewal marks the connection lost, a Mollie that does not answer does not. Before the Connect app
 * exists our own test key stands in, for test money only — never a live key, and never a stand-in Mollie outside a sandbox.
 */

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
type Answer = { status: number; body?: unknown } | 'down';

/** A stand-in for Mollie: its answers can be changed while a test runs (`routes`), and every call it was sent is kept. */
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
  return { fetchImpl, calls, routes, form: (c: Call) => Object.fromEntries(new URLSearchParams(c.body ?? '')) };
}

const crypt = { encrypt: (s: string) => `sealed(${Buffer.from(s).toString('base64')})`, decrypt: (s: string) => Buffer.from(s.slice(7, -1), 'base64').toString() } as unknown as FieldEncryption;
const APP: MollieConfig = { clientId: 'app_seebuyget', clientSecret: 'app-secret', testmode: true, publicBase: 'https://seebuyget.test', host: 'https://mollie.stand-in' };
const COURIER: MolliePayee = { payeeId: 'did:glos:courier-utrecht', country: 'NL', by: 'did:glos:courier-utrecht', back: 'driver' };
const T0 = Date.parse('2026-11-20T09:00:00Z');

const tokens = (access: string, refresh?: string) => ({ status: 200, body: { access_token: access, ...(refresh ? { refresh_token: refresh } : {}), expires_in: 3600, token_type: 'bearer', scope: MOLLIE_SCOPES.join(' ') } });
const READY = {
  'GET /v2/profiles': () => ({ status: 200, body: { _embedded: { profiles: [ { id: 'pfl_test', name: 'Testing', status: 'unverified' }, { id: 'pfl_live', name: 'Van Dijk Transport', status: 'verified' } ] } } }),
  'GET /v2/organizations/me': () => ({ status: 200, body: { id: 'org_1', name: 'Van Dijk Transport', registrationNumber: '12345678', vatNumber: 'NL123456789B01', address: { streetAndNumber: 'Kanaalweg 1', postalCode: '3526 KL', city: 'Utrecht', country: 'NL' } } }),
  'GET /v2/onboarding/me': () => ({ status: 200, body: { status: 'completed', canReceivePayments: true, _links: { dashboard: { href: 'https://my.mollie.com/dashboard/org_1' } } } }),
};

async function connected(routes: Record<string, (c: Call) => Answer> = {}) {
  const mollie = aMollie({ 'POST /oauth2/tokens': () => tokens('access_1', 'refresh_1'), ...READY, ...routes });
  const svc = new MollieConnectService(crypt, APP, mollie.fetchImpl);
  const url = new URL(svc.connect(COURIER, T0).url!);
  const back = await svc.finish({ code: 'auth_code', state: url.searchParams.get('state') ?? '' }, T0 + 20_000);
  return { svc, mollie, back, url };
}

describe('connecting a carrier’s own Mollie account', () => {
  it('goes through Mollie’s own sign-in, with the scopes the work needs and a state only we know', () => {
    const svc = new MollieConnectService(crypt, APP, aMollie({}).fetchImpl);
    expect(svc.via()).toBe('oauth');
    const url = new URL(svc.connect(COURIER, T0).url!);
    expect(`${url.origin}${url.pathname}`).toBe('https://mollie.stand-in/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('app_seebuyget');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('payments.read payments.write profiles.read onboarding.read organizations.read');
    expect(url.searchParams.get('redirect_uri')).toBe(`https://seebuyget.test${MOLLIE_CALLBACK_PATH}`);
    expect((url.searchParams.get('state') ?? '').length).toBeGreaterThanOrEqual(32);
  });

  it('back from the sign-in: the code exchanged with the app’s own secret, a verified profile chosen, the company read, the tokens kept sealed', async () => {
    const { svc, mollie, back } = await connected();
    expect(back).toEqual({ back: 'driver', outcome: 'connected' });
    const exchange = mollie.calls.find((c) => c.url.endsWith('/oauth2/tokens'))!;
    expect(exchange.headers.authorization).toBe(`Basic ${Buffer.from('app_seebuyget:app-secret').toString('base64')}`);
    expect(mollie.form(exchange)).toEqual({ grant_type: 'authorization_code', code: 'auth_code', redirect_uri: `https://seebuyget.test${MOLLIE_CALLBACK_PATH}` });
    expect(mollie.calls.find((c) => c.url.endsWith('/v2/profiles?limit=50'))!.headers.authorization).toBe('Bearer access_1');
    const kept = svc.connection(COURIER.payeeId)!;
    expect(kept).toMatchObject({ via: 'oauth', profileId: 'pfl_live', testmode: true, organization: { name: 'Van Dijk Transport', registrationNumber: '12345678', vatNumber: 'NL123456789B01' } });
    expect(kept.accessToken).not.toContain('access_1');
    expect(kept.refreshToken).not.toContain('refresh_1');
    expect(svc.view(COURIER, T0 + 30_000)).toEqual({ available: true, via: 'oauth', connected: expect.objectContaining({ organizationName: 'Van Dijk Transport', profileName: 'Van Dijk Transport', canReceivePayments: true, onboarding: 'completed', testmode: true }) });
  });

  it('a state is good once, and for ten minutes', async () => {
    const { svc } = await connected();
    const again = svc.connect(COURIER, T0);
    const state = new URL(again.url!).searchParams.get('state') ?? '';
    expect(await svc.finish({ code: 'c', state }, T0 + MOLLIE_STATE_TTL_MS + 1)).toEqual({ back: 'driver', outcome: 'failed', why: 'expired' });
    expect(await svc.finish({ code: 'c', state }, T0 + 1_000)).toEqual({ back: 'driver', outcome: 'failed', why: 'expired' });
    expect(await svc.finish({ code: 'c', state: 'made-up' }, T0)).toEqual({ back: 'driver', outcome: 'failed', why: 'expired' });
  });

  it('a sign-in refused at Mollie is said as that; an account with no profile is not connected, and the access is given back', async () => {
    const svc = new MollieConnectService(crypt, APP, aMollie({}).fetchImpl);
    const state = new URL(svc.connect(COURIER, T0).url!).searchParams.get('state') ?? '';
    expect(await svc.finish({ error: 'access_denied', state }, T0)).toEqual({ back: 'driver', outcome: 'failed', why: 'denied' });

    const bare = aMollie({ 'POST /oauth2/tokens': () => tokens('access_9', 'refresh_9'), 'GET /v2/profiles': () => ({ status: 200, body: { _embedded: { profiles: [] } } }), 'DELETE /oauth2/tokens': () => ({ status: 204 }) });
    const none = new MollieConnectService(crypt, APP, bare.fetchImpl);
    const s2 = new URL(none.connect(COURIER, T0).url!).searchParams.get('state') ?? '';
    expect(await none.finish({ code: 'c', state: s2 }, T0)).toEqual({ back: 'driver', outcome: 'failed', why: 'no_profile' });
    expect(none.connection(COURIER.payeeId)).toBeUndefined();
    const given = bare.calls.find((c) => c.method === 'DELETE')!;
    expect(bare.form(given)).toEqual({ token_type_hint: 'refresh_token', token: 'refresh_9' });
  });

  it('renews the token before it lapses, keeps a new refresh token when Mollie gives one, and asks nothing while it is good', async () => {
    const { svc, mollie } = await connected({});
    mollie.calls.length = 0;
    expect((await svc.tokenFor(COURIER.payeeId, T0 + 30 * 60_000)).bearer).toBe('access_1');
    expect(mollie.calls).toEqual([]);
    // Mollie hands back a new refresh token with this renewal.
    mollie.routes['POST /oauth2/tokens'] = () => tokens('access_2', 'refresh_2');
    mollie.routes['DELETE /oauth2/tokens'] = () => ({ status: 204 });
    expect(await svc.tokenFor(COURIER.payeeId, T0 + 56 * 60_000)).toEqual({ bearer: 'access_2', via: 'oauth', testmode: true, profileId: 'pfl_live' });
    expect(mollie.form(mollie.calls[0])).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh_1' });
    await svc.disconnect(COURIER);
    expect(mollie.form(mollie.calls.find((c) => c.method === 'DELETE')!)).toEqual({ token_type_hint: 'refresh_token', token: 'refresh_2' });
    expect(svc.view(COURIER).connected).toBeUndefined();
  });

  it('a refused renewal marks the connection lost; a Mollie that does not answer leaves it as it is', async () => {
    const down = await connected({});
    down.mollie.routes['POST /oauth2/tokens'] = () => 'down';
    await expect(down.svc.tokenFor(COURIER.payeeId, T0 + 2 * 3_600_000)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(down.svc.connection(COURIER.payeeId)?.lostAt).toBeUndefined();

    const taken = await connected({});
    taken.mollie.routes['POST /oauth2/tokens'] = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'The refresh token is invalid' } });
    await expect(taken.svc.tokenFor(COURIER.payeeId, T0 + 2 * 3_600_000)).rejects.toThrow(/connect it again in Settings/);
    expect(taken.svc.view(COURIER, T0 + 2 * 3_600_000).connected?.lostAt).toBe(new Date(T0 + 2 * 3_600_000).toISOString());
    await expect(taken.svc.tokenFor(COURIER.payeeId, T0 + 3 * 3_600_000)).rejects.toThrow(/connect it again in Settings/);
  });

  it('with only our test key: connected at once, test money only, and Mollie is not asked', async () => {
    const mollie = aMollie({});
    const svc = new MollieConnectService(crypt, { testKey: 'test_abc123', testmode: true, publicBase: 'https://seebuyget.test' }, mollie.fetchImpl);
    expect(svc.via()).toBe('test_key');
    expect(svc.connect(COURIER, T0)).toEqual({ connected: expect.objectContaining({ via: 'test_key', testmode: true }) });
    expect(await svc.tokenFor(COURIER.payeeId, T0)).toEqual({ bearer: 'test_abc123', via: 'test_key', testmode: true });
    expect(mollie.calls).toEqual([]);
  });

  it('never takes a live key as the test key, nor a stand-in Mollie outside a sandbox; live only when the owner says so', () => {
    const was = process.env.GLOS_ENV;
    try {
      expect(mollieConfigFromEnv({ GLOS_MOLLIE_TEST_KEY: 'live_secret' }).testKey).toBeUndefined();
      expect(mollieConfigFromEnv({ GLOS_MOLLIE_TEST_KEY: ' test_ok ' }).testKey).toBe('test_ok');
      expect(mollieConfigFromEnv({}).testmode).toBe(true);
      expect(mollieConfigFromEnv({ GLOS_MOLLIE_LIVE: 'true' }).testmode).toBe(false);
      expect(mollieConfigFromEnv({ SBG_PUBLIC_URL: 'https://seebuyget.com/' }).publicBase).toBe('https://seebuyget.com');
      process.env.GLOS_ENV = 'production';
      expect(mollieConfigFromEnv({ GLOS_MOLLIE_HOST: 'http://localhost:9999' }).host).toBeUndefined();
      process.env.GLOS_ENV = 'test';
      expect(mollieConfigFromEnv({ GLOS_MOLLIE_HOST: 'http://localhost:9999/' }).host).toBe('http://localhost:9999');
    } finally {
      process.env.GLOS_ENV = was;
    }
  });

  it('is for carriers in the Netherlands, where it is set up: not elsewhere, not a fleet driver, not before it is set up', () => {
    const svc = new MollieConnectService(crypt, APP, aMollie({}).fetchImpl);
    expect(svc.view({ ...COURIER, country: 'KE' })).toEqual({ available: false, why: 'country' });
    expect(svc.view({ notPayee: 'Your fleet is paid for your work: its office connects Mollie', country: 'NL' })).toEqual({ available: false, why: 'fleet' });
    expect(new MollieConnectService(crypt, { testmode: true }, aMollie({}).fetchImpl).view(COURIER)).toEqual({ available: false, why: 'off' });
    expect(() => svc.connect({ ...COURIER, country: 'ET' }, T0)).toThrow(GlosError);
    expect(svc.backTo({ back: 'driver', outcome: 'connected' })).toBe('https://seebuyget.test/driver/?mollie=connected');
    expect(svc.backTo({ back: 'fleet', outcome: 'failed', why: 'denied' })).toBe('https://seebuyget.test/fleet/?mollie=failed&why=denied');
  });
});

describe('whose account it is', () => {
  const svc = new MollieConnectService(crypt, APP, aMollie({}).fetchImpl);
  const drivers = { get: (did: string) => (did === 'did:glos:courier-utrecht' ? { did, jurisdiction: 'NL' } : { did, jurisdiction: 'NL', managerDid: 'did:glos:fleet-1' }) } as unknown as DriverService;
  const managers = { get: (did: string) => ({ did, jurisdiction: 'NL' }) } as unknown as FleetManagerService;
  const doors = new MollieController(svc, drivers, managers, {} as never);

  it('a courier’s own; a fleet driver’s is its fleet’s, connected by the office; staff connect nobody’s', () => {
    expect(doors.mine({ role: 'driver', did: 'did:glos:courier-utrecht' } as never).available).toBe(true);
    expect(doors.mine({ role: 'driver', did: 'did:glos:fleet-driver' } as never)).toEqual({ available: false, why: 'fleet' });
    expect(() => doors.connect({ role: 'driver', did: 'did:glos:fleet-driver' } as never)).toThrow(/its office connects Mollie/);
    expect(doors.connect({ role: 'fleet_manager', did: 'did:glos:office-person', tenant: 'did:glos:fleet-1' } as never).url).toContain('/oauth2/authorize');
    expect(() => doors.mine({ role: 'operator', did: 'ops1' } as never)).toThrow(/Staff do not connect/);
  });
});
