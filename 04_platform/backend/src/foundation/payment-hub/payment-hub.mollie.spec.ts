import type { FieldEncryption } from '../data-firewall/field-encryption.service';
import { STAFF_AREAS } from '../auth/staff-areas.table';
import { MollieConnectService } from '../mollie/mollie-connect.service';
import type { MollieConfig } from '../mollie/mollie.types';
import { askEveryMs, PaymentHubService, PROMPT_LAPSES_AFTER_MS, QR_ASKED_EVERY_MS, QR_SETTLE_AGAIN_MS } from './payment-hub.service';
import { sameCompany } from './same-company';
import type { MolliePartnerChange } from '../mollie/mollie.types';

/*
 * 2026-11-26 — MONEY IN THROUGH THE PARTNER'S OWN MOLLIE ACCOUNT (the weakness after route plan part 4b, fixed as recommended; the
 * owner: "the system will choose the right method depending on the country without the user noticing it"). Revolut Business only pays
 * out, so in a country of the European Union a sender pays at a partner's counter from a QR code, on a Mollie page, into the partner's
 * own Mollie account — connected by the partner's people through our Connect app, asked for refunds too. Held to here, against a
 * stand-in Mollie at the HTTP level: the partner connects (never outside the EU), the hub then asks by a page and no phone, Mollie's
 * word settles it (a page lapses by Mollie, not our clock), a retry never makes a second payment or refund, an answer lost is found
 * by our own reference, and the page the payer comes back to says how it went. Not connected, or not able to take payments yet: the
 * stand-in, by phone, as before.
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
const PARTNER_BG = { entityId: 'partner-bg', name: 'Sofia Partner OOD', kind: 'partner', jurisdiction: 'BG', currency: 'EUR', status: 'active' };
const PARTNER_KE = { entityId: 'partner-ke', name: 'Nairobi Partner Ltd', kind: 'partner', jurisdiction: 'KE', currency: 'KES', status: 'active' };
const T0 = Date.parse('2026-11-26T09:00:00Z');
const json = (c: Call) => JSON.parse(c.body ?? '{}') as Record<string, unknown>;

function aWorld(opts: { canReceivePayments?: boolean; orgReg?: string; partnerReg?: string } = {}) {
  let status = 'open';
  let refundStatus = 'pending';
  const payments: Array<Record<string, unknown>> = [];
  const refunds: Array<Record<string, unknown>> = [];
  const mollie = aMollie({
    'POST /oauth2/tokens': () => ({ status: 200, body: { access_token: 'access_bg', refresh_token: 'refresh_bg', expires_in: 3600, token_type: 'bearer' } }),
    'GET /v2/profiles': () => ({ status: 200, body: { _embedded: { profiles: [{ id: 'pfl_bg', name: 'Sofia Partner', status: 'verified' }] } } }),
    'GET /v2/organizations/me': () => ({ status: 200, body: { id: 'org_bg', name: 'Sofia Partner OOD', ...(opts.orgReg ? { registrationNumber: opts.orgReg } : {}), address: { country: 'BG' } } }),
    'GET /v2/onboarding/me': () => ({ status: 200, body: { status: 'completed', canReceivePayments: opts.canReceivePayments ?? true } }),
    'POST /v2/payments': (c) => {
      const made = { resource: 'payment', id: `tr_${payments.length + 1}`, status: 'open', amount: json(c).amount, metadata: json(c).metadata, _links: { checkout: { href: `https://mollie.stand-in/checkout/tr_${payments.length + 1}` } } };
      payments.push(made);
      return { status: 201, body: made };
    },
    'GET /v2/payments/tr_1': () => ({ status: 200, body: { ...payments[0], status } }),
    'GET /v2/payments': () => ({ status: 200, body: { _embedded: { payments: payments.map((p) => ({ ...p, status })) } } }),
    'POST /v2/payments/tr_1/refunds': (c) => {
      const r = { resource: 'refund', id: `re_${refunds.length + 1}`, status: 'pending', metadata: json(c).metadata };
      refunds.push(r);
      return { status: 201, body: r };
    },
    'GET /v2/payments/tr_1/refunds': () => ({ status: 200, body: { _embedded: { refunds: refunds.map((r) => ({ ...r, status: refundStatus })) } } }),
  });
  const connect = new MollieConnectService(crypt, APP, mollie.fetchImpl);
  const entities = {
    get: (id: string) => {
      const bg = opts.partnerReg ? { ...PARTNER_BG, record: { registrationNumber: opts.partnerReg } } : PARTNER_BG;
      const e = [bg, PARTNER_KE].find((x) => x.entityId === id);
      if (!e) throw new Error(`no ${id}`);
      return e;
    },
    amountsFor: () => ({}),
  };
  const hub = new PaymentHubService(entities as never, undefined, undefined, undefined, connect);
  const changes: MolliePartnerChange[] = [];
  connect.onPartnerChange((c) => changes.push(c));
  /** The partner's own person connects, through Mollie's sign-in. */
  const connectPartner = async () => {
    const url = new URL(connect.connectPartner(PARTNER_BG.entityId, 'BG', 'Elena Petrova', T0).url!);
    return { url, back: await connect.finish({ code: 'auth_code', state: url.searchParams.get('state') ?? '' }, T0 + 20_000) };
  };
  return { mollie, connect, hub, connectPartner, changes, setStatus: (s: string) => (status = s), setRefund: (s: string) => (refundStatus = s), payments, refunds };
}

