import type { MessageKey } from '../i18n';

/**
 * WHO YOU CONTRACT WITH, AND THE PAPERS IT TRADES ON — as every app's Settings shows it.
 *
 * The user, 2026-10-09: a company keeps its own record, SeeBuyGet steps in only when somebody says a paper is not
 * right, and the people who may say so are "logged in users that are connected". The people most likely to know that
 * a licence has run out are the ones who contract with the company: a shop, a hub, a fleet, a driver, a store, a
 * business in its country. So each is shown that company's licences and insurance policies — "the number is enough
 * and can be verified" — and can report one from there, with what shows it.
 *
 * The server decides whose papers these are (from the sign-in's own record) and what may be reported. This file only
 * shapes what the sheet says.
 */

export const CONTRACT_REPORT_CATEGORIES = ['expired', 'not_genuine', 'not_theirs', 'wrong_details', 'other'] as const;
export type ContractReportCategory = (typeof CONTRACT_REPORT_CATEGORIES)[number];

export const CONTRACT_CATEGORY_LABEL: Record<ContractReportCategory, MessageKey> = {
  expired: 'account.contract.cat.expired',
  not_genuine: 'account.contract.cat.not_genuine',
  not_theirs: 'account.contract.cat.not_theirs',
  wrong_details: 'account.contract.cat.wrong_details',
  other: 'account.contract.cat.other',
};

export interface ContractPaper {
  source: 'licence' | 'insurance';
  kind: string;
  /** Who issued the licence, or the insurer. */
  issuer: string;
  /** The licence or policy number: what is checked against the issuer's own register. */
  number: string;
  expiresAt: string;
  lapsed: boolean;
  /** There is a paper on record behind it that counts, so it can be reported. */
  reportable: boolean;
  /** What became of this reader's own report on it. */
  yourReport?: { at: string; state: 'open' | 'dismissed' | 'struck'; reason?: string };
}

export interface ContractView {
  /** Absent where no company of ours contracts with this sign-in. */
  company?: { name: string; jurisdiction?: string };
  papers: ContractPaper[];
}

const LICENCE: Record<string, MessageKey> = {
  courier: 'account.contract.licence.courier',
  postal: 'account.contract.licence.postal',
  transport_operator: 'account.contract.licence.transport_operator',
  customs_broker: 'account.contract.licence.customs_broker',
  money_handling: 'account.contract.licence.money_handling',
};
const INSURANCE: Record<string, MessageKey> = {
  goods_in_transit: 'account.contract.insurance.goods_in_transit',
  claims_provision: 'account.contract.insurance.claims_provision',
  public_liability: 'account.contract.insurance.public_liability',
  motor_fleet: 'account.contract.insurance.motor_fleet',
};

type Say = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Is there anything to show? The Settings row is omitted where no company of ours contracts with this person. */
export function hasContract(view: ContractView | null | undefined): boolean {
  return Boolean(view?.company);
}

/** What a paper is called — a kind nobody has named yet is still a licence or a policy. */
export function paperName(p: Pick<ContractPaper, 'source' | 'kind'>): MessageKey {
  return (p.source === 'licence' ? LICENCE[p.kind] : INSURANCE[p.kind]) ?? (p.source === 'licence' ? 'account.contract.licence.other' : 'account.contract.insurance.other');
}

/** The line under it: who issued it and until when — or that it has run out. */
export function paperSays(p: Pick<ContractPaper, 'issuer' | 'expiresAt' | 'lapsed'>, t: Say, day: (iso: string) => string): string {
  return t(p.lapsed ? 'account.contract.ranOut' : 'account.contract.goodUntil', { who: p.issuer, date: day(p.expiresAt) });
}

/** What became of this reader's own report, in a sentence — or nothing where they made none. */
export function yourReportSays(p: Pick<ContractPaper, 'yourReport'>, t: Say, day: (iso: string) => string): { text: string; tone: 'info' | 'ok' } | null {
  const mine = p.yourReport;
  if (!mine) return null;
  if (mine.state === 'open') return { text: t('account.contract.yours.open', { when: day(mine.at) }), tone: 'info' };
  if (mine.state === 'struck') return { text: t('account.contract.yours.struck', { reason: mine.reason ?? '' }), tone: 'ok' };
  return { text: t('account.contract.yours.dismissed', { reason: mine.reason ?? '' }), tone: 'info' };
}

/**
 * MAY THIS READER REPORT IT NOW? Only where there is a paper on record behind it, and they have no report on it that
 * is still being looked at — the server would refuse a second, and a button that can only be refused is not offered.
 */
export function mayReportPaper(p: Pick<ContractPaper, 'reportable' | 'yourReport'>): boolean {
  return p.reportable && p.yourReport?.state !== 'open';
}

/** What stops a report from being sent — words, and what shows them. */
export function contractReportBlocker(form: { note: string; hasEvidence: boolean }): MessageKey | null {
  if (!form.note.trim()) return 'account.contract.needNote';
  if (!form.hasEvidence) return 'account.contract.needEvidence';
  return null;
}
