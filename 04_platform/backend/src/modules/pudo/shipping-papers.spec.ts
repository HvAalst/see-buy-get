import { isSscc, ssccOf } from '../../foundation/gs1/gs1';
import { Entity } from '../../foundation/entity/entity.types';
import { CommercialInvoiceService, InvoiceInput, cleanHsCode, crossesBorder, hsDisplay } from './commercial-invoice.service';
import { Freight } from './dispatch.types';
import { packageLabelsHtml } from './package-labels';
import { ShipperCodesService } from './shipper-codes.service';

const business = (over: Partial<Entity> = {}): Entity => ({ entityId: 'biz-jenga', did: 'did:glos:biz-jenga', kind: 'business', name: 'Jenga Bricks Ltd', jurisdiction: 'KE', business: { activities: ['shipper'], registrationNo: 'PVT-1', taxNo: 'P051234567X', createdBy: 'Achieng', createdByPersonDid: 'did:p', verification: { state: 'verified' } }, createdAt: '2026-10-01T00:00:00Z', ...over }) as unknown as Entity;

const load = (over: Partial<Freight> = {}): Freight =>
  ({ freightId: 'frt_1', code: 'FRT-101', description: 'Clay bricks', pickupLabel: 'Jenga yard, Athi River', destLabel: 'Kampala depot', weightKg: 1200, packages: 4, status: 'available', postedByDid: 'did:glos:biz-jenga', pickupCountry: 'KE', destCountry: 'UG', incoterm: 'DAP', namedPlace: 'Kampala', ...over }) as unknown as Freight;

const input = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  number: 'INV-2026-0042',
  issuedOn: '2026-10-18',
  importer: { name: 'Kampala Build Co', address: 'Plot 4, Industrial Area', country: 'ug', taxNo: 'TIN-77' },
  currency: 'usd',
  reason: 'sale',
  lines: [
    { description: 'Clay bricks, fired', quantity: 4000, netKg: 900, unitValue: 0.12, originCountry: 'KE', hsCode: '6904.10' },
    { description: 'Pallets, wooden', quantity: 4, netKg: 80, unitValue: 9.5, originCountry: 'ke', hsCode: '4415 20 00' },
  ],
  declare: true,
  ...over,
});

describe('a shipper’s own GS1 codes', () => {
  it('keeps a prefix only as GS1 gives one, with an extension digit of 0 to 9', () => {
    const codes = new ShipperCodesService();
    expect(() => codes.set('biz', { companyPrefix: '61612', extensionDigit: 0 }, 'Achieng')).toThrow(/6 to 12 digits/);
    expect(() => codes.set('biz', { companyPrefix: '6161234', extensionDigit: 12 }, 'Achieng')).toThrow(/0 to 9/);
    expect(codes.set('biz', { companyPrefix: '616 1234', extensionDigit: 3 }, 'Achieng')).toMatchObject({ companyPrefix: '6161234', extensionDigit: 3, setBy: 'Achieng' });
    expect(codes.left('biz')).toBe(1_000_000_000);
  });

  it('gives each package of a load its own SSCC, once, and never the same code twice', () => {
    const codes = new ShipperCodesService();
    codes.set('biz', { companyPrefix: '6161234', extensionDigit: 3 }, 'Achieng');
    const first = codes.issue('frt_1', 'biz', 3)!;
    expect(first.codes).toEqual([ssccOf('6161234', 3, 0), ssccOf('6161234', 3, 1), ssccOf('6161234', 3, 2)]);
    expect(first.codes.every(isSscc)).toBe(true);
    // Asked again, the same codes: a load's labels never change.
    expect(codes.issue('frt_1', 'biz', 3)!.codes).toEqual(first.codes);
    const second = codes.issue('frt_2', 'biz', 2)!;
    expect(second.codes[0]).toBe(ssccOf('6161234', 3, 3));
    expect(codes.freightOfSscc(second.codes[1])).toBe('frt_2');
  });

  it('carries on where it left off when a business goes back to an earlier prefix or digit', () => {
    const codes = new ShipperCodesService();
    codes.set('biz', { companyPrefix: '6161234', extensionDigit: 3 }, 'Achieng');
    codes.issue('frt_1', 'biz', 2);
    codes.set('biz', { companyPrefix: '6161234', extensionDigit: 4 }, 'Achieng');
    expect(codes.issue('frt_2', 'biz', 1)!.codes[0]).toBe(ssccOf('6161234', 4, 0));
    codes.set('biz', { companyPrefix: '6161234', extensionDigit: 3 }, 'Achieng');
    expect(codes.issue('frt_3', 'biz', 1)!.codes[0]).toBe(ssccOf('6161234', 3, 2));
  });

  it('refuses before a load is posted when its packages cannot all be coded, and keeps a load’s codes when the prefix is cleared', () => {
    const codes = new ShipperCodesService();
    codes.set('biz', { companyPrefix: '616123456789', extensionDigit: 0 }, 'Achieng'); // 12 digits: 10,000 serials
    codes.issue('frt_1', 'biz', 500);
    expect(codes.left('biz')).toBe(9_500);
    expect(() => codes.assertCanIssue('biz', 501)).toThrow(/Up to 500/);
    expect(() => codes.assertCanIssue(undefined, 400)).not.toThrow();
    codes.set('biz', null, 'Achieng');
    expect(codes.of('biz')).toBeUndefined();
    expect(codes.issue('frt_2', 'biz', 2)).toBeUndefined();
    expect(codes.codesFor('frt_1')!.codes).toHaveLength(500);
  });

  it('says so, before a load is posted, when the prefix and digit have no codes left — and names another digit', () => {
    const codes = new ShipperCodesService();
    codes.set('biz', { companyPrefix: '616123456789', extensionDigit: 7 }, 'Achieng'); // 12 digits: 10,000 serials
    for (let n = 0; n < 20; n++) codes.issue(`frt_${n}`, 'biz', 500);
    expect(codes.left('biz')).toBe(0);
    expect(() => codes.assertCanIssue('biz', 1)).toThrow(/Only 0 GS1 codes are left under extension digit 7/);
    expect(() => codes.issue('frt_more', 'biz', 1)).toThrow(/Choose another extension digit/);
    codes.set('biz', { companyPrefix: '616123456789', extensionDigit: 8 }, 'Achieng');
    expect(codes.issue('frt_more', 'biz', 1)!.codes[0]).toBe(ssccOf('616123456789', 8, 0));
  });

  it('gives nothing to a business without a prefix, or to a load without a number of packages', () => {
    const codes = new ShipperCodesService();
    expect(codes.issue('frt_1', 'biz', 3)).toBeUndefined();
    codes.set('biz', { companyPrefix: '6161234', extensionDigit: 0 }, 'Achieng');
    expect(codes.issue('frt_1', 'biz', undefined)).toBeUndefined();
  });
});

