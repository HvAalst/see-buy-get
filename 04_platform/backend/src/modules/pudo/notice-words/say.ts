import { NOTICE_EN, NOTICE_TRANSLATIONS, type NoticeKey } from './catalog';

/*
 * 2026-11-26 — A NOTICE IN THE READER'S LANGUAGE (the owner: "go ahead and translate the notices as well").
 *
 * Until this, every notice was written in English on the server and the apps showed it as it came, so a reader who chose
 * Bulgarian or Kiswahili read their screens in their language and their notices in English — on the bell and on the lock
 * screen alike. Now a notice is kept as PHRASES: a key of the notice catalogue (notice-words/en/*.ts) and the figures it says.
 * Its English is still worked out when it is sent and kept with it — what a reader in a language with no words for it reads,
 * what a test reads, and what an email beside it says — and every reader is told it in their own language when they read it:
 * the bell asks with the app's language (the x-sbg-lang header), and a phone is pushed in the language its app had when it
 * turned notifications on. A shared inbox (a business's, a partner's) is said to each of its people in their own.
 *
 * A notice is said in a language only when every phrase in it is written in that language; otherwise all of it in English,
 * never half and half. A figure that reads differently by language — a sum of money, a day, a time — carries its English as
 * the sender wrote it and its value, so English stays word for word what it was and every other language writes it its way.
 */

/** The languages a notice can be said in: English, and every language its phrases are written in. */
export const NOTICE_LANGS = ['en', 'sw', 'nl', 'am', 'bg'] as const;
export type NoticeLang = (typeof NOTICE_LANGS)[number];

/** A phrase of the catalogue, and what goes into its places. */
export interface Said {
  key: NoticeKey;
  vars?: Record<string, SayValue>;
}

/**
 * A figure that is written differently by language: its English, exactly as the sender wrote it, and its value. `money` in
 * major units (12.5 is twelve and a half euros); `day` a calendar day (YYYY-MM-DD); `at` a moment with its date and time and
 * `clock` the time of day alone (ISO), in `zone` (an IANA time zone) — else said in UTC, and named so.
 */
export interface Shown {
  en: string;
  money?: { amount: number; currency: string };
  day?: string;
  /** A day said with its weekday and month in words ("Saturday 28 November"), where the weekday is the point. */
  weekday?: true;
  /** A month of a year (YYYY-MM), said with its name ("November 2026"). */
  month?: string;
  at?: string;
  clock?: string;
  zone?: string;
}

/**
 * What fills a phrase's place: words said as they are (a name, a code, what somebody wrote), a number, a phrase, a figure.
 * A value that may be missing is written as the English text before it wrote it ("undefined"), so nothing a test or a reader
 * saw changes; it is never translated.
 */
export type SayValue = string | number | Said | Shown | undefined;

/** A notice's title and body, as phrases — and the buttons a phone shows on it, where it has any. */
export interface SaidNotice {
  title: Said;
  body: Said;
  actions?: SaidButton[];
}

/** A button on a pushed notice: what the service worker does on it, and its label as a phrase. */
export interface SaidButton {
  action: string;
  title: Said;
}

export function said(key: NoticeKey, vars?: Record<string, SayValue>): Said {
  return vars ? { key, vars } : { key };
}

/** A sum of money: its English as the sender writes it, and the amount in major units. */
export function money(en: string, amount: number, currency: string): Shown {
  return { en, money: { amount, currency } };
}

/** A calendar day (YYYY-MM-DD): its English as the sender writes it. */
export function day(en: string, ymd: string, opts?: { weekday: true }): Shown {
  return opts?.weekday ? { en, day: ymd, weekday: true } : { en, day: ymd };
}

/** A month of a year (YYYY-MM): its English as the sender writes it. */
export function month(en: string, ym: string): Shown {
  return { en, month: ym };
}

/** A moment, by its date and time. */
export function at(en: string, iso: string, zone?: string): Shown {
  return zone ? { en, at: iso, zone } : { en, at: iso };
}

/** A time of day. */
export function clock(en: string, iso: string, zone?: string): Shown {
  return zone ? { en, clock: iso, zone } : { en, clock: iso };
}

/**
 * A notice's title and body as phrases, with their English worked out now: spread into a notice
 * (`notify(did, { kind, ...noticeOf(said(…), said(…)), link })`).
 */
export function noticeOf(title: Said, body: Said, buttons?: SaidButton[]): { title: string; body: string; say: SaidNotice; actions?: Array<{ action: string; title: string }> } {
  if (!buttons?.length) return { title: sayEnglish(title), body: sayEnglish(body), say: { title, body } };
  return {
    title: sayEnglish(title),
    body: sayEnglish(body),
    actions: buttons.map((b) => ({ action: b.action, title: sayEnglish(b.title) })),
    say: { title, body, actions: buttons },
  };
}