describe('the partner connects its own Mollie account, in the Partner app', () => {
  it('through Mollie’s own sign-in, asked for refunds too, and back to the Partner app — never outside the European Union', async () => {
    const w = aWorld();
    const { url, back } = await w.connectPartner();
    expect(url.searchParams.get('scope')).toBe('payments.read payments.write profiles.read onboarding.read organizations.read refunds.read refunds.write');
    expect(back).toEqual({ back: 'partner', outcome: 'connected' });
    expect(w.connect.backTo(back)).toBe('https://seebuyget.test/partner/?mollie=connected');
    expect(w.connect.partnerView(PARTNER_BG.entityId, 'BG', T0 + 30_000)).toMatchObject({ available: true, via: 'oauth', connected: { organizationName: 'Sofia Partner OOD', testmode: true, canReceivePayments: true } });
    expect(() => w.connect.connectPartner(PARTNER_KE.entityId, 'KE', 'Wanjiru', T0)).toThrow('Counter payments go into a Mollie account in the European Union only');
    expect(w.connect.partnerView(PARTNER_KE.entityId, 'KE')).toEqual({ available: false, why: 'country' });
    expect(() => w.connect.connectPartner(PARTNER_BG.entityId, 'BG', ' ', T0)).toThrow('Say who connects it');
    // Disconnected: the leave given back, and its counters take test money by phone again.
    expect(await w.connect.disconnectPartner(PARTNER_BG.entityId, 'BG', 'Georgi Ivanov', T0 + 40_000)).toEqual({ available: true, via: 'oauth' });
    // 2026-11-26 — each change told, by whom, with the company: what the members' emails and staff's checks are made from.
    expect(w.changes).toEqual([
      { entityId: PARTNER_BG.entityId, change: 'connected', by: 'Elena Petrova', organization: expect.objectContaining({ id: 'org_bg', name: 'Sofia Partner OOD' }), at: new Date(T0 + 20_000).toISOString() },
      { entityId: PARTNER_BG.entityId, change: 'disconnected', by: 'Georgi Ivanov', organization: expect.objectContaining({ id: 'org_bg' }), at: new Date(T0 + 40_000).toISOString() },
    ]);
    expect(w.mollie.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/oauth2/tokens'))).toBe(true);
    expect(w.hub.collectsBy(PARTNER_BG.entityId)).toBe('phone');
  });

  it('its doors are the partner’s own: staff never connect it', () => {
    expect(STAFF_AREAS['GET sbg/partner/me/mollie']).toBe('none');
    expect(STAFF_AREAS['POST sbg/partner/me/mollie/connect']).toBe('none');
    expect(STAFF_AREAS['DELETE sbg/partner/me/mollie']).toBe('none');
  });
});

describe('a counter’s payment into the partner’s Mollie account', () => {
  it('not connected yet: the stand-in, by phone, as before — and the console says it waits for the partner', async () => {
    const w = aWorld();
    expect(w.hub.account(PARTNER_BG.entityId).provider).toBe('stand-in');
    expect(w.hub.collectsBy(PARTNER_BG.entityId)).toBe('phone');
    await expect(w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-1', amount: 9.5, description: 'Parcel BG-1' }, T0)).rejects.toThrow('Give the whole phone number');
    expect(await w.hub.accountView(PARTNER_BG.entityId, T0)).toMatchObject({ provider: 'stand-in', collectProvider: 'mollie', collect: { connected: false } });
    // Elsewhere nothing changes: no Mollie line at all.
    expect(await w.hub.accountView(PARTNER_KE.entityId, T0)).not.toHaveProperty('collectProvider');
  });

  it('connected: a Mollie page on the partner’s account, no phone asked, shown as a QR code; pressed again, the same page', async () => {
    const w = aWorld();
    await w.connectPartner();
    expect(w.hub.collectsBy(PARTNER_BG.entityId)).toBe('qr');
    const asked = await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-1', amount: 9.5, description: 'Parcel BG-1, taken in at Magazin Vitosha', siteId: 'did:shop:vitosha' }, T0 + 60_000);
    expect(asked).toMatchObject({ provider: 'mollie', state: 'asked', byQr: true, phoneEnds: '', providerRef: 'tr_1', link: 'https://mollie.stand-in/checkout/tr_1', test: true });
    expect(asked.phoneHash).toBeUndefined();
    const made = w.mollie.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v2/payments'))!;
    expect(made.headers.authorization).toBe('Bearer access_bg');
    expect(made.headers['idempotency-key']).toBe(`hub-${asked.paymentId}`);
    expect(json(made)).toEqual({
      amount: { currency: 'EUR', value: '9.50' },
      description: 'Parcel BG-1, taken in at Magazin Vitosha',
      redirectUrl: `https://seebuyget.test/v1/sbg/payment-hub/paid/${asked.paymentId}`,
      webhookUrl: 'https://seebuyget.test/v1/sbg/mollie/webhook',
      metadata: { ourRef: asked.paymentId },
      profileId: 'pfl_bg',
      testmode: true,
    });
    const view = (await import('./payment-hub.service')).viewOf(asked);
    expect(view).toMatchObject({ byQr: true, link: 'https://mollie.stand-in/checkout/tr_1' });
    expect(view.qrSvg).toMatch(/^<svg /);
    // Pressed again: the same page, never a second payment; another amount is refused while it is open.
    expect((await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-1', amount: 9.5, description: 'Parcel BG-1' }, T0 + 61_000)).paymentId).toBe(asked.paymentId);
    await expect(w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-1', amount: 12, description: 'Parcel BG-1' }, T0 + 62_000)).rejects.toThrow('still open on its page');
    expect(w.payments).toHaveLength(1);
  });

  it('Mollie’s word settles it — a page lapses by Mollie, not by our clock; paid, its page is gone from the view', async () => {
    const w = aWorld();
    await w.connectPartner();
    const asked = await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-2', amount: 9.5, description: 'Parcel BG-2' }, T0 + 60_000);
    // Long past the time a phone prompt lapses: still open at Mollie, so still open here.
    expect((await w.hub.settle(asked.paymentId, T0 + 60_000 + PROMPT_LAPSES_AFTER_MS + 1)).state).toBe('asked');
    w.setStatus('paid');
    const paid = await w.hub.settle(asked.paymentId, T0 + 60_000 + PROMPT_LAPSES_AFTER_MS + 1 + QR_SETTLE_AGAIN_MS);
    expect(paid).toMatchObject({ state: 'paid' });
    expect(paid.link).toBeUndefined();
    expect((await import('./payment-hub.service')).viewOf(paid).qrSvg).toBeUndefined();
    expect(w.mollie.calls.filter((c) => c.method === 'GET' && c.url.includes('/v2/payments/tr_1')).every((c) => c.url.endsWith('?testmode=true'))).toBe(true);
  });

  it('a page Mollie let lapse fails as expired; one never made fails by our clock', async () => {
    const w = aWorld();
    await w.connectPartner();
    const asked = await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-3', amount: 9.5, description: 'Parcel BG-3' }, T0 + 60_000);
    w.setStatus('expired');
    expect(await w.hub.settle(asked.paymentId, T0 + 120_000)).toMatchObject({ state: 'failed', why: 'expired' });

    const down = aWorld();
    await down.connectPartner();
    down.mollie.routes['POST /v2/payments'] = () => 'down';
    down.mollie.routes['GET /v2/payments'] = () => ({ status: 200, body: { _embedded: { payments: [] } } });
    const lost = await down.hub.collect(PARTNER_BG.entityId, { reference: 'BG-4', amount: 9.5, description: 'Parcel BG-4' }, T0 + 60_000);
    expect(lost).toMatchObject({ state: 'asked', byQr: true });
    expect(lost.providerRef).toBeUndefined();
    // Asked by our own reference among the account's latest; not there, and past the time, it lapses.
    expect((await down.hub.settle(lost.paymentId, T0 + 120_000)).state).toBe('asked');
    const listed = down.mollie.calls.find((c) => c.method === 'GET' && new URL(c.url).pathname === '/v2/payments')!;
    expect(new URL(listed.url).searchParams.get('profileId')).toBe('pfl_bg');
    expect(new URL(listed.url).searchParams.get('testmode')).toBe('true');
    expect(await down.hub.settle(lost.paymentId, T0 + 60_000 + PROMPT_LAPSES_AFTER_MS + 1)).toMatchObject({ state: 'failed', why: 'expired' });
  });

  it('an answer lost on the way is found by our own reference', async () => {
    const w = aWorld();
    await w.connectPartner();
    const create = w.mollie.routes['POST /v2/payments'];
    w.mollie.routes['POST /v2/payments'] = (c) => (create(c), 'down');
    const asked = await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-5', amount: 9.5, description: 'Parcel BG-5' }, T0 + 60_000);
    expect(asked.providerRef).toBeUndefined();
    w.setStatus('paid');
    expect(await w.hub.settle(asked.paymentId, T0 + 90_000)).toMatchObject({ state: 'paid', providerRef: 'tr_1' });
  });

  it('given back to the card it was paid from, once — a lost answer found under the payment it gives back', async () => {
    const w = aWorld();
    await w.connectPartner();
    const asked = await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-6', amount: 9.5, description: 'Parcel BG-6' }, T0 + 60_000);
    w.setStatus('paid');
    await w.hub.settle(asked.paymentId, T0 + 90_000);
    const create = w.mollie.routes['POST /v2/payments/tr_1/refunds'];
    w.mollie.routes['POST /v2/payments/tr_1/refunds'] = (c) => (create(c), 'down');
    const back = await w.hub.refund(asked.paymentId, 'Parcel BG-6 voided', T0 + 100_000);
    expect(back).toMatchObject({ kind: 'refund', state: 'asked' });
    const made = w.mollie.calls.find((c) => c.method === 'POST' && c.url.endsWith('/refunds'))!;
    expect(made.headers['idempotency-key']).toBe(`hub-refund-${back.paymentId}`);
    expect(json(made)).toEqual({ amount: { currency: 'EUR', value: '9.50' }, description: 'Parcel BG-6 voided', metadata: { ourRef: back.paymentId }, testmode: true });
    // Asked again: found under the payment it gives back, by our own reference.
    w.setRefund('refunded');
    expect(await w.hub.settle(back.paymentId, T0 + 200_000)).toMatchObject({ state: 'paid', providerRef: 'tr_1/re_1' });
    expect(w.mollie.calls.some((c) => c.method === 'GET' && c.url.includes('/v2/payments/tr_1/refunds') && c.url.includes('testmode=true'))).toBe(true);
    // Once: never a second refund.
    expect((await w.hub.refund(asked.paymentId, 'again', T0 + 300_000)).paymentId).toBe(back.paymentId);
    expect(w.refunds).toHaveLength(1);
  });

  it('an account Mollie still checks, or whose access was taken back, takes test money by phone until it can', async () => {
    const w = aWorld({ canReceivePayments: false });
    await w.connectPartner();
    expect(w.hub.account(PARTNER_BG.entityId).provider).toBe('stand-in');
    expect(await w.hub.accountView(PARTNER_BG.entityId, T0 + 30_000)).toMatchObject({ collect: { connected: true, canReceivePayments: false, organizationName: 'Sofia Partner OOD', connectedBy: 'Elena Petrova' } });
  });

  it('the page the payer comes back to says how it went — in Bulgarian and English — and nothing else', async () => {
    const w = aWorld();
    await w.connectPartner();
    const asked = await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-7', amount: 9.5, description: 'Parcel BG-7' }, T0 + 60_000);
    const waiting = await w.hub.paidPage(asked.paymentId, T0 + 61_000);
    expect(waiting).toContain('Още не е потвърдено');
    expect(waiting).toContain('Not confirmed yet');
    w.setStatus('paid');
    const paid = await w.hub.paidPage(asked.paymentId, T0 + 61_000 + QR_SETTLE_AGAIN_MS);
    expect(paid).toContain('Платено.');
    expect(paid).toContain('Paid. The counter sees it in a moment.');
    expect(paid).toContain('BG-7');
    expect(paid).not.toContain('9.5');
    expect(await w.hub.paidPage('hp_nobody', T0)).toContain('This link is not known.');
  });
});

/*
 * 2026-11-26 — THE ACCOUNT MUST BE THE PARTNER'S OWN COMPANY'S (the owner: "Go ahead"): any member could connect a Mollie account, a
 * personal one too. Mollie says the account's registration number; the partner's record says its own. Another company's: never used.
 * And Mollie tells us when a counter's payment changes (its notice), so the hub asks Mollie far less often.
 */
describe('the counters’ Mollie account is the partner’s own company’s', () => {
  it('compared by registration number, or the VAT number, letters and digits only — another registration is not the partner', () => {
    expect(sameCompany('BG 204 567 890', { registrationNumber: '204567890' })).toBe('yes');
    expect(sameCompany('204567890', { vatNumber: 'BG204567890' })).toBe('yes');
    expect(sameCompany('204567890', { registrationNumber: '999999999', vatNumber: 'BG204567890' })).toBe('yes');
    expect(sameCompany('204567890', { registrationNumber: '999999999' })).toBe('no');
    // A VAT number that is another number than the registration (the Netherlands'): not a reason to refuse.
    expect(sameCompany('12345678', { vatNumber: 'NL123456789B01' })).toBe('unknown');
    expect(sameCompany(undefined, { registrationNumber: '204567890' })).toBe('unknown');
    expect(sameCompany('204567890', undefined)).toBe('unknown');
  });

  it('the partner’s own: used; another company’s: never used, said to staff as such; none on record: used, staff to check', async () => {
    const own = aWorld({ orgReg: '204567890', partnerReg: 'BG204567890' });
    await own.connectPartner();
    expect(own.hub.account(PARTNER_BG.entityId).provider).toBe('mollie');
    expect(own.hub.collectCheck(PARTNER_BG.entityId)).toMatchObject({ organizationName: 'Sofia Partner OOD', registrationNumber: '204567890', connectedBy: 'Elena Petrova', same: 'yes' });

    const other = aWorld({ orgReg: '999999999', partnerReg: '204567890' });
    await other.connectPartner();
    expect(other.hub.account(PARTNER_BG.entityId).provider).toBe('stand-in');
    expect(other.hub.collectsBy(PARTNER_BG.entityId)).toBe('phone');
    expect(await other.hub.accountView(PARTNER_BG.entityId, T0 + 30_000)).toMatchObject({ provider: 'stand-in', collect: { connected: true, registrationNumber: '999999999', sameCompany: 'no', expectedRegistration: '204567890' } });

    const unknown = aWorld({ orgReg: '204567890' });
    await unknown.connectPartner();
    expect(unknown.hub.account(PARTNER_BG.entityId).provider).toBe('mollie');
    expect(unknown.hub.collectCheck(PARTNER_BG.entityId)?.same).toBe('unknown');
    expect(aWorld().hub.collectCheck(PARTNER_BG.entityId)).toBeUndefined();
  });
});

describe('Mollie tells us when a counter’s payment changes', () => {
  it('its notice settles the payment at once, asked of Mollie on the partner’s token; an id not ours is left alone', async () => {
    const w = aWorld();
    await w.connectPartner();
    const asked = await w.hub.collect(PARTNER_BG.entityId, { reference: 'BG-8', amount: 9.5, description: 'Parcel BG-8' }, T0 + 60_000);
    await w.hub.settle(asked.paymentId, T0 + 61_000);
    w.setStatus('paid');
    // Read again by the counter a second later: what was last heard, Mollie not asked again.
    const gets = () => w.mollie.calls.filter((c) => c.method === 'GET' && c.url.includes('/v2/payments/tr_1')).length;
    const before = gets();
    expect((await w.hub.settle(asked.paymentId, T0 + 62_000)).state).toBe('asked');
    expect(gets()).toBe(before);
    // Mollie's notice: asked at once, whatever the time.
    expect(await w.hub.onMollieNotice('tr_1', T0 + 62_500)).toBe(true);
    expect(w.hub.get(asked.paymentId)).toMatchObject({ state: 'paid' });
    expect(gets()).toBe(before + 1);
    expect(await w.hub.onMollieNotice('tr_nobody', T0 + 63_000)).toBe(false);
  });

  it('the sweep asks Mollie about an open page every half minute, not every five seconds; a phone prompt as before', () => {
    expect(askEveryMs({ kind: 'in', askedAt: new Date(T0).toISOString(), byQr: true, providerRef: 'tr_1' }, T0 + 1)).toBe(QR_ASKED_EVERY_MS);
    expect(askEveryMs({ kind: 'in', askedAt: new Date(T0).toISOString(), byQr: true }, T0 + 1)).toBe(0);
    expect(askEveryMs({ kind: 'in', askedAt: new Date(T0).toISOString() }, T0 + 1)).toBe(0);
  });
});
