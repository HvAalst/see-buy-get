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
