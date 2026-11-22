// Switches Bulgarian on across the apps and the server, once words/bg is written. Run once.
const fs = require('fs');
const P = 'C:/Users/yukel/Documents/Projects/GLOS/04_platform/';
const CR = String.fromCharCode(13), NL = String.fromCharCode(10);
function edit(file, pairs) {
  const p = P + file;
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.includes(CR + NL);
  let s = crlf ? raw.split(CR + NL).join(NL) : raw;
  for (const [from, to] of pairs) {
    if (s.split(from).length !== 2) throw new Error('anchor count in ' + file + ': ' + from.slice(0, 80));
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(p, crlf ? s.split(NL).join(CR + NL) : s);
}
// The app's languages.
edit('frontend/src/shared/i18n/locales.ts', [
  ["export const LOCALES = ['en', 'sw', 'am', 'nl', 'fr', 'ar'] as const;", "export const LOCALES = ['en', 'sw', 'am', 'nl', 'bg', 'fr', 'ar'] as const;"],
  ["  nl: 'Nederlands',\n  fr: 'Français',", "  nl: 'Nederlands',\n  bg: 'Български',\n  fr: 'Français',"],
  ["  nl: ['NL', 'BE', 'SR', 'AW', 'CW', 'SX'],", "  nl: ['NL', 'BE', 'SR', 'AW', 'CW', 'SX'],\n  // 2026-11-22 — Bulgarian: Bulgaria (the owner: \"start the translation … for bulgaria\").\n  bg: ['BG'],"],
]);
// A starter, as Dutch has: the few words a screen shows before its words file arrives.
{
  const words = {};
  const src = fs.readFileSync(P + 'frontend/src/shared/i18n/words/bg/base.ts', 'utf8');
  for (const m of src.matchAll(/^\s*("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$/gm)) words[JSON.parse(m[1])] = JSON.parse(m[2]);
  const nlSrc = fs.readFileSync(P + 'frontend/src/shared/i18n/catalogs/nl.ts', 'utf8');
  const keys = [...nlSrc.matchAll(/^\s*'([a-zA-Z.]+)':/gm)].map((m) => m[1]);
  const lines = keys.filter((k) => words[k]).map((k) => `  '${k}': ${JSON.stringify(words[k]).replace(/^"|"$/g, "'").replace(/\\"/g, '"')},`);
  if (lines.some((l) => (l.match(/'/g) || []).length !== 4)) throw new Error('a starter word holds a quote');
  fs.writeFileSync(P + 'frontend/src/shared/i18n/catalogs/bg.ts', `import type { Messages } from './en';\n\n/** Български — Bulgarian (Bulgaria, 2026-11-22). Partial — any missing key falls back to English; the full version 1\n *  is words/bg/, fetched when Bulgarian is chosen, and the Bulgarian company's review lays over it. */\nexport const bg: Partial<Messages> = {\n${lines.join('\n')}\n};\n`);
}
edit('frontend/src/shared/i18n/index.ts', [
  ["import { nl } from './catalogs/nl';", "import { nl } from './catalogs/nl';\nimport { bg } from './catalogs/bg';"],
  ['const CATALOGS: Record<Locale, Partial<Messages>> = { en: english, sw, am, nl, fr, ar };', 'const CATALOGS: Record<Locale, Partial<Messages>> = { en: english, sw, am, nl, bg, fr, ar };'],
]);
// The public pages in Bulgarian, at /bg/.
edit('frontend/src/apps/home/sitePaths.ts', [
  ["export const PAGE_LOCALES = ['sw', 'nl', 'am'] as const;", "export const PAGE_LOCALES = ['sw', 'nl', 'am', 'bg'] as const;"],
  ["export const LANGUAGE_NAME: Record<PageLocale, string> = { en: 'English', sw: 'Kiswahili', nl: 'Nederlands', am: 'አማርኛ' };", "export const LANGUAGE_NAME: Record<PageLocale, string> = { en: 'English', sw: 'Kiswahili', nl: 'Nederlands', am: 'አማርኛ', bg: 'Български' };"],
  ["export const OG_LOCALE: Record<PageLocale, string> = { en: 'en_GB', sw: 'sw_KE', nl: 'nl_NL', am: 'am_ET' };", "export const OG_LOCALE: Record<PageLocale, string> = { en: 'en_GB', sw: 'sw_KE', nl: 'nl_NL', am: 'am_ET', bg: 'bg_BG' };"],
  ["  const m = /^\\/(sw|nl|am)(\\/.*)?$/.exec(path || '/');", "  const m = /^\\/(sw|nl|am|bg)(\\/.*)?$/.exec(path || '/');"],
]);
// The server: the apps speak it (readiness), staff review it, a car is told in it.
edit('backend/src/foundation/countries/app-languages.ts', [
  ["export const APP_WORD_LANGUAGES = ['en', 'sw', 'am', 'nl'] as const;", "export const APP_WORD_LANGUAGES = ['en', 'sw', 'am', 'nl', 'bg'] as const;"],
  ["  en: 'English', sw: 'Swahili', am: 'Amharic', nl: 'Dutch',", "  en: 'English', sw: 'Swahili', am: 'Amharic', nl: 'Dutch', bg: 'Bulgarian',"],
]);
edit('backend/src/modules/pudo/word-review.service.ts', [["export const REVIEW_LOCALES = ['sw', 'am', 'nl', 'fr', 'ar'] as const;", "export const REVIEW_LOCALES = ['sw', 'am', 'nl', 'bg', 'fr', 'ar'] as const;"]]);
edit('backend/src/modules/pudo/car-words.ts', [["export const CAR_LANGS = ['en', 'sw', 'am', 'nl', 'fr', 'ar'] as const;", "export const CAR_LANGS = ['en', 'sw', 'am', 'nl', 'bg', 'fr', 'ar'] as const;"]]);
// The guard: Bulgarian offered in Bulgaria, beside English.
edit('frontend/src/shared/i18n/app-languages.test.ts', [[
  "  it('are downloaded only by a phone that chooses them",
  "  it('offers Bulgarian in Bulgaria, beside English — and nowhere else (2026-11-22)', () => {\n    expect(LOCALE_ENDONYMS.bg).toBe('Български');\n    expect(localesOfCountry('BG')).toEqual(['en', 'bg']);\n    expect(localesOfCountry('NL')).not.toContain('bg');\n  });\n\n  it('are downloaded only by a phone that chooses them",
]]);
console.log('ok');
