import { catalogueEntry } from './catalogue';

/**
 * 2026-11-09 — THE LANGUAGES THE APPS ARE WRITTEN IN (the owner: "when we draft a company; the language should be wired
 * in"). English is the apps' own; the rest are frontend/src/shared/i18n/words/<locale>/. A frontend guard test
 * (shared/i18n/app-languages.test.ts) fails when this list and those folders part, so a language written in is known here.
 */
export const APP_WORD_LANGUAGES = ['en', 'sw', 'am', 'nl'] as const;

/** A language's name in English, for a staff screen. A code not here is said as itself. */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English', sw: 'Swahili', am: 'Amharic', nl: 'Dutch', fr: 'French', ar: 'Arabic', de: 'German', pt: 'Portuguese', es: 'Spanish',
  it: 'Italian', hi: 'Hindi', zh: 'Chinese', ru: 'Russian', fa: 'Persian', id: 'Indonesian', tr: 'Turkish', so: 'Somali', om: 'Oromo',
  ti: 'Tigrinya', rw: 'Kinyarwanda', rn: 'Kirundi', lg: 'Luganda', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo', zu: 'Zulu', xh: 'Xhosa', af: 'Afrikaans',
};

export const languageName = (code: string): string => LANGUAGE_NAMES[code] ?? code.toUpperCase();

/** A country's main language: the first its catalogue line lists. */
export function mainLanguageOf(country: string | undefined): string | undefined {
  return catalogueEntry(country)?.languages?.[0];
}

/** Whether the apps are written in a language. */
export const appsSpeak = (code: string): boolean => (APP_WORD_LANGUAGES as readonly string[]).includes(code);