describe('the commercial invoice', () => {
  it('is written from the shipper’s lines: values per item and per line, net weights, origins and its own HS codes', () => {
    const invoices = new CommercialInvoiceService();
    const i = invoices.issue(load(), { entity: business(), name: 'Achieng' }, input(), Date.parse('2026-10-18T09:00:00Z'));
    expect(i).toMatchObject({ number: 'INV-2026-0042', currency: 'USD', totalValue: 518, totalNetKg: 980, grossKg: 1200, packages: 4, incoterm: 'DAP', namedPlace: 'Kampala', copies: 3, reason: 'sale' });
    expect(i.lines[0]).toMatchObject({ quantity: 4000, unitValue: 0.12, lineValue: 480, originCountry: 'KE', hsCode: '690410' });
    expect(i.lines[1]).toMatchObject({ lineValue: 38, hsCode: '44152000' });
    expect(i.exporter).toEqual({ name: 'Jenga Bricks Ltd', address: 'Jenga yard, Athi River', country: 'KE', taxNo: 'P051234567X' });
    expect(i.importer).toEqual({ name: 'Kampala Build Co', address: 'Plot 4, Industrial Area', country: 'UG', taxNo: 'TIN-77' });
    expect(i.signed).toEqual({ name: 'Achieng', for: 'Jenga Bricks Ltd', at: '2026-10-18T09:00:00.000Z' });
    expect(i.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(invoices.noteLine('frt_1')).toBe('Commercial invoice INV-2026-0042 of 2026-10-18, 3 copies');
  });

  it('refuses what customs would stop, each in words, and keeps nothing', () => {
    const invoices = new CommercialInvoiceService();
    const sign = (over: Partial<InvoiceInput>, f: Partial<Freight> = {}) => () => invoices.issue(load(f), { entity: business(), name: 'Achieng' }, input(over));
    expect(sign({ declare: false })).toThrow(/declaration/);
    expect(sign({ number: '  ' })).toThrow(/your own number/);
    expect(sign({ currency: 'dollars' })).toThrow(/three letters/);
    expect(sign({ importer: { name: 'X', country: 'ZZ' } })).toThrow(/country of the buyer/);
    expect(sign({ lines: [] })).toThrow(/at least one line/);
    expect(sign({ lines: [{ ...input().lines[0], hsCode: '69' }] })).toThrow(/Line 1: the HS code is 6 to 10 digits/);
    expect(sign({ lines: [{ ...input().lines[0], originCountry: 'XX' }] })).toThrow(/Line 1: choose the country/);
    expect(sign({ lines: [{ ...input().lines[0], quantity: 2.5 }] })).toThrow(/whole number/);
    expect(sign({ lines: [{ ...input().lines[0], netKg: 1300 }] })).toThrow(/1300 kg net on the invoice, more than the load's 1200 kg gross/);
    expect(sign({}, { status: 'delivered' })).toThrow(/delivered/);
    expect(sign({}, { status: 'cancelled' })).toThrow(/cancelled/);
    expect(sign({}, { postedByDid: 'did:glos:somebody-else' })).toThrow(/business that posted the load/);
    expect(invoices.all('frt_1')).toHaveLength(0);
  });

  it('is never changed: a new one takes its place, and the one it replaced stays on the record, marked', () => {
    const invoices = new CommercialInvoiceService();
    const first = invoices.issue(load(), { entity: business(), name: 'Achieng' }, input(), Date.parse('2026-10-18T09:00:00Z'));
    const second = invoices.issue(load(), { entity: business(), name: 'Otieno' }, input({ number: 'INV-2026-0043' }), Date.parse('2026-10-18T10:00:00Z'));
    expect(second.supersedes).toBe(first.invoiceId);
    expect(invoices.current('frt_1')!.invoiceId).toBe(second.invoiceId);
    const view = invoices.view(load(), true);
    expect(view.crossesBorder).toBe(true);
    expect(view.earlier).toEqual([{ invoiceId: first.invoiceId, number: 'INV-2026-0042', issuedOn: '2026-10-18', signedBy: 'Achieng', signedAt: '2026-10-18T09:00:00.000Z', supersededAt: '2026-10-18T10:00:00.000Z' }]);
    // The replaced one is kept as it was signed: its fingerprint is still the fingerprint of what it says.
    expect(invoices.all('frt_1').find((i) => i.invoiceId === first.invoiceId)!.fingerprint).toBe(first.fingerprint);
  });

  it('prints three copies, one a page, each saying which it is, with the shipper’s HS codes and the pouch', () => {
    const invoices = new CommercialInvoiceService();
    const html = invoices.htmlFor(invoices.issue(load(), { entity: business(), name: 'Achieng' }, input()));
    expect((html.match(/<section class="copy">/g) ?? []).length).toBe(3);
    for (const n of [1, 2, 3]) expect(html).toContain(`Copy ${n} of 3`);
    expect(html).toContain('6904.10');
    expect(html).toContain('4415.20.00');
    expect(html).toContain('USD 518.00');
    expect(html).toContain('SeeBuyGet does not classify goods');
    expect(html).toContain('All 3 copies go in a clear pouch on the outside of package 1');
    expect(html).toContain('Signed electronically</b> by Achieng for Jenga Bricks Ltd');
    expect(html).toContain('.copy + .copy { break-before: page; }');
  });

  it('reads HS codes the way people write them, and knows a load crossing a border', () => {
    expect(cleanHsCode('8471.30.00')).toBe('84713000');
    expect(cleanHsCode('8471')).toBeUndefined();
    expect(cleanHsCode('84713000001')).toBeUndefined();
    expect(hsDisplay('847130')).toBe('8471.30');
    expect(crossesBorder({ pickupCountry: 'KE', destCountry: 'UG' })).toBe(true);
    expect(crossesBorder({ pickupCountry: 'KE', destCountry: 'KE' })).toBe(false);
    expect(crossesBorder({ pickupCountry: 'KE' })).toBe(false);
  });
});

describe('the package labels', () => {
  const base = { loadCode: 'FRT-101', description: 'Clay bricks', trackingKey: 'T-ABCDE', trackingUrl: 'https://seebuyget.com/send/?track=T-ABCDE', from: { name: 'Jenga Bricks Ltd', place: 'Athi River', country: 'Kenya' }, to: { name: 'Kampala Build Co', place: 'Kampala depot', country: 'Uganda' }, grossKg: 1200, marks: ['Fragile'] };

  it('prints one label a package, ours on top and the GS1-128 barcode with its SSCC below', () => {
    const codes = [ssccOf('6161234', 3, 0), ssccOf('6161234', 3, 1), ssccOf('6161234', 3, 2)];
    const html = packageLabelsHtml({ ...base, packages: 3, codes, companyPrefixLength: 7, papers: 'In the pouch: commercial invoice INV-1, 3 copies' });
    expect((html.match(/<svg class="label"/g) ?? []).length).toBe(3);
    expect(html).toContain('Package 2 of 3');
    for (const c of codes) expect(html).toContain(`(00) ${c}`);
    expect(html).toContain(`3 6161234 000000000 ${codes[0][17]}`);
    expect(html).toContain('@page { size: 100mm 150mm; margin: 0; }');
    // The papers are said once, on the package the pouch is on.
    expect((html.match(/In the pouch/g) ?? []).length).toBe(1);
  });

  it('is ours alone without a shipper’s GS1 codes, and one label for a load whose packages were not counted', () => {
    const html = packageLabelsHtml({ ...base, codes: [] });
    expect((html.match(/<svg class="label"/g) ?? []).length).toBe(1);
    expect(html).toContain('Package 1 of 1');
    expect(html).not.toContain('SSCC');
    expect(html).toContain('FRT-101');
    // Addressed to a place with no named receiver: the place once, then its country.
    const toPlace = packageLabelsHtml({ ...base, to: { name: 'Kampala depot', place: 'Kampala depot', country: 'Uganda' }, codes: [] });
    expect(toPlace.match(/Kampala depot/g)).toHaveLength(1);
    expect(toPlace).toContain('>Uganda<');
  });
});
