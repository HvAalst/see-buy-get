import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlosEvent } from '../events/glos-events';
import { STAFF_AREAS } from '../auth/staff-areas.table';
import { PaymentHubService, PROMPT_LAPSES_AFTER_MS, REFUND_AGAIN_AFTER_MS } from './payment-hub.service';
import { STAND_IN_ANSWERS_AFTER_MS, STAND_IN_LAPSES_AFTER_MS } from './stand-in.provider';
import type { HubProvider, OpenedAccount, PayoutRequest, ProviderAnswer } from './hub.types';
import { FieldEncryption } from '../data-firewall/field-encryption.service';

/*
 * 2026-11-20 — THE PAYMENT HUB (the payments plan, step 4a; the owner: "a software that combines PSP's and becomes actually a
 * payment hub"). Held to here: a payment prompt is kept before its provider is asked, waits as asked, and is settled once by
 * what the provider says — paid, declined, lapsed — never by a screen; a second press asks nobody twice, a thing paid is never
 * paid again, and two phones never pay for one thing; the number itself is never kept; the stand-in answers as a provider
 * would and keeps what the account holds; and every account is test money until a real provider exists.
 */
const PARTNER = { entityId: 'partner-et-addis', name: 'Addis Courier PLC', kind: 'partner', jurisdiction: 'ET', currency: 'ETB', status: 'active' };
const T0 = Date.parse('2026-11-20T09:00:00Z');

function aHub(extra?: HubProvider[]) {
  const entities = {
    get: (id: string) => {
      if (id !== PARTNER.entityId) throw new Error(`no ${id}`);
      return PARTNER;
    },
    amountsFor: () => ({}),
  };
  const told: Array<[string, Record<string, unknown>]> = [];
  const events = { publish: async (name: string, payload: Record<string, unknown>) => void told.push([name, payload]) };
  const hub = new PaymentHubService(entities as never, events as never, extra);
  return { hub, told };
}

