import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { placeholdersOf, reviewedWords, setLocale, t, wordsOf, wordsReady, type MessageKey } from './index';

/*
 * 2026-11-03 — THE OTHER LANGUAGES, WRITTEN IN (the owner: "write the translation in and write a separate review sheet …
 * the first version is not lost. languages are reviewed per country sbg company").
 *
 * Every word file (words/<locale>/<catalogue>.ts) is held to the English it translates: each phrase is still in English,
 * keeps every {placeholder} and counted word, and counts in the forms its language has. An English phrase changed later
 * shows up here as one to translate again — never as a translation that quietly says something else.
 */
const english: Record<string, string> = Object.assign(
  {},
  ...Object.values(import.meta.glob<Record<string, unknown>>('./catalogs/en*.ts', { eager: true })).flatMap((m) => Object.values(m).filter((v): v is Record<string, string> => Boolean(v) && typeof v === 'object')),
);
const files = import.meta.glob<{ words: Record<string, string> }>('./words/*/*.ts', { eager: true });

function pluralForms(msg: string): string[] {
  return [...msg.matchAll(/(?:^|[\s}])(=\d+|zero|one|two|few|many|other)\s*\{/g)].map((m) => m[1]);
}

describe('the word files', () => {
  it('reads them all — a guard that found none would pass for ever', () => {
    expect(Object.keys(english).length).toBeGreaterThan(14_000);
    const sw = Object.keys(files).filter((p) => p.startsWith('./words/sw/'));
    expect(sw.length).toBeGreaterThanOrEqual(20);
    expect(Object.values(files).reduce((n, f) => n + Object.keys(f.words).length, 0)).toBeGreaterThan(12_000);
  });

  it('each phrase is still in English, keeps its placeholders, and counts in its own language’s forms', () => {
    const problems: string[] = [];
    for (const [path, file] of Object.entries(files)) {
      const locale = path.split('/')[2];
      const forms = new Set([...new Intl.PluralRules(locale).resolvedOptions().pluralCategories]);
      for (const [key, text] of Object.entries(file.words)) {
        const base = english[key];
        if (base === undefined) problems.push(`${path}: ${key} is not in English`);
        else if (placeholdersOf(base) !== placeholdersOf(text)) problems.push(`${path}: ${key} has {${placeholdersOf(text)}}, English {${placeholdersOf(base)}}`);
        for (const f of pluralForms(text)) if (!f.startsWith('=') && !forms.has(f as Intl.LDMLPluralRule)) problems.push(`${path}: ${key} counts in "${f}", which ${locale} does not have`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('every app names the catalogues it speaks, so its words are fetched in the chosen language', () => {
    for (const app of ['agent', 'business', 'driver', 'fleet', 'genesis', 'home', 'mdp', 'tower', 'vendor']) {
      expect({ app, wired: /\nwordsOf\('/.test(readFileSync(`src/apps/${app}/english.ts`, 'utf8')) }).toEqual({ app, wired: true });
    }
    // The choice is in every app's Settings.
    expect(readFileSync('src/shared/account/SettingsSheet.tsx', 'utf8')).toMatch(/<LanguageSwitcher \/>/);
  });
});

describe('choosing a language', () => {
  const key = Object.keys(files['./words/sw/base.ts'].words).find((k) => !/[{]/.test(files['./words/sw/base.ts'].words[k]) && english[k] !== files['./words/sw/base.ts'].words[k]) as MessageKey;

  it('fetches its words and says them; English again when English is chosen', async () => {
    wordsOf('send');
    setLocale('sw');
    await wordsReady('sw');
    expect(t(key)).toBe(files['./words/sw/base.ts'].words[key]);
    setLocale('en');
    expect(t(key)).toBe(english[key]);
  });

  it('lays a country’s review over version 1 — and keeps version 1 where a review would drop a placeholder', async () => {
    setLocale('sw');
    await wordsReady('sw');
    const withName = Object.keys(files['./words/sw/base.ts'].words).find((k) => (english[k] ?? '').match(/\{/g)?.length === 1 && /\{\w+\}/.test(english[k])) as MessageKey;
    const name = /\{(\w+)\}/.exec(english[withName])![1];
    reviewedWords('sw', { [key]: 'Neno lililokaguliwa', [withName]: 'Bila nafasi ya jina' });
    expect(t(key)).toBe('Neno lililokaguliwa');
    expect(t(withName)).toBe(files['./words/sw/base.ts'].words[withName]);
    reviewedWords('sw', { [withName]: `Imekaguliwa, {${name}}` });
    expect(t(withName, { [name]: 'X' })).toBe('Imekaguliwa, X');
    reviewedWords('sw', {});
    setLocale('en');
  });
});