/** A phrase in English: always there, since every key is an English phrase. */
export function sayEnglish(s: Said): string {
  return sayIn('en', s) ?? s.key;
}

/** A phrase in a language; undefined where it, or any phrase inside it, is not written in that language. */
export function sayIn(lang: NoticeLang, s: Said): string | undefined {
  const template = lang === 'en' ? NOTICE_EN[s.key] : NOTICE_TRANSLATIONS[lang]?.[s.key];
  if (typeof template !== 'string') return undefined;
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(s.vars ?? {})) {
    if (value === undefined) {
      params[name] = String(value);
      continue;
    }
    const v = valueIn(lang, value);
    if (v === undefined) return undefined;
    params[name] = v;
  }
  return interpolate(template, params, lang);
}

/**
 * A notice as this reader reads it: in their language where all of it is written there, else in the English it was sent in.
 * `say` is never handed on: a phone and a screen are given the words.
 */
export function noticeIn<T extends { title: string; body: string; say?: SaidNotice; actions?: Array<{ action: string; title: string }> }>(lang: NoticeLang | undefined, n: T): Omit<T, 'say'> {
  const { say, ...rest } = n;
  if (!say || !lang || lang === 'en') return rest;
  const title = sayIn(lang, say.title);
  const body = sayIn(lang, say.body);
  if (title === undefined || body === undefined) return rest;
  if (!say.actions?.length) return { ...rest, title, body };
  // Its buttons too — or the whole of it in English, buttons and all.
  const actions = say.actions.map((b) => ({ action: b.action, title: sayIn(lang, b.title) }));
  return actions.every((a) => a.title !== undefined) ? { ...rest, title, body, actions: actions as Array<{ action: string; title: string }> } : rest;
}

/** The language an app asks in (its x-sbg-lang header), where notices are written in it; anything else is English. */
export function noticeLangOf(asked: unknown): NoticeLang | undefined {
  const tag = (Array.isArray(asked) ? asked[0] : asked) as unknown;
  if (typeof tag !== 'string') return undefined;
  const lang = tag.trim().slice(0, 2).toLowerCase();
  return (NOTICE_LANGS as readonly string[]).includes(lang) ? (lang as NoticeLang) : undefined;
}

function isSaid(v: NonNullable<SayValue>): v is Said {
  return typeof v === 'object' && v !== null && 'key' in v;
}

function valueIn(lang: NoticeLang, v: NonNullable<SayValue>): string | number | undefined {
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (isSaid(v)) return sayIn(lang, v);
  return lang === 'en' ? v.en : (shownIn(lang, v) ?? v.en);
}

/** A figure written the way a language writes it; the sender's English where its value cannot be written. */
function shownIn(lang: NoticeLang, v: Shown): string | undefined {
  try {
    if (v.money) return new Intl.NumberFormat(lang, { style: 'currency', currency: v.money.currency }).format(v.money.amount);
    if (v.month) {
      const m = /^(\d{4})-(\d{2})$/.exec(v.month);
      return m ? new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : undefined;
    }
    if (v.day) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.day);
      const style: Intl.DateTimeFormatOptions = v.weekday ? { weekday: 'long', day: 'numeric', month: 'long' } : { dateStyle: 'medium' };
      return m ? new Intl.DateTimeFormat(lang, { ...style, timeZone: 'UTC' }).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : undefined;
    }
    const iso = v.at ?? v.clock;
    if (iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return undefined;
      const style: Intl.DateTimeFormatOptions = v.at ? { dateStyle: 'medium', timeStyle: 'short' } : { timeStyle: 'short' };
      const text = new Intl.DateTimeFormat(lang, { ...style, timeZone: v.zone ?? 'UTC' }).format(d);
      return v.zone ? text : `${text} UTC`;
    }
  } catch {
    // A currency or a time zone this server's Intl does not know: the sender's English.
  }
  return undefined;
}

/* The same way of filling a phrase as the apps' (frontend/src/shared/i18n/index.ts): `{name}`, and `{n, plural, …}` chosen by
 * the language's own rule. */

/** The index of the brace that closes the one at `open`; -1 where it is never closed. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function pluralOf(name: string, body: string, params: Record<string, string | number>, locale: string): string {
  if (!(name in params)) return `{${name}, plural,${body}}`;
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

/** `{name}` becomes its value, and `{name, plural, …}` the form for its number. Anything else is left as written. */
export function interpolate(msg: string, params: Record<string, string | number>, locale = 'en'): string {
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

/** Each `{name}` and each counted `{n, plural, …}` of a phrase, sorted: a translation must have the same as its English. */
export function placesOf(msg: string): string {
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
