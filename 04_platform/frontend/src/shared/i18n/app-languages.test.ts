import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_ENDONYMS, localesOfCountry } from './locales';

/*
 * 2026-11-09 — A COMPANY'S LANGUAGE, WIRED IN (the owner: "when we draft a company; the language should be wired in"). The
 * server asks, before a company of ours switches its country on, whether the apps are written in that country's main
 * language — from its own list (backend/src/foundation/countries/app-languages.ts). That list must be the languages these
 * apps really carry words for: English, and every folder in words/. Read off disk, from the frontend folder the tests run in.
 */
describe('the languages the apps are written in', () => {
  it('are the server’s list: English and every words/ folder — so a draft company’s readiness tells the truth', () => {
    const server = readFileSync('../backend/src/foundation/countries/app-languages.ts', 'utf8');
    const listed = /APP_WORD_LANGUAGES = \[([^\]]+)\]/.exec(server)?.[1].match(/'([a-z]{2,3})'/g)?.map((s) => s.slice(1, -1)) ?? [];
    expect(listed.length).toBeGreaterThan(1); // read the real list
    const written = readdirSync('src/shared/i18n/words', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(listed.sort()).toEqual(['en', ...written].sort());
    // Each is a language the apps offer, named in itself.
    for (const l of listed) expect(LOCALES as readonly string[]).toContain(l);
  });

  it('offers Dutch in the Netherlands and Belgium, beside English — and not in Kenya (2026-11-09)', () => {
    expect(LOCALE_ENDONYMS.nl).toBe('Nederlands');
    expect(localesOfCountry('NL')).toEqual(['en', 'nl']);
    expect(localesOfCountry('BE')).toEqual(expect.arrayContaining(['en', 'nl', 'fr']));
    expect(localesOfCountry('KE')).not.toContain('nl');
  });

  it('are downloaded only by a phone that chooses them — named for their language, left out of every app’s offline copy (2026-11-09)', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(config).toContain("'**/words-*.js'");
    expect(config).toContain('`assets/words-${m[1]}-${m[2]}-[hash].js`');
    expect(config).toMatch(/cacheName: 'sbg-words'/);
  });
});
