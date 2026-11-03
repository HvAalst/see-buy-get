import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_LOCALE, LOCALES as LOCALES_ALL, isLocale, isRTL, type Locale } from './locales';
import { en, type MessageKey, type Messages } from './catalogs/en';
import { sw } from './catalogs/sw';
import { am } from './catalogs/am';
import { fr } from './catalogs/fr';
import { ar } from './catalogs/ar';

export * from './locales';
export type { MessageKey, Messages } from './catalogs/en';

/**
 * English, the fallback: the catalog every app carries, and what each app adds of its own before it renders
 * (apps/<app>/english.ts), which no other app's code carries.
 */
const english: Partial<Messages> = { ...en };

/** Add an app's own English words. Every app calls it before anything renders; so do the tests, for every app. */
export function addEnglish(more: Partial<Messages>): void {
  Object.assign(english, more);
}

const CATALOGS: Record<Locale, Partial<Messages>> = { en: english, sw, am, fr, ar };

/*
 * 2026-11-03 — THE OTHER LANGUAGES, FETCHED WHEN THEY ARE CHOSEN (the owner: "write the translation in and write a separate
 * review sheet … the first version is not lost. languages are reviewed per country sbg company").
 *
 * VERSION 1 is the translation written in (i18n/words/<locale>/<catalogue>.ts, one file for each English catalogue): an app
 * names the catalogues it speaks (wordsOf, from its english.ts), and only when somebody picks another language are that
 * language's files of them fetched — English readers download none of it. VERSION 2 is a country's own review, kept on the
 * server by that country's SeeBuyGet company (the console's Languages screen) and laid over version 1 for the people in that
 * country (reviewedWords); version 1 stays as written. Anything not translated is said in English.
 */
const TRANSLATIONS = import.meta.glob<{ words: Record<string, string> }>('./words/*/*.ts');
const speaks = new Set<string>(['base']);
const helpSpeaks = new Set<string>(['help']);
const fetched = new Set<string>();
const REVIEWED: Partial<Record<Locale, Record<string, string>>> = {};

/** The catalogues this app speaks besides the common ones (`agent` for en.agent.ts): called from its english.ts. */
export function wordsOf(...names: string[]): void {
  names.forEach((n) => speaks.add(n));
}
/** The help's catalogues this app adds (`help-app`), fetched with the help. */
export function helpWordsOf(...names: string[]): void {
  names.forEach((n) => helpSpeaks.add(n));
}
/** The languages there are words for: English, and every language with a translation written in. */
export function localesWithWords(): Locale[] {
  const have = new Set(Object.keys(TRANSLATIONS).map((path) => path.split('/')[2]));
  return LOCALES_ALL.filter((l) => l === 'en' || have.has(l));
}

/**
 * Fetch a language's files of these catalogues, once each; everything showing words is drawn again when they come. A file
 * already on its way is waited for, not fetched twice — and not taken as here before it is.
 */
function fetchWords(l: Locale, names: Iterable<string>): Promise<void> {
  if (l === 'en') return Promise.resolve();
  const paths = [...names].map((name) => `./words/${l}/${name}.ts`).filter((path) => TRANSLATIONS[path] && !fetched.has(path));
  if (!paths.length) return Promise.resolve();
  const jobs = paths.map((path) => {
    let job = coming.get(path);
    if (!job) {
      job = TRANSLATIONS[path]().then(
        (m) => {
          Object.assign(CATALOGS[l], m.words);
          fetched.add(path);
          coming.delete(path);
        },
        () => {
          // No signal: the next choice of the language asks again; English is said meanwhile.
          coming.delete(path);
        },
      );
      coming.set(path, job);
    }
    return job;
  });
  return Promise.all(jobs).then(() => subscribers.forEach((fn) => fn()));
}
const coming = new Map<string, Promise<void>>();

/** The words a language needs here now: the app's, and the help's once the help is here. */
function fetchFor(l: Locale): Promise<void> {
  return fetchWords(l, helpWordsHere() ? [...speaks, ...helpSpeaks] : speaks);
}

/**
 * The placeholders and counted words of a phrase, to keep a review from dropping one: each `{name}`, and each
 * `{n, plural, …}` with the placeholders inside its forms — a language with more forms than English names them no more often.
 */
