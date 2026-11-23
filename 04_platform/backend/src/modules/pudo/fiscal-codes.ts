import { unionBetween } from '../../foundation/countries/customs-union';
import { GlosError } from '../../foundation/http/glos-error';

/**
 * 2026-11-23 — THE CODES ROMANIA AND BULGARIA FOLLOW GOODS BY (the owner, from a driver's point of view: "include dedicated fields
 * for both Romanian UIT and Bulgarian UTN codes"; "a mandatory field … forces the sender to enter the code before you accept or load
 * the freight"; "ideally with a checkbox for 'Sender declares goods exempt'").
 *
 * As the rules read when this was built (what is the lawyer's is in legal.html, L71–L73):
 * - ROMANIA, RO e-Transport (OUG 41/2022; ANAF's guide of 2025): a road vehicle of 2.5 t or more carrying a consignment of more than
 *   500 kg gross, or worth more than RON 10,000. It is declared by a party IN Romania (the buyer of goods arriving, the supplier of
 *   goods leaving, the importer or exporter, a warehouse unloading goods in transit), who passes the UIT code to the carrier before
 *   the vehicle reaches the Romanian border or sets off. The code lasts 5 calendar days from the declared start, 15 for goods a
 *   Romanian buyer acquires from another EU country. Goods only passing through Romania name nobody to declare: a load is asked a UIT
 *   only where it is taken over or delivered in Romania. Excise goods moving under an e-AD are outside it.
 * - BULGARIA, goods with high fiscal risk (Tax and Social Insurance Procedure Code art. 127i; Ordinance H-5/2023): goods on the
 *   Minister of Finance's list carried by a vehicle over 3.5 t, declared in advance by the Bulgarian buyer (goods arriving) or the
 *   seller (goods leaving, or moving within Bulgaria), who gets a unique transport number (UTN), valid 14 days, for the driver to show.
 *
 * So a load taken over or delivered in either country carries its code, or the sender's word, kept with its time, that none is
 * needed and why. Either way it is on the consignment note (box 13) and the driver's card; a code past its last day stops the
 * taking over until the sender gives a new one. Neither code's form is published, so a code is letters and digits, nothing more.
 */
export type FiscalCountry = 'RO' | 'BG';
export const FISCAL_COUNTRIES: readonly FiscalCountry[] = ['RO', 'BG'];
/** Romania: no consignment over 500 kg gross or RON 10,000; or excise goods moving under an e-AD (EMCS). */
export const RO_EXEMPTIONS = ['thresholds', 'excise'] as const;
/** Bulgaria: none of the goods is on the Minister of Finance's list of goods with high fiscal risk. */
export const BG_EXEMPTIONS = ['not-listed'] as const;
export type FiscalExemption = (typeof RO_EXEMPTIONS)[number] | (typeof BG_EXEMPTIONS)[number];
export const FISCAL_EXEMPTIONS: readonly FiscalExemption[] = [...RO_EXEMPTIONS, ...BG_EXEMPTIONS];

/** What each country's code is called, in which system, how many days it lasts, and in which time zone its days are counted. */
export const FISCAL_RULES: Record<FiscalCountry, { kind: 'UIT' | 'UTN'; country: string; system: string; days: number; acquisitionDays?: number; timeZone: string; exemptions: readonly FiscalExemption[] }> = {
  RO: { kind: 'UIT', country: 'Romania', system: 'RO e-Transport', days: 5, acquisitionDays: 15, timeZone: 'Europe/Bucharest', exemptions: RO_EXEMPTIONS },
  BG: { kind: 'UTN', country: 'Bulgaria', system: 'goods with high fiscal risk', days: 14, timeZone: 'Europe/Sofia', exemptions: BG_EXEMPTIONS },
};

/** Romania's weight above which a consignment is declared (gross), whatever it is worth. */
export const RO_THRESHOLD_KG = 500;

/** What a sender gives for one country: the code and the day it counts from, or why none is needed. */
export interface FiscalCodeInput {
  code?: string;
  /** Romania: the day the transport was declared to start; Bulgaria: the day the UTN was issued. YYYY-MM-DD. */
  from?: string;
  exempt?: string;
}
export type FiscalCodesInput = Partial<Record<'ro' | 'bg', FiscalCodeInput>>;

