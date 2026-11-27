import type { MailDocument } from './mail.blocks';
import type { MailParams, MailTemplateId } from './mail.templates';
import { at, day, noticeLangOf, said, sayEnglish, sayIn, showIn, type NoticeLang, type NoticeWords, type SayValue } from '../../modules/pudo/notice-words/say';
import type { NoticeKey } from '../../modules/pudo/notice-words/catalog';

/*
 * 2026-11-27 — WHAT EVERY EMAIL IS WRITTEN WITH: the apps it sends somebody to, the help, how a day and a moment are said,
 * and what a template is. The templates themselves are in four files by who they are for (mail.account.ts, mail.staff.ts,
 * mail.companies.ts, mail.goods.ts); mail.templates.ts puts them together.
 */

/** The apps an email can send somebody to. */
export type MailApp = 'agent' | 'mdp' | 'fleet' | 'driver' | 'vendor' | 'send' | 'console' | 'home' | 'business';

export const APP_NAMES: Record<MailApp, string> = {
  agent: 'Shop app',
  mdp: 'Hub app',
  fleet: 'Fleet app',
  driver: 'Driver app',
  vendor: 'Store app',
  send: 'Send app',
  console: 'operator console',
  home: 'SeeBuyGet',
  business: 'Business app',
};

const PATHS: Record<MailApp, [number, string]> = {
  driver: [5173, '/driver/'],
  agent: [5175, '/agent/'],
  send: [5176, '/send/'],
  fleet: [5177, '/fleet/'],
  mdp: [5178, '/mdp/'],
  vendor: [5179, '/vendor/'],
  home: [5180, '/'],
  console: [5181, '/'],
  business: [5182, '/business/'],
};

/** Where a button goes. `SBG_PUBLIC_URL` in a deployment (e.g. https://app.seebuyget.com); the dev servers otherwise. */
export function appUrl(app: MailApp): string {
  // The operator console lives on its own address (e.g. https://ops.seebuyget.com), never under the public site.
  if (app === 'console' && process.env.SBG_CONSOLE_URL?.trim()) return `${process.env.SBG_CONSOLE_URL.trim().replace(/\/+$/, '')}/`;
  const base = process.env.SBG_PUBLIC_URL?.trim().replace(/\/+$/, '');
  const [port, path] = PATHS[app];
  return base ? `${base}${path}` : `http://localhost:${port}${path}`;
}

