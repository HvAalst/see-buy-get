import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_LOCALE, isLocale, isRTL, type Locale } from './locales';
import { en, type MessageKey, type Messages } from './catalogs/en';
import { sw } from './catalogs/sw';
import { am } from './catalogs/am';
import { fr } from './catalogs/fr';
import { ar } from './catalogs/ar';

export * from './locales';
export type { MessageKey, Messages } from './catalogs/en';

/**
 * English, the fallback: the catalog every app carries, and what an app adds of its own before it renders — the console
 * its own words (apps/tower/english.ts), which no other app's code carries.
 */
const english: Partial<Messages> = { ...en };

/** Add an app's own English words. The console calls it before anything renders; so do the tests, for every app. */
export function addEnglish(more: Partial<Messages>): void {
  Object.assign(english, more);
}

const CATALOGS: Record<Locale, Partial<Messages>> = { en: english, sw, am, fr, ar };

const STORAGE_KEY = 'glos-locale';
let current: Locale = DEFAULT_LOCALE;
const subscribers = new Set<() => void>(); // mounted useLocale() hooks, re-rendered on a switch

function readStored(): Locale | null {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}
function writeStored(l: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, l);
  } catch {
    /* private mode / locked-down WebView — the choice just won't survive a cold start */
  }
}

/** Best-guess locale: an explicit saved choice wins; else the device language if we speak it; else English. */
export function detectLocale(): Locale {
  const saved = readStored();
  if (saved) return saved;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '').slice(0, 2).toLowerCase();
  return isLocale(nav) ? nav : DEFAULT_LOCALE;
}

/** Stamp the document so CSS + the ReadAloud TTS voice + native text flow follow the language. */
function applyToDocument(l: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = l;
  document.documentElement.dir = isRTL(l) ? 'rtl' : 'ltr';
}

export function getLocale(): Locale {
  return current;
}

/** Switch language: persist it, flip the document lang/dir, and re-render every mounted useLocale(). */
export function setLocale(l: Locale): void {
  if (!isLocale(l)) return;
  const changed = l !== current;
  current = l;
  writeStored(l);
  applyToDocument(l);
  if (changed) subscribers.forEach((fn) => fn());
}

/** Call ONCE at app start, before render: adopt the detected locale + stamp the document. */
export function initI18n(): void {
  current = detectLocale();
  applyToDocument(current);
}

/** The index of the brace that closes the one at `open`, counting the ones in between; -1 where it is never closed. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * A COUNTED WORD IN THE FORM ITS LANGUAGE GIVES THAT NUMBER — `{count, plural, one {# parcel} other {# parcels}}`.
 *
 * Without it every counted string had to be phrased to read at one as well as at five, and "3 parcel(s)" was the
 * shape it kept coming out in. The form is chosen by the language's own rule (Intl.PluralRules): English has two,
 * Arabic six (zero, one, two, few, many, other), and a translator writes the ones theirs has. `=0 {…}` answers one
 * exact number before the rule is asked; `other` is what is left; `#` is the number itself. A branch may hold
 * `{params}` and plurals of its own.
 */
function pluralOf(name: string, body: string, params: Record<string, string | number>, locale: string): string {
  if (!(name in params)) return `{${name}, plural,${body}}`; // left exactly as it was written
  const n = Number(params[name]);
  const forms = new Map<string, string>();
  let rest = body.trim();
  for (let m = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(rest); m; m = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(rest)) {
    const end = closing(rest, m[0].length - 1);
    if (end < 0) break;
    forms.set(m[1], rest.slice(m[0].length, end));
    rest = rest.slice(end + 1).trim();
  }
  const form = forms.get(`=${n}`) ?? forms.get(new Intl.PluralRules(locale).select(n)) ?? forms.get('other') ?? '';
  return interpolate(form.replace(/#/g, String(params[name])), params, locale);
}

/** `{name}` becomes its value, and `{name, plural, …}` the form for its number (pluralOf). Anything else is left as written. */
export function interpolate(msg: string, params: Record<string, string | number>, locale: string = DEFAULT_LOCALE): string {
  let out = '';
  let at = 0;
  for (let open = msg.indexOf('{'); open >= 0; open = msg.indexOf('{', at)) {
    const end = closing(msg, open);
    if (end < 0) break;
    out += msg.slice(at, open);
    const inner = msg.slice(open + 1, end);
    const plural = /^(\w+),\s*plural,([\s\S]*)$/.exec(inner);
    out += plural ? pluralOf(plural[1], plural[2], params, locale) : /^\w+$/.test(inner) && inner in params ? String(params[inner]) : `{${inner}}`;
    at = end + 1;
  }
  return out + msg.slice(at);
}

/** Translate a key in the active locale → English fallback → the key itself; interpolate `{params}`. A plural is chosen
 *  by the rule of the language the words came from: English words keep English plurals in a language not yet written. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const own = CATALOGS[current]?.[key];
  const msg = own ?? english[key] ?? (key as string);
  return params ? interpolate(msg, params, own !== undefined ? current : 'en') : msg;
}

/** The signature of `t`, for threading into pure logic functions (they take it as a trailing param). */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The ergonomic hook for screens: returns `t` AND re-renders the component when the language changes, so its
 *  strings update live on a switch. (Use plain `t()` only outside components, where there is nothing to re-render.) */
export function useT(): typeof t {
  useLocale();
  return t;
}

/** Reactive hook — the component re-renders when the language changes, and returns the current locale. */
export function useLocale(): Locale {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return current;
}

/* ---- locale-aware formatting (Intl) — the honest replacement for ad-hoc toFixed / toLocaleString ---- */

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current, opts).format(Number(n) || 0);
}

/** Money, grouped for the locale. `currency` is an ISO code (e.g. 'KES', 'USD'); omit it to render a bare
 *  2-decimal amount (the app often shows a plain figure beside its own label). `digits` fixes the decimals, for a
 *  figure finer than the currency's own (a per-km rate is set to the thousandth). */
export function formatMoney(amount: number, currency?: string, digits?: number): string {
  const fixed = digits == null ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return new Intl.NumberFormat(current, currency ? { style: 'currency', currency, ...fixed } : { minimumFractionDigits: 2, maximumFractionDigits: 2, ...fixed }).format(Number(amount) || 0);
}

export function formatDate(iso: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(current, opts).format(d);
}