/** One country's code on a load, or the sender's word that none is needed: kept with when it was said and by whom. */
export interface FiscalCode {
  country: FiscalCountry;
  kind: 'UIT' | 'UTN';
  code?: string;
  from?: string;
  /** The last calendar day the code may be used, in that country's time. */
  validThrough?: string;
  exempt?: FiscalExemption;
  saidAt: string;
  saidBy?: string;
}

const keyOf = (c: FiscalCountry): 'ro' | 'bg' => (c === 'RO' ? 'ro' : 'bg');
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The countries whose code a load is asked: where it is taken over or delivered, never where it only passes. */
export function fiscalCountriesOf(pickupCountry?: string, destCountry?: string): FiscalCountry[] {
  const ends = new Set([pickupCountry?.trim().toUpperCase(), destCountry?.trim().toUpperCase()]);
  return FISCAL_COUNTRIES.filter((c) => ends.has(c));
}

/** The calendar day it is now in a time zone, YYYY-MM-DD. */
export function dayIn(timeZone: string, now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** `days` calendar days counted from `from`, the first included: the last of them. */
export function lastDayOf(from: string, days: number): string {
  return new Date(Date.parse(`${from}T00:00:00Z`) + (days - 1) * DAY).toISOString().slice(0, 10);
}

/** How many days a code lasts on this load: Romania's 15 for goods a Romanian buyer acquires from another EU country. */
function daysFor(country: FiscalCountry, load: { pickupCountry?: string; destCountry?: string }): number {
  const rule = FISCAL_RULES[country];
  const acquisition = country === 'RO' && load.destCountry?.toUpperCase() === 'RO' && unionBetween(load.pickupCountry, 'RO') === 'EU';
  return acquisition && rule.acquisitionDays ? rule.acquisitionDays : rule.days;
}

function asked(countries: FiscalCountry[]): string {
  const words = countries.map((c) => `${FISCAL_RULES[c].country} the ${FISCAL_RULES[c].kind} code (${FISCAL_RULES[c].system})`);
  return `A load taken over or delivered in ${countries.map((c) => FISCAL_RULES[c].country).join(' or ')} carries ${words.join(' and ')}, or your word that none is needed and why`;
}

/**
 * The codes a load carries, from what its sender gave: refused, in words, where a country it is taken over or delivered in is
 * missing (unless `requireAll` is false: a company's system before the rule refuses it), where a code and a "none needed" are both
 * given, where a code is not letters and digits, has no day, or has run out, and where Romania's weight threshold is passed but
 * the sender says it is not.
 */
export function fiscalCodesFor(input: FiscalCodesInput | undefined, load: { pickupCountry?: string; destCountry?: string; weightKg: number }, said: { now: number; by?: string }, requireAll = true): FiscalCode[] {
  const countries = fiscalCountriesOf(load.pickupCountry, load.destCountry);
  const given = (c: FiscalCountry) => {
    const v = input?.[keyOf(c)];
    return v && (v.code?.trim() || v.exempt?.trim()) ? v : undefined;
  };
  const missing = countries.filter((c) => !given(c));
  if (missing.length && requireAll) throw new GlosError('FIELD_REQUIRED', asked(missing), { field: 'fiscalCodes', countries: missing.join(',') });
  return countries.filter((c) => given(c)).map((c) => oneCode(c, given(c)!, load, said));
}

function oneCode(country: FiscalCountry, v: FiscalCodeInput, load: { pickupCountry?: string; destCountry?: string; weightKg: number }, said: { now: number; by?: string }): FiscalCode {
  const rule = FISCAL_RULES[country];
  const field = `fiscalCodes.${keyOf(country)}`;
  const code = (v.code ?? '').replace(/[\s.-]/g, '').toUpperCase();
  const exempt = v.exempt?.trim();
  const base = { country, kind: rule.kind, saidAt: new Date(said.now).toISOString(), ...(said.by ? { saidBy: said.by.slice(0, 80) } : {}) };
  if (code && exempt) throw new GlosError('VALIDATION_FAILED', `${rule.country}: give the ${rule.kind} code, or say none is needed, not both`, { field });
  if (exempt) {
    if (!(rule.exemptions as readonly string[]).includes(exempt)) throw new GlosError('VALIDATION_FAILED', `${rule.country}: why no ${rule.kind} code is needed is one of ${rule.exemptions.join(', ')}`, { field });
    if (exempt === 'thresholds' && load.weightKg > RO_THRESHOLD_KG) {
      throw new GlosError('VALIDATION_FAILED', `This load weighs ${load.weightKg} kg: over ${RO_THRESHOLD_KG} kg, Romania asks a UIT code for it`, { field });
    }
    return { ...base, exempt: exempt as FiscalExemption };
  }
  if (!/^[\p{L}\p{N}]{6,40}$/u.test(code)) throw new GlosError('VALIDATION_FAILED', `${rule.country}: a ${rule.kind} code is 6 to 40 letters and digits`, { field });
  const from = v.from?.trim() ?? '';
  // A day that is in the calendar: 31 November is not read as 1 December.
  const real = DATE.test(from) && !Number.isNaN(Date.parse(`${from}T00:00:00Z`)) && new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) === from;
  if (!real) {
    throw new GlosError('FIELD_REQUIRED', country === 'RO' ? 'Give the day the transport was declared to start in RO e-Transport' : 'Give the day the UTN was issued', { field });
  }
  const validThrough = lastDayOf(from, daysFor(country, load));
  if (dayIn(rule.timeZone, said.now) > validThrough) throw new GlosError('VALIDATION_FAILED', `This ${rule.kind} code ran out on ${validThrough}: ask for a new one`, { field });
  return { ...base, code, from, validThrough };
}

