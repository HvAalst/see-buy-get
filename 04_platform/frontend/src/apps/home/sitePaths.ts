/**
 * 2026-11-18 — THE PUBLIC PAGES IN EACH LANGUAGE, AT THEIR OWN ADDRESS (the owner, asked about AI search: "Is SBG optimized
 * for GEO?"). The Kiswahili, Dutch and Amharic words were there, but drawn only in a browser that had chosen them, so search
 * engines and AI assistants read English alone. Now each page that has its words in every language is also built at
 * /sw/…, /nl/… and /am/… — English stays at the root — and says which addresses are the same page in another language.
 *
 * Not the terms of use, the data notice or the cookie statement: their text is written by staff in English, and a page in
 * another language around an English text would not be a translation.
 */
export const PAGE_LOCALES = ['sw', 'nl', 'am', 'bg'] as const;
export type PageLocale = 'en' | (typeof PAGE_LOCALES)[number];
export const ALL_PAGE_LOCALES: readonly PageLocale[] = ['en', ...PAGE_LOCALES];

/** Each language by its own name, so a reader finds theirs without reading another. */
export const LANGUAGE_NAME: Record<PageLocale, string> = { en: 'English', sw: 'Kiswahili', nl: 'Nederlands', am: 'አማርኛ', bg: 'Български' };

/** Open Graph names a language with a country: where each is mostly read here. */
export const OG_LOCALE: Record<PageLocale, string> = { en: 'en_GB', sw: 'sw_KE', nl: 'nl_NL', am: 'am_ET', bg: 'bg_BG' };

export const isPageLocale = (l: string): l is PageLocale => (ALL_PAGE_LOCALES as readonly string[]).includes(l);

/** `/sw/about/` → Kiswahili and `/about/`; `/about/` → English and itself. */
export function splitLocale(path: string): { locale: PageLocale; rest: string } {
  const m = /^\/(sw|nl|am|bg)(\/.*)?$/.exec(path || '/');
  return m ? { locale: m[1] as PageLocale, rest: m[2] || '/' } : { locale: 'en', rest: path || '/' };
}

const IN_EVERY_LANGUAGE = [/^\/$/, /^\/about\/?$/, /^\/for\/[a-z]+\/?$/, /^\/help\/?$/, /^\/help\/[a-z0-9-]+\/?$/, /^\/towns\/[a-z0-9-]+\/?$/, /^\/directory\/?$/, /^\/directory\/[a-z]{2}\/?$/i];

/** Whether a page (its path without a language) is built in every language. */
export function hasLanguages(rest: string): boolean {
  return IN_EVERY_LANGUAGE.some((r) => r.test(rest));
}

/** A page's own address ends in a slash (`/about/`), however it was reached (`/about`): the one its canonical names. */
export const withSlash = (rest: string): string => (rest.endsWith('/') ? rest : `${rest}/`);

/** The page's address in a language: English at the root, the others under their code. */
export function pathIn(locale: PageLocale, rest: string): string {
  return locale === 'en' ? rest : `/${locale}${rest.startsWith('/') ? rest : `/${rest}`}`;
}

/**
 * A page built in a language links to the same language: every link to a page built in every language is given the
 * language's address. A link that names its own language (`hreflang`, the language row) is left as it is.
 */
export function localizeHrefs(html: string, locale: PageLocale): string {
  if (locale === 'en') return html;
  return html.replace(/<a\b[^>]*>/g, (tag) => {
    if (/\shreflang="/.test(tag)) return tag;
    return tag.replace(/\shref="(\/[^"#?]*)([?#][^"]*)?"/, (whole, path: string, tail = '') => (splitLocale(path).locale !== 'en' || !hasLanguages(path) ? whole : ` href="${pathIn(locale, path)}${tail}"`));
  });
}

/** An address the app writes into the bar (a search, a filter), kept in the language the bar is in. */
export function keepLanguage(url: string, here: string = globalThis.location?.pathname ?? '/'): string {
  const { locale } = splitLocale(here);
  const path = /^[^?#]*/.exec(url)?.[0] ?? url;
  return locale === 'en' || !hasLanguages(path) || splitLocale(path).locale !== 'en' ? url : `${pathIn(locale, path)}${url.slice(path.length)}`;
}
