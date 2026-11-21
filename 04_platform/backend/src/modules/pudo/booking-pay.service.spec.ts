import type { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { MollieConnectService, mollieConfigFromEnv } from '../../foundation/mollie/mollie-connect.service';
import type { MollieConfig } from '../../foundation/mollie/mollie.types';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import type { BooksService } from '../../foundation/books/books.service';
import type { AgentService } from './agent.service';
import type { ParcelService } from './parcel.service';
import type { Parcel } from './pudo.types';
import { BookingPayService } from './booking-pay.service';
import { MollieController } from './mollie.controller';

/*
 * 2026-11-21 — A SEND-APP BOOKING PAID ONLINE WHEN BOOKED (the payments plan, 5a/5b; P5-a "netherlands first", P5-b "it stays
 * optional"). By iDEAL through Mollie into our own company's account; Mollie's word checked by fetching the payment again; the
 * money held as the sender's until the shop takes the parcel in, then our income with its tax.
 */
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
let paymentStatus: { status: string; paidAt?: string; value?: string; currency?: string } = { status: 'open' };
let refundsDown = false;
const CHECKOUT = 'https://www.mollie.com/checkout/select-method/tr_b1';
function aMollie() {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const c: Call = { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined };
    calls.push(c);
    const path = new URL(url).pathname;
    if (c.method === 'POST' && path === '/v2/payments') return json(201, { id: 'tr_b1', status: 'open', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), amount: { currency: 'EUR', value: '7.95' }, _links: { checkout: { href: CHECKOUT } } });
    if (c.method === 'POST' && path === '/v2/payments/tr_b1/refunds') return refundsDown ? json(503, { status: 503, title: 'Service Unavailable', detail: 'Down for maintenance' }) : json(201, { resource: 'refund', id: 're_1', status: 'queued', amount: { currency: 'EUR', value: '7.95' } });
    if (c.method === 'GET' && path === '/v2/payments/tr_b1') return json(200, { id: 'tr_b1', status: paymentStatus.status, ...(paymentStatus.paidAt ? { paidAt: paymentStatus.paidAt } : {}), amount: { currency: paymentStatus.currency ?? 'EUR', value: paymentStatus.value ?? '7.95' } });
    return json(404, { status: 404, title: 'Not Found' });
  };
  return { fetchImpl, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const crypt = { encrypt: (s: string) => s, decrypt: (s: string) => s } as unknown as FieldEncryption;
const OURS: MollieConfig = { testmode: true, publicBase: 'https://seebuyget.test', host: 'https://mollie.stand-in', ownKey: 'test_ours' };

function aWorld(opts: { cfg?: MollieConfig; country?: string; currency?: string; parcel?: Partial<Parcel>; refuseMark?: boolean } = {}) {
  paymentStatus = { status: 'open' };
  refundsDown = false;
  const mollie = aMollie();
  const connect = new MollieConnectService(crypt, opts.cfg ?? OURS, mollie.fetchImpl);
  const parcel = {
    parcelId: 'PUD-NL1',
    direction: 'outbound',
    senderPhoneHash: 'hash-sender',
    status: 'Created',
    paidStatus: 'unpaid',
    originAgentDid: 'did:glos:shop-utrecht',
    collectingEntityId: 'ent_nl',
    shipmentCost: 7.95,
    shipmentTax: 1.38,
    shipmentProvision: 0.1,
    currency: opts.currency ?? 'EUR',
    ...opts.parcel,
  } as unknown as Parcel;
  const marked: unknown[] = [];
  let takenIn: ((p: Parcel) => void) | undefined;
  let calledOff: ((p: Parcel, why: string) => void) | undefined;
  const parcels = {
    get: () => parcel,
    markPaidOnline: (id: string, paid: Parcel['paidOnline']) => {
      if (opts.refuseMark) throw new Error('Parcel is At_PUDO: a booking is paid online before it is handed in');
      marked.push([id, paid]);
      Object.assign(parcel, { paidOnline: paid, paidStatus: 'ParcelPaid' });
      return parcel;
    },
    onCalledOffPaidOnline: (fn: (p: Parcel, why: string) => void) => {
      calledOff = fn;
    },
    onTakenInPaidOnline: (fn: (p: Parcel) => void) => {
      takenIn = fn;
    },
  } as unknown as ParcelService;
  const agents = { find: () => ({ country: opts.country ?? 'NL' }) } as unknown as AgentService;
  const posted: Array<{ kind: string; lines: Array<{ code: string; amount: number; counterparty?: string }> }> = [];
  const books = { post: (e: (typeof posted)[number]) => (posted.push(e), e) } as unknown as BooksService;
  const pay = new BookingPayService(connect, parcels, agents, books);
  pay.onModuleInit();
  return { pay, parcel, marked, posted, calls: mollie.calls, takenIn: () => takenIn!(parcel), calledOff: (why: string) => calledOff!(parcel, why) };
}

describe('a booking paid online when booked (the payments plan, 5a/5b)', () => {
  it('offered where Mollie runs, in euros, with our own account set up — and said why not elsewhere', () => {
    expect(aWorld().pay.view('PUD-NL1')).toEqual({ offered: true, amount: 7.95, currency: 'EUR', testmode: true });
    expect(aWorld({ country: 'KE' }).pay.view('PUD-NL1')).toMatchObject({ offered: false, why: 'not_here' });
    expect(aWorld({ currency: 'KES' }).pay.view('PUD-NL1')).toMatchObject({ offered: false, why: 'not_eur' });
    expect(aWorld({ cfg: { testmode: true } }).pay.view('PUD-NL1')).toMatchObject({ offered: false, why: 'no_account' });
    expect(aWorld({ parcel: { vendorId: 'ven_1' } as Partial<Parcel> }).pay.view('PUD-NL1')).toMatchObject({ offered: false, why: 'not_booking' });
    expect(aWorld({ parcel: { status: 'At_PUDO', paidStatus: 'ParcelPaid' } as Partial<Parcel> }).pay.view('PUD-NL1')).toMatchObject({ offered: false, why: 'handed_in' });
  });

  it('asks Mollie for iDEAL into our own account, comes back to the booking, and gives the open payment again', async () => {
    const w = aWorld();
    const v = await w.pay.ask('PUD-NL1', 'did:glos:person-anouk');
    expect(v).toMatchObject({ offered: true, status: 'open', checkoutUrl: CHECKOUT });
    const made = w.calls.find((c) => c.method === 'POST')!;
    expect(made.headers.authorization ?? made.headers.Authorization).toBe('Bearer test_ours');
    expect(JSON.parse(made.body!)).toMatchObject({ amount: { currency: 'EUR', value: '7.95' }, method: 'ideal', metadata: { kind: 'booking', parcelId: 'PUD-NL1' }, webhookUrl: 'https://seebuyget.test/v1/sbg/mollie/webhook' });
    expect(JSON.parse(made.body!).redirectUrl).toMatch(/\/send\/\?parcel=PUD-NL1$/);
    await w.pay.ask('PUD-NL1', 'did:glos:person-anouk');
    expect(w.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('paid: checked with Mollie, the booking marked paid with its label, the money held as the sender’s — once', async () => {
    const w = aWorld();
    await w.pay.ask('PUD-NL1', 'did:glos:person-anouk');
    // Somebody else's payment named in a notice is left alone.
    expect(await w.pay.onWebhook('tr_other')).toBe(false);
    paymentStatus = { status: 'paid', paidAt: '2026-11-21T12:00:00.000Z' };
    expect(await w.pay.onWebhook('tr_b1')).toBe(true);
    expect(w.marked).toEqual([['PUD-NL1', { paymentId: 'tr_b1', amount: 7.95, currency: 'EUR', at: '2026-11-21T12:00:00.000Z', test: true, method: 'ideal' }]]);
    expect(w.posted).toEqual([expect.objectContaining({ kind: 'send-prepayment', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 7.95 }, { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: 'did:glos:person-anouk', amount: -7.95 }] })]);
    // A second notice changes nothing.
    await w.pay.onWebhook('tr_b1');
    expect(w.marked).toHaveLength(1);
    expect(w.posted).toHaveLength(1);
    expect(w.pay.view('PUD-NL1')).toMatchObject({ offered: false, why: 'paid', status: 'paid' });
  });

  it('paid for less, or in other money: never marked paid', async () => {
    const w = aWorld();
    await w.pay.ask('PUD-NL1', 'did:glos:person-anouk');
    paymentStatus = { status: 'paid', value: '1.00' };
    await w.pay.onWebhook('tr_b1');
    paymentStatus = { status: 'paid', currency: 'USD' };
    await w.pay.onWebhook('tr_b1');
    expect(w.marked).toEqual([]);
    expect(w.posted).toEqual([]);
  });

  it('handed in at the shop: what was held becomes our income, with its tax and the claims provision', async () => {
    const w = aWorld();
    await w.pay.ask('PUD-NL1', 'did:glos:person-anouk');
    paymentStatus = { status: 'paid' };
    await w.pay.onWebhook('tr_b1');
    w.takenIn();
    expect(w.posted[1]).toEqual(expect.objectContaining({ kind: 'shipping', ref: 'PUD-NL1', lines: [
      { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: 'did:glos:person-anouk', amount: 7.95 },
      { code: ACCOUNT_CODES.REVENUE, amount: -6.47 },
      { code: ACCOUNT_CODES.PAYABLE_TAX, amount: -1.38 },
      { code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: -0.1 },
    ] }));
  });

  it('Mollie’s one notice reaches a booking’s payment — and a load paid direct where it is not a booking’s', async () => {
    const seen: string[] = [];
    const direct = { onWebhook: async (id: string) => void seen.push(`direct:${id}`) };
    const bookings = { onWebhook: async (id: string) => (seen.push(`booking:${id}`), id === 'tr_b') };
    const controller = new MollieController({} as never, {} as never, {} as never, direct as never, {} as never, bookings as never);
    await controller.webhook({ id: 'tr_b' });
    await controller.webhook({ id: 'tr_l' });
    expect(seen).toEqual(['booking:tr_b', 'booking:tr_l', 'direct:tr_l']);
  });

  /* 5c — called off or voided before it left the shop: given back in full to the account that paid. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const paidWorld = async (opts: Parameters<typeof aWorld>[0] = {}) => {
    const w = aWorld(opts);
    await w.pay.ask('PUD-NL1', 'did:glos:person-anouk');
    paymentStatus = { status: 'paid' };
    await w.pay.onWebhook('tr_b1');
    return w;
  };
  const refundCalls = (w: ReturnType<typeof aWorld>) => w.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/refunds'));

  it('called off before it was handed in: given back through Mollie, once; the money held as the sender’s leaves our account', async () => {
    const w = await paidWorld();
    w.calledOff('called off before it was handed in');
    await settle();
    const asked = refundCalls(w);
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0].body!)).toMatchObject({ amount: { currency: 'EUR', value: '7.95' }, description: 'SeeBuyGet PUD-NL1: called off before it was handed in' });
    expect(asked[0].headers['idempotency-key'] ?? asked[0].headers['Idempotency-Key']).toBe('refund-tr_b1');
    expect(w.posted.map((e) => e.kind)).toEqual(['send-prepayment', 'send-refund']);
    expect(w.posted[1].lines).toEqual([{ code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: 'did:glos:person-anouk', amount: 7.95 }, { code: ACCOUNT_CODES.CASH_CUSTODY, amount: -7.95 }]);
    expect(w.pay.view('PUD-NL1').refund).toBe('asked');
    // Asked again: nothing more.
    await w.pay.refundFor('PUD-NL1', 'again');
    expect(refundCalls(w)).toHaveLength(1);
  });

  it('voided after it was handed in: what was our income taken back first, then the money given back', async () => {
    const w = await paidWorld();
    w.takenIn();
    w.calledOff('voided at the counter');
    await settle();
    expect(w.posted.map((e) => e.kind)).toEqual(['send-prepayment', 'shipping', 'shipping-reversal', 'send-refund']);
    expect(w.posted[2].lines).toEqual([
      { code: ACCOUNT_CODES.REVENUE, amount: 6.47 },
      { code: ACCOUNT_CODES.PAYABLE_TAX, amount: 1.38 },
      { code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: 0.1 },
      { code: ACCOUNT_CODES.DEPOSIT_PERSON, counterparty: 'did:glos:person-anouk', amount: -7.95 },
    ]);
  });

  it('Mollie not answering: it waits, nothing booked, and is asked again until Mollie takes it', async () => {
    const w = await paidWorld();
    refundsDown = true;
    w.calledOff('called off before it was handed in');
    await settle();
    expect(w.pay.view('PUD-NL1').refund).toBe('waiting');
    expect(w.posted.map((e) => e.kind)).toEqual(['send-prepayment']);
    expect(await w.pay.refundsAgain()).toBe(0);
    refundsDown = false;
    expect(await w.pay.refundsAgain()).toBe(1);
    expect(w.pay.view('PUD-NL1').refund).toBe('asked');
    expect(w.posted.map((e) => e.kind)).toEqual(['send-prepayment', 'send-refund']);
    expect(await w.pay.refundsAgain()).toBe(0);
  });

  it('paid after it was already paid at the shop: held, owed back, and given back at once', async () => {
    const w = await paidWorld({ refuseMark: true });
    await settle();
    expect(w.marked).toEqual([]);
    expect(refundCalls(w)).toHaveLength(1);
    expect(w.posted.map((e) => e.kind)).toEqual(['send-prepayment', 'send-refund']);
  });

  it('our own key: test_ or live_, a live one never in a sandbox; the test key stands in where none is set', () => {
    expect(mollieConfigFromEnv({ GLOS_MOLLIE_API_KEY: 'test_abc' } as NodeJS.ProcessEnv).ownKey).toBe('test_abc');
    expect(mollieConfigFromEnv({ GLOS_MOLLIE_API_KEY: 'sk_nonsense' } as NodeJS.ProcessEnv).ownKey).toBeUndefined();
    const standIn = new MollieConnectService(crypt, { testmode: true, testKey: 'test_standin' }, aMollie().fetchImpl);
    expect(standIn.ownToken()).toEqual({ bearer: 'test_standin', testmode: true });
    expect(new MollieConnectService(crypt, { testmode: true }, aMollie().fetchImpl).ownToken()).toBeNull();
  });
});
