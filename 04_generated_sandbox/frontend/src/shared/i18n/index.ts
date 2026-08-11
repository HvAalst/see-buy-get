import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_LOCALE, isLocale, isRTL, type Locale } from './locales';
import { en, type MessageKey, type Messages } from './catalogs/en';
import { sw } from './catalogs/sw';
import { am } from './catalogs/am';
import { fr } from './catalogs/fr';
import { ar } from './catalogs/ar';

export * from './locales';
export type { MessageKey, Messages } from './catalogs/en';

const CATALOGS: Record<Locale, Partial<Messages>> = { en, sw, am, fr, ar };

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

function interpolate(msg: string, params: Record<string, string | number>): string {
  return msg.replace(/\{(\w+)\}/g, (_m, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

/** Translate a key in the active locale → English fallback → the key itself; interpolate `{params}`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const msg = CATALOGS[current]?.[key] ?? en[key] ?? (key as string);
  return params ? interpolate(msg, params) : msg;
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
 *  2-decimal amount (the app often shows a plain figure beside its own label). */
export function formatMoney(amount: number, currency?: string): string {
  return new Intl.NumberFormat(current, currency ? { style: 'currency', currency } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount) || 0);
}

export function formatDate(iso: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(current, opts).format(d);
}
