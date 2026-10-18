import { Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { kenyaStamp, type EtimsItem } from './etims';
import type { EtimsReceipt } from './fiscal-invoice.types';

/**
 * WHO RECORDS A KENYAN SALE WITH KRA — the company's own eTIMS device (OSCU), or, on a laptop, a stand-in.
 *
 * The user, 2026-10-18: the Kenyan company is "not registered yet". So nothing here is pointed at KRA unless a server
 * is given the device KRA issued it (GLOS_ETIMS_*, see 05_engineering/etims.md); a laptop gets the stand-in, which
 * answers like KRA and says SANDBOX on everything it answers; a live server with neither keeps every invoice waiting
 * and says "not sent to KRA". Kenya only: nothing calls this for any other country (fiscal-ways.ts).
 */

export const ETIMS_RAIL = 'ETIMS_RAIL';

export type EtimsEnv = 'sandbox' | 'production';

/** KRA's OSCU addresses (OSCU Specification v2.0 §2; the sandbox is KRA's own test system, never ours). */
export const ETIMS_HOSTS: Readonly<Record<EtimsEnv, string>> = {
  sandbox: 'https://etims-api-sbx.kra.go.ke/etims-api',
  production: 'https://etims-api.kra.go.ke/etims-api',
};

/** What KRA answered. Only `recorded` carries what an invoice must print; `already` and `unknown` are said, not guessed. */
export type EtimsAnswer =
  | { recorded: EtimsReceipt }
  /** KRA turned it down: its code and words. Nothing was recorded. */
  | { refused: string; code?: string }
  /** KRA says it holds this number already (921, 994): an earlier try reached it and its answer was lost. */
  | { already: string; code: string }
  /** No answer we can read — a timeout, a 5xx, a dropped line. It may have been recorded: sent again, the same request. */
  | { unknown: string };

export interface EtimsRail {
  readonly kind: 'kra' | 'stand_in';
  readonly env: EtimsEnv;
  /** The company's branch (00, the head office) and the service it sells, as registered with KRA. */
  readonly bhfId: string;
  readonly item: EtimsItem;
  /** Whether the taxable amount includes the tax (KRA's sample) — settled in KRA's sandbox before going live. */
  readonly taxable: 'gross' | 'net';
  /** Record one sale or credit note (POST /saveTrnsSalesOsdc) for the company with this KRA PIN. */
  record(tin: string, body: Record<string, unknown>): Promise<EtimsAnswer>;
}

export interface EtimsConfig {
  env: EtimsEnv;
  bhfId: string;
  /** The serial number of the device KRA approved for this company (dvcSrlNo). */
  deviceSerial: string;
  item: EtimsItem;
  taxable: 'gross' | 'net';
  /** The device's key, where it was set up before and KRA will not send it again (answer 902). */
  known?: { cmcKey: string; sdcId: string; mrcNo: string };
  /** A stand-in for KRA on a laptop. Refused outside a sandbox. */
  host?: string;
}

/** Enough to record with KRA? Absent any of it, nothing is sent: a laptop gets the stand-in, a server keeps invoices waiting. */
export function etimsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EtimsConfig | null {
  const v = (k: string) => (env[k] ?? '').trim();
  const deviceSerial = v('GLOS_ETIMS_DEVICE_SERIAL');
  const itemCd = v('GLOS_ETIMS_ITEM_CODE');
  const itemClsCd = v('GLOS_ETIMS_ITEM_CLASS');
  if (!deviceSerial || !itemCd || !itemClsCd) return null;
  const cmcKey = v('GLOS_ETIMS_CMC_KEY');
  const sdcId = v('GLOS_ETIMS_SDC_ID');
  const mrcNo = v('GLOS_ETIMS_MRC_NO');
  return {
    env: v('GLOS_ETIMS_ENV').toLowerCase() === 'production' ? 'production' : 'sandbox',
    bhfId: v('GLOS_ETIMS_BRANCH') || '00',
    deviceSerial,
    item: { itemCd, itemClsCd },
    taxable: v('GLOS_ETIMS_TAXABLE').toLowerCase() === 'net' ? 'net' : 'gross',
    ...(cmcKey && sdcId && mrcNo ? { known: { cmcKey, sdcId, mrcNo } } : {}),
    host: v('GLOS_ETIMS_HOST') || undefined,
  };
}

/** Which of the settings a half set-up server is missing — said at start, so it is not mistaken for "not set up". */
export function etimsMissing(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys = ['GLOS_ETIMS_DEVICE_SERIAL', 'GLOS_ETIMS_ITEM_CODE', 'GLOS_ETIMS_ITEM_CLASS'];
  const set = keys.filter((k) => (env[k] ?? '').trim());
  return set.length ? keys.filter((k) => !set.includes(k)) : [];
}

/** Which one this server has, said at start: KRA's device where it is set up, the stand-in on a laptop, else none. */
export function chooseEtimsRail(env: NodeJS.ProcessEnv = process.env): EtimsRail | null {
  const logger = new Logger('FiscalInvoices');
  const missing = etimsMissing(env);
  if (missing.length) logger.warn(`eTIMS is half set up: ${missing.join(', ')} missing. Nothing is sent to KRA.`);
  const config = etimsConfigFromEnv(env);
  if (config) {
    logger.log(`Kenyan tax invoices are recorded with KRA's eTIMS (${config.env}, branch ${config.bhfId})`);
    return new KraEtimsRail(config);
  }
  if (isSandbox()) {
    logger.log('eTIMS is not set up: on this laptop a stand-in answers, and every invoice says SANDBOX');
    return new SandboxEtimsRail();
  }
  logger.warn('eTIMS is not set up: Kenyan tax invoices wait, and nothing is sent to KRA');
  return null;
}

/** The device KRA set up for a company's branch: its key, and the numbers every invoice prints. */
interface EtimsDevice {
  tin: string;
  bhfId: string;
  dvcSrlNo: string;
  cmcKey: string;
  sdcId: string;
  mrcNo: string;
  at: string;
}

/** KRA's answers say "already have it" in these words (OSCU §4.18): sales already declared, and overlapped data. */
const ALREADY = new Set(['921', '994']);
/** …and these mean KRA's own side failed: the request may or may not have landed. */
const KRA_FAULT = new Set(['894', '999']);
const HTTP_TIMEOUT_MS = 20_000;

type Fetcher = typeof fetch;

interface KraAnswer {
  resultCd?: string;
  resultMsg?: string;
  data?: Record<string, unknown> | null;
}

/** KRA's OSCU, over the wire. Built and tested against KRA's published interface; pointed at KRA only once configured. */
export class KraEtimsRail implements EtimsRail {
  readonly kind = 'kra' as const;
  private readonly devices = new PersistentMap<string, EtimsDevice>('etims-device');

  constructor(
    private readonly config: EtimsConfig,
    /** Injected so the rail is driven in a test without a network — and never reaches KRA from one. */
    private readonly http: Fetcher = fetch,
  ) {
    if (config.host && !isSandbox()) throw new Error('GLOS_ETIMS_HOST is set outside a sandbox: invoices would be recorded somewhere other than KRA');
  }

  get env(): EtimsEnv {
    return this.config.env;
  }
  get bhfId(): string {
    return this.config.bhfId;
  }
  get item(): EtimsItem {
    return this.config.item;
  }
  get taxable(): 'gross' | 'net' {
    return this.config.taxable;
  }

  private get host(): string {
    return (this.config.host || ETIMS_HOSTS[this.config.env]).replace(/\/+$/, '');
  }

  async record(tin: string, body: Record<string, unknown>): Promise<EtimsAnswer> {
    if (!tin) return { refused: 'The company has no KRA PIN in its tax settings' };
    let device: EtimsDevice | EtimsAnswer;
    try {
      device = await this.device(tin);
    } catch (err) {
      return { unknown: `KRA did not answer setting up the device (${(err as Error).message})` };
    }
    if (!('cmcKey' in device)) return device;
    let res: Response;
    let answer: KraAnswer;
    try {
      res = await this.post('/saveTrnsSalesOsdc', body, { tin, bhfId: this.config.bhfId, cmcKey: device.cmcKey });
      answer = (await res.json().catch(() => ({}))) as KraAnswer;
    } catch (err) {
      return { unknown: `KRA did not answer (${(err as Error).message}). It may have been recorded: it is sent again, the same.` };
    }
    if (res.status >= 500) return { unknown: `KRA answered ${res.status}. It may have been recorded: it is sent again, the same.` };
    const code = String(answer.resultCd ?? '').trim();
    const words = String(answer.resultMsg ?? '').trim();
    if (code === '000') {
      const d = trimmedKeys(answer.data ?? {});
      const receipt: EtimsReceipt = {
        curRcptNo: Number(d.curRcptNo),
        totRcptNo: Number(d.totRcptNo),
        intrlData: String(d.intrlData ?? ''),
        rcptSign: String(d.rcptSign ?? ''),
        sdcDateTime: String(d.sdcDateTime ?? ''),
        sdcId: device.sdcId,
        mrcNo: device.mrcNo,
      };
      if (!Number.isFinite(receipt.curRcptNo) || !receipt.rcptSign || !receipt.intrlData) {
        return { already: 'KRA said it recorded it, without the receipt number and signature an invoice must print: check it on KRA’s portal.', code };
      }
      return { recorded: receipt };
    }
    if (ALREADY.has(code)) return { already: words || `KRA already holds this invoice number (${code})`, code };
    if (KRA_FAULT.has(code)) return { unknown: `KRA could not answer (${code}${words ? `: ${words}` : ''}). It is sent again, the same.` };
    return { refused: words ? `${words} (${code || res.status})` : `KRA refused it (${code || res.status})`, ...(code ? { code } : {}) };
  }

  /** The device for this company's branch: kept from the first time KRA set it up, which it does once (902 after). */
  private async device(tin: string): Promise<EtimsDevice | EtimsAnswer> {
    const key = `${tin}:${this.config.bhfId}`;
    const kept = this.devices.get(key);
    if (kept && kept.dvcSrlNo === this.config.deviceSerial) return kept;
    const known = this.config.known;
    if (known) {
      const device = { tin, bhfId: this.config.bhfId, dvcSrlNo: this.config.deviceSerial, ...known, at: new Date().toISOString() };
      this.devices.set(key, device);
      return device;
    }
    const res = await this.post('/selectInitOsdcInfo', { tin, bhfId: this.config.bhfId, dvcSrlNo: this.config.deviceSerial });
    if (res.status >= 500) return { unknown: `KRA answered ${res.status} setting up the device` };
    const answer = (await res.json().catch(() => ({}))) as KraAnswer;
    const code = String(answer.resultCd ?? '').trim();
    if (code === '902') {
      return { refused: 'KRA set this device up before and does not send its key twice. Put the key, the CU ID and the MRC number from that first set-up in GLOS_ETIMS_CMC_KEY, GLOS_ETIMS_SDC_ID and GLOS_ETIMS_MRC_NO.', code };
    }
    const info = trimmedKeys(((answer.data ?? {}) as { info?: Record<string, unknown> }).info ?? {});
    const cmcKey = String(info.cmcKey ?? '').trim();
    if (code !== '000' || !cmcKey) return { refused: `KRA did not set up the device: ${String(answer.resultMsg ?? '').trim() || code || res.status}`, ...(code ? { code } : {}) };
    // KRA's own sample spells it sdcId in one place and sdicId in another: either is the CU ID.
    const device = { tin, bhfId: this.config.bhfId, dvcSrlNo: this.config.deviceSerial, cmcKey, sdcId: String(info.sdcId ?? info.sdicId ?? ''), mrcNo: String(info.mrcNo ?? ''), at: new Date().toISOString() };
    this.devices.set(key, device);
    new Logger(KraEtimsRail.name).log(`eTIMS device set up with KRA (${this.config.env}): CU ID ${device.sdcId}`);
    return device;
  }

  private async post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), HTTP_TIMEOUT_MS);
    try {
      return await this.http(`${this.host}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: abort.signal });
    } catch (err) {
      throw new Error(abort.signal.aborted ? 'no answer in time' : (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** KRA's own sample answer carries keys with a trailing space ("curRcptNo "): read them either way. */
function trimmedKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.trim(), v]));
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const letters = (n: number) => Array.from(randomBytes(n), (b) => BASE32[b % 32]).join('');

/**
 * THE STAND-IN, on a laptop only. Answers as KRA does — a receipt number, internal data, a signature — and marks every
 * answer SANDBOX, so nothing it answered can pass for a KRA invoice. Stricter than KRA is known to be: a number out of
 * order is refused, and a number it holds is answered "already", so a test asserts on what the receiver was sent.
 */
export class SandboxEtimsRail implements EtimsRail {
  readonly kind = 'stand_in' as const;
  readonly env = 'sandbox' as const;
  readonly bhfId = '00';
  /** Shaped as KRA's item codes are (§4.19): Kenya, a service, no packaging, units, the first. */
  readonly item: EtimsItem = { itemCd: 'KE3NTU0000001', itemClsCd: '7810220000' };
  readonly taxable = 'gross' as const;
  private readonly state = new PersistentMap<string, { lastInvcNo: number; receipts: number }>('etims-stand-in');

  async record(tin: string, body: Record<string, unknown>): Promise<EtimsAnswer> {
    const key = tin || 'no-pin';
    const kept = this.state.get(key) ?? { lastInvcNo: 0, receipts: 0 };
    const invcNo = Number(body.invcNo);
    if (!Number.isInteger(invcNo) || invcNo < 1) return { refused: 'Request parameter error: invcNo (910)', code: '910' };
    if (invcNo <= kept.lastInvcNo) return { already: 'There is an overlapped Data (994)', code: '994' };
    if (invcNo !== kept.lastInvcNo + 1) return { refused: `Invoice ${invcNo} is out of order: the last recorded was ${kept.lastInvcNo} (910)`, code: '910' };
    if (body.rcptTyCd === 'R' && !(Number(body.orgInvcNo) > 0)) return { refused: 'A credit note names the invoice it gives back (910)', code: '910' };
    const next = { lastInvcNo: invcNo, receipts: kept.receipts + 1 };
    this.state.set(key, next);
    return {
      recorded: {
        curRcptNo: next.receipts,
        totRcptNo: next.receipts,
        intrlData: letters(26),
        rcptSign: letters(16),
        sdcDateTime: kenyaStamp(new Date().toISOString()).dateTime,
        sdcId: 'SANDBOX',
        mrcNo: 'SANDBOX',
        sandbox: true,
      },
    };
  }
}
