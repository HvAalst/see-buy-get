import type { SbgError } from '../lib/sbg/errors';
import type { MessageKey } from './i18n';

/**
 * 2026-11-23 — THE CODES ROMANIA AND BULGARIA FOLLOW GOODS BY, as a form asks them (backend fiscal-codes.ts; the owner: "dedicated
 * fields for both Romanian UIT and Bulgarian UTN codes", "ideally with a checkbox for 'Sender declares goods exempt'"). A load taken
 * over or delivered in Romania carries the UIT code of RO e-Transport, in Bulgaria the UTN of goods with high fiscal risk, or the
 * sender's word, with why, that none is needed. Never asked where a load only passes through. The server holds the rule; a form
 * asks before it is sent where it knows the countries, and after the server asks where it does not.
 * (Not shared/fiscal.ts: that one is Kenya's tax invoices.)
 */
export type FiscalCountry = 'RO' | 'BG';
export const FISCAL_COUNTRIES: readonly FiscalCountry[] = ['RO', 'BG'];
/** The sender's answer for one country: a code, or one of the reasons the law gives for none. */
export type FiscalChoice = '' | 'code' | 'thresholds' | 'excise' | 'not-listed';
export const FISCAL_CHOICES: Record<FiscalCountry, Exclude<FiscalChoice, ''>[]> = { RO: ['code', 'thresholds', 'excise'], BG: ['code', 'not-listed'] };
export interface FiscalEntry {
  choice: FiscalChoice;
  code: string;
  /** Romania: the day the transport was declared to start; Bulgaria: the day the UTN was issued. YYYY-MM-DD. */
  from: string;
}
/** `indemnity`: 2026-11-24 — the sender certifies the codes, or its reasons for none, are accurate (CMR art. 7 and 11). */
export type FiscalForm = Partial<Record<FiscalCountry, FiscalEntry>> & { indemnity?: boolean };
export const EMPTY_FISCAL_ENTRY: FiscalEntry = { choice: '', code: '', from: '' };

/** The words of each answer a sender can give. */
export const FISCAL_CHOICE_WORDS: Record<Exclude<FiscalChoice, ''>, MessageKey> = {
  code: 'common.fiscal.choiceCode',
  thresholds: 'common.fiscal.roThresholds',
  excise: 'common.fiscal.roExcise',
  'not-listed': 'common.fiscal.bgNotListed',
};
export const fiscalHeadWords = (c: FiscalCountry): MessageKey => (c === 'RO' ? 'common.fiscal.roHead' : 'common.fiscal.bgHead');
export const fiscalBodyWords = (c: FiscalCountry): MessageKey => (c === 'RO' ? 'common.fiscal.roBody' : 'common.fiscal.bgBody');
export const fiscalFromWords = (c: FiscalCountry): MessageKey => (c === 'RO' ? 'common.fiscal.roFrom' : 'common.fiscal.bgFrom');

/** The countries a load is asked for: where it is taken over or delivered. */
export function fiscalCountriesOf(pickup?: string, dest?: string): FiscalCountry[] {
  const ends = new Set([pickup?.trim().toUpperCase(), dest?.trim().toUpperCase()]);
  return FISCAL_COUNTRIES.filter((c) => ends.has(c));
}

/** The countries the server asked for in a refusal, or nothing for any other refusal. */
export function fiscalCodesAsked(error: SbgError | null | undefined): FiscalCountry[] | null {
  const p = error?.params;
  if (error?.code !== 'FIELD_REQUIRED' || p?.field !== 'fiscalCodes' || typeof p.countries !== 'string') return null;
  const asked = FISCAL_COUNTRIES.filter((c) => (p.countries as string).split(',').includes(c));
  return asked.length ? asked : null;
}

const CODE = /^[\p{L}\p{N}]{6,40}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One country answered: a reason chosen, or a code of 6 to 40 letters and digits with its day. */
export function fiscalEntryReady(e: FiscalEntry | undefined): boolean {
  if (!e?.choice) return false;
  return e.choice !== 'code' || (CODE.test(e.code.replace(/[\s.-]/g, '')) && DAY.test(e.from));
}

export function fiscalReady(form: FiscalForm, countries: readonly FiscalCountry[]): boolean {
  return countries.every((c) => fiscalEntryReady(form[c])) && (countries.length === 0 || form.indemnity === true);
}

export interface FiscalCodeBody {
  code?: string;
  from?: string;
  exempt?: string;
}

/** What is sent: each asked country's code with its day, or its reason. Nothing where nothing is asked. */
export function fiscalBody(form: FiscalForm, countries: readonly FiscalCountry[]): { ro?: FiscalCodeBody; bg?: FiscalCodeBody; indemnity?: true } | undefined {
  const out: { ro?: FiscalCodeBody; bg?: FiscalCodeBody; indemnity?: true } = {};
  for (const c of countries) {
    const e = form[c];
    if (!e?.choice) continue;
    out[c === 'RO' ? 'ro' : 'bg'] = e.choice === 'code' ? { code: e.code.trim(), from: e.from } : { exempt: e.choice };
  }
  if (!out.ro && !out.bg) return undefined;
  if (form.indemnity) out.indemnity = true;
  return out;
}

/** A code as the server shows it, to a driver or the sender. */
export interface FiscalCard {
  country: FiscalCountry;
  kind: 'UIT' | 'UTN';
  code?: string;
  validThrough?: string;
  exempt?: 'thresholds' | 'excise' | 'not-listed';
  /** 2026-11-24 — the moment it stops, and its state now: still good, running out within 24 hours, or run out. */
  expiresAt?: string;
  status?: 'valid' | 'expiring_soon' | 'expired';
}

/** Codes only, or with any reason for none the sender gave. */
export type FiscalCompliance = 'declared_with_codes' | 'exempt_declared_by_sender';
export const FISCAL_COMPLIANCE_WORDS: Record<FiscalCompliance, MessageKey> = {
  declared_with_codes: 'common.fiscal.declaredWithCodes',
  exempt_declared_by_sender: 'common.fiscal.exemptDeclared',
};

/** The words of a code: what it is, and whether it ran out or runs out within 24 hours (when, to the minute). */
export function fiscalCardWords(c: FiscalCard, t: (key: MessageKey, params?: Record<string, string | number>) => string, country: string, day: (iso: string) => string, moment: (iso: string) => string = day): { line: string; warn?: string; tone: 'ok' | 'warn' | 'danger' } {
  const line = c.code
    ? t('common.fiscal.cardCode', { country, kind: c.kind, code: c.code, date: day(c.validThrough ?? '') })
    : t(c.exempt === 'thresholds' ? 'common.fiscal.cardThresholds' : c.exempt === 'excise' ? 'common.fiscal.cardExcise' : 'common.fiscal.cardNotListed', { country });
  if (c.status === 'expired') return { line, warn: t('common.fiscal.cardExpired', { date: day(c.validThrough ?? '') }), tone: 'danger' };
  if (c.status === 'expiring_soon') return { line, warn: t('common.fiscal.cardEndsSoon', { date: c.expiresAt ? moment(c.expiresAt) : day(c.validThrough ?? '') }), tone: 'warn' };
  return { line, tone: 'ok' };
}

/** The moment a code stops, in the reader's language and time: "27 Nov, 22:59". */
export function fiscalMoment(iso: string, locale: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A day of a code, said in the reader's language: "27 Nov 2026". */
export function fiscalDay(iso: string, locale: string): string {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
