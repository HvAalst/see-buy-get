import { fiscalWayOf } from '../../foundation/fiscal/fiscal-ways';
import { bandFor, cuInvoiceNo, dashed, kenyaStamp, saleRequest, verifyUrl } from './etims';
import type { FiscalInvoice } from './fiscal-invoice.types';

/** KRA eTIMS, built to KRA's interface (OSCU v2.0) and never sent until the company is registered. */
describe('KRA eTIMS', () => {
  it('is Kenya’s and no other country’s (the user, 2026-10-18)', () => {
    expect(fiscalWayOf('KE')).toBe('etims');
    expect(fiscalWayOf('ke')).toBe('etims');
    for (const c of ['TZ', 'UG', 'RW', 'ET', 'NL', 'DE', '', undefined]) expect(fiscalWayOf(c)).toBeUndefined();
  });

  it('puts a charge in the band of the tax actually charged on it — and none for a rate eTIMS has no band for', () => {
    expect(bandFor(100, 16)).toBe('B');
    expect(bandFor(4.4, 0.7)).toBe('B'); // rounded to the cent
    expect(bandFor(100, 8)).toBe('E');
    expect(bandFor(100, 0)).toBe('D');
    expect(bandFor(100, 18)).toBeUndefined();
  });

  it('dates a sale on Kenya’s clock, as KRA reads it', () => {
    expect(kenyaStamp('2026-10-18T22:30:05.000Z')).toEqual({ dateTime: '20261019013005', date: '20261019' });
  });

  const sale: FiscalInvoice = {
    invoiceId: 'fi_1',
    entityId: 'sbg-ke',
    seller: 'SeeBuyGet Kenya',
    sellerPin: 'P051234567X',
    country: 'KE',
    number: 41,
    kind: 'sale',
    entryId: 'je_1',
    ref: 'PUD-1',
    buyer: { kind: 'store', id: 'vnd_1', name: 'Duka la Mama' },
    line: { description: 'Parcel carriage PUD-1', net: 100, tax: 16, gross: 116, band: 'B', ratePct: 16 },
    currency: 'KES',
    paidBy: 'prepaid',
    at: '2026-10-18T07:00:00.000Z',
    etims: { state: 'waiting', tries: 0 },
  };
  const branch = { tin: 'P051234567X', bhfId: '00' };
  const item = { itemCd: 'KE3NTU0000001', itemClsCd: '7810220000' };

  it('records a sale in the shape KRA documents: every band sent, the tax in its own band, one service line', () => {
    const body = saleRequest(sale, branch, item);
    expect(body).toMatchObject({
      tin: 'P051234567X',
      bhfId: '00',
      trdInvcNo: 'fi_1',
      invcNo: 41,
      orgInvcNo: 0,
      custTin: null,
      custNm: 'Duka la Mama',
      salesTyCd: 'N',
      rcptTyCd: 'S',
      pmtTyCd: '07',
      salesSttsCd: '02',
      cfmDt: '20261018100000',
      salesDt: '20261018',
      totItemCnt: 1,
      // KRA's sample: the taxable amount includes the tax.
      taxblAmtB: 116,
      taxRtB: 16,
      taxAmtB: 16,
      taxblAmtA: 0,
      taxRtE: 8,
      totTaxblAmt: 116,
      totTaxAmt: 16,
      totAmt: 116,
    });
    expect((body.itemList as Array<Record<string, unknown>>)[0]).toMatchObject({ itemSeq: 1, itemCd: 'KE3NTU0000001', itemClsCd: '7810220000', pkgUnitCd: 'NT', qtyUnitCd: 'U', qty: 1, prc: 116, taxTyCd: 'B', taxblAmt: 116, taxAmt: 16, totAmt: 116 });
    // The other reading, a setting until KRA's sandbox settles it: the taxable amount without the tax.
    expect(saleRequest(sale, branch, item, 'net')).toMatchObject({ taxblAmtB: 100, totTaxblAmt: 100, totAmt: 116 });
  });

  it('records a credit note against the number of the sale it gives back, as a refund', () => {
    const body = saleRequest({ ...sale, invoiceId: 'fi_2', number: 42, kind: 'credit', originalNumber: 41, buyer: { kind: 'person', name: 'Cash sale' }, paidBy: 'cash' }, branch, item);
    expect(body).toMatchObject({ invcNo: 42, orgInvcNo: 41, rcptTyCd: 'R', rfdRsnCd: '06', rfdDt: '20261018100000', pmtTyCd: '01' });
  });

  it('prints what KRA requires: the CU invoice number, dashed internal data and signature, and a QR that checks it', () => {
    const receipt = { curRcptNo: 259, sdcId: 'KRACU0100000001', rcptSign: 'ABCDEFGHIJKLMNOP' };
    expect(cuInvoiceNo(receipt)).toBe('KRACU0100000001/259');
    expect(dashed('ABCDEFGHIJKLMNOP')).toBe('ABCD-EFGH-IJKL-MNOP');
    expect(verifyUrl(branch, receipt, 'production')).toBe('https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567X00ABCDEFGHIJKLMNOP');
    expect(verifyUrl(branch, receipt, 'sandbox')).toMatch(/^https:\/\/etims-sbx\.kra\.go\.ke\//);
  });
});
