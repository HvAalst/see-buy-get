import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { fiscalStanding, fiscalTitle, fiscalTone, mayResend, printable, type FiscalInvoiceRow } from './fiscal';

const row = (over: Partial<FiscalInvoiceRow> = {}): FiscalInvoiceRow => ({
  invoiceId: 'fi_1',
  entityId: 'sbg-ke',
  seller: 'SeeBuyGet Kenya',
  number: 41,
  kind: 'sale',
  buyer: { kind: 'shop', id: 'did:glos:shop', name: 'Mama Sarah Shop' },
  line: { description: 'Delivery service, parcel PUD-1', net: 100, tax: 16, gross: 116, band: 'B', ratePct: 16 },
  currency: 'KES',
  paidBy: 'prepaid',
  at: '2026-10-18T07:00:00.000Z',
  etims: { state: 'waiting', tries: 0 },
  ...over,
});

describe('tax invoices, as the screens read them', () => {
  it('prints one only once KRA has signed it', () => {
    expect(printable(row())).toBe(false);
    expect(printable(row({ etims: { state: 'recorded', tries: 1, receipt: { curRcptNo: 3, sdcId: 'KRACU0100000001' } } }))).toBe(true);
    expect(printable(row({ etims: { state: 'needs_check', tries: 2 } }))).toBe(false);
  });

  it('sends again only one KRA refused or said it already held', () => {
    expect((['waiting', 'recorded', 'refused', 'needs_check', 'not_sendable'] as const).map((state) => mayResend(row({ etims: { state, tries: 1 } })))).toEqual([false, false, true, true, false]);
    expect((['waiting', 'recorded', 'refused', 'needs_check', 'not_sendable'] as const).map(fiscalTone)).toEqual(['info', 'ok', 'danger', 'warn', 'warn']);
  });

  it('names a credit note by the sale it gives back, and says SANDBOX where a stand-in answered', () => {
    expect(fiscalTitle(row(), t)).toBe('Tax invoice no. 41');
    expect(fiscalTitle(row({ kind: 'credit', number: 42, originalNumber: 41 }), t)).toBe('Credit note no. 42 · gives back no. 41');
    expect(fiscalStanding(row({ etims: { state: 'recorded', tries: 1, receipt: { curRcptNo: 1, sdcId: 'SANDBOX', sandbox: true } } }), t)).toBe('Stand-in, not KRA');
    expect(fiscalStanding(row({ etims: { state: 'recorded', tries: 1, receipt: { curRcptNo: 1, sdcId: 'KRACU0100000001' } } }), t)).toBe('Recorded with KRA');
    expect(fiscalStanding(row({ etims: { state: 'refused', tries: 1 } }), t)).toBe('KRA refused it');
  });
});
