import { REVOLUT_LIVE, REVOLUT_SANDBOX, RevolutProvider } from './revolut.provider';
import type { OpenedAccount } from './hub.types';

/*
 * 2026-11-25 — REVOLUT BUSINESS BEHIND THE PAYMENT HUB (route plan part 4; the owner: "Provider we connect"). Held to here, against
 * a stand-in for Revolut's API: its key goes as a Bearer token to the test address or the live one; each payee is added once by its
 * bank account, a person by a first and a last name; each payout carries our reference as Revolut's request_id; a transfer whose
 * answer was lost, or that Revolut already has, is asked about — never taken for failed, so never sent again under a new reference;
 * and it takes no payments in.
 */
const T0 = Date.parse('2026-11-25T10:00:00Z');
const TEST: OpenedAccount = { accountId: 'partner-bg', currency: 'EUR', keys: { apiKey: 'sand_key_0123456789abcdef' }, live: false };
const LIVE: OpenedAccount = { ...TEST, keys: { apiKey: 'live_key_0123456789abcdef' }, live: true };
const PAYEE = { account: 'BG80BNBG96611020345678', holder: 'Ivan Petrov Georgiev', person: true };

type Call = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };
type Answer = { status: number; body?: unknown } | Error;

function aRevolut(answers: Record<string, Answer | Answer[]>) {
  const calls: Call[] = [];
  const queue = new Map(Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const http = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
    const path = url.replace(REVOLUT_SANDBOX, '').replace(REVOLUT_LIVE, '').split('?')[0];
    const key = `${init.method} ${path.startsWith('/transaction/') ? '/transaction/:id' : path}`;
    const list = queue.get(key);
    const next = list && list.length > 1 ? list.shift() : list?.[0];
    if (!next) return { ok: false, status: 404, json: async () => ({ message: 'not found', code: 404 }) };
    if (next instanceof Error) throw next;
    return { ok: next.status < 300, status: next.status, json: async () => next.body };
  };
  return { revolut: new RevolutProvider(http as never), calls };
}

const ACCOUNTS = { status: 200, body: [{ id: 'acc-gbp', currency: 'GBP', state: 'active', balance: 5 }, { id: 'acc-eur', currency: 'EUR', state: 'active', balance: 1234.5 }] };
const COUNTERPARTY = { status: 200, body: { id: 'cp-1', name: 'Ivan Petrov Georgiev', state: 'created', accounts: [{ id: 'cpa-eur', currency: 'EUR' }] } };