describe('the payment hub', () => {
  it('a partner’s account is the stand-in’s for now: test money, in the partner’s own money, holding nothing yet', async () => {
    const { hub } = aHub();
    expect(hub.ready()).toEqual(['stand-in', 'revolut']);
    expect(await hub.accountView(PARTNER.entityId, T0)).toEqual({ provider: 'stand-in', test: true, currency: 'ETB', ready: ['stand-in', 'revolut'], balance: 0, feeOwed: 0, paysTo: 'phone', payoutTest: true, payoutBalance: 0 });
    expect(hub.paymentsOf(PARTNER.entityId)).toEqual([]);
  });

  it('a payment prompt waits as asked, and is paid when the provider says so — the account holds it, and the bus hears both', async () => {
    const { hub, told } = aHub();
    const asked = await hub.collect(PARTNER.entityId, { reference: 'PUD-1', amount: 250, payerPhone: '+251911000123', description: 'Parcel PUD-1' }, T0);
    expect(asked).toMatchObject({ kind: 'in', state: 'asked', amount: 250, currency: 'ETB', phoneEnds: '123', test: true, provider: 'stand-in', reference: 'PUD-1' });
    expect(asked.providerRef).toMatch(/^si_/);
    // Not yet: the payer has not answered.
    expect((await hub.settle(asked.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS - 1)).state).toBe('asked');
    expect((await hub.accountView(PARTNER.entityId, T0 + 1)).balance).toBe(0);
    const paid = await hub.settle(asked.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    expect(paid).toMatchObject({ state: 'paid', settledAt: new Date(T0 + STAND_IN_ANSWERS_AFTER_MS).toISOString() });
    expect((await hub.accountView(PARTNER.entityId, T0 + STAND_IN_ANSWERS_AFTER_MS)).balance).toBe(250);
    expect(told.filter(([name]) => name === GlosEvent.Pudo.HubPayment).map(([, p]) => p.state)).toEqual(['asked', 'paid']);
    // Settled once: never changed after.
    expect(await hub.settle(asked.paymentId, T0 + STAND_IN_LAPSES_AFTER_MS * 10)).toMatchObject({ state: 'paid' });
  });

  it('never keeps the number: only its last three digits, and a key that cannot be read back', async () => {
    const { hub } = aHub();
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-2', amount: 100, payerPhone: '+251911000456', description: 'Parcel PUD-2' }, T0);
    expect(JSON.stringify(p)).not.toContain('911000456');
    expect(p.phoneEnds).toBe('456');
    expect(p.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(hub.paymentsOf(PARTNER.entityId))).not.toContain('phoneHash');
  });

  it('declined where the payer’s number ends in 0000; never answered and lapsed where it ends in 9999', async () => {
    const { hub } = aHub();
    const no = await hub.collect(PARTNER.entityId, { reference: 'PUD-3', amount: 80, payerPhone: '+251911000000', description: 'x' }, T0);
    expect(await hub.settle(no.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS)).toMatchObject({ state: 'failed', why: 'declined' });
    const silent = await hub.collect(PARTNER.entityId, { reference: 'PUD-4', amount: 80, payerPhone: '+251911009999', description: 'x' }, T0);
    expect((await hub.settle(silent.paymentId, T0 + STAND_IN_LAPSES_AFTER_MS - 1)).state).toBe('asked');
    expect(await hub.settle(silent.paymentId, T0 + STAND_IN_LAPSES_AFTER_MS)).toMatchObject({ state: 'failed', why: 'expired' });
    // Neither is money the account holds; each says why in a word the screens know.
    expect((await hub.accountView(PARTNER.entityId, T0 + STAND_IN_LAPSES_AFTER_MS)).balance).toBe(0);
    expect(hub.paymentsOf(PARTNER.entityId).map((p) => [p.reference, p.state, p.why]).sort()).toEqual([
      ['PUD-3', 'failed', 'declined'],
      ['PUD-4', 'failed', 'expired'],
    ]);
  });

  it('a second press asks nobody twice; another phone or amount is refused while one waits; a thing paid is never asked again', async () => {
    const { hub } = aHub();
    const first = await hub.collect(PARTNER.entityId, { reference: 'PUD-5', amount: 120, payerPhone: '+251911000123', description: 'x' }, T0);
    const again = await hub.collect(PARTNER.entityId, { reference: 'PUD-5', amount: 120, payerPhone: '+251 911 000 123', description: 'x' }, T0 + 1000);
    expect(again.paymentId).toBe(first.paymentId);
    await expect(hub.collect(PARTNER.entityId, { reference: 'PUD-5', amount: 120, payerPhone: '+251911000789', description: 'x' }, T0 + 1000)).rejects.toThrow('A payment prompt for PUD-5 is still waiting on the phone ending 123: let it be answered or lapse first');
    await expect(hub.collect(PARTNER.entityId, { reference: 'PUD-5', amount: 99, payerPhone: '+251911000123', description: 'x' }, T0 + 1000)).rejects.toThrow(/still waiting/);
    await hub.settle(first.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    await expect(hub.collect(PARTNER.entityId, { reference: 'PUD-5', amount: 120, payerPhone: '+251911000123', description: 'x' }, T0 + 10_000)).rejects.toThrow('PUD-5 is paid already');
    // Declined: asked again, as a new prompt.
    const no = await hub.collect(PARTNER.entityId, { reference: 'PUD-6', amount: 50, payerPhone: '+251911000000', description: 'x' }, T0);
    await hub.settle(no.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    const retry = await hub.collect(PARTNER.entityId, { reference: 'PUD-6', amount: 50, payerPhone: '+251911000123', description: 'x' }, T0 + 10_000);
    expect(retry.paymentId).not.toBe(no.paymentId);
    expect(hub.paymentsOf(PARTNER.entityId).filter((p) => p.reference === 'PUD-6')).toHaveLength(2);
  });

  it('refuses nothing, a number cut short, and an unknown company before any prompt goes out', async () => {
    const { hub } = aHub();
    await expect(hub.collect(PARTNER.entityId, { reference: 'X', amount: 0, payerPhone: '+251911000123', description: 'x' }, T0)).rejects.toThrow(/more than nothing/);
    await expect(hub.collect(PARTNER.entityId, { reference: 'X', amount: 10, payerPhone: '+25191', description: 'x' }, T0)).rejects.toThrow(/whole phone number/);
    await expect(hub.collect('nobody', { reference: 'X', amount: 10, payerPhone: '+251911000123', description: 'x' }, T0)).rejects.toThrow();
    expect(hub.paymentsOf(PARTNER.entityId)).toEqual([]);
  });

  it('kept before the provider is asked: an answer lost on the way leaves it asked, asked again by our own reference, and lapsed at last', async () => {
    const asks: Array<{ providerRef?: string; ourRef: string }> = [];
    const lost: HubProvider = {
      id: 'stand-in',
      collect: async () => {
        throw new Error('socket hang up');
      },
      status: async (_a: OpenedAccount, ref: { providerRef?: string; ourRef: string }): Promise<ProviderAnswer> => {
        asks.push(ref);
        return { state: 'asked' };
      },
      payout: async () => ({ state: 'failed' }),
      refund: async () => ({ state: 'failed' }),
      balance: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const { hub } = aHub([lost]);
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-7', amount: 70, payerPhone: '+251911000123', description: 'x' }, T0);
    expect(p).toMatchObject({ state: 'asked', reference: 'PUD-7' });
    expect(p.providerRef).toBeUndefined();
    expect(hub.get(p.paymentId)?.state).toBe('asked');
    await hub.settle(p.paymentId, T0 + 60_000);
    expect(asks).toEqual([{ ourRef: p.paymentId }]);
    expect(await hub.settle(p.paymentId, T0 + PROMPT_LAPSES_AFTER_MS + 1)).toMatchObject({ state: 'failed', why: 'expired' });
    // What the account holds is said only where the provider says it.
    expect((await hub.accountView(PARTNER.entityId, T0)).balance).toBeUndefined();
  });

  it('the sweep settles every prompt still waiting, and asks no more about the settled ones', async () => {
    const { hub } = aHub();
    const a = await hub.collect(PARTNER.entityId, { reference: 'PUD-9', amount: 10, payerPhone: '+251911000123', description: 'x' }, T0);
    const b = await hub.collect(PARTNER.entityId, { reference: 'PUD-10', amount: 20, payerPhone: '+251911000000', description: 'x' }, T0);
    await hub.sweep(T0 + 1);
    expect([hub.get(a.paymentId)!.state, hub.get(b.paymentId)!.state]).toEqual(['asked', 'asked']);
    await hub.sweep(T0 + STAND_IN_ANSWERS_AFTER_MS);
    expect([hub.get(a.paymentId)!.state, hub.get(b.paymentId)!.state]).toEqual(['paid', 'failed']);
  });

  it('a try by our staff: on test money, by name, and seen like any payment', async () => {
    const { hub } = aHub();
    const tried = await hub.tryPayment(PARTNER.entityId, { phone: '+251911000123', amount: 5 }, 'Staff Ann', T0);
    expect(tried).toMatchObject({ kind: 'in', state: 'asked', amount: 5, askedBy: 'Staff Ann', test: true, phoneEnds: '123' });
    expect(tried.reference).toMatch(/^try_/);
    expect(hub.paymentsOf(PARTNER.entityId)).toEqual([tried]);
  });

  it('the stand-in pays out and gives back only from what the account holds, and never more back than came in', async () => {
    const { StandInProvider } = await import('./stand-in.provider');
    const si = new StandInProvider();
    const acct = { accountId: 'acct-1', currency: 'ETB', keys: {}, live: false };
    expect(await si.payout(acct, { ourRef: 'o1', amount: 10, currency: 'ETB', payeePhone: '+251911000222', description: 'x' }, T0)).toEqual({ state: 'failed', why: 'insufficient' });
    const paid = await si.collect(acct, { ourRef: 'i1', amount: 100, currency: 'ETB', payerPhone: '+251911000123', description: 'x' }, T0);
    const later = T0 + STAND_IN_ANSWERS_AFTER_MS;
    expect(await si.payout(acct, { ourRef: 'o2', amount: 60, currency: 'ETB', payeePhone: '+251911000222', description: 'x' }, later)).toMatchObject({ state: 'paid' });
    expect(await si.balance(acct, later)).toEqual({ amount: 40, currency: 'ETB' });
    const back = { ourRef: 'r1', amount: 40, currency: 'ETB', payeePhone: '+251911000123', description: 'x', paidRef: paid.providerRef! };
    expect(await si.refund(acct, back, later)).toMatchObject({ state: 'paid' });
    expect(await si.refund(acct, { ...back, amount: 70 }, later)).toEqual({ state: 'failed', why: 'more_than_paid' });
    expect(await si.balance(acct, later)).toEqual({ amount: 0, currency: 'ETB' });
    // Another account's payment reads as unknown to this one.
    expect(await si.status({ ...acct, accountId: 'acct-2' }, { providerRef: paid.providerRef, ourRef: 'i1' }, later)).toEqual({ state: 'failed', why: 'unknown' });
  });

  it('our fee (P4-c): set by name, counted on each payment as it is paid at the percentage then — never on a try, never on one paid before', async () => {
    const { hub } = aHub();
    const before = await hub.collect(PARTNER.entityId, { reference: 'PUD-F0', amount: 1000, payerPhone: '+251911000123', description: 'x' }, T0);
    await hub.settle(before.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    expect(() => hub.setFee(PARTNER.entityId, 51, 'Staff Ann')).toThrow(/from 0 to 50/);
    expect(() => hub.setFee(PARTNER.entityId, 3, ' ')).toThrow(/Say who sets the fee/);
    expect(hub.setFee(PARTNER.entityId, 2.5, 'Staff Ann', T0)).toMatchObject({ feePct: 2.5, feeSetBy: 'Staff Ann', feeSetAt: new Date(T0).toISOString() });
    const a = await hub.collect(PARTNER.entityId, { reference: 'PUD-F1', amount: 1000, payerPhone: '+251911000123', description: 'x' }, T0);
    expect((await hub.settle(a.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS)).fee).toEqual({ pct: 2.5, amount: 25 });
    hub.setFee(PARTNER.entityId, 4, 'Staff Ben', T0 + 1);
    const b = await hub.collect(PARTNER.entityId, { reference: 'PUD-F2', amount: 500, payerPhone: '+251911000123', description: 'x' }, T0);
    expect((await hub.settle(b.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS)).fee).toEqual({ pct: 4, amount: 20 });
    // A declined prompt and a try by our staff are no turnover; the one paid before the fee was set keeps none.
    const no = await hub.collect(PARTNER.entityId, { reference: 'PUD-F3', amount: 800, payerPhone: '+251911000000', description: 'x' }, T0);
    expect((await hub.settle(no.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS)).fee).toBeUndefined();
    const tried = await hub.tryPayment(PARTNER.entityId, { phone: '+251911000123', amount: 900 }, 'Staff Ann', T0);
    await hub.settle(tried.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    expect(hub.get(before.paymentId)?.fee).toBeUndefined();
    expect(hub.feeOwed(PARTNER.entityId)).toBe(45);
    expect(await hub.accountView(PARTNER.entityId, T0 + STAND_IN_ANSWERS_AFTER_MS)).toMatchObject({ feePct: 4, feeSetBy: 'Staff Ben', feeOwed: 45 });
    expect(hub.paymentsOf(PARTNER.entityId).find((p) => p.reference === 'PUD-F1')?.fee).toBe(25);
  });

  it('one payment, one parcel: taken for the parcel it was asked for, once', async () => {
    const { hub } = aHub();
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-U1', amount: 100, payerPhone: '+251911000123', description: 'x' }, T0);
    expect(hub.use(p.paymentId, 'PUD-U1').usedFor).toBe('PUD-U1');
    expect(hub.use(p.paymentId, 'PUD-U1').usedFor).toBe('PUD-U1');
    expect(() => hub.use(p.paymentId, 'PUD-U2')).toThrow('That payment was for PUD-U1 already');
    expect(() => hub.use('hp_nothing', 'PUD-U1')).toThrow(/No payment/);
  });

  it('a refund (P4-d): only of a paid payment, kept before the provider is asked, given back once — and our fee on it taken back', async () => {
    const { hub, told } = aHub();
    hub.setFee(PARTNER.entityId, 3, 'Staff Ann', T0);
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-R1', amount: 1000, payerPhone: '+251911000123', description: 'x' }, T0);
    await expect(hub.refund(p.paymentId, 'voided', T0)).rejects.toThrow('Only a payment that was paid is given back');
    await hub.settle(p.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    expect(hub.feeOwed(PARTNER.entityId)).toBe(30);
    const back = await hub.refund(p.paymentId, 'voided', T0 + 5000);
    expect(back).toMatchObject({ kind: 'refund', refundOf: p.paymentId, state: 'paid', amount: 1000, phoneEnds: '123', reference: 'PUD-R1' });
    expect((await hub.refund(p.paymentId, 'voided again', T0 + 6000)).paymentId).toBe(back.paymentId);
    expect(hub.feeOwed(PARTNER.entityId)).toBe(0);
    expect((await hub.accountView(PARTNER.entityId, T0 + 6000)).balance).toBe(0);
    expect(told.filter(([, x]) => x.kind === 'refund').map(([, x]) => x.state)).toEqual(['asked', 'paid']);
  });

  it('the stand-in’s answer, once given, stays: paid stays paid whatever the clock says next', async () => {
    const { hub } = aHub();
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-S1', amount: 70, payerPhone: '+251911000123', description: 'x' }, T0);
    await hub.settle(p.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    // Asked again with an earlier clock, as a second server or a test might: still paid, still held.
    expect((await hub.accountView(PARTNER.entityId, T0)).balance).toBe(70);
  });

  it('money out (4c): kept before the provider is asked; paid from what the account holds, refused beyond it — and no fee on it', async () => {
    const { hub } = aHub();
    hub.setFee(PARTNER.entityId, 3, 'Staff Ann', T0);
    await expect(hub.payout(PARTNER.entityId, { reference: 'pp_1', amount: 10, payeePhone: '+251911000222', description: 'x' }, T0)).resolves.toMatchObject({ kind: 'out', state: 'failed', why: 'insufficient' });
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-O1', amount: 100, payerPhone: '+251911000123', description: 'x' }, T0);
    await hub.settle(p.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    const out = await hub.payout(PARTNER.entityId, { reference: 'pp_2', amount: 60, payeePhone: '+251911000222', description: 'x' }, T0 + STAND_IN_ANSWERS_AFTER_MS);
    expect(out).toMatchObject({ kind: 'out', state: 'paid', amount: 60, phoneEnds: '222', reference: 'pp_2' });
    expect(out.fee).toBeUndefined();
    expect((await hub.accountView(PARTNER.entityId, T0 + STAND_IN_ANSWERS_AFTER_MS)).balance).toBe(40);
    await expect(hub.payout(PARTNER.entityId, { reference: 'pp_3', amount: 0, payeePhone: '+251911000222', description: 'x' }, T0)).rejects.toThrow(/more than nothing/);
  });

  it('a refund that did not go is asked again an hour later, once it can go — never twice', async () => {
    const { hub } = aHub();
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-RA', amount: 100, payerPhone: '+251911000123', description: 'x' }, T0);
    await hub.settle(p.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    // Paid out first, so the account cannot give it back.
    await hub.payout(PARTNER.entityId, { reference: 'pp_x', amount: 100, payeePhone: '+251911000222', description: 'x' }, T0 + STAND_IN_ANSWERS_AFTER_MS);
    const first = await hub.refund(p.paymentId, 'voided', T0 + 10_000);
    expect(first).toMatchObject({ state: 'failed', why: 'insufficient' });
    expect(await hub.refundsAgain(T0 + 20_000)).toEqual([]);
    // Money in again; an hour after the failed try, it goes — and only once.
    const q = await hub.collect(PARTNER.entityId, { reference: 'PUD-RB', amount: 200, payerPhone: '+251911000124', description: 'x' }, T0 + 30_000);
    await hub.settle(q.paymentId, T0 + 30_000 + STAND_IN_ANSWERS_AFTER_MS);
    const again = await hub.refundsAgain(T0 + 10_000 + REFUND_AGAIN_AFTER_MS);
    expect(again.map((x) => [x.refundOf, x.state])).toEqual([[p.paymentId, 'paid']]);
    expect(await hub.refundsAgain(T0 + 10_000 + 3 * REFUND_AGAIN_AFTER_MS)).toEqual([]);
  });

  it('4e — what came in, went back and went out, paid: senders’ payments only, never a try; the companies it keeps payments for', async () => {
    const { hub } = aHub();
    const p = await hub.collect(PARTNER.entityId, { reference: 'PUD-T1', amount: 300, payerPhone: '+251911000123', description: 'x' }, T0);
    await hub.settle(p.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    const q = await hub.collect(PARTNER.entityId, { reference: 'PUD-T2', amount: 100, payerPhone: '+251911000124', description: 'x' }, T0);
    await hub.settle(q.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    const tried = await hub.tryPayment(PARTNER.entityId, { phone: '+251911000125', amount: 50 }, 'Staff Ann', T0);
    await hub.settle(tried.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    await hub.refund(q.paymentId, 'voided', T0 + 10_000);
    await hub.payout(PARTNER.entityId, { reference: 'pp_1', amount: 40, payeePhone: '+251911000222', description: 'x' }, T0 + 10_000);
    const never = await hub.collect(PARTNER.entityId, { reference: 'PUD-T3', amount: 70, payerPhone: '+251911000000', description: 'x' }, T0);
    await hub.settle(never.paymentId, T0 + STAND_IN_ANSWERS_AFTER_MS);
    expect(hub.totalsOf(PARTNER.entityId)).toEqual({ paidIn: 400, givenBack: 100, paidOut: 40 });
    expect(hub.owners()).toEqual([PARTNER.entityId]);
    expect(hub.kept(PARTNER.entityId).map((x) => x.kind)).toEqual(['in', 'in', 'in', 'in', 'refund', 'out']);
  });

  it('its staff doors are for staff who keep the money, and the server says at boot what the hub reaches', () => {
    expect(STAFF_AREAS['GET sbg/entities/:entityId/payment-account']).toBe('money');
    expect(STAFF_AREAS['POST sbg/entities/:entityId/payment-account/try']).toBe('money');
    expect(STAFF_AREAS['POST sbg/entities/:entityId/payment-account/fee']).toBe('money');
    expect(STAFF_AREAS['POST sbg/entities/:entityId/payment-account/key']).toBe('money');
    expect(STAFF_AREAS['POST sbg/entities/:entityId/payment-account/live']).toBe('money');
    // A walk-up's payment is the shop's own, at its counter: staff ask nothing in its name.
    expect(STAFF_AREAS['POST sbg/parcels/phone-payment']).toBe('none');
    expect(STAFF_AREAS['GET sbg/parcels/phone-payment/:paymentId']).toBe('none');
    const app = readFileSync(join(__dirname, '../../app.module.ts'), 'utf8');
    expect(app).toMatch(/PaymentHubModule,/);
  });

  /*
   * 2026-11-25 — ROUTE PLAN PART 4: a partner in the European Union pays its hands from its own Revolut Business account, chosen by
   * its country, to their bank accounts. Its key is entered by our staff, asked of the provider first and kept sealed; a test key
   * pays test money at once, a live key only once a second person switches it on; payments in stay on the stand-in.
   */
  describe('a partner in the European Union, paying its hands by bank (route plan part 4)', () => {
    const BG = { entityId: 'partner-bg-sofia', name: 'Sofia Partner OOD', kind: 'partner', jurisdiction: 'BG', currency: 'EUR', status: 'active' };
    const ANN = { name: 'Staff Ann', key: 'rk-ann' };
    const BEN = { name: 'Staff Ben', key: 'rk-ben' };
    const IBAN = { account: 'BG80BNBG96611020345678', holder: 'Ivan Petrov' };

    function aBgHub() {
      const sent: Array<{ account: OpenedAccount; req: PayoutRequest }> = [];
      const looked: OpenedAccount[] = [];
      const fakeRevolut: HubProvider = {
        id: 'revolut',
        collect: async () => ({ state: 'failed', why: 'not_offered' }),
        refund: async () => ({ state: 'failed', why: 'not_offered' }),
        status: async (a, ref) => {
          looked.push(a);
          return { state: 'paid', ...(ref.providerRef ? { providerRef: ref.providerRef } : {}) };
        },
        payout: async (account, req) => {
          sent.push({ account, req });
          return { state: req.description === 'later' ? 'asked' : 'paid', providerRef: `tx-${sent.length}` };
        },
        balance: async (account) => (String(account.keys.apiKey ?? '').startsWith('good') ? { amount: account.live ? 900 : 500, currency: 'EUR' } : undefined),
      };
      const entities = {
        get: (id: string) => {
          if (id === BG.entityId) return BG;
          if (id === PARTNER.entityId) return PARTNER;
          throw new Error(`no ${id}`);
        },
        amountsFor: () => ({}),
      };
      const hub = new PaymentHubService(entities as never, { publish: async () => undefined } as never, [fakeRevolut], new FieldEncryption());
      return { hub, sent, looked };
    }

    it('its hands are paid to bank accounts, through Revolut, chosen by its country; with no key, on the stand-in’s test money', async () => {
      const { hub, sent } = aBgHub();
      expect(await hub.accountView(BG.entityId, T0)).toMatchObject({ provider: 'stand-in', payoutProvider: 'revolut', paysTo: 'bank', payoutTest: true, currency: 'EUR' });
      const out = await hub.payout(BG.entityId, { reference: 'pp_bg1', amount: 10, payeeAccount: IBAN, description: 'x' }, T0);
      expect(out).toMatchObject({ provider: 'stand-in', state: 'failed', why: 'insufficient', toBank: true, phoneEnds: '678', test: true });
      expect(out.phoneHash).toBeUndefined();
      expect(JSON.stringify(out)).not.toContain('96611020345678');
      expect(sent).toEqual([]);
      // Payments in stay on the stand-in: Revolut takes none.
      expect(hub.account(BG.entityId).provider).toBe('stand-in');
    });

    it('a key is refused where the country pays through no provider, and where it does not open an account in the partner’s money', async () => {
      const { hub } = aBgHub();
      await expect(hub.setKey(PARTNER.entityId, { key: 'good-key-0123456789', test: true }, ANN, T0)).rejects.toThrow(/No payout provider is connected for ET/);
      await expect(hub.setKey(BG.entityId, { key: 'wrong-key-0123456789', test: true }, ANN, T0)).rejects.toThrow(/did not open an account in EUR: check it is a test \(sandbox\) key, made without request signing/);
      await expect(hub.setKey(BG.entityId, { key: 'good key with spaces', test: true }, ANN, T0)).rejects.toThrow(/whole key, with no spaces/);
      expect((await hub.accountView(BG.entityId, T0)).keyEnds).toBeUndefined();
    });

    it('a test key pays test money through Revolut at once, sealed — never kept as typed — and refuses a phone', async () => {
      const { hub, sent } = aBgHub();
      const rec = await hub.setKey(BG.entityId, { key: 'good-test-key-0123456789', test: true }, ANN, T0);
      expect(rec.keySealed?.startsWith('enc:')).toBe(true);
      expect(JSON.stringify(rec)).not.toContain('good-test-key-0123456789');
      expect(await hub.accountView(BG.entityId, T0)).toMatchObject({ payoutProvider: 'revolut', payoutTest: true, payoutBalance: 500, keyEnds: '6789', keyTest: true, keyBy: 'Staff Ann' });
      const out = await hub.payout(BG.entityId, { reference: 'pp_bg2', amount: 10, payeeAccount: IBAN, description: 'Sofia Partner OOD: 2 steps' }, T0);
      expect(out).toMatchObject({ provider: 'revolut', state: 'paid', test: true, toBank: true, providerRef: 'tx-1' });
      expect(sent[0].account).toMatchObject({ live: false, keys: { apiKey: 'good-test-key-0123456789' }, currency: 'EUR' });
      expect(sent[0].req).toMatchObject({ ourRef: out.paymentId, amount: 10, currency: 'EUR', payeeAccount: IBAN });
      expect(sent[0].req.payeePhone).toBeUndefined();
      await expect(hub.payout(BG.entityId, { reference: 'pp_bg3', amount: 10, payeePhone: '+359888123456', description: 'x' }, T0)).rejects.toThrow(/pays to a bank account/);
      await expect(hub.payout(BG.entityId, { reference: 'pp_bg4', amount: 10, description: 'x' }, T0)).rejects.toThrow(/one of the two/);
      expect(() => hub.switchLive(BG.entityId, BEN, T0)).toThrow(/test key/);
    });

    it('a live key pays nothing real until a second person switches it on; a new key is switched on again', async () => {
      const { hub, sent, looked } = aBgHub();
      await hub.setKey(BG.entityId, { key: 'good-live-key-0123456789', test: false }, ANN, T0);
      expect(hub.account(BG.entityId, 'out').provider).toBe('stand-in');
      expect(await hub.accountView(BG.entityId, T0)).toMatchObject({ payoutTest: true, keyTest: false, keyBy: 'Staff Ann' });
      expect(() => hub.switchLive(BG.entityId, ANN, T0)).toThrow(/second person/);
      // The same sign-in under another name is refused: it is the sign-in that counts, not the name typed.
      expect(() => hub.switchLive(BG.entityId, { name: 'Somebody Else', key: 'rk-ann' }, T0)).toThrow(/second person/);
      // The same person under another sign-in, by name, is refused too.
      expect(() => hub.switchLive(BG.entityId, { name: 'staff ann', key: 'rk-other' }, T0)).toThrow(/second person/);
      hub.switchLive(BG.entityId, BEN, T0 + 1000);
      expect(() => hub.switchLive(BG.entityId, { name: 'Staff Cy', key: 'rk-cy' }, T0)).toThrow(/already, by Staff Ben/);
      expect(await hub.accountView(BG.entityId, T0)).toMatchObject({ payoutTest: false, payoutBalance: 900, liveBy: 'Staff Ben', liveAt: new Date(T0 + 1000).toISOString() });
      const out = await hub.payout(BG.entityId, { reference: 'pp_bg5', amount: 10, payeeAccount: IBAN, description: 'later' }, T0);
      expect(out).toMatchObject({ provider: 'revolut', test: false, state: 'asked' });
      expect(sent[0].account.live).toBe(true);
      await hub.setKey(BG.entityId, { key: 'good-live-key-new-0123456789', test: false }, BEN, T0 + 2000);
      expect(hub.account(BG.entityId, 'out').provider).toBe('stand-in');
      expect((await hub.accountView(BG.entityId, T0)).liveBy).toBeUndefined();
      // A payout made through Revolut is asked about through Revolut, by the test-or-live it was made with.
      expect((await hub.settle(out.paymentId, T0)).state).toBe('paid');
      expect(looked.at(-1)).toMatchObject({ live: true, keys: { apiKey: 'good-live-key-new-0123456789' } });
    });
  });
});