export function placeholdersOf(msg: string): string {
  const found = new Set<string>();
  const walk = (s: string): void => {
    for (let open = s.indexOf('{'); open >= 0; ) {
      const end = closing(s, open);
      if (end < 0) return;
      const inner = s.slice(open + 1, end);
      const plural = /^(\w+),\s*plural,([\s\S]*)$/.exec(inner);
      if (plural) {
        found.add(`${plural[1]}#`);
        let rest = plural[2].trim();
        for (let m = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(rest); m; m = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(rest)) {
          const e = closing(rest, m[0].length - 1);
          if (e < 0) break;
          walk(rest.slice(m[0].length, e));
          rest = rest.slice(e + 1).trim();
        }
      } else if (/^\w+$/.test(inner)) found.add(inner);
      open = s.indexOf('{', end + 1);
    }
  };
  walk(msg);
  return [...found].sort().join(',');
}

/**
 * VERSION 2 — a country's own review of a language, laid over version 1. A reviewed phrase that would lose or add a
 * placeholder against the English is not used: the screen would show a gap, or a raw `{name}`.
 */
export function reviewedWords(l: Locale, words: Record<string, string>): void {
  const kept: Record<string, string> = {};
  for (const [key, text] of Object.entries(words)) {
    const base = english[key as MessageKey];
    if (typeof text === 'string' && text.trim() && (base === undefined || placeholdersOf(base) === placeholdersOf(text))) kept[key] = text;
  }
  REVIEWED[l] = kept;
  if (l === current) subscribers.forEach((fn) => fn());
}

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
  void fetchFor(l);
}

/** Call ONCE at app start, before render: adopt the detected locale + stamp the document. */
export function initI18n(): void {
  current = detectLocale();
  applyToDocument(current);
  void fetchFor(current);
}

/** Whether the chosen language's words have come (a test, or a screen that waits for them). */
export function wordsReady(l: Locale = current): Promise<void> {
  return fetchFor(l);
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
  const own = REVIEWED[current]?.[key] ?? CATALOGS[current]?.[key];
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

/*
 * THE HELP'S WORDS, WHEN THEY ARE NEEDED (2026-10-23). Every article, in full, is more words than any app's own, so no
 * app downloads them before it is drawn: they come for a help page (the front door's main.tsx, before the page is
 * drawn) or when a help sheet opens (useHelpWords). en.help.ts is the public site's — getting in and getting started;
 * an app adds the articles about working in it (en.help-app.ts) with helpWordsAlso, from its english.ts, so they come
 * in the same fetch. The front door never adds them: the public site does not carry them at all.
 */
let helpLoading: Promise<void> | null = null;
const helpAlso: Array<() => Promise<Partial<Messages>>> = [];

/** Whether the help's words are here yet. */
export function helpWordsHere(): boolean {
  return 'help.ui.title' in english;
}

/** More help words this app fetches with the help's own: called by an app's english.ts, before anything is drawn. */
export function helpWordsAlso(load: () => Promise<Partial<Messages>>): void {
  helpAlso.push(load);
}

/** Bring the help's words in, once; every component showing words is drawn again when they arrive. */
export function loadHelpWords(): Promise<void> {
  if (helpWordsHere()) return Promise.resolve();
  helpLoading ??= Promise.all([import('./catalogs/en.help').then((m) => m.enHelp), ...helpAlso.map((load) => load())]).then(
    (catalogs) => {
      // All together, so the words are never here in part.
      for (const words of catalogs) addEnglish(words);
      subscribers.forEach((fn) => fn());
      // The help in the chosen language too, where it is written.
      void fetchWords(current, helpSpeaks);
    },
    (error: unknown) => {
      // No signal: the next opening asks again.
      helpLoading = null;
      throw error;
    },
  );
  return helpLoading;
}

/** For a help sheet: asks for the help's words when `wanted` (the sheet is open) and says whether they are here. */
export function useHelpWords(wanted = true): boolean {
  const [here, setHere] = useState(helpWordsHere);
  useEffect(() => {
    if (!wanted || here) return;
    let live = true;
    void loadHelpWords().then(
      () => live && setHere(true),
      () => undefined, // no signal: the sheet keeps saying it is waiting, and asks again when it opens again
    );
    return () => {
      live = false;
    };
  }, [wanted, here]);
  return here || helpWordsHere();
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
