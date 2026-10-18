import type { EtimsReceipt, EtimsTaxBand, FiscalInvoice } from './fiscal-invoice.types';

/**
 * KRA eTIMS, OSCU — the request a sale is recorded with, built to KRA's published interface (OSCU Specification v2.0,
 * April 2023; TIS v2.0) and NEVER SENT until the Kenyan company is registered (the user, 2026-10-18). Pure: what goes
 * on the wire is decided here, and tested here, apart from whoever sends it. See 05_engineering/etims.md.
 *
 * Two things KRA's own documents contradict are settings, to be settled in KRA's sandbox before going live:
 *   - whether the taxable amount INCLUDES the tax (KRA's sample: yes — taxblAmtB 10500, taxAmtB = 10500×18/118) or
 *     is the price without it (some integrators); `taxable: 'gross' | 'net'`, KRA's sample by default;
 *   - credit notes are sent with positive amounts, as one published client does.
 */

/** The rates KRA's bands carry (§4): A exempt, B 16%, C zero-rated, D non-VAT, E 8%. Read live from /selectCodeList once registered. */
export const BAND_RATES: Readonly<Record<EtimsTaxBand, number>> = { A: 0, B: 16, C: 0, D: 0, E: 8 };

/**
 * The band a charge falls in, from the tax actually charged on it: 16% → B, 8% → E. A charge with no tax is NON-VAT
 * (D): the company charges VAT only once it is registered for it (entity.service setTax). Any other rate has no band
 * in eTIMS and is not sent — said, never forced into the nearest one.
 */
export function bandFor(net: number, tax: number): EtimsTaxBand | undefined {
  if (tax <= 0) return 'D';
  if (net <= 0) return undefined;
  const pct = (tax / net) * 100;
  if (Math.abs(pct - 16) < 0.6) return 'B';
  if (Math.abs(pct - 8) < 0.6) return 'E';
  return undefined;
}

/** KRA's dates are Kenya's clock (East Africa Time, UTC+3, no daylight saving): yyyyMMddhhmmss and yyyyMMdd. */
export function kenyaStamp(iso: string): { dateTime: string; date: string } {
  const t = new Date(Date.parse(iso) + 3 * 3_600_000);
  const two = (n: number) => String(n).padStart(2, '0');
  const date = `${t.getUTCFullYear()}${two(t.getUTCMonth() + 1)}${two(t.getUTCDate())}`;
  return { date, dateTime: `${date}${two(t.getUTCHours())}${two(t.getUTCMinutes())}${two(t.getUTCSeconds())}` };
}

export interface EtimsBranch {
  /** The company's KRA PIN, and its branch (00 is the head office). */
  tin: string;
  bhfId: string;
}

export interface EtimsItem {
  /** The service as registered with /saveItem, and its classification from /selectItemClsList (courier services). */
  itemCd: string;
  itemClsCd: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const cut = (s: string | undefined, n: number) => (s ? s.slice(0, n) : null);

/** The body of POST /saveTrnsSalesOsdc for one invoice (OSCU §3.3.6.1): one service line, every band sent. */
export function saleRequest(inv: FiscalInvoice, branch: EtimsBranch, item: EtimsItem, taxable: 'gross' | 'net' = 'gross'): Record<string, unknown> {
  const { dateTime, date } = kenyaStamp(inv.at);
  const credit = inv.kind === 'credit';
  const amount = taxable === 'gross' ? inv.line.gross : inv.line.net;
  const bands = (['A', 'B', 'C', 'D', 'E'] as const).reduce<Record<string, number>>((acc, b) => {
    const mine = b === inv.line.band;
    acc[`taxblAmt${b}`] = mine ? round2(amount) : 0;
    acc[`taxRt${b}`] = BAND_RATES[b];
    acc[`taxAmt${b}`] = mine ? round2(inv.line.tax) : 0;
    return acc;
  }, {});
  const custTin = inv.buyer.pin ?? null;
  return {
    tin: branch.tin,
    bhfId: branch.bhfId,
    trdInvcNo: inv.invoiceId,
    invcNo: inv.number,
    orgInvcNo: credit ? (inv.originalNumber ?? 0) : 0,
    custTin,
    custNm: cut(inv.buyer.name, 60),
    salesTyCd: 'N',
    rcptTyCd: credit ? 'R' : 'S',
    // A person paid cash at the counter; a shop or a store paid from money it holds with us.
    pmtTyCd: inv.paidBy === 'cash' ? '01' : '07',
    salesSttsCd: '02',
    cfmDt: dateTime,
    salesDt: date,
    stockRlsDt: null,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: credit ? dateTime : null,
    rfdRsnCd: credit ? '06' : null,
    totItemCnt: 1,
    ...bands,
    totTaxblAmt: round2(amount),
    totTaxAmt: round2(inv.line.tax),
    totAmt: round2(inv.line.gross),
    prchrAcptcYn: 'N',
    remark: cut(inv.ref ? `${inv.line.description}` : inv.line.description, 400),
    regrId: 'SeeBuyGet',
    regrNm: 'SeeBuyGet',
    modrId: 'SeeBuyGet',
    modrNm: 'SeeBuyGet',
    receipt: {
      custTin,
      custMblNo: null,
      rcptPbctDt: dateTime,
      trdeNm: cut(inv.seller, 20),
      adrs: null,
      topMsg: null,
      btmMsg: null,
      prchrAcptcYn: 'N',
    },
    itemList: [
      {
        itemSeq: 1,
        itemClsCd: item.itemClsCd,
        itemCd: item.itemCd,
        itemNm: cut(inv.line.description, 200),
        bcd: null,
        pkgUnitCd: 'NT',
        pkg: 1,
        qtyUnitCd: 'U',
        qty: 1,
        prc: round2(amount),
        splyAmt: round2(amount),
        dcRt: 0,
        dcAmt: 0,
        isrccCd: null,
        isrccNm: null,
        isrcRt: null,
        isrcAmt: null,
        taxTyCd: inv.line.band,
        taxblAmt: round2(amount),
        taxAmt: round2(inv.line.tax),
        totAmt: round2(inv.line.gross),
      },
    ],
  };
}

/**
 * The address the QR code on an invoice carries, where a buyer checks it with KRA: the company's PIN, its branch and
 * the receipt signature (the form published clients use; KRA's own sample misspells the page, which is gone).
 */
export function verifyUrl(branch: EtimsBranch, receipt: Pick<EtimsReceipt, 'rcptSign'>, env: 'sandbox' | 'production'): string {
  const host = env === 'production' ? 'etims.kra.go.ke' : 'etims-sbx.kra.go.ke';
  return `https://${host}/common/link/etims/receipt/indexEtimsReceiptData?Data=${branch.tin}${branch.bhfId}${receipt.rcptSign}`;
}

/** Internal data and the receipt signature are printed with a dash after every fourth character (TIS §6.23). */
export function dashed(s: string): string {
  return (s.match(/.{1,4}/g) ?? []).join('-');
}

/** "KRACU0100000001/259": the CU ID and KRA's receipt number, as the invoice prints it. */
export function cuInvoiceNo(receipt: Pick<EtimsReceipt, 'sdcId' | 'curRcptNo'>): string {
  return `${receipt.sdcId}/${receipt.curRcptNo}`;
}
