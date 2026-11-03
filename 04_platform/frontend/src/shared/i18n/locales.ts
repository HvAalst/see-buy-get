/**
 * i18n — the languages the network speaks. English is the base (every key is defined there and is the
 * fallback); the rest translate incrementally, so a missing key never breaks a screen — it just shows English.
 * Arabic is right-to-left, which flips the document `dir` (per-component CSS logical-property polish follows).
 */
export const LOCALES = ['en', 'sw', 'am', 'fr', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Right-to-left scripts — set `dir="rtl"` on the document when active. */
export const RTL_LOCALES: readonly Locale[] = ['ar'];
export const isRTL = (locale: Locale): boolean => RTL_LOCALES.includes(locale);

/** Each language named IN ITSELF (an endonym) — what a speaker recognises in a language picker. */
export const LOCALE_ENDONYMS: Record<Locale, string> = {
  en: 'English',
  sw: 'Kiswahili',
  am: 'አማርኛ',
  fr: 'Français',
  ar: 'العربية',
};

export const isLocale = (v: string | null | undefined): v is Locale => !!v && (LOCALES as readonly string[]).includes(v);

/**
 * 2026-11-03 — WHERE EACH LANGUAGE COUNTS (the owner: "the language would require a little digging for the nations where it
 * is actually not applicable. In The Netherlands swahili wouldn't make much sense since it is not a language that has legal
 * importance"). The countries where a language we write in is a national or official one: offered there at once; anywhere
 * else it is a step further, under "Other languages". English is offered everywhere.
 */
const SPOKEN_IN: Record<Exclude<Locale, 'en'>, readonly string[]> = {
  sw: ['KE', 'TZ', 'UG', 'RW', 'BI', 'CD'],
  am: ['ET'],
  fr: ['FR', 'BE', 'CH', 'LU', 'MC', 'CA', 'CD', 'CG', 'CM', 'CI', 'SN', 'ML', 'BF', 'NE', 'TD', 'GN', 'BJ', 'TG', 'GA', 'MG', 'RW', 'BI', 'DJ', 'KM', 'CF', 'SC', 'HT'],
  ar: ['EG', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'SY', 'IQ', 'YE', 'SD', 'LY', 'TN', 'DZ', 'MA', 'MR', 'SO', 'DJ', 'KM', 'PS', 'TD'],
};

/** The languages that count in a country: English, and those it speaks nationally or officially. */
export function localesOfCountry(country: string | undefined): Locale[] {
  const cc = (country ?? '').toUpperCase();
  return ['en', ...(Object.keys(SPOKEN_IN) as Array<Exclude<Locale, 'en'>>).filter((l) => SPOKEN_IN[l].includes(cc))];
}
