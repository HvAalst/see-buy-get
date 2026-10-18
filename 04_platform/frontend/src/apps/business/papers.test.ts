import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { cleanHs, cleanPrefix, gs1Line, hsDisplay, invoiceBody, invoiceForm, invoiceGaps, invoiceTotals, labelsLine, money, ssccSpaced, type CommercialInvoice, type InvoiceForm } from './papers';

const filled = (over: Partial<InvoiceForm> = {}): InvoiceForm => ({
  number: 'INV-1',
  issuedOn: '2026-10-18',
  importerName: 'Kampala Build Co',
  importerAddress: '',
  importerCountry: 'UG',
  importerTaxNo: '',
  currency: 'usd',
  reason: 'sale',
  lines: [{ description: 'Clay bricks', quantity: '3000', netKg: '1050', unitValue: '0.12', originCountry: 'KE', hsCode: '6904.10' }],
  declare: true,
  ...over,
});

describe('a load’s papers in the Business app', () => {
  it('takes a GS1 prefix as people type it, and says what is set', () => {
    expect(cleanPrefix(' 616 1234 ')).toBe('6161234');
    expect(cleanPrefix('616')).toBeUndefined();
    expect(gs1Line({ companyPrefix: '6161234', extensionDigit: 3, left: 999_999_997, setAt: '', setBy: 'Achieng' }, t)).toBe('Prefix 6161234, extension digit 3 · 999,999,997 codes left');
  });

  it('says what the labels will carry, and why a package has no GS1 code', () => {
    expect(labelsLine({ freightId: 'f', labels: 3, packages: 3, codes: ['1', '2', '3'] }, true, t)).toBe('3 labels, each with its SSCC beside our code');
    expect(labelsLine({ freightId: 'f', labels: 2, packages: 2, codes: [] }, false, t)).toBe('2 labels with our code. Add your GS1 company prefix in Business details for an SSCC on each package.');
    expect(labelsLine({ freightId: 'f', labels: 2, packages: 2, codes: [] }, true, t)).toBe('2 labels with our code: this load was posted before your GS1 prefix was set, or for a client.');
    expect(labelsLine({ freightId: 'f', labels: 1, codes: [] }, true, t)).toBe('1 label with our code: SSCCs need the number of packages, given when the load is posted.');
    expect(ssccSpaced('361612340000000015', 7)).toBe('3 6161234 000000001 5');
  });

  it('adds up the lines as the form stands, and says every gap the server would refuse', () => {
    expect(invoiceTotals(filled())).toEqual({ value: 360, netKg: 1050 });
    expect(invoiceGaps(filled(), 1200)).toEqual([]);
    expect(invoiceGaps(filled({ number: ' ', importerCountry: '', currency: 'dollars', declare: false }), 1200)).toEqual(['number', 'importerCountry', 'currency', 'declare']);
    const bad = filled({ lines: [{ description: '', quantity: '2.5', netKg: '0', unitValue: '-1', originCountry: '', hsCode: '69' }] });
    expect(invoiceGaps(bad, 1200)).toEqual(['line.0.description', 'line.0.quantity', 'line.0.netKg', 'line.0.unitValue', 'line.0.originCountry', 'line.0.hsCode']);
    expect(invoiceGaps(filled(), 1000)).toEqual(['overweight']);
    expect(invoiceGaps(filled({ lines: [] }), 1200)).toEqual(['lines']);
  });

  it('sends the form as the server takes it, and starts a new invoice from the last one without the declaration', () => {
    expect(invoiceBody(filled())).toEqual({ number: 'INV-1', issuedOn: '2026-10-18', importer: { name: 'Kampala Build Co', country: 'UG' }, currency: 'USD', reason: 'sale', lines: [{ description: 'Clay bricks', quantity: 3000, netKg: 1050, unitValue: 0.12, originCountry: 'KE', hsCode: '6904.10' }], declare: true });
    const last = { number: 'INV-1', issuedOn: '2026-10-17', importer: { name: 'K', country: 'UG', taxNo: 'T' }, currency: 'USD', reason: 'sample', lines: [{ description: 'Bricks', quantity: 3, netKg: 4, unitValue: 5, lineValue: 15, originCountry: 'KE', hsCode: '690410' }] } as unknown as CommercialInvoice;
    const again = invoiceForm('2026-10-18', last);
    expect(again).toMatchObject({ number: 'INV-1', issuedOn: '2026-10-18', importerTaxNo: 'T', reason: 'sample', declare: false });
    expect(again.lines[0]).toEqual({ description: 'Bricks', quantity: '3', netKg: '4', unitValue: '5', originCountry: 'KE', hsCode: '6904.10' });
    expect(invoiceForm('2026-10-18', undefined, 'KE').lines[0].originCountry).toBe('KE');
  });

  it('reads HS codes the way people write them', () => {
    expect(cleanHs('8471.30.00')).toBe('84713000');
    expect(cleanHs('8471')).toBeUndefined();
    expect(hsDisplay('84713000')).toBe('8471.30.00');
    expect(money('USD', 1234.5)).toBe('USD 1,234.50');
  });
});
