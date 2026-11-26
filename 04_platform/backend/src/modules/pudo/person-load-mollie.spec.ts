import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { GlosError } from '../../foundation/http/glos-error';
import { MollieError } from '../../foundation/mollie/mollie-client';
import { mollieConfigFromEnv } from '../../foundation/mollie/mollie-connect.service';
import type { PrepaidShipper } from './dispatch.types';
import { MOLLIE_AGAIN_AFTER_MS, PersonLoadPayService, ROUTE_WITHIN_MS } from './person-load-pay.service';

/*
 * 2026-11-25 — ROUTE PLAN PART 9B, STEP 2: a load a person paid first through Mollie, on our own account, pays its carrier there.
 * Held to here: where the carrier's pay goes is decided when the person pays (Mollie routes only to an account connected before the
 * payment), and only where routing is on, the money euros, and the carrier's own account connected through the Connect app and
 * able to take payments; once the pay is owed, it is settled in our books in that same turn — before Mollie is asked — and routed
 * to the carrier's account, never twice; refused, our books are undone and the carrier is paid the country's way; past 90 days,
 * not asked; and money owed back goes to the account the person paid from, as a Mollie refund — never twice, undone if refused.
 */
const T0 = Date.parse('2026-11-25T10:00:00Z');
type Line = { code: string; counterparty?: string; amount: number };
type Post = { entityId: string; kind: string; ref: string; currency: string; lines: Line[] };