/** Whose turn it is with a code that has run out: why the goods are not taken over, in words; nothing where every code holds. */
export function fiscalPickupRefusal(codes: readonly FiscalCode[] | undefined, now: number): string | undefined {
  for (const c of codes ?? []) {
    if (!c.validThrough) continue;
    const rule = FISCAL_RULES[c.country];
    if (dayIn(rule.timeZone, now) > c.validThrough) return `The ${rule.kind} code ${c.code} for ${rule.country} (${rule.system}) ran out on ${c.validThrough}: the sender gives a new one before the goods are taken over`;
  }
  return undefined;
}

/** Each code as box 13 of the consignment note says it. `when` writes a moment as the note does. */
export function fiscalNoteLines(codes: readonly FiscalCode[] | undefined, when: (iso: string) => string): string[] {
  return (codes ?? []).map((c) => {
    const rule = FISCAL_RULES[c.country];
    const head = `${rule.country}, ${rule.system}`;
    if (c.code) return `${head}: ${rule.kind} ${c.code}, valid through ${c.validThrough}`;
    const why =
      c.exempt === 'thresholds' ? `no consignment weighs over ${RO_THRESHOLD_KG} kg gross or is worth over RON 10,000`
      : c.exempt === 'excise' ? 'the goods are excise goods moving under an electronic administrative document (e-AD)'
      : 'none of the goods is on the Minister of Finance’s list of goods with high fiscal risk';
    return `${head}: no ${rule.kind} code; the sender says ${why} (${when(c.saidAt)})`;
  });
}

/** For the driver's card: each code, the last day it holds, and whether it has run out or runs out within a day. */
export function fiscalCardOf(codes: readonly FiscalCode[] | undefined, now: number): Array<{ country: FiscalCountry; kind: 'UIT' | 'UTN'; code?: string; validThrough?: string; exempt?: FiscalExemption; expired?: true; endsSoon?: true }> {
  return (codes ?? []).map((c) => {
    const today = dayIn(FISCAL_RULES[c.country].timeZone, now);
    const tomorrow = dayIn(FISCAL_RULES[c.country].timeZone, now + DAY);
    const expired = c.validThrough !== undefined && today > c.validThrough;
    const endsSoon = !expired && c.validThrough !== undefined && tomorrow >= c.validThrough;
    return { country: c.country, kind: c.kind, ...(c.code ? { code: c.code, validThrough: c.validThrough } : {}), ...(c.exempt ? { exempt: c.exempt } : {}), ...(expired ? { expired: true as const } : {}), ...(endsSoon ? { endsSoon: true as const } : {}) };
  });
}
