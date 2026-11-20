import type { EntityService } from '../../foundation/entity/entity.service';
import type { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import type { DirectPayService } from './direct-pay.service';
import type { DirectPayment } from './direct-pay.types';
import { FeeInvoiceService, feeTotals } from './fee-invoice.service';
import type { NotificationService } from './notification.service';

/*
 * 2026-11-20 — OUR FEE, INVOICED ONCE A MONTH (the payments plan, part 2c; the owner: "the invoices are already paid because we
 * took a cut"). What is held to here: a month that has ended is invoiced once per carrier, never the month still running; the
 * tax is worked back out of what Mollie took, never added on top; numbers run unbroken per company and year, and test payments
 * have a series of their own, marked as a test; the seller is our company as recorded, the buyer the carrier as Mollie knows
 * it; it says it is paid; only the carrier it is made out to reads it; and with no company of ours recorded, nothing is made.
 */
const COURIER = 'did:glos:courier-utrecht';
const OTHER = 'did:glos:courier-zwolle';
const pay = (over: Partial<DirectPayment>): DirectPayment => ({ paymentId: `tr_${Math.random().toString(36).slice(2, 8)}`, ref: 'r', freightId: 'frt_1', code: 'FRT-1', payeeId: COURIER, via: 'oauth', testmode: false, amount: 180, currency: 'EUR', fee: 0.5, status: 'paid', paidAt: '2026-10-05T10:00:00Z', createdAt: '2026-10-05T09:55:00Z', askedBy: COURIER, ...over });

const COMPANY = {
  entityId: 'ent_nl',
  name: 'SeeBuyGet Nederland',
  record: { legalName: 'SeeBuyGet Nederland B.V.', registrationNumber: '90000001', registeredAddress: { line1: 'Herengracht 1', postalCode: '1015 BA', city: 'Amsterdam', country: 'NL' }, taxRegistrations: [{ kind: 'vat', number: 'NL000000001B01' }] },
};

function aWorld(payments: DirectPayment[], opts: { company?: boolean } = {}) {
  const told: Array<{ did: string; title: string; kind: string }> = [];
  const direct = { paidWithFee: () => payments } as unknown as DirectPayService;
  const mollie = { connection: (id: string) => (id === COURIER ? { organization: { id: 'org_1', name: 'Van Dijk <Transport>', registrationNumber: '12345678', vatNumber: 'NL123456789B01', address: { streetAndNumber: 'Kanaalweg 1', postalCode: '3526 KL', city: 'Utrecht', country: 'NL' } } } : undefined) } as unknown as MollieConnectService;
  const entities = { sisterRecordFor: (c: string) => (c === 'NL' && opts.company !== false ? COMPANY : undefined) } as unknown as EntityService;
  const notifications = { notify: async (did: string, n: { title: string; kind: string }) => void told.push({ did, title: n.title, kind: n.kind }) } as unknown as NotificationService;
  return { svc: new FeeInvoiceService(direct, mollie, entities, notifications), told };
}

const NOV_1 = Date.parse('2026-11-01T00:30:00Z');

describe('our fee, invoiced once a month', () => {
  it('works the tax back out of what Mollie took — never adds it on top', () => {
    expect(feeTotals([0.5, 0.5], 0.21)).toEqual({ gross: 1, net: 0.83, tax: 0.17 });
    expect(feeTotals([0.33, 0.33, 0.33], 0.21)).toEqual({ gross: 0.99, net: 0.82, tax: 0.17 });
  });

  it('a month that has ended, invoiced once per carrier: its fees, the tax, our company to the carrier — paid on the day it is made', async () => {
    const w = aWorld([pay({ paidAt: '2026-10-20T15:00:00Z', code: 'FRT-2' }), pay({ paidAt: '2026-10-05T10:00:00Z' })]);
    const [inv, ...more] = await w.svc.issueDue(NOV_1);
    expect(more).toEqual([]);
    expect(inv).toMatchObject({ number: 'NL-2026-00001', test: false, month: '2026-10', currency: 'EUR', rate: 0.21, gross: 1, net: 0.83, tax: 0.17, issuedAt: '2026-11-01T00:30:00.000Z' });
    expect(inv.lines.map((l) => l.code)).toEqual(['FRT-1', 'FRT-2']);
    expect(inv.seller).toEqual({ name: 'SeeBuyGet Nederland B.V.', registrationNumber: '90000001', vatNumber: 'NL000000001B01', address: 'Herengracht 1, 1015 BA Amsterdam, NL' });
    expect(inv.buyer).toMatchObject({ name: 'Van Dijk <Transport>', registrationNumber: '12345678', vatNumber: 'NL123456789B01', address: 'Kanaalweg 1, 3526 KL Utrecht, NL' });
    expect(w.told).toEqual([{ did: COURIER, kind: 'fee_invoice', title: 'Invoice NL-2026-00001: our fee for October 2026' }]);
    expect(await w.svc.issueDue(NOV_1 + 3_600_000)).toEqual([]);
    const page = w.svc.html(inv.invoiceId, COURIER);
    expect(page).toContain('Factuur / Invoice NL-2026-00001');
    expect(page).toContain('Btw / VAT 21%');
    expect(page).toContain('EUR 0,83');
    expect(page).toContain('Voldaan: ingehouden door Mollie');
    expect(page).toContain('Van Dijk &lt;Transport&gt;');
    expect(page).not.toContain('TESTFACTUUR');
  });

  it('the month still running waits', async () => {
    const w = aWorld([pay({ paidAt: '2026-11-03T10:00:00Z' })]);
    expect(await w.svc.issueDue(Date.parse('2026-11-20T10:00:00Z'))).toEqual([]);
    expect(await w.svc.issueDue(Date.parse('2026-12-01T00:10:00Z'))).toHaveLength(1);
  });

  it('numbers run unbroken per company and year; test payments have a series of their own, marked as a test', async () => {
    const w = aWorld([pay({ payeeId: COURIER }), pay({ payeeId: OTHER }), pay({ payeeId: COURIER, testmode: true, paymentId: 'tr_test' })]);
    const made = await w.svc.issueDue(NOV_1);
    expect(made.map((i) => i.number).sort()).toEqual(['NL-2026-00001', 'NL-2026-00002', 'TEST-NL-2026-00001']);
    const test = made.find((i) => i.test)!;
    expect(test.lines.map((l) => l.paymentId)).toEqual(['tr_test']);
    expect(w.svc.html(test.invoiceId, COURIER)).toContain('TESTFACTUUR');
    expect(w.told.find((t) => t.title.startsWith('Test invoice'))?.title).toBe('Test invoice TEST-NL-2026-00001: our fee for October 2026');
    // A carrier Mollie does not know any more is still invoiced, by who it is.
    expect(made.find((i) => i.payeeId === OTHER)!.buyer).toEqual({ name: OTHER });
  });

  it('only the carrier it is made out to reads it; its list is newest first', async () => {
    const w = aWorld([pay({ paidAt: '2026-09-10T10:00:00Z' }), pay({ paidAt: '2026-10-10T10:00:00Z' })]);
    const made = await w.svc.issueDue(NOV_1);
    expect(made.map((i) => i.number)).toEqual(['NL-2026-00001', 'NL-2026-00002']);
    expect(() => w.svc.html(made[0].invoiceId, OTHER)).toThrow('No such invoice');
    expect(w.svc.listFor(COURIER).items.map((i) => i.month)).toEqual(['2026-10', '2026-09']);
    expect(w.svc.listFor(OTHER).items).toEqual([]);
  });

  it('with no company of ours recorded in the Netherlands, nothing is made yet — and it is, the day the company is recorded', async () => {
    const w = aWorld([pay({})], { company: false });
    expect(await w.svc.issueDue(NOV_1)).toEqual([]);
    expect(w.svc.listFor(COURIER)).toEqual({ items: [] });
    expect(w.told).toEqual([]);
  });
});
