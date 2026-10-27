import { describe, expect, it } from 'vitest';
import { maySayNotPaid, maySayPaid, paidDirectLine, paidWhen, shipperPaidLine } from './paidDirect';
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
    // Delivered and NOT paid yet, as the driver said: with the price agreed; paid later, paid is what is said.
    expect(shipperPaidLine({ paysDriverDirect: true, notPaidDirect: { at, by: 'driver' }, agreedPrice: 4200, currency: 'KES' }, t)).toBe(`The driver says you have not paid ${kes} yet, as of ${when}. You pay them directly. Still unpaid a week later, drivers are shown it before they take your loads.`);
    // What drivers are shown of that shipper, before they take its next load.
    expect(t('common.paidDirect.shipperUnpaid', { n: 1 })).toBe('Drivers say this shipper has not paid them for 1 load, still unpaid a week after they said so.');
    expect(t('common.paidDirect.shipperUnpaid', { n: 3 })).toContain('for 3 loads');
    expect(shipperPaidLine({ paysDriverDirect: true, notPaidDirect: { at, by: 'driver' }, paidDirect: { at, amount: 4200, currency: 'KES', by: 'driver' } }, t)).toBe(`The driver says you paid ${kes}, on ${when}.`);
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
    // "Not paid yet" only once delivered, and only while nothing is said either way.
    expect(maySayNotPaid({ ...row, status: 'delivered' })).toBe(true);
    expect(maySayNotPaid(row)).toBe(false);
    expect(maySayNotPaid({ ...row, status: 'delivered', notPaidDirectAt: at })).toBe(false);
    expect(maySayNotPaid({ ...row, status: 'delivered', paidDirectAt: at })).toBe(false);
    expect(maySayPaid({ ...row, status: 'delivered', notPaidDirectAt: at } as never)).toBe(true);
  });
});