/** The help (the front door's /help/, an article at /help/<id>/). `SBG_HELP_URL`, else on the public site. */
export function helpUrl(article?: string): string {
  const base = (process.env.SBG_HELP_URL?.trim() || (process.env.SBG_PUBLIC_URL ? `${process.env.SBG_PUBLIC_URL.trim().replace(/\/+$/, '')}/help/` : 'http://localhost:5180/help/')).replace(/\/*$/, '/');
  return article ? `${base}${article}/` : base;
}

/** What a message to us was about, in the words the help offered (support.types.ts). */
export const SUPPORT_TOPIC: Record<string, string> = {
  'sign-in': 'Signing in, a PIN, a password or a code',
  parcel: 'A parcel: sending, collecting or tracking it',
  damage: 'Something broken, opened or missing',
  money: 'Money: a fee, a payout or a top-up',
  joining: 'Signing up, or getting approved',
  business: 'A business account, freight or the API',
  safety: 'Safety, or something that looks wrong',
  privacy: 'My data, or closing my account',
  other: 'Something else',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "13 Sep 2026, 17:42 UTC" — one unambiguous form for every reader, whatever their locale or time zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/*
 * 2026-11-27 — EVERY EMAIL IN THE READER'S LANGUAGE (the owner: "fix everything except those waiting for a lawyer"). A template
 * writes its words as phrases of the catalogue (modules/pudo/notice-words/<lang>/mail-*.ts) through the MailWords it is given:
 * in English, word for word what it wrote before; in the language the person reads their app in, with their country's own
 * words for the phrases (the console's Languages screen) — where every phrase of it is written there. One phrase that is not,
 * and the whole email is written in English again: never half and half. Names, codes, addresses and what somebody wrote are
 * said as they are.
 */

/** What a template says its words with. */
export interface MailWords {
  /** The language the email is being written in. */
  readonly lang: NoticeLang;
  /** A phrase of the catalogue, its places filled: a value may be words said as they are, a number, a phrase or a figure. */
  say(key: NoticeKey, vars?: Record<string, SayValue>): string;
  /** A value on its own: a phrase, a figure (a sum, a day), or words said as they are. */
  text(v: SayValue): string;
  /** A moment: "13 Sep 2026, 17:42 UTC" in English, each language its own way, always in UTC. */
  when(iso: string): string;
  /** A day: "13 Sep 2026" in English, each language its own way. */
  date(iso: string): string;
  /** An app's name: "Shop app" in English. */
  app(app: MailApp): string;
}

function wordsFor(lang: NoticeLang, words?: NoticeWords): MailWords & { missed: boolean } {
  const w = {
    lang,
    missed: false,
    say(key: NoticeKey, vars?: Record<string, SayValue>): string {
      const s = said(key, vars);
      if (lang === 'en') return sayEnglish(s);
      const text = sayIn(lang, s, words);
      if (text !== undefined) return text;
      w.missed = true;
      return sayEnglish(s);
    },
    text(v: SayValue): string {
      if (v === undefined || typeof v === 'string' || typeof v === 'number') return String(v);
      if ('key' in v) return w.say(v.key, v.vars);
      return showIn(lang, v);
    },
    when(iso: string): string {
      return lang === 'en' ? formatWhen(iso) : showIn(lang, at(formatWhen(iso), iso));
    },
    date(iso: string): string {
      const d = new Date(iso);
      return lang === 'en' || Number.isNaN(d.getTime()) ? formatDate(iso) : showIn(lang, day(formatDate(iso), d.toISOString().slice(0, 10)));
    },
    app(app: MailApp): string {
      return lang === 'en' ? APP_NAMES[app] : w.say(`mail.app.${app}` as NoticeKey);
    },
  };
  return w;
}

/** Every email's words in English, as they were written before. */
export const ENGLISH_MAIL_WORDS: MailWords = wordsFor('en');

/**
 * THE WORDS OF ONE EMAIL, for the person it goes to: in their language where the template is phrased and every phrase of it
 * is written there, the footer too — else all of it in English.
 */
export function writeMail<P>(def: MailTemplate<P>, params: P, reader?: { lang?: string; words?: NoticeWords }): MailDocument {
  const lang = noticeLangOf(reader?.lang);
  if (lang && lang !== 'en' && def.phrased) {
    const w = wordsFor(lang, reader?.words);
    const doc = def.build(params, w);
    const footer = { noReply: w.say('mail.footer.noReply'), helpLead: w.say('mail.footer.helpLead'), helpLink: w.say('mail.footer.helpLink') };
    if (!w.missed) return { ...doc, lang, footer };
  }
  return def.build(params, ENGLISH_MAIL_WORDS);
}

export interface MailTemplate<P> {
  /** What it is, for the preview page. */
  title: string;
  /** The event that sends it. */
  sentWhen: string;
  /** False while nothing sends it yet: designed, waiting for its event to be plumbed. */
  wired: boolean;
  /**
   * HOW LONG IT STAYS WORTH SENDING, in hours, once it could not be handed over — or `false`: never sent late.
   * Every email answers this for itself; there is no default, because the two wrong answers are both bad: a notice
   * sent once and lost, or a code arriving after the one that replaced it.
   */
  sendLater: number | false;
  /**
   * SOMEBODY AT A SCREEN ASKED FOR IT, to an address they typed: a code. It goes even to an address email has come
   * back from — it is the one way such an address proves it works again — and it is never sent late.
   */
  asked?: true;
  /**
   * STILL GOES TO AN ACCOUNT AT REST (muted by its owner): it is about that account's own safety, or an answer to
   * something its owner wrote. Everything else waits for them to unmute — a code (`asked`) goes regardless.
   */
  stillToRest?: true;
  /** Believable data, for the preview page and the tests. */
  sample: P;
  /** The same email as somebody else gets it, where who it goes to changes what it says. For the preview page. */
  also?: Array<{ key: string; label: string; sample: P }>;
  /** 2026-11-27 — every word of it is a phrase (MailWords): it can be written in the reader's language. */
  phrased?: true;
  build(params: P, w: MailWords): MailDocument;
}

/** The templates for some of the emails, as a group file declares them. */
export type MailTemplates<K extends MailTemplateId> = { [T in K]: MailTemplate<MailParams[T]> };
