import { GlosEvent } from '../../foundation/events/glos-events';
import { STAFF_AREAS } from '../../foundation/auth/staff-areas.table';
import { PaymentHubService } from '../../foundation/payment-hub/payment-hub.service';
import { STAND_IN_ANSWERS_AFTER_MS } from '../../foundation/payment-hub/stand-in.provider';
import type { HubProvider } from '../../foundation/payment-hub/hub.types';
import { PartnerPayoutService, PAYOUT_AGAIN_AFTER_MS, PAYOUT_HOUR_UTC } from './partner-payout.service';
import type { PartnerOwedLine } from './partner-ledger.service';

/*
 * 2026-11-20 — WHAT A PARTNER OWES, PAID (the payments plan, 4c; P4-b "once per day"; P3-d "the payout waits"). Held to here:
 * once a day, after the hour, every hand the partner owes is paid what it is owed — its steps, its take-backs netted — from the
 * partner's own account to the hand's own number; a payout that cannot go waits, says why, and is tried again every hour; a
 * payout still on its way is never sent again; a step is paid by one payout only; staff may pay now, by name.
 */
const PARTNER = { entityId: 'partner-et', name: 'Addis Courier PLC', kind: 'partner', jurisdiction: 'ET', currency: 'ETB', status: 'active' };
const DAY = '2026-11-20';
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00Z`);
const H = 3_600_000;

let seq = 0;
const line = (payeeId: string, payeeKind: PartnerOwedLine['payeeKind'], amount: number, extra: Partial<PartnerOwedLine> = {}): PartnerOwedLine => ({
  lineId: `po_${++seq}`,
  partnerEntityId: PARTNER.entityId,
  partnerName: PARTNER.name,
  country: 'ET',
  payeeId,
  payeeKind,
  amount,
  currency: 'ETB',
  reference: `PUD-${seq}`,
  refType: 'parcel',
  step: 'labour',
  at: new Date(at('09:00')).toISOString(),
  ...extra,
});

function aWorld(extra?: HubProvider[]) {
  const lines: PartnerOwedLine[] = [];
  const ledger = {
    linesOf: (id: string) => lines.filter((l) => l.partnerEntityId === id),
    partnersWithLines: () => [...new Set(lines.map((l) => l.partnerEntityId))],
    ledgerOf: () => ({ currency: 'ETB' }),
  };
  const set = new Map<string, { numberId: string; msisdn: string; heldUntil?: number }>();
  const numbers = {
    partnerDestination: (payeeId: string, now: number) => {
      const n = set.get(payeeId);
      if (!n) return { reason: 'no_number' };
      if (n.heldUntil && n.heldUntil > now) return { reason: 'number_new' };
      return { numberId: n.numberId, masked: `${n.msisdn.slice(0, 6)}***${n.msisdn.slice(-3)}` };
    },
    fullNumber: (payeeId: string, numberId: string) => (set.get(payeeId)?.numberId === numberId ? set.get(payeeId)?.msisdn : undefined),
  };
  const entities = { get: () => PARTNER, amountsFor: () => ({}) };
  const told: Array<[string, Record<string, unknown>]> = [];
  const events = { publish: async (name: string, payload: Record<string, unknown>) => void told.push([name, payload]) };
  const hub = new PaymentHubService(entities as never, events as never, extra);
  const payouts = new PartnerPayoutService(ledger as never, numbers as never, hub, events as never);
  /** Money into the partner's account, as senders pay it: a prompt, paid. */
  const fund = async (amount: number, now = at('08:00')) => {
    const p = await hub.collect(PARTNER.entityId, { reference: `FUND-${++seq}`, amount, payerPhone: '+251911000123', description: 'x' }, now);
    await hub.settle(p.paymentId, now + STAND_IN_ANSWERS_AFTER_MS);
  };
  const number = (payeeId: string, msisdn: string, heldUntil?: number) => set.set(payeeId, { numberId: `pn_${++seq}`, msisdn, ...(heldUntil ? { heldUntil } : {}) });
  return { lines, hub, payouts, fund, number, told };
}

describe('what a partner owes, paid once a day', () => {
  it('after the day’s hour: each hand paid what it is owed, take-backs netted, to its own number, from the partner’s account', async () => {
    const w = aWorld();
    await w.fund(1000);
    const t1 = line('did:shop-bole', 'shop', 40);
    w.lines.push(t1, line('did:shop-bole', 'shop', 40), line('did:shop-bole', 'shop', -40, { undoes: t1.lineId }), line('mdp_addis', 'hub', 25), line('did:courier', 'driver', 300));
    w.number('did:shop-bole', '251911000201');
    w.number('mdp_addis', '251911000202');
    // Before the hour: nothing.
    await w.payouts.tick(at('14:59'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows).toEqual([]);
    await w.payouts.tick(at(`${PAYOUT_HOUR_UTC}:00`));
    const view = w.payouts.viewOf(PARTNER.entityId);
    const by = (id: string) => view.rows.find((r) => r.payeeId === id);
    expect(by('did:shop-bole')).toMatchObject({ amount: 40, steps: 3, state: 'paid', numberMasked: '251911***201' });
    expect(by('mdp_addis')).toMatchObject({ amount: 25, steps: 1, state: 'paid' });
    // No number yet: it waits, and says why.
    expect(by('did:courier')).toMatchObject({ amount: 300, state: 'waiting', why: 'no_number' });
    expect(view).toMatchObject({ currency: 'ETB', waiting: 1, waitingAmount: 300, shortAmount: 0, paidAmount: 65 });
    expect((await w.hub.accountView(PARTNER.entityId, at('15:01'))).balance).toBe(935);
    expect(w.hub.paymentsOf(PARTNER.entityId).filter((p) => p.kind === 'out').map((p) => [p.amount, p.phoneEnds, p.state]).sort()).toEqual([[25, '202', 'paid'], [40, '201', 'paid']]);
    // Paid steps are the hand's to see as paid; the courier's are not.
    const paid = w.payouts.paidLineIds();
    expect(w.lines.filter((l) => paid.has(l.lineId)).map((l) => l.payeeId).sort()).toEqual(['did:shop-bole', 'did:shop-bole', 'did:shop-bole', 'mdp_addis']);
    // Once a day: a second look the same day makes no new payouts.
    await w.payouts.tick(at('15:10'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows).toHaveLength(3);
    // The courier sets its number: within the hour after, its payout goes.
    w.number('did:courier', '251911000203');
    await w.payouts.tick(at('15:30'));
    expect(by('did:courier')).toMatchObject({ state: 'waiting' });
    await w.payouts.tick(at('15:00') + PAYOUT_AGAIN_AFTER_MS);
    expect(w.payouts.viewOf(PARTNER.entityId).rows.find((r) => r.payeeId === 'did:courier')).toMatchObject({ state: 'paid', amount: 300 });
    expect(w.told.filter(([name]) => name === GlosEvent.Pudo.PartnerPayout).length).toBeGreaterThan(0);
  });

  it('the partner’s account short: the payout waits, says so, and goes once the account holds enough', async () => {
    const w = aWorld();
    await w.fund(100);
    w.lines.push(line('did:shop-bole', 'shop', 300));
    w.number('did:shop-bole', '251911000201');
    await w.payouts.tick(at('15:00'));
    expect(w.payouts.viewOf(PARTNER.entityId)).toMatchObject({ waiting: 1, waitingAmount: 300, shortAmount: 300, paidAmount: 0 });
    expect(w.payouts.viewOf(PARTNER.entityId).rows[0]).toMatchObject({ state: 'waiting', why: 'balance' });
    // Topped up by senders' payments: tried again once the hour since its last try is up — not at every look before it.
    await w.fund(500, at('15:20'));
    await w.payouts.tick(at('15:30'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows[0]).toMatchObject({ state: 'waiting', why: 'balance' });
    await w.payouts.tick(at('15:00') + PAYOUT_AGAIN_AFTER_MS);
    expect(w.payouts.viewOf(PARTNER.entityId)).toMatchObject({ waiting: 0, shortAmount: 0, paidAmount: 300 });
    expect((await w.hub.accountView(PARTNER.entityId, at('16:10'))).balance).toBe(300);
  });

  it('a number just changed: the payout waits the day out', async () => {
    const w = aWorld();
    await w.fund(100);
    w.lines.push(line('did:shop-bole', 'shop', 40));
    w.number('did:shop-bole', '251911000201', at('15:00') + 24 * H);
    await w.payouts.tick(at('15:00'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows[0]).toMatchObject({ state: 'waiting', why: 'number_new' });
  });

  it('never sent twice: a payout whose payment is still on its way is waited for, and paid once it lands', async () => {
    let answered = false;
    const sent: string[] = [];
    const slow: HubProvider = {
      id: 'stand-in',
      collect: async () => ({ state: 'paid', providerRef: 'si_in' }),
      status: async (_a, ref) => (answered ? { state: 'paid', providerRef: ref.providerRef } : { state: 'asked', providerRef: ref.providerRef }),
      payout: async (_a, req) => (sent.push(req.ourRef), { state: 'asked', providerRef: `si_${req.ourRef}` }),
      refund: async () => ({ state: 'failed' }),
      balance: async () => ({ amount: 10_000, currency: 'ETB' }),
    };
    const w = aWorld([slow]);
    w.lines.push(line('did:shop-bole', 'shop', 40));
    w.number('did:shop-bole', '251911000201');
    await w.payouts.tick(at('15:00'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows[0]).toMatchObject({ state: 'waiting', why: 'unreachable' });
    await w.payouts.tick(at('15:00') + PAYOUT_AGAIN_AFTER_MS);
    expect(sent).toHaveLength(1);
    answered = true;
    await w.payouts.tick(at('15:00') + 2 * PAYOUT_AGAIN_AFTER_MS);
    expect(sent).toHaveLength(1);
    expect(w.payouts.viewOf(PARTNER.entityId).rows[0]).toMatchObject({ state: 'paid' });
  });

  it('a step after the day’s payout goes in the next day’s, and each step is paid by one payout only', async () => {
    const w = aWorld();
    await w.fund(1000);
    w.lines.push(line('did:shop-bole', 'shop', 40));
    w.number('did:shop-bole', '251911000201');
    await w.payouts.tick(at('15:00'));
    w.lines.push(line('did:shop-bole', 'shop', 25, { at: new Date(at('16:00')).toISOString() }));
    await w.payouts.tick(at('16:00'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows).toHaveLength(1);
    await w.payouts.tick(at('15:00') + 24 * H);
    const rows = w.payouts.viewOf(PARTNER.entityId).rows;
    expect(rows.map((r) => [r.amount, r.steps, r.state])).toEqual([[25, 1, 'paid'], [40, 1, 'paid']]);
  });

  it('a hand whose take-backs come to all it was owed is not paid, and the rest waits for its next step', async () => {
    const w = aWorld();
    await w.fund(1000);
    const t = line('did:shop-bole', 'shop', 40);
    w.lines.push(t, line('did:shop-bole', 'shop', -40, { undoes: t.lineId }));
    w.number('did:shop-bole', '251911000201');
    await w.payouts.tick(at('15:00'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows).toEqual([]);
  });

  it('our staff pay now, by name — the day’s own run then finds less to pay', async () => {
    const w = aWorld();
    await w.fund(1000);
    w.lines.push(line('did:shop-bole', 'shop', 40));
    w.number('did:shop-bole', '251911000201');
    await expect(w.payouts.payNow(PARTNER.entityId, ' ', at('10:00'))).rejects.toThrow(/Say who pays out/);
    const view = await w.payouts.payNow(PARTNER.entityId, 'Staff Ann', at('10:00'));
    expect(view.rows[0]).toMatchObject({ state: 'paid', amount: 40, askedBy: 'Staff Ann' });
    await w.payouts.tick(at('15:00'));
    expect(w.payouts.viewOf(PARTNER.entityId).rows).toHaveLength(1);
  });

  it('its doors: staff who keep the money read and pay now; the partner’s own people read theirs', () => {
    expect(STAFF_AREAS['GET sbg/entities/:entityId/partner-payouts']).toBe('money');
    expect(STAFF_AREAS['POST sbg/entities/:entityId/partner-payouts/run']).toBe('money');
    expect(STAFF_AREAS['GET sbg/partner/me/payouts']).toBe('none');
  });
});
