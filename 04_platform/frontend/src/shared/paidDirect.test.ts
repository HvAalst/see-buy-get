import { describe, expect, it } from 'vitest';
import { maySayPaid, paidDirectLine, paidWhen, shipperPaidLine } from './paidDirect';
import { t } from './i18n';
import { cash } from './money';

/** A load the shipper pays its carrier for directly, said paid (the user, 2026-10-27: "Driver ticks 'paid'"). */
describe('a matched load, paid: said the same in every app', () => {
  const at = '2026-10-27T11:05:00Z';
  const when = paidWhen(at);
  const kes = cash(4200, 'KES');

  it('the carrier reads who said it was paid, how much and when', () => {
    expect(paidDirectLine({ at, amount: 4200, currency: 'KES', by: 'driver' }, t)).toBe(`Paid ${kes} by the shipper — the driver said so on ${when}`);
    expect(paidDirectLine({ at, amount: 4200, currency: 'KES', by: 'office' }, t)).toBe(`Paid ${kes} by the shipper — the fleet’s office said so on ${when}`);
  });

  it('the shipper reads that it pays the driver directly — and, once said, that it did; nothing on a load SeeBuyGet pays for', () => {
    expect(shipperPaidLine({ paysDriverDirect: true }, t)).toBe('You pay the driver directly, the price agreed here. SeeBuyGet carries no money for this load.');
    expect(shipperPaidLine({ paysDriverDirect: true, paidDirect: { at, amount: 4200, currency: 'KES', by: 'driver' } }, t)).toBe(`The driver says you paid ${kes}, on ${when}.`);
    expect(shipperPaidLine({ paysDriverDirect: true, paidDirect: { at, amount: 4200, by: 'office' }, currency: 'KES' }, t)).toBe(`The carrier’s fleet says you paid ${kes}, on ${when}.`);
    expect(shipperPaidLine({}, t)).toBeNull();
  });

  it('offers "I was paid" only on a matched load with a price, taken and not withdrawn, and not said yet', () => {
    const row = { direct: true, status: 'in_transit', earning: 4200 };
    expect(maySayPaid(row)).toBe(true);
    expect(maySayPaid({ ...row, status: 'claimed' })).toBe(true);
    expect(maySayPaid({ ...row, status: 'delivered' })).toBe(true);
    expect(maySayPaid({ ...row, paidDirectAt: at })).toBe(false);
    expect(maySayPaid({ ...row, direct: false })).toBe(false);
    expect(maySayPaid({ ...row, status: 'cancelled' })).toBe(false);
    expect(maySayPaid({ ...row, earning: undefined })).toBe(false);
  });
});