function aWorld(opts: { routing?: boolean; currency?: string; connection?: Record<string, unknown> | null; payee?: { payeeDid: string; entityId?: string }; provider?: string } = {}) {
  const posts: Post[] = [];
  const told: Array<{ to: string; title: string }> = [];
  let prepaid: PrepaidShipper | undefined;
  const freight = { freightId: 'frt_1', code: 'FRT-1', postedByDid: 'did:person:anna', escrow: true, sellerEntityId: 'sbg-nl', status: 'available' };
  const dispatch = {
    requireFreightPublic: () => freight,
    requireProposalPublic: () => ({ proposalId: 'prp_1', freightId: 'frt_1', status: 'open', price: 100, driverDid: 'did:drv:piet' }),
    chargeFor: () => 121,
    holdForPayment: () => undefined,
    releasePayHold: () => undefined,
    acceptProposal: () => undefined,
    issueDeliveryCode: () => undefined,
    registerPrepaid: (p: PrepaidShipper) => (prepaid = p),
  };
  const fundings = new Map<string, Record<string, unknown>>();
  const funding = {
    needsPhone: () => false,
    providerFor: (c: string) => opts.provider ?? (c === 'EUR' ? 'mollie' : 'mpesa'),
    open: async () => {
      fundings.set('fnd_1', { fundingId: 'fnd_1', entityId: 'sbg-nl', currency: opts.currency ?? 'EUR', provider: 'mollie', railRef: 'tr_abc123' });
      return { fundingId: 'fnd_1', reference: 'REF2345', provider: 'mollie', link: 'https://www.mollie.com/checkout/x', instructions: 'Pay on the iDEAL page that opens.' };
    },
    get: (id: string) => fundings.get(id) as never,
  };
  const books = { post: (e: Post) => (posts.push(e), { entryId: `e${posts.length}` }) };
  const entities = { get: () => ({ entityId: 'sbg-nl', currency: opts.currency ?? 'EUR' }) };
  const payouts = { registerDestinations: () => undefined };
  const notifications = { notify: async (to: string, n: { title: string }) => void told.push({ to, title: n.title }) };
  const calls: Array<{ what: string; paymentId: string; body?: Record<string, unknown>; key?: string }> = [];
  const answers: { route: Array<Record<string, unknown> | Error>; refund: Array<Record<string, unknown> | Error>; routes: Array<Record<string, unknown>>; refunds: Array<Record<string, unknown>> } = { route: [], refund: [], routes: [], refunds: [] };
  const next = (list: Array<Record<string, unknown> | Error>, fallback: Record<string, unknown>) => {
    const a = list.length > 1 ? list.shift() : (list[0] ?? fallback);
    if (a instanceof Error) throw a;
    return a as Record<string, unknown>;
  };
  const api = {
    listRoutes: async (_b: string, paymentId: string) => (calls.push({ what: 'listRoutes', paymentId }), answers.routes),
    createRoute: async (_b: string, paymentId: string, body: Record<string, unknown>, key: string) => (calls.push({ what: 'createRoute', paymentId, body, key }), next(answers.route, { resource: 'route', id: 'crt_1' })),
    listRefunds: async (_b: string, paymentId: string) => (calls.push({ what: 'listRefunds', paymentId }), answers.refunds),
    createRefund: async (_b: string, paymentId: string, body: Record<string, unknown>, key: string) => (calls.push({ what: 'createRefund', paymentId, body, key }), next(answers.refund, { resource: 'refund', id: 're_1', status: 'pending' })),
  };
  const connection = opts.connection === null ? undefined : { payeeId: 'did:drv:piet', via: 'oauth', organization: { id: 'org_piet' }, canReceivePayments: true, testmode: false, connectedAt: '2026-11-01T00:00:00Z', connectedBy: 'Piet', ...(opts.connection ?? {}) };
  const mollie = { cfg: { routing: opts.routing ?? true, testmode: false }, connection: (id: string) => (id === 'did:drv:piet' ? connection : undefined), ownToken: () => ({ bearer: 'live_ours', testmode: false }), api: () => api };
  const drivers = { payeeOrNone: () => opts.payee ?? { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' } };
  const svc = new PersonLoadPayService(dispatch as never, funding as never, books as never, entities as never, payouts as never, notifications as never, undefined, mollie as never, drivers as never);
  svc.onModuleInit();
  /** The person pays, and the rail says it is paid. */
  const payAndConfirm = async (now = T0) => {
    await svc.pay('did:person:anna', 'frt_1', { proposalId: 'prp_1' }, now);
    svc.paid('did:person:anna', { purpose: 'load' as never, gross: 121, fee: 0, reference: 'REF2345', fundingId: 'fnd_1' }, now);
  };
  const record = () => [...(svc as unknown as { payments: Map<string, Record<string, unknown>> }).payments.values()].find((p) => p.freightId === 'frt_1') as Record<string, any>;
  return { svc, posts, told, calls, answers, payAndConfirm, record, prepaid: () => prepaid as PrepaidShipper, freight };
}

const sum = (posts: Post[], kind: string, code: string) => posts.filter((p) => p.kind === kind).flatMap((p) => p.lines).filter((l) => l.code === code).reduce((s, l) => s + l.amount, 0);

describe('a load paid first through Mollie pays its carrier there (route plan part 9b, step 2)', () => {
  it('where the carrier’s pay goes is decided when the person pays — only to an account connected through the Connect app, able to take payments', async () => {
    const yes = aWorld();
    await yes.payAndConfirm();
    expect(yes.record().routeTo).toEqual({ payeeId: 'did:drv:piet', organizationId: 'org_piet' });
    for (const no of [aWorld({ routing: false }), aWorld({ currency: 'KES' }), aWorld({ connection: null }), aWorld({ connection: { via: 'test_key' } }), aWorld({ connection: { lostAt: '2026-11-20T00:00:00Z' } }), aWorld({ connection: { canReceivePayments: false } }), aWorld({ payee: { payeeDid: 'did:drv:piet', entityId: 'sbg-other' } })]) {
      await no.payAndConfirm();
      expect(no.record().routeTo).toBeUndefined();
    }
  });

  it('once the pay is owed: settled in our books in that same turn, then routed to the carrier’s account — and the carrier told', async () => {
    const w = aWorld();
    await w.payAndConfirm();
    w.prepaid().roadPaid?.(w.freight as never, { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' }, 100);
    // Before Mollie has answered: the payable is already settled, so no payout run can raise it as well.
    expect(sum(w.posts, 'driver-payout-routed', ACCOUNT_CODES.PAYABLE_PROVIDER)).toBe(100);
    expect(sum(w.posts, 'driver-payout-routed', ACCOUNT_CODES.CASH_CUSTODY)).toBe(-100);
    expect(w.posts.find((p) => p.kind === 'driver-payout-routed')?.lines.find((l) => l.code === ACCOUNT_CODES.PAYABLE_PROVIDER)?.counterparty).toBe('did:drv:piet');
    await new Promise((r) => setImmediate(r));
    const made = w.calls.find((c) => c.what === 'createRoute');
    expect(made).toEqual({ what: 'createRoute', paymentId: 'tr_abc123', key: expect.stringMatching(/^route-lpay_/), body: { amount: { currency: 'EUR', value: '100.00' }, description: 'SeeBuyGet FRT-1', destination: { type: 'organization', organizationId: 'org_piet' } } });
    expect(w.record().route).toMatchObject({ state: 'routed', amount: 100, routeId: 'crt_1', tries: 1 });
    expect(w.told.map((t) => [t.to, t.title])).toContainEqual(['did:drv:piet', 'Paid to your Mollie account: FRT-1']);
    // Owed again later (it cannot be): never a second route.
    w.prepaid().roadPaid?.(w.freight as never, { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' }, 100);
    await new Promise((r) => setImmediate(r));
    expect(w.calls.filter((c) => c.what === 'createRoute')).toHaveLength(1);
    expect(sum(w.posts, 'driver-payout-routed', ACCOUNT_CODES.PAYABLE_PROVIDER)).toBe(100);
  });

  it('a route already there is not made again; one Mollie did not answer is asked again five minutes later, under the same key', async () => {
    const there = aWorld();
    there.answers.routes.push({ resource: 'route', id: 'crt_old', destination: { type: 'organization', organizationId: 'org_piet' }, amount: { value: '100.00', currency: 'EUR' } });
    await there.payAndConfirm();
    there.prepaid().roadPaid?.(there.freight as never, { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' }, 100);
    await new Promise((r) => setImmediate(r));
    expect(there.calls.some((c) => c.what === 'createRoute')).toBe(false);
    expect(there.record().route).toMatchObject({ state: 'routed', routeId: 'crt_old' });

    const silent = aWorld();
    silent.answers.route.push(new GlosError('PROVIDER_UNAVAILABLE', 'Mollie did not answer'), { resource: 'route', id: 'crt_2' });
    await silent.payAndConfirm();
    silent.svc.roadPaid(silent.freight as never, { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' }, 100, T0);
    await new Promise((r) => setImmediate(r));
    expect(silent.record().route).toMatchObject({ state: 'asked', tries: 1 });
    await silent.svc.mollieAgain(T0 + MOLLIE_AGAIN_AFTER_MS - 1);
    expect(silent.calls.filter((c) => c.what === 'createRoute')).toHaveLength(1);
    await silent.svc.mollieAgain(T0 + MOLLIE_AGAIN_AFTER_MS);
    const keys = silent.calls.filter((c) => c.what === 'createRoute').map((c) => c.key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(silent.record().route).toMatchObject({ state: 'routed', routeId: 'crt_2', tries: 2 });
    // Never undone while unanswered: the books keep it settled.
    expect(silent.posts.some((p) => p.kind === 'driver-payout-routed-undone')).toBe(false);
  });

  it('Mollie refuses the route: our books undone, so the carrier is owed again and paid the country’s way', async () => {
    const w = aWorld();
    w.answers.route.push(new MollieError(404, 'Not Found', 'The destination organization has not finished its checks'));
    await w.payAndConfirm();
    w.prepaid().roadPaid?.(w.freight as never, { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' }, 100);
    await new Promise((r) => setImmediate(r));
    expect(w.record().route).toMatchObject({ state: 'failed', why: 'The destination organization has not finished its checks' });
    expect(sum(w.posts, 'driver-payout-routed-undone', ACCOUNT_CODES.PAYABLE_PROVIDER)).toBe(-100);
    expect(sum(w.posts, 'driver-payout-routed-undone', ACCOUNT_CODES.CASH_CUSTODY)).toBe(100);
    await w.svc.mollieAgain(T0 + 3_600_000);
    expect(w.calls.filter((c) => c.what === 'createRoute')).toHaveLength(1);
  });

  it('past Mollie’s 90 days, or owed to someone else than decided: not asked, the books untouched', async () => {
    const late = aWorld();
    await late.payAndConfirm(T0);
    late.svc.roadPaid(late.freight as never, { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' }, 100, T0 + ROUTE_WITHIN_MS + 1);
    expect(late.record().route).toMatchObject({ state: 'failed', why: 'too_late' });
    expect(late.posts.some((p) => p.kind === 'driver-payout-routed')).toBe(false);
    expect(late.calls).toEqual([]);
    const other = aWorld();
    await other.payAndConfirm();
    other.prepaid().roadPaid?.(other.freight as never, { payeeDid: 'did:fleet:other', entityId: 'sbg-nl' }, 100);
    expect(other.record().route).toBeUndefined();
    expect(other.posts.some((p) => p.kind === 'driver-payout-routed')).toBe(false);
  });

  it('money owed back goes to the account paid from, as a Mollie refund — settled first, marked, never twice', async () => {
    const w = aWorld();
    await w.payAndConfirm();
    w.prepaid().giveBack(w.freight as never, { gross: 0, tax: 0, provision: 0 }, 'the driver gave it back');
    expect(sum(w.posts, 'load-refund', ACCOUNT_CODES.PAYABLE_PERSON)).toBe(121);
    expect(sum(w.posts, 'load-refund', ACCOUNT_CODES.CASH_CUSTODY)).toBe(-121);
    await new Promise((r) => setImmediate(r));
    const made = w.calls.find((c) => c.what === 'createRefund');
    expect(made?.body).toMatchObject({ amount: { currency: 'EUR', value: '121.00' }, metadata: { mark: expect.stringMatching(/^lpay_.*:1$/) } });
    expect(made?.key).toBe(`load-refund-${(made?.body?.metadata as { mark: string }).mark}`);
    expect(w.record().refunds).toEqual([expect.objectContaining({ n: 1, amount: 121, state: 'sent', refundId: 're_1' })]);
    expect(w.svc.viewFor('did:person:anna', 'frt_1')).toMatchObject({ owedBack: 121, backTo: 'account' });
    expect(w.told.at(-1)?.title).toBe('FRT-1: your money goes back to you');
  });

  it('a refund already there is not made again; one Mollie refuses is undone, given back by hand; none on a payment routed to the carrier', async () => {
    const there = aWorld();
    await there.payAndConfirm();
    const mark = `${there.record().payId}:1`;
    there.answers.refunds.push({ resource: 'refund', id: 're_old', metadata: { mark } });
    there.prepaid().giveBack(there.freight as never, { gross: 0, tax: 0, provision: 0 }, 'withdrawn');
    await new Promise((r) => setImmediate(r));
    expect(there.calls.some((c) => c.what === 'createRefund')).toBe(false);
    expect(there.record().refunds[0]).toMatchObject({ state: 'sent', refundId: 're_old' });

    const refused = aWorld();
    refused.answers.refund.push(new MollieError(422, 'Unprocessable Entity', 'The payment cannot be refunded'));
    await refused.payAndConfirm();
    refused.prepaid().giveBack(refused.freight as never, { gross: 0, tax: 0, provision: 0 }, 'withdrawn');
    await new Promise((r) => setImmediate(r));
    expect(refused.record().refunds[0]).toMatchObject({ state: 'failed', why: 'The payment cannot be refunded' });
    expect(sum(refused.posts, 'load-refund-undone', ACCOUNT_CODES.PAYABLE_PERSON)).toBe(-121);

    const routed = aWorld();
    await routed.payAndConfirm();
    routed.prepaid().roadPaid?.(routed.freight as never, { payeeDid: 'did:drv:piet', entityId: 'sbg-nl' }, 100);
    await new Promise((r) => setImmediate(r));
    routed.prepaid().refundCarriage?.(routed.freight as never, { gross: 121, tax: 21, provision: 0 }, 'a claim upheld');
    await new Promise((r) => setImmediate(r));
    // Owed back, by hand: part of the payment is the carrier's now.
    expect(routed.record().owedBack).toBe(121);
    expect(routed.posts.some((p) => p.kind === 'load-refund')).toBe(false);
    expect(routed.calls.some((c) => c.what === 'createRefund')).toBe(false);
  });
});

describe('routing switched on by the owner, once Mollie has enabled it', () => {
  it('reads GLOS_MOLLIE_ROUTING from the server’s settings; off unless said', () => {
    expect(mollieConfigFromEnv({ GLOS_MOLLIE_ROUTING: 'on' }).routing).toBe(true);
    expect(mollieConfigFromEnv({ GLOS_MOLLIE_ROUTING: ' TRUE ' }).routing).toBe(true);
    expect(mollieConfigFromEnv({}).routing).toBeUndefined();
    expect(mollieConfigFromEnv({ GLOS_MOLLIE_ROUTING: 'off' }).routing).toBeUndefined();
  });
});

/*
 * 2026-11-26 — BEFORE A PRICE IS NAMED (the weakness after part 9b, fixed as recommended): Mollie routes only to an account connected
 * before the sender pays, so a courier who connects afterwards is paid that load the country's way. The Driver app's board asks first:
 * `connect` for a courier that has not connected its own account, `office` for a fleet driver whose fleet has not; nothing where the
 * pay would be routed, or never could be.
 */
describe('the board says to connect Mollie before naming a price on a load paid upfront in euros', () => {
  const open = { freightId: 'frt_9', code: 'FRT-9', escrow: true, sellerEntityId: 'sbg-nl', postedCurrency: 'EUR', status: 'available' } as never;
  const ask = (w: ReturnType<typeof aWorld>, f = open) => w.prepaid().mollieFirst?.(f, 'did:drv:piet');

  it('connect for a courier, office for a fleet driver — and nothing once the account can be paid into', () => {
    expect(ask(aWorld({ connection: null }))).toBe('connect');
    expect(ask(aWorld({ connection: { via: 'test_key' } }))).toBe('connect');
    expect(ask(aWorld({ connection: { lostAt: '2026-11-20T00:00:00Z' } }))).toBe('connect');
    expect(ask(aWorld({ connection: { canReceivePayments: false } }))).toBe('connect');
    expect(ask(aWorld({ connection: null, payee: { payeeDid: 'did:fleet:noord', entityId: 'sbg-nl' } }))).toBe('office');
    expect(ask(aWorld())).toBeUndefined();
  });

  it('nothing where it never could be routed: routing off, not euros, not through Mollie, another company, or not paid first', () => {
    expect(ask(aWorld({ connection: null, routing: false }))).toBeUndefined();
    expect(ask(aWorld({ connection: null, currency: 'KES' }))).toBeUndefined();
    expect(ask(aWorld({ connection: null, provider: 'standin' }))).toBeUndefined();
    expect(ask(aWorld({ connection: null, payee: { payeeDid: 'did:drv:piet', entityId: 'sbg-other' } }))).toBeUndefined();
    expect(ask(aWorld({ connection: null }), { ...(open as object), escrow: false } as never)).toBeUndefined();
  });
});
