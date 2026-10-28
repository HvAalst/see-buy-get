import { cleanInvoice, INVOICE_TRUTH, invoiceBasis, invoiceGaps, invoiceHtml, invoiceNotes, invoiceTotals, lineValueOf, unitPriceOf } from './export-invoice';
import type { PackingLine } from './export-packing.types';
import type { SliFacts } from './export-sli';

/*
 * THE COMMERCIAL INVOICE ON AN EXPORT (the user, 2026-10-28: "a flexible document since it is virtually different in
 * every nation"): a fixed core every invoice carries, the rest in the exporter's own words — and its lines the packing
 * list's.
 */
const at = Date.parse('2026-10-28T10:00:00Z');
const lines: PackingLine[] = [
  { marks: '1-800', description: 'Fresh avocados, Hass', hsCode: '080440', originCountry: 'KE', quantity: 3200, unit: 'kg', packages: 800, packageKind: 'cartons', unitPrice: 2.15, netKg: 3200, grossKg: 3600, extra: { Batch: 'B-0911' } },
  { marks: '801-900', description: 'Fresh avocados, Fuerte', packages: 100, packageKind: 'cartons', lineValue: 640, grossKg: 450 },
];
const facts: SliFacts = {
  code: 'EXP-007',
  shipper: { name: 'Thika Avocados', address: 'Box 1, Thika', registrationNo: 'PVT-1', taxNo: 'P051', country: 'KE' },
  forwarder: 'Pwani Forwarders',
  bookedWith: 'forwarder',
  booking: 'MBA4471',
  vessel: 'MSC Nairobi',
  loadingPort: 'Mombasa',
  terminal: 'Kipevu',
  originCountry: 'KE',
  destCountry: 'NL',
  container: { number: 'MSCU1234566', type: '45R1', seals: [] },
  papers: [],
};

describe('the commercial invoice on an export', () => {
  it('values a line by its own value, or its unit price times its quantity — or its packages, where no quantity is said', () => {
    expect(lineValueOf(lines[0])).toBe(6880);
    expect(lineValueOf(lines[1])).toBe(640);
    expect(lineValueOf({ description: 'x', packages: 10, unitPrice: 4.5 })).toBe(45);
    expect(lineValueOf({ description: 'x', packages: 10 })).toBeUndefined();
    expect(unitPriceOf(lines[1])).toBe(6.4);
  });

  it('adds the charges to the goods, and counts what is unvalued, without an HS code or an origin', () => {
    const t = invoiceTotals([...lines, { description: 'Samples', packages: 1 }], { charges: [{ label: 'Freight', amount: 1200 }, { label: 'Discount', amount: -100 }] });
    expect(t).toEqual({ lines: 3, goods: 7520, charges: 1100, total: 8620, unvalued: 1, withoutHs: 2, withoutOrigin: 2 });
  });

  it('cleans the form: the currency as three letters, our declaration never twice, an asked-for field kept while empty', () => {
    const d = cleanInvoice({ number: ' TA-117 ', currency: 'usd', date: 'soon', declarations: [INVOICE_TRUTH, 'Of Kenyan preferential origin.'], fields: [{ label: 'Buyer’s EORI number', value: '' }, { label: ' ', value: 'x' }], charges: [{ label: 'Freight', amount: 0 }] }, 'Wanjiku', at);
    expect(d).toMatchObject({ number: 'TA-117', currency: 'USD', date: '2026-10-28', declarations: ['Of Kenyan preferential origin.'], fields: [{ label: 'Buyer’s EORI number', value: '' }], charges: [], reason: 'sale' });
  });

  it('takes only a currency that exists — one some country settles in', () => {
    expect(cleanInvoice({ currency: 'kes' }, 'W', at).currency).toBe('KES');
    expect(cleanInvoice({ currency: 'KSH' }, 'W', at).currency).toBe('');
    expect(cleanInvoice({ currency: 'XYZ' }, 'W', at).currency).toBe('');
  });

  it('refuses to sign only what no invoice anywhere goes without', () => {
    expect(invoiceGaps(undefined, [])).toEqual(['Bring in the packing list: the invoice’s lines are its lines']);
    expect(invoiceGaps(undefined, lines)).toEqual(['Fill in the invoice']);
    const bare = cleanInvoice({}, 'W', at);
    expect(invoiceGaps(bare, [...lines, { description: 'Samples', packages: 1 }])).toEqual(['The invoice’s number', 'The currency, chosen from the list', 'The buyer’s name and address', '1 line with no value — bring in your list with a unit price or a value column']);
    expect(invoiceGaps(cleanInvoice({ number: 'TA-117', currency: 'USD', buyer: { name: 'Van Rees', address: 'Rotterdam' } }, 'W', at), lines)).toEqual([]);
  });

  it('says — never refuses — what many destinations ask for and this one does not carry', () => {
    const d = cleanInvoice({ fields: [{ label: 'Buyer’s EORI number', value: '' }] }, 'W', at);
    const notes = invoiceNotes(d, invoiceTotals(lines), { destCountry: 'NL', fieldLabels: ['Buyer’s EORI number'], declarations: [], fromExport: 'EXP-001' }, 'NL');
    expect(notes).toEqual([
      '1 line has no HS code — many destinations ask for one on the invoice.',
      '1 line has no country of origin — many destinations ask for it, line by line.',
      'Empty, and not printed: Buyer’s EORI number — your last invoice with Netherlands as its destination carried it.',
    ]);
  });

  it('prints the core, the particulars that are filled, the declarations, and the columns chosen; a changed line is a changed basis', () => {
    const d = cleanInvoice({ number: 'TA-117', currency: 'USD', incoterm: 'FOB', incotermPlace: 'Mombasa', buyer: { name: 'Van Rees Fruit BV', address: 'Rotterdam', taxId: 'NL123456789B01' }, charges: [{ label: 'Freight', amount: 1200 }], fields: [{ label: 'Order number', value: 'PO-4471' }, { label: 'Import licence', value: '' }], declarations: ['Of Kenyan preferential origin.'], columns: ['Batch'] }, 'W', at);
    const html = invoiceHtml(facts, 'To order', d, lines, { version: 1, signedBy: 'Wanjiku', signedAt: '2026-10-28T10:00:00.000Z' });
    for (const fact of ['Commercial invoice TA-117 — EXP-007 — version 1', 'Van Rees Fruit BV', 'NL123456789B01', 'FOB Mombasa', '6,880.00', '640.00', '8,720.00', 'Freight', 'PO-4471', 'Of Kenyan preferential origin.', INVOICE_TRUTH, 'B-0911', '0804.40', 'Tax number P051']) expect(html).toContain(fact);
    expect(html).not.toContain('Import licence');
    expect(invoiceBasis(lines)).not.toBe(invoiceBasis([{ ...lines[0], unitPrice: 2.2 }, lines[1]]));
  });
});
