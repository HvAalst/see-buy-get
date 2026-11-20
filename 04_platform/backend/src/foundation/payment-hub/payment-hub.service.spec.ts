import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlosEvent } from '../events/glos-events';
import { STAFF_AREAS } from '../auth/staff-areas.table';
import { PaymentHubService, PROMPT_LAPSES_AFTER_MS } from './payment-hub.service';
import { STAND_IN_ANSWERS_AFTER_MS, STAND_IN_LAPSES_AFTER_MS } from './stand-in.provider';
import type { HubProvider, OpenedAccount, ProviderAnswer } from './hub.types';

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
    expect(hub.ready()).toEqual(['stand-in']);
    expect(await hub.accountView(PARTNER.entityId, T0)).toEqual({ provider: 'stand-in', test: true, currency: 'ETB', ready: ['stand-in'], balance: 0 });
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

  it('its staff doors are for staff who keep the money, and the server says at boot what the hub reaches', () => {
    expect(STAFF_AREAS['GET sbg/entities/:entityId/payment-account']).toBe('money');
    expect(STAFF_AREAS['POST sbg/entities/:entityId/payment-account/try']).toBe('money');
    const app = readFileSync(join(__dirname, '../../app.module.ts'), 'utf8');
    expect(app).toMatch(/PaymentHubModule,/);
  });
});
