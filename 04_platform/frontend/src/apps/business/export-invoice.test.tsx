import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ExportInvoice } from './screens/ExportInvoice';
import { invoiceBody, invoiceForm, moneyWords, type ExportDetail, type ExportInvoiceView, type SliDraft } from './exports';
import type { BusinessClient } from './api';

/*
 * THE COMMERCIAL INVOICE (the user, 2026-10-28: "a flexible document since it is virtually different in every nation"):
 * the core the same everywhere; what the destination asks for, in the exporter's own words, started from its last
 * invoice there.
 */
const view = (over: Partial<ExportInvoiceView> = {}): ExportInvoiceView => ({
  versions: [],
  totals: { lines: 2, goods: 7520, charges: 0, total: 7520, unvalued: 0, withoutHs: 0, withoutOrigin: 1 },
  gaps: ['Fill in the invoice'],
  notes: ['1 line has no country of origin — many destinations ask for it, line by line.'],
  stale: false,
  listColumns: ['Batch'],
  truth: 'I declare that the information on this invoice is true and correct, and that the contents of this shipment are as stated above.',
  currencyFromList: 'USD',
  ...over,
});
const letter = { consigneeKind: 'named', consignee: { name: 'Van Rees Fruit BV', address: 'Rotterdam' }, incoterm: 'FOB', incotermPlace: 'Mombasa', lines: [], savedAt: '', savedBy: '' } as unknown as SliDraft;
const template = { destCountry: 'NL', fieldLabels: ['Buyer’s EORI number', 'Order number'], declarations: ['Of Kenyan preferential origin.'], paymentTerms: 'Cash against documents', fromExport: 'EXP-003' };

describe('the invoice’s form', () => {
  it('starts from the letter’s consignee and trade term, the list’s currency — and the last invoice to the same country', () => {
    const f = invoiceForm(view({ template }), letter, '2026-10-28');
    expect(f).toMatchObject({ date: '2026-10-28', currency: 'USD', incoterm: 'FOB', incotermPlace: 'Mombasa', paymentTerms: 'Cash against documents', consigneeIsBuyer: true, buyer: { name: 'Van Rees Fruit BV', address: 'Rotterdam' } });
    expect(f.fields).toEqual([{ label: 'Buyer’s EORI number', value: '' }, { label: 'Order number', value: '' }]);
    expect(f.declarations).toEqual(['Of Kenyan preferential origin.']);
  });

  it('sends no empty row, amounts as numbers', () => {
    const f = invoiceForm(view(), undefined, '2026-10-28');
    const body = invoiceBody({ ...f, number: ' TA-117 ', charges: [{ label: 'Freight', amount: '1200' }, { label: '', amount: '5' }], fields: [{ label: 'Order number', value: 'PO-4471' }, { label: ' ', value: 'x' }], declarations: ['  ', 'Of Kenyan origin.'] });
    expect(body).toMatchObject({ number: 'TA-117', currency: 'USD', charges: [{ label: 'Freight', amount: 1200 }], fields: [{ label: 'Order number', value: 'PO-4471' }], declarations: ['Of Kenyan origin.'] });
    expect(moneyWords('USD', 7970)).toBe('USD 7,970.00');
  });
});

const detail = (inv: ExportInvoiceView): ExportDetail =>
  ({
    consignment: { exportId: 'exp_1', code: 'EXP-007', destCountry: 'NL', goodsDescription: 'Avocados', loadingPort: 'Mombasa', booking: { reference: 'MBA4471', partyName: 'Pwani Forwarders' } },
    exporterName: 'Thika Avocados',
    sli: { versions: [], gaps: [], stale: false, hazardous: false, fromPacking: false, draft: letter },
    invoice: inv,
  }) as unknown as ExportDetail;
const render = (d: ExportDetail, mine = true) => renderToString(<ExportInvoice d={d} client={{} as BusinessClient} mine={mine} signatory="Wanjiku Mwangi" onDetail={() => undefined} />);
const field = (key: Parameters<typeof t>[0], vars?: Record<string, unknown>) => `<span class="cfield__label">${t(key, vars as never)}</span>`;

describe('the invoice on the export, from each side', () => {
  it('offers the exporter the core and the rest for the destination by name — started from its last invoice there', () => {
    const html = render(detail(view({ template })));
    for (const k of ['business.exports.invoice.number', 'business.exports.invoice.currency', 'business.exports.invoice.buyerName', 'business.exports.invoice.buyerTax'] as const) expect(html).toContain(field(k));
    expect(html).toContain(t('business.exports.invoice.particulars', { country: 'Netherlands' }));
    expect(html).toContain(t('business.exports.invoice.fromTemplate', { country: 'Netherlands', code: 'EXP-003' }));
    expect(html).toContain('Buyer’s EORI number');
    expect(html).toContain('Of Kenyan preferential origin.');
    expect(html).toContain('2 lines from your packing list · goods USD 7,520.00 · total USD 7,520.00');
    expect(html).toContain('1 line has no country of origin');
    // The list's own columns, to print on the invoice if the destination wants them.
    expect(html).toContain('Batch');
    expect(html).toContain(t('business.exports.sli.sign', { n: 1 }));
    // Payment terms, the trade term and the currency are chosen in the console's own picker, never typed.
    for (const k of ['business.exports.invoice.paymentTerms', 'business.exports.sli.incoterm', 'business.exports.invoice.currency'] as const) expect(html).toContain(t(k));
  });

  it('keeps the exporter’s own payment terms in their own field', () => {
    const own = view({ draft: { number: 'TA-1', date: '2026-10-28', currency: 'USD', reason: 'sale', paymentTerms: '50% in advance, 50% against documents', charges: [], fields: [], declarations: [], columns: [], savedAt: '', savedBy: '' } });
    const html = render(detail(own));
    expect(html).toContain(field('business.exports.invoice.termsOther'));
    expect(html).toContain('50% in advance, 50% against documents');
  });

  it('once signed, lists the versions with their totals; out of date is said', () => {
    const signed = view({ versions: [{ version: 1, signedBy: 'Wanjiku Mwangi', signedAt: '2026-10-28T12:00:00.000Z', fingerprint: 'a'.repeat(64), total: 7970, currency: 'USD' }], gaps: [] });
    const html = render(detail(signed));
    expect(html).toContain('total USD 7,970.00');
    expect(html).toContain(t('business.exports.invoice.change'));
    expect(render(detail({ ...signed, stale: true }))).toContain(t('business.exports.invoice.stale', { n: 1 }));
  });

  it('offers its agent the signed versions only — no form, no notes, no signing', () => {
    const html = render(detail(view()), false);
    expect(html).toContain(t('business.exports.invoice.noneYet'));
    expect(html).not.toContain(field('business.exports.invoice.number'));
    expect(html).not.toContain('1 line has no country of origin');
  });
});