describe('Revolut Business behind the payment hub', () => {
  it('pays a hand to its bank account: added once by its account, a person by first and last name, our reference as request_id', async () => {
    const { revolut, calls } = aRevolut({ 'GET /accounts': ACCOUNTS, 'POST /counterparty': COUNTERPARTY, 'POST /pay': { status: 200, body: { id: 'tx-1', state: 'completed', created_at: '2026-11-25T10:00:01Z' } } });
    const paid = await revolut.payout(TEST, { ourRef: 'hp_first_payout_reference', amount: 42.5, currency: 'EUR', payeeAccount: PAYEE, description: 'Sofia Partner OOD: 3 steps' }, T0);
    expect(paid).toEqual({ state: 'paid', providerRef: 'tx-1' });
    const added = calls.find((c) => c.url.endsWith('/counterparty'));
    expect(added?.body).toEqual({ individual_name: { first_name: 'Ivan', last_name: 'Petrov Georgiev' }, bank_country: 'BG', currency: 'EUR', iban: 'BG80BNBG96611020345678' });
    const pay = calls.find((c) => c.url.endsWith('/pay'));
    expect(pay?.body).toEqual({ request_id: 'hp_first_payout_reference', account_id: 'acc-eur', receiver: { counterparty_id: 'cp-1', account_id: 'cpa-eur' }, amount: 42.5, currency: 'EUR', reference: 'Sofia Partner OOD: 3 steps' });
    expect(pay?.url.startsWith(REVOLUT_SANDBOX)).toBe(true);
    expect(pay?.headers.authorization).toBe('Bearer sand_key_0123456789abcdef');
    // The same hand again: not added a second time.
    await revolut.payout(TEST, { ourRef: 'hp_second', amount: 10, currency: 'EUR', payeeAccount: PAYEE, description: 'x' }, T0);
    expect(calls.filter((c) => c.url.endsWith('/counterparty'))).toHaveLength(1);
  });

  it('a payee added under a test key is added again under the live one; one Revolut refused is added afresh next time', async () => {
    const { revolut, calls } = aRevolut({ 'GET /accounts': ACCOUNTS, 'POST /counterparty': COUNTERPARTY, 'POST /pay': [{ status: 200, body: { id: 'tx-a', state: 'completed' } }, { status: 200, body: { id: 'tx-b', state: 'completed' } }, { status: 404, body: { code: 3404, message: 'Counterparty not found' } }, { status: 200, body: { id: 'tx-c', state: 'completed' } }] });
    const send = (account: OpenedAccount, ourRef: string) => revolut.payout(account, { ourRef, amount: 1, currency: 'EUR', payeeAccount: { ...PAYEE, account: 'LT121000011101001000' }, description: 'x' });
    await send(TEST, 'hp_t');
    await send(LIVE, 'hp_l');
    expect(calls.filter((c) => c.url.endsWith('/counterparty')).map((c) => c.url.startsWith(REVOLUT_LIVE))).toEqual([false, true]);
    expect(await send(LIVE, 'hp_l2')).toEqual({ state: 'failed', why: 'Counterparty not found' });
    await send(LIVE, 'hp_l3');
    expect(calls.filter((c) => c.url.endsWith('/counterparty'))).toHaveLength(3);
  });

  it('a business goes by its name; a live key goes to the live address', async () => {
    const { revolut, calls } = aRevolut({ 'GET /accounts': ACCOUNTS, 'POST /counterparty': { ...COUNTERPARTY, body: { ...COUNTERPARTY.body, id: 'cp-shop' } }, 'POST /pay': { status: 200, body: { id: 'tx-2', state: 'pending' } } });
    const asked = await revolut.payout(LIVE, { ourRef: 'hp_shop', amount: 5, currency: 'EUR', payeeAccount: { account: 'NL91ABNA0417164300', holder: 'Magazin Vitosha EOOD' }, description: 'x' }, T0);
    expect(asked).toEqual({ state: 'asked', providerRef: 'tx-2' });
    expect(calls.find((c) => c.url.endsWith('/counterparty'))?.body).toMatchObject({ company_name: 'Magazin Vitosha EOOD', bank_country: 'NL' });
    expect(calls.every((c) => c.url.startsWith(REVOLUT_LIVE))).toBe(true);
    expect(calls[0].headers.authorization).toBe('Bearer live_key_0123456789abcdef');
  });

  it('a lost answer, Revolut’s own fault, or a request_id it has already: still asked — never failed, so never sent again', async () => {
    for (const answer of [new Error('socket hang up'), { status: 503, body: { message: 'unavailable' } }, { status: 400, body: { code: 3020, message: 'Duplicate request: hp_x' } }] as Answer[]) {
      const { revolut } = aRevolut({ 'GET /accounts': ACCOUNTS, 'POST /counterparty': COUNTERPARTY, 'POST /pay': answer });
      expect(await revolut.payout(TEST, { ourRef: 'hp_x', amount: 5, currency: 'EUR', payeeAccount: PAYEE, description: 'x' }, T0)).toEqual({ state: 'asked' });
    }
  });

  it('a refusal Revolut gives is failed, with its reason for staff; no euro account or no bank account fails before anything is sent', async () => {
    const refused = aRevolut({ 'GET /accounts': ACCOUNTS, 'POST /counterparty': COUNTERPARTY, 'POST /pay': { status: 422, body: { code: 3000, message: 'Insufficient balance' } } });
    expect(await refused.revolut.payout(TEST, { ourRef: 'hp_r', amount: 5000, currency: 'EUR', payeeAccount: PAYEE, description: 'x' }, T0)).toEqual({ state: 'failed', why: 'Insufficient balance' });
    const noEuro = aRevolut({ 'GET /accounts': { status: 200, body: [{ id: 'acc-gbp', currency: 'GBP', state: 'active', balance: 5 }] } });
    expect(await noEuro.revolut.payout(TEST, { ourRef: 'hp_n', amount: 5, currency: 'EUR', payeeAccount: PAYEE, description: 'x' }, T0)).toEqual({ state: 'failed', why: 'no_euro_account' });
    expect(noEuro.calls.some((c) => c.url.endsWith('/pay'))).toBe(false);
    expect(await noEuro.revolut.payout(TEST, { ourRef: 'hp_p', amount: 5, currency: 'EUR', payeePhone: '+359888123456', description: 'x' }, T0)).toEqual({ state: 'failed', why: 'no_bank_account' });
  });

  it('where a transfer stands: by Revolut’s id, or by our request_id among the last 13 days; unanswered stays asked', async () => {
    const byId = aRevolut({ 'GET /transaction/:id': [{ status: 200, body: { id: 'tx-1', state: 'pending' } }, { status: 200, body: { id: 'tx-1', state: 'completed' } }, { status: 200, body: { id: 'tx-1', state: 'declined' } }] });
    expect(await byId.revolut.status(TEST, { providerRef: 'tx-1', ourRef: 'hp_1' }, T0)).toEqual({ state: 'asked', providerRef: 'tx-1' });
    expect(await byId.revolut.status(TEST, { providerRef: 'tx-1', ourRef: 'hp_1' }, T0)).toEqual({ state: 'paid', providerRef: 'tx-1' });
    expect(await byId.revolut.status(TEST, { providerRef: 'tx-1', ourRef: 'hp_1' }, T0)).toEqual({ state: 'failed', providerRef: 'tx-1', why: 'declined' });
    const byOurs = aRevolut({ 'GET /transactions': { status: 200, body: [{ id: 'tx-9', request_id: 'hp_lost', state: 'completed' }] } });
    expect(await byOurs.revolut.status(TEST, { ourRef: 'hp_lost' }, T0)).toEqual({ state: 'paid', providerRef: 'tx-9' });
    const url = new URL(byOurs.calls[0].url);
    expect(url.searchParams.get('request_id')).toBe('hp_lost');
    expect(Date.parse(url.searchParams.get('from') as string)).toBe(T0 - 13 * 24 * 60 * 60_000);
    const silent = aRevolut({ 'GET /transactions': new Error('timeout') });
    expect(await silent.revolut.status(TEST, { ourRef: 'hp_lost' }, T0)).toEqual({ state: 'asked' });
    const none = aRevolut({ 'GET /transactions': { status: 200, body: [] } });
    expect(await none.revolut.status(TEST, { ourRef: 'hp_lost' }, T0)).toEqual({ state: 'asked' });
  });

  it('says what the euro account holds, and takes no payments in and gives none back', async () => {
    const { revolut } = aRevolut({ 'GET /accounts': ACCOUNTS });
    expect(await revolut.balance(TEST)).toEqual({ amount: 1234.5, currency: 'EUR' });
    expect(await revolut.collect(TEST, { ourRef: 'x', amount: 1, currency: 'EUR', payerPhone: '+359888123456', description: 'x' })).toEqual({ state: 'failed', why: 'not_offered' });
    expect(await revolut.refund(TEST, { ourRef: 'x', amount: 1, currency: 'EUR', description: 'x', paidRef: 'y' })).toEqual({ state: 'failed', why: 'not_offered' });
    const wrongKey = aRevolut({ 'GET /accounts': { status: 401, body: { message: 'unauthorized' } } });
    expect(await wrongKey.revolut.balance(TEST)).toBeUndefined();
  });
});
