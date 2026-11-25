import { splitBySeller } from './bought-by';
import { PartnerStatementService, weekStartOf } from './partner-statement.service';
import type { PartnerOwedLine } from './partner-ledger.service';

/*
 * 2026-11-24 — WHAT A COMPANY OF OURS OWES A PARTNER, WEEK BY WEEK (route plan part 4; the owner: "we owe it weekly"). A week runs
 * Sunday to Saturday (UTC); each company's share of the partner's lines makes its statement; a week over is booked owed, as to a
 * supplier, once; paid by bank transfer, said with the transfer's reference, and booked paid; nothing else.
 */
const PARTNER = { entityId: 'partner-bg-balkan', name: 'Balkan Courier', kind: 'partner', status: 'active', currency: 'EUR' };
const line = (at: string, amount: number, boughtBy?: PartnerOwedLine['boughtBy'], currency = 'EUR'): PartnerOwedLine => ({
  lineId: `po_${at}_${amount}`,
  partnerEntityId: PARTNER.entityId,
  partnerName: PARTNER.name,
  country: 'BG',
  payeeId: 'did:shop:sofia',
  payeeKind: 'shop',
  amount,
  currency,
  reference: 'PUD-1',
  refType: 'parcel',
  step: 'labour',
  at,
  ...(boughtBy ? { boughtBy } : {}),
});

function aWorld(lines: PartnerOwedLine[]) {
  const posted: Array<{ entityId: string; kind: string; currency?: string; lines: Array<{ code: string; counterparty?: string; amount: number }> }> = [];
  const ledger = { linesOf: () => lines };
  const entities = {
    get: (id: string) => (id === PARTNER.entityId ? PARTNER : { entityId: id, name: id === 'sbg-nl' ? 'SeeBuyGet Nederland' : id, kind: 'sister', currency: 'EUR' }),
    list: () => [PARTNER, { entityId: 'sbg-nl', kind: 'sister', status: 'active' }],
  };
  const books = { post: (e: (typeof posted)[number]) => (posted.push(e), { entryId: `je_${posted.length}` }) };
  return { svc: new PartnerStatementService(ledger as never, entities as never, books as never), posted };
}

describe('a week, Sunday to Saturday', () => {
  it('starts on the Sunday of its week, in UTC', () => {
    expect(weekStartOf('2026-11-24T10:00:00.000Z')).toBe('2026-11-22'); // a Tuesday
    expect(weekStartOf('2026-11-22T00:00:00.000Z')).toBe('2026-11-22'); // the Sunday itself
    expect(weekStartOf('2026-11-28T23:59:59.000Z')).toBe('2026-11-22'); // the Saturday's last second
    expect(weekStartOf('2026-11-29T00:00:00.000Z')).toBe('2026-11-29'); // the next Sunday
  });

  it('splits a step by the sellers of its parcels, to the cent; a parcel the partner took in itself is its own', () => {
    expect(splitBySeller(['sbg-nl', 'sbg-nl', undefined], 90)).toEqual([{ entityId: 'sbg-nl', amount: 60 }]);
    expect(splitBySeller(['sbg-nl', 'sbg-be', 'sbg-nl'], 10)).toEqual([{ entityId: 'sbg-be', amount: 3.34 }, { entityId: 'sbg-nl', amount: 6.66 }]);
    expect(splitBySeller([undefined, undefined], 10)).toBeUndefined();
    expect(splitBySeller(['sbg-nl'], 0)).toBeUndefined();
  });
});

describe('what a company of ours owes a partner, week by week', () => {
  const NOW = Date.parse('2026-11-30T09:00:00.000Z'); // a Monday: the week of the 22nd is over, the week of the 29th is not
  const lines = [
    line('2026-11-23T10:00:00.000Z', 40, [{ entityId: 'sbg-nl', amount: 40 }]),
    line('2026-11-25T10:00:00.000Z', 30, [{ entityId: 'sbg-nl', amount: 15 }]),
    line('2026-11-26T10:00:00.000Z', -40, [{ entityId: 'sbg-nl', amount: -40 }]),
    line('2026-11-27T10:00:00.000Z', 25, [{ entityId: 'sbg-nl', amount: 25 }]),
    line('2026-11-27T11:00:00.000Z', 50), // the partner's own parcel: nobody of ours owes for it
    line('2026-11-29T08:00:00.000Z', 12, [{ entityId: 'sbg-nl', amount: 12 }]),
  ];

  it('one statement per week and company: its share in all, taken-back steps out; the week not over yet stands open', () => {
    const { svc } = aWorld(lines);
    const view = svc.statementsOf(PARTNER.entityId, NOW);
    expect(view.statements.map((s) => [s.weekStart, s.weekEnd, s.sellerName, s.amount, s.closed])).toEqual([
      ['2026-11-29', '2026-12-05', 'SeeBuyGet Nederland', 12, false],
      ['2026-11-22', '2026-11-28', 'SeeBuyGet Nederland', 40, true],
    ]);
    expect(view.unpaid).toEqual({ EUR: 40 });
  });

  it('a week over is booked owed by the company, to the partner as a supplier, once', () => {
    const { svc, posted } = aWorld(lines);
    expect(svc.closeWeeks(NOW)).toBe(1);
    expect(svc.closeWeeks(NOW)).toBe(0);
    expect(posted).toEqual([
      expect.objectContaining({ entityId: 'sbg-nl', kind: 'partner-statement', currency: 'EUR', lines: [{ code: 'expense.provider_fees', amount: 40 }, { code: 'payable.provider', counterparty: PARTNER.entityId, amount: -40 }] }),
    ]);
    expect(svc.statementsOf(PARTNER.entityId, NOW).statements[1]).toMatchObject({ owedInBooks: 40, booksCurrency: 'EUR' });
  });

  it('paid by bank transfer: said with its reference, booked paid out of cash; refused for a week not over, twice, or without the reference', () => {
    const { svc, posted } = aWorld(lines);
    const [open, closed] = svc.statementsOf(PARTNER.entityId, NOW).statements;
    expect(() => svc.markPaid(PARTNER.entityId, closed.statementId, { by: 'Amina', reference: 'x' }, NOW)).toThrow(/bank transfer’s reference/);
    expect(() => svc.markPaid(PARTNER.entityId, open.statementId, { by: 'Amina', reference: 'NL12INGB-0042' }, NOW)).toThrow(/is not over yet/);
    expect(() => svc.markPaid(PARTNER.entityId, 'pst_nothing', { by: 'Amina', reference: 'NL12INGB-0042' }, NOW)).toThrow(/No such statement/);
    const paid = svc.markPaid(PARTNER.entityId, closed.statementId, { by: 'Amina', reference: 'NL12INGB-0042' }, NOW);
    expect(paid).toMatchObject({ paidBy: 'Amina', paidReference: 'NL12INGB-0042', paidAt: new Date(NOW).toISOString() });
    expect(posted.slice(-1)[0]).toMatchObject({ entityId: 'sbg-nl', kind: 'partner-statement-paid', lines: [{ code: 'payable.provider', counterparty: PARTNER.entityId, amount: 40 }, { code: 'cash.custody', amount: -40 }] });
    expect(() => svc.markPaid(PARTNER.entityId, closed.statementId, { by: 'Brian', reference: 'NL12INGB-0043' }, NOW)).toThrow(/was paid on 2026-11-30 by Amina/);
    expect(svc.statementsOf(PARTNER.entityId, NOW).unpaid).toEqual({});
  });
});
